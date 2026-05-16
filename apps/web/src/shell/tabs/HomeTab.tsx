import { useUniverAPI } from '../../use-univer';
import { useActiveCellState, type HAlign, type VAlign } from '../../hooks/useActiveCellState';
import {
  NUMBER_FORMATS,
  NUMBER_FORMAT_PATTERNS,
  copy,
  cut,
  decreaseDecimal,
  increaseDecimal,
  openFindReplace,
  paste,
  setAlignment,
  setBorders,
  setFillColor,
  setFontColor,
  setFontFamily,
  setFontSize,
  setNumberFormat,
  setNumberFormatByKey,
  setVerticalAlignment,
  startFormatPainter,
  toggleBold,
  toggleItalic,
  toggleMerge,
  toggleStrikethrough,
  toggleUnderline,
  toggleWrap,
  type NumberFormatKey,
} from '../home-tab-actions';
import {
  RibbonGroup,
  RibbonRow,
  ToolbarButton,
  ToolbarColorButton,
  ToolbarDropdown,
  ToolbarSelect,
} from '../RibbonControls';
import type { BorderChoice } from '../home-tab-actions';

const FONT_FAMILIES = [
  'Calibri',
  'Arial',
  'Helvetica',
  'Inter',
  'Times New Roman',
  'Georgia',
  'Verdana',
  'Courier New',
  'JetBrains Mono',
];

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];

const NUMBER_FORMAT_OPTIONS: { value: NumberFormatKey; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'integer', label: 'Number (no decimals)' },
  { value: 'number', label: 'Number (2 decimals)' },
  { value: 'currency', label: 'Currency' },
  { value: 'accounting', label: 'Accounting' },
  { value: 'percent', label: 'Percent' },
  { value: 'date', label: 'Date (yyyy-mm-dd)' },
  { value: 'time', label: 'Time (hh:mm:ss)' },
  { value: 'scientific', label: 'Scientific' },
  { value: 'text', label: 'Text' },
];

function detectFormatKey(pattern: string): NumberFormatKey {
  for (const k of Object.keys(NUMBER_FORMAT_PATTERNS) as NumberFormatKey[]) {
    if (NUMBER_FORMAT_PATTERNS[k] === pattern) return k;
  }
  return 'general';
}

