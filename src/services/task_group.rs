use crate::models::{CreateTaskGroup, TaskGroup, UpdateTaskGroup};
use anyhow::Result;
use sqlx::SqlitePool;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct TaskGroupService {
    pool: Arc<RwLock<SqlitePool>>,
}

impl TaskGroupService {
    pub fn new(pool: Arc<RwLock<SqlitePool>>) -> Self {
        Self { pool }
    }

    pub async fn list(&self) -> Result<Vec<TaskGroup>> {
        let pool = self.pool.read().await;
        let groups = sqlx::query_as::<_, TaskGroup>(
            "SELECT * FROM task_groups ORDER BY sort_order ASC, created_at DESC"
        )
        .fetch_all(&*pool)
        .await?;
        Ok(groups)
    }

    pub async fn get(&self, id: i64) -> Result<Option<TaskGroup>> {
        let pool = self.pool.read().await;
        let group = sqlx::query_as::<_, TaskGroup>("SELECT * FROM task_groups WHERE id = ?")
            .bind(id)
            .fetch_optional(&*pool)
            .await?;
        Ok(group)
    }

    pub async fn create(&self, create: CreateTaskGroup) -> Result<TaskGroup> {
        let pool = self.pool.read().await;
        let next_sort_order: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM task_groups")
            .fetch_one(&*pool)
            .await?;
        let result = sqlx::query(
            "INSERT INTO task_groups (name, description, sort_order) VALUES (?, ?, ?)"
        )
        .bind(&create.name)
        .bind(&create.description)
        .bind(next_sort_order)
        .execute(&*pool)
        .await?;

        drop(pool);
        let group = self.get(result.last_insert_rowid()).await?
            .ok_or_else(|| anyhow::anyhow!("Failed to get created group"))?;
        Ok(group)
    }

    pub async fn update(&self, id: i64, update: UpdateTaskGroup) -> Result<TaskGroup> {
        let pool = self.pool.read().await;
        let mut query = String::from("UPDATE task_groups SET updated_at = CURRENT_TIMESTAMP");
        let mut params: Vec<String> = Vec::new();

        if let Some(name) = &update.name {
            query.push_str(", name = ?");
            params.push(name.clone());
        }

        if let Some(description) = &update.description {
            query.push_str(", description = ?");
            params.push(description.clone());
        }

        query.push_str(" WHERE id = ?");

        let mut q = sqlx::query(&query);
        for param in params {
            q = q.bind(param);
        }
        q = q.bind(id);

        q.execute(&*pool).await?;

        drop(pool);
        let group = self.get(id).await?
            .ok_or_else(|| anyhow::anyhow!("Group not found"))?;
        Ok(group)
    }

    pub async fn delete(&self, id: i64) -> Result<()> {
        let pool = self.pool.read().await;
        sqlx::query("DELETE FROM task_groups WHERE id = ?")
            .bind(id)
            .execute(&*pool)
            .await?;
        Ok(())
    }

    pub async fn reorder(&self, group_ids: Vec<i64>) -> Result<()> {
        let pool = self.pool.read().await;
        for (index, group_id) in group_ids.iter().enumerate() {
            sqlx::query("UPDATE task_groups SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                .bind(index as i64)
                .bind(group_id)
                .execute(&*pool)
                .await?;
        }
        Ok(())
    }

    pub async fn get_tasks_count(&self, group_id: i64) -> Result<i64> {
        let pool = self.pool.read().await;
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM tasks WHERE group_id = ?")
            .bind(group_id)
            .fetch_one(&*pool)
            .await?;
        Ok(count.0)
    }
}
