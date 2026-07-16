import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useAppStore } from './store';
import { scanDirectory, analyzeBatch, executeRenameOperations } from './shared/lib/api';
import { deriveFileStatus } from './shared/lib/fileUtils';
import type { FileItem } from './shared/types';
import SettingsDialog from './SettingsDialog';

export default function Toolbar() {
  const { currentDirectory, setCurrentDirectory, setFiles, files, settings, updateFile, setFiles: updateFiles, removeFiles, setAnalysisProgress, analysisProgress } = useAppStore();
  const [isScanning, setIsScanning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

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
          setFiles(scannedFiles);
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
    if (!settings) return;
    
    const selectedFiles = files.filter((file) => file.selected);
    if (selectedFiles.length === 0) {
      alert('请先选择要分析的文件');
      return;
    }
    
    const unanalyzedFiles = selectedFiles.filter((file) => file.status === 'unanalyzed');
    if (unanalyzedFiles.length === 0) {
      alert('所选文件已全部分析完成');
      return;
    }

    const batchSize = settings.batchSize;
    const batches: FileItem[][] = [];

    for (let i = 0; i < unanalyzedFiles.length; i += batchSize) {
      batches.push(unanalyzedFiles.slice(i, i + batchSize));
    }

    setAnalysisProgress({
      totalBatches: batches.length,
      completedBatches: 0,
      failedBatches: 0,
      isRunning: true,
    });

    for (const batch of batches) {
      batch.forEach((file) => updateFile(file.id, { status: 'analyzing' }));

      try {
        const requests = batch.map((file) => ({
          fileId: file.id,
          originalStem: file.originalStem,
        }));

        const result = await analyzeBatch(settings, batches.indexOf(batch), requests);

        result.results.forEach((analysisResult: { fileId: string; suggestedName?: string; normalizedName?: string; error?: string }) => {
          updateFile(analysisResult.fileId, {
            suggestedName: analysisResult.suggestedName,
            normalizedName: analysisResult.normalizedName,
            error: analysisResult.error,
            status: 'unanalyzed',
          });
        });

        setAnalysisProgress({ completedBatches: analysisProgress.completedBatches + 1 });
      } catch (error) {
        batch.forEach((file) => {
          updateFile(file.id, {
            status: 'analysisFailed',
            error: `批次失败：${error}`,
          });
        });

        setAnalysisProgress({ failedBatches: analysisProgress.failedBatches + 1 });
      }
    }

    const updatedFiles = files.map((file) => ({
      ...file,
      status: deriveFileStatus(file, files),
    }));
    updateFiles(updatedFiles);

    setAnalysisProgress({ isRunning: false });
  };

  const handleExecute = async () => {
    const executableFiles = files.filter((file) => file.status === 'normal');
    
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

  const selectedUnanalyzedCount = files.filter(f => f.selected && f.status === 'unanalyzed').length;
  const executableCount = files.filter(f => f.status === 'normal').length;

  return (
    <>
      <div className="toolbar">
        <button className="btn" onClick={handleSelectDirectory} disabled={isScanning}>
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
            onClick={() => setShowSettings(true)}
          >
            设置
          </button>
          
          <button 
            className="btn" 
            onClick={handleAnalyzeAll} 
            disabled={!settings || selectedUnanalyzedCount === 0 || analysisProgress.isRunning}
          >
            {analysisProgress.isRunning ? `分析中 ${analysisProgress.completedBatches}/${analysisProgress.totalBatches}` : `分析已选 (${selectedUnanalyzedCount})`}
          </button>
          
          <button 
            className="btn btn-primary" 
            onClick={handleExecute} 
            disabled={executableCount === 0}
          >
            执行重命名 ({executableCount})
          </button>
        </div>
      </div>

      <SettingsDialog isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
}
