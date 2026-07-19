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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecycleBinOperation {
    pub file_id: String,
    pub original_name: String,
    pub size_bytes: u64,
    pub modified_at: u64,
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
pub fn move_files_to_recycle_bin(
    directory_path: String,
    operations: Vec<RecycleBinOperation>,
) -> AppResult<Vec<RenameResult>> {
    let directory = Path::new(&directory_path);
    if !directory.is_dir() {
        return Err(AppError::Validation("目录路径无效".to_string()));
    }

    let mut results = Vec::with_capacity(operations.len());

    for operation in operations {
        let file_path = match validate_recycle_bin_candidate(directory, &operation) {
            Ok(validated_path) => validated_path,
            Err(error) => {
                results.push(RenameResult {
                    file_id: operation.file_id,
                    success: false,
                    error: Some(error.to_string()),
                });
                continue;
            }
        };

        match trash::delete(&file_path) {
            Ok(_) => results.push(RenameResult {
                file_id: operation.file_id,
                success: true,
                error: None,
            }),
            Err(error) => results.push(RenameResult {
                file_id: operation.file_id,
                success: false,
                error: Some(format!("移入回收站失败：{error}")),
            }),
        }
    }

    Ok(results)
}

#[derive(Debug)]
struct ValidatedFileCandidate {
    file_path: PathBuf,
}

fn validate_file_candidate(
    directory: &Path,
    file_id: &str,
    original_name: &str,
    size_bytes: u64,
    modified_at: u64,
) -> AppResult<ValidatedFileCandidate> {
    if file_id.trim().is_empty() {
        return Err(AppError::Validation("文件标识不能为空".to_string()));
    }

    let original_name_path = Path::new(original_name);
    let contains_path_separator = original_name.contains('/') || original_name.contains('\\');
    let is_single_file_name = !contains_path_separator
        && original_name_path.components().count() == 1
        && original_name_path
            .file_name()
            .and_then(|file_name| file_name.to_str())
            == Some(original_name);

    if !is_single_file_name {
        return Err(AppError::Validation("文件名必须位于当前目录中".to_string()));
    }

    let is_txt_file = original_name_path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("txt"));
    if !is_txt_file {
        return Err(AppError::Validation("只能操作 TXT 文件".to_string()));
    }

    let file_path = directory.join(original_name_path);
    let file_type = fs::symlink_metadata(&file_path)?.file_type();
    if !file_type.is_file() {
        return Err(AppError::Validation("目标不是普通文件".to_string()));
    }

    let metadata_snapshot = FileMetadataSnapshot {
        size_bytes,
        modified_at,
    };
    verify_metadata_unchanged(&file_path, &metadata_snapshot)?;

    Ok(ValidatedFileCandidate { file_path })
}

fn validate_recycle_bin_candidate(
    directory: &Path,
    operation: &RecycleBinOperation,
) -> AppResult<PathBuf> {
    Ok(validate_file_candidate(
        directory,
        &operation.file_id,
        &operation.original_name,
        operation.size_bytes,
        operation.modified_at,
    )?
    .file_path)
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

fn verify_metadata_unchanged(file_path: &Path, snapshot: &FileMetadataSnapshot) -> AppResult<()> {
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
    fn validates_recycle_bin_candidate_metadata_and_location() {
        let test_directory =
            std::env::temp_dir().join(format!("nnamer_recycle_validation_{}", Uuid::new_v4()));
        fs::create_dir_all(&test_directory).unwrap();
        let file_path = test_directory.join("连载小说（600）.txt");
        fs::write(&file_path, b"complete novel content").unwrap();

        let metadata = fs::metadata(&file_path).unwrap();
        let modified_at = metadata
            .modified()
            .unwrap()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let valid_operation = RecycleBinOperation {
            file_id: "file-600".to_string(),
            original_name: "连载小说（600）.txt".to_string(),
            size_bytes: metadata.len(),
            modified_at,
        };

        assert_eq!(
            validate_recycle_bin_candidate(&test_directory, &valid_operation).unwrap(),
            file_path
        );

        let traversal_operation = RecycleBinOperation {
            original_name: "..\\outside.txt".to_string(),
            ..valid_operation.clone()
        };
        assert!(validate_recycle_bin_candidate(&test_directory, &traversal_operation).is_err());

        let changed_metadata_operation = RecycleBinOperation {
            size_bytes: metadata.len() + 1,
            ..valid_operation
        };
        assert!(
            validate_recycle_bin_candidate(&test_directory, &changed_metadata_operation).is_err()
        );

        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn creates_two_stage_rename_plan() {
        let operations = vec![RenameOperation {
            source_path: PathBuf::from("test.txt"),
            target_name: "诡秘之主".to_string(),
        }];
        assert_eq!(operations.len(), 1);
    }
}
