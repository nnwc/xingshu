use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Subscription {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub branch: String,
    pub schedule: String,
    pub enabled: bool,
    pub last_run_time: Option<DateTime<Utc>>,
    pub last_run_status: Option<String>,
    pub last_run_log: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateSubscription {
    pub name: String,
    pub url: String,
    pub branch: Option<String>,
    pub schedule: String,
    pub enabled: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateSubscription {
    pub name: Option<String>,
    pub url: Option<String>,
    pub branch: Option<String>,
    pub schedule: Option<String>,
    pub enabled: Option<bool>,
}
