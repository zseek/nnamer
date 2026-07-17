import { describe, expect, it } from 'vitest';
import type { FileItem } from '../types';
import {
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

describe('recomputeFileStatuses', () => {
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
