import { describe, expect, it } from 'vitest';
import type { FileItem } from '../types';
import {
  collectFileIdsLeavingStatusFilter,
  createConflictCleanupPlan,
  getSelectedExecutableFiles,
  recomputeFileStatuses,
  stripTxtExtension,
  validateSuggestedName,
} from './fileUtils';

function createFile(
  id: string,
  overrides: Partial<FileItem> = {}
): FileItem {
  return {
    id,
    originalName: `${id}.txt`,
    originalStem: id,
    sizeBytes: 1024,
    modifiedAt: 0,
    status: 'pending',
    selected: false,
    ...overrides,
  };
}

describe('stripTxtExtension', () => {
  it('removes only a trailing TXT extension, case-insensitively', () => {
    expect(stripTxtExtension('诡秘之主.txt')).toBe('诡秘之主');
    expect(stripTxtExtension('诡秘之主.TXT')).toBe('诡秘之主');
    expect(stripTxtExtension('版本.txt.backup')).toBe('版本.txt.backup');
  });
});

describe('validateSuggestedName', () => {
  it('normalizes extensions and Windows-invalid characters', () => {
    expect(validateSuggestedName('  诡秘:之主?.TXT  ')).toEqual({
      normalizedName: '诡秘：之主？',
    });
  });

  it('rejects empty and reserved Windows names', () => {
    expect(validateSuggestedName('  ').error).toBe('建议名称不能为空');
    expect(validateSuggestedName('CON.txt').error).toBe(
      '建议名称是 Windows 保留设备名'
    );
  });
});

describe('getSelectedExecutableFiles', () => {
  it('returns only selected files that are currently executable', () => {
    const files = [
      createFile('selected-ready', {
        selected: true,
        status: 'ready',
      }),
      createFile('unselected-ready', {
        selected: false,
        status: 'ready',
      }),
      createFile('selected-conflict', {
        selected: true,
        status: 'conflict',
      }),
      createFile('selected-failed', {
        selected: true,
        status: 'failed',
      }),
    ];

    expect(getSelectedExecutableFiles(files).map((file) => file.id)).toEqual([
      'selected-ready',
    ]);
  });
});

describe('collectFileIdsLeavingStatusFilter', () => {
  it('retains every conflict member that leaves the filter after one rename', () => {
    const previousFiles = [
      createFile('edited', {
        suggestedName: '相同书名',
        normalizedName: '相同书名',
        status: 'conflict',
      }),
      createFile('sibling', {
        suggestedName: '相同书名',
        normalizedName: '相同书名',
        status: 'conflict',
      }),
      createFile('unrelated-conflict-a', {
        suggestedName: '另一冲突',
        normalizedName: '另一冲突',
        status: 'conflict',
      }),
      createFile('unrelated-conflict-b', {
        suggestedName: '另一冲突',
        normalizedName: '另一冲突',
        status: 'conflict',
      }),
      createFile('unrelated-ready', {
        suggestedName: '无关可执行',
        normalizedName: '无关可执行',
        status: 'ready',
      }),
    ];

    const nextFiles = recomputeFileStatuses(
      previousFiles.map((file) =>
        file.id === 'edited'
          ? {
              ...file,
              suggestedName: '新书名',
              normalizedName: '新书名',
              status: 'ready' as const,
            }
          : file
      )
    );

    expect(nextFiles.map((file) => file.status)).toEqual([
      'ready',
      'ready',
      'conflict',
      'conflict',
      'ready',
    ]);
    expect(
      collectFileIdsLeavingStatusFilter(previousFiles, nextFiles, 'conflict')
    ).toEqual(['edited', 'sibling']);
  });

  it('retains both files when a ready-list edit creates a new conflict pair', () => {
    const previousFiles = [
      createFile('edited', {
        suggestedName: '书名甲',
        normalizedName: '书名甲',
        status: 'ready',
      }),
      createFile('target', {
        suggestedName: '书名乙',
        normalizedName: '书名乙',
        status: 'ready',
      }),
    ];

    const nextFiles = recomputeFileStatuses(
      previousFiles.map((file) =>
        file.id === 'edited'
          ? {
              ...file,
              suggestedName: '书名乙',
              normalizedName: '书名乙',
              status: 'ready' as const,
            }
          : file
      )
    );

    expect(nextFiles.map((file) => file.status)).toEqual([
      'conflict',
      'conflict',
    ]);
    expect(
      collectFileIdsLeavingStatusFilter(previousFiles, nextFiles, 'ready')
    ).toEqual(['edited', 'target']);
  });
});

