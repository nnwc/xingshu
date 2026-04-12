use crate::models::LoginLog;
use anyhow::Result;
use sqlx::SqlitePool;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct LoginLogService {
    pool: Arc<RwLock<SqlitePool>>,
}

impl LoginLogService {
    pub fn new(pool: Arc<RwLock<SqlitePool>>) -> Self {
        Self { pool }
    }

    /// 记录登录日志
    pub async fn create(&self, username: &str, ip_address: &str) -> Result<()> {
        let pool = self.pool.read().await;
        sqlx::query("INSERT INTO login_logs (username, ip_address) VALUES (?, ?)")
            .bind(username)
            .bind(ip_address)
            .execute(&*pool)
            .await?;
        Ok(())
    }

    /// 获取登录日志列表
    pub async fn list(&self, limit: i64, offset: i64) -> Result<Vec<LoginLog>> {
        let pool = self.pool.read().await;
        let logs = sqlx::query_as::<_, LoginLog>(
            "SELECT * FROM login_logs ORDER BY created_at DESC LIMIT ? OFFSET ?"
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&*pool)
        .await?;
        Ok(logs)
    }

    /// 获取登录日志总数
    pub async fn count(&self) -> Result<i64> {
        let pool = self.pool.read().await;
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM login_logs")
            .fetch_one(&*pool)
            .await?;
        Ok(count.0)
    }

    /// 清理旧的登录日志，但至少保留最近10条
    pub async fn delete_old_logs(&self, retention_days: i64) -> Result<u64> {
        let pool = self.pool.read().await;

        // 先获取总数
        let total_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM login_logs")
            .fetch_one(&*pool)
            .await?;

        if total_count.0 <= 10 {
            // 如果总数不超过10条，不删除
            return Ok(0);
        }

        // 删除超过保留天数的日志，但保留最近10条
        let result = sqlx::query(
            r#"
            DELETE FROM login_logs
            WHERE id NOT IN (
                SELECT id FROM login_logs
                ORDER BY created_at DESC
                LIMIT 10
            )
            AND created_at < datetime('now', '-' || ? || ' days')
            "#
        )
        .bind(retention_days)
        .execute(&*pool)
        .await?;

        Ok(result.rows_affected())
    }
}
