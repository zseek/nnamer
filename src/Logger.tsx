import { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';

interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    height: '200px',
    background: 'hsl(var(--color-surface))',
    borderTop: '1px solid hsl(var(--color-border))',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 1000,
  },
  header: {
    padding: '6px 12px',
    background: 'hsl(var(--color-background))',
    borderBottom: '1px solid hsl(var(--color-border))',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: '12px',
    fontWeight: 600,
    color: 'hsl(var(--color-text))',
  },
  logList: {
    flex: 1,
    overflow: 'auto',
    padding: '8px 12px',
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: '11px',
  },
  logEntry: {
    padding: '2px 0',
    borderBottom: '1px solid hsl(var(--color-border))',
  },
  timestamp: {
    color: 'hsl(var(--color-text-secondary))',
    marginRight: '8px',
  },
  levelInfo: {
    color: 'hsl(var(--color-primary))',
    marginRight: '8px',
    fontWeight: 600,
  },
  levelWarn: {
    color: 'hsl(var(--color-warning))',
    marginRight: '8px',
    fontWeight: 600,
  },
  levelError: {
    color: 'hsl(var(--color-error))',
    marginRight: '8px',
    fontWeight: 600,
  },
  levelDebug: {
    color: 'hsl(var(--color-text-secondary))',
    marginRight: '8px',
    fontWeight: 600,
  },
};

interface LoggerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Logger({ isOpen, onClose }: LoggerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlistenPromise = listen<string>('log-event', (event) => {
      try {
        const logData = JSON.parse(event.payload);
        setLogs((prev) => [...prev, logData]);
      } catch {
        setLogs((prev) => [
          ...prev,
          {
            timestamp: Date.now(),
            level: 'error',
            message: `无法解析日志: ${event.payload}`,
          },
        ]);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (logListRef.current) {
      logListRef.current.scrollTop = logListRef.current.scrollHeight;
    }
  }, [logs]);

  const handleClear = () => {
    setLogs([]);
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  const getLevelStyle = (level: string) => {
    switch (level) {
      case 'info':
        return styles.levelInfo;
      case 'warn':
        return styles.levelWarn;
      case 'error':
        return styles.levelError;
      case 'debug':
        return styles.levelDebug;
      default:
        return styles.levelInfo;
    }
  };

  if (!isOpen) return null;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>日志 ({logs.length})</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn" onClick={handleClear} style={{ fontSize: '11px' }}>
            清空
          </button>
          <button className="btn" onClick={onClose} style={{ fontSize: '11px' }}>
            关闭
          </button>
        </div>
      </div>
      <div className="logger-list selectable-text" style={styles.logList} ref={logListRef}>
        {logs.map((log, index) => (
          <div key={index} style={styles.logEntry}>
            <span style={styles.timestamp}>{formatTimestamp(log.timestamp)}</span>
            <span style={getLevelStyle(log.level)}>[{log.level.toUpperCase()}]</span>
            <span>{log.message}</span>
          </div>
        ))}
        {logs.length === 0 && (
          <div style={{ color: 'hsl(var(--color-text-secondary))', textAlign: 'center', marginTop: '20px' }}>
            暂无日志
          </div>
        )}
      </div>
    </div>
  );
}
