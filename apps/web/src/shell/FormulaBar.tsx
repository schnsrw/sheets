import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { flushSync } from 'react-dom';
import { useUniverAPI } from '../use-univer';
import { useActiveCellState } from '../hooks/useActiveCellState';
import { commitToActiveCell } from './cell-actions';
import { Icon } from './Icon';

/**
 * Office-style formula bar: [ NameBox ] [ × ✓ fx ] [ formula input ]
 *
 * Editing model:
 *   - When not editing, input mirrors the active cell's formula/value.
 *   - First keystroke starts a draft; Enter (or ✓) commits, Escape (or ×)
 *     reverts. Blur commits any pending draft so the user doesn't silently
 *     lose typing when clicking the grid.
 *   - Selection changes while editing commit the draft first (don't lose work),
 *     then mirror the newly-active cell.
 */
export function FormulaBar() {
  const api = useUniverAPI();
  const { ready, a1, displayValue } = useActiveCellState();

  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const inputRef = useRef<HTMLInputElement>(null);

  // Track the cell whose value the current draft belongs to. If the active
  // cell changes mid-edit, commit the draft to the *original* cell, then
  // re-mirror.
  const draftCellRef = useRef<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    if (draftCellRef.current && draftCellRef.current !== a1 && api) {
      // Selection moved while editing — commit draft to the original cell.
      const original = draftCellRef.current;
      const text = draft ?? '';
      // Re-select original briefly to commit there, then restore current.
      const wb = api.getActiveWorkbook();
      const sheet = wb?.getActiveSheet();
      if (wb && sheet) {
        const originalRange = sheet.getRange(original);
        const currentRange = sheet.getActiveRange();
        originalRange.activate();
        commitToActiveCell(api, text);
        currentRange?.activate();
      }
      setDraft(null);
      draftCellRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a1]);

  const value = editing ? (draft ?? '') : displayValue;

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!editing) draftCellRef.current = a1;
    setDraft(e.target.value);
  };

  const commit = () => {
    if (!api || !editing) return;
    commitToActiveCell(api, draft ?? '');
    // flushSync ensures `editing` reads false in any onBlur that fires next
    // (e.g. when we call inputRef.current?.blur() right after).
    flushSync(() => setDraft(null));
    draftCellRef.current = null;
  };

  const revert = () => {
    flushSync(() => setDraft(null));
    draftCellRef.current = null;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      revert();
      inputRef.current?.blur();
    }
  };

  return (
    <div className="formula-bar" data-testid="formula-bar">
      <div
        className="formula-bar__name-box"
        data-testid="name-box"
        title="Name Box"
        role="textbox"
        aria-label="Name Box"
      >
        {a1 || '—'}
      </div>

      <div className="formula-bar__actions" role="group" aria-label="Formula bar actions">
        <button
          type="button"
          className="btn btn--icon formula-bar__action"
          data-testid="formula-cancel"
          aria-label="Cancel"
          title="Cancel (Esc)"
          disabled={!editing}
          onMouseDown={(e) => e.preventDefault()} // keep focus on input
          onClick={revert}
        >
          <Icon name="close" size="sm" />
        </button>
        <button
          type="button"
          className="btn btn--icon formula-bar__action"
          data-testid="formula-commit"
          aria-label="Enter"
          title="Enter (↵)"
          disabled={!editing}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            commit();
            inputRef.current?.blur();
          }}
        >
          <Icon name="check" size="sm" />
        </button>
        <span
          className="formula-bar__fx"
          data-testid="formula-fx"
          aria-label="Insert function"
          title="Insert function"
        >
          fx
        </span>
      </div>

      <input
        ref={inputRef}
        type="text"
        className="formula-bar__input"
        data-testid="formula-input"
        aria-label="Formula input"
        spellCheck={false}
        value={value}
        disabled={!ready}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (editing) commit();
        }}
      />
    </div>
  );
}
