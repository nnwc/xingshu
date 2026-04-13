use regex::Regex;
use crate::models::Task;
use crate::services::{EnvService, ConfigService};
use crate::utils::python_detector::PYTHON_CMD;
use anyhow::{anyhow, Result};
use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{broadcast, RwLock};
use futures::future::join_all;
use tracing::{debug, error, info};
use uuid::Uuid;

/// 辅助结构体：处理 \r 和 \n 作为行分隔符的读取器
struct LineReader<R> {
    reader: BufReader<R>,
    buffer: Vec<u8>,
}

impl<R: AsyncReadExt + Unpin> LineReader<R> {
    fn new(reader: R) -> Self {
        Self {
            reader: BufReader::new(reader),
            buffer: Vec::new(),
        }
    }

    async fn next_line(&mut self) -> std::io::Result<Option<String>> {
        self.buffer.clear();

        loop {
            let mut byte = [0u8; 1];
            match self.reader.read(&mut byte).await? {
                0 => {
                    // EOF
                    if self.buffer.is_empty() {
                        return Ok(None);
                    } else {
                        let line = String::from_utf8_lossy(&self.buffer).to_string();
                        self.buffer.clear();
                        return Ok(Some(line));
                    }
                }
                _ => {
                    match byte[0] {
                        b'\n' | b'\r' => {
                            // 遇到 \n 或 \r，返回当前行
                            if !self.buffer.is_empty() {
                                let line = String::from_utf8_lossy(&self.buffer).to_string();
                                self.buffer.clear();
                                return Ok(Some(line));
                            }
                            // 如果 buffer 为空，继续读取下一个字符
                        }
                        _ => {
                            self.buffer.push(byte[0]);
                        }
                    }
                }
            }
        }
    }
}

#[derive(Clone, Serialize)]
pub struct ExecutionInfo {
    pub execution_id: String,
    pub task_id: i64,
    pub task_name: String,
    pub pid: Option<u32>,
    pub started_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunningTasksUpdate {
    pub running_ids: Vec<i64>,
    pub changed_task_id: i64,
    pub change_type: String, // "started" or "finished"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_data: Option<serde_json::Value>, // 任务结束时包含更新后的任务数据
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<chrono::DateTime<chrono::Utc>>, // 任务执行时间
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run_duration: Option<i64>, // 任务执行耗时（毫秒）
}

pub struct Executor {
    env_service: Arc<EnvService>,
    config_service: Arc<ConfigService>,
    running_tasks: Arc<RwLock<HashMap<i64, Vec<u32>>>>, // task_id -> PIDs
    log_channels: Arc<RwLock<HashMap<String, broadcast::Sender<String>>>>, // execution_id -> log channel
    log_buffers: Arc<RwLock<HashMap<String, Vec<String>>>>, // execution_id -> log buffer
    executions: Arc<RwLock<HashMap<String, ExecutionInfo>>>, // execution_id -> execution info
    running_tasks_notifier: broadcast::Sender<RunningTasksUpdate>, // 运行任务状态变化通知
}

impl Executor {
    pub fn new(env_service: Arc<EnvService>, config_service: Arc<ConfigService>) -> Self {
        let (tx, _) = broadcast::channel(100);
        Self {
            env_service,
            config_service,
            running_tasks: Arc::new(RwLock::new(HashMap::new())),
            log_channels: Arc::new(RwLock::new(HashMap::new())),
            log_buffers: Arc::new(RwLock::new(HashMap::new())),
            executions: Arc::new(RwLock::new(HashMap::new())),
            running_tasks_notifier: tx,
        }
    }

    /// 根据任务获取工作目录
    fn get_working_directory(&self, task: &Task) -> std::path::PathBuf {
        let project_root = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let scripts_dir = project_root.join("data/scripts");

        // 如果任务设置了自定义工作目录
        if let Some(working_dir) = &task.working_dir {
            let working_dir = working_dir.trim();
            if !working_dir.is_empty() {
                let path = std::path::Path::new(working_dir);
                // 如果是绝对路径，直接使用
                if path.is_absolute() {
                    return path.to_path_buf();
                } else {
                    // 相对路径，以 scripts 目录为基准
                    return scripts_dir.join(path);
                }
            }
        }

        // 没有设置工作目录，使用原有逻辑
        self.get_working_directory_from_command(&task.command)
    }

    /// 根据命令获取工作目录（用于 debug 执行等没有 task 对象的场景）
    fn get_working_directory_from_command(&self, command: &str) -> std::path::PathBuf {
        let project_root = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let scripts_dir = project_root.join("data/scripts");

        debug!("get_working_directory_from_command - command: {}", command);

        // 检查是否是单行命令
        if command.lines().count() != 1 {
            debug!("Multi-line command, using scripts_dir");
            return scripts_dir;
        }

        // 解析命令，提取脚本路径
        let parts: Vec<&str> = command.trim().split_whitespace().collect();
        debug!("Command parts: {:?}", parts);

        if parts.is_empty() {
            debug!("Empty command, using scripts_dir");
            return scripts_dir;
        }

        // 查找脚本文件（从第一个参数开始查找，因为可能直接是脚本路径）
        let script_path = parts.iter().find(|part| {
            part.ends_with(".py") || part.ends_with(".js") || part.ends_with(".sh")
        });

        debug!("Found script_path: {:?}", script_path);

        if let Some(script) = script_path {
            let script_path = std::path::Path::new(script);

            // 如果是绝对路径，返回脚本所在目录
            if script_path.is_absolute() {
                if let Some(parent) = script_path.parent() {
                    debug!("Absolute path, parent: {:?}", parent);
                    return parent.to_path_buf();
                }
            } else {
                // 相对路径，以 scripts 为基础
                let full_path = scripts_dir.join(script_path);
                debug!("Relative path, full_path: {:?}", full_path);
                if let Some(parent) = full_path.parent() {
                    debug!("Returning parent: {:?}", parent);
                    return parent.to_path_buf();
                }
            }
        }

        debug!("No script found, using scripts_dir");
        scripts_dir
    }

