use serde::Serialize;
use tauri::{AppHandle, Emitter};

const ANALYSIS_ATTEMPT_EVENT: &str = "analysis-attempt-event";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisAttemptLog {
    pub session_id: String,
    pub timestamp: u64,
    pub batch_index: usize,
    pub attempt: u32,
    pub status: String,
    pub request_url: String,
    pub request_body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_body: Option<String>,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub will_retry: bool,
}

pub fn current_timestamp_milliseconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn emit_analysis_attempt(app: &AppHandle, attempt_log: AnalysisAttemptLog) {
    if let Ok(serialized_attempt) = serde_json::to_string(&attempt_log) {
        let _ = app.emit(ANALYSIS_ATTEMPT_EVENT, serialized_attempt);
    }
}
