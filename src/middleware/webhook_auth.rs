use axum::{
    extract::Request,
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::IntoResponse,
    Json,
};
use serde_json::json;

pub async fn webhook_auth_middleware(
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> Result<impl IntoResponse, impl IntoResponse> {
    let webhook_token = std::env::var("WEBHOOK_TOKEN").ok();

    if webhook_token.is_none() {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Webhook token not configured",
                "message": "WEBHOOK_TOKEN environment variable is not set"
            })),
        ));
    }

    // 支持两种格式：
    // 1. Authorization: Bearer <token>
    // 2. X-Webhook-Token: <token>
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .or_else(|| {
            headers
                .get("X-Webhook-Token")
                .and_then(|v| v.to_str().ok())
        });

    match token {
        Some(t) if Some(t.to_string()) == webhook_token => Ok(next.run(request).await),
        _ => Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "error": "Unauthorized",
                "message": "Invalid or missing webhook token"
            })),
        )),
    }
}