    fn adjust_command_for_working_dir(&self, command: &str, working_dir: &std::path::Path) -> String {
        let project_root = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let scripts_dir = project_root.join("data/scripts");

        debug!("adjust_command_for_working_dir - command: {}, working_dir: {:?}, scripts_dir: {:?}", command, working_dir, scripts_dir);

        // 检查是否是单行命令
        if command.lines().count() != 1 {
            debug!("Multi-line command, no adjustment");
            return command.to_string();
        }

        // 解析命令
        let parts: Vec<&str> = command.trim().split_whitespace().collect();
        if parts.is_empty() {
            debug!("Empty command, no adjustment");
            return command.to_string();
        }

        // 查找脚本文件并调整路径（从第一个参数开始，因为可能直接是脚本路径）
        let mut adjusted_parts: Vec<String> = parts.iter().map(|s| s.to_string()).collect();
        let mut found_script = false;
        let mut is_python_script = false;
        let mut script_index = 0;

        for (i, part) in parts.iter().enumerate() {
            if part.ends_with(".py") || part.ends_with(".js") || part.ends_with(".sh") {
                let script_path = std::path::Path::new(part);
                debug!("Found script at index {}: {}, is_absolute: {}", i, part, script_path.is_absolute());
                found_script = true;
                is_python_script = part.ends_with(".py");
                script_index = i;

                if !script_path.is_absolute() {
                    // 相对路径
                    if working_dir == scripts_dir {
                        // 工作目录是 scripts，不需要调整路径，但如果是第一个参数（直接执行）需要添加 ./
                        if i == 0 {
                            if !part.starts_with("./") {
                                let adjusted = format!("./{}", part);
                                debug!("Adding ./ prefix: {} to {}", part, adjusted);
                                adjusted_parts[i] = adjusted;
                            }
                        }
                    } else {
                        // 工作目录不是 scripts，需要提取文件名
                        if let Some(file_name) = script_path.file_name() {
                            if let Some(name_str) = file_name.to_str() {
                                // 如果是第一个参数（没有执行器），添加 ./
                                let adjusted = if i == 0 {
                                    if name_str.starts_with("./") {
                                        name_str.to_string()
                                    } else {
                                        format!("./{}", name_str)
                                    }
                                } else {
                                    name_str.to_string()
                                };
                                debug!("Adjusting {} to {}", part, adjusted);
                                adjusted_parts[i] = adjusted;
                            }
                        }
                    }
                }
                break;
            }
        }

        // 如果是Python脚本，确保使用 python -u 执行
        if is_python_script {
            let has_python_cmd = adjusted_parts.iter().any(|p|
                p == "python" || p == "python3" || p.ends_with("/python") || p.ends_with("/python3")
            );

            if !has_python_cmd && script_index == 0 {
                // 脚本是第一个参数（直接执行），转换为 python -u script.py [args...]
                let script_path = adjusted_parts[0].clone();
                let remaining_args: Vec<String> = adjusted_parts.iter().skip(1).cloned().collect();
                adjusted_parts.clear();
                adjusted_parts.push(PYTHON_CMD.as_str().to_string());
                adjusted_parts.push("-u".to_string());
                adjusted_parts.push(script_path);
                adjusted_parts.extend(remaining_args);
                debug!("Converted direct Python script execution to: {} -u", PYTHON_CMD.as_str());
            } else if has_python_cmd {
                // 命令中已有python，添加-u参数
                for (i, part) in adjusted_parts.clone().iter().enumerate() {
                    if part == "python" || part == "python3" || part.ends_with("/python") || part.ends_with("/python3") {
                        if i + 1 < adjusted_parts.len() && adjusted_parts[i + 1] != "-u" {
                            adjusted_parts.insert(i + 1, "-u".to_string());
                            debug!("Added -u flag to python command");
                        }
                        break;
                    }
                }
            }
        }

        let result = adjusted_parts.join(" ");
        debug!("Adjusted command result: {}", result);
        result
    }

