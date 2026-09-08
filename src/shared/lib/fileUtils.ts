import type {
  ConflictCleanupPlan,
  ConflictGroup,
  FileItem,
  FileStatus,
  ImportFileType,
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

export function stripSupportedFileExtension(input: string): string {
  const inputWithoutTrailingWhitespace = input.trimEnd();
  const normalizedInput = inputWithoutTrailingWhitespace.toLocaleLowerCase();
  const supportedExtension = ['.epub', '.txt'].find(
    (extension) => normalizedInput.endsWith(extension)
  );

  if (!supportedExtension) {
    return input;
  }

  return inputWithoutTrailingWhitespace.slice(0, -supportedExtension.length);
}

export function getSupportedFileExtension(
  fileName: string
): ImportFileType | undefined {
  const normalizedFileName = fileName.trimEnd().toLocaleLowerCase();

  if (normalizedFileName.endsWith('.epub')) {
    return 'epub';
  }

  if (normalizedFileName.endsWith('.txt')) {
    return 'txt';
  }

  return undefined;
}

/** 统计字符串的 Unicode 字符数：中日韩与 emoji 均按 1 个字符计数。 */
export function countCharacters(input: string): number {
  return Array.from(input).length;
}

export function validateSuggestedName(input: string): SuggestedNameValidation {
  const extensionlessInput = stripSupportedFileExtension(input.trim());
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

function getCanonicalNormalizedName(
  file: Pick<FileItem, 'error' | 'normalizedName'>
): string | null {
  if (file.error || !file.normalizedName) {
    return null;
  }

  return file.normalizedName.toLocaleLowerCase();
}

/**
 * 编辑单个建议名后增量重算状态：只更新被编辑文件与其旧/新冲突组。
 * 使用单次数组拷贝 + 受影响名计次，避免多次全表 map/扫描。
 */
export function applySuggestedNameEdit(
  files: FileItem[],
  fileId: string,
  suggestedName: string,
  validation: SuggestedNameValidation
): FileItem[] {
  const editedFileIndex = files.findIndex((file) => file.id === fileId);
  if (editedFileIndex < 0) {
    return files;
  }

  const previousFile = files[editedFileIndex];
  const previousSuggestedName = previousFile.suggestedName ?? '';
  const previousNormalizedName = previousFile.normalizedName;
  const previousError = previousFile.error;
  const previousCanonicalName = getCanonicalNormalizedName(previousFile);
  const nextCanonicalName = validation.error || !validation.normalizedName
    ? null
    : validation.normalizedName.toLocaleLowerCase();

  // 内容与校验结果都未变时直接跳过，避免无意义的全表拷贝与状态重算。
  if (
    previousSuggestedName === suggestedName
    && previousNormalizedName === validation.normalizedName
    && previousError === validation.error
  ) {
    return files;
  }

  const nextEditedFileBase: FileItem = {
    ...previousFile,
    suggestedName,
    normalizedName: validation.normalizedName,
    error: validation.error,
    status: validation.error ? 'failed' : 'ready',
  };

  const affectedCanonicalNames = new Set<string>();
  if (previousCanonicalName) {
    affectedCanonicalNames.add(previousCanonicalName);
  }
  if (nextCanonicalName) {
    affectedCanonicalNames.add(nextCanonicalName);
  }

  // 无冲突组牵连时：只替换被编辑项，其它对象引用保持不变。
  if (affectedCanonicalNames.size === 0) {
    const nextStatus = deriveFileStatusFromCounts(
      nextEditedFileBase,
      new Map()
    );
    if (
      previousFile.suggestedName === nextEditedFileBase.suggestedName
      && previousFile.normalizedName === nextEditedFileBase.normalizedName
      && previousFile.error === nextEditedFileBase.error
      && previousFile.status === nextStatus
    ) {
      return files;
    }

    const nextFiles = files.slice();
    nextFiles[editedFileIndex] = {
      ...nextEditedFileBase,
      status: nextStatus,
    };
    return nextFiles;
  }

  const affectedNormalizedNameCounts = new Map<string, number>();
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = fileIndex === editedFileIndex
      ? nextEditedFileBase
      : files[fileIndex];
    const canonicalName = getCanonicalNormalizedName(file);
    if (!canonicalName || !affectedCanonicalNames.has(canonicalName)) {
      continue;
    }

    affectedNormalizedNameCounts.set(
      canonicalName,
      (affectedNormalizedNameCounts.get(canonicalName) ?? 0) + 1
    );
  }

  const nextFiles = files.slice();
  let didMutateAnyFile = false;

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const currentFile = fileIndex === editedFileIndex
      ? nextEditedFileBase
      : files[fileIndex];
    const canonicalName = getCanonicalNormalizedName(currentFile);
    const isEditedFile = fileIndex === editedFileIndex;
    const isAffectedConflictMember = Boolean(
      canonicalName && affectedCanonicalNames.has(canonicalName)
    );

    if (!isEditedFile && !isAffectedConflictMember) {
      continue;
    }

    const nextStatus = deriveFileStatusFromCounts(
      currentFile,
      affectedNormalizedNameCounts
    );

    if (isEditedFile) {
      if (
        previousFile.suggestedName === currentFile.suggestedName
        && previousFile.normalizedName === currentFile.normalizedName
        && previousFile.error === currentFile.error
        && previousFile.status === nextStatus
      ) {
        continue;
      }

      nextFiles[fileIndex] = {
        ...currentFile,
        status: nextStatus,
      };
      didMutateAnyFile = true;
      continue;
    }

    if (currentFile.status === nextStatus) {
      continue;
    }

    nextFiles[fileIndex] = {
      ...currentFile,
      status: nextStatus,
    };
    didMutateAnyFile = true;
  }

  return didMutateAnyFile ? nextFiles : files;
}

