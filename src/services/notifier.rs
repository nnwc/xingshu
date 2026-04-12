use crate::models::{NotificationChannelConfig, NotificationWebhookConfig, NotificationTemplateItem, Task};
use crate::services::ConfigService;
use anyhow::{anyhow, Result};
use base64::Engine;
use chrono::Utc;
use hmac::{Hmac, Mac};
use lettre::message::{header::ContentType, Mailbox, Message as MailMessage};
use lettre::{AsyncSmtpTransport, AsyncTransport, Tokio1Executor};
use reqwest::Client;
use serde::Serialize;
use sha2::Sha256;
use std::sync::Arc;
use tracing::{error, info};

#[derive(Debug, Clone, Serialize)]
pub struct WebhookEventPayload<T: Serialize> {
    pub event_type: String,
    pub category: String,
    pub timestamp: String,
    pub data: T,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskNotificationData {
    pub task_id: i64,
    pub task_name: String,
    pub status: String,
    pub duration_ms: i64,
    pub output_preview: String,
    pub output_summary: String,
}

pub fn should_send_task_notification(task: &Task, status: &str) -> bool {
    if !task.notify_enabled {
        return false;
    }

    let event_key = match status {
        "success" => "success",
        "failed" => "failed",
        "timeout" => "timeout",
        _ => return false,
    };

    task.notify_events
        .as_ref()
        .map(|events| events.iter().any(|item| item == event_key))
        .unwrap_or(false)
}

pub fn build_task_notification_data(task: &Task, status: &str, duration_ms: i64, output: &str) -> TaskNotificationData {
    let limit = task.notify_log_limit.unwrap_or(2000).max(0) as usize;
    let output_preview = if task.notify_attach_log {
        let mode = task.notify_log_mode.as_deref().unwrap_or("summary");
        if limit == 0 {
            String::new()
        } else if mode == "full" {
            output.chars().take(limit).collect()
        } else {
            build_output_summary(output, limit)
        }
    } else {
        String::new()
    };

    let output_summary = build_output_summary(output, 600);

    TaskNotificationData {
        task_id: task.id,
        task_name: task.name.clone(),
        status: status.to_string(),
        duration_ms,
        output_preview,
        output_summary,
    }
}

fn build_output_summary(output: &str, limit: usize) -> String {
    let interesting: Vec<&str> = output
        .lines()
        .filter(|line| {
            let lower = line.to_ascii_lowercase();
            lower.contains("error")
                || lower.contains("fail")
                || lower.contains("timeout")
                || lower.contains("warn")
                || lower.contains("success")
                || lower.contains("完成")
                || lower.contains("失败")
                || lower.contains("异常")
                || lower.contains("错误")
        })
        .collect();

    let source = if interesting.is_empty() {
        output.lines().take(12).collect::<Vec<_>>().join("\n")
    } else {
        interesting.into_iter().take(12).collect::<Vec<_>>().join("\n")
    };

    source.chars().take(limit.max(1)).collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct SubscriptionNotificationData {
    pub subscription_id: i64,
    pub subscription_name: String,
    pub status: String,
    pub log_preview: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupNotificationData {
    pub status: String,
    pub message: String,
}

fn parse_custom_headers(raw: &str) -> Vec<(String, String)> {
    raw.lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() { return None; }
            let (key, value) = trimmed.split_once(':')?;
            Some((key.trim().to_string(), value.trim().to_string()))
        })
        .collect()
}

async fn send_json_request(url: &str, headers: Vec<(&str, String)>, body: serde_json::Value) -> Result<()> {
    let client = Client::new();
    let mut request = client.post(url).header("Content-Type", "application/json");

    for (key, value) in headers {
        request = request.header(key, value);
    }

    let body_bytes = serde_json::to_vec(&body)?;
    let response = request.body(body_bytes).send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!("Push failed: {} {}", status, body);
    }

    Ok(())
}

