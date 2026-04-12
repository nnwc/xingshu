use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Dependence {
    pub id: i64,
    pub name: String,
    #[sqlx(rename = "type")]
    pub dep_type: i32, // 0: nodejs, 1: python3, 2: linux
    pub status: i32,   // 0: installing, 1: installed, 2: failed, 3: removing, 4: removed
    pub log: Option<String>, // JSON格式的日志数组 ["line1", "line2", ...]
    pub remark: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Dependence {
    /// 获取日志数组
    pub fn get_log_lines(&self) -> Vec<String> {
        self.log
            .as_ref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default()
    }

    /// 设置日志数组
    pub fn set_log_lines(lines: Vec<String>) -> String {
        serde_json::to_string(&lines).unwrap_or_default()
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateDependence {
    pub name: String,
    #[serde(rename = "type")]
    pub dep_type: DependenceType,
    pub remark: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateDependence {
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub dep_type: Option<DependenceType>,
    pub remark: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DependenceType {
    NodeJS,
    Python,
    Linux,
}

impl DependenceType {
    pub fn to_i32(&self) -> i32 {
        match self {
            DependenceType::NodeJS => 0,
            DependenceType::Python => 1,
            DependenceType::Linux => 2,
        }
    }

    pub fn from_i32(value: i32) -> Option<Self> {
        match value {
            0 => Some(DependenceType::NodeJS),
            1 => Some(DependenceType::Python),
            2 => Some(DependenceType::Linux),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &str {
        match self {
            DependenceType::NodeJS => "nodejs",
            DependenceType::Python => "python",
            DependenceType::Linux => "linux",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DependenceStatus {
    Installing,
    Installed,
    Failed,
    Removing,
    Removed,
}

impl DependenceStatus {
    pub fn to_i32(&self) -> i32 {
        match self {
            DependenceStatus::Installing => 0,
            DependenceStatus::Installed => 1,
            DependenceStatus::Failed => 2,
            DependenceStatus::Removing => 3,
            DependenceStatus::Removed => 4,
        }
    }

    pub fn from_i32(value: i32) -> Option<Self> {
        match value {
            0 => Some(DependenceStatus::Installing),
            1 => Some(DependenceStatus::Installed),
            2 => Some(DependenceStatus::Failed),
            3 => Some(DependenceStatus::Removing),
            4 => Some(DependenceStatus::Removed),
            _ => None,
        }
    }
}
