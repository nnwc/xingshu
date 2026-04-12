pub mod auth;
pub mod config;
pub mod db;
pub mod dependence;
pub mod env;
pub mod subscription;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

pub use auth::*;
pub use config::*;
pub use dependence::*;
pub use env::*;
pub use subscription::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: i64,
    pub name: String,
    pub command: String,
    pub cron: Vec<String>, // 支持多个 cron 表达式
    #[serde(rename = "type")]
    pub task_type: String, // cron/manual/startup
    pub enabled: bool,
    pub notify_enabled: bool,
    pub notify_channel: Option<String>,
    pub notify_events: Option<Vec<String>>,
    pub notify_attach_log: bool,
    pub notify_log_limit: Option<i64>,
    pub notify_log_mode: Option<String>,
    pub env: Option<String>, // JSON格式的环境变量
    pub pre_command: Option<String>,
    pub post_command: Option<String>,
    pub group_id: Option<i64>,
    pub working_dir: Option<String>, // 自定义工作目录
    pub account_run_mode: Option<String>, // single | sequential | concurrent
    pub account_env_key: Option<String>, // 账号环境变量名
    pub account_split_delimiter: Option<String>, // 账号拆分符号
    pub account_concurrency: Option<i64>, // 账号并发数
    pub schedule_mode: Option<String>, // cron | preset | random_interval
    pub schedule_config: Option<serde_json::Value>,
    pub use_microwarp: Option<bool>,
    pub microwarp_switch_ip_on_run: Option<bool>,
    pub last_run_at: Option<DateTime<Utc>>,
    pub last_run_duration: Option<i64>, // 毫秒
    pub next_run_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// 手动实现 FromRow，以便处理 cron 字段的 JSON 反序列化
impl<'r> sqlx::FromRow<'r, sqlx::sqlite::SqliteRow> for Task {
    fn from_row(row: &'r sqlx::sqlite::SqliteRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;

        let cron_str: String = row.try_get("cron")?;
        let cron: Vec<String> = serde_json::from_str(&cron_str)
            .unwrap_or_else(|_| vec![cron_str.clone()]);

        let schedule_config_str: Option<String> = row.try_get("schedule_config").ok();
        let schedule_config = schedule_config_str
            .and_then(|s| if s.trim().is_empty() { None } else { serde_json::from_str(&s).ok() });
        let notify_events_str: Option<String> = row.try_get("notify_events").ok();
        let notify_events = notify_events_str
            .and_then(|s| if s.trim().is_empty() { None } else { serde_json::from_str(&s).ok() });

        Ok(Task {
            id: row.try_get("id")?,
            name: row.try_get("name")?,
            command: row.try_get("command")?,
            cron,
            task_type: row.try_get("type")?,
            enabled: row.try_get("enabled")?,
            notify_enabled: row.try_get("notify_enabled").unwrap_or(false),
            notify_channel: row.try_get("notify_channel").ok(),
            notify_events,
            notify_attach_log: row.try_get("notify_attach_log").unwrap_or(false),
            notify_log_limit: row.try_get("notify_log_limit").ok(),
            notify_log_mode: row.try_get("notify_log_mode").ok(),
            env: row.try_get("env")?,
            pre_command: row.try_get("pre_command")?,
            post_command: row.try_get("post_command")?,
            group_id: row.try_get("group_id")?,
            working_dir: row.try_get("working_dir").ok(),
            account_run_mode: row.try_get("account_run_mode").ok(),
            account_env_key: row.try_get("account_env_key").ok(),
            account_split_delimiter: row.try_get("account_split_delimiter").ok(),
            account_concurrency: row.try_get("account_concurrency").ok(),
            schedule_mode: row.try_get("schedule_mode").ok(),
            schedule_config,
            use_microwarp: Some(row.try_get::<bool, _>("use_microwarp").unwrap_or(false)),
            microwarp_switch_ip_on_run: Some(row.try_get::<bool, _>("microwarp_switch_ip_on_run").unwrap_or(false)),
            last_run_at: row.try_get("last_run_at")?,
            last_run_duration: row.try_get("last_run_duration")?,
            next_run_at: row.try_get("next_run_at")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateTask {
    pub name: String,
    pub command: String,
    pub cron: CronInput, // 支持多个 cron 表达式
    #[serde(rename = "type")]
    pub task_type: String, // cron/manual/startup
    pub enabled: bool,
    pub notify_enabled: Option<bool>,
    pub notify_channel: Option<String>,
    pub notify_events: Option<Vec<String>>,
    pub notify_attach_log: Option<bool>,
    pub notify_log_limit: Option<i64>,
    pub notify_log_mode: Option<String>,
    pub env: Option<String>,
    pub pre_command: Option<String>,
    pub post_command: Option<String>,
    pub group_id: Option<i64>,
    pub working_dir: Option<String>,
    pub account_run_mode: Option<String>,
    pub account_env_key: Option<String>,
    pub account_split_delimiter: Option<String>,
    pub account_concurrency: Option<i64>,
    pub schedule_mode: Option<String>,
    pub schedule_config: Option<serde_json::Value>,
    pub use_microwarp: Option<bool>,
    pub microwarp_switch_ip_on_run: Option<bool>,
}

// 用于接收前端输入的 cron，支持字符串或数组
#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CronInput {
    Single(String),
    Multiple(Vec<String>),
}

impl CronInput {
    pub fn to_vec(self) -> Vec<String> {
        match self {
            CronInput::Single(s) => vec![s],
            CronInput::Multiple(v) => v,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateTask {
    pub name: Option<String>,
    pub command: Option<String>,
    pub cron: Option<CronInput>, // 支持多个 cron 表达式
    #[serde(rename = "type")]
    pub task_type: Option<String>, // cron/manual/startup
    pub enabled: Option<bool>,
    pub notify_enabled: Option<bool>,
    pub notify_channel: Option<String>,
    pub notify_events: Option<Vec<String>>,
    pub notify_attach_log: Option<bool>,
    pub notify_log_limit: Option<i64>,
    pub notify_log_mode: Option<String>,
    pub env: Option<String>,
    pub pre_command: Option<String>,
    pub post_command: Option<String>,
    pub group_id: Option<i64>,
    pub working_dir: Option<String>,
    pub account_run_mode: Option<String>,
    pub account_env_key: Option<String>,
    pub account_split_delimiter: Option<String>,
    pub account_concurrency: Option<i64>,
    pub schedule_mode: Option<String>,
    pub schedule_config: Option<serde_json::Value>,
    pub use_microwarp: Option<bool>,
    pub microwarp_switch_ip_on_run: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Log {
    pub id: i64,
    pub task_id: i64,
    pub output: String,
    pub status: String, // success/failed
    pub duration: Option<i64>, // 执行耗时（毫秒）
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScriptFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: DateTime<Utc>,
    pub is_directory: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TaskGroup {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub sort_order: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateTaskGroup {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateTaskGroup {
    pub name: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReorderTaskGroupsRequest {
    pub group_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct LoginLog {
    pub id: i64,
    pub username: String,
    pub ip_address: String,
    pub created_at: DateTime<Utc>,
}
