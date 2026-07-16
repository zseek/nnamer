import { useAppStore } from './store';

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

export default function StatusBar() {
  const { files } = useAppStore();

  const statusCounts = {
    total: files.length,
    unanalyzed: files.filter(f => f.status === 'unanalyzed').length,
    analyzing: files.filter(f => f.status === 'analyzing').length,
    normal: files.filter(f => f.status === 'normal').length,
    conflict: files.filter(f => f.status === 'conflict').length,
    failed: files.filter(f => f.status === 'analysisFailed').length,
    selected: files.filter(f => f.selected).length,
  };

  if (files.length === 0) {
    return (
      <div style={styles}>
        准备就绪
      </div>
    );
  }

  return (
    <div style={styles}>
      <span>总计: {statusCounts.total}</span>
      <span>已选: {statusCounts.selected}</span>
      {statusCounts.unanalyzed > 0 && <span>未分析: {statusCounts.unanalyzed}</span>}
      {statusCounts.analyzing > 0 && <span>分析中: {statusCounts.analyzing}</span>}
      {statusCounts.normal > 0 && <span>正常: {statusCounts.normal}</span>}
      {statusCounts.conflict > 0 && <span style={{ color: 'hsl(var(--color-error))' }}>冲突: {statusCounts.conflict}</span>}
      {statusCounts.failed > 0 && <span style={{ color: 'hsl(var(--color-error))' }}>失败: {statusCounts.failed}</span>}
    </div>
  );
}
