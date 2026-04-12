use crate::api::AppState;
use crate::models::{CreateEnvVar, UpdateEnvVar};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

/// 获取环境变量列表
pub async fn list_env_vars(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, StatusCode> {
    let vars = state
        .env_service
        .list()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(vars))
}

/// 获取单个环境变量
pub async fn get_env_var(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, StatusCode> {
    let var = state
        .env_service
        .get(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(var))
}

/// 创建环境变量
pub async fn create_env_var(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateEnvVar>,
) -> Result<impl IntoResponse, StatusCode> {
    let var = state
        .env_service
        .create(payload)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok((StatusCode::CREATED, Json(var)))
}

/// 更新环境变量
pub async fn update_env_var(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(payload): Json<UpdateEnvVar>,
) -> Result<impl IntoResponse, StatusCode> {
    let var = state
        .env_service
        .update(id, payload)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(var))
}

/// 删除环境变量
pub async fn delete_env_var(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, StatusCode> {
    let deleted = state
        .env_service
        .delete(id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if !deleted {
        return Err(StatusCode::NOT_FOUND);
    }

    Ok(StatusCode::NO_CONTENT)
}
