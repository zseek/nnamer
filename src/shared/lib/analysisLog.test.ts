import { describe, expect, it } from 'vitest';
import {
  applyAnalysisAttemptEvent,
  applyAnalysisLifecycleEvent,
  createAnalysisSessionLog,
} from './analysisLog';

function createStartedSession() {
  const session = createAnalysisSessionLog('session-1', 1000, [20, 5]);
  return applyAnalysisLifecycleEvent([], {
    type: 'session-started',
    session,
  });
}

describe('analysis log aggregation', () => {
  it('updates one session and batch instead of appending lifecycle rows', () => {
    const startedSessions = createStartedSession();
    const runningSessions = applyAnalysisLifecycleEvent(startedSessions, {
      type: 'batch-started',
      sessionId: 'session-1',
      batchIndex: 0,
      startedAt: 1100,
    });
    const finishedSessions = applyAnalysisLifecycleEvent(runningSessions, {
      type: 'batch-finished',
      sessionId: 'session-1',
      batchIndex: 0,
      status: 'success',
      finishedAt: 1300,
      successfulFileCount: 20,
      failedFileCount: 0,
    });

    expect(finishedSessions).toHaveLength(1);
    expect(finishedSessions[0].batches).toHaveLength(2);
    expect(finishedSessions[0].batches[0]).toMatchObject({
      status: 'success',
      startedAt: 1100,
      finishedAt: 1300,
      successfulFileCount: 20,
      failedFileCount: 0,
    });
  });

  it('keeps retries under the same batch and preserves the final error kind', () => {
    const startedSessions = applyAnalysisLifecycleEvent(createStartedSession(), {
      type: 'batch-started',
      sessionId: 'session-1',
      batchIndex: 0,
      startedAt: 1100,
    });
    const firstAttemptSessions = applyAnalysisAttemptEvent(startedSessions, {
      sessionId: 'session-1',
      timestamp: 1200,
      batchIndex: 0,
      attempt: 1,
      status: 'network_error',
      requestUrl: 'https://example.test/v1/chat/completions',
      requestBody: '{}',
      durationMs: 100,
      error: '连接超时',
      willRetry: true,
    });
    const secondAttemptSessions = applyAnalysisAttemptEvent(firstAttemptSessions, {
      sessionId: 'session-1',
      timestamp: 1400,
      batchIndex: 0,
      attempt: 2,
      status: 'http_error',
      requestUrl: 'https://example.test/v1/chat/completions',
      requestBody: '{}',
      responseStatus: 503,
      responseBody: 'unavailable',
      durationMs: 200,
      error: 'HTTP 503',
      willRetry: false,
    });
    const finishedSessions = applyAnalysisLifecycleEvent(secondAttemptSessions, {
      type: 'batch-finished',
      sessionId: 'session-1',
      batchIndex: 0,
      status: 'failed',
      finishedAt: 1500,
      successfulFileCount: 0,
      failedFileCount: 20,
      error: '重试后仍然失败',
    });

    expect(firstAttemptSessions[0].batches[0].status).toBe('retrying');
    expect(finishedSessions[0].batches[0].status).toBe('http_error');
    expect(finishedSessions[0].batches[0].attempts).toHaveLength(2);
  });

  it('limits retained sessions to the most recent twenty tasks', () => {
    let sessions = createStartedSession();

    for (let sessionIndex = 2; sessionIndex <= 24; sessionIndex += 1) {
      sessions = applyAnalysisLifecycleEvent(sessions, {
        type: 'session-started',
        session: createAnalysisSessionLog(
          `session-${sessionIndex}`,
          1000 + sessionIndex,
          [1]
        ),
      });
    }

    expect(sessions).toHaveLength(20);
    expect(sessions[0].id).toBe('session-24');
    expect(sessions.some((session) => session.id === 'session-1')).toBe(false);
  });
});
