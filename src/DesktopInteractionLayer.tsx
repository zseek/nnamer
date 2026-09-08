import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppStore } from './store';
import { moveFilesToRecycleBin } from './shared/lib/api';
import { chunkItems, keepOriginalNamesForFileIds, recomputeFileStatuses, resetFileStatusesForFileIds } from './shared/lib/fileUtils';
import type { FileItem } from './shared/types';

export const OPEN_FILE_SEARCH_EVENT = 'nnamer:open-file-search';
export const SELECT_ALL_VISIBLE_FILES_EVENT = 'nnamer:select-all-visible-files';

interface ContextMenuState {
  fileId: string;
  x: number;
  y: number;
}

interface DeleteNotification {
  tone: 'success' | 'error' | 'warning';
  title: string;
  message: string;
  detail?: string;
}

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (
    target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.isContentEditable
  ) {
    return true;
  }

  return target instanceof HTMLInputElement
    && !NON_TEXT_INPUT_TYPES.has(target.type);
}

function hasOpenModalDialog(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

function isBlockedApplicationShortcut(event: KeyboardEvent): boolean {
  const hasPrimaryModifier = event.ctrlKey || event.metaKey;

  if (event.key === 'F5' || event.key === 'F12' || event.code === 'F12') {
    return true;
  }

  if (hasPrimaryModifier && ['o', 'p', 'r', 's'].includes(event.key.toLowerCase())) {
    return true;
  }

  if (
    hasPrimaryModifier
    && (
      ['+', '-', '='].includes(event.key)
      || event.code === 'Digit0'
      || event.code === 'Numpad0'
      || event.code === 'NumpadAdd'
      || event.code === 'NumpadSubtract'
    )
  ) {
    return true;
  }

  if (
    ['BrowserBack', 'BrowserForward', 'BrowserRefresh'].includes(event.key)
  ) {
    return true;
  }

  return event.altKey
    && ['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key);
}

function formatExecutionError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export default function DesktopInteractionLayer() {
  const currentDirectory = useAppStore((state) => state.currentDirectory);
  const selectedFileIds = useAppStore((state) => state.selectedFileIds);
  const setFiles = useAppStore((state) => state.setFiles);
  const clearSelectionForIds = useAppStore((state) => state.clearSelectionForIds);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [filesPendingDeletion, setFilesPendingDeletion] = useState<FileItem[] | null>(
    null
  );
  const [isDeletingFiles, setIsDeletingFiles] = useState(false);
  const [deleteNotification, setDeleteNotification] = useState<DeleteNotification | null>(
    null
  );
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const deleteDialogRef = useRef<HTMLElement>(null);
  const cancelDeleteButtonRef = useRef<HTMLButtonElement>(null);
  const deleteNotificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissDeleteNotification = () => {
    if (deleteNotificationTimerRef.current) {
      clearTimeout(deleteNotificationTimerRef.current);
      deleteNotificationTimerRef.current = null;
    }

    setDeleteNotification(null);
  };

  const displayDeleteNotification = (
    notification: DeleteNotification,
    durationMilliseconds: number
  ) => {
    if (deleteNotificationTimerRef.current) {
      clearTimeout(deleteNotificationTimerRef.current);
    }

    setDeleteNotification(notification);
    deleteNotificationTimerRef.current = setTimeout(() => {
      deleteNotificationTimerRef.current = null;
      setDeleteNotification(null);
    }, durationMilliseconds);
  };

  useEffect(() => () => {
    if (deleteNotificationTimerRef.current) {
      clearTimeout(deleteNotificationTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const guardedUrl = window.location.href;
    const navigationGuardState = { nnamerNavigationGuard: true };

    if (window.history.state?.nnamerNavigationGuard !== true) {
      window.history.replaceState(
        { nnamerApplicationRoot: true },
        '',
        guardedUrl
      );
      window.history.pushState(navigationGuardState, '', guardedUrl);
    }

    const handlePopState = () => {
      window.history.pushState(navigationGuardState, '', guardedUrl);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Backspace'
        && !isTextEditingTarget(event.target)
      ) {
        event.preventDefault();
        return;
      }

      if (isBlockedApplicationShortcut(event)) {
        event.preventDefault();
        return;
      }

      const hasPrimaryModifier = event.ctrlKey || event.metaKey;
      if (!hasPrimaryModifier) {
        return;
      }

      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        if (!hasOpenModalDialog()) {
          window.dispatchEvent(new Event(OPEN_FILE_SEARCH_EVENT));
        }
        return;
      }

      if (
        event.key.toLowerCase() === 'a'
        && !isTextEditingTarget(event.target)
      ) {
        event.preventDefault();
        window.getSelection()?.removeAllRanges();

        if (!hasOpenModalDialog()) {
          window.dispatchEvent(new Event(SELECT_ALL_VISIBLE_FILES_EVENT));
        }
      }
    };

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();

      if (hasOpenModalDialog() || !(event.target instanceof Element)) {
        setContextMenu(null);
        return;
      }

      const fileRow = event.target.closest<HTMLElement>('[data-file-row-id]');
      const fileId = fileRow?.dataset.fileRowId;
      if (!fileId) {
        setContextMenu(null);
        return;
      }

      const storeState = useAppStore.getState();
      // 右键同左键：确保当前行被勾选，再统一按“删除全部已选”处理。
      if (!storeState.selectedFileIds.has(fileId)) {
        storeState.selectFileIds([fileId]);
      }

      setContextMenu({
        fileId,
        x: event.clientX,
        y: event.clientY,
      });
    };

    const closeContextMenu = () => setContextMenu(null);

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }
    };

    const preventBrowserDragBehavior = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'none';
      }
    };

    const preventMouseNavigation = (event: MouseEvent) => {
      if (event.button === 3 || event.button === 4) {
        event.preventDefault();
      }
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('pointerdown', closeContextMenu);
    window.addEventListener('blur', closeContextMenu);
    window.addEventListener('resize', closeContextMenu);
    window.addEventListener('scroll', closeContextMenu, true);
    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('dragstart', preventBrowserDragBehavior);
    window.addEventListener('dragenter', preventBrowserDragBehavior);
    window.addEventListener('dragover', preventBrowserDragBehavior);
    window.addEventListener('drop', preventBrowserDragBehavior);
    window.addEventListener('auxclick', preventMouseNavigation);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('pointerdown', closeContextMenu);
      window.removeEventListener('blur', closeContextMenu);
      window.removeEventListener('resize', closeContextMenu);
      window.removeEventListener('scroll', closeContextMenu, true);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('dragstart', preventBrowserDragBehavior);
      window.removeEventListener('dragenter', preventBrowserDragBehavior);
      window.removeEventListener('dragover', preventBrowserDragBehavior);
      window.removeEventListener('drop', preventBrowserDragBehavior);
      window.removeEventListener('auxclick', preventMouseNavigation);
    };
  }, []);

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) {
      return;
    }

    const menuBounds = contextMenuRef.current.getBoundingClientRect();
    const viewportPadding = 8;
    const maximumLeft = window.innerWidth - menuBounds.width - viewportPadding;
    const maximumTop = window.innerHeight - menuBounds.height - viewportPadding;

    contextMenuRef.current.style.left = `${Math.max(
      viewportPadding,
      Math.min(contextMenu.x, maximumLeft)
    )}px`;
    contextMenuRef.current.style.top = `${Math.max(
      viewportPadding,
      Math.min(contextMenu.y, maximumTop)
    )}px`;
    contextMenuRef.current.querySelector<HTMLButtonElement>('button')?.focus({
      preventScroll: true,
    });
  }, [contextMenu]);

  useEffect(() => {
    if (!filesPendingDeletion) {
      return;
    }

    cancelDeleteButtonRef.current?.focus({ preventScroll: true });

    const handleDeleteDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDeletingFiles) {
        event.preventDefault();
        setFilesPendingDeletion(null);
        return;
      }

      if (event.key !== 'Tab' || !deleteDialogRef.current) {
        return;
      }

      const focusableElements = Array.from(
        deleteDialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
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

    window.addEventListener('keydown', handleDeleteDialogKeyDown);
    return () => window.removeEventListener('keydown', handleDeleteDialogKeyDown);
  }, [filesPendingDeletion, isDeletingFiles]);

  const collectSelectedFilesForDeletion = (): FileItem[] => {
    const currentSelectedFileIds = useAppStore.getState().selectedFileIds;
    if (currentSelectedFileIds.size === 0) {
      return [];
    }

    return useAppStore
      .getState()
      .files
      .filter((file) => currentSelectedFileIds.has(file.id));
  };

  const executeFileDeletion = async (filesToDelete: FileItem[]) => {
    if (!currentDirectory || filesToDelete.length === 0 || isDeletingFiles) {
      return;
    }

    setIsDeletingFiles(true);
    dismissDeleteNotification();

    let successfulCount = 0;
    let failureCount = 0;
    let firstFailureDetail: string | undefined;

    try {
      const operationBatches = chunkItems(
        filesToDelete.map((file) => ({
          fileId: file.id,
          originalName: file.originalName,
          sizeBytes: file.sizeBytes,
          modifiedAt: file.modifiedAt,
        }))
      );

      for (const operationBatch of operationBatches) {
        const results = await moveFilesToRecycleBin(currentDirectory, operationBatch);
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

        if (!firstFailureDetail && batchFailedResults[0]) {
          const firstFailure = batchFailedResults[0];
          const failedFileName =
            filesToDelete.find((file) => file.id === firstFailure.fileId)
              ?.originalName
            ?? firstFailure.fileId;
          firstFailureDetail = `${failedFileName}：${
            firstFailure.error ?? '未知错误'
          }`;
        }
      }

      setFilesPendingDeletion(null);

      if (failureCount === 0) {
        displayDeleteNotification(
          {
            tone: 'success',
            title: '文件已移入回收站',
            message:
              successfulCount === 1
                ? `${filesToDelete[0]?.originalName ?? '1 个文件'} 已移入系统回收站，并从列表中移除。`
                : `已将 ${successfulCount} 个文件移入系统回收站，并从列表中移除。`,
          },
          5000
        );
        return;
      }

      displayDeleteNotification(
        {
          tone: successfulCount > 0 ? 'warning' : 'error',
          title: successfulCount > 0 ? '部分文件未能删除' : '删除文件失败',
          message: `已移入回收站 ${successfulCount} 个，失败 ${failureCount} 个。失败项目仍保留在列表中。`,
          detail: firstFailureDetail,
        },
        9000
      );
    } catch (error) {
      displayDeleteNotification(
        {
          tone: 'error',
          title: '删除文件失败',
          message: '磁盘文件没有从列表中移除。',
          detail: formatExecutionError(error),
        },
        9000
      );
    } finally {
      setIsDeletingFiles(false);
    }
  };

  const handleRequestFileDeletion = () => {
    if (!contextMenu) {
      return;
    }

    setContextMenu(null);
    const targetFiles = collectSelectedFilesForDeletion();

    if (targetFiles.length === 0 || !currentDirectory) {
      displayDeleteNotification(
        {
          tone: 'error',
          title: '无法删除文件',
          message: '没有已选中的文件，或当前目录已经发生变化。',
        },
        6000
      );
      return;
    }

    // 单个目标：静默移入回收站，不弹确认框。
    if (targetFiles.length === 1) {
      void executeFileDeletion(targetFiles);
      return;
    }

    // 多个目标：弹窗确认后再删除。
    dismissDeleteNotification();
    setFilesPendingDeletion(targetFiles);
  };

  const handleResetSelectedFileStatuses = () => {
    if (!contextMenu) {
      return;
    }

    setContextMenu(null);
    const selectedIds = useAppStore.getState().selectedFileIds;
    if (selectedIds.size === 0) {
      displayDeleteNotification(
        {
          tone: 'error',
          title: '无法重置状态',
          message: '没有已选中的文件。',
        },
        5000
      );
      return;
    }

    const selectedIdsSnapshot = Array.from(selectedIds);
    const previousFiles = useAppStore.getState().files;
    const nextFiles = resetFileStatusesForFileIds(previousFiles, selectedIds);
    if (nextFiles === previousFiles) {
      displayDeleteNotification(
        {
          tone: 'success',
          title: '无需重置',
          message: '已选文件均已是待分析状态。',
        },
        4000
      );
      clearSelectionForIds(selectedIdsSnapshot);
      return;
    }

    setFiles(nextFiles);
    clearSelectionForIds(selectedIdsSnapshot);
    displayDeleteNotification(
      {
        tone: 'success',
        title: '已重置状态',
        message:
          selectedIds.size === 1
            ? '该文件已回到待分析状态。'
            : `已将 ${selectedIds.size} 个已选文件重置为待分析。`,
      },
      4500
    );
  };

  const handleKeepSelectedOriginalNames = () => {
    if (!contextMenu) {
      return;
    }

    setContextMenu(null);
    const selectedIds = useAppStore.getState().selectedFileIds;
    if (selectedIds.size === 0) {
      displayDeleteNotification(
        {
          tone: 'error',
          title: '无法保持文件名',
          message: '没有已选中的文件。',
        },
        5000
      );
      return;
    }

    const selectedIdsSnapshot = Array.from(selectedIds);
    const previousFiles = useAppStore.getState().files;
    const nextFiles = keepOriginalNamesForFileIds(previousFiles, selectedIds);
    if (nextFiles === previousFiles) {
      displayDeleteNotification(
        {
          tone: 'success',
          title: '无需更改',
          message: '已选文件的建议名均已与原文件名一致。',
        },
        4000
      );
      clearSelectionForIds(selectedIdsSnapshot);
      return;
    }

    setFiles(nextFiles);
    clearSelectionForIds(selectedIdsSnapshot);
    displayDeleteNotification(
      {
        tone: 'success',
        title: '已保持文件名',
        message:
          selectedIds.size === 1
            ? '已将该文件的建议名设为原文件名。'
            : `已将 ${selectedIds.size} 个已选文件的建议名设为原文件名。`,
      },
      4500
    );
  };

  const handleConfirmFileDeletion = () => {
    if (!filesPendingDeletion || filesPendingDeletion.length === 0) {
      return;
    }

    // 以打开确认框时快照的目标为准，避免确认过程中选中状态被其它操作改动。
    const pendingFileIdSet = new Set(filesPendingDeletion.map((file) => file.id));
    const latestTargetFiles = useAppStore
      .getState()
      .files
      .filter((file) => pendingFileIdSet.has(file.id));

    if (latestTargetFiles.length === 0) {
      setFilesPendingDeletion(null);
      displayDeleteNotification(
        {
          tone: 'error',
          title: '文件已不在列表中',
          message: '没有执行磁盘删除操作。',
        },
        6000
      );
      return;
    }

    void executeFileDeletion(latestTargetFiles);
  };

  const handleDeleteOverlayMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !isDeletingFiles) {
      setFilesPendingDeletion(null);
    }
  };

  const selectedDeletionCount = selectedFileIds.size;
  const pendingDeletionCount = filesPendingDeletion?.length ?? 0;

  return (
    <>
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="desktop-context-menu"
          role="menu"
          aria-label="文件操作"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="desktop-context-menu-item"
            role="menuitem"
            onClick={handleKeepSelectedOriginalNames}
          >
            {selectedDeletionCount > 1
              ? `保持文件名 (${selectedDeletionCount})`
              : '保持文件名'}
          </button>
          <button
            type="button"
            className="desktop-context-menu-item"
            role="menuitem"
            onClick={handleResetSelectedFileStatuses}
          >
            {selectedDeletionCount > 1
              ? `重置状态 (${selectedDeletionCount})`
              : '重置状态'}
          </button>
          <div className="desktop-context-menu-separator" role="separator" />
          <button
            type="button"
            className="desktop-context-menu-item desktop-context-menu-item-danger"
            role="menuitem"
            onClick={handleRequestFileDeletion}
          >
            {selectedDeletionCount > 1
              ? `删除已选 (${selectedDeletionCount})`
              : '删除已选'}
          </button>
        </div>
      )}

      {filesPendingDeletion && filesPendingDeletion.length > 1 && (
        <div
          className="operation-confirmation-backdrop"
          onMouseDown={handleDeleteOverlayMouseDown}
        >
          <section
            ref={deleteDialogRef}
            className="operation-confirmation-dialog permanent-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="permanent-delete-title"
            aria-describedby="permanent-delete-description"
          >
            <header className="operation-confirmation-header">
              <h2 id="permanent-delete-title">移入回收站？</h2>
              <p id="permanent-delete-description">
                将把当前已选中的 {pendingDeletionCount} 个文件移入系统回收站，之后仍可从回收站恢复。
              </p>
            </header>

            <div className="operation-confirmation-summary">
              <span>待删除文件</span>
              <strong>{pendingDeletionCount}</strong>
              <span>个</span>
            </div>

            <p className="operation-confirmation-notice permanent-delete-notice">
              仅处理当前已勾选的文件；未勾选的文件不会受影响。
            </p>

            <div className="operation-confirmation-actions">
              <button
                ref={cancelDeleteButtonRef}
                type="button"
                className="btn"
                disabled={isDeletingFiles}
                onClick={() => setFilesPendingDeletion(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={isDeletingFiles}
                onClick={handleConfirmFileDeletion}
              >
                {isDeletingFiles
                  ? '正在移入回收站…'
                  : `移入回收站 ${pendingDeletionCount} 个`}
              </button>
            </div>
          </section>
        </div>
      )}

      {deleteNotification && (
        <aside
          className={`app-notification app-notification-${deleteNotification.tone}`}
          role={deleteNotification.tone === 'success' ? 'status' : 'alert'}
          aria-live={deleteNotification.tone === 'success' ? 'polite' : 'assertive'}
        >
          <span className="app-notification-symbol" aria-hidden="true">
            {deleteNotification.tone === 'success' ? '✓' : '!'}
          </span>
          <div className="app-notification-content">
            <div className="app-notification-title">{deleteNotification.title}</div>
            <div className="app-notification-message">{deleteNotification.message}</div>
            {deleteNotification.detail && (
              <div
                className="app-notification-detail selectable-text"
                title={deleteNotification.detail}
              >
                {deleteNotification.detail}
              </div>
            )}
          </div>
          <button
            type="button"
            className="app-notification-close"
            onClick={dismissDeleteNotification}
            aria-label="关闭通知"
          >
            ×
          </button>
        </aside>
      )}
    </>
  );
}
