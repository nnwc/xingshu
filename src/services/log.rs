use crate::models::Log;
use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, SqlitePool};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Serialize)]
pub struct LogListResponse {
    pub data: Vec<LogListItem>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct LogListItem {
    pub id: i64,
    pub task_id: i64,
    pub status: String,
    pub duration: Option<i64>,
    pub created_at: DateTime<Utc>,
}

pub struct LogService {
    pool: Arc<RwLock<SqlitePool>>,
}

impl LogService {
    pub fn new(pool: Arc<RwLock<SqlitePool>>) -> Self {
        Self { pool }
    }

    pub async fn list(&self, task_id: Option<i64>, page: i64, page_size: i64) -> Result<LogListResponse> {
        let pool = self.pool.read().await;
        let offset = (page - 1) * page_size;

        let (logs, total) = if let Some(tid) = task_id {
            let logs = sqlx::query_as::<_, LogListItem>(
                "SELECT id, task_id, status, duration, created_at FROM logs WHERE task_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
            )
            .bind(tid)
            .bind(page_size)
            .bind(offset)
            .fetch_all(&*pool)
            .await?;

            let total: (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM logs WHERE task_id = ?",
            )
            .bind(tid)
            .fetch_one(&*pool)
            .await?;

            (logs, total.0)
        } else {
            let logs = sqlx::query_as::<_, LogListItem>(
                "SELECT id, task_id, status, duration, created_at FROM logs ORDER BY created_at DESC LIMIT ? OFFSET ?",
            )
            .bind(page_size)
            .bind(offset)
            .fetch_all(&*pool)
            .await?;

            let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM logs")
                .fetch_one(&*pool)
                .await?;

            (logs, total.0)
        };

        Ok(LogListResponse {
            data: logs,
            total,
            page,
            page_size,
        })
    }

    pub async fn get(&self, id: i64) -> Result<Option<Log>> {
        let pool = self.pool.read().await;
        let log = sqlx::query_as::<_, Log>("SELECT * FROM logs WHERE id = ?")
            .bind(id)
            .fetch_optional(&*pool)
            .await?;
        Ok(log)
    }

    pub async fn get_latest_by_task(&self, task_id: i64) -> Result<Option<Log>> {
        let pool = self.pool.read().await;
        let log = sqlx::query_as::<_, Log>(
            "SELECT * FROM logs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1"
        )
        .bind(task_id)
        .fetch_optional(&*pool)
        .await?;
        Ok(log)
    }

    pub async fn create(&self, task_id: i64, output: String, status: String, duration: Option<i64>, started_at: DateTime<Utc>) -> Result<Log> {
        let pool = self.pool.read().await;
        let result = sqlx::query(
            "INSERT INTO logs (task_id, output, status, duration, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(task_id)
        .bind(&output)
        .bind(&status)
        .bind(duration)
        .bind(started_at)
        .execute(&*pool)
        .await?;

        let log = sqlx::query_as::<_, Log>("SELECT * FROM logs WHERE id = ?")
            .bind(result.last_insert_rowid())
            .fetch_one(&*pool)
            .await?;

        Ok(log)
    }

    pub async fn delete_old_logs(&self, days: i64) -> Result<u64> {
        let pool = self.pool.read().await;
        let result = sqlx::query(
            "DELETE FROM logs WHERE created_at < datetime('now', '-' || ? || ' days')",
        )
        .bind(days)
        .execute(&*pool)
        .await?;

        Ok(result.rows_affected())
    }

    pub async fn delete_by_ids(&self, ids: &[i64]) -> Result<u64> {
        if ids.is_empty() {
            return Ok(0);
        }
        let pool = self.pool.read().await;
        let placeholders = vec!["?"; ids.len()].join(",");
        let sql = format!("DELETE FROM logs WHERE id IN ({})", placeholders);
        let mut query = sqlx::query(&sql);
        for id in ids {
            query = query.bind(id);
        }
        let result = query.execute(&*pool).await?;
        Ok(result.rows_affected())
    }

    pub async fn keep_latest_n_logs(&self, keep: i64) -> Result<u64> {
        let pool = self.pool.read().await;
        let result = sqlx::query(
            "DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY created_at DESC, id DESC LIMIT ?)",
        )
        .bind(keep)
        .execute(&*pool)
        .await?;

        Ok(result.rows_affected())
    }

    pub async fn keep_latest_n_logs_per_task(&self, keep: i64) -> Result<u64> {
        let pool = self.pool.read().await;
        let result = sqlx::query(
            r#"
            DELETE FROM logs
            WHERE id IN (
                SELECT id FROM (
                    SELECT id,
                           ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY created_at DESC, id DESC) AS rn
                    FROM logs
                ) ranked
                WHERE rn > ?
            )
            "#,
        )
        .bind(keep)
        .execute(&*pool)
        .await?;

        Ok(result.rows_affected())
    }
}
