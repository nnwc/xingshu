use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SystemConfig {
    pub id: i64,
    pub key: String,
    pub value: String, // JSON格式
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateSystemConfig {
    pub key: String,
    pub value: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSystemConfig {
    pub value: String,
    pub description: Option<String>,
}

// 镜像源配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MirrorConfig {
    pub linux: Option<LinuxMirror>,
    pub nodejs: Option<NodejsMirror>,
    pub python: Option<PythonMirror>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinuxMirror {
    pub enabled: bool,
    pub apt_source: Option<String>, // Debian/Ubuntu
    pub yum_source: Option<String>, // CentOS/RHEL
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodejsMirror {
    pub enabled: bool,
    pub registry: Option<String>, // npm registry
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PythonMirror {
    pub enabled: bool,
    pub index_url: Option<String>, // pip index
}

// 自动备份配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoBackupConfig {
    pub enabled: bool,
    pub webdav_url: String,
    pub webdav_username: String,
    pub webdav_password: String,
    pub cron: String,
    pub remote_path: Option<String>,        // WebDAV 远程路径，默认为根目录
    pub max_backups: Option<u32>,           // 最大保留备份数量，None 表示不限制
    #[serde(default)]
    pub auto_restore_on_startup: bool,      // 启动时自动恢复最新备份
}

impl Default for AutoBackupConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            webdav_url: String::new(),
            webdav_username: String::new(),
            webdav_password: String::new(),
            cron: "0 2 * * *".to_string(), // 默认每天凌晨2点（5字段格式）
            remote_path: None,
            max_backups: Some(10),         // 默认保留10个备份
            auto_restore_on_startup: false, // 默认不自动恢复
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationWebhookConfig {
    pub enabled: bool,
    pub webhook_url: String,
    pub secret: Option<String>,
    #[serde(default)]
    pub task_events_enabled: bool,
    #[serde(default)]
    pub system_events_enabled: bool,
}

impl Default for NotificationWebhookConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            webhook_url: String::new(),
            secret: None,
            task_events_enabled: true,
            system_events_enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationChannelConfig {
    pub channel: String,
    pub enabled: bool,
    pub webhook_url: String,
    pub secret: Option<String>,
    #[serde(default)]
    pub task_events_enabled: bool,
    #[serde(default)]
    pub system_events_enabled: bool,
    pub remark: Option<String>,
    #[serde(default)]
    pub fields: serde_json::Value,
}

impl Default for NotificationChannelConfig {
    fn default() -> Self {
        Self {
            channel: "webhook".to_string(),
            enabled: false,
            webhook_url: String::new(),
            secret: None,
            task_events_enabled: true,
            system_events_enabled: true,
            remark: None,
            fields: serde_json::json!({}),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationEventBindingItem {
    pub event_key: String,
    pub channel: String,
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationEventBindingsConfig {
    #[serde(default)]
    pub bindings: Vec<NotificationEventBindingItem>,
}

impl Default for NotificationEventBindingsConfig {
    fn default() -> Self {
        Self {
            bindings: vec![
                NotificationEventBindingItem { event_key: "subscription_success".to_string(), channel: "webhook".to_string(), enabled: true },
                NotificationEventBindingItem { event_key: "subscription_failed".to_string(), channel: "webhook".to_string(), enabled: true },
                NotificationEventBindingItem { event_key: "backup_success".to_string(), channel: "webhook".to_string(), enabled: true },
                NotificationEventBindingItem { event_key: "backup_failed".to_string(), channel: "webhook".to_string(), enabled: true },
                NotificationEventBindingItem { event_key: "task_success".to_string(), channel: "webhook".to_string(), enabled: false },
                NotificationEventBindingItem { event_key: "task_failed".to_string(), channel: "webhook".to_string(), enabled: true },
                NotificationEventBindingItem { event_key: "task_timeout".to_string(), channel: "webhook".to_string(), enabled: true },
            ],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationTemplateItem {
    pub key: String,
    pub title: String,
    pub summary: String,
    pub title_template: String,
    pub body_template: String,
    #[serde(default)]
    pub vars: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationTemplatesConfig {
    #[serde(default)]
    pub templates: Vec<NotificationTemplateItem>,
}

impl Default for NotificationTemplatesConfig {
    fn default() -> Self {
        Self {
            templates: vec![
                NotificationTemplateItem {
                    key: "task".to_string(),
                    title: "任务通知模板".to_string(),
                    summary: "适合脚本执行、定时任务完成提醒".to_string(),
                    title_template: "任务 {{task_name}} {{status_text}}".to_string(),
                    body_template: "执行状态:{{status}}\n耗时:{{duration_ms}}ms\n执行时间:{{finished_at}}\n摘要:{{output_summary}}\n日志片段:{{output_preview}}".to_string(),
                    vars: vec!["task_name".to_string(), "status_text".to_string(), "status".to_string(), "duration_ms".to_string(), "finished_at".to_string(), "output_summary".to_string(), "output_preview".to_string()],
                },
                NotificationTemplateItem {
                    key: "subscription".to_string(),
                    title: "订阅通知模板".to_string(),
                    summary: "适合订阅同步与更新结果推送".to_string(),
                    title_template: "订阅 {{subscription_name}} {{status_text}}".to_string(),
                    body_template: "来源:{{source}}\n结果:{{message}}".to_string(),
                    vars: vec!["subscription_name".to_string(), "status_text".to_string(), "source".to_string(), "message".to_string()],
                },
            ],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationSettingsConfig {
    pub default_channel: String,
}

impl Default for NotificationSettingsConfig {
    fn default() -> Self {
        Self {
            default_channel: "webhook".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MicroWarpConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub switch_url: String,
    #[serde(default)]
    pub proxy_url: String,
    #[serde(default = "default_microwarp_ip_check_url")]
    pub ip_check_url: String,
    #[serde(default = "default_microwarp_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub auto_switch_enabled: bool,
    #[serde(default)]
    pub auto_switch_interval_minutes: u64,
    #[serde(default = "default_microwarp_container_name")]
    pub container_name: String,
    #[serde(default)]
    pub reset_config_on_switch: bool,
}

fn default_microwarp_ip_check_url() -> String {
    "https://api.ipify.org".to_string()
}

fn default_microwarp_timeout_ms() -> u64 {
    15000
}

fn default_microwarp_container_name() -> String {
    "microwarp".to_string()
}

impl Default for MicroWarpConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            switch_url: String::new(),
            proxy_url: String::new(),
            ip_check_url: default_microwarp_ip_check_url(),
            timeout_ms: default_microwarp_timeout_ms(),
            auto_switch_enabled: false,
            auto_switch_interval_minutes: 0,
            container_name: default_microwarp_container_name(),
            reset_config_on_switch: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MicroWarpStatus {
    pub enabled: bool,
    pub running: bool,
    pub container_name: String,
    pub current_ip: Option<String>,
    pub proxy_url: String,
    pub switch_mode: String,
    pub auto_switch_enabled: bool,
    pub auto_switch_interval_minutes: u64,
}
