use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct EnvVar {
    pub id: i64,
    pub key: String,
    pub value: String,
    pub remark: Option<String>,
    pub tag: Option<String>,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateEnvVar {
    pub key: String,
    pub value: String,
    pub remark: Option<String>,
    pub tag: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateEnvVar {
    pub value: Option<String>,
    pub remark: Option<String>,
    pub tag: Option<String>,
    pub enabled: Option<bool>,
}
