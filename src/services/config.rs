use crate::models::{SystemConfig, CreateSystemConfig, UpdateSystemConfig, MirrorConfig, AutoBackupConfig, NotificationWebhookConfig, NotificationChannelConfig, NotificationEventBindingsConfig, NotificationTemplatesConfig, NotificationSettingsConfig, MicroWarpConfig, MicroWarpStatus};
use anyhow::{anyhow, Result};
use sqlx::SqlitePool;
use std::process::Command;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, error};
use reqwest::{Client, Proxy};
use std::time::Duration;

const DOCKER_BIN: &str = "/usr/bin/docker";

pub struct ConfigService {
    pool: Arc<RwLock<SqlitePool>>,
}

impl ConfigService {
    pub fn new(pool: Arc<RwLock<SqlitePool>>) -> Self {
        Self { pool }
    }

    pub async fn get_by_key(&self, key: &str) -> Result<Option<SystemConfig>> {
        let pool = self.pool.read().await;
        let config = sqlx::query_as::<_, SystemConfig>(
            "SELECT * FROM system_configs WHERE key = ?"
        )
        .bind(key)
        .fetch_optional(&*pool)
        .await?;
        Ok(config)
    }

    pub async fn list(&self) -> Result<Vec<SystemConfig>> {
        let pool = self.pool.read().await;
        let configs = sqlx::query_as::<_, SystemConfig>(
            "SELECT * FROM system_configs ORDER BY created_at DESC"
        )
        .fetch_all(&*pool)
        .await?;
        Ok(configs)
    }

    pub async fn create(&self, config: CreateSystemConfig) -> Result<SystemConfig> {
        let pool = self.pool.read().await;
        let result = sqlx::query(
            "INSERT INTO system_configs (key, value, description) VALUES (?, ?, ?)"
        )
        .bind(&config.key)
        .bind(&config.value)
        .bind(&config.description)
        .execute(&*pool)
        .await?;

        let id = result.last_insert_rowid();
        drop(pool);
        let created = self.get_by_id(id).await?;
        Ok(created.unwrap())
    }

    pub async fn update(&self, key: &str, update: UpdateSystemConfig) -> Result<Option<SystemConfig>> {
        let pool = self.pool.read().await;
        sqlx::query(
            "UPDATE system_configs SET value = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?"
        )
        .bind(&update.value)
        .bind(&update.description)
        .bind(key)
        .execute(&*pool)
        .await?;

        drop(pool);
        self.get_by_key(key).await
    }

