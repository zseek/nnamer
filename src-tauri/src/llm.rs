use std::collections::HashMap;
use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::error::{AppError, AppResult};
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

#[tauri::command]
pub async fn analyze_batch(
    app_handle: AppHandle,
    settings: AppSettings,
    batch_index: usize,
    requests: Vec<AnalysisRequest>,
) -> AppResult<BatchAnalysisResult> {
    use crate::logger;

    logger::log_info(
        &app_handle,
        format!("开始分析批次 {} ({} 个文件)", batch_index, requests.len()),
    );

    settings.validate()?;

    if requests.is_empty() {
        return Err(AppError::Validation("批次为空".to_string()));
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(settings.timeout_seconds))
        .build()?;

    let user_prompt = build_batch_prompt(&settings.prompt, &requests);
    let chat_completion_url = format!(
        "{}/chat/completions",
        settings.base_url.trim_end_matches('/')
    );

    logger::log_debug(&app_handle, format!("API 端点: {}", chat_completion_url));

    let request_body = json!({
        "model": settings.model,
        "messages": [
            {
                "role": "user",
                "content": user_prompt
            }
        ],
        "temperature": 0.3,
    });

    let mut last_error = None;
    for attempt in 0..=settings.max_retries {
        if attempt > 0 {
            logger::log_warn(
                &app_handle,
                format!("批次 {} 重试第 {} 次", batch_index, attempt),
            );
            tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
        }

        let response = client
            .post(&chat_completion_url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", settings.api_key))
            .json(&request_body)
            .send()
            .await;

        match response {
            Ok(http_response) => {
                let status = http_response.status();
                let response_text = http_response.text().await?;

                if !status.is_success() {
                    let error_msg = format!("HTTP {}: {}", status, response_text);
                    logger::log_error(
                        &app_handle,
                        format!("批次 {} API 错误: {}", batch_index, error_msg),
                    );
                    last_error = Some(error_msg);
                    continue;
                }

                logger::log_info(
                    &app_handle,
                    format!("批次 {} 分析成功，开始解析响应", batch_index),
                );
                let result = parse_completion_response(batch_index, &requests, &response_text);

                match &result {
                    Ok(_) => logger::log_info(&app_handle, format!("批次 {} 完成", batch_index)),
                    Err(e) => logger::log_error(
                        &app_handle,
                        format!("批次 {} 解析失败: {}", batch_index, e),
                    ),
                }

                return result;
            }
            Err(error) => {
                let error_msg = format!("请求失败：{}", error);
                logger::log_error(
                    &app_handle,
                    format!("批次 {} 网络错误: {}", batch_index, error_msg),
                );
                last_error = Some(error_msg);
            }
        }
    }

    let final_error = format!(
        "批次 {} 重试 {} 次后仍然失败：{}",
        batch_index,
        settings.max_retries,
        last_error.unwrap_or_else(|| "未知错误".to_string())
    );
    logger::log_error(&app_handle, &final_error);
    Err(AppError::Llm(final_error))
}

fn build_batch_prompt(user_rules: &str, requests: &[AnalysisRequest]) -> String {
    let files_json = requests
        .iter()
        .map(|request| {
            let extensionless_filename = naming::strip_txt_extension(&request.original_stem);
            format!(
                r#"{{"id": "{}", "filename": "{}"}}"#,
                request.file_id.replace('"', r#"\""#),
                extensionless_filename.replace('"', r#"\""#)
            )
        })
        .collect::<Vec<_>>()
        .join(",\n  ");

    format!(
        r#"{}

以下是需要分析的文件名（JSON 格式）：

[
  {}
]

请返回 JSON 数组，每项包含 "id" 和 "suggested_name" 字段。id 必须与输入完全对应，suggested_name 为识别出的小说书名（不含 .txt 扩展名）。必须包含所有文件，不得遗漏。

只返回 JSON 数组，不要其他内容。"#,
        user_rules, files_json
    )
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
    fn builds_batch_prompt_without_filename_extensions() {
        let requests = vec![AnalysisRequest {
            file_id: "file-001".to_string(),
            original_stem: "诡秘之主(全本).TXT".to_string(),
        }];
        let prompt = build_batch_prompt("识别书名", &requests);
        assert!(prompt.contains("file-001"));
        assert!(prompt.contains(r#""filename": "诡秘之主(全本)""#));
        assert!(!prompt.contains(r#""filename": "诡秘之主(全本).TXT""#));
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
