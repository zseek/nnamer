import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from './store';
import {
  getStatusLabel,
  recomputeFileStatuses,
  stripTxtExtension,
  validateSuggestedName,
} from './shared/lib/fileUtils';
import type { FileStatus } from './shared/types';

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: 'hsl(var(--color-surface))',
  },
  filterBar: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 12px',
    background: 'hsl(var(--color-surface))',
    borderBottom: '1px solid hsl(var(--color-border))',
  },
  filterLabel: {
    marginRight: '4px',
    color: 'hsl(var(--color-text-secondary))',
    fontSize: '11px',
  },
  filterButton: {
    minHeight: '26px',
    padding: '3px 9px',
    border: '1px solid transparent',
    borderRadius: '4px',
    background: 'transparent',
    color: 'hsl(var(--color-text-secondary))',
    fontSize: '11px',
  },
  filterButtonActive: {
    borderColor: 'hsl(var(--color-border))',
    background: 'hsl(var(--color-background))',
    color: 'hsl(var(--color-text))',
    fontWeight: 600,
  },
  tableScroller: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '12px',
  },
  th: {
    position: 'sticky',
    top: 0,
    background: 'hsl(var(--color-background))',
    padding: '6px 8px',
    textAlign: 'left',
    borderBottom: '1px solid hsl(var(--color-border))',
    fontWeight: 600,
    fontSize: '11px',
    color: 'hsl(var(--color-text-secondary))',
    cursor: 'default',
    userSelect: 'none',
    zIndex: 1,
  },
  thSortable: {
    cursor: 'pointer',
    userSelect: 'none',
  },
  td: {
    padding: '8px 12px',
    borderBottom: '1px solid hsl(var(--color-border))',
  },
  row: {
    cursor: 'default',
  },
  input: {
    width: '100%',
    padding: '5px 10px',
    border: '1px solid hsl(var(--color-border))',
    borderRadius: '4px',
    fontSize: '13px',
  },
  statusCell: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  filteredEmpty: {
    padding: '32px 12px',
    color: 'hsl(var(--color-text-secondary))',
    textAlign: 'center',
  },
};

type SortField = 'originalStem' | 'suggestedName' | null;
type SortOrder = 'asc' | 'desc';
type StatusFilter = FileStatus | 'all';

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待分析' },
  { value: 'analyzing', label: '分析中' },
  { value: 'ready', label: '可执行' },
  { value: 'unchanged', label: '无需修改' },
  { value: 'conflict', label: '冲突' },
  { value: 'failed', label: '失败' },
];

const STATUS_CLASSES: Record<FileStatus, string> = {
  pending: 'status-pending',
  analyzing: 'status-analyzing',
  ready: 'status-ready',
  unchanged: 'status-unchanged',
  conflict: 'status-conflict',
  failed: 'status-failed',
};

