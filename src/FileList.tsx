import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAppStore } from './store';
import {
  OPEN_FILE_SEARCH_EVENT,
  SELECT_ALL_VISIBLE_FILES_EVENT,
} from './DesktopInteractionLayer';
import {
  applySuggestedNameEdit,
  collectFileIdsLeavingStatusFilter,
  fileMatchesNameSearch,
  formatFileSize,
  getFileIdsInSelectionRange,
  getStatusLabel,
  stripSupportedFileExtension,
  validateSuggestedName,
  type FileNameSearchFields,
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

const SEARCH_SCOPE_OPTIONS: Array<{
  field: keyof FileNameSearchFields;
  label: string;
}> = [
  {
    field: 'includeOriginalName',
    label: '原文件名',
  },
  {
    field: 'includeSuggestedName',
    label: '建议文件名',
  },
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
/** 输入防抖：连续打字时合并提交。失焦时会立即提交，不依赖此延迟。 */
const SUGGESTED_NAME_COMMIT_DELAY_MILLISECONDS = 350;

interface FileTableRowProps {
  file: FileItem;
  rowIndex: number;
  isSelected: boolean;
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
  isSelected,
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
    // 用户正在本地编辑时，不要用 store 回写覆盖输入框（避免提交后光标跳动）。
    if (
      latestSuggestedNameInputRef.current
      !== committedSuggestedNameInputRef.current
    ) {
      return;
    }

    if (suggestedNameInput === suggestedName) {
      committedSuggestedNameInputRef.current = suggestedName;
      return;
    }

    setSuggestedNameInput(suggestedName);
    latestSuggestedNameInputRef.current = suggestedName;
    committedSuggestedNameInputRef.current = suggestedName;
  }, [file.suggestedName, suggestedNameInput]);

  useEffect(() => () => {
    if (suggestedNameCommitTimerRef.current) {
      clearTimeout(suggestedNameCommitTimerRef.current);
      suggestedNameCommitTimerRef.current = null;
    }

    // 卸载时若有未提交编辑，延后写入 store，避免与下一个输入框聚焦抢主线程。
    if (
      latestSuggestedNameInputRef.current
      !== committedSuggestedNameInputRef.current
    ) {
      const pendingFileId = file.id;
      const pendingInputValue = latestSuggestedNameInputRef.current;
      committedSuggestedNameInputRef.current = pendingInputValue;
      window.setTimeout(() => {
        onSuggestedNameChange(pendingFileId, pendingInputValue);
      }, 0);
    }
  }, [file.id, onSuggestedNameChange]);

  const commitSuggestedName = (
    inputValue: string,
    options?: { deferStoreUpdate?: boolean }
  ) => {
    if (suggestedNameCommitTimerRef.current) {
      clearTimeout(suggestedNameCommitTimerRef.current);
      suggestedNameCommitTimerRef.current = null;
    }

    if (inputValue === committedSuggestedNameInputRef.current) {
      return;
    }

    committedSuggestedNameInputRef.current = inputValue;

    if (options?.deferStoreUpdate) {
      // 失焦切到其它输入框时：先让焦点落位，再写 store，减轻卡顿感。
      window.setTimeout(() => {
        onSuggestedNameChange(file.id, inputValue);
      }, 0);
      return;
    }

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
      data-file-row-id={file.id}
      aria-rowindex={rowIndex}
      className={`file-row${isSelected ? ' is-selected' : ''}`}
      onMouseDown={handleRowMouseDown}
      onClick={handleRowClick}
    >
      <td className="file-checkbox-cell" style={styles.td}>
        <input
          className="file-checkbox"
          data-row-selection-excluded="true"
          type="checkbox"
          aria-label={`选择 ${file.originalStem}`}
          checked={isSelected}
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
            spellCheck={false}
            autoComplete="off"
            onBlur={() =>
              commitSuggestedName(suggestedNameInput, { deferStoreUpdate: true })
            }
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
  const currentDirectory = useAppStore((state) => state.currentDirectory);
  const settings = useAppStore((state) => state.settings);
  const files = useAppStore((state) => state.files);
  const selectedFileIds = useAppStore((state) => state.selectedFileIds);
  const setFiles = useAppStore((state) => state.setFiles);
  const setFileSelected = useAppStore((state) => state.setFileSelected);
  const toggleFileSelection = useAppStore((state) => state.toggleFileSelection);
  const selectFileIds = useAppStore((state) => state.selectFileIds);
  const setSelectedFileIds = useAppStore((state) => state.setSelectedFileIds);
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [activeStatusFilter, setActiveStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFields, setSearchFields] = useState<FileNameSearchFields>({
    includeOriginalName: true,
    includeSuggestedName: true,
  });
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [retainedEditedFileIds, setRetainedEditedFileIds] = useState<Set<string>>(
    () => new Set()
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
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

  const filteredFiles = useMemo(() => {
    const normalizedSearchQuery = searchQuery.trim();
    const hasStatusFilter = activeStatusFilter !== 'all';
    const hasSearchFilter = normalizedSearchQuery.length > 0;
    const hasRetainedEditedFiles = retainedEditedFileIds.size > 0;

    // 最常见路径：无筛选时直接复用原数组，避免 5 万级无意义 filter。
    if (!hasStatusFilter && !hasSearchFilter && !hasRetainedEditedFiles) {
      return files;
    }

    return files.filter(
      (file) => (
        !hasStatusFilter
        || file.status === activeStatusFilter
        || retainedEditedFileIds.has(file.id)
      ) && (
        !hasSearchFilter
        || fileMatchesNameSearch(file, searchQuery, searchFields)
      )
    );
  }, [
    activeStatusFilter,
    files,
    retainedEditedFileIds,
    searchFields,
    searchQuery,
  ]);

  const sortedFiles = useMemo(() => {
    if (!sortField) {
      return filteredFiles;
    }

    const filesToSort = [...filteredFiles];
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

  const selectedFilteredCount = useMemo(
    () => filteredFiles.reduce(
      (selectedCount, file) => selectedCount + Number(selectedFileIds.has(file.id)),
      0
    ),
    [filteredFiles, selectedFileIds]
  );
  const areAllFilteredFilesSelected =
    filteredFiles.length > 0 && selectedFilteredCount === filteredFiles.length;
  const areSomeFilteredFilesSelected =
    selectedFilteredCount > 0 && !areAllFilteredFilesSelected;

  useEffect(() => {
    selectionAnchorFileIdRef.current = null;
    setSearchQuery('');
    setSearchFields({
      includeOriginalName: true,
      includeSuggestedName: true,
    });
    setIsSearchOpen(false);

    if (currentDirectory !== null) {
      return;
    }

    setSortField(null);
    setSortOrder('asc');
    setActiveStatusFilter('all');
    setRetainedEditedFileIds(new Set());
  }, [currentDirectory]);

  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked) {
      selectFileIds(filteredFiles.map((file) => file.id));
      return;
    }

    const nextSelectedFileIds = new Set(selectedFileIds);
    for (const file of filteredFiles) {
      nextSelectedFileIds.delete(file.id);
    }
    setSelectedFileIds(nextSelectedFileIds);
  }, [filteredFiles, selectFileIds, selectedFileIds, setSelectedFileIds]);

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = areSomeFilteredFilesSelected;
    }
  }, [areSomeFilteredFilesSelected]);

  useEffect(() => {
    if (!isSearchOpen) {
      return;
    }

    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [isSearchOpen]);

  useEffect(() => {
    const handleOpenSearch = () => {
      setIsSearchOpen(true);
      window.requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    };
    const handleSelectAllVisibleFiles = () => handleSelectAll(true);

    window.addEventListener(OPEN_FILE_SEARCH_EVENT, handleOpenSearch);
    window.addEventListener(
      SELECT_ALL_VISIBLE_FILES_EVENT,
      handleSelectAllVisibleFiles
    );

    return () => {
      window.removeEventListener(OPEN_FILE_SEARCH_EVENT, handleOpenSearch);
      window.removeEventListener(
        SELECT_ALL_VISIBLE_FILES_EVENT,
        handleSelectAllVisibleFiles
      );
    };
  }, [handleSelectAll]);

  useEffect(() => {
    selectionAnchorFileIdRef.current = null;
  }, [searchFields, searchQuery]);

  useEffect(() => {
    tableScrollerRef.current?.scrollTo({ top: 0 });
  }, [activeStatusFilter, searchFields, searchQuery, sortField, sortOrder]);

  const handleSort = (field: SortField) => {
    selectionAnchorFileIdRef.current = null;

    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const handleFileSelectionChange = useCallback(
    (fileId: string, isSelected: boolean, isRangeSelection: boolean) => {
      if (isRangeSelection) {
        const selectionRangeFileIds = getFileIdsInSelectionRange(
          orderedVisibleFilesRef.current,
          selectionAnchorFileIdRef.current,
          fileId
        );
        selectFileIds(
          selectionRangeFileIds.length > 0 ? selectionRangeFileIds : [fileId]
        );
        selectionAnchorFileIdRef.current =
          selectionRangeFileIds.length > 0 ? selectionAnchorFileIdRef.current : fileId;
        return;
      }

      selectionAnchorFileIdRef.current = fileId;
      setFileSelected(fileId, isSelected);
    },
    [selectFileIds, setFileSelected]
  );

  const handleRowSelectionToggle = useCallback(
    (fileId: string, isRangeSelection: boolean) => {
      if (isRangeSelection) {
        const selectionRangeFileIds = getFileIdsInSelectionRange(
          orderedVisibleFilesRef.current,
          selectionAnchorFileIdRef.current,
          fileId
        );
        selectFileIds(
          selectionRangeFileIds.length > 0 ? selectionRangeFileIds : [fileId]
        );
        selectionAnchorFileIdRef.current =
          selectionRangeFileIds.length > 0 ? selectionAnchorFileIdRef.current : fileId;
        return;
      }

      selectionAnchorFileIdRef.current = fileId;
      toggleFileSelection(fileId);
    },
    [selectFileIds, toggleFileSelection]
  );

  const handleStatusFilterChange = (statusFilter: StatusFilter) => {
    selectionAnchorFileIdRef.current = null;
    setActiveStatusFilter(statusFilter);
    setRetainedEditedFileIds(new Set());
  };

  const handleSuggestedNameChange = useCallback(
    (fileId: string, inputValue: string) => {
      const suggestedName = stripSupportedFileExtension(inputValue);
      const validation = validateSuggestedName(suggestedName);
      const currentFiles = useAppStore.getState().files;
      const nextFiles = applySuggestedNameEdit(
        currentFiles,
        fileId,
        suggestedName,
        validation
      );

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

  const handleSearchFieldToggle = (field: keyof FileNameSearchFields) => {
    setSearchFields((currentSearchFields) => {
      const otherField = field === 'includeOriginalName'
        ? 'includeSuggestedName'
        : 'includeOriginalName';

      if (currentSearchFields[field] && !currentSearchFields[otherField]) {
        return currentSearchFields;
      }

      return {
        ...currentSearchFields,
        [field]: !currentSearchFields[field],
      };
    });
  };

  const searchInputLabel = searchFields.includeOriginalName
    && searchFields.includeSuggestedName
    ? '原文件名和建议文件名'
    : searchFields.includeOriginalName
      ? '原文件名'
      : '建议文件名';
  const searchInputPlaceholder = searchFields.includeOriginalName
    && searchFields.includeSuggestedName
    ? '搜索原文件名或建议文件名'
    : searchFields.includeOriginalName
      ? '搜索原文件名'
      : '搜索建议文件名';

  const handleCloseSearch = () => {
    setSearchQuery('');
    setIsSearchOpen(false);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleCloseSearch();
    }
  };

  if (files.length === 0) {
    return (
      <div style={{
        ...styles.container,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'hsl(var(--color-text-secondary))',
      }}>
        {currentDirectory
          ? `当前目录中没有找到 ${settings?.importFileType.toUpperCase() ?? ''} 文件`
          : '请选择目录开始扫描文件'}
      </div>
    );
  }

  return (
    <div style={styles.container} data-file-list-root="true">
      <div
        className="file-filter-bar"
        style={styles.filterBar}
        role="toolbar"
        aria-label="文件筛选与搜索"
      >
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
        <span className="file-selection-hint" style={styles.selectionHint}>按住 Shift 可选择区间</span>
        <button
          type="button"
          className={`file-search-toggle${isSearchOpen ? ' is-active' : ''}`}
          aria-label={isSearchOpen ? '关闭文件名搜索' : '打开文件名搜索'}
          aria-pressed={isSearchOpen}
          title="搜索文件名 (Ctrl+F)"
          onClick={() => {
            if (isSearchOpen) {
              handleCloseSearch();
              return;
            }

            setIsSearchOpen(true);
          }}
        >
          搜索
          <kbd>Ctrl+F</kbd>
        </button>
      </div>

      {isSearchOpen && (
        <div className="file-search-bar" role="search">
          <label className="file-search-field">
            <span className="file-search-label">关键词</span>
            <input
              ref={searchInputRef}
              type="search"
              className="file-search-input"
              value={searchQuery}
              placeholder={searchInputPlaceholder}
              aria-label={`搜索${searchInputLabel}`}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
          </label>
          <div className="file-search-scope-control">
            <span className="file-search-scope-label">范围</span>
            <div
              className="file-search-scope"
              role="group"
              aria-label="选择文件名搜索范围，可多选"
            >
              {SEARCH_SCOPE_OPTIONS.map((searchScopeOption) => {
                const isActive = searchFields[searchScopeOption.field];
                const isOnlyActiveField = isActive && (
                  searchScopeOption.field === 'includeOriginalName'
                    ? !searchFields.includeSuggestedName
                    : !searchFields.includeOriginalName
                );
                return (
                  <button
                    key={searchScopeOption.field}
                    type="button"
                    className={`file-search-scope-button${isActive ? ' is-active' : ''}`}
                    aria-pressed={isActive}
                    disabled={isOnlyActiveField}
                    title={isOnlyActiveField ? '至少保留一个搜索范围' : undefined}
                    onClick={() => handleSearchFieldToggle(searchScopeOption.field)}
                  >
                    <span
                      className="file-search-scope-check"
                      aria-hidden="true"
                    >
                      {isActive ? '✓' : ''}
                    </span>
                    {searchScopeOption.label}
                  </button>
                );
              })}
            </div>
          </div>
          <span className="file-search-result" aria-live="polite">
            {filteredFiles.length} 个结果
          </span>
          <button
            type="button"
            className="file-search-close"
            aria-label="关闭文件名搜索"
            title="关闭搜索 (Esc)"
            onClick={handleCloseSearch}
          >
            ×
          </button>
        </div>
      )}

      <div
        ref={tableScrollerRef}
        className="file-list-scroller"
        style={styles.tableScroller}
      >
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
                  aria-label={`选择当前列表中的 ${filteredFiles.length} 个文件`}
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
                  isSelected={selectedFileIds.has(file.id)}
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
