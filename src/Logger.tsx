import { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  ANALYSIS_ATTEMPT_EVENT,
  ANALYSIS_LIFECYCLE_EVENT,
  applyAnalysisAttemptEvent,
  applyAnalysisLifecycleEvent,
} from './shared/lib/analysisLog';
import type {
  AnalysisAttemptLog,
  AnalysisAttemptStatus,
  AnalysisBatchLog,
  AnalysisBatchStatus,
  AnalysisLifecycleEvent,
  AnalysisSessionLog,
  AnalysisSessionStatus,
} from './shared/lib/analysisLog';

type BatchFilter = 'all' | 'failed' | 'retried';

interface LoggerProps {
  isOpen: boolean;
  onClose: () => void;
}

const failedBatchStatuses = new Set<AnalysisBatchStatus>([
  'partial',
  'failed',
  'http_error',
  'network_error',
  'parse_error',
]);

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatPayload(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

function formatDuration(durationMilliseconds: number | undefined): string {
  if (durationMilliseconds === undefined) {
    return '—';
  }

  if (durationMilliseconds < 1000) {
    return `${durationMilliseconds} ms`;
  }

  return `${(durationMilliseconds / 1000).toFixed(1)} 秒`;
}

function getElapsedDuration(startedAt?: number, finishedAt?: number): number | undefined {
  if (startedAt === undefined || finishedAt === undefined) {
    return undefined;
  }

  return Math.max(0, finishedAt - startedAt);
}

function getSessionStatusLabel(status: AnalysisSessionStatus): string {
  switch (status) {
    case 'running':
      return '分析中';
    case 'paused':
      return '已暂停';
    case 'success':
      return '已完成';
    case 'partial':
      return '部分完成';
    case 'failed':
      return '失败';
  }
}

function getBatchStatusLabel(status: AnalysisBatchStatus): string {
  switch (status) {
    case 'pending':
      return '等待中';
    case 'running':
      return '请求中';
    case 'retrying':
      return '正在重试';
    case 'success':
      return '成功';
    case 'partial':
      return '部分文件失败';
    case 'failed':
      return '失败';
    case 'http_error':
      return 'HTTP 错误';
    case 'network_error':
      return '网络错误';
    case 'parse_error':
      return '响应解析失败';
  }
}

function getAttemptStatusLabel(status: AnalysisAttemptStatus): string {
  switch (status) {
    case 'success':
      return '成功';
    case 'http_error':
      return 'HTTP 错误';
    case 'network_error':
      return '网络错误';
    case 'parse_error':
      return '响应解析失败';
  }
}

function getStatusClassName(
  status: AnalysisSessionStatus | AnalysisBatchStatus | AnalysisAttemptStatus
): string {
  if (status === 'success') {
    return 'is-success';
  }

  if (status === 'running' || status === 'retrying') {
    return 'is-running';
  }

  if (status === 'paused' || status === 'partial') {
    return 'is-warning';
  }

  if (status === 'pending') {
    return 'is-muted';
  }

  return 'is-error';
}

function isRetriedBatch(batch: AnalysisBatchLog): boolean {
  return batch.attempts.length > 1
    || batch.attempts.some((attempt) => attempt.willRetry);
}

function normalizeAttemptEvent(value: Partial<AnalysisAttemptLog>): AnalysisAttemptLog | null {
  const supportedStatuses: AnalysisAttemptStatus[] = [
    'success',
    'http_error',
    'network_error',
    'parse_error',
  ];

  if (
    typeof value.sessionId !== 'string'
    || typeof value.batchIndex !== 'number'
    || typeof value.attempt !== 'number'
    || !supportedStatuses.includes(value.status as AnalysisAttemptStatus)
    || typeof value.requestUrl !== 'string'
    || typeof value.requestBody !== 'string'
  ) {
    return null;
  }

  return {
    sessionId: value.sessionId,
    timestamp: typeof value.timestamp === 'number' ? value.timestamp : Date.now(),
    batchIndex: value.batchIndex,
    attempt: value.attempt,
    status: value.status as AnalysisAttemptStatus,
    requestUrl: value.requestUrl,
    requestBody: value.requestBody,
    responseStatus: value.responseStatus,
    responseBody: value.responseBody,
    durationMs: typeof value.durationMs === 'number' ? value.durationMs : 0,
    error: value.error,
    willRetry: value.willRetry === true,
  };
}

export default function Logger({ isOpen, onClose }: LoggerProps) {
  const [sessions, setSessions] = useState<AnalysisSessionLog[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedBatchIndex, setSelectedBatchIndex] = useState<number | null>(null);
  const [selectedAttemptNumber, setSelectedAttemptNumber] = useState<number | null>(null);
  const [batchFilter, setBatchFilter] = useState<BatchFilter>('all');
  const sessionListRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const handleLifecycleEvent = (event: Event) => {
      const lifecycleEvent = (event as CustomEvent<AnalysisLifecycleEvent>).detail;
      if (!lifecycleEvent) {
        return;
      }

      setSessions((previousSessions) =>
        applyAnalysisLifecycleEvent(previousSessions, lifecycleEvent)
      );
      if (lifecycleEvent.type === 'session-started') {
        setSelectedSessionId((currentSessionId) =>
          currentSessionId ?? lifecycleEvent.session.id
        );
      }
    };

    window.addEventListener(ANALYSIS_LIFECYCLE_EVENT, handleLifecycleEvent);
    return () => {
      window.removeEventListener(ANALYSIS_LIFECYCLE_EVENT, handleLifecycleEvent);
    };
  }, []);

  useEffect(() => {
    const unlistenPromise = listen<string>(ANALYSIS_ATTEMPT_EVENT, (event) => {
      try {
        const attemptEvent = normalizeAttemptEvent(
          JSON.parse(event.payload) as Partial<AnalysisAttemptLog>
        );
        if (!attemptEvent) {
          return;
        }

        setSessions((previousSessions) =>
          applyAnalysisAttemptEvent(previousSessions, attemptEvent)
        );
      } catch {
        // Malformed diagnostic events must not interrupt the analysis workflow.
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const getFocusableElements = () => dialogRef.current
      ? Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), summary, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        )
      : [];

    getFocusableElements()[0]?.focus();

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        return;
      }

      const firstFocusableElement = focusableElements[0];
      const lastFocusableElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstFocusableElement) {
        event.preventDefault();
        lastFocusableElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusableElement) {
        event.preventDefault();
        firstFocusableElement.focus();
      }
    };

    window.addEventListener('keydown', handleDialogKeyDown);
    return () => window.removeEventListener('keydown', handleDialogKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (selectedSessionId && sessions.some((session) => session.id === selectedSessionId)) {
      return;
    }

    setSelectedSessionId(sessions[0]?.id ?? null);
    setSelectedBatchIndex(null);
    setSelectedAttemptNumber(null);
  }, [selectedSessionId, sessions]);

  const selectedSession = sessions.find(
    (session) => session.id === selectedSessionId
  );

  const filteredBatches = useMemo(() => {
    if (!selectedSession) {
      return [];
    }

    switch (batchFilter) {
      case 'failed':
        return selectedSession.batches.filter((batch) =>
          failedBatchStatuses.has(batch.status)
        );
      case 'retried':
        return selectedSession.batches.filter(isRetriedBatch);
      default:
        return selectedSession.batches;
    }
  }, [batchFilter, selectedSession]);

  useEffect(() => {
    if (
      selectedBatchIndex !== null
      && filteredBatches.some((batch) => batch.batchIndex === selectedBatchIndex)
    ) {
      return;
    }

    setSelectedBatchIndex(filteredBatches[0]?.batchIndex ?? null);
    setSelectedAttemptNumber(null);
  }, [filteredBatches, selectedBatchIndex]);

  const selectedBatch = selectedSession?.batches.find(
    (batch) => batch.batchIndex === selectedBatchIndex
  );

  useEffect(() => {
    if (!selectedBatch || selectedBatch.attempts.length === 0) {
      setSelectedAttemptNumber(null);
      return;
    }

    if (selectedBatch.attempts.some(
      (attempt) => attempt.attempt === selectedAttemptNumber
    )) {
      return;
    }

    setSelectedAttemptNumber(
      selectedBatch.attempts[selectedBatch.attempts.length - 1].attempt
    );
  }, [selectedAttemptNumber, selectedBatch]);

  const selectedAttempt = selectedBatch?.attempts.find(
    (attempt) => attempt.attempt === selectedAttemptNumber
  );

  const handleSelectSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setSelectedBatchIndex(null);
    setSelectedAttemptNumber(null);
    setBatchFilter('all');
  };

  const handleSelectBatch = (batchIndex: number) => {
    setSelectedBatchIndex(batchIndex);
    setSelectedAttemptNumber(null);
  };

  const handleClear = () => {
    setSessions([]);
    setSelectedSessionId(null);
    setSelectedBatchIndex(null);
    setSelectedAttemptNumber(null);
    setBatchFilter('all');
  };

  const handleOverlayMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) {
    return null;
  }

  const hasActiveSession = sessions.some((session) =>
    session.status === 'running' || session.status === 'paused'
  );
  const completedBatchCount = selectedSession?.batches.filter((batch) =>
    !['pending', 'running', 'retrying'].includes(batch.status)
  ).length ?? 0;
  const failedBatchCount = selectedSession?.batches.filter((batch) =>
    failedBatchStatuses.has(batch.status)
  ).length ?? 0;
  const retriedBatchCount = selectedSession?.batches.filter(isRetriedBatch).length ?? 0;
  const successfulFileCount = selectedSession?.batches.reduce(
    (totalCount, batch) => totalCount + batch.successfulFileCount,
    0
  ) ?? 0;
  const failedFileCount = selectedSession?.batches.reduce(
    (totalCount, batch) => totalCount + batch.failedFileCount,
    0
  ) ?? 0;

  return (
    <div
      className="logger-modal-backdrop"
      onMouseDown={handleOverlayMouseDown}
    >
      <section
        ref={dialogRef}
        className="logger-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logger-dialog-title"
      >
        <header className="logger-modal-header">
          <div>
            <h2 id="logger-dialog-title">分析日志</h2>
            <p>每次分析显示为一个任务，可继续查看批次和每次请求尝试。</p>
          </div>
          <div className="logger-modal-actions">
            <span className="logger-count">{sessions.length} 个任务</span>
            <button
              type="button"
              className="btn"
              onClick={handleClear}
              disabled={sessions.length === 0 || hasActiveSession}
              title={hasActiveSession ? '分析进行中，暂时不能清空日志' : undefined}
            >
              清空日志
            </button>
            <button type="button" className="btn" onClick={onClose}>
              关闭
            </button>
          </div>
        </header>

        <div className="logger-modal-content">
          <div
            className="logger-entry-list selectable-text"
            ref={sessionListRef}
            aria-label="分析任务"
          >
            {sessions.length === 0 ? (
              <div className="logger-empty-state">
                <strong>暂无分析任务</strong>
                <span>开始分析后，任务、批次和请求详情会显示在这里。</span>
              </div>
            ) : (
              sessions.map((session) => {
                const isSelected = selectedSessionId === session.id;
                const completedBatches = session.batches.filter((batch) =>
                  !['pending', 'running', 'retrying'].includes(batch.status)
                ).length;
                const taskFailedBatchCount = session.batches.filter((batch) =>
                  failedBatchStatuses.has(batch.status)
                ).length;

                return (
                  <button
                    type="button"
                    key={session.id}
                    className={`logger-entry${isSelected ? ' is-selected' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => handleSelectSession(session.id)}
                  >
                    <span className="logger-entry-main">
                      <span className="logger-entry-time">
                        {formatTimestamp(session.startedAt)}
                      </span>
                      <span className={`logger-status ${getStatusClassName(session.status)}`}>
                        {getSessionStatusLabel(session.status)}
                      </span>
                      {taskFailedBatchCount > 0 && (
                        <span className="logger-entry-status is-error">
                          {taskFailedBatchCount} 批异常
                        </span>
                      )}
                    </span>
                    <span className="logger-entry-message">分析任务</span>
                    <span className="logger-entry-summary">
                      {completedBatches}/{session.totalBatches} 批次 · {session.fileCount} 个文件
                      {session.finishedAt !== undefined
                        ? ` · ${formatDuration(session.finishedAt - session.startedAt)}`
                        : ''}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <aside className="logger-detail-panel" aria-label="分析任务详情">
            {!selectedSession ? (
              <div className="logger-detail-empty">
                <strong>选择一个分析任务</strong>
                <span>任务中的批次和请求尝试会在这里显示。</span>
              </div>
            ) : (
              <>
                <div className="logger-detail-header">
                  <div>
                    <span className={`logger-status ${getStatusClassName(selectedSession.status)}`}>
                      {getSessionStatusLabel(selectedSession.status)}
                    </span>
                    <h3>分析任务 · {selectedSession.fileCount} 个文件</h3>
                  </div>
                  <span className="logger-detail-time">
                    {formatTimestamp(selectedSession.startedAt)}
                  </span>
                </div>

                <div className="logger-metadata-grid">
                  <div>
                    <span>批次进度</span>
                    <strong>{completedBatchCount}/{selectedSession.totalBatches}</strong>
                  </div>
                  <div>
                    <span>成功文件</span>
                    <strong className="is-success">{successfulFileCount}</strong>
                  </div>
                  <div>
                    <span>失败文件</span>
                    <strong className={failedFileCount > 0 ? 'is-error' : undefined}>
                      {failedFileCount}
                    </strong>
                  </div>
                  <div>
                    <span>任务耗时</span>
                    <strong>
                      {formatDuration(getElapsedDuration(
                        selectedSession.startedAt,
                        selectedSession.finishedAt
                      ))}
                    </strong>
                  </div>
                </div>

                <div className="logger-batch-toolbar">
                  <strong>批次</strong>
                  <div className="logger-filter-group" aria-label="批次筛选">
                    <button
                      type="button"
                      className={batchFilter === 'all' ? 'is-active' : undefined}
                      aria-pressed={batchFilter === 'all'}
                      onClick={() => setBatchFilter('all')}
                    >
                      全部 {selectedSession.totalBatches}
                    </button>
                    <button
                      type="button"
                      className={batchFilter === 'failed' ? 'is-active' : undefined}
                      aria-pressed={batchFilter === 'failed'}
                      onClick={() => setBatchFilter('failed')}
                    >
                      异常 {failedBatchCount}
                    </button>
                    <button
                      type="button"
                      className={batchFilter === 'retried' ? 'is-active' : undefined}
                      aria-pressed={batchFilter === 'retried'}
                      onClick={() => setBatchFilter('retried')}
                    >
                      重试 {retriedBatchCount}
                    </button>
                  </div>
                </div>

                <div className="logger-batch-list" aria-label="批次列表">
                  {filteredBatches.length === 0 ? (
                    <div className="logger-filter-empty">当前筛选条件下没有批次。</div>
                  ) : (
                    filteredBatches.map((batch) => {
                      const latestAttempt = batch.attempts[batch.attempts.length - 1];
                      const isSelected = selectedBatchIndex === batch.batchIndex;

                      return (
                        <button
                          type="button"
                          key={batch.batchIndex}
                          className={`logger-batch-row${isSelected ? ' is-selected' : ''}`}
                          aria-pressed={isSelected}
                          onClick={() => handleSelectBatch(batch.batchIndex)}
                        >
                          <span className="logger-batch-identity">
                            <strong>批次 {batch.batchIndex + 1}</strong>
                            <span>{batch.fileCount} 个文件</span>
                          </span>
                          <span className={`logger-status ${getStatusClassName(batch.status)}`}>
                            {getBatchStatusLabel(batch.status)}
                          </span>
                          <span className="logger-batch-result">
                            {batch.attempts.length > 0
                              ? `${batch.attempts.length} 次尝试`
                              : '尚未请求'}
                          </span>
                          <span className="logger-batch-result">
                            {latestAttempt?.responseStatus !== undefined
                              ? `HTTP ${latestAttempt.responseStatus}`
                              : latestAttempt
                                ? '无响应'
                                : '—'}
                          </span>
                          <span className="logger-batch-duration">
                            {formatDuration(getElapsedDuration(batch.startedAt, batch.finishedAt))}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>

                {selectedBatch && (
                  <section className="logger-attempt-section" aria-label="请求尝试">
                    <div className="logger-attempt-header">
                      <div>
                        <strong>批次 {selectedBatch.batchIndex + 1} 请求记录</strong>
                        <span>
                          成功 {selectedBatch.successfulFileCount}，失败 {selectedBatch.failedFileCount}
                        </span>
                      </div>
                      {selectedBatch.error && (
                        <span className="logger-batch-error selectable-text">
                          {selectedBatch.error}
                        </span>
                      )}
                    </div>

                    {selectedBatch.attempts.length === 0 ? (
                      <div className="logger-no-payload">此批次尚未发起网络请求。</div>
                    ) : (
                      <div className="logger-attempt-layout">
                        <div className="logger-attempt-list">
                          {selectedBatch.attempts.map((attempt) => {
                            const isSelected = selectedAttemptNumber === attempt.attempt;
                            return (
                              <button
                                type="button"
                                key={attempt.attempt}
                                className={`logger-attempt-row${isSelected ? ' is-selected' : ''}`}
                                aria-pressed={isSelected}
                                onClick={() => setSelectedAttemptNumber(attempt.attempt)}
                              >
                                <span>第 {attempt.attempt} 次</span>
                                <span className={`logger-status ${getStatusClassName(attempt.status)}`}>
                                  {getAttemptStatusLabel(attempt.status)}
                                </span>
                                <span>{formatDuration(attempt.durationMs)}</span>
                              </button>
                            );
                          })}
                        </div>

                        {selectedAttempt && (
                          <div className="logger-attempt-detail">
                            <div className="logger-attempt-metadata">
                              <span>{formatTimestamp(selectedAttempt.timestamp)}</span>
                              <span>
                                {selectedAttempt.responseStatus !== undefined
                                  ? `HTTP ${selectedAttempt.responseStatus}`
                                  : '未收到响应'}
                              </span>
                              <span>{formatDuration(selectedAttempt.durationMs)}</span>
                            </div>

                            {selectedAttempt.error && (
                              <div className="logger-attempt-error selectable-text">
                                {selectedAttempt.error}
                              </div>
                            )}

                            <div className="logger-url-row">
                              <span>请求地址</span>
                              <code className="selectable-text">
                                {selectedAttempt.requestUrl}
                              </code>
                            </div>

                            <div className="logger-payload-list">
                              <details className="logger-payload">
                                <summary>请求体</summary>
                                <pre className="selectable-text">
                                  {formatPayload(selectedAttempt.requestBody)}
                                </pre>
                              </details>
                              {selectedAttempt.responseBody !== undefined && (
                                <details className="logger-payload" open>
                                  <summary>响应体</summary>
                                  <pre className="selectable-text">
                                    {formatPayload(selectedAttempt.responseBody)}
                                  </pre>
                                </details>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                )}
              </>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