describe('createConflictCleanupPlan', () => {
  it('retains the unique largest file and schedules smaller conflicts for removal', () => {
    const files = [
      createFile('smaller', {
        originalName: '连载小说（556）.txt',
        sizeBytes: 556,
        suggestedName: '连载小说',
        normalizedName: '连载小说',
        status: 'conflict',
      }),
      createFile('largest', {
        originalName: '连载小说（600）.txt',
        sizeBytes: 600,
        suggestedName: '连载小说',
        normalizedName: '连载小说',
        status: 'conflict',
      }),
      createFile('smallest', {
        originalName: '连载小说（500）.txt',
        sizeBytes: 500,
        suggestedName: '连载小说',
        normalizedName: '连载小说',
        status: 'conflict',
      }),
    ];

    const cleanupPlan = createConflictCleanupPlan(files);

    expect(cleanupPlan.resolvableGroups).toHaveLength(1);
    expect(cleanupPlan.resolvableGroups[0].retainedFile.id).toBe('largest');
    expect(
      cleanupPlan.resolvableGroups[0].filesToRemove.map((file) => file.id)
    ).toEqual(['smaller', 'smallest']);
    expect(cleanupPlan.filesToRemove.map((file) => file.id)).toEqual([
      'smaller',
      'smallest',
    ]);
    expect(cleanupPlan.skippedGroups).toHaveLength(0);
  });

  it('skips a conflict group when the largest file size is tied', () => {
    const files = [
      createFile('first-largest', {
        sizeBytes: 600,
        suggestedName: '相同书名',
        normalizedName: '相同书名',
        status: 'conflict',
      }),
      createFile('second-largest', {
        sizeBytes: 600,
        suggestedName: '相同书名',
        normalizedName: '相同书名',
        status: 'conflict',
      }),
      createFile('smaller', {
        sizeBytes: 500,
        suggestedName: '相同书名',
        normalizedName: '相同书名',
        status: 'conflict',
      }),
    ];

    const cleanupPlan = createConflictCleanupPlan(files);

    expect(cleanupPlan.resolvableGroups).toHaveLength(0);
    expect(cleanupPlan.filesToRemove).toHaveLength(0);
    expect(cleanupPlan.skippedGroups).toHaveLength(1);
    expect(cleanupPlan.skippedGroups[0].largestFileId).toBeUndefined();
  });

  it('ignores duplicate names that are not currently valid conflicts', () => {
    const files = [
      createFile('ready', {
        sizeBytes: 600,
        suggestedName: '相同书名',
        normalizedName: '相同书名',
        status: 'ready',
      }),
      createFile('failed', {
        sizeBytes: 500,
        suggestedName: '相同书名',
        normalizedName: '相同书名',
        error: '分析失败',
        status: 'failed',
      }),
    ];

    const cleanupPlan = createConflictCleanupPlan(files);

    expect(cleanupPlan.resolvableGroups).toHaveLength(0);
    expect(cleanupPlan.skippedGroups).toHaveLength(0);
    expect(cleanupPlan.filesToRemove).toHaveLength(0);
  });
});

describe('recomputeFileStatuses', () => {
  it('preserves file references when their derived status does not change', () => {
    const stableReadyFile = createFile('stable-ready', {
      originalStem: '原书名',
      suggestedName: '新书名',
      normalizedName: '新书名',
      status: 'ready',
    });

    const recomputedFiles = recomputeFileStatuses([stableReadyFile]);

    expect(recomputedFiles[0]).toBe(stableReadyFile);
  });

  it('marks duplicate suggestions as conflicts', () => {
    const files = [
      createFile('first', {
        suggestedName: '诡秘之主',
        normalizedName: '诡秘之主',
        status: 'ready',
      }),
      createFile('second', {
        suggestedName: '诡秘之主',
        normalizedName: '诡秘之主',
        status: 'ready',
      }),
    ];

    expect(recomputeFileStatuses(files).map((file) => file.status)).toEqual([
      'conflict',
      'conflict',
    ]);
  });

  it('automatically clears conflicts after a suggestion changes', () => {
    const files = [
      createFile('first', {
        suggestedName: '诡秘之主',
        normalizedName: '诡秘之主',
        status: 'conflict',
      }),
      createFile('second', {
        suggestedName: '宿命之环',
        normalizedName: '宿命之环',
        status: 'conflict',
      }),
    ];

    expect(recomputeFileStatuses(files).map((file) => file.status)).toEqual([
      'ready',
      'ready',
    ]);
  });

  it('preserves active analysis and reports validation failures', () => {
    const files = [
      createFile('analyzing', { status: 'analyzing' }),
      createFile('failed', {
        suggestedName: '',
        error: '建议名称不能为空',
        status: 'failed',
      }),
    ];

    expect(recomputeFileStatuses(files).map((file) => file.status)).toEqual([
      'analyzing',
      'failed',
    ]);
  });

  it('separates suggestions identical to their source names', () => {
    const files = [
      createFile('source', {
        originalStem: '诡秘之主',
        suggestedName: '诡秘之主',
        normalizedName: '诡秘之主',
        status: 'ready',
      }),
    ];

    expect(recomputeFileStatuses(files)[0].status).toBe('unchanged');
  });

  it('moves an unchanged file to ready after manual editing', () => {
    const files = [
      createFile('source', {
        originalStem: '诡秘之主',
        suggestedName: '宿命之环',
        normalizedName: '宿命之环',
        status: 'unchanged',
      }),
    ];

    expect(recomputeFileStatuses(files)[0].status).toBe('ready');
  });

  it('prioritizes duplicate conflicts over unchanged names', () => {
    const files = [
      createFile('first', {
        originalStem: '相同书名',
        suggestedName: '相同书名',
        normalizedName: '相同书名',
        status: 'ready',
      }),
      createFile('second', {
        originalStem: '另一本书',
        suggestedName: '相同书名',
        normalizedName: '相同书名',
        status: 'ready',
      }),
    ];

    expect(recomputeFileStatuses(files).map((file) => file.status)).toEqual([
      'conflict',
      'conflict',
    ]);
  });
});