    /// 确保脚本文件有执行权限
    async fn ensure_script_executable(&self, command: &str, working_dir: &std::path::Path) {
        // 解析命令，提取脚本路径
        let parts: Vec<&str> = command.trim().split_whitespace().collect();
        if parts.is_empty() {
            return;
        }

        // 查找脚本文件（从第一个参数开始）
        let script_path = parts.iter().find(|part| {
            part.ends_with(".py") || part.ends_with(".js") || part.ends_with(".sh")
        });

        if let Some(script) = script_path {
            let script_path = std::path::Path::new(script);

            // 构建完整路径
            let full_path = if script_path.is_absolute() {
                script_path.to_path_buf()
            } else {
                // 相对路径，基于工作目录
                working_dir.join(script_path.file_name().unwrap_or(script_path.as_os_str()))
            };

            // 添加执行权限
            if full_path.exists() {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if let Ok(metadata) = tokio::fs::metadata(&full_path).await {
                        let mut perms = metadata.permissions();
                        let mode = perms.mode();
                        perms.set_mode(mode | 0o111); // 添加执行权限
                        let _ = tokio::fs::set_permissions(&full_path, perms).await;
                        debug!("Set executable permission for: {:?}", full_path);
                    }
                }
            }
        }
    }

    async fn append_runtime_log(
        &self,
        execution_id: &str,
        tx: &broadcast::Sender<String>,
        output: &mut String,
        log: String,
    ) {
        self.send_and_cache_log(execution_id, tx, log.clone()).await;
        output.push_str(&log);
        output.push('\n');
    }

    async fn maybe_switch_microwarp_ip(
        &self,
        task: &Task,
        tx: &broadcast::Sender<String>,
        execution_id: &str,
        output: &mut String,
    ) -> Result<()> {
        if !task.use_microwarp.unwrap_or(false) {
            return Ok(());
        }

        let config = self.config_service.get_microwarp_config().await?;
        if !config.enabled {
            self.append_runtime_log(
                execution_id,
                tx,
                output,
                "[MICROWARP] 已跳过：系统未启用 MicroWARP".to_string(),
            ).await;
            return Ok(());
        }

        match self.config_service.get_microwarp_exit_ip().await {
            Ok(ip) if !ip.is_empty() => {
                self.append_runtime_log(
                    execution_id,
                    tx,
                    output,
                    format!("[MICROWARP] 当前出口 IP: {}", ip),
                ).await;
            }
            Ok(_) => {
                self.append_runtime_log(
                    execution_id,
                    tx,
                    output,
                    "[MICROWARP] 当前出口 IP: 未获取到结果".to_string(),
                ).await;
            }
            Err(e) => {
                self.append_runtime_log(
                    execution_id,
                    tx,
                    output,
                    format!("[MICROWARP] 当前出口 IP 获取失败: {}", e),
                ).await;
            }
        }

        if !task.microwarp_switch_ip_on_run.unwrap_or(false) {
            return Ok(());
        }

        let run_mode = task.account_run_mode.clone().unwrap_or_else(|| "single".to_string());
        if run_mode == "concurrent" {
            self.append_runtime_log(
                execution_id,
                tx,
                output,
                "[MICROWARP] 已跳过：并发账号模式暂不支持按账号切换 IP".to_string(),
            ).await;
            return Ok(());
        }

        let before_ip = self.config_service.get_microwarp_exit_ip().await.ok();
        if let Some(ip) = before_ip.as_ref().filter(|v| !v.is_empty()) {
            self.append_runtime_log(
                execution_id,
                tx,
                output,
                format!("[MICROWARP] 切换前 IP: {}", ip),
            ).await;
        }

        self.append_runtime_log(
            execution_id,
            tx,
            output,
            "[MICROWARP] 正在切换 IP...".to_string(),
        ).await;
        let result = self.config_service.switch_microwarp_ip().await?;
        self.append_runtime_log(
            execution_id,
            tx,
            output,
            format!("[MICROWARP] {}", result.trim()),
        ).await;

        match self.config_service.get_microwarp_exit_ip().await {
            Ok(ip) if !ip.is_empty() => {
                self.append_runtime_log(
                    execution_id,
                    tx,
                    output,
                    format!("[MICROWARP] 切换后 IP: {}", ip),
                ).await;
            }
            Ok(_) => {
                self.append_runtime_log(
                    execution_id,
                    tx,
                    output,
                    "[MICROWARP] 切换后 IP: 未获取到结果".to_string(),
                ).await;
            }
            Err(e) => {
                self.append_runtime_log(
                    execution_id,
                    tx,
                    output,
                    format!("[MICROWARP] 切换后 IP 获取失败: {}", e),
                ).await;
            }
        }
        Ok(())
    }

