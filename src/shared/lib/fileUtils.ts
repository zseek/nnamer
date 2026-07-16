import type { FileItem, FileStatus, ConflictGroup } from '../types';

export function deriveFileStatus(
  file: FileItem,
  allFiles: FileItem[]
): FileStatus {
  if (!file.suggestedName) {
    return file.status === 'analyzing' ? 'analyzing' : 'unanalyzed';
  }

  if (file.error) {
    return 'analysisFailed';
  }

  if (!file.normalizedName) {
    return 'nameInvalid';
  }

  const normalizedOriginal = file.originalStem.toLowerCase().trim();
  const normalizedSuggested = file.normalizedName.toLowerCase().trim();

  if (normalizedOriginal === normalizedSuggested) {
    return 'nameSame';
  }

  const conflictingFiles = allFiles.filter(
    (other) =>
      other.id !== file.id &&
      other.normalizedName &&
      other.normalizedName.toLowerCase() === normalizedSuggested
  );

  if (conflictingFiles.length > 0) {
    return 'conflict';
  }

  return 'normal';
}

export function groupFilesByConflict(files: FileItem[]): ConflictGroup[] {
  const conflictMap = new Map<string, FileItem[]>();

  for (const file of files) {
    if (!file.normalizedName) continue;

    const canonical = file.normalizedName.toLowerCase();
    const group = conflictMap.get(canonical) || [];
    group.push(file);
    conflictMap.set(canonical, group);
  }

  const conflictGroups: ConflictGroup[] = [];

  for (const [normalizedName, groupFiles] of conflictMap.entries()) {
    if (groupFiles.length > 1) {
      const sortedBySize = [...groupFiles].sort(
        (a, b) => b.sizeBytes - a.sizeBytes
      );
      const largestSize = sortedBySize[0].sizeBytes;
      const largestFiles = sortedBySize.filter(
        (file) => file.sizeBytes === largestSize
      );

      conflictGroups.push({
        normalizedName,
        files: groupFiles,
        largestFileId: largestFiles.length === 1 ? largestFiles[0].id : undefined,
      });
    }
  }

  return conflictGroups;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getStatusLabel(status: FileStatus): string {
  const labels: Record<FileStatus, string> = {
    unanalyzed: '未分析',
    analyzing: '分析中',
    normal: '正常',
    nameSame: '名称相同',
    conflict: '冲突',
    analysisFailed: '分析失败',
    nameInvalid: '名称无效',
  };
  return labels[status];
}

export function getStatusColor(status: FileStatus): string {
  const colors: Record<FileStatus, string> = {
    unanalyzed: 'text-gray-500',
    analyzing: 'text-blue-600',
    normal: 'text-green-600',
    nameSame: 'text-gray-400',
    conflict: 'text-red-600',
    analysisFailed: 'text-orange-600',
    nameInvalid: 'text-red-700',
  };
  return colors[status];
}
