export const ANALYSIS_LIFECYCLE_EVENT = 'nnamer:analysis-lifecycle';
export const ANALYSIS_ATTEMPT_EVENT = 'analysis-attempt-event';
export const MAX_ANALYSIS_LOG_SESSIONS = 20;

export type AnalysisSessionStatus =
  | 'running'
  | 'stopped'
  | 'success'
  | 'partial'
  | 'failed';

export type AnalysisBatchStatus =
  | 'pending'
  | 'skipped'
  | 'running'
  | 'retrying'
  | 'success'
  | 'partial'
  | 'failed'
  | 'http_error'
  | 'network_error'
  | 'parse_error';

export type AnalysisAttemptStatus =
  | 'success'
  | 'http_error'
  | 'network_error'
  | 'parse_error';

export interface AnalysisAttemptLog {
  sessionId: string;
  timestamp: number;
  batchIndex: number;
  attempt: number;
  status: AnalysisAttemptStatus;
  requestUrl: string;
  requestBody: string;
  responseStatus?: number;
  responseBody?: string;
  durationMs: number;
  error?: string;
  willRetry: boolean;
}

export interface AnalysisBatchLog {
  batchIndex: number;
  fileCount: number;
  status: AnalysisBatchStatus;
  startedAt?: number;
  finishedAt?: number;
  successfulFileCount: number;
  failedFileCount: number;
  error?: string;
  attempts: AnalysisAttemptLog[];
}

export interface AnalysisSessionLog {
  id: string;
  startedAt: number;
  finishedAt?: number;
  status: AnalysisSessionStatus;
  fileCount: number;
  totalBatches: number;
  batches: AnalysisBatchLog[];
}

interface SessionStartedEvent {
  type: 'session-started';
  session: AnalysisSessionLog;
}

interface SessionFinishedEvent {
  type: 'session-finished';
  sessionId: string;
  status: 'stopped' | 'success' | 'partial' | 'failed';
  finishedAt: number;
}

interface BatchStartedEvent {
  type: 'batch-started';
  sessionId: string;
  batchIndex: number;
  startedAt: number;
}

interface BatchFinishedEvent {
  type: 'batch-finished';
  sessionId: string;
  batchIndex: number;
  status: 'success' | 'partial' | 'failed';
  finishedAt: number;
  successfulFileCount: number;
  failedFileCount: number;
  error?: string;
}

export type AnalysisLifecycleEvent =
  | SessionStartedEvent
  | SessionFinishedEvent
  | BatchStartedEvent
  | BatchFinishedEvent;

export interface AnalysisBatchClaim<T> {
  batchIndex: number;
  items: ReadonlyArray<T>;
}

export interface AnalysisBatchQueue<T> {
  claimNextBatch: () => AnalysisBatchClaim<T> | null;
  requestStop: () => void;
  wasStopRequested: () => boolean;
  getUnclaimedItems: () => T[];
}

export function createAnalysisBatchQueue<T>(
  batches: ReadonlyArray<ReadonlyArray<T>>
): AnalysisBatchQueue<T> {
  let nextBatchIndex = 0;
  let stopRequested = false;

  return {
    claimNextBatch: () => {
      if (stopRequested || nextBatchIndex >= batches.length) {
        return null;
      }

      const claimedBatchIndex = nextBatchIndex;
      nextBatchIndex += 1;

      return {
        batchIndex: claimedBatchIndex,
        items: batches[claimedBatchIndex],
      };
    },
    requestStop: () => {
      stopRequested = true;
    },
    wasStopRequested: () => stopRequested,
    getUnclaimedItems: () =>
      batches
        .slice(nextBatchIndex)
        .flatMap((batch) => [...batch]),
  };
}

export function createAnalysisSessionLog(
  sessionId: string,
  startedAt: number,
  batchFileCounts: number[]
): AnalysisSessionLog {
  return {
    id: sessionId,
    startedAt,
    status: 'running',
    fileCount: batchFileCounts.reduce(
      (totalFileCount, batchFileCount) => totalFileCount + batchFileCount,
      0
    ),
    totalBatches: batchFileCounts.length,
    batches: batchFileCounts.map((fileCount, batchIndex) => ({
      batchIndex,
      fileCount,
      status: 'pending',
      successfulFileCount: 0,
      failedFileCount: 0,
      attempts: [],
    })),
  };
}