    /// 执行任务并返回 (execution_id, output, success)
    pub async fn execute(&self, task: &Task) -> Result<(String, String, bool)> {
        let execution_id = Uuid::new_v4().to_string();
        let start_time = std::time::Instant::now();
        debug!("Executing task: {} ({}) with execution_id: {}", task.name, task.command, execution_id);

        // 创建广播通道和日志缓存
        let (tx, _) = broadcast::channel(100);
        self.log_channels.write().await.insert(execution_id.clone(), tx.clone());
        self.log_buffers.write().await.insert(execution_id.clone(), Vec::new());

        // 记录执行信息
        let exec_info = ExecutionInfo {
            execution_id: execution_id.clone(),
            task_id: task.id,
            task_name: task.name.clone(),
            pid: None,
            started_at: chrono::Utc::now(),
        };
        self.executions.write().await.insert(execution_id.clone(), exec_info);

        // 解析环境变量
        let env_vars = self.parse_env().await;

        // 获取工作目录（提前计算，供前置、主命令、后置命令使用）
        let working_dir = self.get_working_directory(&task);

        // 确保工作目录存在
        if !working_dir.exists() {
            tokio::fs::create_dir_all(&working_dir).await?;
        }

        debug!("Working directory: {:?}", working_dir);

        let mut output = String::new();
        let mut overall_success = true;

        if let Err(e) = self
            .maybe_switch_microwarp_ip(task, &tx, &execution_id, &mut output)
            .await
        {
            let msg = format!("[MICROWARP] 切换 IP 失败: {}", e);
            self.append_runtime_log(&execution_id, &tx, &mut output, msg).await;
            self.log_channels.write().await.remove(&execution_id);
            self.log_buffers.write().await.remove(&execution_id);
            self.executions.write().await.remove(&execution_id);
            return Ok((execution_id, output, false));
        }

        // 执行前置命令
        if let Some(pre_cmd) = &task.pre_command {
            if !pre_cmd.trim().is_empty() {
                debug!("Executing pre-command: {}", pre_cmd);
                let _ = tx.send(format!("[PRE] Executing: {}", pre_cmd));

                match self.execute_command(pre_cmd, &env_vars, &tx, &working_dir).await {
                    Ok((cmd_output, success)) => {
                        output.push_str(&cmd_output);
                        if !success {
                            overall_success = false;
                            let msg = "[PRE] Pre-command failed, stopping execution".to_string();
                            let _ = tx.send(msg.clone());
                            output.push_str(&msg);
                            output.push('\n');

                            self.log_channels.write().await.remove(&execution_id);
                            self.log_buffers.write().await.remove(&execution_id);
                            self.executions.write().await.remove(&execution_id);
                            return Ok((execution_id, output, false));
                        }
                    }
                    Err(e) => {
                        overall_success = false;
                        let msg = format!("[PRE] Pre-command error: {}", e);
                        let _ = tx.send(msg.clone());
                        output.push_str(&msg);
                        output.push('\n');

                        self.log_channels.write().await.remove(&execution_id);
                        self.log_buffers.write().await.remove(&execution_id);
                        self.executions.write().await.remove(&execution_id);
                        return Ok((execution_id, output, false));
                    }
                }
            }
        }

        // 执行主命令
        debug!("Executing main command: {}", task.command);
        let _ = tx.send(format!("[MAIN] Executing: {}", task.command));

        if let Some((mode, env_key, concurrency, accounts)) = self.resolve_account_run_plan(task, &env_vars).await {
            let _ = tx.send(format!("[ACCOUNT] mode={}, env_key={}, total_accounts={}, concurrency={}", mode, env_key, accounts.len(), concurrency));

            if mode == "sequential" {
                for (index, account) in accounts.iter().enumerate() {
                    let _ = tx.send(format!("[ACCOUNT {}/{}] Running sequential instance", index + 1, accounts.len()));
                    if task.use_microwarp.unwrap_or(false) && task.microwarp_switch_ip_on_run.unwrap_or(false) {
                        self.append_runtime_log(
                            &execution_id,
                            &tx,
                            &mut output,
                            format!("[MICROWARP] 账号 {}/{} 执行前切换 IP", index + 1, accounts.len()),
                        ).await;
                        if let Err(e) = self.maybe_switch_microwarp_ip(task, &tx, &execution_id, &mut output).await {
                            let msg = format!("[MICROWARP] 切换 IP 失败: {}", e);
                            self.append_runtime_log(&execution_id, &tx, &mut output, msg).await;
                            overall_success = false;
                            continue;
                        }
                    }
                    let mut account_env = env_vars.clone();
                    account_env.insert(env_key.clone(), account.clone());
                    let (cmd_output, success) = self
                        .execute_tracked_command(task, &task.command, &account_env, &tx, &working_dir, &execution_id)
                        .await?;
                    output.push_str(&cmd_output);
                    if !success {
                        overall_success = false;
                    }
                }
            } else {
                for (batch_index, chunk) in accounts.chunks(concurrency.max(1)).enumerate() {
                    let _ = tx.send(format!("[ACCOUNT BATCH {}] Starting {} accounts", batch_index + 1, chunk.len()));
                    let futures = chunk.iter().map(|account| {
                        let mut account_env = env_vars.clone();
                        account_env.insert(env_key.clone(), account.clone());
                        let tx = tx.clone();
                        let working_dir = working_dir.clone();
                        let execution_id = execution_id.clone();
                        async move {
                            self.execute_tracked_command(task, &task.command, &account_env, &tx, &working_dir, &execution_id).await
                        }
                    });
                    let results = join_all(futures).await;
                    for result in results {
                        let (cmd_output, success) = result?;
                        output.push_str(&cmd_output);
                        if !success {
                            overall_success = false;
                        }
                    }
                }
            }
        } else {
            let (cmd_output, success) = self
                .execute_tracked_command(task, &task.command, &env_vars, &tx, &working_dir, &execution_id)
                .await?;
            output.push_str(&cmd_output);
            if !success {
                overall_success = false;
            }
        }

        // 执行后置命令（无论主命令成功与否都执行，用于清理工作）
        if let Some(post_cmd) = &task.post_command {
            if !post_cmd.trim().is_empty() {
                debug!("Executing post-command: {}", post_cmd);
                let _ = tx.send(format!("[POST] Executing: {}", post_cmd));

                match self.execute_command(post_cmd, &env_vars, &tx, &working_dir).await {
                    Ok((cmd_output, success)) => {
                        output.push_str(&cmd_output);
                        if !success {
                            overall_success = false;
                        }
                    }
                    Err(e) => {
                        overall_success = false;
                        let msg = format!("[POST] Post-command error: {}", e);
                        let _ = tx.send(msg.clone());
                        output.push_str(&msg);
                        output.push('\n');
                    }
                }
            }
        }

        // 计算总耗时并发送
        let duration = start_time.elapsed().as_millis() as i64;
        let duration_msg = format!("[执行耗时: {}ms ({:.2}s)]", duration, duration as f64 / 1000.0);
        let _ = tx.send(duration_msg.clone());
        // 缓存耗时消息
        if let Some(buffer) = self.log_buffers.write().await.get_mut(&execution_id) {
            buffer.push(duration_msg.clone());
        }
        output.push_str(&duration_msg);
        output.push('\n');

        // 获取任务开始时间
        let started_at = self.executions.read().await.get(&execution_id).map(|e| e.started_at);

        self.log_channels.write().await.remove(&execution_id);
        self.executions.write().await.remove(&execution_id);

        // 通知运行状态变化（包含执行信息）
        let running_list: Vec<i64> = self.running_tasks.read().await.keys().copied().collect();
        let update = RunningTasksUpdate {
            running_ids: running_list,
            changed_task_id: task.id,
            change_type: "finished".to_string(),
            task_data: None,
            last_run_at: started_at,
            last_run_duration: Some(duration),
        };
        let _ = self.running_tasks_notifier.send(update);

        if overall_success {
            info!("Task {} completed successfully", task.name);
        } else {
            error!("Task {} failed", task.name);
        }

        Ok((execution_id, output, overall_success))
    }

