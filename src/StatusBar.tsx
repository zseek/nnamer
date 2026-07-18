import { useAppStore } from './store';
import type { FileStatus } from './shared/types';

const styles: React.CSSProperties = {
  background: 'hsl(var(--color-surface))',
  borderTop: '1px solid hsl(var(--color-border))',
  padding: '4px 12px',
  display: 'flex',
  alignItems: 'center',
  gap: '16px',
  fontSize: '11px',
  color: 'hsl(var(--color-text-secondary))',
};

const STATUS_LABELS: Record<FileStatus, string> = {
  pending: '待分析',
  analyzing: '分析中',
  ready: '可执行',
  unchanged: '无需修改',
  renamed: '已重命名',
  conflict: '冲突',
  failed: '失败',
};

const ATTENTION_STATUSES = new Set<FileStatus>(['conflict', 'failed']);

export default function StatusBar() {
  const { files } = useAppStore();
  const statusCounts: Record<FileStatus, number> = {
    pending: 0,
    analyzing: 0,
    ready: 0,
    unchanged: 0,
    renamed: 0,
    conflict: 0,
    failed: 0,
  };

  for (const file of files) {
    statusCounts[file.status] += 1;
  }

  const selectedCount = files.reduce(
    (count, file) => count + Number(file.selected),
    0
  );

  if (files.length === 0) {
    return <div style={styles}>准备就绪</div>;
  }

  return (
    <div style={styles}>
      <span>总计: {files.length}</span>
      <span>已选: {selectedCount}</span>
      {(Object.keys(statusCounts) as FileStatus[]).map((status) =>
        statusCounts[status] > 0 ? (
          <span
            key={status}
            style={
              ATTENTION_STATUSES.has(status)
                ? { color: 'hsl(var(--color-error))' }
                : undefined
            }
          >
            {STATUS_LABELS[status]}: {statusCounts[status]}
          </span>
        ) : null
      )}
    </div>
  );
}
