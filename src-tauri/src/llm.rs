use std::collections::HashMap;
use std::time::{Duration, Instant};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::logger;
use crate::naming;
use crate::settings::AppSettings;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisRequest {
    pub file_id: String,
    pub original_stem: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResult {
    pub file_id: String,
    pub suggested_name: Option<String>,
    pub normalized_name: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchAnalysisResult {
    pub batch_index: usize,
    pub results: Vec<AnalysisResult>,
    pub raw_response: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ChatMessage {
    role: &'static str,
    content: String,
}

#[derive(Debug, Clone, Serialize)]
struct FilePromptInput {
    id: String,
    filename: String,
}

#[tauri::command]
pub async fn analyze_batch(
    app_handle: AppHandle,
    settings: AppSettings,
    session_id: String,
    batch_index: usize,
    requests: Vec<AnalysisRequest>,
) -> AppResult<BatchAnalysisResult> {
    settings.validate()?;

    if requests.is_empty() {
        return Err(AppError::Validation("批次为空".to_string()));
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(settings.timeout_seconds))
        .build()?;

    let messages = build_batch_messages(&settings.prompt, &requests)?;
    let chat_completion_url = format!(
        "{}/chat/completions",
        settings.base_url.trim_end_matches('/')
    );

    let request_body = json!({
        "model": settings.model,
        "messages": messages,
        "temperature": 0.3,
    });
    let request_body_text = serde_json::to_string_pretty(&request_body)?;

    let mut last_error = None;
    for attempt_index in 0..=settings.max_retries {
        if attempt_index > 0 {
            tokio::time::sleep(Duration::from_millis(500 * attempt_index as u64)).await;
        }

        let attempt_number = attempt_index + 1;
        let will_retry = attempt_index < settings.max_retries;
        let request_started_at = Instant::now();
        let response = client
            .post(&chat_completion_url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", settings.api_key))
            .json(&request_body)
            .send()
            .await;

        match response {
            Ok(http_response) => {
                let response_status = http_response.status();
                let response_text_result = http_response.text().await;
                let request_duration_milliseconds = request_started_at.elapsed().as_millis() as u64;

                let response_text = match response_text_result {
                    Ok(response_text) => response_text,
                    Err(error) => {
                        let error_message = format!("读取响应正文失败：{}", error);
                        logger::emit_analysis_attempt(
                            &app_handle,
                            logger::AnalysisAttemptLog {
                                session_id: session_id.clone(),
                                timestamp: logger::current_timestamp_milliseconds(),
                                batch_index,
                                attempt: attempt_number,
                                status: "network_error".to_string(),
                                request_url: chat_completion_url.clone(),
                                request_body: request_body_text.clone(),
                                response_status: Some(response_status.as_u16()),
                                response_body: None,
                                duration_ms: request_duration_milliseconds,
                                error: Some(error_message.clone()),
                                will_retry,
                            },
                        );
                        last_error = Some(error_message);
                        continue;
                    }
                };

                if !response_status.is_success() {
                    let error_message = format!("HTTP {}: {}", response_status, response_text);
                    logger::emit_analysis_attempt(
                        &app_handle,
                        logger::AnalysisAttemptLog {
                            session_id: session_id.clone(),
                            timestamp: logger::current_timestamp_milliseconds(),
                            batch_index,
                            attempt: attempt_number,
                            status: "http_error".to_string(),
                            request_url: chat_completion_url.clone(),
                            request_body: request_body_text.clone(),
                            response_status: Some(response_status.as_u16()),
                            response_body: Some(response_text),
                            duration_ms: request_duration_milliseconds,
                            error: Some(error_message.clone()),
                            will_retry,
                        },
                    );
                    last_error = Some(error_message);
                    continue;
                }

                let parse_result =
                    parse_completion_response(batch_index, &requests, &response_text);
                match parse_result {
                    Ok(batch_result) => {
                        logger::emit_analysis_attempt(
                            &app_handle,
                            logger::AnalysisAttemptLog {
                                session_id: session_id.clone(),
                                timestamp: logger::current_timestamp_milliseconds(),
                                batch_index,
                                attempt: attempt_number,
                                status: "success".to_string(),
                                request_url: chat_completion_url.clone(),
                                request_body: request_body_text.clone(),
                                response_status: Some(response_status.as_u16()),
                                response_body: Some(response_text),
                                duration_ms: request_duration_milliseconds,
                                error: None,
                                will_retry: false,
                            },
                        );
                        return Ok(batch_result);
                    }
                    Err(parse_error) => {
                        let error_message = parse_error.to_string();
                        logger::emit_analysis_attempt(
                            &app_handle,
                            logger::AnalysisAttemptLog {
                                session_id: session_id.clone(),
                                timestamp: logger::current_timestamp_milliseconds(),
                                batch_index,
                                attempt: attempt_number,
                                status: "parse_error".to_string(),
                                request_url: chat_completion_url.clone(),
                                request_body: request_body_text.clone(),
                                response_status: Some(response_status.as_u16()),
                                response_body: Some(response_text),
                                duration_ms: request_duration_milliseconds,
                                error: Some(error_message),
                                will_retry: false,
                            },
                        );
                        return Err(parse_error);
                    }
                }
            }
            Err(error) => {
                let request_duration_milliseconds = request_started_at.elapsed().as_millis() as u64;
                let error_message = format!("请求失败：{}", error);
                logger::emit_analysis_attempt(
                    &app_handle,
                    logger::AnalysisAttemptLog {
                        session_id: session_id.clone(),
                        timestamp: logger::current_timestamp_milliseconds(),
                        batch_index,
                        attempt: attempt_number,
                        status: "network_error".to_string(),
                        request_url: chat_completion_url.clone(),
                        request_body: request_body_text.clone(),
                        response_status: None,
                        response_body: None,
                        duration_ms: request_duration_milliseconds,
                        error: Some(error_message.clone()),
                        will_retry,
                    },
                );
                last_error = Some(error_message);
            }
        }
    }

    Err(AppError::Llm(format!(
        "批次 {} 重试 {} 次后仍然失败：{}",
        batch_index,
        settings.max_retries,
        last_error.unwrap_or_else(|| "未知错误".to_string())
    )))
}

fn build_batch_messages(
    system_prompt: &str,
    requests: &[AnalysisRequest],
) -> AppResult<Vec<ChatMessage>> {
    let file_inputs = requests
        .iter()
        .map(|request| FilePromptInput {
            id: request.file_id.clone(),
            filename: naming::strip_txt_extension(&request.original_stem),
        })
        .collect::<Vec<_>>();
    let file_inputs_json = serde_json::to_string_pretty(&file_inputs)?;

    Ok(vec![
        ChatMessage {
            role: "system",
            content: system_prompt.to_string(),
        },
        ChatMessage {
            role: "user",
            content: file_inputs_json,
        },
    ])
}

fn parse_completion_response(
    batch_index: usize,
    requests: &[AnalysisRequest],
    response_text: &str,
) -> AppResult<BatchAnalysisResult> {
    let response_json: Value = serde_json::from_str(response_text)
        .map_err(|error| AppError::Llm(format!("无法解析 JSON 响应：{}", error)))?;

    let content = response_json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| AppError::Llm("响应中缺少 content 字段".to_string()))?;

    let trimmed_content = content.trim();
    let json_content = if trimmed_content.starts_with("```json") {
        trimmed_content
            .strip_prefix("```json")
            .and_then(|stripped| stripped.strip_suffix("```"))
            .unwrap_or(trimmed_content)
            .trim()
    } else if trimmed_content.starts_with("```") {
        trimmed_content
            .strip_prefix("```")
            .and_then(|stripped| stripped.strip_suffix("```"))
            .unwrap_or(trimmed_content)
            .trim()
    } else {
        trimmed_content
    };

    let suggestions: Vec<LlmSuggestion> = serde_json::from_str(json_content)
        .map_err(|error| AppError::Llm(format!("无法解析建议列表：{}", error)))?;

    let suggestion_map: HashMap<String, String> = suggestions
        .into_iter()
        .map(|suggestion| (suggestion.id, suggestion.suggested_name))
        .collect();

    let mut results = Vec::new();
    for request in requests {
        let analysis_result = if let Some(suggested_name) = suggestion_map.get(&request.file_id) {
            let extensionless_suggested_name = naming::strip_txt_extension(suggested_name);
            let validation = naming::normalize_suggested_name(&extensionless_suggested_name);
            AnalysisResult {
                file_id: request.file_id.clone(),
                suggested_name: Some(extensionless_suggested_name),
                normalized_name: validation.normalized_name,
                error: validation.error,
            }
        } else {
            AnalysisResult {
                file_id: request.file_id.clone(),
                suggested_name: None,
                normalized_name: None,
                error: Some("LLM 响应中缺少此文件".to_string()),
            }
        };
        results.push(analysis_result);
    }

    Ok(BatchAnalysisResult {
        batch_index,
        results,
        raw_response: Some(response_text.to_string()),
    })
}

#[derive(Debug, Clone, Deserialize)]
struct LlmSuggestion {
    id: String,
    suggested_name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_separate_system_prompt_and_file_json_messages() {
        let system_prompt = "只使用这段用户配置的提示词。\n不要追加其他内容。";
        let requests = vec![
            AnalysisRequest {
                file_id: "file-001".to_string(),
                original_stem: "诡秘之主(全本).TXT".to_string(),
            },
            AnalysisRequest {
                file_id: "file-002".to_string(),
                original_stem: "带\"引号\"的书名".to_string(),
            },
        ];

        let messages = build_batch_messages(system_prompt, &requests).unwrap();

        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "system");
        assert_eq!(messages[0].content, system_prompt);
        assert_eq!(messages[1].role, "user");

        let file_inputs: Value = serde_json::from_str(&messages[1].content).unwrap();
        assert_eq!(
            file_inputs,
            json!([
                {"id": "file-001", "filename": "诡秘之主(全本)"},
                {"id": "file-002", "filename": "带\"引号\"的书名"}
            ])
        );
    }

    #[test]
    fn strips_extensions_from_llm_suggestions() {
        let requests = vec![AnalysisRequest {
            file_id: "file-001".to_string(),
            original_stem: "诡秘之主".to_string(),
        }];
        let response_text = serde_json::json!({
            "choices": [{
                "message": {
                    "content": r#"[{"id":"file-001","suggested_name":"诡秘之主.txt"}]"#
                }
            }]
        })
        .to_string();

        let result = parse_completion_response(0, &requests, &response_text).unwrap();
        assert_eq!(
            result.results[0].suggested_name.as_deref(),
            Some("诡秘之主")
        );
        assert_eq!(
            result.results[0].normalized_name.as_deref(),
            Some("诡秘之主")
        );
    }
}
