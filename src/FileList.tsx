import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAppStore } from './store';
import {
  collectFileIdsLeavingStatusFilter,
  formatFileSize,
  getFileIdsInSelectionRange,
  getStatusLabel,
  recomputeFileStatuses,
  stripTxtExtension,
  validateSuggestedName,
} from './shared/lib/fileUtils';
import type { FileItem, FileStatus } from './shared/types';

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
  filterGroup: {
    display: 'inline-flex',
    alignItems: 'stretch',
    overflow: 'hidden',
    border: '1px solid hsl(var(--color-border))',
    borderRadius: '5px',
    background: 'hsl(var(--color-surface))',
  },
  tableScroller: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
  },
  table: {
    width: '100%',
    tableLayout: 'fixed',
    borderCollapse: 'collapse',
    fontSize: '12px',
  },
  th: {
    position: 'sticky',
    top: 0,
    height: '32px',
    padding: '0 12px',
    textAlign: 'left',
    verticalAlign: 'middle',
    background: 'hsl(var(--color-background))',
    borderBottom: '1px solid hsl(var(--color-border))',
    color: 'hsl(var(--color-text-secondary))',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'default',
    userSelect: 'none',
    zIndex: 1,
  },
  thSortable: {
    cursor: 'pointer',
    userSelect: 'none',
  },
  td: {
    height: '40px',
    padding: '5px 12px',
    verticalAlign: 'middle',
    borderBottom: '1px solid hsl(var(--color-border))',
  },
  filteredEmpty: {
    padding: '32px 12px',
    color: 'hsl(var(--color-text-secondary))',
    textAlign: 'center',
  },
  selectionHint: {
    marginLeft: '8px',
    color: 'hsl(var(--color-text-secondary) / 0.78)',
    fontSize: '10px',
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
  { value: 'renamed', label: '已重命名' },
  { value: 'conflict', label: '冲突' },
  { value: 'failed', label: '失败' },
];

const STATUS_CLASSES: Record<FileStatus, string> = {
  pending: 'status-pending',
  analyzing: 'status-analyzing',
  ready: 'status-ready',
  unchanged: 'status-unchanged',
  renamed: 'status-renamed',
  conflict: 'status-conflict',
  failed: 'status-failed',
};

const FILE_ROW_HEIGHT_PIXELS = 40;
const FILE_LIST_OVERSCAN_ROWS = 10;
const SUGGESTED_NAME_COMMIT_DELAY_MILLISECONDS = 120;

interface FileTableRowProps {
  file: FileItem;
  rowIndex: number;
  onSelectionChange: (
    fileId: string,
    isSelected: boolean,
    isRangeSelection: boolean
  ) => void;
  onSelectionToggle: (fileId: string, isRangeSelection: boolean) => void;
  onSuggestedNameChange: (fileId: string, inputValue: string) => void;
}