/**
 * 重置选中文件状态：清空建议名/错误，回到「待分析」；
 * 并重算冲突组中未重置成员的状态。
 * 分析中的条目也会被重置，且清除 analysisSessionId，避免稍后返回的分析结果覆盖。
 */
export function resetFileStatusesForFileIds(
  files: FileItem[],
  fileIds: ReadonlySet<string>
): FileItem[] {
  if (fileIds.size === 0) {
    return files;
  }

  let didResetAnyFile = false;
  const filesAfterReset = files.map((file) => {
    if (!fileIds.has(file.id)) {
      return file;
    }

    const isAlreadyPendingWithoutSuggestion =
      file.status === 'pending'
      && !file.suggestedName
      && !file.normalizedName
      && !file.error
      && !file.analysisSessionId;

    if (isAlreadyPendingWithoutSuggestion) {
      return file;
    }

    didResetAnyFile = true;
    return {
      ...file,
      suggestedName: undefined,
      normalizedName: undefined,
      error: undefined,
      analysisSessionId: undefined,
      status: 'pending' as const,
    };
  });

  if (!didResetAnyFile) {
    return files;
  }

  return recomputeFileStatuses(filesAfterReset);
}

/**
 * 将选中文件的建议名设为原文件名（originalStem），再重算状态。
 * 清除 error 与 analysisSessionId，避免旧错误或进行中的分析结果覆盖。
 * 结果通常为「无需修改」或「已重命名」（若该文件曾改过盘上名），同名时也可能为「冲突」。
 */
