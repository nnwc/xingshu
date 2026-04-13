use crate::api::AppState;
use crate::models::{MirrorConfig, UpdateSystemConfig, AutoBackupConfig, NotificationWebhookConfig, NotificationChannelConfig, NotificationEventBindingsConfig, NotificationTemplatesConfig, NotificationSettingsConfig, MicroWarpConfig};
use crate::services::{WebDavClient, notifier};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

// 获取所有配置
pub async fn list_configs(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let configs = state
        .config_service
        .list()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(configs))
}

// 获取指定配置
pub async fn get_config(
    State(state): State<Arc<AppState>>,
    Path(key): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let config = state
        .config_service
        .get_by_key(&key)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    match config {
        Some(c) => Ok(Json(c)),
        None => Err((StatusCode::NOT_FOUND, "配置不存在".to_string())),
    }
}

// 更新配置
pub async fn update_config(
    State(state): State<Arc<AppState>>,
    Path(key): Path<String>,
    Json(update): Json<UpdateSystemConfig>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // 先尝试更新
    let config = state
        .config_service
        .update(&key, update.clone())
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // 如果配置不存在，则创建
    match config {
        Some(c) => Ok(Json(c)),
        None => {
            let created = state
                .config_service
                .create(crate::models::CreateSystemConfig {
                    key,
                    value: update.value,
                    description: update.description,
                })
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            Ok(Json(created))
        }
    }
}

// 删除配置
pub async fn delete_config(
    State(state): State<Arc<AppState>>,
    Path(key): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let deleted = state
        .config_service
        .delete(&key)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((StatusCode::NOT_FOUND, "配置不存在".to_string()))
    }
}

// 获取镜像源配置
pub async fn get_mirror_config(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let config = state
        .config_service
        .get_mirror_config()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(config))
}

// 更新镜像源配置
pub async fn update_mirror_config(
    State(state): State<Arc<AppState>>,
    Json(mirror_config): Json<MirrorConfig>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let config = state
        .config_service
        .update_mirror_config(mirror_config)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(config))
}

pub async fn get_microwarp_config(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let config = state
        .config_service
        .get_microwarp_config()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(config))
}

pub async fn get_microwarp_status(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let status = state
        .config_service
        .get_microwarp_status()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(status))
}

pub async fn update_microwarp_config(
    State(state): State<Arc<AppState>>,
    Json(config): Json<MicroWarpConfig>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    state
        .config_service
        .update_microwarp_config(&config)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "success": true, "data": config })))
}

pub async fn start_microwarp(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let message = state
        .config_service
        .start_microwarp()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok(Json(serde_json::json!({ "success": true, "message": message })))
}

pub async fn stop_microwarp(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let message = state
        .config_service
        .stop_microwarp()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok(Json(serde_json::json!({ "success": true, "message": message })))
}

pub async fn switch_microwarp_ip(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let message = state
        .config_service
        .switch_microwarp_ip()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok(Json(serde_json::json!({ "success": true, "message": message })))
}

pub async fn get_auto_backup_config(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let config = state
        .config_service
        .get_auto_backup_config()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(config))
}

// 更新自动备份配置
pub async fn update_auto_backup_config(
    State(state): State<Arc<AppState>>,
    Json(backup_config): Json<AutoBackupConfig>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    state
        .config_service
        .update_auto_backup_config(&backup_config)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // 重新加载备份调度器
    if let Some(backup_scheduler) = &state.backup_scheduler {
        backup_scheduler
            .reload_backup_job()
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    Ok(Json(backup_config))
}

// 测试 WebDAV 连接
pub async fn test_webdav_connection(
    Json(backup_config): Json<AutoBackupConfig>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let client = WebDavClient::new(
        backup_config.webdav_url,
        backup_config.webdav_username,
        backup_config.webdav_password,
    );

    client
        .test_connection()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("连接失败: {}", e)))?;

    Ok(Json(serde_json::json!({ "success": true, "message": "连接成功" })))
}

