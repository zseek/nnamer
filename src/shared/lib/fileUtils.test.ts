import { describe, expect, it } from 'vitest';
import type { FileItem } from '../types';
import {
  applySuccessfulFileRenames,
  collectFileIdsLeavingStatusFilter,
  createConflictCleanupPlan,
  fileMatchesNameSearch,
  getFileIdsInSelectionRange,
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
      '建议名称使用了保留设备名，为确保文件可在 Windows、macOS 和 Linux 之间迁移，请更换名称'
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

describe('fileMatchesNameSearch', () => {
  const file = createFile('original', {
    originalName: 'AUTHOR-诡秘之主.txt',
    suggestedName: '诡秘之主',
    status: 'ready',
  });

  it('matches original and suggested names case-insensitively', () => {
    expect(fileMatchesNameSearch(file, 'author')).toBe(true);
    expect(fileMatchesNameSearch(file, '诡秘之主')).toBe(true);
    expect(fileMatchesNameSearch(file, 'AUTHOR')).toBe(true);
  });

  it('treats empty or whitespace-only queries as matching', () => {
    expect(fileMatchesNameSearch(file, '')).toBe(true);
    expect(fileMatchesNameSearch(file, '   ')).toBe(true);
  });

  it('does not search the status label', () => {
    expect(fileMatchesNameSearch(file, '可执行')).toBe(false);
  });
});

describe('getFileIdsInSelectionRange', () => {
  const orderedFiles = [
    createFile('first'),
    createFile('second'),
    createFile('third'),
    createFile('fourth'),
    createFile('fifth'),
  ];

  it('returns the inclusive range in forward and reverse order', () => {
    expect(getFileIdsInSelectionRange(orderedFiles, 'second', 'fourth')).toEqual([
      'second',
      'third',
      'fourth',
    ]);
    expect(getFileIdsInSelectionRange(orderedFiles, 'fourth', 'second')).toEqual([
      'second',
      'third',
      'fourth',
    ]);
  });

  it('returns no range when the anchor is absent or not visible', () => {
    expect(getFileIdsInSelectionRange(orderedFiles, null, 'third')).toEqual([]);
    expect(getFileIdsInSelectionRange(orderedFiles, 'missing', 'third')).toEqual([]);
    expect(getFileIdsInSelectionRange(orderedFiles, 'second', 'missing')).toEqual([]);
  });
});

describe('applySuccessfulFileRenames', () => {
  it('keeps successful files in the list with their current disk names', () => {
    const renamedFile = createFile('rename-success', {
      originalName: '旧书名.txt',
      originalStem: '旧书名',
      suggestedName: '新书名',
      normalizedName: '新书名',
      status: 'ready',
      selected: true,
    });
    const unrelatedFile = createFile('unrelated', {
      originalStem: '另一文件',
      suggestedName: '另一书名',
      normalizedName: '另一书名',
      status: 'ready',
    });

    const nextFiles = applySuccessfulFileRenames(
      [renamedFile, unrelatedFile],
      new Map([['rename-success', '新书名']])
    );

    expect(nextFiles).toHaveLength(2);
    expect(nextFiles[0]).toMatchObject({
      originalName: '新书名.txt',
      originalStem: '新书名',
      suggestedName: '新书名',
      normalizedName: '新书名',
      status: 'renamed',
      selected: false,
      hasBeenRenamed: true,
    });
    expect(nextFiles[1]).toBe(unrelatedFile);
  });

  it('allows a successfully renamed file to be renamed again', () => {
    const previouslyRenamedFile = createFile('rename-again', {
      originalName: '第一次书名.txt',
      originalStem: '第一次书名',
      suggestedName: '第二次书名',
      normalizedName: '第二次书名',
      status: 'ready',
      selected: true,
      hasBeenRenamed: true,
    });

    const nextFiles = applySuccessfulFileRenames(
      [previouslyRenamedFile],
      new Map([['rename-again', '第二次书名']])
    );

    expect(nextFiles[0]).toMatchObject({
      originalName: '第二次书名.txt',
      originalStem: '第二次书名',
      status: 'renamed',
      selected: false,
      hasBeenRenamed: true,
    });
  });
});

describe('renamed file conflict lifecycle', () => {
  it('moves renamed files into conflict and restores them after resolution', () => {
    const renamedFile = createFile('renamed', {
      originalName: '已占用书名.txt',
      originalStem: '已占用书名',
      suggestedName: '已占用书名',
      normalizedName: '已占用书名',
      status: 'renamed',
      hasBeenRenamed: true,
    });
    const editableFile = createFile('editable', {
      originalStem: '待改文件',
      suggestedName: '其它书名',
      normalizedName: '其它书名',
      status: 'ready',
    });

    const conflictingFiles = recomputeFileStatuses([
      renamedFile,
      {
        ...editableFile,
        suggestedName: '已占用书名',
        normalizedName: '已占用书名',
      },
    ]);

    expect(conflictingFiles.map((file) => file.status)).toEqual([
      'conflict',
      'conflict',
    ]);

    const resolvedFiles = recomputeFileStatuses([
      conflictingFiles[0],
      {
        ...conflictingFiles[1],
        suggestedName: '全新书名',
        normalizedName: '全新书名',
      },
    ]);

    expect(resolvedFiles.map((file) => file.status)).toEqual([
      'renamed',
      'ready',
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

  it('retains one file deterministically when the largest file size is tied', () => {
    const files = [
      createFile('first-largest', {
        originalName: '作者乙-相同书名.txt',
        sizeBytes: 600,
        suggestedName: '相同书名',
        normalizedName: '相同书名',
        status: 'conflict',
      }),
      createFile('second-largest', {
        originalName: '作者甲-相同书名.txt',
        sizeBytes: 600,
        suggestedName: '相同书名',
        normalizedName: '相同书名',
        status: 'conflict',
      }),
      createFile('smaller', {
        originalName: '作者丙-相同书名.txt',
        sizeBytes: 500,
        suggestedName: '相同书名',
        normalizedName: '相同书名',
        status: 'conflict',
      }),
    ];

    const cleanupPlan = createConflictCleanupPlan(files);

    expect(cleanupPlan.resolvableGroups).toHaveLength(1);
    // 体积相同时按原文件名排序，保留“作者甲-相同书名.txt”
    expect(cleanupPlan.resolvableGroups[0].retainedFile.id).toBe('second-largest');
    expect(
      cleanupPlan.resolvableGroups[0].filesToRemove.map((file) => file.id).sort()
    ).toEqual(['first-largest', 'smaller'].sort());
    expect(cleanupPlan.filesToRemove.map((file) => file.id).sort()).toEqual(
      ['first-largest', 'smaller'].sort()
    );
    expect(cleanupPlan.skippedGroups).toHaveLength(0);
  });

  it('retains any one file when all conflict members have the same size', () => {
    const files = [
      createFile('duplicate-b', {
        originalName: 'B-书名.txt',
        sizeBytes: 1024,
        suggestedName: '书名',
        normalizedName: '书名',
        status: 'conflict',
      }),
      createFile('duplicate-a', {
        originalName: 'A-书名.txt',
        sizeBytes: 1024,
        suggestedName: '书名',
        normalizedName: '书名',
        status: 'conflict',
      }),
    ];

    const cleanupPlan = createConflictCleanupPlan(files);

    expect(cleanupPlan.resolvableGroups).toHaveLength(1);
    expect(cleanupPlan.resolvableGroups[0].retainedFile.id).toBe('duplicate-a');
    expect(cleanupPlan.filesToRemove.map((file) => file.id)).toEqual([
      'duplicate-b',
    ]);
    expect(cleanupPlan.skippedGroups).toHaveLength(0);
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
