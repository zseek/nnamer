use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    timestamp: u64,
    level: String,
    message: String,
}

pub fn log_info(app: &AppHandle, message: impl AsRef<str>) {
    let entry = LogEntry {
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
        level: "info".to_string(),
        message: message.as_ref().to_string(),
    };
    let _ = app.emit("log-event", serde_json::to_string(&entry).unwrap());
}

pub fn log_warn(app: &AppHandle, message: impl AsRef<str>) {
    let entry = LogEntry {
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
        level: "warn".to_string(),
        message: message.as_ref().to_string(),
    };
    let _ = app.emit("log-event", serde_json::to_string(&entry).unwrap());
}

pub fn log_error(app: &AppHandle, message: impl AsRef<str>) {
    let entry = LogEntry {
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
        level: "error".to_string(),
        message: message.as_ref().to_string(),
    };
    let _ = app.emit("log-event", serde_json::to_string(&entry).unwrap());
}

pub fn log_debug(app: &AppHandle, message: impl AsRef<str>) {
    let entry = LogEntry {
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
        level: "debug".to_string(),
        message: message.as_ref().to_string(),
    };
    let _ = app.emit("log-event", serde_json::to_string(&entry).unwrap());
}