const FileTableRow = memo(function FileTableRow({
  file,
  rowIndex,
  onSelectionChange,
  onSelectionToggle,
  onSuggestedNameChange,
}: FileTableRowProps) {
  const [suggestedNameInput, setSuggestedNameInput] = useState(
    file.suggestedName ?? ''
  );
  const latestSuggestedNameInputRef = useRef(file.suggestedName ?? '');
  const committedSuggestedNameInputRef = useRef(file.suggestedName ?? '');
  const suggestedNameCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  useEffect(() => {
    const suggestedName = file.suggestedName ?? '';
    setSuggestedNameInput(suggestedName);
    latestSuggestedNameInputRef.current = suggestedName;
    committedSuggestedNameInputRef.current = suggestedName;
  }, [file.suggestedName]);

  useEffect(() => () => {
    if (suggestedNameCommitTimerRef.current) {
      clearTimeout(suggestedNameCommitTimerRef.current);
    }

    if (
      latestSuggestedNameInputRef.current
      !== committedSuggestedNameInputRef.current
    ) {
      onSuggestedNameChange(file.id, latestSuggestedNameInputRef.current);
    }
  }, [file.id, onSuggestedNameChange]);

  const commitSuggestedName = (inputValue: string) => {
    if (suggestedNameCommitTimerRef.current) {
      clearTimeout(suggestedNameCommitTimerRef.current);
      suggestedNameCommitTimerRef.current = null;
    }

    if (inputValue === committedSuggestedNameInputRef.current) {
      return;
    }

    committedSuggestedNameInputRef.current = inputValue;
    onSuggestedNameChange(file.id, inputValue);
  };

  const handleSuggestedNameInput = (inputValue: string) => {
    setSuggestedNameInput(inputValue);
    latestSuggestedNameInputRef.current = inputValue;

    if (suggestedNameCommitTimerRef.current) {
      clearTimeout(suggestedNameCommitTimerRef.current);
    }

    suggestedNameCommitTimerRef.current = setTimeout(() => {
      suggestedNameCommitTimerRef.current = null;
      commitSuggestedName(inputValue);
    }, SUGGESTED_NAME_COMMIT_DELAY_MILLISECONDS);
  };

  const handleRowMouseDown = (
    event: React.MouseEvent<HTMLTableRowElement>
  ) => {
    if (!event.shiftKey) {
      return;
    }

    const clickedElement = event.target as HTMLElement;
    const isInteractiveControl = clickedElement.closest(
      'input, button, select, textarea, a'
    );

    if (isInteractiveControl) {
      return;
    }

    event.preventDefault();
    window.getSelection()?.removeAllRanges();
  };

  const handleRowClick = (event: React.MouseEvent<HTMLTableRowElement>) => {
    const clickedElement = event.target as HTMLElement;
    const isExcludedSelectionArea = clickedElement.closest(
      '[data-row-selection-excluded="true"]'
    );

    if (!isExcludedSelectionArea) {
      onSelectionToggle(file.id, event.shiftKey);
    }
  };

  return (
    <tr
      aria-rowindex={rowIndex}
      className={`file-row${file.selected ? ' is-selected' : ''}`}
      onMouseDown={handleRowMouseDown}
      onClick={handleRowClick}
    >
      <td className="file-checkbox-cell" style={styles.td}>
        <input
          className="file-checkbox"
          data-row-selection-excluded="true"
          type="checkbox"
          aria-label={`选择 ${file.originalStem}`}
          checked={file.selected}
          onChange={(event) =>
            onSelectionChange(
              file.id,
              event.target.checked,
              (event.nativeEvent as MouseEvent).shiftKey
            )
          }
        />
      </td>
      <td className="file-original-cell" style={styles.td}>
        <span
          className="file-original-name"
          data-row-selection-excluded="true"
          title={file.originalStem}
        >
          {file.originalStem}
        </span>
      </td>
      <td
        className="file-suggested-cell"
        data-row-selection-excluded="true"
        style={styles.td}
      >
        {file.status === 'pending' || file.status === 'analyzing' ? (
          <span className="file-suggested-placeholder">尚无建议</span>
        ) : (
          <input
            className="file-suggested-input"
            value={suggestedNameInput}
            aria-label={`${file.originalStem} 的建议文件名`}
            title={file.error ?? file.suggestedName}
            onBlur={() => commitSuggestedName(suggestedNameInput)}
            onChange={(event) =>
              handleSuggestedNameInput(event.target.value)
            }
          />
        )}
      </td>
      <td className="file-size-cell" style={styles.td}>
        {formatFileSize(file.sizeBytes)}
      </td>
      <td style={styles.td} title={file.error}>
        <span className={`file-status-badge file-status-${file.status}`}>
          <span className={`status-dot ${STATUS_CLASSES[file.status]}`} />
          <span>{getStatusLabel(file.status)}</span>
        </span>
      </td>
    </tr>
  );
});

