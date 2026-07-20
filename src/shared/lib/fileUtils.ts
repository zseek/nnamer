import type {
  ConflictCleanupPlan,
  ConflictGroup,
  FileItem,
  FileStatus,
  ResolvableConflictGroup,
} from '../types';

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
    return {
      error: '建议名称使用了保留设备名，为确保文件可在 Windows、macOS 和 Linux 之间迁移，请更换名称',
    };
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
    return file.hasBeenRenamed ? 'renamed' : 'unchanged';
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

  return files.map((file) => {
    const nextStatus = deriveFileStatusFromCounts(file, normalizedNameCounts);

    if (file.status === nextStatus) {
      return file;
    }

    return {
      ...file,
      status: nextStatus,
    };
  });
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
    return file.hasBeenRenamed ? 'renamed' : 'unchanged';
  }

  return 'ready';
}

export function getSelectedExecutableFiles(files: FileItem[]): FileItem[] {
  return files.filter((file) => file.selected && file.status === 'ready');
}

export function fileMatchesNameSearch(
  file: Pick<FileItem, 'originalName' | 'suggestedName'>,
  searchQuery: string
): boolean {
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  if (!normalizedSearchQuery) {
    return true;
  }

  return [file.originalName, file.suggestedName]
    .filter((fileName): fileName is string => Boolean(fileName))
    .some((fileName) =>
      fileName.toLocaleLowerCase().includes(normalizedSearchQuery)
    );
}

export function getFileIdsInSelectionRange(
  orderedFiles: ReadonlyArray<Pick<FileItem, 'id'>>,
  anchorFileId: string | null,
  targetFileId: string
): string[] {
  if (!anchorFileId) {
    return [];
  }

  const anchorIndex = orderedFiles.findIndex(
    (file) => file.id === anchorFileId
  );
  const targetIndex = orderedFiles.findIndex(
    (file) => file.id === targetFileId
  );

  if (anchorIndex < 0 || targetIndex < 0) {
    return [];
  }

  const rangeStartIndex = Math.min(anchorIndex, targetIndex);
  const rangeEndIndex = Math.max(anchorIndex, targetIndex);

  return orderedFiles
    .slice(rangeStartIndex, rangeEndIndex + 1)
    .map((file) => file.id);
}

export function applySuccessfulFileRenames(
  files: FileItem[],
  renamedFileTargetById: ReadonlyMap<string, string>
): FileItem[] {
  const filesWithSuccessfulRenames = files.map((file) => {
    const targetStem = renamedFileTargetById.get(file.id);
    if (!targetStem) {
      return file;
    }

    return {
      ...file,
      originalName: `${targetStem}.txt`,
      originalStem: targetStem,
      suggestedName: targetStem,
      normalizedName: targetStem,
      error: undefined,
      status: 'renamed' as const,
      selected: false,
      hasBeenRenamed: true,
    };
  });

  return recomputeFileStatuses(filesWithSuccessfulRenames);
}

export function collectFileIdsLeavingStatusFilter(
  previousFiles: FileItem[],
  nextFiles: FileItem[],
  activeStatusFilter: FileStatus
): string[] {
  const previousStatusByFileId = new Map(
    previousFiles.map((file) => [file.id, file.status])
  );
  const fileIdsLeavingFilter: string[] = [];

  for (const nextFile of nextFiles) {
    const previousStatus = previousStatusByFileId.get(nextFile.id);
    if (previousStatus === undefined) {
      continue;
    }

    const wasMatchingFilter = previousStatus === activeStatusFilter;
    const stillMatchingFilter = nextFile.status === activeStatusFilter;

    if (wasMatchingFilter && !stillMatchingFilter) {
      fileIdsLeavingFilter.push(nextFile.id);
    }
  }

  return fileIdsLeavingFilter;
}

function compareConflictRetentionPriority(
  leftFile: FileItem,
  rightFile: FileItem
): number {
  // 优先保留体积更大的副本；体积相同时按原文件名稳定排序，保证清理结果可复现。
  if (rightFile.sizeBytes !== leftFile.sizeBytes) {
    return rightFile.sizeBytes - leftFile.sizeBytes;
  }

  const originalNameComparison = leftFile.originalName.localeCompare(
    rightFile.originalName,
    'zh-CN'
  );
  if (originalNameComparison !== 0) {
    return originalNameComparison;
  }

  return leftFile.id.localeCompare(rightFile.id);
}

export function groupFilesByConflict(files: FileItem[]): ConflictGroup[] {
  const conflictMap = new Map<string, FileItem[]>();

  for (const file of files) {
    if (!file.normalizedName) continue;

    const canonical = file.normalizedName.toLocaleLowerCase();
    const group = conflictMap.get(canonical) || [];
    group.push(file);
    conflictMap.set(canonical, group);
  }

  const conflictGroups: ConflictGroup[] = [];

  for (const groupFiles of conflictMap.values()) {
    if (groupFiles.length > 1) {
      const sortedForRetention = [...groupFiles].sort(
        compareConflictRetentionPriority
      );

      conflictGroups.push({
        normalizedName: groupFiles[0].normalizedName!,
        files: groupFiles,
        // 即使多个文件大小相同，也确定性地保留其中一个，其余可自动清理。
        largestFileId: sortedForRetention[0].id,
      });
    }
  }

  return conflictGroups;
}

export function createConflictCleanupPlan(files: FileItem[]): ConflictCleanupPlan {
  const conflictGroups = groupFilesByConflict(
    files.filter(
      (file) => file.status === 'conflict' && !file.error && file.normalizedName
    )
  );
  const resolvableGroups: ResolvableConflictGroup[] = [];
  const skippedGroups: ConflictGroup[] = [];

  for (const conflictGroup of conflictGroups) {
    const retainedFile = conflictGroup.files.find(
      (file) => file.id === conflictGroup.largestFileId
    );
    if (!retainedFile) {
      skippedGroups.push(conflictGroup);
      continue;
    }

    resolvableGroups.push({
      normalizedName: conflictGroup.normalizedName,
      retainedFile,
      filesToRemove: conflictGroup.files.filter(
        (file) => file.id !== retainedFile.id
      ),
    });
  }

  return {
    resolvableGroups,
    skippedGroups,
    filesToRemove: resolvableGroups.flatMap(
      (conflictGroup) => conflictGroup.filesToRemove
    ),
  };
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
    renamed: '已重命名',
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
    renamed: 'text-blue-600',
    conflict: 'text-orange-600',
    failed: 'text-red-600',
  };
  return colors[status];
}