async fn send_raw_request(url: &str, content_type: &str, headers: Vec<(String, String)>, body: String) -> Result<()> {
    let client = Client::new();
    let mut request = client.post(url).header("Content-Type", content_type);
    for (key, value) in headers {
        request = request.header(&key, value);
    }
    let response = request.body(body).send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!("Push failed: {} {}", status, body);
    }
    Ok(())
}

async fn send_form_request(url: &str, form: Vec<(&str, String)>) -> Result<()> {
    let client = Client::new();
    let response = client.post(url).form(&form).send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!("Push failed: {} {}", status, body);
    }
    Ok(())
}

async fn send_payload<T: Serialize>(config: &NotificationWebhookConfig, payload: &WebhookEventPayload<T>) -> Result<()> {
    if !config.enabled || config.webhook_url.trim().is_empty() {
        return Ok(());
    }

    let client = Client::new();
    let body = serde_json::to_vec(payload)?;
    let mut request = client
        .post(&config.webhook_url)
        .header("Content-Type", "application/json")
        .body(body);

    if let Some(secret) = &config.secret {
        if !secret.trim().is_empty() {
            request = request.header("X-Xingshu-Webhook-Secret", secret);
        }
    }

    let response = request.send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!("Webhook push failed: {} {}", status, body);
    }

    Ok(())
}

fn field_text(config: &NotificationChannelConfig, key: &str) -> String {
    config.fields.get(key).and_then(|v| v.as_str()).unwrap_or_default().to_string()
}

fn field_text_first(config: &NotificationChannelConfig, keys: &[&str]) -> String {
    for key in keys {
        let value = field_text(config, key);
        if !value.trim().is_empty() {
            return value;
        }
    }
    String::new()
}

fn field_bool(config: &NotificationChannelConfig, key: &str) -> bool {
    config.fields.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

fn field_bool_first(config: &NotificationChannelConfig, keys: &[&str]) -> bool {
    keys.iter().any(|key| field_bool(config, key))
}

fn validate_telegram_token(token: &str) -> Result<String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("Telegram 缺少 bot_token"));
    }
    if trimmed.contains('<') || trimmed.contains('>') || trimmed.eq_ignore_ascii_case("token") || trimmed.eq_ignore_ascii_case("<token>") {
        return Err(anyhow!("Telegram Bot Token 填写格式错误：不要带 < >，也不要填写占位符 token"));
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") || trimmed.contains("api.telegram.org") {
        return Err(anyhow!("Telegram Bot Token 只需要填写纯 token，不要填写完整 URL"));
    }
    if trimmed.starts_with("bot") {
        return Err(anyhow!("Telegram Bot Token 不要带 bot 前缀，只填纯 token 即可"));
    }
    if !trimmed.contains(':') {
        return Err(anyhow!("Telegram Bot Token 格式看起来不对，正常应类似 123456:ABCDEF..."));
    }
    Ok(trimmed.to_string())
}

fn validate_telegram_chat_id(chat_id: &str) -> Result<String> {
    let trimmed = chat_id.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("Telegram 缺少 chat_id"));
    }
    if trimmed.contains('<') || trimmed.contains('>') {
        return Err(anyhow!("Telegram Chat ID 不要带 < >，只填写纯 chat_id"));
    }
    Ok(trimmed.to_string())
}