    /// 流式执行任务，返回 execution_id 和 stream
    pub async fn execute_stream(
        &self,
        task: &Task,
    ) -> Result<(String, impl tokio_stream::Stream<Item = Result<String>>)> {
        let execution_id = Uuid::new_v4().to_string();
        debug!("Executing task with stream: {} ({}) with execution_id: {}", task.name, task.command, execution_id);

        // 创建广播通道和日志缓存
        let (tx, _) = broadcast::channel(100);
        self.log_channels.write().await.insert(execution_id.clone(), tx.clone());
        self.log_buffers.write().await.insert(execution_id.clone(), Vec::new());

        // 记录执行信息
        let exec_info = ExecutionInfo {
            execution_id: execution_id.clone(),
            task_id: task.id,
            task_name: task.name.clone(),
            pid: None,
            started_at: chrono::Utc::now(),
        };
        self.executions.write().await.insert(execution_id.clone(), exec_info);

        // 解析环境变量
        let env_vars = self.parse_env().await;

        // 获取工作目录
        let working_dir = self.get_working_directory(&task);

        // 确保工作目录存在
        if !working_dir.exists() {
            tokio::fs::create_dir_all(&working_dir).await?;
        }

        // 给脚本文件添加执行权限
        self.ensure_script_executable(&task.command, &working_dir).await;

        // 调整命令以适应工作目录
        let adjusted_command = self.adjust_command_for_working_dir(&task.command, &working_dir);

        // 执行命令
        let mut child = Command::new("sh")
            .arg("-c")
            .arg(&adjusted_command)
            .current_dir(&working_dir)
            .env_clear()
            .envs(env_vars)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        // 注册进程
        let pid = child.id().ok_or_else(|| anyhow!("Failed to get process ID"))?;
        {
            let mut running_tasks = self.running_tasks.write().await;
            running_tasks.entry(task.id).or_default().push(pid);
        }

        // 通知运行状态变化
        let running_list: Vec<i64> = self.running_tasks.read().await.keys().copied().collect();
        let update = RunningTasksUpdate {
            running_ids: running_list,
            changed_task_id: task.id,
            change_type: "started".to_string(),
            task_data: None,
            last_run_at: None,
            last_run_duration: None,
        };
        let _ = self.running_tasks_notifier.send(update);

        // 更新执行信息中的 PID
        if let Some(info) = self.executions.write().await.get_mut(&execution_id) {
            info.pid = Some(pid);
        }

        let stdout = child.stdout.take().ok_or_else(|| anyhow!("Failed to capture stdout"))?;
        let stderr = child.stderr.take().ok_or_else(|| anyhow!("Failed to capture stderr"))?;

        let task_id = task.id;
        let running_tasks = self.running_tasks.clone();
        let log_channels = self.log_channels.clone();
        let executions = self.executions.clone();
        let exec_id = execution_id.clone();
        let notifier = self.running_tasks_notifier.clone();

        let stream = async_stream::stream! {
            let mut stdout_reader = LineReader::new(stdout);
            let mut stderr_reader = LineReader::new(stderr);

            loop {
                tokio::select! {
                    result = stdout_reader.next_line() => {
                        match result {
                            Ok(Some(line)) => {
                                let _ = tx.send(line.clone());
                                yield Ok(line);
                            },
                            Ok(None) => break,
                            Err(e) => {
                                let err_msg = format!("Stdout error: {}", e);
                                let _ = tx.send(err_msg.clone());
                                yield Err(anyhow!(err_msg));
                            },
                        }
                    }
                    result = stderr_reader.next_line() => {
                        match result {
                            Ok(Some(line)) => {
                                let _ = tx.send(line.clone());
                                yield Ok(line);
                            },
                            Ok(None) => {},
                            Err(e) => {
                                let err_msg = format!("Stderr error: {}", e);
                                let _ = tx.send(err_msg.clone());
                                yield Err(anyhow!(err_msg));
                            },
                        }
                    }
                }
            }

            // 等待进程结束
            match child.wait().await {
                Ok(status) => {
                    let exit_msg = if status.success() {
                        "[EXIT] Process exited with code 0".to_string()
                    } else {
                        format!("[EXIT] Process exited with code {}", status.code().unwrap_or(-1))
                    };
                    let _ = tx.send(exit_msg.clone());
                    yield Ok(exit_msg);
                }
                Err(e) => {
                    let err_msg = format!("Failed to wait for process: {}", e);
                    let _ = tx.send(err_msg.clone());
                    yield Err(anyhow!(err_msg));
                }
            }

            // 清理进程记录
            {
                let mut running = running_tasks.write().await;
                if let Some(pids) = running.get_mut(&task_id) {
                    pids.retain(|running_pid| *running_pid != pid);
                    if pids.is_empty() {
                        running.remove(&task_id);
                    }
                }
            }

            // 获取执行信息
            let exec_info = executions.read().await.get(&exec_id).cloned();
            let started_at = exec_info.as_ref().map(|e| e.started_at);
            let duration = started_at.map(|start| {
                (chrono::Utc::now() - start).num_milliseconds()
            });

            // 通知运行状态变化
            let running_list: Vec<i64> = running_tasks.read().await.keys().copied().collect();
            let update = RunningTasksUpdate {
                running_ids: running_list,
                changed_task_id: task_id,
                change_type: "finished".to_string(),
                task_data: None,
                last_run_at: started_at,
                last_run_duration: duration,
            };
            let _ = notifier.send(update);

            log_channels.write().await.remove(&exec_id);
            executions.write().await.remove(&exec_id);
        };

        Ok((execution_id, stream))
    }

