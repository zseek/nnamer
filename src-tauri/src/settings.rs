use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

const SETTINGS_FILE_NAME: &str = "settings.json";
const DEFAULT_CONCURRENCY: usize = 3;

fn default_concurrency() -> usize {
    DEFAULT_CONCURRENCY
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub batch_size: usize,
    pub timeout_seconds: u64,
    pub max_retries: u32,
    #[serde(default = "default_concurrency")]
    pub concurrency: usize,
    pub prompt: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: String::new(),
            model: "gpt-4o-mini".to_string(),
            batch_size: 15,
            timeout_seconds: 60,
            max_retries: 2,
            concurrency: default_concurrency(),
            prompt:
                r#"你是一个专业的文件名识别工具。你的任务是从混乱的文件名中提取出正确的小说书名。

**处理规则：**
1. 去除所有无关信息：作者名、网站名、下载来源、完结标记、章节范围、更新日期、括号内广告
2. 提取核心书名：只保留小说的正式名称
3. 不要臆造：如果无法确定书名，返回原文件名

**输出格式要求：**
必须严格返回 JSON 数组格式，每个对象包含两个字段：
- "id": 文件的唯一标识符（与输入完全一致）
- "suggested_name": 识别出的书名（纯文本，不含扩展名）

**输入输出示例：**
输入格式：
[
  {"id": "b8c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e", "filename": "[笔趣阁]诡秘之主(全本)作者爱潜水的乌贼"},
  {"id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d", "filename": "斗破苍穹-天蚕土豆【完结】"}
]
输出格式：
[
  {"id": "b8c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e", "suggested_name": "诡秘之主"},
  {"id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d", "suggested_name": "斗破苍穹"}
]"#
                    .to_string(),
        }
    }
}

impl AppSettings {
    pub fn validate(&self) -> AppResult<()> {
        if self.base_url.trim().is_empty() {
            return Err(AppError::Validation("Base URL 不能为空".to_string()));
        }
        if self.model.trim().is_empty() {
            return Err(AppError::Validation("模型名称不能为空".to_string()));
        }
        if self.batch_size == 0 {
            return Err(AppError::Validation(
                "每批文件数必须大于 0".to_string(),
            ));
        }
        if self.timeout_seconds == 0 {
            return Err(AppError::Validation(
                "请求超时必须大于 0 秒".to_string(),
            ));
        }
        if self.concurrency == 0 {
            return Err(AppError::Validation(
                "并发数必须大于 0".to_string(),
            ));
        }
        if self.prompt.trim().is_empty() {
            return Err(AppError::Validation("Prompt 不能为空".to_string()));
        }
        Ok(())
    }
}

#[tauri::command]
pub fn load_settings(app_handle: AppHandle) -> AppResult<AppSettings> {
    let settings_path = resolve_settings_path(&app_handle)?;
    if !settings_path.exists() {
        return Ok(AppSettings::default());
    }

    let settings_json = fs::read_to_string(settings_path)?;
    let settings = serde_json::from_str::<AppSettings>(&settings_json)?;
    settings.validate()?;
    Ok(settings)
}

#[tauri::command]
pub fn save_settings(app_handle: AppHandle, settings: AppSettings) -> AppResult<AppSettings> {
    settings.validate()?;
    let settings_path = resolve_settings_path(&app_handle)?;
    if let Some(parent_directory) = settings_path.parent() {
        fs::create_dir_all(parent_directory)?;
    }
    let settings_json = serde_json::to_string_pretty(&settings)?;
    fs::write(settings_path, settings_json)?;
    Ok(settings)
}

fn resolve_settings_path(app_handle: &AppHandle) -> AppResult<PathBuf> {
    app_handle
        .path()
        .app_config_dir()
        .map(|directory| directory.join(SETTINGS_FILE_NAME))
        .map_err(|error| AppError::Validation(format!("无法定位应用配置目录：{error}")))
}

#[cfg(test)]
mod tests {
    use super::{AppSettings, DEFAULT_CONCURRENCY};

    #[test]
    fn rejects_zero_batch_size() {
        let settings = AppSettings {
            batch_size: 0,
            ..AppSettings::default()
        };
        assert!(settings.validate().is_err());
    }

    #[test]
    fn accepts_analysis_parameters_outside_previous_ranges() {
        let settings = AppSettings {
            batch_size: 50,
            timeout_seconds: 600,
            max_retries: 20,
            concurrency: 25,
            ..AppSettings::default()
        };
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn rejects_zero_concurrency() {
        let settings = AppSettings {
            concurrency: 0,
            ..AppSettings::default()
        };
        assert!(settings.validate().is_err());
    }

    #[test]
    fn rejects_zero_timeout() {
        let settings = AppSettings {
            timeout_seconds: 0,
            ..AppSettings::default()
        };
        assert!(settings.validate().is_err());
    }

    #[test]
    fn loads_legacy_settings_without_concurrency() {
        let mut settings_json = serde_json::to_value(AppSettings::default()).unwrap();
        settings_json.as_object_mut().unwrap().remove("concurrency");

        let settings: AppSettings = serde_json::from_value(settings_json).unwrap();
        assert_eq!(settings.concurrency, DEFAULT_CONCURRENCY);
    }
}