async fn send_channel_message(config: &NotificationChannelConfig, title: &str, message: &str) -> Result<()> {
    match config.channel.as_str() {
        "webhook" => {
            if !config.enabled || config.webhook_url.trim().is_empty() {
                return Ok(());
            }
            let payload = serde_json::json!({
                "title": title,
                "message": message,
                "channel": config.channel,
                "timestamp": Utc::now().to_rfc3339(),
            });
            let wrap = WebhookEventPayload {
                event_type: "notification.test".to_string(),
                category: "system".to_string(),
                timestamp: Utc::now().to_rfc3339(),
                data: payload,
            };
            let mut headers: Vec<(String, String)> = parse_custom_headers(&field_text(config, "custom_headers"));
            if let Some(secret) = &config.secret {
                if !secret.trim().is_empty() {
                    headers.push(("X-Xingshu-Webhook-Secret".to_string(), secret.clone()));
                }
            }
            let content_type = {
                let t = field_text(config, "content_type");
                if t.is_empty() { "application/json".to_string() } else { t }
            };
            if content_type == "application/x-www-form-urlencoded" {
                let body = format!(
                    "title={}&message={}&channel={}&timestamp={}",
                    urlencoding::encode(title),
                    urlencoding::encode(message),
                    urlencoding::encode(&config.channel),
                    urlencoding::encode(&Utc::now().to_rfc3339())
                );
                send_raw_request(&config.webhook_url, &content_type, headers, body).await
            } else {
                send_raw_request(&config.webhook_url, &content_type, headers, serde_json::to_string(&wrap)?).await
            }
        }
        "telegram" => {
            let token = validate_telegram_token(&field_text_first(config, &["bot_token", "token"]))?;
            let chat_id = validate_telegram_chat_id(&field_text_first(config, &["chat_id"]))?;
            let api_host = field_text_first(config, &["api_host"]);
            let url = if api_host.is_empty() {
                format!("https://api.telegram.org/bot{}/sendMessage", token)
            } else {
                format!("{}/bot{}/sendMessage", api_host.trim_end_matches('/'), token)
            };
            let parse_mode = field_text(config, "parse_mode");
            let mut body = serde_json::json!({
                "chat_id": chat_id,
                "text": format!("{}\n\n{}", title, message),
                "disable_web_page_preview": field_bool_first(config, &["disable_preview", "disable_web_page_preview"]),
            });
            if !parse_mode.is_empty() && parse_mode != "None" {
                body["parse_mode"] = serde_json::Value::String(parse_mode);
            }
            send_json_request(&url, vec![], body).await
        }
        "bark" => {
            let device_key = field_text_first(config, &["device_key", "push_key"]);
            if device_key.is_empty() {
                return Err(anyhow!("Bark 缺少 device_key"));
            }
            let url = if device_key.starts_with("http://") || device_key.starts_with("https://") {
                device_key
            } else {
                format!("https://api.day.app/{}", device_key)
            };
            send_json_request(&url, vec![], serde_json::json!({
                "title": title,
                "body": message,
                "sound": field_text(config, "sound"),
                "icon": field_text(config, "icon"),
                "group": field_text(config, "group"),
                "url": field_text(config, "url"),
                "level": field_text(config, "level"),
                "isArchive": field_bool(config, "archive"),
            })).await
        }
        "ntfy" => {
            let topic = field_text(config, "topic");
            if topic.is_empty() {
                return Err(anyhow!("ntfy 缺少 topic"));
            }
            let server_url = {
                let raw = field_text_first(config, &["url"]);
                let raw = if raw.is_empty() { config.webhook_url.trim().to_string() } else { raw };
                let raw = raw.as_str();
                if raw.is_empty() || raw == "https://ntfy.sh/<topic>" { "https://ntfy.sh".to_string() } else { raw.trim_end_matches('/').to_string() }
            };
            let url = format!("{}/{}", server_url, topic);
            let mut headers = vec![("Title", title.to_string())];
            let token = field_text(config, "token");
            if !token.is_empty() {
                headers.push(("Authorization", format!("Bearer {}", token)));
            } else {
                let username = field_text(config, "username");
                let password = field_text(config, "password");
                if !username.is_empty() && !password.is_empty() {
                    let auth = base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", username, password));
                    headers.push(("Authorization", format!("Basic {}", auth)));
                }
            }
            let tags = field_text(config, "tags");
            if !tags.is_empty() {
                headers.push(("Tags", tags));
            }
            let icon = field_text(config, "icon");
            if !icon.is_empty() {
                headers.push(("Icon", icon));
            }
            let actions = field_text(config, "actions");
            if !actions.is_empty() {
                headers.push(("Actions", actions));
            }
            let priority = field_text(config, "priority");
            headers.push(("Priority", if priority.is_empty() { "3".to_string() } else { priority }));
            let client = Client::new();
            let mut request = client.post(&url).body(message.to_string());
            for (k, v) in headers {
                request = request.header(k, v);
            }
            let response = request.send().await?;
            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                anyhow::bail!("Push failed: {} {}", status, body);
            }
            Ok(())
        }
        "gotify" => {
            let server_url = field_text_first(config, &["server_url", "url"]);
            let app_token = field_text_first(config, &["app_token", "token"]);
            if server_url.is_empty() || app_token.is_empty() {
                return Err(anyhow!("Gotify 缺少 server_url 或 app_token"));
            }
            let url = format!("{}/message?token={}", server_url.trim_end_matches('/'), app_token);
            send_json_request(&url, vec![], serde_json::json!({
                "title": if field_text(config, "title_prefix").is_empty() { title.to_string() } else { format!("{} {}", field_text(config, "title_prefix"), title) },
                "message": message,
                "priority": field_text(config, "priority").parse::<i64>().unwrap_or(5),
            })).await
        }
        "wecom" => {
            let bot_key = field_text_first(config, &["bot_key", "access_token"]);
            if bot_key.is_empty() {
                return Err(anyhow!("企业微信缺少 bot_key"));
            }
            let url = format!("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key={}", bot_key);
            let msg_type = {
                let t = field_text(config, "msg_type");
                if t.is_empty() { "text".to_string() } else { t }
            };
            let body = if msg_type == "markdown" {
                serde_json::json!({
                    "msgtype": "markdown",
                    "markdown": { "content": format!("**{}**\n\n{}", title, message) }
                })
            } else {
                serde_json::json!({
                    "msgtype": "text",
                    "text": {
                        "content": format!("{}\n\n{}", title, message),
                        "mentioned_mobile_list": field_text(config, "mentioned_mobile_list").split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect::<Vec<_>>(),
                        "mentioned_list": field_text(config, "mentioned_list").split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect::<Vec<_>>()
                    }
                })
            };
            send_json_request(&url, vec![], body).await
        }
        "dingtalk" => {
            let access_token = field_text_first(config, &["access_token"]);
            if access_token.is_empty() {
                return Err(anyhow!("钉钉缺少 access_token"));
            }
            let mut url = format!("https://oapi.dingtalk.com/robot/send?access_token={}", access_token);
            let secret = field_text(config, "secret");
            if !secret.is_empty() {
                let timestamp = Utc::now().timestamp_millis().to_string();
                let string_to_sign = format!("{}\n{}", timestamp, secret);
                let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
                    .map_err(|e| anyhow!("钉钉 secret 初始化失败: {}", e))?;
                mac.update(string_to_sign.as_bytes());
                let sign_raw = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());
                let sign = urlencoding::encode(&sign_raw).into_owned();
                url = format!("{}&timestamp={}&sign={}", url, timestamp, sign);
            }
            let at_mobiles_raw = field_text(config, "at_mobiles");
            let at_mobiles = at_mobiles_raw
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>();
            let is_at_all = field_bool(config, "is_at_all");
            let msg_type = {
                let t = field_text(config, "msg_type");
                if t.is_empty() { "text".to_string() } else { t }
            };
            let body = if msg_type == "markdown" {
                serde_json::json!({
                    "msgtype": "markdown",
                    "markdown": {
                        "title": title,
                        "text": format!("## {}\n\n{}", title, message)
                    },
                    "at": {
                        "atMobiles": at_mobiles,
                        "isAtAll": is_at_all
                    }
                })
            } else {
                serde_json::json!({
                    "msgtype": "text",
                    "text": { "content": format!("{}\n\n{}", title, message) },
                    "at": {
                        "atMobiles": at_mobiles,
                        "isAtAll": is_at_all
                    }
                })
            };
            send_json_request(&url, vec![], body).await
        }
        "feishu" => {
            let hook_token = field_text_first(config, &["hook_token", "access_token"]);
            if hook_token.is_empty() {
                return Err(anyhow!("飞书缺少 hook_token"));
            }
            let url = format!("https://open.feishu.cn/open-apis/bot/v2/hook/{}", hook_token);
            let msg_type = {
                let t = field_text(config, "msg_type");
                if t.is_empty() { "text".to_string() } else { t }
            };
            let title_text = {
                let t = field_text(config, "title");
                if t.is_empty() { title.to_string() } else { t }
            };
            let mut headers: Vec<(&str, String)> = Vec::new();
            let tenant_key = field_text(config, "tenant_key");
            if !tenant_key.is_empty() {
                headers.push(("X-Lark-Tenant-Key", tenant_key));
            }
            let mut body = if msg_type == "post" {
                serde_json::json!({
                    "msg_type": "post",
                    "content": {
                        "post": {
                            "zh_cn": {
                                "title": title_text,
                                "content": [[
                                    {"tag":"text","text": format!("{}\n\n{}", title, message)}
                                ]]
                            }
                        }
                    }
                })
            } else if msg_type == "interactive" {
                serde_json::json!({
                    "msg_type": "interactive",
                    "card": {
                        "config": { "wide_screen_mode": true, "enable_forward": true },
                        "header": {
                            "template": "blue",
                            "title": { "tag": "plain_text", "content": title_text }
                        },
                        "elements": [
                            {
                                "tag": "div",
                                "text": { "tag": "lark_md", "content": format!("**{}**\n\n{}", title, message) }
                            },
                            {
                                "tag": "note",
                                "elements": [
                                    { "tag": "plain_text", "content": "来自星枢通知系统" }
                                ]
                            }
                        ]
                    }
                })
            } else {
                serde_json::json!({
                    "msg_type": "text",
                    "content": { "text": format!("{}\n\n{}", title, message) }
                })
            };
            let secret = field_text(config, "secret");
            if !secret.is_empty() {
                let timestamp = Utc::now().timestamp().to_string();
                let string_to_sign = format!("{}\n{}", timestamp, secret);
                let mac = Hmac::<Sha256>::new_from_slice(string_to_sign.as_bytes())
                    .map_err(|e| anyhow!("飞书 secret 初始化失败: {}", e))?;
                let sign = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());
                body["timestamp"] = serde_json::Value::String(timestamp);
                body["sign"] = serde_json::Value::String(sign);
            }
            send_json_request(&url, headers, body).await
        }
        "discord" => {
            let webhook_id = field_text_first(config, &["webhook_id"]);
            let webhook_token = field_text_first(config, &["webhook_token", "token"]);
            let direct_webhook = field_text_first(config, &["webhook_url", "url"]);
            let url = if !direct_webhook.is_empty() && direct_webhook.contains("/api/webhooks/") {
                direct_webhook
            } else {
                if webhook_id.is_empty() || webhook_token.is_empty() {
                    return Err(anyhow!("Discord 缺少 webhook_id 或 webhook_token"));
                }
                format!("https://discord.com/api/webhooks/{}/{}", webhook_id, webhook_token)
            };
            send_json_request(&url, vec![], serde_json::json!({
                "content": format!("**{}**\n\n{}", title, message),
                "username": field_text(config, "username"),
                "avatar_url": field_text(config, "avatar_url"),
            })).await
        }
        "slack" => {
            let direct_webhook = field_text_first(config, &["webhook_url", "url"]);
            let webhook_path = field_text(config, "webhook_path");
            let url = if !direct_webhook.is_empty() && direct_webhook.contains("hooks.slack.com/services/") {
                direct_webhook
            } else {
                if webhook_path.is_empty() {
                    return Err(anyhow!("Slack 缺少 webhook_path"));
                }
                format!("https://hooks.slack.com/services/{}", webhook_path.trim_start_matches('/'))
            };
            send_json_request(&url, vec![], serde_json::json!({
                "text": format!("*{}*\n\n{}", title, message),
                "channel": field_text(config, "channel"),
                "username": field_text(config, "username"),
                "icon_emoji": field_text(config, "icon_emoji"),
            })).await
        }
        "serverchan" => {
            let sendkey = field_text_first(config, &["sendkey", "SendKey"]);
            if sendkey.is_empty() {
                return Err(anyhow!("Server酱缺少 sendkey"));
            }
            let url = format!("https://sctapi.ftqq.com/{}.send", sendkey);
            send_form_request(&url, vec![
                ("title", title.to_string()),
                ("desp", message.to_string()),
                ("channel", field_text(config, "channel")),
                ("openid", field_text(config, "openid")),
                ("short", if field_bool(config, "short") { "1".to_string() } else { "0".to_string() }),
            ]).await
        }
        "pushplus" => {
            let token = field_text_first(config, &["token"]);
            if token.is_empty() {
                return Err(anyhow!("PushPlus 缺少 token"));
            }
            let url = "https://www.pushplus.plus/send";
            let template = {
                let t = field_text(config, "template");
                if t.is_empty() { "markdown".to_string() } else { t }
            };
            send_json_request(url, vec![], serde_json::json!({
                "token": token,
                "title": title,
                "content": message,
                "template": template,
                "topic": field_text(config, "topic"),
                "channel": field_text(config, "channel"),
                "webhook": field_text(config, "webhook"),
                "callbackUrl": field_text_first(config, &["callback_url", "callbackUrl"]),
                "to": field_text(config, "to"),
            })).await
        }
        "email" => {
            let smtp_host = field_text_first(config, &["smtp_host", "server"]);
            let smtp_port = field_text_first(config, &["smtp_port", "port"]).parse::<u16>().unwrap_or(465);
            let username = field_text_first(config, &["username", "account"]);
            let password = field_text_first(config, &["password", "passwd"]);
            let to = field_text_first(config, &["to", "to_account"]);
            if smtp_host.is_empty() || username.is_empty() || password.is_empty() || to.is_empty() {
                return Err(anyhow!("Email 缺少 smtp_host / username / password / to"));
            }
            let from_raw = field_text(config, "from");
            let from_name = field_text(config, "from_name");
            let from_addr = if from_raw.trim().is_empty() { username.clone() } else { from_raw };
            let from_mailbox = if !from_name.trim().is_empty() {
                let email_addr = from_addr.parse().or_else(|_| username.parse()).map_err(|e| anyhow!("Email 发件人格式错误: {}", e))?;
                Mailbox::new(Some(from_name), email_addr)
            } else {
                from_addr.parse().or_else(|_| username.parse()).map_err(|e| anyhow!("Email 发件人格式错误: {}", e))?
            };
            let recipients: Vec<Mailbox> = to
                .split(',')
                .map(|item| item.trim())
                .filter(|item| !item.is_empty())
                .map(|item| item.parse::<Mailbox>().map_err(|e| anyhow!("Email 收件人格式错误 {}: {}", item, e)))
                .collect::<Result<Vec<_>>>()?;
            let mut builder = MailMessage::builder().from(from_mailbox).subject(title);
            for recipient in recipients {
                builder = builder.to(recipient);
            }
            let email = builder
                .header(ContentType::TEXT_PLAIN)
                .body(message.to_string())
                .map_err(|e| anyhow!("Email 构造失败: {}", e))?;
            let mailer = if field_bool(config, "tls") {
                AsyncSmtpTransport::<Tokio1Executor>::relay(&smtp_host)
                    .map_err(|e| anyhow!("SMTP relay 初始化失败: {}", e))?
                    .port(smtp_port)
                    .credentials(lettre::transport::smtp::authentication::Credentials::new(username, password))
                    .build()
            } else {
                AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&smtp_host)
                    .port(smtp_port)
                    .credentials(lettre::transport::smtp::authentication::Credentials::new(username, password))
                    .build()
            };
            mailer.send(email).await.map_err(|e| anyhow!("Email 发送失败: {}", e))?;
            Ok(())
        }
        other => Err(anyhow!("暂不支持的渠道: {}", other)),
    }
}

