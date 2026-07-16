import { invoke } from '@tauri-apps/api/core';
import type { AppSettings } from '../types';

export async function loadSettings(): Promise<AppSettings> {
  return await invoke<AppSettings>('load_settings');
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  return await invoke<AppSettings>('save_settings', { settings });
}

export async function scanDirectory(directoryPath: string): Promise<any[]> {
  return await invoke('scan_directory', { directoryPath });
}

export async function analyzeBatch(
  settings: AppSettings,
  batchIndex: number,
  requests: Array<{ fileId: string; originalStem: string }>
): Promise<any> {
  return await invoke('analyze_batch', { settings, batchIndex, requests });
}

export async function moveFilesToRecycleBin(filePaths: string[]): Promise<any[]> {
  return await invoke('move_files_to_recycle_bin', { filePaths });
}

export async function executeRenameOperations(
  directoryPath: string,
  operations: Array<{ sourcePath: string; targetName: string }>,
  fileMetadataSnapshot: Record<string, { sizeBytes: number; modifiedAt: number }>
): Promise<any[]> {
  return await invoke('execute_rename_operations', {
    directoryPath,
    operations,
    fileMetadataSnapshot,
  });
}
