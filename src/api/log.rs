use crate::api::AppState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

#[derive(Deserialize)]
pub struct LogQuery {
    task_id: Option<i64>,
    #[serde(default = "default_page")]
    page: i64,
    #[serde(default = "default_page_size")]
    page_size: i64,
}

fn default_page() -> i64 {
    1
}

fn default_page_size() -> i64 {
    10
}

pub async fn list_logs(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LogQuery>,
) -> Result<impl IntoResponse, StatusCode> {
    let response = state.log_service
        .list(query.task_id, query.page, query.page_size)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(response))
}

pub async fn get_log(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, StatusCode> {
    let log = state.log_service
        .get(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(log))
}

pub async fn get_latest_log_by_task(
    State(state): State<Arc<AppState>>,
    Path(task_id): Path<i64>,
) -> Result<impl IntoResponse, StatusCode> {
    let log = state.log_service
        .get_latest_by_task(task_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(log))
}

pub async fn delete_old_logs(
    State(state): State<Arc<AppState>>,
    Path(days): Path<i64>,
) -> Result<impl IntoResponse, StatusCode> {
    let count = state.log_service
        .delete_old_logs(days)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({ "deleted": count })))
}

#[derive(Debug, Deserialize)]
pub struct DeleteLogsRequest {
    pub ids: Vec<i64>,
}

pub async fn delete_logs_by_ids(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<DeleteLogsRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    let deleted = state.log_service
        .delete_by_ids(&payload.ids)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({ "deleted": deleted })))
}
