use crate::models::TotpSetupResponse;
use crate::services::ConfigService;
use anyhow::{anyhow, Result};
use base32::{Alphabet, encode as base32_encode};
use bcrypt::{hash, verify, DEFAULT_COST};
use image::Luma;
use qrcode::QrCode;
use rand::Rng;
use std::sync::Arc;
use totp_rs::{Algorithm, Secret, TOTP};
use tracing::info;

const SESSION_TOKEN_EXPIRATION: i64 = 300; // 5分钟

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    let mut i = 0;

    while i < data.len() {
        let b1 = data[i];
        let b2 = if i + 1 < data.len() { data[i + 1] } else { 0 };
        let b3 = if i + 2 < data.len() { data[i + 2] } else { 0 };

        result.push(CHARS[(b1 >> 2) as usize] as char);
        result.push(CHARS[(((b1 & 0x03) << 4) | (b2 >> 4)) as usize] as char);
        result.push(if i + 1 < data.len() {
            CHARS[(((b2 & 0x0F) << 2) | (b3 >> 6)) as usize] as char
        } else {
            '='
        });
        result.push(if i + 2 < data.len() {
            CHARS[(b3 & 0x3F) as usize] as char
        } else {
            '='
        });

        i += 3;
    }

    result
}

pub struct TotpService {
    config_service: Arc<ConfigService>,
}

impl TotpService {
    pub fn new(config_service: Arc<ConfigService>) -> Self {
        Self { config_service }
    }

    /// 生成TOTP设置（密钥、二维码、备用码）
    pub async fn generate_setup(&self, username: &str) -> Result<TotpSetupResponse> {
        // 生成随机密钥
        let secret_bytes: Vec<u8> = (0..20).map(|_| rand::thread_rng().gen()).collect();
        let secret = base32_encode(Alphabet::RFC4648 { padding: false }, &secret_bytes);

        // 生成TOTP
        let _totp = TOTP::new(
            Algorithm::SHA1,
            6,
            1,
            30,
            Secret::Encoded(secret.clone()).to_bytes().unwrap(),
        )?;

        // 生成二维码URL
        let qr_url_string = format!(
            "otpauth://totp/Xingshu:{}?secret={}&issuer=Xingshu",
            username, secret
        );

        // 生成二维码图片
        let code = QrCode::new(qr_url_string.as_bytes())?;
        let image = code.render::<Luma<u8>>().build();

        // 转换为PNG并编码为base64
        let mut png_data = Vec::new();
        image::DynamicImage::ImageLuma8(image)
            .write_to(&mut std::io::Cursor::new(&mut png_data), image::ImageFormat::Png)?;
        let qr_base64 = format!("data:image/png;base64,{}", base64_encode(&png_data));

        // 生成备用恢复码
        let backup_codes = self.generate_backup_codes(8);

        Ok(TotpSetupResponse {
            secret,
            qr_code: qr_base64,
            backup_codes,
        })
    }

    /// 启用TOTP
    pub async fn enable_totp(&self, secret: &str, backup_codes: &[String], code: &str) -> Result<()> {
        // 验证提供的验证码
        if !self.verify_totp_code(secret, code)? {
            return Err(anyhow!("Invalid verification code"));
        }

        // 存储原始密钥（用于后续验证）和加密的密钥（用于安全存储）
        let encrypted_secret = hash(secret, DEFAULT_COST)?;

        // 加密备用码
        let encrypted_backup_codes: Vec<String> = backup_codes
            .iter()
            .map(|code| hash(code, DEFAULT_COST))
            .collect::<Result<Vec<_>, _>>()?;

        // 保存到数据库
        self.save_totp_config("totp_enabled", "true").await?;
        self.save_totp_config("totp_secret", &encrypted_secret).await?;
        self.save_totp_config("totp_secret_raw", secret).await?; // 存储原始密钥用于验证
        self.save_totp_config("totp_backup_codes", &serde_json::to_string(&encrypted_backup_codes)?).await?;

        info!("TOTP enabled successfully");
        Ok(())
    }