    /// 中止正在执行的任务
    pub async fn kill_task(&self, task_id: i64) -> Result<()> {
        let mut tasks = self.running_tasks.write().await;

        if let Some(pids) = tasks.remove(&task_id) {
            for pid in pids {
                let output = Command::new("kill")
                    .arg("-9")
                    .arg(pid.to_string())
                    .output()
                    .await?;

                if !output.status.success() {
                    return Err(anyhow!("Failed to kill process {}", pid));
                }
            }
            Ok(())
        } else {
            Err(anyhow!("Task not running"))
        }
    }

    /// 中止正在执行的任务并记录日志
    pub async fn kill_task_with_log(&self, task_id: i64, log_service: Arc<crate::services::LogService>) -> Result<()> {
        // 获取执行信息和 PID（在删除之前）
        let exec_info = {
            let executions = self.executions.read().await;
            executions.values()
                .find(|e| e.task_id == task_id)
                .cloned()
        };

        // 获取 PID 列表并从 running_tasks 中移除（快速释放锁）
        let pids = {
            let mut tasks = self.running_tasks.write().await;
            tasks.remove(&task_id)
        };

        if let Some(pids) = pids {
            let mut kill_error = None;
            for pid in &pids {
                if let Err(e) = Command::new("kill")
                    .arg("-9")
                    .arg(pid.to_string())
                    .spawn()
                {
                    kill_error = Some(((*pid), e));
                    break;
                }
            }

            match kill_error {
                None => {
                    // kill 命令已发送，记录终止日志
                    if let Some(info) = exec_info {
                        let duration = (chrono::Utc::now() - info.started_at).num_milliseconds();

                        // 获取已执行的输出
                        let existing_output = {
                            let buffers = self.log_buffers.read().await;
                            buffers.get(&info.execution_id)
                                .map(|lines| lines.join("\n"))
                                .unwrap_or_default()
                        };

                        // 组合完整的日志输出
                        let mut log_output = String::new();
                        if !existing_output.is_empty() {
                            log_output.push_str(&existing_output);
                            log_output.push('\n');
                        }
                        log_output.push_str(&format!("[KILLED] Task '{}' was manually terminated (PIDs: {})", info.task_name, pids.iter().map(|pid| pid.to_string()).collect::<Vec<_>>().join(", ")));

                        // 清理执行信息
                        self.executions.write().await.remove(&info.execution_id);
                        self.log_channels.write().await.remove(&info.execution_id);
                        self.log_buffers.write().await.remove(&info.execution_id);

                        // 通知运行状态变化
                        let running_list: Vec<i64> = self.running_tasks.read().await.keys().copied().collect();
                        let update = RunningTasksUpdate {
                            running_ids: running_list,
                            changed_task_id: task_id,
                            change_type: "finished".to_string(),
                            task_data: None,
                            last_run_at: Some(info.started_at),
                            last_run_duration: Some(duration),
                        };
                        let _ = self.running_tasks_notifier.send(update);

                        // 保存日志到数据库
                        if let Err(e) = log_service.create(task_id, log_output, "killed".to_string(), Some(duration), info.started_at).await {
                            error!("Failed to save kill log: {}", e);
                        }
                    }
                    Ok(())
                }
                Some((pid, e)) => {
                    error!("Failed to spawn kill command for PID {}: {}", pid, e);
                    Err(anyhow!("Failed to kill process {}: {}", pid, e))
                }
            }
        } else {
            Err(anyhow!("Task not running"))
        }
    }