pub async fn test_channel_notification(config: &NotificationChannelConfig) -> Result<()> {
    send_channel_message(config, "星枢测试通知", "这是一条来自星枢的测试通知。当前渠道测试已触发。").await
}

fn render_template_text(template: &str, vars: &[(&str, String)]) -> String {
    let mut rendered = template.to_string();
    for (key, value) in vars {
        rendered = rendered.replace(&format!("{{{{{}}}}}", key), value);
    }
    rendered
}

fn find_template<'a>(templates: &'a [NotificationTemplateItem], key: &str) -> Option<&'a NotificationTemplateItem> {
    templates.iter().find(|item| item.key == key)
}

async fn resolve_default_channel(config_service: &Arc<ConfigService>) -> Option<String> {
    match config_service.get_notification_settings_config().await {
        Ok(settings) if !settings.default_channel.trim().is_empty() => Some(settings.default_channel),
        Ok(_) => Some("webhook".to_string()),
        Err(e) => {
            error!("Failed to load notification settings: {}", e);
            Some("webhook".to_string())
        }
    }
}

async fn send_event_message(
    config_service: Arc<ConfigService>,
    event_key: &str,
    template_key: &str,
    vars: Vec<(&str, String)>,
    fallback_title: &str,
    fallback_body: &str,
) {
    let bindings = match config_service.get_notification_event_bindings_config().await {
        Ok(config) => config,
        Err(e) => {
            error!("Failed to load notification event bindings: {}", e);
            return;
        }
    };

    let target_channel = if let Some(binding) = bindings.bindings.iter().find(|item| item.event_key == event_key && item.enabled) {
        binding.channel.clone()
    } else if let Some(channel) = resolve_default_channel(&config_service).await {
        channel
    } else {
        return;
    };

    let channel_config = match config_service.get_notification_channel_config(&target_channel).await {
        Ok(config) => config,
        Err(e) => {
            error!("Failed to load notification channel config {}: {}", target_channel, e);
            return;
        }
    };

    if !channel_config.enabled {
        return;
    }

    let templates = match config_service.get_notification_templates_config().await {
        Ok(config) => config,
        Err(e) => {
            error!("Failed to load notification templates: {}", e);
            return;
        }
    };

    let output_preview = vars
        .iter()
        .find(|(key, _)| *key == "output_preview")
        .map(|(_, value)| value.as_str())
        .unwrap_or("");

    let (title, body) = if let Some(template) = find_template(&templates.templates, template_key) {
        let rendered_body = render_template_text(&template.body_template, &vars);
        let body = if template_key == "task" {
            append_task_output_preview_if_needed(rendered_body, output_preview)
        } else {
            rendered_body
        };
        (
            render_template_text(&template.title_template, &vars),
            body,
        )
    } else {
        (fallback_title.to_string(), fallback_body.to_string())
    };

    if let Err(e) = send_channel_message(&channel_config, &title, &body).await {
        error!("Failed to send {} notification via {}: {}", event_key, target_channel, e);
    } else {
        info!("{} notification sent via {}", event_key, target_channel);
    }
}