export function keepOriginalNamesForFileIds(
  files: FileItem[],
  fileIds: ReadonlySet<string>
): FileItem[] {
  if (fileIds.size === 0) {
    return files;
  }

  let didChangeAnyFile = false;
  const filesAfterKeep = files.map((file) => {
    if (!fileIds.has(file.id)) {
      return file;
    }

    const nextSuggestedName = file.originalStem;
    const validation = validateSuggestedName(nextSuggestedName);
    const nextNormalizedName = validation.normalizedName;
    const nextError = validation.error;

    if (
      file.suggestedName === nextSuggestedName
      && file.normalizedName === nextNormalizedName
      && file.error === nextError
      && !file.analysisSessionId
    ) {
      return file;
    }

    didChangeAnyFile = true;
    return {
      ...file,
      suggestedName: nextSuggestedName,
      normalizedName: nextNormalizedName,
      error: nextError,
      analysisSessionId: undefined,
      status: nextError ? ('failed' as const) : ('ready' as const),
    };
  });

  if (!didChangeAnyFile) {
    return files;
  }

  return recomputeFileStatuses(filesAfterKeep);
}

export function getSelectedExecutableFiles(
  files: FileItem[],
  selectedFileIds: ReadonlySet<string>
): FileItem[] {
  return files.filter(
    (file) => selectedFileIds.has(file.id) && file.status === 'ready'
  );
}

const reanalyzableFileStatuses = new Set<FileStatus>([
  'pending',
  'failed',
  'ready',
  'unchanged',
  'conflict',
  'renamed',
]);

export function isFileAnalyzable(file: Pick<FileItem, 'status'>): boolean {
  return reanalyzableFileStatuses.has(file.status);
}

export function getSelectedAnalyzableFiles(
  files: FileItem[],
  selectedFileIds: ReadonlySet<string>
): FileItem[] {
  return files.filter(
    (file) => selectedFileIds.has(file.id) && isFileAnalyzable(file)
  );
}

/** 大批量磁盘操作时前端分片大小，便于展示进度并避免单次 IPC 过久无反馈。 */
export const FILE_OPERATION_BATCH_SIZE = 200;

export function chunkItems<T>(
  items: ReadonlyArray<T>,
  batchSize: number = FILE_OPERATION_BATCH_SIZE
): T[][] {
  if (batchSize <= 0) {
    return [items.slice()];
  }

  const batches: T[][] = [];
  for (let batchStart = 0; batchStart < items.length; batchStart += batchSize) {
    batches.push(items.slice(batchStart, batchStart + batchSize));
  }

  return batches;
}

export interface FileNameSearchFields {
  includeOriginalName: boolean;
  includeSuggestedName: boolean;
}

const DEFAULT_FILE_NAME_SEARCH_FIELDS: FileNameSearchFields = {
  includeOriginalName: true,
  includeSuggestedName: true,
};

export function fileMatchesNameSearch(
  file: Pick<FileItem, 'originalName' | 'suggestedName'>,
  searchQuery: string,
  searchFields: FileNameSearchFields = DEFAULT_FILE_NAME_SEARCH_FIELDS
): boolean {
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  if (!normalizedSearchQuery) {
    return true;
  }

  const originalNameMatches = searchFields.includeOriginalName
    && file.originalName.toLocaleLowerCase().includes(normalizedSearchQuery);
  const suggestedNameMatches = searchFields.includeSuggestedName
    && Boolean(
      file.suggestedName
        ?.toLocaleLowerCase()
        .includes(normalizedSearchQuery)
    );

  return originalNameMatches || suggestedNameMatches;
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

    const fileExtension = getSupportedFileExtension(file.originalName) ?? 'txt';

    return {
      ...file,
      originalName: `${targetStem}.${fileExtension}`,
      originalStem: targetStem,
      suggestedName: targetStem,
      normalizedName: targetStem,
      error: undefined,
      status: 'renamed' as const,
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

export function createConflictCleanupPlan(
  files: FileItem[],
  options: {
    selectedOnly?: boolean;
    selectedFileIds?: ReadonlySet<string>;
  } = {}
): ConflictCleanupPlan {
  const conflictGroups = groupFilesByConflict(
    files.filter(
      (file) =>
        file.status === 'conflict'
        && !file.error
        && file.normalizedName
        && (
          !options.selectedOnly
          || (options.selectedFileIds?.has(file.id) ?? false)
        )
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
