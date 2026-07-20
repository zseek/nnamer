import { useEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useAppStore } from './store';
import {
  analyzeBatch,
  executeRenameOperations,
  moveFilesToRecycleBin,
  scanDirectory,
} from './shared/lib/api';
import {
  applySuccessfulFileRenames,
  createConflictCleanupPlan,
  getSelectedExecutableFiles,
  recomputeFileStatuses,
} from './shared/lib/fileUtils';
import {
  createAnalysisSessionLog,
  dispatchAnalysisLifecycleEvent,
} from './shared/lib/analysisLog';
import type { FileItem } from './shared/types';
import SettingsDialog from './SettingsDialog';

type AppNotificationTone = 'success' | 'warning' | 'error';

interface AppNotification {
  tone: AppNotificationTone;
  title: string;
  message: string;
  detail?: string;
}

function formatExecutionError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export default function Toolbar() {
  const {
    currentDirectory,
    setCurrentDirectory,
    setFiles,
    files,
    settings,
    setAnalysisProgress,
    analysisProgress,
    setShowLogger,
    clearFiles,
  } = useAppStore();
  const [isScanning, setIsScanning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isRenameConfirmationOpen, setIsRenameConfirmationOpen] = useState(false);
  const [isConflictCleanupConfirmationOpen, setIsConflictCleanupConfirmationOpen] =
    useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isCleaningConflicts, setIsCleaningConflicts] = useState(false);
  const [appNotification, setAppNotification] = useState<AppNotification | null>(null);
  const appNotificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmationDialogRef = useRef<HTMLElement | null>(null);
  const renameTriggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const conflictCleanupTriggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const isAnalysisPausedRef = useRef(false);
  const activeAnalysisSessionIdRef = useRef<string | null>(null);
  const resumeWaitersRef = useRef<Array<() => void>>([]);

  const conflictCleanupPlan = useMemo(
    () => createConflictCleanupPlan(files),
    [files]
  );
  const isConfirmationOpen =
    isRenameConfirmationOpen || isConflictCleanupConfirmationOpen;

  const closeActiveConfirmation = () => {
    setIsRenameConfirmationOpen(false);
    setIsConflictCleanupConfirmationOpen(false);
  };

  const releasePausedWorkers = () => {
    const waitingResolvers = resumeWaitersRef.current.splice(0);
    waitingResolvers.forEach((resolveWaitingWorker) => resolveWaitingWorker());
  };

  const waitUntilAnalysisResumes = async () => {
    if (!isAnalysisPausedRef.current) {
      return;
    }

    await new Promise<void>((resolve) => {
      resumeWaitersRef.current.push(resolve);
    });
  };

  const dismissAppNotification = () => {
    if (appNotificationTimerRef.current) {
      clearTimeout(appNotificationTimerRef.current);
      appNotificationTimerRef.current = null;
    }

    setAppNotification(null);
  };

  const displayAppNotification = (
    notification: AppNotification,
    durationMilliseconds: number
  ) => {
    if (appNotificationTimerRef.current) {
      clearTimeout(appNotificationTimerRef.current);
    }

    setAppNotification(notification);
    appNotificationTimerRef.current = setTimeout(() => {
      appNotificationTimerRef.current = null;
      setAppNotification(null);
    }, durationMilliseconds);
  };

  useEffect(() => () => {
    if (appNotificationTimerRef.current) {
      clearTimeout(appNotificationTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!isConfirmationOpen) {
      return undefined;
    }

    const dialogElement = confirmationDialogRef.current;
    const focusableElements = dialogElement
      ? Array.from(
          dialogElement.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        )
      : [];
    const firstFocusableElement = focusableElements[0];
    const lastFocusableElement = focusableElements[focusableElements.length - 1];

    firstFocusableElement?.focus();

    const handleConfirmationKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeActiveConfirmation();
        return;
      }

      if (event.key !== 'Tab' || focusableElements.length === 0) {
        return;
      }

      if (event.shiftKey && document.activeElement === firstFocusableElement) {
        event.preventDefault();
        lastFocusableElement?.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusableElement) {
        event.preventDefault();
        firstFocusableElement?.focus();
      }
    };

    window.addEventListener('keydown', handleConfirmationKeyDown);
    return () => {
      window.removeEventListener('keydown', handleConfirmationKeyDown);
      if (isConflictCleanupConfirmationOpen) {
        conflictCleanupTriggerButtonRef.current?.focus();
      } else {
        renameTriggerButtonRef.current?.focus();
      }
    };
  }, [isConfirmationOpen, isConflictCleanupConfirmationOpen]);

  const handleClearWorkspace = () => {
    const isTaskRunning =
      isScanning
      || analysisProgress.isRunning
      || isRenaming
      || isCleaningConflicts;

    if (!currentDirectory || isTaskRunning) {
      return;
    }

    dismissAppNotification();
    closeActiveConfirmation();
    isAnalysisPausedRef.current = false;
    releasePausedWorkers();
    clearFiles();
  };

  const handleToggleAnalysisPause = () => {
    if (!analysisProgress.isRunning) {
      return;
    }

    if (isAnalysisPausedRef.current) {
      isAnalysisPausedRef.current = false;
      setAnalysisProgress({ isPaused: false });
      if (activeAnalysisSessionIdRef.current) {
        dispatchAnalysisLifecycleEvent({
          type: 'session-status',
          sessionId: activeAnalysisSessionIdRef.current,
          status: 'running',
        });
      }
      releasePausedWorkers();
      return;
    }

    isAnalysisPausedRef.current = true;
    setAnalysisProgress({ isPaused: true });
    if (activeAnalysisSessionIdRef.current) {
      dispatchAnalysisLifecycleEvent({
        type: 'session-status',
        sessionId: activeAnalysisSessionIdRef.current,
        status: 'paused',
      });
    }
  };

  const handleSelectDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择目录',
      });

      if (selected && typeof selected === 'string') {
        setIsScanning(true);
        setCurrentDirectory(selected);
        
        try {
          const scannedFiles = await scanDirectory(selected);
          const filesWithDefaults: FileItem[] = scannedFiles.map((file) => ({
            ...file,
            selected: false,
            hasBeenRenamed: false,
            status: 'pending',
          }));
          setFiles(filesWithDefaults);
        } catch (error) {
          console.error('扫描失败:', error);
          alert(`扫描失败: ${error}`);
        } finally {
          setIsScanning(false);
        }
      }
    } catch (error) {
      console.error('选择目录失败:', error);
      setIsScanning(false);
    }
  };

  const handleAnalyzeAll = async () => {
    if (!settings || analysisProgress.isRunning) {
      return;
    }

    const selectedFiles = files.filter((file) => file.selected);
    if (selectedFiles.length === 0) {
      alert('请先选择要分析的文件');
      return;
    }

    const analyzableFiles = selectedFiles.filter(
      (file) => file.status === 'pending' || file.status === 'failed'
    );
    if (analyzableFiles.length === 0) {
      alert('所选文件没有待分析或可重试的项目');
      return;
    }

    const selectedFileIds = new Set(selectedFiles.map((file) => file.id));
    setFiles((currentFiles) =>
      currentFiles.map((file) =>
        selectedFileIds.has(file.id) ? { ...file, selected: false } : file
      )
    );

    const batches: FileItem[][] = [];
    for (
      let batchStart = 0;
      batchStart < analyzableFiles.length;
      batchStart += settings.batchSize
    ) {
      batches.push(analyzableFiles.slice(batchStart, batchStart + settings.batchSize));
    }

    const analysisSessionId = crypto.randomUUID();
    const analysisStartedAt = Date.now();
    activeAnalysisSessionIdRef.current = analysisSessionId;
    dispatchAnalysisLifecycleEvent({
      type: 'session-started',
      session: createAnalysisSessionLog(
        analysisSessionId,
        analysisStartedAt,
        batches.map((batch) => batch.length)
      ),
    });

    isAnalysisPausedRef.current = false;
    releasePausedWorkers();
    setAnalysisProgress({
      totalBatches: batches.length,
      completedBatches: 0,
      failedBatches: 0,
      isRunning: true,
      isPaused: false,
    });

    let successfulAnalyzedFileCount = 0;
    let failedAnalyzedFileCount = 0;

    const processBatch = async (batchIndex: number) => {
      const batch = batches[batchIndex];
      const batchFileIds = new Set(batch.map((file) => file.id));
      dispatchAnalysisLifecycleEvent({
        type: 'batch-started',
        sessionId: analysisSessionId,
        batchIndex,
        startedAt: Date.now(),
      });

      setFiles((currentFiles) =>
        currentFiles.map((file) =>
          batchFileIds.has(file.id)
            ? {
                ...file,
                suggestedName: undefined,
                normalizedName: undefined,
                error: undefined,
                status: 'analyzing',
              }
            : file
        )
      );

      try {
        const requests = batch.map((file) => ({
          fileId: file.id,
          originalStem: file.originalStem,
        }));
        const result = await analyzeBatch(
          settings,
          analysisSessionId,
          batchIndex,
          requests
        );
        const resultByFileId = new Map(
          result.results.map((analysisResult) => [analysisResult.fileId, analysisResult])
        );
        const batchFailedFileCount = batch.reduce((failedFileCount, file) => {
          const analysisResult = resultByFileId.get(file.id);
          const resultError = analysisResult?.error
            ?? (!analysisResult?.suggestedName
              ? 'LLM 响应中缺少建议名称'
              : !analysisResult.normalizedName
                ? '建议名称无法通过校验'
                : undefined);

          return failedFileCount + (resultError ? 1 : 0);
        }, 0);
        const batchSuccessfulFileCount = batch.length - batchFailedFileCount;
        successfulAnalyzedFileCount += batchSuccessfulFileCount;
        failedAnalyzedFileCount += batchFailedFileCount;

        setFiles((currentFiles) => {
          const filesWithResults = currentFiles.map((file) => {
            if (!batchFileIds.has(file.id)) {
              return file;
            }

            const analysisResult = resultByFileId.get(file.id);
            if (!analysisResult) {
              return {
                ...file,
                status: 'failed' as const,
                error: 'LLM 响应中缺少此文件',
              };
            }

            const resultError = analysisResult.error
              ?? (!analysisResult.suggestedName
                ? 'LLM 响应中缺少建议名称'
                : !analysisResult.normalizedName
                  ? '建议名称无法通过校验'
                  : undefined);

            return {
              ...file,
              suggestedName: analysisResult.suggestedName,
              normalizedName: analysisResult.normalizedName,
              error: resultError,
              status: resultError ? 'failed' as const : 'ready' as const,
            };
          });

          return recomputeFileStatuses(filesWithResults);
        });

        setAnalysisProgress((previousProgress) => ({
          completedBatches: previousProgress.completedBatches + 1,
        }));
        dispatchAnalysisLifecycleEvent({
          type: 'batch-finished',
          sessionId: analysisSessionId,
          batchIndex,
          status: batchFailedFileCount === 0 ? 'success' : 'partial',
          finishedAt: Date.now(),
          successfulFileCount: batchSuccessfulFileCount,
          failedFileCount: batchFailedFileCount,
        });
      } catch (error) {
        const errorMessage = formatExecutionError(error);
        failedAnalyzedFileCount += batch.length;
        console.error(`批次 ${batchIndex} 失败:`, error);
        setFiles((currentFiles) =>
          recomputeFileStatuses(
            currentFiles.map((file) =>
              batchFileIds.has(file.id)
                ? {
                    ...file,
                    status: 'failed' as const,
                    error: `批次失败：${errorMessage}`,
                  }
                : file
            )
          )
        );

        setAnalysisProgress((previousProgress) => ({
          failedBatches: previousProgress.failedBatches + 1,
        }));
        dispatchAnalysisLifecycleEvent({
          type: 'batch-finished',
          sessionId: analysisSessionId,
          batchIndex,
          status: 'failed',
          finishedAt: Date.now(),
          successfulFileCount: 0,
          failedFileCount: batch.length,
          error: errorMessage,
        });
      }
    };

    let nextBatchIndex = 0;
    const runWorker = async () => {
      while (true) {
        if (nextBatchIndex >= batches.length) {
          return;
        }

        await waitUntilAnalysisResumes();

        if (nextBatchIndex >= batches.length) {
          return;
        }

        const claimedBatchIndex = nextBatchIndex;
        nextBatchIndex += 1;
        await processBatch(claimedBatchIndex);
      }
    };

    const workerCount = Math.min(settings.concurrency, batches.length);
    try {
      await Promise.all(
        Array.from({ length: workerCount }, () => runWorker())
      );
    } finally {
      const finalSessionStatus = failedAnalyzedFileCount === 0
        ? 'success'
        : successfulAnalyzedFileCount === 0
          ? 'failed'
          : 'partial';
      dispatchAnalysisLifecycleEvent({
        type: 'session-finished',
        sessionId: analysisSessionId,
        status: finalSessionStatus,
        finishedAt: Date.now(),
      });
      if (activeAnalysisSessionIdRef.current === analysisSessionId) {
        activeAnalysisSessionIdRef.current = null;
      }
      isAnalysisPausedRef.current = false;
      releasePausedWorkers();
      setAnalysisProgress({ isRunning: false, isPaused: false });
    }
  };

  const handleRequestConflictCleanup = () => {
    if (conflictCleanupPlan.filesToRemove.length === 0) {
      displayAppNotification(
        {
          tone: 'warning',
          title: '没有可自动清理的冲突',
          message: '当前没有建议文件名相同的冲突项。',
        },
        6000
      );
      return;
    }

    setIsConflictCleanupConfirmationOpen(true);
  };

  const handleExecuteConflictCleanup = async () => {
    const latestCleanupPlan = createConflictCleanupPlan(files);
    const filesToRemove = latestCleanupPlan.filesToRemove;

    if (!currentDirectory || filesToRemove.length === 0) {
      setIsConflictCleanupConfirmationOpen(false);
      displayAppNotification(
        {
          tone: 'error',
          title: '无法清理冲突',
          message: '当前目录或冲突列表已经发生变化，请重新检查后再试。',
        },
        6000
      );
      return;
    }

    setIsConflictCleanupConfirmationOpen(false);
    dismissAppNotification();
    setIsCleaningConflicts(true);

    try {
      const results = await moveFilesToRecycleBin(
        currentDirectory,
        filesToRemove.map((file) => ({
          fileId: file.id,
          originalName: file.originalName,
          sizeBytes: file.sizeBytes,
          modifiedAt: file.modifiedAt,
        }))
      );
      const candidateFileIds = new Set(filesToRemove.map((file) => file.id));
      const successfulFileIds = new Set(
        results
          .filter(
            (result) => result.success && candidateFileIds.has(result.fileId)
          )
          .map((result) => result.fileId)
      );
      const failedResults = results.filter((result) => !result.success);
      const failureCount = filesToRemove.length - successfulFileIds.size;

      if (successfulFileIds.size > 0) {
        setFiles((currentFiles) =>
          recomputeFileStatuses(
            currentFiles.filter((file) => !successfulFileIds.has(file.id))
          )
        );
      }

      if (failureCount === 0) {
        displayAppNotification(
          {
            tone: 'success',
            title: '冲突清理完成',
            message: `已保留 ${latestCleanupPlan.resolvableGroups.length} 个文件，并将 ${successfulFileIds.size} 个重复文件移入回收站。`,
          },
          5000
        );
        return;
      }

      const failedFileById = new Map(
        filesToRemove.map((file) => [file.id, file.originalName])
      );
      const firstFailure = failedResults[0];
      const firstFailureDetail = firstFailure
        ? `${failedFileById.get(firstFailure.fileId) ?? firstFailure.fileId}：${
            firstFailure.error ?? '未知错误'
          }`
        : '部分文件未返回操作结果';

      displayAppNotification(
        {
          tone: successfulFileIds.size > 0 ? 'warning' : 'error',
          title: successfulFileIds.size > 0 ? '部分冲突未能清理' : '冲突清理未完成',
          message: `已移入回收站 ${successfulFileIds.size} 个，失败 ${failureCount} 个。失败项目仍保留在列表中。`,
          detail: firstFailureDetail,
        },
        9000
      );
    } catch (error) {
      console.error('清理冲突失败:', error);
      displayAppNotification(
        {
          tone: 'error',
          title: '冲突清理失败',
          message: '文件未从列表中移除，你可以检查问题后重新执行。',
          detail: formatExecutionError(error),
        },
        9000
      );
    } finally {
      setIsCleaningConflicts(false);
    }
  };

  const handleRequestRenameExecution = () => {
    const selectedExecutableFileCount = getSelectedExecutableFiles(files).length;

    if (selectedExecutableFileCount === 0) {
      displayAppNotification(
        {
          tone: 'warning',
          title: '没有已选的可执行文件',
          message: '请先选中状态为“可执行”的文件，再执行重命名。',
        },
        5000
      );
      return;
    }

    setIsRenameConfirmationOpen(true);
  };

  const handleExecuteRename = async () => {
    const selectedExecutableFiles = getSelectedExecutableFiles(files);

    if (!currentDirectory || selectedExecutableFiles.length === 0) {
      setIsRenameConfirmationOpen(false);
      displayAppNotification(
        {
          tone: 'error',
          title: '无法执行重命名',
          message: '当前目录或已选可执行文件列表已经发生变化，请重新检查后再试。',
        },
        6000
      );
      return;
    }

    setIsRenameConfirmationOpen(false);
    dismissAppNotification();
    setIsRenaming(true);

    const operations = selectedExecutableFiles.map((file) => ({
      fileId: file.id,
      originalName: file.originalName,
      targetName: file.normalizedName!,
    }));

    const metadataSnapshot = Object.fromEntries(
      selectedExecutableFiles.map((file) => [
        file.id,
        {
          sizeBytes: file.sizeBytes,
          modifiedAt: file.modifiedAt,
        },
      ])
    );

    try {
      const results = await executeRenameOperations(
        currentDirectory,
        operations,
        metadataSnapshot
      );
      const filesById = new Map(
        selectedExecutableFiles.map((file) => [file.id, file])
      );
      const successfulFileTargetById = new Map<string, string>();

      for (const result of results) {
        const matchedFile = filesById.get(result.fileId);
        if (result.success && matchedFile?.normalizedName) {
          successfulFileTargetById.set(matchedFile.id, matchedFile.normalizedName);
        }
      }

      const successfulFileIds = Array.from(successfulFileTargetById.keys());
      const failedResults = results.filter((result) => !result.success);
      const missingResultCount = Math.max(
        0,
        selectedExecutableFiles.length - results.length
      );
      const failureCount = Math.max(
        0,
        selectedExecutableFiles.length - successfulFileIds.length
      );

      if (successfulFileIds.length > 0) {
        setFiles((currentFiles) =>
          applySuccessfulFileRenames(currentFiles, successfulFileTargetById)
        );
      }

      if (failureCount === 0) {
        displayAppNotification(
          {
            tone: 'success',
            title: '重命名完成',
            message: `已成功重命名 ${successfulFileIds.length} 个文件，并保留为“已重命名”状态。`,
          },
          4500
        );
        return;
      }

      const firstFailure = failedResults[0];
      const failureDetail = firstFailure?.error
        ? `${firstFailure.fileId}：${firstFailure.error}`
        : missingResultCount > 0
          ? `${missingResultCount} 个文件未返回执行结果`
          : undefined;

      displayAppNotification(
        {
          tone: successfulFileIds.length > 0 ? 'warning' : 'error',
          title: successfulFileIds.length > 0 ? '部分文件未能重命名' : '重命名未完成',
          message: `成功 ${successfulFileIds.length} 个，失败 ${failureCount} 个。成功文件已标记为“已重命名”，失败文件仍保留以便检查。`,
          detail: failureDetail,
        },
        8000
      );
    } catch (error) {
      console.error('执行重命名失败:', error);
      displayAppNotification(
        {
          tone: 'error',
          title: '执行重命名失败',
          message: '文件未从列表中移除，你可以检查问题后重新执行。',
          detail: formatExecutionError(error),
        },
        8000
      );
    } finally {
      setIsRenaming(false);
    }
  };

  const handleSettingsSaveSuccess = () => {
    setShowSettings(false);
    displayAppNotification(
      {
        tone: 'success',
        title: '设置已保存',
        message: '新的设置将在后续分析请求中生效。',
      },
      4500
    );
  };

  const handleSettingsSaveError = (errorMessage: string) => {
    displayAppNotification(
      {
        tone: 'error',
        title: '设置保存失败',
        message: '你的修改仍保留在设置窗口中，可以修正后重新保存。',
        detail: errorMessage,
      },
      8000
    );
  };

  const selectedAnalyzableCount = files.filter(
    (file) => file.selected && (file.status === 'pending' || file.status === 'failed')
  ).length;
  const selectedExecutableCount = getSelectedExecutableFiles(files).length;
  const conflictFileCount = files.filter((file) => file.status === 'conflict').length;
  const isFileOperationRunning = isRenaming || isCleaningConflicts;
  const processedBatchCount =
    analysisProgress.completedBatches + analysisProgress.failedBatches;

  return (
    <>
      <div className="toolbar">
        <button
          className="btn"
          onClick={handleSelectDirectory}
          disabled={isScanning || analysisProgress.isRunning || isFileOperationRunning}
        >
          {isScanning ? '扫描中...' : '选择目录'}
        </button>
        
        {currentDirectory && (
          <>
            <span
              className="toolbar-directory-path"
              title={currentDirectory}
            >
              {currentDirectory}
            </span>
            <button
              type="button"
              className="btn toolbar-clear-button"
              onClick={handleClearWorkspace}
              disabled={
                isScanning
                || analysisProgress.isRunning
                || isFileOperationRunning
              }
              title="关闭当前目录并清空任务列表，不会修改磁盘文件"
            >
              清空任务
            </button>
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button 
            className="btn" 
            onClick={() => setShowLogger(true)}
          >
            日志
          </button>
          
          <button 
            className="btn" 
            onClick={() => setShowSettings(true)}
          >
            设置
          </button>
          
          <button
            className="btn"
            onClick={handleAnalyzeAll}
            disabled={
              !settings
              || selectedAnalyzableCount === 0
              || analysisProgress.isRunning
              || isFileOperationRunning
            }
          >
            {analysisProgress.isRunning
              ? `${analysisProgress.isPaused ? '已暂停' : '分析中'} ${processedBatchCount}/${analysisProgress.totalBatches}`
              : `分析已选 (${selectedAnalyzableCount})`}
          </button>

          {analysisProgress.isRunning && (
            <button
              className="btn"
              onClick={handleToggleAnalysisPause}
            >
              {analysisProgress.isPaused ? '继续分析' : '暂停分析'}
            </button>
          )}

          {conflictFileCount > 0 && (
            <button
              ref={conflictCleanupTriggerButtonRef}
              className="btn btn-warning"
              onClick={handleRequestConflictCleanup}
              disabled={analysisProgress.isRunning || isFileOperationRunning}
              title="每组保留一个体积最大的文件；大小相同时保留文件名排序靠前的一个，其余移入回收站"
            >
              {isCleaningConflicts
                ? '正在清理冲突...'
                : `清理冲突 (${conflictCleanupPlan.filesToRemove.length})`}
            </button>
          )}

          <button
            ref={renameTriggerButtonRef}
            className="btn btn-primary"
            onClick={handleRequestRenameExecution}
            disabled={
              selectedExecutableCount === 0
              || analysisProgress.isRunning
              || isFileOperationRunning
            }
          >
            {isRenaming
              ? '正在重命名...'
              : `执行重命名 (${selectedExecutableCount})`}
          </button>
        </div>
      </div>

      <SettingsDialog
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onSaveSuccess={handleSettingsSaveSuccess}
        onSaveError={handleSettingsSaveError}
      />

      {isRenameConfirmationOpen && (
        <div
          className="operation-confirmation-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsRenameConfirmationOpen(false);
            }
          }}
        >
          <section
            ref={confirmationDialogRef}
            className="operation-confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="operation-confirmation-title"
            aria-describedby="operation-confirmation-description"
          >
            <div className="operation-confirmation-header">
              <div>
                <h2 id="operation-confirmation-title">确认执行重命名</h2>
                <p id="operation-confirmation-description">
                  将仅处理当前已选中且状态为“可执行”的文件。
                </p>
              </div>
            </div>

            <div className="operation-confirmation-summary">
              <span>待重命名文件</span>
              <strong>{selectedExecutableCount}</strong>
              <span>个</span>
            </div>

            <div className="operation-confirmation-notice">
              执行前会再次校验文件状态。成功项目将标记为“已重命名”并继续参与冲突检测，未成功项目会保留以便检查。
            </div>

            <div className="operation-confirmation-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setIsRenameConfirmationOpen(false)}
              >
                返回检查
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleExecuteRename}
              >
                重命名 {selectedExecutableCount} 个文件
              </button>
            </div>
          </section>
        </div>
      )}

      {isConflictCleanupConfirmationOpen && (
        <div
          className="operation-confirmation-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsConflictCleanupConfirmationOpen(false);
            }
          }}
        >
          <section
            ref={confirmationDialogRef}
            className="operation-confirmation-dialog conflict-cleanup-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="conflict-cleanup-title"
            aria-describedby="conflict-cleanup-description"
          >
            <div className="operation-confirmation-header">
              <div>
                <h2 id="conflict-cleanup-title">保留一个副本并清理冲突</h2>
                <p id="conflict-cleanup-description">
                  每组保留体积最大的一个文件；若多个文件大小相同，则按原文件名排序保留其中一个，其余将移入系统回收站。
                </p>
              </div>
            </div>

            <div className="conflict-cleanup-summary-grid">
              <div className="conflict-cleanup-summary-item">
                <span>待处理冲突组</span>
                <strong>{conflictCleanupPlan.resolvableGroups.length}</strong>
              </div>
              <div className="conflict-cleanup-summary-item is-removal">
                <span>待删除文件</span>
                <strong>{conflictCleanupPlan.filesToRemove.length}</strong>
              </div>
            </div>

            <div className="operation-confirmation-notice conflict-cleanup-notice">
              执行前会再次校验文件大小和修改时间。元数据变化或移动失败的文件不会从列表移除。
            </div>

            <div className="operation-confirmation-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setIsConflictCleanupConfirmationOpen(false)}
              >
                返回检查
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleExecuteConflictCleanup}
              >
                移入回收站 {conflictCleanupPlan.filesToRemove.length} 个文件
              </button>
            </div>
          </section>
        </div>
      )}

      {appNotification && (
        <aside
          className={`app-notification app-notification-${appNotification.tone}`}
          role={appNotification.tone === 'success' ? 'status' : 'alert'}
          aria-live={appNotification.tone === 'success' ? 'polite' : 'assertive'}
        >
          <span className="app-notification-symbol" aria-hidden="true">
            {appNotification.tone === 'success' ? '✓' : '!'}
          </span>
          <div className="app-notification-content">
            <div className="app-notification-title">{appNotification.title}</div>
            <div className="app-notification-message">{appNotification.message}</div>
            {appNotification.detail && (
              <div className="app-notification-detail selectable-text" title={appNotification.detail}>
                {appNotification.detail}
              </div>
            )}
          </div>
          <button
            type="button"
            className="app-notification-close"
            onClick={dismissAppNotification}
            aria-label="关闭通知"
          >
            ×
          </button>
        </aside>
      )}
    </>
  );
}
