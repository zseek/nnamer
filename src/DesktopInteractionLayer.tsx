import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export const OPEN_FILE_SEARCH_EVENT = 'nnamer:open-file-search';
export const SELECT_ALL_VISIBLE_FILES_EVENT = 'nnamer:select-all-visible-files';

interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface DesktopContextMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

interface DesktopContextMenuProps {
  items?: DesktopContextMenuItem[];
}

interface DesktopInteractionLayerProps {
  contextMenuItems?: DesktopContextMenuItem[];
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

  if (event.key === 'F5') {
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

function DesktopContextMenu({ items = [] }: DesktopContextMenuProps) {
  const [position, setPosition] = useState<ContextMenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      setPosition({ x: event.clientX, y: event.clientY });
    };

    const closeContextMenu = () => setPosition(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu();
      }
    };

    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('pointerdown', closeContextMenu);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', closeContextMenu);
    window.addEventListener('resize', closeContextMenu);
    window.addEventListener('scroll', closeContextMenu, true);

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('pointerdown', closeContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', closeContextMenu);
      window.removeEventListener('resize', closeContextMenu);
      window.removeEventListener('scroll', closeContextMenu, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!position || !menuRef.current) {
      return;
    }

    const menuBounds = menuRef.current.getBoundingClientRect();
    const viewportPadding = 8;
    const maximumLeft = window.innerWidth - menuBounds.width - viewportPadding;
    const maximumTop = window.innerHeight - menuBounds.height - viewportPadding;

    menuRef.current.style.left = `${Math.max(
      viewportPadding,
      Math.min(position.x, maximumLeft)
    )}px`;
    menuRef.current.style.top = `${Math.max(
      viewportPadding,
      Math.min(position.y, maximumTop)
    )}px`;
    menuRef.current.focus({ preventScroll: true });
  }, [position]);

  if (!position) {
    return null;
  }

  return (
    <div
      ref={menuRef}
      className="desktop-context-menu"
      role="menu"
      aria-label="上下文菜单"
      tabIndex={-1}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {items.length === 0 ? (
        <div
          className="desktop-context-menu-empty"
          role="menuitem"
          aria-disabled="true"
        >
          暂无可用操作
        </div>
      ) : (
        items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="desktop-context-menu-item"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              item.onSelect();
              setPosition(null);
            }}
          >
            {item.label}
          </button>
        ))
      )}
    </div>
  );
}

export default function DesktopInteractionLayer({
  contextMenuItems = [],
}: DesktopInteractionLayerProps) {
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
    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('dragstart', preventBrowserDragBehavior);
    window.addEventListener('dragenter', preventBrowserDragBehavior);
    window.addEventListener('dragover', preventBrowserDragBehavior);
    window.addEventListener('drop', preventBrowserDragBehavior);
    window.addEventListener('auxclick', preventMouseNavigation);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('dragstart', preventBrowserDragBehavior);
      window.removeEventListener('dragenter', preventBrowserDragBehavior);
      window.removeEventListener('dragover', preventBrowserDragBehavior);
      window.removeEventListener('drop', preventBrowserDragBehavior);
      window.removeEventListener('auxclick', preventMouseNavigation);
    };
  }, []);

  return <DesktopContextMenu items={contextMenuItems} />;
}
