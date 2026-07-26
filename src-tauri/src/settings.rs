use std::{collections::HashSet, fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

const SETTINGS_FILE_NAME: &str = "settings.json";
const DEFAULT_CONCURRENCY: usize = 3;
const DEFAULT_PROMPT_PROFILE_ID: &str = "default";
const DEFAULT_PROMPT_PROFILE_NAME: &str = "小说书名识别";

fn default_concurrency() -> usize {
    DEFAULT_CONCURRENCY
}

fn default_prompt_content() -> String {
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
        .to_string()
}

fn default_prompt_profiles() -> Vec<PromptProfile> {
    Vec::new()
}

fn default_active_prompt_id() -> String {
    String::new()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PromptProfile {
    pub id: String,
    pub name: String,
    pub content: String,
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
    #[serde(default = "default_prompt_profiles")]
    pub prompt_profiles: Vec<PromptProfile>,
    #[serde(default = "default_active_prompt_id")]
    pub active_prompt_id: String,
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
            prompt: default_prompt_content(),
            prompt_profiles: vec![PromptProfile {
                id: DEFAULT_PROMPT_PROFILE_ID.to_string(),
                name: DEFAULT_PROMPT_PROFILE_NAME.to_string(),
                content: default_prompt_content(),
            }],
            active_prompt_id: DEFAULT_PROMPT_PROFILE_ID.to_string(),
        }
    }
}

impl AppSettings {
    pub fn normalize_prompt_profiles(mut self) -> Self {
        if self.prompt_profiles.is_empty() {
            self.prompt_profiles.push(PromptProfile {
                id: DEFAULT_PROMPT_PROFILE_ID.to_string(),
                name: DEFAULT_PROMPT_PROFILE_NAME.to_string(),
                content: self.prompt.clone(),
            });
            self.active_prompt_id = DEFAULT_PROMPT_PROFILE_ID.to_string();
            return self;
        }

        let active_profile = self
            .prompt_profiles
            .iter()
            .find(|profile| profile.id == self.active_prompt_id)
            .or_else(|| self.prompt_profiles.first());

        if let Some(active_profile) = active_profile {
            self.active_prompt_id = active_profile.id.clone();
            self.prompt = active_profile.content.clone();
        }

        self
    }

    pub fn validate(&self) -> AppResult<()> {
        if self.base_url.trim().is_empty() {
            return Err(AppError::Validation("Base URL 不能为空".to_string()));
        }
        if self.model.trim().is_empty() {
            return Err(AppError::Validation("模型名称不能为空".to_string()));
        }
        if self.batch_size == 0 {
            return Err(AppError::Validation("每批文件数必须大于 0".to_string()));
        }
        if self.timeout_seconds == 0 {
            return Err(AppError::Validation("请求超时必须大于 0 秒".to_string()));
        }
        if self.concurrency == 0 {
            return Err(AppError::Validation("并发数必须大于 0".to_string()));
        }
        if self.prompt.trim().is_empty() {
            return Err(AppError::Validation("提示词内容不能为空".to_string()));
        }
        if self.prompt_profiles.is_empty() {
            return Err(AppError::Validation("至少需要保留一个提示词".to_string()));
        }
        if self.active_prompt_id.trim().is_empty()
            || !self
                .prompt_profiles
                .iter()
                .any(|profile| profile.id == self.active_prompt_id)
        {
            return Err(AppError::Validation("当前提示词不存在".to_string()));
        }
        if self.prompt_profiles.iter().any(|profile| {
            profile.id.trim().is_empty()
                || profile.name.trim().is_empty()
                || profile.content.trim().is_empty()
        }) {
            return Err(AppError::Validation(
                "提示词名称和内容均不能为空".to_string(),
            ));
        }
        let mut prompt_profile_ids = HashSet::new();
        if self
            .prompt_profiles
            .iter()
            .any(|profile| !prompt_profile_ids.insert(profile.id.as_str()))
        {
            return Err(AppError::Validation("提示词标识不能重复".to_string()));
        }
        let active_prompt = self
            .prompt_profiles
            .iter()
            .find(|profile| profile.id == self.active_prompt_id)
            .expect("active prompt profile was validated above");
        if active_prompt.content != self.prompt {
            return Err(AppError::Validation(
                "当前提示词内容与活动提示词不一致".to_string(),
            ));
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
    let settings = serde_json::from_str::<AppSettings>(&settings_json)?.normalize_prompt_profiles();
    settings.validate()?;
    Ok(settings)
}

#[tauri::command]
pub fn save_settings(app_handle: AppHandle, settings: AppSettings) -> AppResult<AppSettings> {
    let settings = settings.normalize_prompt_profiles();
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
    use super::{AppSettings, PromptProfile, DEFAULT_CONCURRENCY, DEFAULT_PROMPT_PROFILE_ID};

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

    #[test]
    fn migrates_legacy_single_prompt_to_a_profile() {
        let mut settings_json = serde_json::to_value(AppSettings::default()).unwrap();
        let settings_object = settings_json.as_object_mut().unwrap();
        settings_object.remove("promptProfiles");
        settings_object.remove("activePromptId");
        settings_object.insert(
            "prompt".to_string(),
            serde_json::Value::String("旧版自定义提示词".to_string()),
        );

        let settings: AppSettings = serde_json::from_value(settings_json).unwrap();
        let settings = settings.normalize_prompt_profiles();

        assert_eq!(settings.active_prompt_id, DEFAULT_PROMPT_PROFILE_ID);
        assert_eq!(settings.prompt_profiles.len(), 1);
        assert_eq!(settings.prompt_profiles[0].content, "旧版自定义提示词");
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn normalizes_invalid_active_profile_to_first_profile() {
        let settings = AppSettings {
            prompt: "已过期内容".to_string(),
            active_prompt_id: "missing".to_string(),
            prompt_profiles: vec![PromptProfile {
                id: "profile-1".to_string(),
                name: "任务一".to_string(),
                content: "任务一提示词".to_string(),
            }],
            ..AppSettings::default()
        }
        .normalize_prompt_profiles();

        assert_eq!(settings.active_prompt_id, "profile-1");
        assert_eq!(settings.prompt, "任务一提示词");
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn rejects_duplicate_prompt_profile_ids() {
        let mut settings = AppSettings::default();
        settings.prompt_profiles.push(PromptProfile {
            id: settings.prompt_profiles[0].id.clone(),
            name: "重复提示词".to_string(),
            content: "另一段内容".to_string(),
        });

        assert!(settings.validate().is_err());
    }
}
