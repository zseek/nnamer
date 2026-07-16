import { useState } from 'react';
import { useAppStore } from './store';
import type { FileItem } from './shared/types';

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    flex: 1,
    overflow: 'auto',
    background: 'hsl(var(--color-surface))',
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
    cursor: 'pointer',
    userSelect: 'none',
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
};

type SortField = 'originalName' | 'suggestedName' | null;
type SortOrder = 'asc' | 'desc';

export default function FileList() {
  const { files, updateFile, setFiles } = useAppStore();
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [allSelected, setAllSelected] = useState(false);

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
    setAllSelected(checked);
    const updatedFiles = files.map(file => ({ ...file, selected: checked }));
    setFiles(updatedFiles);
  };

  const sortedFiles = [...files].sort((a, b) => {
    if (!sortField) return 0;

    let aValue = '';
    let bValue = '';

    if (sortField === 'originalName') {
      aValue = a.originalName.toLowerCase();
      bValue = b.originalName.toLowerCase();
    } else if (sortField === 'suggestedName') {
      aValue = (a.suggestedName || '').toLowerCase();
      bValue = (b.suggestedName || '').toLowerCase();
    }

    if (sortOrder === 'asc') {
      return aValue.localeCompare(bValue);
    } else {
      return bValue.localeCompare(aValue);
    }
  });

  const getStatusLabel = (status: FileItem['status']) => {
    const labels = {
      unanalyzed: '未分析',
      analyzing: '分析中',
      normal: '正常',
      nameSame: '相同',
      conflict: '冲突',
      analysisFailed: '失败',
      nameInvalid: '无效',
    };
    return labels[status];
  };

  const getStatusClass = (status: FileItem['status']) => {
    const classes = {
      unanalyzed: 'status-unanalyzed',
      analyzing: 'status-analyzing',
      normal: 'status-normal',
      nameSame: 'status-unanalyzed',
      conflict: 'status-conflict',
      analysisFailed: 'status-failed',
      nameInvalid: 'status-failed',
    };
    return classes[status];
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
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={{ ...styles.th, width: '30px' }}>
              <input 
                type="checkbox" 
                checked={allSelected}
                onChange={(e) => handleSelectAll(e.target.checked)}
              />
            </th>
            <th 
              style={{ ...styles.th, ...styles.thSortable, width: '35%' }}
              onClick={() => handleSort('originalName')}
            >
              原文件名{getSortIndicator('originalName')}
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
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'hsl(var(--color-background))';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = '';
              }}
            >
              <td style={styles.td}>
                <input 
                  type="checkbox" 
                  checked={file.selected}
                  onChange={(e) => updateFile(file.id, { selected: e.target.checked })}
                />
              </td>
              <td style={{ ...styles.td, fontSize: '13px' }}>
                {file.originalName}
              </td>
              <td style={styles.td}>
                {file.status === 'unanalyzed' || file.status === 'analyzing' ? (
                  <span style={{ color: 'hsl(var(--color-text-secondary))' }}>-</span>
                ) : (
                  <input
                    style={styles.input}
                    value={file.suggestedName || ''}
                    onChange={(e) => updateFile(file.id, { suggestedName: e.target.value })}
                  />
                )}
              </td>
              <td style={{ ...styles.td, color: 'hsl(var(--color-text-secondary))', fontSize: '11px' }}>
                {formatSize(file.sizeBytes)}
              </td>
              <td style={styles.td}>
                <div style={styles.statusCell}>
                  <span className={`status-dot ${getStatusClass(file.status)}`}></span>
                  <span>{getStatusLabel(file.status)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
