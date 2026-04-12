mod subscription_scheduler;
mod backup_scheduler;

pub use subscription_scheduler::SubscriptionScheduler;
pub use backup_scheduler::BackupScheduler;

use crate::services::{notifier, ConfigService, Executor, LogService, TaskService};
use anyhow::Result;
use rand::Rng;
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{Duration, Instant};
use tokio_cron_scheduler::{Job, JobScheduler};
use tracing::{error, info};

/// 标准化cron表达式：如果是5字段格式，自动补充秒字段
fn normalize_cron_expr(expr: &str) -> String {
    let parts: Vec<&str> = expr.trim().split_whitespace().collect();
    if parts.len() == 5 {
        format!("0 {}", expr)
    } else {
        expr.to_string()
    }
}

fn interval_value_to_secs(value: u64, unit: &str) -> u64 {
    match unit {
        "second" => value,
        "minute" => value * 60,
        "hour" => value * 60 * 60,
        "day" => value * 60 * 60 * 24,
        "week" => value * 60 * 60 * 24 * 7,
        "year" => value * 60 * 60 * 24 * 365,
        _ => value * 60,
    }
}

async fn run_scheduled_task(
    task: crate::models::Task,
    task_service: Arc<TaskService>,
    log_service: Arc<LogService>,
    executor: Arc<Executor>,
    config_service: Arc<ConfigService>,
) {
    info!("Running scheduled task: {}", task.name);

    let start_time = chrono::Utc::now();

    let (_execution_id, output, success) = match executor.execute(&task).await {
        Ok(result) => result,
        Err(e) => {
            error!("Task execution error: {}", e);
            (String::new(), format!("Execution error: {}", e), false)
        }
    };

    let duration = (chrono::Utc::now() - start_time).num_milliseconds();

    if let Err(e) = task_service.update_run_info(task.id, start_time, duration).await {
        error!("Failed to update task run info: {}", e);
    }

    if task.schedule_mode.as_deref() != Some("random_interval") {
        if let Some(next) = task
            .cron
            .iter()
            .map(|c| normalize_cron_expr(c))
            .filter_map(|c| cron::Schedule::from_str(&c).ok())
            .filter_map(|s| s.upcoming(chrono::Local).next())
            .min()
        {
            let _ = task_service
                .update_next_run_at(task.id, next.with_timezone(&chrono::Utc))
                .await;
        }
    }

    let status = if success { "success" } else { "failed" };
    info!(
        "About to save scheduled task log: task_id={}, status={}, duration_ms={}, output_len={}",
        task.id,
        status,
        duration,
        output.len()
    );
    match log_service
        .create(task.id, output.clone(), status.to_string(), Some(duration), start_time)
        .await
    {
        Ok(log) => {
            info!(
                "Saved scheduled task log successfully: log_id={}, task_id={}",
                log.id, task.id
            );
            let total_limit_enabled = match config_service.get_by_key("log_total_limit_enabled").await {
                Ok(Some(config)) => config.value.parse::<bool>().unwrap_or(true),
                _ => true,
            };
            let total_limit = match config_service.get_by_key("log_total_limit").await {
                Ok(Some(config)) => config.value.parse::<i64>().unwrap_or(5),
                _ => 5,
            };
            let per_task_limit_enabled = match config_service.get_by_key("log_per_task_limit_enabled").await {
                Ok(Some(config)) => config.value.parse::<bool>().unwrap_or(false),
                _ => false,
            };
            let per_task_limit = match config_service.get_by_key("log_per_task_limit").await {
                Ok(Some(config)) => config.value.parse::<i64>().unwrap_or(20),
                _ => 20,
            };
            if total_limit_enabled {
                if let Err(e) = log_service.keep_latest_n_logs(total_limit).await {
                    error!("Failed to trim logs to latest {}: {}", total_limit, e);
                }
            }
            if per_task_limit_enabled {
                if let Err(e) = log_service.keep_latest_n_logs_per_task(per_task_limit).await {
                    error!("Failed to trim logs to latest {} per task: {}", per_task_limit, e);
                }
            }
        }
        Err(e) => error!("Failed to save log: {}", e),
    }

    if notifier::should_send_task_notification(&task, status) {
        let data = notifier::build_task_notification_data(&task, status, duration, &output);
        notifier::send_task_notification(config_service, task.notify_channel.clone(), data).await;
    }
}

