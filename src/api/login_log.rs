use crate::api::AppState;
use crate::models::Claims;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Deserialize)]
pub struct LoginLogQuery {
    #[serde(default = "default_page")]
    pub page: i64,
    #[serde(default = "default_page_size")]
    pub page_size: i64,
}

fn default_page() -> i64 {
    1
}

fn default_page_size() -> i64 {
    20
}

#[derive(Debug, Serialize)]
pub struct LoginLogListResponse {
    pub data: Vec<crate::models::LoginLog>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

/// 获取登录日志列表
pub async fn list_login_logs(
    State(state): State<Arc<AppState>>,
    _claims: Claims,
    Query(query): Query<LoginLogQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let offset = (query.page - 1) * query.page_size;

    match state.login_log_service.list(query.page_size, offset).await {
        Ok(logs) => {
            match state.login_log_service.count().await {
                Ok(total) => {
                    let response = LoginLogListResponse {
                        data: logs,
                        total,
                        page: query.page,
                        page_size: query.page_size,
                    };
                    Ok(Json(response))
                }
                Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
            }
        }
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}