    /// 列出正在执行的任务
    pub async fn list_running(&self) -> Vec<i64> {
        self.running_tasks.read().await.keys().copied().collect()
    }

    /// 订阅运行任务状态变化
    pub fn subscribe_running_tasks(&self) -> broadcast::Receiver<RunningTasksUpdate> {
        self.running_tasks_notifier.subscribe()
    }

    /// 订阅执行日志
    pub async fn subscribe_logs(&self, execution_id: &str) -> Result<broadcast::Receiver<String>> {
        let channels = self.log_channels.read().await;
        let tx = channels
            .get(execution_id)
            .ok_or_else(|| anyhow!("Execution not found or already completed"))?;
        Ok(tx.subscribe())
    }

    /// 获取历史日志
    pub async fn get_log_history(&self, execution_id: &str) -> Vec<String> {
        self.log_buffers
            .read()
            .await
            .get(execution_id)
            .cloned()
            .unwrap_or_default()
    }

    /// 发送日志并缓存
    async fn send_and_cache_log(&self, execution_id: &str, tx: &broadcast::Sender<String>, log: String) {
        // 发送到广播频道
        let _ = tx.send(log.clone());

        // 缓存日志（限制最多1000行）
        if let Some(buffer) = self.log_buffers.write().await.get_mut(execution_id) {
            buffer.push(log);
            if buffer.len() > 1000 {
                buffer.remove(0);
            }
        }
    }

    /// 列出所有活跃的执行
    pub async fn list_executions(&self) -> Vec<ExecutionInfo> {
        self.executions.read().await.values().cloned().collect()
    }

    /// 获取执行信息
    pub async fn get_execution(&self, execution_id: &str) -> Option<ExecutionInfo> {
        self.executions.read().await.get(execution_id).cloned()
    }

    async fn parse_env(&self) -> HashMap<String, String> {
        let mut env_vars = HashMap::new();

        // 添加基础环境变量
        env_vars.insert("PATH".to_string(), std::env::var("PATH").unwrap_or_default());
        env_vars.insert("HOME".to_string(), std::env::var("HOME").unwrap_or_default());

        // 从数据库读取全局环境变量
        if let Ok(global_vars) = self.env_service.get_all_as_map().await {
            env_vars.extend(global_vars);
        }

        env_vars
    }

    async fn get_system_config_value(&self, key: &str) -> Option<String> {
        self.config_service
            .get_by_key(key)
            .await
            .ok()
            .flatten()
            .map(|config| config.value)
    }

