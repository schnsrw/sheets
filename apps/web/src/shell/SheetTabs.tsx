import { useEffect, useRef, useState } from 'react';
import { useUniverAPI } from '../use-univer';
import { useSheets } from '../hooks/useSheets';
import { addSheet, deleteSheetById, renameSheet, switchToSheet } from './sheet-actions';
import { Icon } from './Icon';
import { Popover } from './Popover';

/**
 * Excel-style sheet tab strip. Lives between the grid and the status bar.
 *   - Click a tab to switch sheets.
 *   - Double-click to rename (Enter to commit, Esc to revert).
 *   - Right-click for a context menu with Rename / Delete.
 *   - "+" button at the end adds a new sheet.
 */
export function SheetTabs() {
  const api = useUniverAPI();
  const { sheets, activeSheetId, ready } = useSheets();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [contextMenu, setContextMenu] = useState<{ sheetId: string; x: number; y: number } | null>(
    null,
  );

  const startRename = (id: string, currentName: string) => {
    setEditingId(id);
    setDraftName(currentName);
  };

  const commitRename = () => {
    if (!api || !editingId) return;
    renameSheet(api, editingId, draftName.trim());
    setEditingId(null);
    setDraftName('');
  };

  const cancelRename = () => {
    setEditingId(null);
    setDraftName('');
  };

  return (
    <div className="sheet-tabs" data-testid="sheet-tabs" role="tablist">
      <button
        type="button"
        className="sheet-tabs__add btn btn--icon"
        data-testid="sheet-tabs-add"
        aria-label="Add sheet"
        title="Add sheet"
        disabled={!ready}
        onClick={() => api && addSheet(api)}
      >
        <Icon name="add" size="sm" />
      </button>

      <div className="sheet-tabs__list">
        {sheets.map((s) => (
          <SheetTabItem
            key={s.id}
            sheet={s}
            active={s.id === activeSheetId}
            editing={editingId === s.id}
            draftName={draftName}
            onSwitch={() => api && switchToSheet(api, s.id)}
            onStartRename={() => startRename(s.id, s.name)}
            onDraftChange={setDraftName}
            onCommit={commitRename}
            onCancel={cancelRename}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ sheetId: s.id, x: e.clientX, y: e.clientY });
            }}
          />
        ))}
      </div>

      {contextMenu && (
        <SheetContextMenu
          sheetId={contextMenu.sheetId}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onRename={() => {
            const sheet = sheets.find((s) => s.id === contextMenu.sheetId);
            if (sheet) startRename(sheet.id, sheet.name);
            setContextMenu(null);
          }}
          onDelete={() => {
            if (api) deleteSheetById(api, contextMenu.sheetId);
            setContextMenu(null);
          }}
          canDelete={sheets.length > 1}
        />
      )}
    </div>
  );
}

type ItemProps = {
  sheet: { id: string; name: string };
  active: boolean;
  editing: boolean;
  draftName: string;
  onSwitch: () => void;
  onStartRename: () => void;
  onDraftChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
};

function SheetTabItem({
  sheet,
  active,
  editing,
  draftName,
  onSwitch,
  onStartRename,
  onDraftChange,
  onCommit,
  onCancel,
  onContextMenu,
}: ItemProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.select();
    }
  }, [editing]);

  return (
    <div
      role="tab"
      aria-selected={active}
      className={`sheet-tab${active ? ' sheet-tab--active' : ''}`}
      data-testid={`sheet-tab-${sheet.id}`}
      onClick={() => !editing && onSwitch()}
      onDoubleClick={onStartRename}
      onContextMenu={onContextMenu}
    >
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          className="sheet-tab__input"
          data-testid={`sheet-tab-input-${sheet.id}`}
          value={draftName}
          maxLength={31}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onCommit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
        />
      ) : (
        <span className="sheet-tab__label">{sheet.name}</span>
      )}
    </div>
  );
}

function SheetContextMenu({
  x,
  y,
  onClose,
  onRename,
  onDelete,
  canDelete,
}: {
  sheetId: string;
  x: number;
  y: number;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  // We want a popover positioned at (x, y), not anchored to a DOM element.
  // Build a synthetic anchor ref so we can reuse <Popover>'s positioning code.
  const fakeAnchor = useRef<HTMLDivElement>(null);

  return (
    <>
      <div
        ref={fakeAnchor}
        style={{
          position: 'fixed',
          left: x,
          top: y - 8, // popover positions below; offset so menu opens at cursor
          width: 0,
          height: 0,
          pointerEvents: 'none',
        }}
      />
      <Popover
        anchorRef={fakeAnchor}
        onClose={onClose}
        data-testid="sheet-context-menu"
      >
        <button type="button" className="menu__item" role="menuitem" onClick={onRename}>
          <Icon name="edit" size="sm" className="menu__item-icon" />
          <span>Rename</span>
        </button>
        <button
          type="button"
          className="menu__item"
          role="menuitem"
          data-testid="sheet-context-menu-delete"
          disabled={!canDelete}
          onClick={onDelete}
        >
          <Icon name="delete" size="sm" className="menu__item-icon" />
          <span>Delete</span>
        </button>
      </Popover>
    </>
  );
}
