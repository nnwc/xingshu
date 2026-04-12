use crate::models::{CreateTask, Task, UpdateTask};
use anyhow::Result;
use chrono::Utc;
use sqlx::SqlitePool;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct TaskService {
    pool: Arc<RwLock<SqlitePool>>,
}

impl TaskService {
    pub fn new(pool: Arc<RwLock<SqlitePool>>) -> Self {
        Self { pool }
    }

    pub async fn list(&self) -> Result<Vec<Task>> {
        let pool = self.pool.read().await;
        let tasks = sqlx::query_as::<_, Task>("SELECT * FROM tasks ORDER BY id DESC")
            .fetch_all(&*pool)
            .await?;
        Ok(tasks)
    }

    pub async fn get(&self, id: i64) -> Result<Option<Task>> {
        let pool = self.pool.read().await;
        let task = sqlx::query_as::<_, Task>("SELECT * FROM tasks WHERE id = ?")
            .bind(id)
            .fetch_optional(&*pool)
            .await?;
        Ok(task)
    }

    pub async fn create(&self, create: CreateTask) -> Result<Task> {
        let pool = self.pool.read().await;
        // 检查任务名称是否已存在
        let existing = sqlx::query_as::<_, Task>("SELECT * FROM tasks WHERE name = ?")
            .bind(&create.name)
            .fetch_optional(&*pool)
            .await?;

        if existing.is_some() {
            return Err(anyhow::anyhow!("任务名称 '{}' 已存在", create.name));
        }

        // 将 cron 数组序列化为 JSON 字符串
        let cron_vec = create.cron.to_vec();
        let cron_json = serde_json::to_string(&cron_vec)?;

        let now = Utc::now();
        let schedule_config_json = create
            .schedule_config
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let notify_events_json = create
            .notify_events
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        let result = sqlx::query(
            "INSERT INTO tasks (name, command, cron, type, enabled, notify_enabled, notify_channel, notify_events, notify_attach_log, notify_log_limit, notify_log_mode, env, pre_command, post_command, group_id, working_dir, account_run_mode, account_env_key, account_split_delimiter, account_concurrency, schedule_mode, schedule_config, use_microwarp, microwarp_switch_ip_on_run, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&create.name)
        .bind(&create.command)
        .bind(&cron_json)
        .bind(&create.task_type)
        .bind(create.enabled)
        .bind(create.notify_enabled.unwrap_or(false))
        .bind(&create.notify_channel)
        .bind(&notify_events_json)
        .bind(create.notify_attach_log.unwrap_or(false))
        .bind(create.notify_log_limit)
        .bind(&create.notify_log_mode)
        .bind(&create.env)
        .bind(&create.pre_command)
        .bind(&create.post_command)
        .bind(create.group_id)
        .bind(&create.working_dir)
        .bind(&create.account_run_mode)
        .bind(&create.account_env_key)
        .bind(&create.account_split_delimiter)
        .bind(create.account_concurrency)
        .bind(&create.schedule_mode)
        .bind(&schedule_config_json)
        .bind(create.use_microwarp.unwrap_or(false))
        .bind(create.microwarp_switch_ip_on_run.unwrap_or(false))
        .bind(now)
        .bind(now)
        .execute(&*pool)
        .await?;

        let task = self.get(result.last_insert_rowid()).await?.unwrap();
        Ok(task)
    }

    pub async fn update(&self, id: i64, update: UpdateTask) -> Result<Option<Task>> {
        let pool = self.pool.read().await;
        let mut query = String::from("UPDATE tasks SET updated_at = ?");
        let mut params: Vec<String> = vec![Utc::now().to_rfc3339()];

        if let Some(name) = &update.name {
            query.push_str(", name = ?");
            params.push(name.clone());
        }
        if let Some(command) = &update.command {
            query.push_str(", command = ?");
            params.push(command.clone());
        }
        if let Some(cron) = &update.cron {
            query.push_str(", cron = ?");
            // 将 cron 数组序列化为 JSON 字符串
            let cron_vec = match cron {
                crate::models::CronInput::Single(s) => vec![s.clone()],
                crate::models::CronInput::Multiple(v) => v.clone(),
            };
            params.push(serde_json::to_string(&cron_vec)?);
        }
        if let Some(task_type) = &update.task_type {
            query.push_str(", type = ?");
            params.push(task_type.clone());
        }
        if let Some(enabled) = update.enabled {
            query.push_str(", enabled = ?");
            params.push(enabled.to_string());
        }
        if let Some(notify_enabled) = update.notify_enabled {
            query.push_str(", notify_enabled = ?");
            params.push(notify_enabled.to_string());
        }
        if let Some(notify_channel) = &update.notify_channel {
            query.push_str(", notify_channel = ?");
            params.push(notify_channel.clone());
        }
        if let Some(notify_events) = &update.notify_events {
            query.push_str(", notify_events = ?");
            params.push(serde_json::to_string(notify_events)?);
        }
        if let Some(notify_attach_log) = update.notify_attach_log {
            query.push_str(", notify_attach_log = ?");
            params.push(notify_attach_log.to_string());
        }
        if let Some(notify_log_limit) = update.notify_log_limit {
            query.push_str(", notify_log_limit = ?");
            params.push(notify_log_limit.to_string());
        }
        if let Some(notify_log_mode) = &update.notify_log_mode {
            query.push_str(", notify_log_mode = ?");
            params.push(notify_log_mode.clone());
        }
        if let Some(env) = &update.env {
            query.push_str(", env = ?");
            params.push(env.clone());
        }
        if let Some(pre_command) = &update.pre_command {
            query.push_str(", pre_command = ?");
            params.push(pre_command.clone());
        }
        if let Some(post_command) = &update.post_command {
            query.push_str(", post_command = ?");
            params.push(post_command.clone());
        }
        if let Some(group_id) = update.group_id {
            query.push_str(", group_id = ?");
            params.push(group_id.to_string());
        }
        if let Some(working_dir) = &update.working_dir {
            query.push_str(", working_dir = ?");
            params.push(working_dir.clone());
        }
        if let Some(account_run_mode) = &update.account_run_mode {
            query.push_str(", account_run_mode = ?");
            params.push(account_run_mode.clone());
        }
        if let Some(account_env_key) = &update.account_env_key {
            query.push_str(", account_env_key = ?");
            params.push(account_env_key.clone());
        }
        if let Some(account_split_delimiter) = &update.account_split_delimiter {
            query.push_str(", account_split_delimiter = ?");
            params.push(account_split_delimiter.clone());
        }
        if let Some(account_concurrency) = update.account_concurrency {
            query.push_str(", account_concurrency = ?");
            params.push(account_concurrency.to_string());
        }
        if let Some(schedule_mode) = &update.schedule_mode {
            query.push_str(", schedule_mode = ?");
            params.push(schedule_mode.clone());
        }
        if let Some(schedule_config) = &update.schedule_config {
            query.push_str(", schedule_config = ?");
            params.push(serde_json::to_string(schedule_config)?);
        }
        if let Some(use_microwarp) = update.use_microwarp {
            query.push_str(", use_microwarp = ?");
            params.push(use_microwarp.to_string());
        }
        if let Some(microwarp_switch_ip_on_run) = update.microwarp_switch_ip_on_run {
            query.push_str(", microwarp_switch_ip_on_run = ?");
            params.push(microwarp_switch_ip_on_run.to_string());
        }

        query.push_str(" WHERE id = ?");
        params.push(id.to_string());

        let mut q = sqlx::query(&query).bind(Utc::now());

        if let Some(name) = &update.name {
            q = q.bind(name);
        }
        if let Some(command) = &update.command {
            q = q.bind(command);
        }
        if let Some(cron) = &update.cron {
            let cron_vec = match cron {
                crate::models::CronInput::Single(s) => vec![s.clone()],
                crate::models::CronInput::Multiple(v) => v.clone(),
            };
            q = q.bind(serde_json::to_string(&cron_vec)?);
        }
        if let Some(task_type) = &update.task_type {
            q = q.bind(task_type);
        }
        if let Some(enabled) = update.enabled {
            q = q.bind(enabled);
        }
        if let Some(notify_enabled) = update.notify_enabled {
            q = q.bind(notify_enabled);
        }
        if let Some(notify_channel) = &update.notify_channel {
            q = q.bind(notify_channel);
        }
        if let Some(notify_events) = &update.notify_events {
            q = q.bind(serde_json::to_string(notify_events)?);
        }
        if let Some(notify_attach_log) = update.notify_attach_log {
            q = q.bind(notify_attach_log);
        }
        if let Some(notify_log_limit) = update.notify_log_limit {
            q = q.bind(notify_log_limit);
        }
        if let Some(notify_log_mode) = &update.notify_log_mode {
            q = q.bind(notify_log_mode);
        }
        if let Some(env) = &update.env {
            q = q.bind(env);
        }
        if let Some(pre_command) = &update.pre_command {
            q = q.bind(pre_command);
        }
        if let Some(post_command) = &update.post_command {
            q = q.bind(post_command);
        }
        if let Some(group_id) = update.group_id {
            q = q.bind(group_id);
        }
        if let Some(working_dir) = &update.working_dir {
            q = q.bind(working_dir);
        }
        if let Some(account_run_mode) = &update.account_run_mode {
            q = q.bind(account_run_mode);
        }
        if let Some(account_env_key) = &update.account_env_key {
            q = q.bind(account_env_key);
        }
        if let Some(account_split_delimiter) = &update.account_split_delimiter {
            q = q.bind(account_split_delimiter);
        }
        if let Some(account_concurrency) = update.account_concurrency {
            q = q.bind(account_concurrency);
        }
        if let Some(schedule_mode) = &update.schedule_mode {
            q = q.bind(schedule_mode);
        }
        if let Some(schedule_config) = &update.schedule_config {
            q = q.bind(serde_json::to_string(schedule_config)?);
        }
        if let Some(use_microwarp) = update.use_microwarp {
            q = q.bind(use_microwarp);
        }
        if let Some(microwarp_switch_ip_on_run) = update.microwarp_switch_ip_on_run {
            q = q.bind(microwarp_switch_ip_on_run);
        }

        q = q.bind(id);
        q.execute(&*pool).await?;

        drop(pool);
        self.get(id).await
    }

    pub async fn delete(&self, id: i64) -> Result<bool> {
        let pool = self.pool.read().await;
        let result = sqlx::query("DELETE FROM tasks WHERE id = ?")
            .bind(id)
            .execute(&*pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn get_enabled_tasks(&self) -> Result<Vec<Task>> {
        let pool = self.pool.read().await;
        let tasks = sqlx::query_as::<_, Task>("SELECT * FROM tasks WHERE enabled = 1 AND type = 'cron'")
            .fetch_all(&*pool)
            .await?;
        Ok(tasks)
    }

    pub async fn get_startup_tasks(&self) -> Result<Vec<Task>> {
        let pool = self.pool.read().await;
        let tasks = sqlx::query_as::<_, Task>("SELECT * FROM tasks WHERE enabled = 1 AND type = 'startup'")
            .fetch_all(&*pool)
            .await?;
        Ok(tasks)
    }

    pub async fn list_by_group(&self, group_id: i64) -> Result<Vec<Task>> {
        let pool = self.pool.read().await;
        let tasks = sqlx::query_as::<_, Task>("SELECT * FROM tasks WHERE group_id = ? ORDER BY id DESC")
            .bind(group_id)
            .fetch_all(&*pool)
            .await?;
        Ok(tasks)
    }

    pub async fn update_run_info(&self, id: i64, last_run_at: chrono::DateTime<chrono::Utc>, duration_ms: i64) -> Result<()> {
        let pool = self.pool.read().await;
        sqlx::query(
            "UPDATE tasks SET last_run_at = ?, last_run_duration = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        )
        .bind(last_run_at)
        .bind(duration_ms)
        .bind(id)
        .execute(&*pool)
        .await?;
        Ok(())
    }

    pub async fn update_next_run_at(&self, id: i64, next_run_at: chrono::DateTime<chrono::Utc>) -> Result<()> {
        let pool = self.pool.read().await;
        sqlx::query(
            "UPDATE tasks SET next_run_at = ? WHERE id = ?"
        )
        .bind(next_run_at)
        .bind(id)
        .execute(&*pool)
        .await?;
        Ok(())
    }
}