export default function FileList() {
  const { files, setFiles } = useAppStore();
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [activeStatusFilter, setActiveStatusFilter] = useState<StatusFilter>('all');
  const [retainedEditedFileIds, setRetainedEditedFileIds] = useState<Set<string>>(
    () => new Set()
  );
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);

  const statusCounts = useMemo<Record<StatusFilter, number>>(() => {
    const counts: Record<StatusFilter, number> = {
      all: files.length,
      pending: 0,
      analyzing: 0,
      ready: 0,
      unchanged: 0,
      conflict: 0,
      failed: 0,
    };

    for (const file of files) {
      counts[file.status] += 1;
    }

    return counts;
  }, [files]);

  const filteredFiles = useMemo(
    () => files.filter(
      (file) =>
        activeStatusFilter === 'all'
        || file.status === activeStatusFilter
        || retainedEditedFileIds.has(file.id)
    ),
    [activeStatusFilter, files, retainedEditedFileIds]
  );

  const sortedFiles = useMemo(() => {
    const filesToSort = [...filteredFiles];
    if (!sortField) {
      return filesToSort;
    }

    return filesToSort.sort((firstFile, secondFile) => {
      const firstValue = sortField === 'originalStem'
        ? firstFile.originalStem
        : firstFile.suggestedName ?? '';
      const secondValue = sortField === 'originalStem'
        ? secondFile.originalStem
        : secondFile.suggestedName ?? '';
      const comparison = firstValue.localeCompare(secondValue, 'zh-CN', {
        sensitivity: 'base',
        numeric: true,
      });

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [filteredFiles, sortField, sortOrder]);

  const selectedFilteredCount = filteredFiles.reduce(
    (selectedCount, file) => selectedCount + Number(file.selected),
    0
  );
  const areAllFilteredFilesSelected =
    filteredFiles.length > 0 && selectedFilteredCount === filteredFiles.length;
  const areSomeFilteredFilesSelected =
    selectedFilteredCount > 0 && !areAllFilteredFilesSelected;

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = areSomeFilteredFilesSelected;
    }
  }, [areSomeFilteredFilesSelected]);

  if (files.length === 0) {
    return (
      <div style={{ 
        ...styles.container, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        color: 'hsl(var(--color-text-secondary))'
      }}>
        请选择目录开始扫描文件
      </div>
    );
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const handleSelectAll = (checked: boolean) => {
    const filteredFileIds = new Set(filteredFiles.map((file) => file.id));
    setFiles((currentFiles) =>
      currentFiles.map((file) =>
        filteredFileIds.has(file.id) ? { ...file, selected: checked } : file
      )
    );
  };

  const handleStatusFilterChange = (statusFilter: StatusFilter) => {
    setActiveStatusFilter(statusFilter);
    setRetainedEditedFileIds(new Set());
  };

  const handleSuggestedNameChange = (fileId: string, inputValue: string) => {
    if (activeStatusFilter !== 'all') {
      setRetainedEditedFileIds((currentFileIds) => {
        if (currentFileIds.has(fileId)) {
          return currentFileIds;
        }

        const nextFileIds = new Set(currentFileIds);
        nextFileIds.add(fileId);
        return nextFileIds;
      });
    }

    const suggestedName = stripTxtExtension(inputValue);
    const validation = validateSuggestedName(suggestedName);

    setFiles((currentFiles) => {
      const editedFiles = currentFiles.map((file) =>
        file.id === fileId
          ? {
              ...file,
              suggestedName,
              normalizedName: validation.normalizedName,
              error: validation.error,
              status: validation.error ? 'failed' as const : 'ready' as const,
            }
          : file
      );

      return recomputeFileStatuses(editedFiles);
    });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getSortIndicator = (field: SortField) => {
    if (sortField !== field) return '';
    return sortOrder === 'asc' ? ' ▲' : ' ▼';
  };

  return (
    <div style={styles.container}>
      <div style={styles.filterBar} role="toolbar" aria-label="文件状态筛选">
        <span style={styles.filterLabel}>状态筛选</span>
        {STATUS_FILTERS.map((filter) => {
          const isActive = activeStatusFilter === filter.value;
          return (
            <button
              key={filter.value}
              type="button"
              aria-pressed={isActive}
              style={{
                ...styles.filterButton,
                ...(isActive ? styles.filterButtonActive : {}),
              }}
              onClick={() => handleStatusFilterChange(filter.value)}
            >
              {filter.label} ({statusCounts[filter.value]})
            </button>
          );
        })}
      </div>

      <div style={styles.tableScroller}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={{ ...styles.th, width: '30px' }}>
                <input
                  ref={selectAllCheckboxRef}
                  type="checkbox"
                  aria-label={`选择当前筛选中的 ${filteredFiles.length} 个文件`}
                  checked={areAllFilteredFilesSelected}
                  disabled={filteredFiles.length === 0}
                  onChange={(event) => handleSelectAll(event.target.checked)}
                />
              </th>
              <th
                style={{ ...styles.th, ...styles.thSortable, width: '35%' }}
                onClick={() => handleSort('originalStem')}
              >
                原文件名{getSortIndicator('originalStem')}
              </th>
              <th
                style={{ ...styles.th, ...styles.thSortable, width: '35%' }}
                onClick={() => handleSort('suggestedName')}
              >
                建议文件名{getSortIndicator('suggestedName')}
              </th>
              <th style={{ ...styles.th, width: '80px' }}>大小</th>
              <th style={{ ...styles.th, width: '100px' }}>状态</th>
            </tr>
          </thead>
          <tbody>
            {sortedFiles.map((file) => (
              <tr
                key={file.id}
                style={styles.row}
                onMouseEnter={(event) => {
                  event.currentTarget.style.background = 'hsl(var(--color-background))';
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background = '';
                }}
              >
                <td style={styles.td}>
                  <input
                    type="checkbox"
                    aria-label={`选择 ${file.originalStem}`}
                    checked={file.selected}
                    onChange={(event) => {
                      const isSelected = event.target.checked;
                      setFiles((currentFiles) =>
                        currentFiles.map((currentFile) =>
                          currentFile.id === file.id
                            ? { ...currentFile, selected: isSelected }
                            : currentFile
                        )
                      );
                    }}
                  />
                </td>
                <td style={{ ...styles.td, fontSize: '13px' }}>
                  {file.originalStem}
                </td>
                <td style={styles.td}>
                  {file.status === 'pending' || file.status === 'analyzing' ? (
                    <span style={{ color: 'hsl(var(--color-text-secondary))' }}>-</span>
                  ) : (
                    <input
                      style={styles.input}
                      value={file.suggestedName ?? ''}
                      aria-label={`${file.originalStem} 的建议文件名`}
                      title={file.error}
                      onChange={(event) =>
                        handleSuggestedNameChange(file.id, event.target.value)
                      }
                    />
                  )}
                </td>
                <td
                  style={{
                    ...styles.td,
                    color: 'hsl(var(--color-text-secondary))',
                    fontSize: '11px',
                  }}
                >
                  {formatSize(file.sizeBytes)}
                </td>
                <td style={styles.td} title={file.error}>
                  <div style={styles.statusCell}>
                    <span className={`status-dot ${STATUS_CLASSES[file.status]}`} />
                    <span>{getStatusLabel(file.status)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {sortedFiles.length === 0 && (
          <div style={styles.filteredEmpty}>
            当前筛选条件下没有文件
          </div>
        )}
      </div>
    </div>
  );
}
