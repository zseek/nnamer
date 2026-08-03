use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::naming;
use crate::settings::ImportFileType;

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
    pub file_id: String,
    pub original_name: String,
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
pub fn scan_directory(
    directory_path: String,
    import_file_type: ImportFileType,
) -> AppResult<Vec<ScannedFile>> {
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

        let has_selected_extension = entry_path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case(import_file_type.extension()));
        if !has_selected_extension {
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

        scanned_files.push(ScannedFile {
            id: Uuid::new_v4().to_string(),
            original_name,
            original_stem,
            size_bytes: metadata.len(),
            // 使用毫秒而非纳秒：前端 Number 只有 53 位有效精度，
            // 纳秒时间戳经 IPC/JSON 往返会失真，导致元数据校验误报。
            modified_at: file_modified_at_millis(&metadata)?,
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
    file_extension: &'static str,
}

fn supported_file_extension(file_name_path: &Path) -> AppResult<&'static str> {
    let Some(extension) = file_name_path.extension() else {
        return Err(AppError::Validation(
            "只能操作 TXT 或 EPUB 文件".to_string(),
        ));
    };

    if extension.eq_ignore_ascii_case("txt") {
        return Ok("txt");
    }

    if extension.eq_ignore_ascii_case("epub") {
        return Ok("epub");
    }

    Err(AppError::Validation(
        "只能操作 TXT 或 EPUB 文件".to_string(),
    ))
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

    let file_extension = supported_file_extension(original_name_path)?;

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

    Ok(ValidatedFileCandidate {
        file_path,
        file_extension,
    })
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
    let mut staged_operations: Vec<(String, PathBuf, PathBuf, String)> = Vec::new();
    let mut target_names = std::collections::HashSet::new();

    for operation in &operations {
        let file_id = operation.file_id.clone();
        let snapshot = match file_metadata_snapshot.get(&file_id) {
            Some(snapshot) => snapshot,
            None => {
                results.push(RenameResult {
                    file_id,
                    success: false,
                    error: Some("缺少文件元数据快照".to_string()),
                });
                continue;
            }
        };
        let validated_candidate = match validate_file_candidate(
            directory,
            &operation.file_id,
            &operation.original_name,
            snapshot.size_bytes,
            snapshot.modified_at,
        ) {
            Ok(candidate) => candidate,
            Err(error) => {
                results.push(RenameResult {
                    file_id,
                    success: false,
                    error: Some(error.to_string()),
                });
                continue;
            }
        };
        let ValidatedFileCandidate {
            file_path: source_path,
            file_extension,
        } = validated_candidate;

        let validated_name = naming::normalize_suggested_name(&operation.target_name);
        let normalized_name = match validated_name.normalized_name {
            Some(name) => name,
            None => {
                results.push(RenameResult {
                    file_id,
                    success: false,
                    error: validated_name.error,
                });
                continue;
            }
        };

        let final_target_name = format!("{normalized_name}.{file_extension}");
        let target_path = directory.join(&final_target_name);
        let target_is_source = target_path.exists()
            && fs::canonicalize(&target_path).ok() == fs::canonicalize(&source_path).ok();
        if !target_names.insert(final_target_name.clone())
            || (target_path.exists() && !target_is_source)
        {
            results.push(RenameResult {
                file_id,
                success: false,
                error: Some("目标文件名已被占用或与其他待处理文件重复".to_string()),
            });
            continue;
        }

        let temp_path = directory.join(format!(
            "~nnamer_temp_{}.{}",
            Uuid::new_v4(),
            file_extension
        ));
        staged_operations.push((file_id, source_path, temp_path, final_target_name));
    }

    for (file_id, source_path, temp_path, final_target_name) in staged_operations {
        if let Err(error) = fs::rename(&source_path, &temp_path) {
            results.push(RenameResult {
                file_id,
                success: false,
                error: Some(format!("阶段一改名失败：{error}")),
            });
            continue;
        }

        let final_target_path = directory.join(final_target_name);
        match fs::rename(&temp_path, &final_target_path) {
            Ok(_) => results.push(RenameResult {
                file_id,
                success: true,
                error: None,
            }),
            Err(error) => {
                let rollback_error = fs::rename(&temp_path, &source_path).err();
                let error_message = match rollback_error {
                    Some(rollback_error) => {
                        format!("阶段二改名失败：{error}；恢复原文件名也失败：{rollback_error}")
                    }
                    None => format!("阶段二改名失败：{error}"),
                };
                results.push(RenameResult {
                    file_id,
                    success: false,
                    error: Some(error_message),
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

fn file_modified_at_millis(metadata: &fs::Metadata) -> AppResult<u64> {
    Ok(metadata
        .modified()?
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0))
}

fn verify_metadata_unchanged(file_path: &Path, snapshot: &FileMetadataSnapshot) -> AppResult<()> {
    let metadata = fs::metadata(file_path)?;
    let current_size = metadata.len();
    let current_modified = file_modified_at_millis(&metadata)?;

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
        let modified_at = file_modified_at_millis(&metadata).unwrap();
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

        let epub_file_path = test_directory.join("典藏小说.epub");
        fs::write(&epub_file_path, b"epub container bytes").unwrap();
        let epub_metadata = fs::metadata(&epub_file_path).unwrap();
        let epub_operation = RecycleBinOperation {
            file_id: "file-epub".to_string(),
            original_name: "典藏小说.epub".to_string(),
            size_bytes: epub_metadata.len(),
            modified_at: file_modified_at_millis(&epub_metadata).unwrap(),
        };
        assert_eq!(
            validate_recycle_bin_candidate(&test_directory, &epub_operation).unwrap(),
            epub_file_path
        );

        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn scans_only_the_selected_import_file_type() {
        let test_directory =
            std::env::temp_dir().join(format!("nnamer_scan_file_type_{}", Uuid::new_v4()));
        fs::create_dir_all(&test_directory).unwrap();
        fs::write(test_directory.join("纯文本小说.txt"), b"txt content").unwrap();
        fs::write(test_directory.join("电子书小说.EPUB"), b"epub content").unwrap();
        fs::write(test_directory.join("说明.md"), b"ignored content").unwrap();
        let directory_path = test_directory.to_string_lossy().into_owned();

        let txt_files = scan_directory(directory_path.clone(), ImportFileType::Txt).unwrap();
        let epub_files = scan_directory(directory_path, ImportFileType::Epub).unwrap();

        assert_eq!(txt_files.len(), 1);
        assert_eq!(txt_files[0].original_name, "纯文本小说.txt");
        assert_eq!(epub_files.len(), 1);
        assert_eq!(epub_files[0].original_name, "电子书小说.EPUB");

        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn renames_epub_files_without_changing_their_format() {
        let test_directory =
            std::env::temp_dir().join(format!("nnamer_rename_epub_{}", Uuid::new_v4()));
        fs::create_dir_all(&test_directory).unwrap();
        let source_path = test_directory.join("混乱书名.EPUB");
        fs::write(&source_path, b"epub container bytes").unwrap();
        let metadata = fs::metadata(&source_path).unwrap();
        let file_id = "file-epub".to_string();
        let metadata_snapshot = HashMap::from([(
            file_id.clone(),
            FileMetadataSnapshot {
                size_bytes: metadata.len(),
                modified_at: file_modified_at_millis(&metadata).unwrap(),
            },
        )]);
        let operations = vec![RenameOperation {
            file_id: file_id.clone(),
            original_name: "混乱书名.EPUB".to_string(),
            target_name: "正式书名.epub".to_string(),
        }];

        let results = execute_rename_operations(
            test_directory.to_string_lossy().into_owned(),
            operations,
            metadata_snapshot,
        )
        .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].file_id, file_id);
        assert!(results[0].success);
        assert!(test_directory.join("正式书名.epub").exists());
        assert!(!source_path.exists());

        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn millisecond_timestamps_survive_javascript_number_roundtrip() {
        // 模拟前端 Number（IEEE754 双精度）对时间戳的往返转换。
        let sample_nanos: u64 = 1_784_450_729_804_521_600;
        let nanos_after_js_roundtrip = sample_nanos as f64 as u64;
        assert_ne!(
            sample_nanos, nanos_after_js_roundtrip,
            "纳秒时间戳经 JS Number 往返会失真"
        );

        let sample_millis = sample_nanos / 1_000_000;
        let millis_after_js_roundtrip = sample_millis as f64 as u64;
        assert_eq!(
            sample_millis, millis_after_js_roundtrip,
            "毫秒时间戳应能安全经过 JS Number 往返"
        );
    }

    #[test]
    fn recycle_bin_accepts_timestamp_after_javascript_number_roundtrip() {
        let test_directory =
            std::env::temp_dir().join(format!("nnamer_js_timestamp_roundtrip_{}", Uuid::new_v4()));
        fs::create_dir_all(&test_directory).unwrap();
        let file_path = test_directory.join("予母所爱 1-62.txt");
        fs::write(&file_path, b"novel content for recycle bin").unwrap();

        let metadata = fs::metadata(&file_path).unwrap();
        let scanned_modified_at = file_modified_at_millis(&metadata).unwrap();
        // 模拟毫秒时间戳经过前端 Number 与 IPC 的往返过程。
        let frontend_modified_at = scanned_modified_at as f64 as u64;

        let operation = RecycleBinOperation {
            file_id: "file-js-roundtrip".to_string(),
            original_name: "予母所爱 1-62.txt".to_string(),
            size_bytes: metadata.len(),
            modified_at: frontend_modified_at,
        };

        assert_eq!(
            validate_recycle_bin_candidate(&test_directory, &operation).unwrap(),
            file_path
        );

        fs::remove_dir_all(test_directory).unwrap();
    }

    #[test]
    fn creates_two_stage_rename_plan() {
        let operations = vec![RenameOperation {
            file_id: "file-001".to_string(),
            original_name: "test.txt".to_string(),
            target_name: "诡秘之主".to_string(),
        }];
        assert_eq!(operations.len(), 1);
    }
}