    /// 禁用TOTP
    pub async fn disable_totp(&self) -> Result<()> {
        self.delete_totp_config("totp_enabled").await?;
        self.delete_totp_config("totp_secret").await?;
        self.delete_totp_config("totp_secret_raw").await?;
        self.delete_totp_config("totp_backup_codes").await?;

        info!("TOTP disabled successfully");
        Ok(())
    }

    /// 检查TOTP是否启用
    pub async fn is_enabled(&self) -> Result<bool> {
        match self.config_service.get_by_key("totp_enabled").await? {
            Some(config) => Ok(config.value == "true"),
            None => Ok(false),
        }
    }

    /// 验证TOTP码或备用码
    pub async fn verify_code(&self, code: &str) -> Result<bool> {
        // 如果是6位数字，验证TOTP码
        if code.len() == 6 && code.chars().all(|c| c.is_numeric()) {
            let secret = self.get_secret().await?;
            return self.verify_totp_code(&secret, code);
        }

        // 如果是16位字符，验证备用码
        if code.len() == 16 {
            let backup_codes_config = self.config_service.get_by_key("totp_backup_codes").await?
                .ok_or_else(|| anyhow!("Backup codes not found"))?;

            let encrypted_codes: Vec<String> = serde_json::from_str(&backup_codes_config.value)?;

            // 验证备用码
            for (index, encrypted_code) in encrypted_codes.iter().enumerate() {
                if verify(code, encrypted_code)? {
                    // 使用后删除该备用码
                    let mut remaining_codes = encrypted_codes.clone();
                    remaining_codes.remove(index);
                    self.save_totp_config("totp_backup_codes", &serde_json::to_string(&remaining_codes)?).await?;

                    info!("Backup code used successfully");
                    return Ok(true);
                }
            }

            return Ok(false);
        }

        Err(anyhow!("Invalid code format"))
    }

    /// 重新生成备用码
    pub async fn regenerate_backup_codes(&self) -> Result<Vec<String>> {
        let backup_codes = self.generate_backup_codes(8);

        // 加密备用码
        let encrypted_backup_codes: Vec<String> = backup_codes
            .iter()
            .map(|code| hash(code, DEFAULT_COST))
            .collect::<Result<Vec<_>, _>>()?;

        // 保存到数据库
        self.save_totp_config("totp_backup_codes", &serde_json::to_string(&encrypted_backup_codes)?).await?;

        info!("Backup codes regenerated successfully");
        Ok(backup_codes)
    }

    /// 验证TOTP码（使用原始密钥）
    fn verify_totp_code(&self, secret: &str, code: &str) -> Result<bool> {
        let totp = TOTP::new(
            Algorithm::SHA1,
            6,
            1,
            30,
            Secret::Encoded(secret.to_string()).to_bytes().unwrap(),
        )?;

        Ok(totp.check_current(code)?)
    }

    /// 生成备用恢复码
    fn generate_backup_codes(&self, count: usize) -> Vec<String> {
        let mut codes = Vec::new();
        let charset: Vec<char> = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".chars().collect();

        for _ in 0..count {
            let code: String = (0..16)
                .map(|_| charset[rand::thread_rng().gen_range(0..charset.len())])
                .collect();
            codes.push(code);
        }

        codes
    }

    /// 保存TOTP配置
    async fn save_totp_config(&self, key: &str, value: &str) -> Result<()> {
        use crate::models::{CreateSystemConfig, UpdateSystemConfig};

        if self.config_service.get_by_key(key).await?.is_some() {
            self.config_service.update(key, UpdateSystemConfig {
                value: value.to_string(),
                description: None,
            }).await?;
        } else {
            self.config_service.create(CreateSystemConfig {
                key: key.to_string(),
                value: value.to_string(),
                description: None,
            }).await?;
        }

        Ok(())
    }

    /// 删除TOTP配置
    async fn delete_totp_config(&self, key: &str) -> Result<()> {
        self.config_service.delete(key).await?;
        Ok(())
    }

    /// 获取原始密钥（用于验证）
    pub async fn get_secret(&self) -> Result<String> {
        let config = self.config_service.get_by_key("totp_secret_raw").await?
            .ok_or_else(|| anyhow!("TOTP secret not found"))?;
        Ok(config.value)
    }
}