pub struct Scheduler {
    scheduler: JobScheduler,
    task_service: Arc<TaskService>,
    log_service: Arc<LogService>,
    executor: Arc<Executor>,
    config_service: Arc<ConfigService>,
    job_ids: Arc<RwLock<Vec<(i64, uuid::Uuid)>>>,
    random_task_handles: Arc<RwLock<Vec<(i64, tokio::task::JoinHandle<()>)>>>,
}

impl Scheduler {
    pub async fn new(
        task_service: Arc<TaskService>,
        log_service: Arc<LogService>,
        executor: Arc<Executor>,
        config_service: Arc<ConfigService>,
    ) -> Result<Self> {
        let scheduler = JobScheduler::new().await?;

        Ok(Self {
            scheduler,
            task_service,
            log_service,
            executor,
            config_service,
            job_ids: Arc::new(RwLock::new(Vec::new())),
            random_task_handles: Arc::new(RwLock::new(Vec::new())),
        })
    }

    pub async fn start(&self) -> Result<()> {
        info!("Starting scheduler...");
        self.scheduler.start().await?;
        self.reload_tasks().await?;
        info!("Scheduler started");
        Ok(())
    }

    pub async fn reload_tasks(&self) -> Result<()> {
        info!("Reloading tasks...");

        let mut job_ids = self.job_ids.write().await;
        for (_, job_id) in job_ids.drain(..) {
            let _ = self.scheduler.remove(&job_id).await;
        }
        drop(job_ids);

        let mut random_handles = self.random_task_handles.write().await;
        for (_, handle) in random_handles.drain(..) {
            handle.abort();
        }
        drop(random_handles);

        let tasks = self.task_service.get_enabled_tasks().await?;
        info!("Found {} enabled tasks", tasks.len());

        let mut job_ids = self.job_ids.write().await;
        let mut random_handles = self.random_task_handles.write().await;

        for task in tasks {
            match self.add_task(task.clone()).await {
                Ok((task_job_ids, random_handle)) => {
                    job_ids.extend(task_job_ids);
                    if let Some(handle) = random_handle {
                        random_handles.push((task.id, handle));
                    }
                }
                Err(e) => {
                    error!("Failed to add task: {}", e);
                }
            }
        }

        info!("Tasks reloaded");
        Ok(())
    }

    async fn add_task(
        &self,
        task: crate::models::Task,
    ) -> Result<(Vec<(i64, uuid::Uuid)>, Option<tokio::task::JoinHandle<()>>)> {
        let task_id = task.id;
        let mut job_ids = Vec::new();

        if matches!(task.schedule_mode.as_deref(), Some("random_interval") | Some("preset")) {
            let handle = self.spawn_interval_task(task).await?;
            return Ok((job_ids, Some(handle)));
        }

        for (idx, cron_expr) in task.cron.iter().enumerate() {
            let normalized_cron = normalize_cron_expr(cron_expr);
            let cron_expr = &normalized_cron;
            let task_service = self.task_service.clone();
            let log_service = self.log_service.clone();
            let executor = self.executor.clone();
            let config_service = self.config_service.clone();
            let task_clone = task.clone();

            let job = Job::new_async_tz(cron_expr.as_str(), chrono::Local, move |_uuid, _l| {
                let task = task_clone.clone();
                let task_service = task_service.clone();
                let log_service = log_service.clone();
                let executor = executor.clone();
                let config_service = config_service.clone();

                Box::pin(async move {
                    run_scheduled_task(task, task_service, log_service, executor, config_service).await;
                })
            })?;

            let job_id = self.scheduler.add(job).await?;
            info!("Added task {} with cron[{}]: {}", task_id, idx, cron_expr);
            job_ids.push((task_id, job_id));
        }

        if let Some(next) = task
            .cron
            .iter()
            .map(|c| normalize_cron_expr(c))
            .filter_map(|c| cron::Schedule::from_str(&c).ok())
            .filter_map(|s| s.upcoming(chrono::Local).next())
            .min()
        {
            let _ = self
                .task_service
                .update_next_run_at(task_id, next.with_timezone(&chrono::Utc))
                .await;
        }

        Ok((job_ids, None))
    }

