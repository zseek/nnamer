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
  chunkItems,
  createConflictCleanupPlan,
  getSelectedAnalyzableFiles,
  getSelectedExecutableFiles,
  recomputeFileStatuses,
} from './shared/lib/fileUtils';
import {
  createAnalysisBatchQueue,
  createAnalysisSessionLog,
  dispatchAnalysisLifecycleEvent,
  type AnalysisBatchQueue,
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
    selectedFileIds,
    clearSelectionForIds,
    settings,
    setAnalysisProgress,
    analysisProgress,
    fileOperationProgress,
    setFileOperationProgress,
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
  const activeAnalysisSessionIdRef = useRef<string | null>(null);
  const activeAnalysisQueueRef = useRef<AnalysisBatchQueue<FileItem> | null>(null);

  const conflictCleanupPlan = useMemo(
    () => createConflictCleanupPlan(files, {
      selectedOnly: true,
      selectedFileIds,
    }),
    [files, selectedFileIds]
  );
  const isConfirmationOpen =
    isRenameConfirmationOpen || isConflictCleanupConfirmationOpen;

  const closeActiveConfirmation = () => {
    setIsRenameConfirmationOpen(false);
    setIsConflictCleanupConfirmationOpen(false);
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
    activeAnalysisQueueRef.current = null;
    clearFiles();
  };

  const handlePauseAnalysis = () => {
    const activeAnalysisQueue = activeAnalysisQueueRef.current;
    const analysisSessionId = activeAnalysisSessionIdRef.current;
    if (!analysisProgress.isRunning || !activeAnalysisQueue || !analysisSessionId) {
      return;
    }

    activeAnalysisQueue.requestStop();
    const unstartedFiles = activeAnalysisQueue.getUnclaimedItems();

    dispatchAnalysisLifecycleEvent({
      type: 'session-finished',
      sessionId: analysisSessionId,
      status: 'stopped',
      finishedAt: Date.now(),
    });

    activeAnalysisSessionIdRef.current = null;
    activeAnalysisQueueRef.current = null;
    setAnalysisProgress({ isRunning: false });

    displayAppNotification(
      {
        tone: 'warning',
        title: '分析已暂停',
        message: `已停止后续批次，剩余 ${unstartedFiles.length} 个项目未分析且未选中。修改设置后可重新选择这些项目进行分析。`,
      },
      8000
    );
  };

  const handleSelectDirectory = async () => {
    if (!settings) {
      return;
    }

    const importFileTypeAtScanStart = settings.importFileType;
    const importFileTypeLabel = importFileTypeAtScanStart.toUpperCase();

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: `选择包含 ${importFileTypeLabel} 小说的目录`,
      });

      if (selected && typeof selected === 'string') {
        setIsScanning(true);
        setCurrentDirectory(selected);
        
        try {
          const scannedFiles = await scanDirectory(
            selected,
            importFileTypeAtScanStart
          );
          const filesWithDefaults: FileItem[] = scannedFiles.map((file) => ({
            ...file,
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

    const analyzableFiles = getSelectedAnalyzableFiles(files, selectedFileIds);
    if (analyzableFiles.length === 0) {
      displayAppNotification(
        {
          tone: 'warning',
          title: '没有可分析的已选项目',
          message: '请选中待分析、失败或已分析完成的项目，再开始分析。',
        },
        6000
      );
      return;
    }

    clearSelectionForIds(analyzableFiles.map((file) => file.id));

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

    setAnalysisProgress({
      totalBatches: batches.length,
      completedBatches: 0,
      failedBatches: 0,
      isRunning: true,
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
                analysisSessionId,
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
            if (
              !batchFileIds.has(file.id)
              || file.analysisSessionId !== analysisSessionId
            ) {
              return file;
            }

            const analysisResult = resultByFileId.get(file.id);
            if (!analysisResult) {
              return {
                ...file,
                status: 'failed' as const,
                analysisSessionId: undefined,
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
              analysisSessionId: undefined,
              error: resultError,
              status: resultError ? 'failed' as const : 'ready' as const,
            };
          });

          return recomputeFileStatuses(filesWithResults);
        });

        if (activeAnalysisSessionIdRef.current === analysisSessionId) {
          setAnalysisProgress((previousProgress) => ({
            completedBatches: previousProgress.completedBatches + 1,
          }));
        }
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
                && file.analysisSessionId === analysisSessionId
                ? {
                    ...file,
                    status: 'failed' as const,
                    analysisSessionId: undefined,
                    error: `批次失败：${errorMessage}`,
                  }
                : file
            )
          )
        );

        if (activeAnalysisSessionIdRef.current === analysisSessionId) {
          setAnalysisProgress((previousProgress) => ({
            failedBatches: previousProgress.failedBatches + 1,
          }));
        }
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

    const batchQueue = createAnalysisBatchQueue(batches);
    activeAnalysisQueueRef.current = batchQueue;
    const runWorker = async () => {
      while (true) {
        const claimedBatch = batchQueue.claimNextBatch();
        if (!claimedBatch) {
          return;
        }

        await processBatch(claimedBatch.batchIndex);
      }
    };

    const workerCount = Math.min(settings.concurrency, batches.length);
    try {
      await Promise.all(
        Array.from({ length: workerCount }, () => runWorker())
      );
    } finally {
      const wasStopped = batchQueue.wasStopRequested();
      const finalSessionStatus = wasStopped
        ? 'stopped'
        : failedAnalyzedFileCount === 0
          ? 'success'
          : successfulAnalyzedFileCount === 0
            ? 'failed'
            : 'partial';

      if (!wasStopped) {
        dispatchAnalysisLifecycleEvent({
          type: 'session-finished',
          sessionId: analysisSessionId,
          status: finalSessionStatus,
          finishedAt: Date.now(),
        });
      }

      const isStillActiveSession =
        activeAnalysisSessionIdRef.current === analysisSessionId;
      if (isStillActiveSession) {
        activeAnalysisSessionIdRef.current = null;
        activeAnalysisQueueRef.current = null;
        setAnalysisProgress({ isRunning: false });
      }
    }
  };

  const handleRequestConflictCleanup = () => {
    if (conflictCleanupPlan.filesToRemove.length === 0) {
      displayAppNotification(
        {
          tone: 'warning',
          title: '没有可清理的已选冲突',
          message: '请先选中至少两个建议文件名相同的冲突项，再执行清理。未选中的冲突会保留，可稍后再处理。',
        },
        7000
      );
      return;
    }

    setIsConflictCleanupConfirmationOpen(true);
  };

  const handleExecuteConflictCleanup = async () => {
    const latestCleanupPlan = createConflictCleanupPlan(files, {
      selectedOnly: true,
      selectedFileIds,
    });
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

    const selectedFileIdsAtExecutionStart = Array.from(selectedFileIds);

    setIsConflictCleanupConfirmationOpen(false);
    dismissAppNotification();
    setIsCleaningConflicts(true);

    const totalToRemove = filesToRemove.length;
    let completedCount = 0;
    let successfulCount = 0;
    let failureCount = 0;
    let firstFailureDetail: string | undefined;

    setFileOperationProgress({
      kind: 'conflict-cleanup',
      completed: 0,
      total: totalToRemove,
      failed: 0,
    });

    try {
      const operationBatches = chunkItems(
        filesToRemove.map((file) => ({
          fileId: file.id,
          originalName: file.originalName,
          sizeBytes: file.sizeBytes,
          modifiedAt: file.modifiedAt,
        }))
      );

      for (const operationBatch of operationBatches) {
        const results = await moveFilesToRecycleBin(
          currentDirectory,
          operationBatch
        );
        const candidateFileIds = new Set(
          operationBatch.map((operation) => operation.fileId)
        );
        const batchSuccessfulFileIds = new Set(
          results
            .filter(
              (result) => result.success && candidateFileIds.has(result.fileId)
            )
            .map((result) => result.fileId)
        );
        const batchFailedResults = results.filter((result) => !result.success);
        const batchFailureCount = Math.max(
          0,
          operationBatch.length - batchSuccessfulFileIds.size
        );

        if (batchSuccessfulFileIds.size > 0) {
          setFiles((currentFiles) =>
            recomputeFileStatuses(
              currentFiles.filter((file) => !batchSuccessfulFileIds.has(file.id))
            )
          );
          clearSelectionForIds(batchSuccessfulFileIds);
        }

        successfulCount += batchSuccessfulFileIds.size;
        failureCount += batchFailureCount;
        completedCount += operationBatch.length;

        if (!firstFailureDetail && batchFailedResults[0]) {
          const firstFailure = batchFailedResults[0];
          const failedFileName =
            filesToRemove.find((file) => file.id === firstFailure.fileId)
              ?.originalName
            ?? firstFailure.fileId;
          firstFailureDetail = `${failedFileName}：${
            firstFailure.error ?? '未知错误'
          }`;
        }

        setFileOperationProgress({
          kind: 'conflict-cleanup',
          completed: completedCount,
          total: totalToRemove,
          failed: failureCount,
        });
      }

      if (failureCount === 0) {
        displayAppNotification(
          {
            tone: 'success',
            title: '冲突清理完成',
            message: `已保留 ${latestCleanupPlan.resolvableGroups.length} 个文件，并将 ${successfulCount} 个重复文件移入回收站。`,
          },
          5000
        );
        return;
      }

      displayAppNotification(
        {
          tone: successfulCount > 0 ? 'warning' : 'error',
          title: successfulCount > 0 ? '部分冲突未能清理' : '冲突清理未完成',
          message: `已移入回收站 ${successfulCount} 个，失败 ${failureCount} 个。失败项目仍保留在列表中。`,
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
      clearSelectionForIds(selectedFileIdsAtExecutionStart);
      setIsCleaningConflicts(false);
      setFileOperationProgress(null);
    }
  };

  const handleRequestRenameExecution = () => {
    const selectedExecutableFileCount = getSelectedExecutableFiles(
      files,
      selectedFileIds
    ).length;

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
    const selectedExecutableFiles = getSelectedExecutableFiles(
      files,
      selectedFileIds
    );

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

    const selectedFileIdsAtExecutionStart = Array.from(selectedFileIds);

    setIsRenameConfirmationOpen(false);
    dismissAppNotification();
    setIsRenaming(true);

    const totalToRename = selectedExecutableFiles.length;
    let completedCount = 0;
    let successfulCount = 0;
    let failureCount = 0;
    let firstFailureDetail: string | undefined;

    setFileOperationProgress({
      kind: 'rename',
      completed: 0,
      total: totalToRename,
      failed: 0,
    });

    try {
      const operationBatches = chunkItems(selectedExecutableFiles);

      for (const fileBatch of operationBatches) {
        const operations = fileBatch.map((file) => ({
          fileId: file.id,
          originalName: file.originalName,
          targetName: file.normalizedName!,
        }));
        const metadataSnapshot = Object.fromEntries(
          fileBatch.map((file) => [
            file.id,
            {
              sizeBytes: file.sizeBytes,
              modifiedAt: file.modifiedAt,
            },
          ])
        );

        const results = await executeRenameOperations(
          currentDirectory,
          operations,
          metadataSnapshot
        );
        const filesById = new Map(fileBatch.map((file) => [file.id, file]));
        const successfulFileTargetById = new Map<string, string>();

        for (const result of results) {
          const matchedFile = filesById.get(result.fileId);
          if (result.success && matchedFile?.normalizedName) {
            successfulFileTargetById.set(
              matchedFile.id,
              matchedFile.normalizedName
            );
          }
        }

        const batchSuccessfulFileIds = Array.from(
          successfulFileTargetById.keys()
        );
        const batchFailedResults = results.filter((result) => !result.success);
        const batchMissingResultCount = Math.max(
          0,
          fileBatch.length - results.length
        );
        const batchFailureCount = Math.max(
          0,
          fileBatch.length - batchSuccessfulFileIds.length
        );

        if (batchSuccessfulFileIds.length > 0) {
          setFiles((currentFiles) =>
            applySuccessfulFileRenames(currentFiles, successfulFileTargetById)
          );
          clearSelectionForIds(batchSuccessfulFileIds);
        }

        successfulCount += batchSuccessfulFileIds.length;
        failureCount += batchFailureCount;
        completedCount += fileBatch.length;

        if (!firstFailureDetail) {
          const firstFailure = batchFailedResults[0];
          if (firstFailure?.error) {
            firstFailureDetail = `${firstFailure.fileId}：${firstFailure.error}`;
          } else if (batchMissingResultCount > 0) {
            firstFailureDetail = `${batchMissingResultCount} 个文件未返回执行结果`;
          }
        }

        setFileOperationProgress({
          kind: 'rename',
          completed: completedCount,
          total: totalToRename,
          failed: failureCount,
        });
      }

      if (failureCount === 0) {
        displayAppNotification(
          {
            tone: 'success',
            title: '重命名完成',
            message: `已成功重命名 ${successfulCount} 个文件，并保留为“已重命名”状态。`,
          },
          4500
        );
        return;
      }

      displayAppNotification(
        {
          tone: successfulCount > 0 ? 'warning' : 'error',
          title: successfulCount > 0 ? '部分文件未能重命名' : '重命名未完成',
          message: `成功 ${successfulCount} 个，失败 ${failureCount} 个。成功文件已标记为“已重命名”，失败文件仍保留以便检查。`,
          detail: firstFailureDetail,
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
      clearSelectionForIds(selectedFileIdsAtExecutionStart);
      setIsRenaming(false);
      setFileOperationProgress(null);
    }
  };

  const handleSettingsSaveSuccess = () => {
    setShowSettings(false);
    displayAppNotification(
      {
        tone: 'success',
        title: '设置已保存',
        message: '新的设置将在后续导入和分析操作中生效，当前任务列表不会改变。',
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

  const selectedAnalyzableCount = getSelectedAnalyzableFiles(
    files,
    selectedFileIds
  ).length;
  const selectedExecutableCount = getSelectedExecutableFiles(
    files,
    selectedFileIds
  ).length;
  const conflictFileCount = files.filter((file) => file.status === 'conflict').length;
  const selectedConflictCleanupCount = conflictCleanupPlan.filesToRemove.length;
  const isFileOperationRunning = isRenaming || isCleaningConflicts;
  const processedBatchCount =
    analysisProgress.completedBatches + analysisProgress.failedBatches;
  const renameProgressLabel =
    fileOperationProgress?.kind === 'rename'
      ? `重命名中 ${fileOperationProgress.completed}/${fileOperationProgress.total}`
      : null;
  const conflictCleanupProgressLabel =
    fileOperationProgress?.kind === 'conflict-cleanup'
      ? `清理中 ${fileOperationProgress.completed}/${fileOperationProgress.total}`
      : null;

  return (
    <>
      <div className="toolbar">
        <button
          className="btn"
          onClick={handleSelectDirectory}
          disabled={
            !settings
            || isScanning
            || analysisProgress.isRunning
            || isFileOperationRunning
          }
          title={settings
            ? `只导入 ${settings.importFileType.toUpperCase()} 文件，可在设置中切换`
            : '正在加载导入设置'}
        >
          {isScanning
            ? '扫描中...'
            : settings
              ? `选择 ${settings.importFileType.toUpperCase()} 目录`
              : '加载设置...'}
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
              ? `分析中 ${processedBatchCount}/${analysisProgress.totalBatches}`
              : `分析已选 (${selectedAnalyzableCount})`}
          </button>

          {analysisProgress.isRunning && (
            <button
              className="btn"
              onClick={handlePauseAnalysis}
              title="停止开始新的批次，并立即结束本次分析任务"
            >
              暂停分析
            </button>
          )}

          {conflictFileCount > 0 && (
            <button
              ref={conflictCleanupTriggerButtonRef}
              className="btn btn-warning"
              onClick={handleRequestConflictCleanup}
              disabled={
                analysisProgress.isRunning
                || isFileOperationRunning
                || selectedConflictCleanupCount === 0
              }
              title="仅清理当前已选中的冲突项：每组保留体积最大的一个；大小相同时按文件名排序保留一个，其余移入回收站"
            >
              {isCleaningConflicts
                ? (conflictCleanupProgressLabel ?? '正在清理冲突...')
                : `清理已选冲突 (${selectedConflictCleanupCount})`}
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
              ? (renameProgressLabel ?? '正在重命名...')
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
                <h2 id="conflict-cleanup-title">清理已选冲突</h2>
                <p id="conflict-cleanup-description">
                  仅处理当前已选中的冲突项。每组保留体积最大的一个文件；若多个文件大小相同，则按原文件名排序保留其中一个，其余将移入系统回收站。未选中的冲突会保留。
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
                <strong>{selectedConflictCleanupCount}</strong>
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
                移入回收站 {selectedConflictCleanupCount} 个文件
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
