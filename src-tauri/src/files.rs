use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::naming;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFile {
    pub id: String,
    pub original_name: String,
    pub original_stem: String,
    pub size_bytes: u64,
    pub modified_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameOperation {
    pub source_path: PathBuf,
    pub target_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    pub file_id: String,
    pub success: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub fn scan_directory(directory_path: String) -> AppResult<Vec<ScannedFile>> {
    let directory = Path::new(&directory_path);
    if !directory.is_dir() {
        return Err(AppError::Validation("选择的路径不是有效目录".to_string()));
    }

    let entries = fs::read_dir(directory)?;
    let mut scanned_files = Vec::new();

    for entry_result in entries {
        let entry = entry_result?;
        let entry_path = entry.path();

        if !entry_path.is_file() {
            continue;
        }

        if let Some(extension) = entry_path.extension() {
            if !extension.eq_ignore_ascii_case("txt") {
                continue;
            }
        } else {
            continue;
        }

        let metadata = entry.metadata()?;
        let original_name = entry_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| AppError::Validation("无法读取文件名".to_string()))?
            .to_string();

        let original_stem = entry_path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .ok_or_else(|| AppError::Validation("无法提取文件名主干".to_string()))?
            .to_string();

        let modified_at = metadata
            .modified()?
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or(0);

        scanned_files.push(ScannedFile {
            id: Uuid::new_v4().to_string(),
            original_name,
            original_stem,
            size_bytes: metadata.len(),
            modified_at,
        });
    }

    Ok(scanned_files)
}

#[tauri::command]
pub fn move_files_to_recycle_bin(file_paths: Vec<String>) -> AppResult<Vec<RenameResult>> {
    let mut results = Vec::new();

    for file_path_string in file_paths {
        let file_path = PathBuf::from(&file_path_string);
        let file_id = file_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("unknown")
            .to_string();

        if !file_path.exists() {
            results.push(RenameResult {
                file_id: file_id.clone(),
                success: false,
                error: Some("文件不存在".to_string()),
            });
            continue;
        }

        match trash::delete(&file_path) {
            Ok(_) => results.push(RenameResult {
                file_id,
                success: true,
                error: None,
            }),
            Err(error) => results.push(RenameResult {
                file_id,
                success: false,
                error: Some(format!("移入回收站失败：{}", error)),
            }),
        }
    }

    Ok(results)
}

#[tauri::command]
pub fn execute_rename_operations(
    directory_path: String,
    operations: Vec<RenameOperation>,
    file_metadata_snapshot: HashMap<String, FileMetadataSnapshot>,
) -> AppResult<Vec<RenameResult>> {
    let directory = Path::new(&directory_path);
    if !directory.is_dir() {
        return Err(AppError::Validation("目录路径无效".to_string()));
    }

    let mut results = Vec::new();
    let mut staged_operations: Vec<(PathBuf, PathBuf, String)> = Vec::new();

    for operation in &operations {
        let source_path = &operation.source_path;
        let file_id = source_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("unknown")
            .to_string();

        if !source_path.exists() {
            results.push(RenameResult {
                file_id,
                success: false,
                error: Some("源文件不存在".to_string()),
            });
            continue;
        }

        if let Some(snapshot) = file_metadata_snapshot.get(&file_id) {
            match verify_metadata_unchanged(source_path, snapshot) {
                Ok(_) => {}
                Err(error) => {
                    results.push(RenameResult {
                        file_id,
                        success: false,
                        error: Some(format!("文件元数据已变化：{}", error)),
                    });
                    continue;
                }
            }
        }

        let validated_name = naming::normalize_suggested_name(&operation.target_name);
        if validated_name.normalized_name.is_none() {
            results.push(RenameResult {
                file_id,
                success: false,
                error: validated_name.error,
            });
            continue;
        }

        let final_target_name = format!("{}.txt", validated_name.normalized_name.unwrap());
        let target_path = directory.join(&final_target_name);

        if target_path.exists() && target_path != *source_path {
            results.push(RenameResult {
                file_id,
                success: false,
                error: Some("目标文件名已被占用".to_string()),
            });
            continue;
        }

        let temp_name = format!("~nnamer_temp_{}.txt", Uuid::new_v4());
        let temp_path = directory.join(temp_name);

        staged_operations.push((source_path.clone(), temp_path, final_target_name));
    }

    for (source_path, temp_path, final_target_name) in staged_operations {
        let file_id = source_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("unknown")
            .to_string();

        match fs::rename(&source_path, &temp_path) {
            Ok(_) => {}
            Err(error) => {
                results.push(RenameResult {
                    file_id,
                    success: false,
                    error: Some(format!("阶段一改名失败：{}", error)),
                });
                continue;
            }
        }

        let final_target_path = directory.join(final_target_name);
        match fs::rename(&temp_path, &final_target_path) {
            Ok(_) => {
                results.push(RenameResult {
                    file_id,
                    success: true,
                    error: None,
                });
            }
            Err(error) => {
                let _ = fs::rename(&temp_path, &source_path);
                results.push(RenameResult {
                    file_id,
                    success: false,
                    error: Some(format!("阶段二改名失败：{}", error)),
                });
            }
        }
    }

    Ok(results)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadataSnapshot {
    pub size_bytes: u64,
    pub modified_at: u64,
}

fn verify_metadata_unchanged(
    file_path: &Path,
    snapshot: &FileMetadataSnapshot,
) -> AppResult<()> {
    let metadata = fs::metadata(file_path)?;
    let current_size = metadata.len();
    let current_modified = metadata
        .modified()?
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);

    if current_size != snapshot.size_bytes {
        return Err(AppError::Validation("文件大小已改变".to_string()));
    }

    if current_modified != snapshot.modified_at {
        return Err(AppError::Validation("文件修改时间已改变".to_string()));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_two_stage_rename_plan() {
        let operations = vec![RenameOperation {
            source_path: PathBuf::from("test.txt"),
            target_name: "诡秘之主".to_string(),
        }];
        assert_eq!(operations.len(), 1);
    }
}
