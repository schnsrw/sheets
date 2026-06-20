/**
 * Toolbar — the rich built-in formatting toolbar for `<CasualSheets chrome>`.
 *
 * Drives the editor purely through `CasualSheetsAPI.executeCommand`, with
 * Material Symbols icons + design-system tokens. No app context, no title/logo
 * row (the host frames the editor with its own bar). Commands grouped with
 * dividers, Office-style.
 *
 * Covered: undo/redo · bold/italic/underline/strikethrough · horizontal align.
 * Font/size/colour pickers, number formats, borders, merge land as follow-up
 * slices (some need value pickers / dropdowns).
 */

import { useEffect, type CSSProperties } from 'react';
import type { CasualSheetsAPI } from '../sheets/api';
import { Icon } from './Icon';
import { ensureChromeFonts } from './fonts';

interface ToolbarAction {
  id: string;
  label: string;
  command: string;
  icon: string;
  params?: object;
}

// HorizontalAlign enum (@univerjs/core): LEFT=1, CENTER=2, RIGHT=3.
const GROUPS: ToolbarAction[][] = [
  [
    { id: 'undo', label: 'Undo', command: 'univer.command.undo', icon: 'undo' },
    { id: 'redo', label: 'Redo', command: 'univer.command.redo', icon: 'redo' },
  ],
  [
    { id: 'bold', label: 'Bold', command: 'sheet.command.set-range-bold', icon: 'format_bold' },
    {
      id: 'italic',
      label: 'Italic',
      command: 'sheet.command.set-range-italic',
      icon: 'format_italic',
    },
    {
      id: 'underline',
      label: 'Underline',
      command: 'sheet.command.set-range-underline',
      icon: 'format_underlined',
    },
    {
      id: 'strikethrough',
      label: 'Strikethrough',
      command: 'sheet.command.set-range-stroke',
      icon: 'format_strikethrough',
    },
  ],
  [
    {
      id: 'align-left',
      label: 'Align left',
      command: 'sheet.command.set-horizontal-text-align',
      icon: 'format_align_left',
      params: { value: 1 },
    },
    {
      id: 'align-center',
      label: 'Align center',
      command: 'sheet.command.set-horizontal-text-align',
      icon: 'format_align_center',
      params: { value: 2 },
    },
    {
      id: 'align-right',
      label: 'Align right',
      command: 'sheet.command.set-horizontal-text-align',
      icon: 'format_align_right',
      params: { value: 3 },
    },
  ],
  [
    {
      id: 'merge',
      label: 'Merge cells',
      command: 'sheet.command.add-worksheet-merge-all',
      icon: 'cell_merge',
    },
    {
      id: 'unmerge',
      label: 'Unmerge cells',
      command: 'sheet.command.remove-worksheet-merge',
      icon: 'splitscreen_vertical_add',
    },
  ],
  [
    {
      id: 'currency',
      label: 'Currency format',
      command: 'sheet.command.numfmt.set.currency',
      icon: 'attach_money',
    },
    {
      id: 'percent',
      label: 'Percent format',
      command: 'sheet.command.numfmt.set.percent',
      icon: 'percent',
    },
    {
      id: 'decimal-increase',
      label: 'Increase decimals',
      command: 'sheet.command.numfmt.add.decimal.command',
      icon: 'decimal_increase',
    },
    {
      id: 'decimal-decrease',
      label: 'Decrease decimals',
      command: 'sheet.command.numfmt.subtract.decimal.command',
      icon: 'decimal_decrease',
    },
  ],
];

const BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: '4px 8px',
  borderBottom: '1px solid var(--cs-chrome-border, #e6e9ee)',
  background: 'var(--cs-chrome-bg, #eef1f5)',
  flex: '0 0 auto',
  userSelect: 'none',
};

const BTN_STYLE: CSSProperties = {
  width: 30,
  height: 30,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  cursor: 'pointer',
  color: 'var(--cs-chrome-fg, #201f1e)',
  padding: 0,
};

const DIVIDER_STYLE: CSSProperties = {
  width: 1,
  height: 18,
  margin: '0 4px',
  background: 'var(--cs-chrome-border, #cdd3db)',
  flex: '0 0 auto',
};

export interface ToolbarProps {
  /** Reaches the live API (set after `onReady`); read lazily on click. */
  getApi: () => CasualSheetsAPI | null;
}

export function Toolbar({ getApi }: ToolbarProps) {
  useEffect(() => {
    ensureChromeFonts();
  }, []);

  return (
    <div style={BAR_STYLE} data-testid="casual-sheets-toolbar" role="toolbar" aria-label="Editor">
      {GROUPS.map((group, gi) => (
        <span key={gi} style={{ display: 'inline-flex', alignItems: 'center' }}>
          {gi > 0 && <span style={DIVIDER_STYLE} aria-hidden />}
          {group.map((a) => (
            <button
              key={a.id}
              type="button"
              title={a.label}
              aria-label={a.label}
              data-action={a.id}
              style={BTN_STYLE}
              // mousedown (not click) so the grid's selection isn't lost first.
              onMouseDown={(e) => {
                e.preventDefault();
                void getApi()?.executeCommand(a.command, a.params);
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--cs-chrome-hover, rgba(0,0,0,0.06))';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <Icon name={a.icon} size={20} />
            </button>
          ))}
        </span>
      ))}
    </div>
  );
}