fn append_task_output_preview_if_needed(body: String, output_preview: &str) -> String {
    let preview = output_preview.trim();
    if preview.is_empty() || body.contains(preview) {
        return body;
    }

    format!("{}\n\n日志片段:\n{}", body.trim_end(), preview)
}

async fn send_task_notification_to_channel(
    config_service: Arc<ConfigService>,
    channel_name: &str,
    vars: Vec<(&str, String)>,
    fallback_title: &str,
    fallback_body: &str,
) {
    let channel_config = match config_service.get_notification_channel_config(channel_name).await {
        Ok(config) => config,
        Err(e) => {
            error!("Failed to load task notification channel config {}: {}", channel_name, e);
            return;
        }
    };

    if !channel_config.enabled {
        return;
    }

    let templates = match config_service.get_notification_templates_config().await {
        Ok(config) => config,
        Err(e) => {
            error!("Failed to load notification templates: {}", e);
            return;
        }
    };

    let output_preview = vars
        .iter()
        .find(|(key, _)| *key == "output_preview")
        .map(|(_, value)| value.as_str())
        .unwrap_or("");

    let (title, body) = if let Some(template) = find_template(&templates.templates, "task") {
        let rendered_body = render_template_text(&template.body_template, &vars);
        (
            render_template_text(&template.title_template, &vars),
            append_task_output_preview_if_needed(rendered_body, output_preview),
        )
    } else {
        (fallback_title.to_string(), fallback_body.to_string())
    };

    if let Err(e) = send_channel_message(&channel_config, &title, &body).await {
        error!("Failed to send task notification via {}: {}", channel_name, e);
    } else {
        info!("task notification sent via {}", channel_name);
    }
}