    pub async fn delete(&self, key: &str) -> Result<bool> {
        let pool = self.pool.read().await;
        let result = sqlx::query("DELETE FROM system_configs WHERE key = ?")
            .bind(key)
            .execute(&*pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn get_by_id(&self, id: i64) -> Result<Option<SystemConfig>> {
        let pool = self.pool.read().await;
        let config = sqlx::query_as::<_, SystemConfig>(
            "SELECT * FROM system_configs WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(&*pool)
        .await?;
        Ok(config)
    }

    // 镜像源配置相关方法
    pub async fn get_mirror_config(&self) -> Result<MirrorConfig> {
        if let Some(config) = self.get_by_key("mirror").await? {
            let mirror_config: MirrorConfig = serde_json::from_str(&config.value)?;
            Ok(mirror_config)
        } else {
            Ok(MirrorConfig {
                linux: None,
                nodejs: None,
                python: None,
            })
        }
    }

    pub async fn update_mirror_config(&self, mirror_config: MirrorConfig) -> Result<SystemConfig> {
        let value = serde_json::to_string(&mirror_config)?;

        // 应用镜像配置到系统
        self.apply_mirror_config(&mirror_config).await?;

        if let Some(_) = self.get_by_key("mirror").await? {
            let updated = self.update("mirror", UpdateSystemConfig {
                value,
                description: Some("镜像源配置".to_string()),
            }).await?;
            Ok(updated.unwrap())
        } else {
            self.create(CreateSystemConfig {
                key: "mirror".to_string(),
                value,
                description: Some("镜像源配置".to_string()),
            }).await
        }
    }

    // 应用镜像配置到系统
    async fn apply_mirror_config(&self, config: &MirrorConfig) -> Result<()> {
        info!("Applying mirror configuration...");

        // 配置 Node.js 镜像
        if let Some(nodejs) = &config.nodejs {
            if nodejs.enabled {
                if let Some(registry) = &nodejs.registry {
                    info!("Setting npm registry to: {}", registry);
                    let output = Command::new("npm")
                        .args(&["config", "set", "registry", registry])
                        .output();

                    match output {
                        Ok(out) if out.status.success() => {
                            info!("npm registry configured successfully");
                        }
                        Ok(out) => {
                            error!("Failed to set npm registry: {}", String::from_utf8_lossy(&out.stderr));
                        }
                        Err(e) => {
                            error!("npm command not found or failed: {}", e);
                        }
                    }
                }
            }
        }

        // 配置 Python 镜像
        if let Some(python) = &config.python {
            if python.enabled {
                if let Some(index_url) = &python.index_url {
                    info!("Setting pip index to: {}", index_url);

                    // 创建 pip 配置目录
                    let pip_config_dir = std::env::var("HOME")
                        .map(|h| format!("{}/.pip", h))
                        .unwrap_or_else(|_| ".pip".to_string());

                    if let Err(e) = std::fs::create_dir_all(&pip_config_dir) {
                        error!("Failed to create pip config directory: {}", e);
                    } else {
                        let pip_config_file = format!("{}/pip.conf", pip_config_dir);
                        let pip_config_content = format!(
                            "[global]\nindex-url = {}\n[install]\ntrusted-host = {}\n",
                            index_url,
                            index_url.replace("https://", "").replace("http://", "").split('/').next().unwrap_or("")
                        );

                        match std::fs::write(&pip_config_file, pip_config_content) {
                            Ok(_) => info!("pip config written successfully"),
                            Err(e) => error!("Failed to write pip config: {}", e),
                        }
                    }
                }
            }
        }

        // 配置 Linux 镜像
        if let Some(linux) = &config.linux {
            if linux.enabled {
                // APT 源配置 (Debian/Ubuntu)
                if let Some(apt_source) = &linux.apt_source {
                    info!("Setting APT source to: {}", apt_source);

                    // 备份原有配置
                    let _ = Command::new("cp")
                        .args(&["/etc/apt/sources.list", "/etc/apt/sources.list.bak"])
                        .output();

                    // 写入新的源配置
                    match std::fs::write("/etc/apt/sources.list", apt_source) {
                        Ok(_) => {
                            info!("APT sources updated successfully");
                            // 更新软件包列表
                            let _ = Command::new("apt-get")
                                .arg("update")
                                .output();
                        }
                        Err(e) => {
                            error!("Failed to update APT sources (may need root): {}", e);
                        }
                    }
                }

                // YUM 源配置 (CentOS/RHEL)
                if let Some(yum_source) = &linux.yum_source {
                    info!("Setting YUM source to: {}", yum_source);

                    // 备份原有配置
                    let _ = Command::new("cp")
                        .args(&["-r", "/etc/yum.repos.d", "/etc/yum.repos.d.bak"])
                        .output();

                    // 写入新的源配置
                    match std::fs::write("/etc/yum.repos.d/custom.repo", yum_source) {
                        Ok(_) => {
                            info!("YUM sources updated successfully");
                            // 清理缓存
                            let _ = Command::new("yum")
                                .arg("clean")
                                .arg("all")
                                .output();
                        }
                        Err(e) => {
                            error!("Failed to update YUM sources (may need root): {}", e);
                        }
                    }
                }
            }
        }

        Ok(())
    }

    // 在应用启动时加载并应用镜像配置
    pub async fn load_and_apply_mirror_config(&self) -> Result<()> {
        info!("Loading mirror configuration on startup...");
        let config = self.get_mirror_config().await?;
        self.apply_mirror_config(&config).await?;
        Ok(())
    }

    pub async fn get_microwarp_config(&self) -> Result<MicroWarpConfig> {
        if let Some(config) = self.get_by_key("microwarp").await? {
            let microwarp_config: MicroWarpConfig = serde_json::from_str(&config.value)?;
            Ok(microwarp_config)
        } else {
            Ok(MicroWarpConfig::default())
        }
    }

    pub async fn update_microwarp_config(&self, config: &MicroWarpConfig) -> Result<()> {
        let value = serde_json::to_string(config)?;
        if self.get_by_key("microwarp").await?.is_some() {
            self.update("microwarp", UpdateSystemConfig {
                value,
                description: Some("MicroWARP 配置".to_string()),
            }).await?;
        } else {
            self.create(CreateSystemConfig {
                key: "microwarp".to_string(),
                value,
                description: Some("MicroWARP 配置".to_string()),
            }).await?;
        }
        Ok(())
    }

    fn extract_ip_from_microwarp_logs(logs: &str) -> Option<String> {
        logs.lines().rev().find_map(|line| {
            let idx = line.find("ip=")?;
            let value = line[idx + 3..].trim();
            if value.is_empty() || value.contains(' ') {
                value.split_whitespace().next().map(|v| v.to_string())
            } else {
                Some(value.to_string())
            }
        })
    }

    pub async fn get_microwarp_exit_ip(&self) -> Result<String> {
        let config = self.get_microwarp_config().await?;
        let container_name = if config.container_name.trim().is_empty() {
            "microwarp"
        } else {
            config.container_name.trim()
        };

        if let Ok(output) = Command::new(DOCKER_BIN)
            .args(["logs", "--tail", "80", container_name])
            .output()
        {
            let logs = format!(
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            if let Some(ip) = Self::extract_ip_from_microwarp_logs(&logs) {
                return Ok(ip);
            }
        }

        let ip_check_url = if config.ip_check_url.trim().is_empty() {
            "https://api.ipify.org"
        } else {
            config.ip_check_url.trim()
        };

        let mut client_builder = Client::builder()
            .timeout(Duration::from_millis(config.timeout_ms.max(1000)));

        if !config.proxy_url.trim().is_empty() {
            client_builder = client_builder.proxy(Proxy::all(config.proxy_url.trim())?);
        }

        let client = client_builder.build()?;
        let body = client.get(ip_check_url).send().await?.text().await?;
        Ok(body.trim().to_string())
    }

    pub async fn get_microwarp_status(&self) -> Result<MicroWarpStatus> {
        let config = self.get_microwarp_config().await?;
        let container_name = if config.container_name.trim().is_empty() {
            "microwarp".to_string()
        } else {
            config.container_name.trim().to_string()
        };

        let running = Command::new(DOCKER_BIN)
            .args(["inspect", "-f", "{{.State.Running}}", &container_name])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().eq("true"))
            .unwrap_or(false);

        let current_ip = self.get_microwarp_exit_ip().await.ok().filter(|v| !v.is_empty());
        let switch_mode = if !config.switch_url.trim().is_empty() {
            "http-api".to_string()
        } else if config.reset_config_on_switch {
            "delete-config-and-restart".to_string()
        } else {
            "container-restart".to_string()
        };

        Ok(MicroWarpStatus {
            enabled: config.enabled,
            running,
            container_name,
            current_ip,
            proxy_url: config.proxy_url,
            switch_mode,
            auto_switch_enabled: config.auto_switch_enabled,
            auto_switch_interval_minutes: config.auto_switch_interval_minutes,
        })
    }

    pub async fn start_microwarp(&self) -> Result<String> {
        let config = self.get_microwarp_config().await?;
        let container_name = if config.container_name.trim().is_empty() {
            "microwarp"
        } else {
            config.container_name.trim()
        };

        let output = Command::new(DOCKER_BIN)
            .args(["start", container_name])
            .output()?;

        if !output.status.success() {
            return Err(anyhow!(
                "启动 MicroWARP 容器失败: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        Ok(format!("MicroWARP 容器 {} 已启动", container_name))
    }

    pub async fn stop_microwarp(&self) -> Result<String> {
        let config = self.get_microwarp_config().await?;
        let container_name = if config.container_name.trim().is_empty() {
            "microwarp"
        } else {
            config.container_name.trim()
        };

        let output = Command::new(DOCKER_BIN)
            .args(["stop", container_name])
            .output()?;

        if !output.status.success() {
            return Err(anyhow!(
                "停止 MicroWARP 容器失败: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        Ok(format!("MicroWARP 容器 {} 已停止", container_name))
    }


    pub async fn switch_microwarp_ip(&self) -> Result<String> {
        let config = self.get_microwarp_config().await?;
        if !config.enabled {
            return Err(anyhow!("MicroWARP 未启用"));
        }

        if !config.switch_url.trim().is_empty() {
            let client = Client::builder()
                .timeout(Duration::from_millis(config.timeout_ms.max(1000)))
                .build()?;

            let response = client.post(config.switch_url.trim()).send().await?;
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            if !status.is_success() {
                return Err(anyhow!("切换 IP 失败: HTTP {} {}", status, body));
            }

            return Ok(if body.trim().is_empty() {
                "IP 切换成功".to_string()
            } else {
                body
            });
        }

        let container_name = if config.container_name.trim().is_empty() {
            "microwarp"
        } else {
            config.container_name.trim()
        };

        if config.reset_config_on_switch {
            let rm_output = Command::new(DOCKER_BIN)
                .args(["exec", container_name, "sh", "-lc", "rm -f /etc/wireguard/wg0.conf"])
                .output()?;
            if !rm_output.status.success() {
                return Err(anyhow!(
                    "删除 MicroWARP 配置失败: {}",
                    String::from_utf8_lossy(&rm_output.stderr)
                ));
            }
        }

        let output = Command::new(DOCKER_BIN)
            .args(["restart", container_name])
            .output()?;

        if !output.status.success() {
            return Err(anyhow!(
                "重启 MicroWARP 容器失败: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        Ok(if config.reset_config_on_switch {
            format!("MicroWARP 容器 {} 已删除配置并重启", container_name)
        } else {
            format!("MicroWARP 容器 {} 已重启", container_name)
        })
    }

    pub async fn get_auto_backup_config(&self) -> Result<AutoBackupConfig> {
        if let Some(config) = self.get_by_key("auto_backup").await? {
            let backup_config: AutoBackupConfig = serde_json::from_str(&config.value)?;
            Ok(backup_config)
        } else {
            Ok(AutoBackupConfig::default())
        }
    }

    // 更新自动备份配置
    pub async fn update_auto_backup_config(&self, config: &AutoBackupConfig) -> Result<()> {
        let value = serde_json::to_string(config)?;

        if self.get_by_key("auto_backup").await?.is_some() {
            self.update("auto_backup", UpdateSystemConfig {
                value,
                description: Some("自动备份配置".to_string()),
            }).await?;
        } else {
            self.create(CreateSystemConfig {
                key: "auto_backup".to_string(),
                value,
                description: Some("自动备份配置".to_string()),
            }).await?;
        }

        Ok(())
    }

    pub async fn get_notification_webhook_config(&self) -> Result<NotificationWebhookConfig> {
        if let Some(config) = self.get_by_key("notification_webhook").await? {
            let webhook_config: NotificationWebhookConfig = serde_json::from_str(&config.value)?;
            Ok(webhook_config)
        } else {
            Ok(NotificationWebhookConfig::default())
        }
    }

    pub async fn update_notification_webhook_config(&self, config: &NotificationWebhookConfig) -> Result<()> {
        let value = serde_json::to_string(config)?;

        if self.get_by_key("notification_webhook").await?.is_some() {
            self.update("notification_webhook", UpdateSystemConfig {
                value,
                description: Some("消息推送 Webhook 配置".to_string()),
            }).await?;
        } else {
            self.create(CreateSystemConfig {
                key: "notification_webhook".to_string(),
                value,
                description: Some("消息推送 Webhook 配置".to_string()),
            }).await?;
        }

        Ok(())
    }

    pub async fn get_notification_channel_config(&self, channel: &str) -> Result<NotificationChannelConfig> {
        let key = format!("notification_channel_{}", channel);
        if let Some(config) = self.get_by_key(&key).await? {
            let channel_config: NotificationChannelConfig = serde_json::from_str(&config.value)?;
            Ok(channel_config)
        } else if channel == "webhook" {
            let webhook = self.get_notification_webhook_config().await?;
            Ok(NotificationChannelConfig {
                channel: "webhook".to_string(),
                enabled: webhook.enabled,
                webhook_url: webhook.webhook_url,
                secret: webhook.secret,
                task_events_enabled: webhook.task_events_enabled,
                system_events_enabled: webhook.system_events_enabled,
                remark: None,
                fields: serde_json::json!({}),
            })
        } else {
            Ok(NotificationChannelConfig {
                channel: channel.to_string(),
                ..NotificationChannelConfig::default()
            })
        }
    }

    pub async fn update_notification_channel_config(&self, config: &NotificationChannelConfig) -> Result<()> {
        let key = format!("notification_channel_{}", config.channel);
        let value = serde_json::to_string(config)?;

        if self.get_by_key(&key).await?.is_some() {
            self.update(&key, UpdateSystemConfig {
                value,
                description: Some(format!("消息推送渠道配置：{}", config.channel)),
            }).await?;
        } else {
            self.create(CreateSystemConfig {
                key,
                value,
                description: Some(format!("消息推送渠道配置：{}", config.channel)),
            }).await?;
        }

        if config.channel == "webhook" {
            let legacy = NotificationWebhookConfig {
                enabled: config.enabled,
                webhook_url: config.webhook_url.clone(),
                secret: config.secret.clone(),
                task_events_enabled: config.task_events_enabled,
                system_events_enabled: config.system_events_enabled,
            };
            self.update_notification_webhook_config(&legacy).await?;
        }

        Ok(())
    }

    pub async fn list_notification_channel_configs(&self) -> Result<Vec<NotificationChannelConfig>> {
        let supported_channels = vec![
            "webhook",
            "telegram",
            "bark",
            "ntfy",
            "pushplus",
            "gotify",
            "wecom",
            "dingtalk",
            "feishu",
            "discord",
            "slack",
            "serverchan",
            "email",
        ];

        let mut configs = Vec::with_capacity(supported_channels.len());
        for channel in supported_channels {
            configs.push(self.get_notification_channel_config(channel).await?);
        }

        Ok(configs)
    }

    pub async fn get_notification_event_bindings_config(&self) -> Result<NotificationEventBindingsConfig> {
        if let Some(config) = self.get_by_key("notification_event_bindings").await? {
            Ok(serde_json::from_str(&config.value)?)
        } else {
            Ok(NotificationEventBindingsConfig::default())
        }
    }

    pub async fn update_notification_event_bindings_config(&self, config: &NotificationEventBindingsConfig) -> Result<()> {
        let value = serde_json::to_string(config)?;
        if self.get_by_key("notification_event_bindings").await?.is_some() {
            self.update("notification_event_bindings", UpdateSystemConfig {
                value,
                description: Some("消息推送事件绑定配置".to_string()),
            }).await?;
        } else {
            self.create(CreateSystemConfig {
                key: "notification_event_bindings".to_string(),
                value,
                description: Some("消息推送事件绑定配置".to_string()),
            }).await?;
        }
        Ok(())
    }

    pub async fn get_notification_templates_config(&self) -> Result<NotificationTemplatesConfig> {
        if let Some(config) = self.get_by_key("notification_templates").await? {
            Ok(serde_json::from_str(&config.value)?)
        } else {
            Ok(NotificationTemplatesConfig::default())
        }
    }

    pub async fn update_notification_templates_config(&self, config: &NotificationTemplatesConfig) -> Result<()> {
        let value = serde_json::to_string(config)?;
        if self.get_by_key("notification_templates").await?.is_some() {
            self.update("notification_templates", UpdateSystemConfig {
                value,
                description: Some("消息推送模板配置".to_string()),
            }).await?;
        } else {
            self.create(CreateSystemConfig {
                key: "notification_templates".to_string(),
                value,
                description: Some("消息推送模板配置".to_string()),
            }).await?;
        }
        Ok(())
    }

    pub async fn get_notification_settings_config(&self) -> Result<NotificationSettingsConfig> {
        if let Some(config) = self.get_by_key("notification_settings").await? {
            Ok(serde_json::from_str(&config.value)?)
        } else {
            Ok(NotificationSettingsConfig::default())
        }
    }

    pub async fn update_notification_settings_config(&self, config: &NotificationSettingsConfig) -> Result<()> {
        let value = serde_json::to_string(config)?;
        if self.get_by_key("notification_settings").await?.is_some() {
            self.update("notification_settings", UpdateSystemConfig {
                value,
                description: Some("消息推送全局设置".to_string()),
            }).await?;
        } else {
            self.create(CreateSystemConfig {
                key: "notification_settings".to_string(),
                value,
                description: Some("消息推送全局设置".to_string()),
            }).await?;
        }
        Ok(())
    }
}