    async fn spawn_interval_task(
        &self,
        task: crate::models::Task,
    ) -> Result<tokio::task::JoinHandle<()>> {
        let task_service = self.task_service.clone();
        let log_service = self.log_service.clone();
        let executor = self.executor.clone();
        let config_service = self.config_service.clone();

        let config = task.schedule_config.clone().unwrap_or_default();
        let mode = task.schedule_mode.clone().unwrap_or_else(|| "cron".to_string());

        let handle = tokio::spawn(async move {
            loop {
                let (min_value, max_value, unit) = if mode == "preset" {
                    let value = config
                        .get("interval_value")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(5);
                    let unit = config
                        .get("interval_unit")
                        .and_then(|v| v.as_str())
                        .unwrap_or("minute")
                        .to_string();
                    (value, value, unit)
                } else {
                    let min_value = config
                        .get("min_value")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(15);
                    let max_value = config
                        .get("max_value")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(20);
                    let unit = config
                        .get("unit")
                        .and_then(|v| v.as_str())
                        .unwrap_or("minute")
                        .to_string();
                    (min_value, max_value, unit)
                };

                let min_secs = interval_value_to_secs(min_value, &unit);
                let max_secs = interval_value_to_secs(max_value.max(min_value), &unit);
                let wait_secs = if min_secs >= max_secs {
                    min_secs
                } else {
                    rand::thread_rng().gen_range(min_secs..=max_secs)
                };

                let next_run = chrono::Utc::now() + chrono::Duration::seconds(wait_secs as i64);
                if let Err(e) = task_service.update_next_run_at(task.id, next_run).await {
                    error!("Failed to update next run time for interval task {}: {}", task.id, e);
                }

                tokio::time::sleep_until(Instant::now() + Duration::from_secs(wait_secs)).await;
                run_scheduled_task(
                    task.clone(),
                    task_service.clone(),
                    log_service.clone(),
                    executor.clone(),
                    config_service.clone(),
                )
                .await;
            }
        });

        Ok(handle)
    }