export function dispatchAnalysisLifecycleEvent(
  lifecycleEvent: AnalysisLifecycleEvent
): void {
  window.dispatchEvent(
    new CustomEvent<AnalysisLifecycleEvent>(ANALYSIS_LIFECYCLE_EVENT, {
      detail: lifecycleEvent,
    })
  );
}

function updateSessionBatch(
  session: AnalysisSessionLog,
  batchIndex: number,
  updateBatch: (batch: AnalysisBatchLog) => AnalysisBatchLog
): AnalysisSessionLog {
  return {
    ...session,
    batches: session.batches.map((batch) =>
      batch.batchIndex === batchIndex ? updateBatch(batch) : batch
    ),
  };
}

export function applyAnalysisLifecycleEvent(
  sessions: AnalysisSessionLog[],
  lifecycleEvent: AnalysisLifecycleEvent
): AnalysisSessionLog[] {
  if (lifecycleEvent.type === 'session-started') {
    return [
      lifecycleEvent.session,
      ...sessions.filter((session) => session.id !== lifecycleEvent.session.id),
    ].slice(0, MAX_ANALYSIS_LOG_SESSIONS);
  }

  return sessions.map((session) => {
    if (session.id !== lifecycleEvent.sessionId) {
      return session;
    }

    switch (lifecycleEvent.type) {
      case 'session-finished':
        return {
          ...session,
          status: lifecycleEvent.status,
          finishedAt: lifecycleEvent.finishedAt,
          batches: lifecycleEvent.status === 'stopped'
            ? session.batches.map((batch) =>
                batch.status === 'pending'
                  ? { ...batch, status: 'skipped' as const }
                  : batch
              )
            : session.batches,
        };
      case 'batch-started':
        return updateSessionBatch(
          session,
          lifecycleEvent.batchIndex,
          (batch) => ({
            ...batch,
            status: 'running',
            startedAt: lifecycleEvent.startedAt,
            finishedAt: undefined,
            successfulFileCount: 0,
            failedFileCount: 0,
            error: undefined,
          })
        );
      case 'batch-finished':
        return updateSessionBatch(
          session,
          lifecycleEvent.batchIndex,
          (batch) => {
            const failureStatuses: AnalysisBatchStatus[] = [
              'http_error',
              'network_error',
              'parse_error',
            ];
            const finalStatus = lifecycleEvent.status === 'failed'
              && failureStatuses.includes(batch.status)
              ? batch.status
              : lifecycleEvent.status;

            return {
              ...batch,
              status: finalStatus,
              finishedAt: lifecycleEvent.finishedAt,
              successfulFileCount: lifecycleEvent.successfulFileCount,
              failedFileCount: lifecycleEvent.failedFileCount,
              error: lifecycleEvent.error ?? batch.error,
            };
          }
        );
    }
  });
}

export function applyAnalysisAttemptEvent(
  sessions: AnalysisSessionLog[],
  attemptEvent: AnalysisAttemptLog
): AnalysisSessionLog[] {
  return sessions.map((session) => {
    if (session.id !== attemptEvent.sessionId) {
      return session;
    }

    return updateSessionBatch(session, attemptEvent.batchIndex, (batch) => {
      const attempts = [
        ...batch.attempts.filter(
          (attempt) => attempt.attempt !== attemptEvent.attempt
        ),
        attemptEvent,
      ].sort((firstAttempt, secondAttempt) =>
        firstAttempt.attempt - secondAttempt.attempt
      );
      const status: AnalysisBatchStatus = attemptEvent.status === 'success'
        ? 'success'
        : attemptEvent.willRetry
          ? 'retrying'
          : attemptEvent.status;

      return {
        ...batch,
        status,
        attempts,
        error: attemptEvent.error,
      };
    });
  });
}
