use crate::services::SubscriptionService;
use anyhow::Result;
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::RwLock;
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

pub struct SubscriptionScheduler {
    scheduler: JobScheduler,
    subscription_service: Arc<SubscriptionService>,
    job_ids: Arc<RwLock<Vec<(i64, uuid::Uuid)>>>, // (subscription_id, job_id)
}

impl SubscriptionScheduler {
    pub async fn new(subscription_service: Arc<SubscriptionService>) -> Result<Self> {
        let scheduler = JobScheduler::new().await?;

        Ok(Self {
            scheduler,
            subscription_service,
            job_ids: Arc::new(RwLock::new(Vec::new())),
        })
    }

    pub async fn start(&self) -> Result<()> {
        info!("Starting subscription scheduler...");
        self.scheduler.start().await?;
        self.reload_subscriptions().await?;
        info!("Subscription scheduler started");
        Ok(())
    }

    pub async fn reload_subscriptions(&self) -> Result<()> {
        info!("Reloading subscriptions...");

        // 清除现有任务
        let mut job_ids = self.job_ids.write().await;
        for (_, job_id) in job_ids.drain(..) {
            let _ = self.scheduler.remove(&job_id).await;
        }

        // 加载启用的订阅
        let subscriptions = self.subscription_service.list_enabled().await?;
        info!("Found {} enabled subscriptions", subscriptions.len());

        for sub in subscriptions {
            let sub_id = sub.id;
            let sub_name = sub.name.clone();
            let cron_expr = normalize_cron_expr(&sub.schedule);
            let service = self.subscription_service.clone();

            match Job::new_async_tz(cron_expr.as_str(), chrono::Local, move |_uuid, _l| {
                let service = service.clone();
                let name = sub_name.clone();
                Box::pin(async move {
                    info!("Running scheduled subscription: {}", name);
                    if let Err(e) = service.run(sub_id).await {
                        error!("Failed to run subscription {}: {}", name, e);
                    }
                })
            }) {
                Ok(job) => {
                    match self.scheduler.add(job).await {
                        Ok(job_id) => {
                            info!("Added subscription '{}' (id: {}) with schedule: {}", sub.name, sub.id, sub.schedule);
                            job_ids.push((sub.id, job_id));
                        }
                        Err(e) => error!("Failed to add subscription '{}': {}", sub.name, e),
                    }
                }
                Err(e) => error!("Failed to create job for subscription '{}': {}", sub.name, e),
            }
        }

        info!("Subscriptions reloaded");
        Ok(())
    }
}
