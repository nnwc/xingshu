use once_cell::sync::Lazy;
use std::process::Command;
use tracing::info;

/// 全局Python命令
pub static PYTHON_CMD: Lazy<String> = Lazy::new(|| detect_python_command());

/// 全局pip命令
pub static PIP_CMD: Lazy<String> = Lazy::new(|| detect_pip_command());

/// 检测系统中可用的Python命令
fn detect_python_command() -> String {
    // 尝试的命令列表，按优先级排序
    let candidates = ["python3", "python"];

    for cmd in &candidates {
        if let Ok(output) = Command::new(cmd).arg("--version").output() {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout);
                info!("Detected Python command: {} ({})", cmd, version.trim());
                return cmd.to_string();
            }
        }
    }

    // 如果都不可用，默认使用python3
    info!("No Python command detected, defaulting to python3");
    "python3".to_string()
}

/// 检测系统中可用的pip命令
fn detect_pip_command() -> String {
    // 尝试的命令列表，按优先级排序
    let candidates = ["pip3", "pip"];

    for cmd in &candidates {
        if let Ok(output) = Command::new(cmd).arg("--version").output() {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout);
                info!("Detected pip command: {} ({})", cmd, version.trim());
                return cmd.to_string();
            }
        }
    }

    // 如果都不可用，默认使用pip3
    info!("No pip command detected, defaulting to pip3");
    "pip3".to_string()
}
