import type { FileItem, FileStatus, ConflictGroup } from '../types';

const MAX_STEM_CHARACTERS = 180;
const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

export interface SuggestedNameValidation {
  normalizedName?: string;
  error?: string;
}

export function stripTxtExtension(input: string): string {
  const inputWithoutTrailingWhitespace = input.trimEnd();
  if (!inputWithoutTrailingWhitespace.toLowerCase().endsWith('.txt')) {
    return input;
  }

  return inputWithoutTrailingWhitespace.slice(0, -4);
}

export function validateSuggestedName(input: string): SuggestedNameValidation {
  const extensionlessInput = stripTxtExtension(input.trim());
  const safeCharacters = extensionlessInput
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/[<>:"/\\|?*]/g, (character) => {
      const replacements: Record<string, string> = {
        '<': '＜',
        '>': '＞',
        ':': '：',
        '"': '＂',
        '/': '／',
        '\\': '＼',
        '|': '｜',
        '?': '？',
        '*': '＊',
      };
      return replacements[character];
    });

  const normalizedName = Array.from(safeCharacters.trim().replace(/[ .]+$/g, ''))
    .slice(0, MAX_STEM_CHARACTERS)
    .join('');

  if (!normalizedName) {
    return { error: '建议名称不能为空' };
  }

  const deviceNameCandidate = normalizedName.split('.')[0].toUpperCase();
  if (WINDOWS_RESERVED_NAMES.has(deviceNameCandidate)) {
    return { error: '建议名称是 Windows 保留设备名' };
  }

  return { normalizedName };
}

export function deriveFileStatus(
  file: FileItem,
  allFiles: FileItem[]
): FileStatus {
  if (file.status === 'analyzing' && !file.suggestedName && !file.error) {
    return 'analyzing';
  }

  if (file.error) {
    return 'failed';
  }

  if (!file.suggestedName) {
    return 'pending';
  }

  if (!file.normalizedName) {
    return 'failed';
  }

  const normalizedSuggested = file.normalizedName.toLocaleLowerCase();
  const conflictingFiles = allFiles.filter(
    (other) =>
      other.id !== file.id &&
      !other.error &&
      other.normalizedName &&
      other.normalizedName.toLocaleLowerCase() === normalizedSuggested
  );

  if (conflictingFiles.length > 0) {
    return 'conflict';
  }

  const normalizedOriginal = file.originalStem.trim().toLocaleLowerCase();
  if (normalizedSuggested === normalizedOriginal) {
    return 'unchanged';
  }

  return 'ready';
}

export function recomputeFileStatuses(files: FileItem[]): FileItem[] {
  const normalizedNameCounts = new Map<string, number>();

  for (const file of files) {
    if (file.error || !file.normalizedName) {
      continue;
    }

    const canonicalName = file.normalizedName.toLocaleLowerCase();
    normalizedNameCounts.set(
      canonicalName,
      (normalizedNameCounts.get(canonicalName) ?? 0) + 1
    );
  }

  return files.map((file) => ({
    ...file,
    status: deriveFileStatusFromCounts(file, normalizedNameCounts),
  }));
}

function deriveFileStatusFromCounts(
  file: FileItem,
  normalizedNameCounts: Map<string, number>
): FileStatus {
  if (file.status === 'analyzing' && !file.suggestedName && !file.error) {
    return 'analyzing';
  }

  if (file.error) {
    return 'failed';
  }

  if (!file.suggestedName) {
    return 'pending';
  }

  if (!file.normalizedName) {
    return 'failed';
  }

  const canonicalName = file.normalizedName.toLocaleLowerCase();
  if ((normalizedNameCounts.get(canonicalName) ?? 0) > 1) {
    return 'conflict';
  }

  const canonicalOriginalName = file.originalStem.trim().toLocaleLowerCase();
  if (canonicalName === canonicalOriginalName) {
    return 'unchanged';
  }

  return 'ready';
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
    pending: '待分析',
    analyzing: '分析中',
    ready: '可执行',
    unchanged: '无需修改',
    conflict: '冲突',
    failed: '失败',
  };
  return labels[status];
}

export function getStatusColor(status: FileStatus): string {
  const colors: Record<FileStatus, string> = {
    pending: 'text-gray-500',
    analyzing: 'text-blue-600',
    ready: 'text-green-600',
    unchanged: 'text-gray-500',
    conflict: 'text-orange-600',
    failed: 'text-red-600',
  };
  return colors[status];
}
