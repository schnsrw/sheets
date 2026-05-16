import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Popover } from './Popover';

/** Reusable ribbon primitives shared across all tabs. */

export function RibbonGroup({
  label,
  rows,
  children,
}: {
  label: string;
  /** Stack children vertically as separate rows. */
  rows?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="ribbon__group" data-testid={`ribbon-group-${label.toLowerCase()}`}>
      <div className={`ribbon__group-body${rows ? ' ribbon__group-body--rows' : ''}`}>
        {children}
      </div>
      <div className="ribbon__group-label">{label}</div>
    </div>
  );
}

export function RibbonRow({ children }: { children: ReactNode }) {
  return <div className="ribbon__row">{children}</div>;
}

type ToolbarButtonProps = {
  id: string;
  label: string;
  icon: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

export function ToolbarButton({
  id,
  label,
  icon,
  pressed,
  disabled,
  onClick,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className="btn btn--icon"
      data-testid={`ribbon-btn-${id}`}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size="sm" />
    </button>
  );
}

type SelectProps = {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  width?: number;
  disabled?: boolean;
  onChange: (v: string) => void;
};

export function ToolbarSelect({
  id,
  label,
  value,
  options,
  width = 110,
  disabled,
  onChange,
}: SelectProps) {
  return (
    <select
      data-testid={`ribbon-select-${id}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      value={value}
      style={{ width }}
      className="ribbon__select"
      onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

type ColorButtonProps = {
  id: string;
  label: string;
  icon: string;
  /** Current color in hex (`#RRGGBB`) or empty. */
  value: string;
  /** Color to apply when the icon (not the swatch) is clicked. */
  defaultColor: string;
  disabled?: boolean;
  onChange: (color: string) => void;
};

/**
 * Split button: icon applies the default action; caret opens a popover.
 * Used for Borders and any future "icon + dropdown options" toolbar control.
 */
type DropdownItem = { id: string; label: string; icon: string };

export function ToolbarDropdown({
  id,
  label,
  icon,
  items,
  disabled,
  onChoose,
  onDefault,
}: {
  id: string;
  label: string;
  icon: string;
  items: DropdownItem[];
  disabled?: boolean;
  /** Called when an item is picked. */
  onChoose: (itemId: string) => void;
  /** Called when the icon (not the caret) is clicked — applies the last/default. */
  onDefault?: () => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <span
      ref={anchorRef}
      className="btn-split"
      data-testid={`ribbon-dropdown-${id}`}
    >
      <button
        type="button"
        className="btn btn--icon btn-split__icon"
        data-testid={`ribbon-dropdown-${id}-apply`}
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={() => {
          onDefault?.();
          // Office pattern: applying the icon's default also dismisses the
          // popover if it happens to be open.
          if (open) setOpen(false);
        }}
      >
        <Icon name={icon} size="sm" />
      </button>
      <button
        type="button"
        className="btn btn--icon btn-split__caret"
        data-testid={`ribbon-dropdown-${id}-caret`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label} options`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="arrow_drop_down" size="sm" />
      </button>
      {open && (
        <Popover
          anchorRef={anchorRef}
          onClose={() => setOpen(false)}
          data-testid={`ribbon-dropdown-${id}-popover`}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="menu__item"
              role="menuitem"
              data-testid={`ribbon-dropdown-${id}-item-${item.id}`}
              onClick={() => {
                onChoose(item.id);
                setOpen(false);
              }}
            >
              <Icon name={item.icon} size="sm" className="menu__item-icon" />
              <span>{item.label}</span>
            </button>
          ))}
        </Popover>
      )}
    </span>
  );
}

/**
 * Combo: clicking the icon applies the last-chosen color; clicking the small
 * dropdown caret opens a native color picker. Mirrors Excel's split button.
 */
export function ToolbarColorButton({
  id,
  label,
  icon,
  value,
  defaultColor,
  disabled,
  onChange,
}: ColorButtonProps) {
  const applied = value || defaultColor;
  return (
    <span className="btn-color" data-testid={`ribbon-color-${id}`}>
      <button
        type="button"
        className="btn btn--icon btn-color__icon"
        data-testid={`ribbon-color-${id}-apply`}
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={() => onChange(applied)}
      >
        <Icon name={icon} size="sm" />
        <span className="btn-color__swatch" style={{ background: applied }} aria-hidden="true" />
      </button>
      <label className="btn-color__picker" title={`${label} — choose color`}>
        <Icon name="arrow_drop_down" size="sm" />
        <input
          type="color"
          data-testid={`ribbon-color-${id}-input`}
          value={applied || '#000000'}
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          tabIndex={-1}
        />
      </label>
    </span>
  );
}
