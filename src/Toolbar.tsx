import { useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useAppStore } from './store';
import { scanDirectory, analyzeBatch, executeRenameOperations } from './shared/lib/api';
import { recomputeFileStatuses } from './shared/lib/fileUtils';
import type { FileItem } from './shared/types';
import SettingsDialog from './SettingsDialog';

export default function Toolbar() {
  const {
    currentDirectory,
    setCurrentDirectory,
    setFiles,
    files,
    settings,
    removeFiles,
    setAnalysisProgress,
    analysisProgress,
    setShowLogger,
  } = useAppStore();
  const [isScanning, setIsScanning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const isAnalysisPausedRef = useRef(false);
  const resumeWaitersRef = useRef<Array<() => void>>([]);

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

  const handleToggleAnalysisPause = () => {
    if (!analysisProgress.isRunning) {
      return;
    }

    if (isAnalysisPausedRef.current) {
      isAnalysisPausedRef.current = false;
      setAnalysisProgress({ isPaused: false });
      releasePausedWorkers();
      return;
    }

    isAnalysisPausedRef.current = true;
    setAnalysisProgress({ isPaused: true });
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

    const batches: FileItem[][] = [];
    for (
      let batchStart = 0;
      batchStart < analyzableFiles.length;
      batchStart += settings.batchSize
    ) {
      batches.push(analyzableFiles.slice(batchStart, batchStart + settings.batchSize));
    }

    isAnalysisPausedRef.current = false;
    releasePausedWorkers();
    setAnalysisProgress({
      totalBatches: batches.length,
      completedBatches: 0,
      failedBatches: 0,
      isRunning: true,
      isPaused: false,
    });

    const processBatch = async (batchIndex: number) => {
      const batch = batches[batchIndex];
      const batchFileIds = new Set(batch.map((file) => file.id));

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
        const result = await analyzeBatch(settings, batchIndex, requests);
        const resultByFileId = new Map(
          result.results.map((analysisResult) => [analysisResult.fileId, analysisResult])
        );

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
      } catch (error) {
        console.error(`批次 ${batchIndex} 失败:`, error);
        setFiles((currentFiles) =>
          recomputeFileStatuses(
            currentFiles.map((file) =>
              batchFileIds.has(file.id)
                ? {
                    ...file,
                    status: 'failed' as const,
                    error: `批次失败：${error}`,
                  }
                : file
            )
          )
        );

        setAnalysisProgress((previousProgress) => ({
          failedBatches: previousProgress.failedBatches + 1,
        }));
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
      isAnalysisPausedRef.current = false;
      releasePausedWorkers();
      setAnalysisProgress({ isRunning: false, isPaused: false });
    }
  };

  const handleExecute = async () => {
    const executableFiles = files.filter((file) => file.status === 'ready');
    
    if (executableFiles.length === 0) {
      alert('没有可执行的文件');
      return;
    }

    if (!confirm(`确定要重命名 ${executableFiles.length} 个文件吗？`)) {
      return;
    }

    const operations = executableFiles.map((file) => ({
      sourcePath: `${currentDirectory}\\${file.originalName}`,
      targetName: file.normalizedName!,
    }));

    const metadataSnapshot = Object.fromEntries(
      executableFiles.map((file) => [
        file.originalName,
        {
          sizeBytes: file.sizeBytes,
          modifiedAt: file.modifiedAt,
        },
      ])
    );

    try {
      const results = await executeRenameOperations(currentDirectory!, operations, metadataSnapshot);

      const successIds: string[] = [];
      results.forEach((result) => {
        const file = executableFiles.find((f) => f.originalName === result.fileId);
        if (file && result.success) {
          successIds.push(file.id);
        }
      });

      if (successIds.length > 0) {
        removeFiles(successIds);
      }

      alert(`成功重命名 ${successIds.length} 个文件`);
    } catch (error) {
      alert(`执行失败：${error}`);
    }
  };

  const selectedAnalyzableCount = files.filter(
    (file) => file.selected && (file.status === 'pending' || file.status === 'failed')
  ).length;
  const executableCount = files.filter((file) => file.status === 'ready').length;
  const processedBatchCount =
    analysisProgress.completedBatches + analysisProgress.failedBatches;

  return (
    <>
      <div className="toolbar">
        <button
          className="btn"
          onClick={handleSelectDirectory}
          disabled={isScanning || analysisProgress.isRunning}
        >
          {isScanning ? '扫描中...' : '选择目录'}
        </button>
        
        {currentDirectory && (
          <span style={{ fontSize: '12px', color: 'hsl(var(--color-text-secondary))' }}>
            {currentDirectory}
          </span>
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
            disabled={!settings || selectedAnalyzableCount === 0 || analysisProgress.isRunning}
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

          <button
            className="btn btn-primary"
            onClick={handleExecute}
            disabled={executableCount === 0 || analysisProgress.isRunning}
          >
            执行重命名 ({executableCount})
          </button>
        </div>
      </div>

      <SettingsDialog isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
}
