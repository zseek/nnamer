import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppStore } from './store';
import { moveFileToRecycleBin } from './shared/lib/api';
import { recomputeFileStatuses } from './shared/lib/fileUtils';
import type { FileItem } from './shared/types';

export const OPEN_FILE_SEARCH_EVENT = 'nnamer:open-file-search';
export const SELECT_ALL_VISIBLE_FILES_EVENT = 'nnamer:select-all-visible-files';

interface ContextMenuState {
  fileId: string;
  x: number;
  y: number;
}

interface DeleteNotification {
  tone: 'success' | 'error';
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
  const { currentDirectory, setFiles } = useAppStore();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [filePendingDeletion, setFilePendingDeletion] = useState<FileItem | null>(null);
  const [isDeletingFile, setIsDeletingFile] = useState(false);
  const [deleteNotification, setDeleteNotification] = useState<DeleteNotification | null>(null);
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
    if (!filePendingDeletion) {
      return;
    }

    cancelDeleteButtonRef.current?.focus({ preventScroll: true });

    const handleDeleteDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDeletingFile) {
        event.preventDefault();
        setFilePendingDeletion(null);
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
  }, [filePendingDeletion, isDeletingFile]);

  const handleRequestFileDeletion = () => {
    if (!contextMenu) {
      return;
    }

    const targetFile = useAppStore.getState().files.find(
      (file) => file.id === contextMenu.fileId
    );
    setContextMenu(null);

    if (!targetFile || !currentDirectory) {
      displayDeleteNotification(
        {
          tone: 'error',
          title: '无法删除文件',
          message: '文件或当前目录已经发生变化，请重新右键选择后再试。',
        },
        6000
      );
      return;
    }

    dismissDeleteNotification();
    setFilePendingDeletion(targetFile);
  };

  const handleConfirmFileDeletion = async () => {
    if (!filePendingDeletion || !currentDirectory || isDeletingFile) {
      return;
    }

    const latestFile = useAppStore.getState().files.find(
      (file) => file.id === filePendingDeletion.id
    );
    if (!latestFile) {
      setFilePendingDeletion(null);
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

    setIsDeletingFile(true);
    try {
      const result = await moveFileToRecycleBin(currentDirectory, {
        fileId: latestFile.id,
        originalName: latestFile.originalName,
        sizeBytes: latestFile.sizeBytes,
        modifiedAt: latestFile.modifiedAt,
      });

      if (!result.success) {
        throw new Error(result.error ?? '后端未能删除文件');
      }

      setFiles((currentFiles) =>
        recomputeFileStatuses(
          currentFiles.filter((file) => file.id !== latestFile.id)
        )
      );
      setFilePendingDeletion(null);
      displayDeleteNotification(
        {
          tone: 'success',
            title: '文件已移入回收站',
          message: `${latestFile.originalName} 已移入系统回收站，并从列表中移除。`,
        },
        5000
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
      setIsDeletingFile(false);
    }
  };

  const handleDeleteOverlayMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !isDeletingFile) {
      setFilePendingDeletion(null);
    }
  };

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
            className="desktop-context-menu-item desktop-context-menu-item-danger"
            role="menuitem"
            onClick={handleRequestFileDeletion}
          >
            删除文件
          </button>
        </div>
      )}

      {filePendingDeletion && (
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
                文件会移动到系统回收站，之后仍可从回收站恢复。
              </p>
            </header>

            <div className="permanent-delete-file selectable-text" title={filePendingDeletion.originalName}>
              {filePendingDeletion.originalName}
            </div>

            <p className="operation-confirmation-notice permanent-delete-notice">
              文件将移动到系统回收站。仅处理当前右键指向的这个文件，其他已勾选文件不会受影响。
            </p>

            <div className="operation-confirmation-actions">
              <button
                ref={cancelDeleteButtonRef}
                type="button"
                className="btn"
                disabled={isDeletingFile}
                onClick={() => setFilePendingDeletion(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={isDeletingFile}
                onClick={handleConfirmFileDeletion}
              >
                {isDeletingFile ? '正在移入回收站…' : '移入回收站'}
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