export default function FileList() {
  const { currentDirectory, files, setFiles } = useAppStore();
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [activeStatusFilter, setActiveStatusFilter] = useState<StatusFilter>('all');
  const [retainedEditedFileIds, setRetainedEditedFileIds] = useState<Set<string>>(
    () => new Set()
  );
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);
  const tableScrollerRef = useRef<HTMLDivElement>(null);
  const selectionAnchorFileIdRef = useRef<string | null>(null);
  const orderedVisibleFilesRef = useRef<ReadonlyArray<Pick<FileItem, 'id'>>>([]);

  const statusCounts = useMemo<Record<StatusFilter, number>>(() => {
    const counts: Record<StatusFilter, number> = {
      all: files.length,
      pending: 0,
      analyzing: 0,
      ready: 0,
      unchanged: 0,
      renamed: 0,
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
  orderedVisibleFilesRef.current = sortedFiles;

  const fileVirtualizer = useVirtualizer({
    count: sortedFiles.length,
    getScrollElement: () => tableScrollerRef.current,
    estimateSize: () => FILE_ROW_HEIGHT_PIXELS,
    getItemKey: (rowIndex) => sortedFiles[rowIndex]?.id ?? rowIndex,
    overscan: FILE_LIST_OVERSCAN_ROWS,
  });
  const virtualRows = fileVirtualizer.getVirtualItems();
  const firstVirtualRow = virtualRows[0];
  const lastVirtualRow = virtualRows[virtualRows.length - 1];
  const virtualPaddingTop = firstVirtualRow?.start ?? 0;
  const virtualPaddingBottom = lastVirtualRow
    ? fileVirtualizer.getTotalSize() - lastVirtualRow.end
    : 0;

  const selectedFilteredCount = filteredFiles.reduce(
    (selectedCount, file) => selectedCount + Number(file.selected),
    0
  );
  const areAllFilteredFilesSelected =
    filteredFiles.length > 0 && selectedFilteredCount === filteredFiles.length;
  const areSomeFilteredFilesSelected =
    selectedFilteredCount > 0 && !areAllFilteredFilesSelected;

  useEffect(() => {
    selectionAnchorFileIdRef.current = null;

    if (currentDirectory !== null) {
      return;
    }

    setSortField(null);
    setSortOrder('asc');
    setActiveStatusFilter('all');
    setRetainedEditedFileIds(new Set());
  }, [currentDirectory]);

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = areSomeFilteredFilesSelected;
    }
  }, [areSomeFilteredFilesSelected]);

  useEffect(() => {
    tableScrollerRef.current?.scrollTo({ top: 0 });
  }, [activeStatusFilter, sortField, sortOrder]);

  const handleSort = (field: SortField) => {
    selectionAnchorFileIdRef.current = null;

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
      currentFiles.map((file) => {
        if (!filteredFileIds.has(file.id) || file.selected === checked) {
          return file;
        }

        return { ...file, selected: checked };
      })
    );
  };

  const handleFileSelectionChange = useCallback(
    (fileId: string, isSelected: boolean, isRangeSelection: boolean) => {
      if (isRangeSelection) {
        const selectionRangeFileIds = getFileIdsInSelectionRange(
          orderedVisibleFilesRef.current,
          selectionAnchorFileIdRef.current,
          fileId
        );
        const selectedFileIds = new Set(
          selectionRangeFileIds.length > 0 ? selectionRangeFileIds : [fileId]
        );

        setFiles((currentFiles) =>
          currentFiles.map((file) =>
            selectedFileIds.has(file.id) && !file.selected
              ? { ...file, selected: true }
              : file
          )
        );
        selectionAnchorFileIdRef.current =
          selectionRangeFileIds.length > 0 ? selectionAnchorFileIdRef.current : fileId;
        return;
      }

      selectionAnchorFileIdRef.current = fileId;
      setFiles((currentFiles) =>
        currentFiles.map((file) => {
          if (file.id !== fileId || file.selected === isSelected) {
            return file;
          }

          return { ...file, selected: isSelected };
        })
      );
    },
    [setFiles]
  );

  const handleRowSelectionToggle = useCallback(
    (fileId: string, isRangeSelection: boolean) => {
      if (isRangeSelection) {
        const selectionRangeFileIds = getFileIdsInSelectionRange(
          orderedVisibleFilesRef.current,
          selectionAnchorFileIdRef.current,
          fileId
        );
        const selectedFileIds = new Set(
          selectionRangeFileIds.length > 0 ? selectionRangeFileIds : [fileId]
        );

        setFiles((currentFiles) =>
          currentFiles.map((file) =>
            selectedFileIds.has(file.id) && !file.selected
              ? { ...file, selected: true }
              : file
          )
        );
        selectionAnchorFileIdRef.current =
          selectionRangeFileIds.length > 0 ? selectionAnchorFileIdRef.current : fileId;
        return;
      }

      selectionAnchorFileIdRef.current = fileId;
      setFiles((currentFiles) =>
        currentFiles.map((file) =>
          file.id === fileId ? { ...file, selected: !file.selected } : file
        )
      );
    },
    [setFiles]
  );

  const handleStatusFilterChange = (statusFilter: StatusFilter) => {
    selectionAnchorFileIdRef.current = null;
    setActiveStatusFilter(statusFilter);
    setRetainedEditedFileIds(new Set());
  };

  const handleSuggestedNameChange = useCallback(
    (fileId: string, inputValue: string) => {
      const suggestedName = stripTxtExtension(inputValue);
      const validation = validateSuggestedName(suggestedName);
      const currentFiles = useAppStore.getState().files;

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
      const nextFiles = recomputeFileStatuses(editedFiles);

      // 冲突等状态会级联变化：不仅保留被编辑行，也保留因本次编辑而离开当前筛选的行。
      // 先更新暂留集合，再写回文件列表，避免筛选列表闪一下。
      if (activeStatusFilter !== 'all') {
        const fileIdsLeavingFilter = collectFileIdsLeavingStatusFilter(
          currentFiles,
          nextFiles,
          activeStatusFilter
        );

        if (fileIdsLeavingFilter.length > 0) {
          setRetainedEditedFileIds((currentFileIds) => {
            let didAddRetainedFileId = false;
            const nextFileIds = new Set(currentFileIds);

            for (const retainedFileId of fileIdsLeavingFilter) {
              if (!nextFileIds.has(retainedFileId)) {
                nextFileIds.add(retainedFileId);
                didAddRetainedFileId = true;
              }
            }

            return didAddRetainedFileId ? nextFileIds : currentFileIds;
          });
        }
      }

      setFiles(nextFiles);
    },
    [activeStatusFilter, setFiles]
  );

  const getSortIndicator = (field: SortField) => {
    if (sortField !== field) return '';
    return sortOrder === 'asc' ? '▲' : '▼';
  };

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

  return (
    <div style={styles.container}>
      <div style={styles.filterBar} role="toolbar" aria-label="文件状态筛选">
        <span style={styles.filterLabel}>状态筛选</span>
        <div style={styles.filterGroup} role="group" aria-label="按文件状态筛选">
          {STATUS_FILTERS.map((filter) => {
            const isActive = activeStatusFilter === filter.value;
            return (
              <button
                key={filter.value}
                type="button"
                aria-pressed={isActive}
                className={`status-filter-button${isActive ? ' is-active' : ''}`}
                onClick={() => handleStatusFilterChange(filter.value)}
              >
                <span>{filter.label}</span>
                <span className="status-filter-count">
                  {statusCounts[filter.value]}
                </span>
              </button>
            );
          })}
        </div>
        <span style={styles.selectionHint}>按住 Shift 可选择区间</span>
      </div>

      <div ref={tableScrollerRef} style={styles.tableScroller}>
        <table
          style={styles.table}
          aria-rowcount={sortedFiles.length + 1}
        >
          <thead>
            <tr>
              <th
                className="file-checkbox-cell"
                style={{ ...styles.th, width: '42px' }}
              >
                <input
                  ref={selectAllCheckboxRef}
                  className="file-checkbox"
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
                <span className="file-table-header-content">
                  <span>原文件名</span>
                  <span className="file-sort-indicator" aria-hidden="true">
                    {getSortIndicator('originalStem')}
                  </span>
                </span>
              </th>
              <th
                style={{ ...styles.th, ...styles.thSortable, width: '38%' }}
                onClick={() => handleSort('suggestedName')}
              >
                <span className="file-table-header-content">
                  <span>建议文件名</span>
                  <span className="file-sort-indicator" aria-hidden="true">
                    {getSortIndicator('suggestedName')}
                  </span>
                </span>
              </th>
              <th
                className="file-size-cell"
                style={{ ...styles.th, width: '90px' }}
              >
                大小
              </th>
              <th style={{ ...styles.th, width: '116px' }}>状态</th>
            </tr>
          </thead>
          <tbody>
            {virtualPaddingTop > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={5}
                  style={{ height: `${virtualPaddingTop}px`, padding: 0 }}
                />
              </tr>
            )}
            {virtualRows.map((virtualRow) => {
              const file = sortedFiles[virtualRow.index];

              return (
                <FileTableRow
                  key={file.id}
                  file={file}
                  rowIndex={virtualRow.index + 2}
                  onSelectionChange={handleFileSelectionChange}
                  onSelectionToggle={handleRowSelectionToggle}
                  onSuggestedNameChange={handleSuggestedNameChange}
                />
              );
            })}
            {virtualPaddingBottom > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={5}
                  style={{ height: `${virtualPaddingBottom}px`, padding: 0 }}
                />
              </tr>
            )}
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
