use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

const SETTINGS_FILE_NAME: &str = "settings.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub batch_size: usize,
    pub timeout_seconds: u64,
    pub max_retries: u32,
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
            prompt: r#"你是一个专业的文件名识别工具。你的任务是从混乱的文件名中提取出正确的小说书名。

**处理规则：**
1. 去除所有无关信息：作者名、网站名、下载来源、完结标记、章节范围、更新日期、括号内广告
2. 提取核心书名：只保留小说的正式名称
3. 不要臆造：如果无法确定书名，返回原文件名

**输出格式要求：**
必须严格返回 JSON 数组格式，每个对象包含两个字段：
- "id": 文件的唯一标识符（与输入完全一致）
- "suggested_name": 识别出的书名（纯文本，不含扩展名）

**示例：**
输入文件名："[顶点小说]诡秘之主(全本)作者爱潜水的乌贼.txt"
输出：{"id": "file-001", "suggested_name": "诡秘之主"}

**重要：**
1. 必须包含所有输入文件，一个都不能遗漏
2. 只返回 JSON 数组，不要任何其他文字说明
3. 确保 JSON 格式正确可解析"#.to_string(),
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
        if !(10..=20).contains(&self.batch_size) {
            return Err(AppError::Validation(
                "每批文件数必须在 10 到 20 之间".to_string(),
            ));
        }
        if !(5..=300).contains(&self.timeout_seconds) {
            return Err(AppError::Validation(
                "请求超时必须在 5 到 300 秒之间".to_string(),
            ));
        }
        if self.max_retries > 5 {
            return Err(AppError::Validation("最大重试次数不能超过 5".to_string()));
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
    use super::AppSettings;

    #[test]
    fn validates_batch_size_range() {
        let settings = AppSettings {
            batch_size: 9,
            ..AppSettings::default()
        };
        assert!(settings.validate().is_err());
    }
}