pub async fn send_task_notification(config_service: Arc<ConfigService>, task_channel: Option<String>, data: TaskNotificationData) {
    let status_text = match data.status.as_str() {
        "success" => "执行成功",
        "failed" => "执行失败",
        "timeout" => "执行超时",
        _ => "状态更新",
    };
    let event_key = match data.status.as_str() {
        "success" => "task_success",
        "failed" => "task_failed",
        "timeout" => "task_timeout",
        _ => return,
    };
    let vars = vec![
        ("task_name", data.task_name.clone()),
        ("status", data.status.clone()),
        ("status_text", status_text.to_string()),
        ("duration_ms", data.duration_ms.to_string()),
        ("finished_at", Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()),
        ("output_preview", data.output_preview.clone()),
        ("output_summary", data.output_summary.clone()),
    ];
    let fallback_title = format!("任务 {} {}", data.task_name, status_text);
    let fallback_body = if data.output_preview.trim().is_empty() {
        format!("执行状态:{}\n耗时:{}ms", data.status, data.duration_ms)
    } else {
        format!("执行状态:{}\n耗时:{}ms\n日志片段:\n{}", data.status, data.duration_ms, data.output_preview)
    };

    if let Some(channel_name) = task_channel.filter(|item| !item.trim().is_empty()) {
        send_task_notification_to_channel(config_service, &channel_name, vars, &fallback_title, &fallback_body).await;
    } else {
        send_event_message(config_service, event_key, "task", vars, &fallback_title, &fallback_body).await;
    }
}