    pub async fn run_task_now(&self, task_id: i64) -> Result<()> {
        let task = self
            .task_service
            .get(task_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Task not found"))?;

        info!("Running task immediately: {}", task.name);

        let task_service = self.task_service.clone();
        let log_service = self.log_service.clone();
        let executor = self.executor.clone();
        let config_service = self.config_service.clone();

        tokio::spawn(async move {
            let start_time = chrono::Utc::now();

            let (_execution_id, output, success) = match executor.execute(&task).await {
                Ok(result) => result,
                Err(e) => {
                    error!("Task execution error: {}", e);
                    (String::new(), format!("Execution error: {}", e), false)
                }
            };

            let duration = (chrono::Utc::now() - start_time).num_milliseconds();

            if let Err(e) = task_service.update_run_info(task.id, start_time, duration).await {
                error!("Failed to update task run info: {}", e);
            }

            let status = if success { "success" } else { "failed" };
            info!(
                "About to save manual task log: task_id={}, status={}, duration_ms={}, output_len={}",
                task.id,
                status,
                duration,
                output.len()
            );
            match log_service
                .create(task.id, output.clone(), status.to_string(), Some(duration), start_time)
                .await
            {
                Ok(log) => {
                    info!(
                        "Saved manual task log successfully: log_id={}, task_id={}",
                        log.id, task.id
                    );
                    let total_limit_enabled = match config_service.get_by_key("log_total_limit_enabled").await {
                        Ok(Some(config)) => config.value.parse::<bool>().unwrap_or(true),
                        _ => true,
                    };
                    let total_limit = match config_service.get_by_key("log_total_limit").await {
                        Ok(Some(config)) => config.value.parse::<i64>().unwrap_or(5),
                        _ => 5,
                    };
                    let per_task_limit_enabled = match config_service.get_by_key("log_per_task_limit_enabled").await {
                        Ok(Some(config)) => config.value.parse::<bool>().unwrap_or(false),
                        _ => false,
                    };
                    let per_task_limit = match config_service.get_by_key("log_per_task_limit").await {
                        Ok(Some(config)) => config.value.parse::<i64>().unwrap_or(20),
                        _ => 20,
                    };
                    if total_limit_enabled {
                        if let Err(e) = log_service.keep_latest_n_logs(total_limit).await {
                            error!("Failed to trim logs to latest {}: {}", total_limit, e);
                        }
                    }
                    if per_task_limit_enabled {
                        if let Err(e) = log_service.keep_latest_n_logs_per_task(per_task_limit).await {
                            error!("Failed to trim logs to latest {} per task: {}", per_task_limit, e);
                        }
                    }
                }
                Err(e) => error!("Failed to save log: {}", e),
            }

            if notifier::should_send_task_notification(&task, status) {
                let data = notifier::build_task_notification_data(&task, status, duration, &output);
                notifier::send_task_notification(config_service, task.notify_channel.clone(), data).await;
            }
        });

        Ok(())
    }

    pub async fn execute_task_stream(
        &self,
        task: &crate::models::Task,
    ) -> anyhow::Result<(String, impl tokio_stream::Stream<Item = anyhow::Result<String>>)> {
        self.executor.execute_stream(task).await
    }

    pub async fn kill_task(&self, task_id: i64) -> anyhow::Result<()> {
        self.executor.kill_task_with_log(task_id, self.log_service.clone()).await
    }

    pub async fn list_running(&self) -> Vec<i64> {
        self.executor.list_running().await
    }

    pub async fn subscribe_running_tasks_with_data(
        &self,
    ) -> tokio::sync::broadcast::Receiver<crate::services::executor::RunningTasksUpdate> {
        let mut rx = self.executor.subscribe_running_tasks();
        let (tx, rx_out) = tokio::sync::broadcast::channel(100);
        let task_service = self.task_service.clone();

        tokio::spawn(async move {
            while let Ok(mut update) = rx.recv().await {
                if update.change_type == "finished" {
                    if let Ok(Some(mut task)) = task_service.get(update.changed_task_id).await {
                        if let Some(last_run_at) = update.last_run_at {
                            task.last_run_at = Some(last_run_at);
                        }
                        if let Some(duration) = update.last_run_duration {
                            task.last_run_duration = Some(duration);
                        }

                        if let Ok(task_json) = serde_json::to_value(&task) {
                            update.task_data = Some(task_json);
                        }
                    }
                }
                let _ = tx.send(update);
            }
        });

        rx_out
    }

    pub fn subscribe_running_tasks(
        &self,
    ) -> tokio::sync::broadcast::Receiver<crate::services::executor::RunningTasksUpdate> {
        self.executor.subscribe_running_tasks()
    }

    pub async fn subscribe_logs(
        &self,
        execution_id: &str,
    ) -> anyhow::Result<tokio::sync::broadcast::Receiver<String>> {
        self.executor.subscribe_logs(execution_id).await
    }

    pub async fn get_log_history(&self, execution_id: &str) -> Vec<String> {
        self.executor.get_log_history(execution_id).await
    }

    pub async fn get_execution(
        &self,
        execution_id: &str,
    ) -> Option<crate::services::executor::ExecutionInfo> {
        self.executor.get_execution(execution_id).await
    }

    pub async fn list_executions(&self) -> Vec<crate::services::executor::ExecutionInfo> {
        self.executor.list_executions().await
    }
}
