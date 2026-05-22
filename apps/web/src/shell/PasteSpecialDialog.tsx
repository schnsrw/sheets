import { useEffect, useRef, useState } from 'react';
import { Dialog } from './Dialog';
import type { PasteSpecialMode } from './home-tab-actions';

type Props = {
  onCancel: () => void;
  onConfirm: (mode: PasteSpecialMode) => void;
};

/**
 * Excel's Paste Special dialog. Each option maps 1:1 to a Univer paste
 * hook (see `pasteSpecial` in home-tab-actions.ts). We surface the six
 * hooks Univer OSS supports — transpose / skip-blanks / arithmetic
 * operations need clipboard internals Univer doesn't expose, so they're
 * intentionally omitted rather than faked.
 */
const OPTIONS: { id: PasteSpecialMode; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'Values, formulas, and formatting' },
  { id: 'formulas', label: 'Formulas', hint: 'Formulas without formatting' },
  { id: 'values', label: 'Values', hint: 'Computed values, no formulas' },
  { id: 'formats', label: 'Formats', hint: 'Formatting only, no contents' },
  { id: 'col-widths', label: 'Column widths', hint: 'Source column widths only' },
  { id: 'no-borders', label: 'All except borders', hint: 'Everything but cell borders' },
];

export function PasteSpecialDialog({ onCancel, onConfirm }: Props) {
  const [mode, setMode] = useState<PasteSpecialMode>('all');
  const activeRadioRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    activeRadioRef.current?.focus();
  }, []);
  const onGroupKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onConfirm(mode);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };
  return (
    <Dialog
      title="Paste Special"
      onClose={onCancel}
      data-testid="paste-special-dialog"
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            data-testid="paste-special-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            data-testid="paste-special-ok"
            onClick={() => onConfirm(mode)}
          >
            OK
          </button>
        </>
      }
    >
      <div
        className="cells-op"
        role="radiogroup"
        aria-label="Paste Special options"
        onKeyDown={onGroupKeyDown}
      >
        {OPTIONS.map((o) => {
          const isActive = mode === o.id;
          return (
            <label
              key={o.id}
              className={`cells-op__option${isActive ? ' cells-op__option--active' : ''}`}
              data-testid={`paste-special-${o.id}`}
            >
              <input
                ref={isActive ? activeRadioRef : undefined}
                type="radio"
                name="paste-special"
                value={o.id}
                checked={isActive}
                onChange={() => setMode(o.id)}
              />
              <span className="cells-op__label">
                <span className="cells-op__label-main">{o.label}</span>
                <span className="cells-op__label-hint">{o.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
    </Dialog>
  );
}