export function HomeTab() {
  const api = useUniverAPI();
  const state = useActiveCellState();
  const ready = Boolean(api) && state.ready;

  return (
    <>
      <RibbonGroup label="Clipboard">
        <ToolbarButton
          id="paste"
          label="Paste (Ctrl+V)"
          icon="content_paste"
          disabled={!ready}
          onClick={() => api && paste(api)}
        />
        <ToolbarButton
          id="cut"
          label="Cut (Ctrl+X)"
          icon="content_cut"
          disabled={!ready}
          onClick={() => api && cut(api)}
        />
        <ToolbarButton
          id="copy"
          label="Copy (Ctrl+C)"
          icon="content_copy"
          disabled={!ready}
          onClick={() => api && copy(api)}
        />
        <ToolbarButton
          id="format-painter"
          label="Format Painter"
          icon="format_paint"
          disabled={!ready}
          onClick={() => api && startFormatPainter(api)}
        />
      </RibbonGroup>

      <RibbonGroup label="Font" rows>
        <RibbonRow>
          <ToolbarSelect
            id="font-family"
            label="Font family"
            value={state.fontFamily || 'Calibri'}
            options={FONT_FAMILIES.map((f) => ({ value: f, label: f }))}
            width={130}
            disabled={!ready}
            onChange={(v) => api && setFontFamily(api, v)}
          />
          <ToolbarSelect
            id="font-size"
            label="Font size"
            value={String(state.fontSize || 11)}
            options={FONT_SIZES.map((s) => ({ value: String(s), label: String(s) }))}
            width={64}
            disabled={!ready}
            onChange={(v) => api && setFontSize(api, Number(v))}
          />
        </RibbonRow>
        <RibbonRow>
          <ToolbarButton
            id="bold"
            label="Bold (Ctrl+B)"
            icon="format_bold"
            pressed={state.isBold}
            disabled={!ready}
            onClick={() => api && toggleBold(api, state.isBold)}
          />
          <ToolbarButton
            id="italic"
            label="Italic (Ctrl+I)"
            icon="format_italic"
            pressed={state.isItalic}
            disabled={!ready}
            onClick={() => api && toggleItalic(api, state.isItalic)}
          />
          <ToolbarButton
            id="underline"
            label="Underline (Ctrl+U)"
            icon="format_underlined"
            pressed={state.isUnderline}
            disabled={!ready}
            onClick={() => api && toggleUnderline(api, state.isUnderline)}
          />
          <ToolbarButton
            id="strikethrough"
            label="Strikethrough"
            icon="format_strikethrough"
            pressed={state.isStrike}
            disabled={!ready}
            onClick={() => api && toggleStrikethrough(api, state.isStrike)}
          />
          <ToolbarColorButton
            id="font-color"
            label="Font color"
            icon="format_color_text"
            value={state.fontColor}
            defaultColor="#000000"
            disabled={!ready}
            onChange={(c) => api && setFontColor(api, c)}
          />
          <ToolbarColorButton
            id="fill-color"
            label="Fill / highlight color"
            icon="format_color_fill"
            value={state.fillColor}
            defaultColor="#ffeb3b"
            disabled={!ready}
            onChange={(c) => api && setFillColor(api, c)}
          />
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label="Borders">
        <ToolbarDropdown
          id="borders"
          label="Borders"
          icon="border_all"
          disabled={!ready}
          items={[
            { id: 'all', label: 'All borders', icon: 'border_all' },
            { id: 'outside', label: 'Outside borders', icon: 'border_outer' },
            { id: 'top', label: 'Top border', icon: 'border_top' },
            { id: 'bottom', label: 'Bottom border', icon: 'border_bottom' },
            { id: 'left', label: 'Left border', icon: 'border_left' },
            { id: 'right', label: 'Right border', icon: 'border_right' },
            { id: 'none', label: 'No border', icon: 'border_clear' },
          ]}
          onDefault={() => api && setBorders(api, 'all')}
          onChoose={(choice) => api && setBorders(api, choice as BorderChoice)}
        />
      </RibbonGroup>

      <RibbonGroup label="Alignment" rows>
        <RibbonRow>
          <ToolbarButton
            id="align-top"
            label="Align top"
            icon="vertical_align_top"
            pressed={state.vAlign === 'top'}
            disabled={!ready}
            onClick={() => api && setVerticalAlignment(api, 'top')}
          />
          <ToolbarButton
            id="align-middle"
            label="Align middle"
            icon="vertical_align_center"
            pressed={state.vAlign === 'middle'}
            disabled={!ready}
            onClick={() => api && setVerticalAlignment(api, 'middle')}
          />
          <ToolbarButton
            id="align-bottom"
            label="Align bottom"
            icon="vertical_align_bottom"
            pressed={state.vAlign === ('bottom' as VAlign)}
            disabled={!ready}
            onClick={() => api && setVerticalAlignment(api, 'bottom')}
          />
          <ToolbarButton
            id="wrap-text"
            label="Wrap text"
            icon="wrap_text"
            pressed={state.isWrapped}
            disabled={!ready}
            onClick={() => api && toggleWrap(api, state.isWrapped)}
          />
        </RibbonRow>
        <RibbonRow>
          <ToolbarButton
            id="align-left"
            label="Align left"
            icon="format_align_left"
            pressed={state.align === 'left'}
            disabled={!ready}
            onClick={() => api && setAlignment(api, 'left')}
          />
          <ToolbarButton
            id="align-center"
            label="Center"
            icon="format_align_center"
            pressed={state.align === 'center'}
            disabled={!ready}
            onClick={() => api && setAlignment(api, 'center')}
          />
          <ToolbarButton
            id="align-right"
            label="Align right"
            icon="format_align_right"
            pressed={state.align === ('right' as HAlign)}
            disabled={!ready}
            onClick={() => api && setAlignment(api, 'right')}
          />
          <ToolbarButton
            id="merge-cells"
            label={state.isMerged ? 'Unmerge cells' : 'Merge & Center'}
            icon={state.isMerged ? 'call_split' : 'cell_merge'}
            pressed={state.isMerged}
            disabled={!ready || (!state.isMerged && !state.isMultiCell)}
            onClick={() => api && toggleMerge(api, state.isMerged)}
          />
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label="Number" rows>
        <RibbonRow>
          <ToolbarSelect
            id="num-format"
            label="Number format"
            value={detectFormatKey(state.numberFormat)}
            options={NUMBER_FORMAT_OPTIONS}
            width={150}
            disabled={!ready}
            onChange={(v) => api && setNumberFormatByKey(api, v as NumberFormatKey)}
          />
        </RibbonRow>
        <RibbonRow>
          <ToolbarButton
            id="numfmt-currency"
            label="Currency"
            icon="attach_money"
            pressed={state.numberFormat === NUMBER_FORMATS.currency}
            disabled={!ready}
            onClick={() => api && setNumberFormat(api, NUMBER_FORMATS.currency)}
          />
          <ToolbarButton
            id="numfmt-percent"
            label="Percent"
            icon="percent"
            pressed={state.numberFormat === NUMBER_FORMATS.percent}
            disabled={!ready}
            onClick={() => api && setNumberFormat(api, NUMBER_FORMATS.percent)}
          />
          <ToolbarButton
            id="num-decimal-up"
            label="Increase decimals"
            icon="add"
            disabled={!ready}
            onClick={() => api && increaseDecimal(api)}
          />
          <ToolbarButton
            id="num-decimal-down"
            label="Decrease decimals"
            icon="remove"
            disabled={!ready}
            onClick={() => api && decreaseDecimal(api)}
          />
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label="Editing">
        <ToolbarButton
          id="find-replace"
          label="Find & Replace (Ctrl+F)"
          icon="search"
          disabled={!ready}
          onClick={() => api && openFindReplace(api)}
        />
      </RibbonGroup>
    </>
  );
}