// 立即备份到 WebDAV
pub async fn backup_now(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // 获取自动备份配置
    let backup_config = state
        .config_service
        .get_auto_backup_config()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // 验证配置
    if backup_config.webdav_url.is_empty()
        || backup_config.webdav_username.is_empty()
        || backup_config.webdav_password.is_empty()
    {
        return Err((
            StatusCode::BAD_REQUEST,
            "WebDAV 配置不完整，请先配置 WebDAV 信息".to_string(),
        ));
    }

    // 在后台执行备份
    let webdav_url = backup_config.webdav_url.clone();
    let webdav_username = backup_config.webdav_username.clone();
    let webdav_password = backup_config.webdav_password.clone();
    let remote_path = backup_config.remote_path.clone();
    let max_backups = backup_config.max_backups;

    tokio::spawn(async move {
        use crate::scheduler::BackupScheduler;
        use tracing::{error, info};

        info!("Manual backup triggered");
        match BackupScheduler::perform_backup_static(
            &webdav_url,
            &webdav_username,
            &webdav_password,
            remote_path.as_deref(),
            max_backups,
        )
        .await
        {
            Ok(_) => info!("Manual backup completed successfully"),
            Err(e) => error!("Manual backup failed: {}", e),
        }
    });

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "备份任务已启动，正在后台执行"
    })))
}

pub async fn get_notification_webhook_config(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let config = state
        .config_service
        .get_notification_webhook_config()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(config))
}

pub async fn update_notification_webhook_config(
    State(state): State<Arc<AppState>>,
    Json(config): Json<NotificationWebhookConfig>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    state
        .config_service
        .update_notification_webhook_config(&config)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "success": true, "data": config })))
}

pub async fn test_notification_webhook(
    State(state): State<Arc<AppState>>,
    Json(config): Json<NotificationWebhookConfig>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let channel_config = NotificationChannelConfig {
        channel: "webhook".to_string(),
        enabled: config.enabled,
        webhook_url: config.webhook_url,
        secret: config.secret,
        task_events_enabled: config.task_events_enabled,
        system_events_enabled: config.system_events_enabled,
        remark: None,
        fields: serde_json::json!({}),
    };

    notifier::test_channel_notification(&channel_config)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("发送失败: {}", e)))?;

    let _ = state;
    Ok(Json(serde_json::json!({ "success": true, "message": "测试通知发送成功" })))
}

pub async fn list_notification_channel_configs(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let configs = state
        .config_service
        .list_notification_channel_configs()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(configs))
}

pub async fn get_notification_channel_config(
    State(state): State<Arc<AppState>>,
    Path(channel): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let config = state
        .config_service
        .get_notification_channel_config(&channel)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(config))
}

pub async fn update_notification_channel_config(
    State(state): State<Arc<AppState>>,
    Path(channel): Path<String>,
    Json(mut config): Json<NotificationChannelConfig>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    config.channel = channel;
    state
        .config_service
        .update_notification_channel_config(&config)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "success": true, "data": config })))
}

pub async fn test_notification_channel(
    State(state): State<Arc<AppState>>,
    Path(channel): Path<String>,
    Json(mut config): Json<NotificationChannelConfig>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    config.channel = channel;
    notifier::test_channel_notification(&config)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("发送失败: {}", e)))?;

    let _ = state;
    Ok(Json(serde_json::json!({ "success": true, "message": "测试通知发送成功" })))
}

pub async fn get_notification_event_bindings_config(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let config = state
        .config_service
        .get_notification_event_bindings_config()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(config))
}

pub async fn update_notification_event_bindings_config(
    State(state): State<Arc<AppState>>,
    Json(config): Json<NotificationEventBindingsConfig>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    state
        .config_service
        .update_notification_event_bindings_config(&config)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "success": true, "data": config })))
}

pub async fn get_notification_templates_config(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let config = state
        .config_service
        .get_notification_templates_config()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(config))
}

pub async fn update_notification_templates_config(
    State(state): State<Arc<AppState>>,
    Json(config): Json<NotificationTemplatesConfig>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    state
        .config_service
        .update_notification_templates_config(&config)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "success": true, "data": config })))
}

pub async fn get_notification_settings_config(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let config = state
        .config_service
        .get_notification_settings_config()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(config))
}

pub async fn update_notification_settings_config(
    State(state): State<Arc<AppState>>,
    Json(config): Json<NotificationSettingsConfig>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    state
        .config_service
        .update_notification_settings_config(&config)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "success": true, "data": config })))
}