    fn split_accounts_by_rule(&self, source: &str, rule: &str) -> Vec<String> {
        let normalized_rule = rule.trim();
        if normalized_rule.is_empty() {
            return Vec::new();
        }

        let regex_pattern = if normalized_rule.starts_with("regex:") {
            normalized_rule.trim_start_matches("regex:").trim().to_string()
        } else {
            normalized_rule
                .split('|')
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(regex::escape)
                .collect::<Vec<_>>()
                .join("|")
        };

        if regex_pattern.is_empty() {
            return Vec::new();
        }

        Regex::new(&regex_pattern)
            .map(|re| {
                re.split(source)
                    .map(|item| item.trim().to_string())
                    .filter(|item| !item.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_else(|_| {
                source
                    .split(normalized_rule)
                    .map(|item| item.trim().to_string())
                    .filter(|item| !item.is_empty())
                    .collect::<Vec<_>>()
            })
    }

    async fn resolve_account_run_plan(
        &self,
        task: &Task,
        env_vars: &HashMap<String, String>,
    ) -> Option<(String, String, usize, Vec<String>)> {
        let mode = task.account_run_mode.clone().unwrap_or_else(|| "single".to_string());
        if mode == "single" {
            return None;
        }

        let env_key = task.account_env_key.clone()?.trim().to_string();
        if env_key.is_empty() {
            return None;
        }

        let source = env_vars.get(&env_key)?.trim().to_string();
        if source.is_empty() {
            return None;
        }

        let split_rule = if let Some(value) = task.account_split_delimiter.clone().filter(|v| !v.trim().is_empty()) {
            value
        } else {
            self.get_system_config_value("account_split_delimiter")
                .await
                .unwrap_or_else(|| "@".to_string())
        };
        if split_rule.trim().is_empty() {
            return None;
        }

        let accounts = self.split_accounts_by_rule(&source, &split_rule);
        if accounts.len() <= 1 {
            return None;
        }

        let system_max = self
            .get_system_config_value("account_max_concurrency")
            .await
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(3);
        let requested = task.account_concurrency.unwrap_or(system_max as i64).max(1) as usize;
        let actual_concurrency = requested.min(system_max.max(1));

        Some((mode, env_key, actual_concurrency, accounts))
    }

    async fn execute_tracked_command(
        &self,
        task: &Task,
        command: &str,
        env_vars: &HashMap<String, String>,
        tx: &broadcast::Sender<String>,
        working_dir: &std::path::Path,
        execution_id: &str,
    ) -> Result<(String, bool)> {
        if !working_dir.exists() {
            tokio::fs::create_dir_all(&working_dir).await?;
        }

        self.ensure_script_executable(command, working_dir).await;
        let adjusted_command = self.adjust_command_for_working_dir(command, working_dir);

        let mut child = Command::new("sh")
            .arg("-c")
            .arg(&adjusted_command)
            .current_dir(working_dir)
            .env_clear()
            .envs(env_vars.clone())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let pid = child.id().ok_or_else(|| anyhow!("Failed to get process ID"))?;
        {
            let mut running_tasks = self.running_tasks.write().await;
            running_tasks.entry(task.id).or_default().push(pid);
        }

        let running_list: Vec<i64> = self.running_tasks.read().await.keys().copied().collect();
        let _ = self.running_tasks_notifier.send(RunningTasksUpdate {
            running_ids: running_list,
            changed_task_id: task.id,
            change_type: "started".to_string(),
            task_data: None,
            last_run_at: None,
            last_run_duration: None,
        });

        if let Some(info) = self.executions.write().await.get_mut(execution_id) {
            info.pid = Some(pid);
        }

        let stdout = child.stdout.take().ok_or_else(|| anyhow!("Failed to capture stdout"))?;
        let stderr = child.stderr.take().ok_or_else(|| anyhow!("Failed to capture stderr"))?;
        let mut output = String::new();
        let mut stdout_reader = LineReader::new(stdout);
        let mut stderr_reader = LineReader::new(stderr);
        let mut stdout_done = false;
        let mut stderr_done = false;

        while !stdout_done || !stderr_done {
            tokio::select! {
                result = stdout_reader.next_line(), if !stdout_done => {
                    match result {
                        Ok(Some(line)) => {
                            output.push_str(&line);
                            output.push('\n');
                            self.send_and_cache_log(execution_id, tx, line).await;
                        }
                        Ok(None) => stdout_done = true,
                        Err(_) => stdout_done = true,
                    }
                }
                result = stderr_reader.next_line(), if !stderr_done => {
                    match result {
                        Ok(Some(line)) => {
                            output.push_str(&line);
                            output.push('\n');
                            self.send_and_cache_log(execution_id, tx, line).await;
                        }
                        Ok(None) => stderr_done = true,
                        Err(_) => stderr_done = true,
                    }
                }
            }
        }

        let status = child.wait().await?;
        let success = status.success();
        let exit_msg = if success {
            "[MAIN] Process exited with code 0".to_string()
        } else {
            format!("[MAIN] Process exited with code {}", status.code().unwrap_or(-1))
        };
        self.send_and_cache_log(execution_id, tx, exit_msg.clone()).await;
        output.push_str(&exit_msg);
        output.push('\n');

        {
            let mut running_tasks = self.running_tasks.write().await;
            if let Some(pids) = running_tasks.get_mut(&task.id) {
                pids.retain(|running_pid| *running_pid != pid);
                if pids.is_empty() {
                    running_tasks.remove(&task.id);
                }
            }
        }

        let running_list: Vec<i64> = self.running_tasks.read().await.keys().copied().collect();
        let _ = self.running_tasks_notifier.send(RunningTasksUpdate {
            running_ids: running_list,
            changed_task_id: task.id,
            change_type: "finished".to_string(),
            task_data: None,
            last_run_at: None,
            last_run_duration: None,
        });

        Ok((output, success))
    }

    /// 执行单个命令并返回输出和成功状态
    async fn execute_command(
        &self,
        command: &str,
        env_vars: &HashMap<String, String>,
        tx: &broadcast::Sender<String>,
        working_dir: &std::path::Path,
    ) -> Result<(String, bool)> {
        // 确保工作目录存在
        if !working_dir.exists() {
            tokio::fs::create_dir_all(&working_dir).await?;
        }

        // 给脚本文件添加执行权限
        self.ensure_script_executable(command, &working_dir).await;

        // 调整命令以适应工作目录
        let adjusted_command = self.adjust_command_for_working_dir(command, &working_dir);

        let mut child = Command::new("sh")
            .arg("-c")
            .arg(&adjusted_command)
            .current_dir(&working_dir)
            .env_clear()
            .envs(env_vars.clone())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();

        let mut output = String::new();

        // 读取stdout
        let mut stdout_reader = LineReader::new(stdout);
        while let Ok(Some(line)) = stdout_reader.next_line().await {
            output.push_str(&line);
            output.push('\n');
            let _ = tx.send(line);
        }

        // 读取stderr
        let mut stderr_reader = LineReader::new(stderr);
        while let Ok(Some(line)) = stderr_reader.next_line().await {
            output.push_str(&line);
            output.push('\n');
            let _ = tx.send(line);
        }

        // 等待进程结束
        let status = child.wait().await?;
        let success = status.success();

        let exit_msg = if success {
            "Process exited with code 0".to_string()
        } else {
            format!("Process exited with code {}", status.code().unwrap_or(-1))
        };
        let _ = tx.send(exit_msg.clone());
        output.push_str(&exit_msg);
        output.push('\n');

        Ok((output, success))
    }
}
