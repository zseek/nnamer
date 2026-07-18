import { invoke } from '@tauri-apps/api/core';
import type {
  AppSettings,
  BatchAnalysisResult,
  FileOperationResult,
  RecycleBinOperation,
  RenameResult,
  ScannedFile,
} from '../types';

export async function loadSettings(): Promise<AppSettings> {
  return await invoke<AppSettings>('load_settings');
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  return await invoke<AppSettings>('save_settings', { settings });
}

export async function scanDirectory(directoryPath: string): Promise<ScannedFile[]> {
  return await invoke<ScannedFile[]>('scan_directory', { directoryPath });
}

export async function analyzeBatch(
  settings: AppSettings,
  batchIndex: number,
  requests: Array<{ fileId: string; originalStem: string }>
): Promise<BatchAnalysisResult> {
  return await invoke<BatchAnalysisResult>('analyze_batch', {
    settings,
    batchIndex,
    requests,
  });
}

export async function moveFilesToRecycleBin(
  directoryPath: string,
  operations: RecycleBinOperation[]
): Promise<FileOperationResult[]> {
  return await invoke<FileOperationResult[]>('move_files_to_recycle_bin', {
    directoryPath,
    operations,
  });
}

export async function executeRenameOperations(
  directoryPath: string,
  operations: Array<{ sourcePath: string; targetName: string }>,
  fileMetadataSnapshot: Record<string, { sizeBytes: number; modifiedAt: number }>
): Promise<RenameResult[]> {
  return await invoke<RenameResult[]>('execute_rename_operations', {
    directoryPath,
    operations,
    fileMetadataSnapshot,
  });
}