pub async fn send_subscription_notification(config_service: Arc<ConfigService>, data: SubscriptionNotificationData) {
    let status_text = if data.status == "success" { "更新成功" } else { "更新失败" };
    let event_key = if data.status == "success" { "subscription_success" } else { "subscription_failed" };
    let vars = vec![
        ("subscription_name", data.subscription_name.clone()),
        ("status_text", status_text.to_string()),
        ("source", "Git Repository".to_string()),
        ("message", if data.log_preview.is_empty() { data.status.clone() } else { data.log_preview.clone() }),
    ];
    let fallback_title = format!("订阅 {} {}", data.subscription_name, status_text);
    let fallback_body = if data.log_preview.is_empty() { data.status.clone() } else { data.log_preview.clone() };
    send_event_message(config_service, event_key, "subscription", vars, &fallback_title, &fallback_body).await;
}

pub async fn send_backup_notification(config_service: Arc<ConfigService>, data: BackupNotificationData) {
    let event_key = if data.status == "success" { "backup_success" } else { "backup_failed" };
    let vars = vec![
        ("subscription_name", "系统备份".to_string()),
        ("status_text", if data.status == "success" { "执行成功".to_string() } else { "执行失败".to_string() }),
        ("source", "Backup".to_string()),
        ("message", data.message.clone()),
    ];
    let fallback_title = format!("备份{}", if data.status == "success" { "成功" } else { "失败" });
    let fallback_body = data.message.clone();
    send_event_message(config_service, event_key, "subscription", vars, &fallback_title, &fallback_body).await;
}
