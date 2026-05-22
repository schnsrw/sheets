import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useUniverAPI } from '../use-univer';
import { useUI } from '../use-ui';
import { useBusy } from '../busy-context';
import { useActiveCellState, type HAlign, type VAlign } from '../hooks/useActiveCellState';
import { Icon } from './Icon';
import {
  NUMBER_FORMATS,
  adjustFontSize,
  copy,
  cut,
  decreaseDecimal,
  increaseDecimal,
  paste,
  redo,
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
  undo,
  openFindReplace,
  type BorderChoice,
  type NumberFormatKey,
} from './home-tab-actions';
import {
  TABLE_THEMES,
  applyAutoFunction,
  formatAsTable,
  insertComment,
  insertHyperlink,
  sortRange,
  toggleCommentPanel,
  toggleFilter,
  reapplyFilter,
  type TableThemeId,
  forceRecalculate,
  removeDuplicates,
  splitTextToColumns,
  openDataValidation,
  openCustomSort,
  insertImage,
  freezeFirstRow,
  freezeFirstColumn,
  freezeAtSelection,
  unfreezePanes,
  toggleGridlines,
  setZoom,
} from './tab-actions';
import {
  BigToolbarButton,
  BordersControl,
  RibbonGroup,
  ToolbarButton,
  ToolbarColorButton,
  ToolbarDropdown,
  ToolbarSelect,
} from './RibbonControls';
import { DEFAULT_BORDER_COLOR } from './home-tab-actions';

/**
 * Tabbed Excel-style ribbon. Six tabs (Home / Insert / Formulas / Data
 * / Review / View) swap the group row below the tab strip. The active
 * tab is local state — solo per browser window. Less-common operations
 * still live in the top MenuBar so the ribbon doesn't have to host every
 * single feature.
 *
 * All Home-tab control test-ids are preserved verbatim from the
 * pre-tabbed toolbar so the existing e2e suite (ribbon-tabs.spec.ts,
 * home-ribbon.spec.ts, …) keeps passing without selector churn.
 */

type RibbonTab = 'home' | 'insert' | 'formulas' | 'data' | 'review' | 'view';

const TABS: { id: RibbonTab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'insert', label: 'Insert' },
  { id: 'formulas', label: 'Formulas' },
  { id: 'data', label: 'Data' },
  { id: 'review', label: 'Review' },
  { id: 'view', label: 'View' },
];

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
  const patterns: Record<NumberFormatKey, string> = {
    general: '',
    number: '#,##0.00',
    integer: '#,##0',
    currency: '"$"#,##0.00',
    accounting: '_("$"* #,##0.00_);_("$"* (#,##0.00);_("$"* "-"??_);_(@_)',
    percent: '0.00%',
    date: 'yyyy-mm-dd',
    time: 'hh:mm:ss',
    scientific: '0.00E+00',
    text: '@',
  };
  for (const k of Object.keys(patterns) as NumberFormatKey[]) if (patterns[k] === pattern) return k;
  return 'general';
}

/**
 * Track whether the toolbar's horizontal scroller has more content to
 * either side. Drives the left/right overflow chevrons.
 */
function useScrollOverflow(ref: React.RefObject<HTMLElement>) {
  const [state, setState] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 0;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setState((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [ref]);
  return state;
}

export function Toolbar() {
  const api = useUniverAPI();
  const ui = useUI();
  const busy = useBusy();
  const state = useActiveCellState();
  const ready = Boolean(api) && state.ready;
  const [tab, setTab] = useState<RibbonTab>('home');

  const innerRef = useRef<HTMLDivElement>(null);
  const overflow = useScrollOverflow(innerRef);
  const scrollBy = (dx: number) =>
    innerRef.current?.scrollBy({ left: dx, behavior: 'smooth' });

  // Reset scroll position when switching tabs so each tab starts from
  // its left edge — otherwise the previous tab's scrolloffset persists
  // and a narrower new tab can look truncated on the right.
  useEffect(() => {
    innerRef.current?.scrollTo({ left: 0 });
  }, [tab]);

  return (
    <nav className="toolbar" data-testid="toolbar" aria-label="Toolbar">
      <div className="ribbon-tabs" role="tablist" aria-label="Ribbon tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            data-testid={`ribbon-tab-${t.id}`}
            className={`ribbon-tabs__tab${tab === t.id ? ' ribbon-tabs__tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="toolbar__body">
        {overflow.left && (
          <button
            type="button"
            className="toolbar__overflow toolbar__overflow--left"
            data-testid="toolbar-overflow-left"
            aria-label="Scroll toolbar left"
            tabIndex={-1}
            onClick={() => scrollBy(-240)}
          >
            <Icon name="chevron_left" size="sm" />
          </button>
        )}
        {overflow.right && (
          <button
            type="button"
            className="toolbar__overflow toolbar__overflow--right"
            data-testid="toolbar-overflow-right"
            aria-label="Scroll toolbar right — more buttons available"
            tabIndex={-1}
            onClick={() => scrollBy(240)}
          >
            <Icon name="chevron_right" size="sm" />
          </button>
        )}
        <div
          className="toolbar__inner"
          ref={innerRef}
          data-testid={`toolbar-${tab}`}
          role="tabpanel"
          aria-label={`${tab} ribbon`}
        >
          {tab === 'home' && (
            <HomeTab
              api={api}
              ready={ready}
              state={state}
              busy={busy}
            />
          )}
          {tab === 'insert' && <InsertTab api={api} ready={ready} ui={ui} busy={busy} />}
          {tab === 'formulas' && <FormulasTab api={api} ready={ready} state={state} />}
          {tab === 'data' && <DataTab api={api} ready={ready} state={state} />}
          {tab === 'review' && <ReviewTab api={api} ready={ready} ui={ui} />}
          {tab === 'view' && <ViewTab api={api} ready={ready} ui={ui} />}
        </div>
      </div>
    </nav>
  );
}

/* ── Home ────────────────────────────────────────────────────────────
   Existing two-row groups (Clipboard / Font / Alignment / Number /
   Insert / Panels) all kept verbatim with their original data-testids
   so the toolbar e2e suite remains green. New Cells + Editing groups
   appended at the end. */

type HomeTabProps = {
  api: ReturnType<typeof useUniverAPI>;
  ready: boolean;
  state: ReturnType<typeof useActiveCellState>;
  busy: ReturnType<typeof useBusy>;
};

function HomeTab({ api, ready, state, busy }: HomeTabProps): ReactNode {
  return (
    <>
      <RibbonGroup
        label="History"
        row1={<ToolbarButton id="undo" label="Undo (Ctrl+Z)" icon="undo" disabled={!ready} onClick={() => api && undo(api)} />}
        row2={<ToolbarButton id="redo" label="Redo (Ctrl+Y)" icon="redo" disabled={!ready} onClick={() => api && redo(api)} />}
      />

      <RibbonGroup
        label="Clipboard"
        lead={
          <BigToolbarButton
            id="paste"
            label="Paste (Ctrl+V)"
            icon="content_paste"
            disabled={!ready}
            onClick={() => api && paste(api)}
          />
        }
        row1={<>
          <ToolbarButton id="cut" label="Cut (Ctrl+X)" icon="content_cut" disabled={!ready} onClick={() => api && cut(api)} />
          <ToolbarButton id="copy" label="Copy (Ctrl+C)" icon="content_copy" disabled={!ready} onClick={() => api && copy(api)} />
          <ToolbarButton
            id="paste-special"
            label="Paste Special… (Ctrl+Alt+V)"
            icon="content_paste_go"
            disabled={!ready}
            onClick={() => document.dispatchEvent(new CustomEvent('casual-open-paste-special'))}
          />
        </>}
        row2={
          <ToolbarButton
            id="format-painter"
            label={state.isFormatPainterActive ? 'Format Painter (armed)' : 'Format Painter'}
            icon="format_paint"
            pressed={state.isFormatPainterActive}
            disabled={!ready}
            onClick={() => api && startFormatPainter(api)}
          />
        }
      />

      <RibbonGroup
        label="Font"
        row1={<>
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
            width={56}
            disabled={!ready}
            onChange={(v) => api && setFontSize(api, Number(v))}
          />
          <ToolbarButton id="font-size-up" label="Increase font size" icon="text_increase" disabled={!ready} onClick={() => api && adjustFontSize(api, +1)} />
          <ToolbarButton id="font-size-down" label="Decrease font size" icon="text_decrease" disabled={!ready} onClick={() => api && adjustFontSize(api, -1)} />
        </>}
        row2={<>
          <ToolbarButton id="bold" label="Bold (Ctrl+B)" icon="format_bold" pressed={state.isBold} disabled={!ready} onClick={() => api && toggleBold(api, state.isBold)} />
          <ToolbarButton id="italic" label="Italic (Ctrl+I)" icon="format_italic" pressed={state.isItalic} disabled={!ready} onClick={() => api && toggleItalic(api, state.isItalic)} />
          <ToolbarButton id="underline" label="Underline (Ctrl+U)" icon="format_underlined" pressed={state.isUnderline} disabled={!ready} onClick={() => api && toggleUnderline(api, state.isUnderline)} />
          <ToolbarButton id="strikethrough" label="Strikethrough" icon="format_strikethrough" pressed={state.isStrike} disabled={!ready} onClick={() => api && toggleStrikethrough(api, state.isStrike)} />
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
          <BordersControl
            label="Borders"
            icon="border_all"
            disabled={!ready}
            defaultColor={DEFAULT_BORDER_COLOR}
            items={[
              { id: 'all', label: 'All borders', icon: 'border_all' },
              { id: 'outside', label: 'Outside borders', icon: 'border_outer' },
              { id: 'top', label: 'Top border', icon: 'border_top' },
              { id: 'bottom', label: 'Bottom border', icon: 'border_bottom' },
              { id: 'left', label: 'Left border', icon: 'border_left' },
              { id: 'right', label: 'Right border', icon: 'border_right' },
              { id: 'none', label: 'No border', icon: 'border_clear' },
            ]}
            onDefault={(color, weight) => api && setBorders(api, 'all', color, weight)}
            onChoose={(choice, color, weight) =>
              api && setBorders(api, choice as BorderChoice, color, weight)
            }
          />
        </>}
      />

      <RibbonGroup
        label="Alignment"
        row1={<>
          <ToolbarButton id="align-left" label="Align left" icon="format_align_left" pressed={state.align === 'left'} disabled={!ready} onClick={() => api && setAlignment(api, 'left')} />
          <ToolbarButton id="align-center" label="Center" icon="format_align_center" pressed={state.align === 'center'} disabled={!ready} onClick={() => api && setAlignment(api, 'center')} />
          <ToolbarButton id="align-right" label="Align right" icon="format_align_right" pressed={state.align === ('right' as HAlign)} disabled={!ready} onClick={() => api && setAlignment(api, 'right')} />
          <ToolbarButton id="wrap-text" label="Wrap text" icon="wrap_text" pressed={state.isWrapped} disabled={!ready} onClick={() => api && toggleWrap(api, state.isWrapped)} />
        </>}
        row2={<>
          <ToolbarButton id="align-top" label="Align top" icon="vertical_align_top" pressed={state.vAlign === 'top'} disabled={!ready} onClick={() => api && setVerticalAlignment(api, 'top')} />
          <ToolbarButton id="align-middle" label="Align middle" icon="vertical_align_center" pressed={state.vAlign === 'middle'} disabled={!ready} onClick={() => api && setVerticalAlignment(api, 'middle')} />
          <ToolbarButton id="align-bottom" label="Align bottom" icon="vertical_align_bottom" pressed={state.vAlign === ('bottom' as VAlign)} disabled={!ready} onClick={() => api && setVerticalAlignment(api, 'bottom')} />
          <ToolbarButton
            id="merge-cells"
            label={state.isMerged ? 'Unmerge cells' : 'Merge & Center'}
            icon={state.isMerged ? 'call_split' : 'cell_merge'}
            pressed={state.isMerged}
            disabled={!ready || (!state.isMerged && !state.isMultiCell)}
            onClick={() => api && toggleMerge(api, state.isMerged)}
          />
        </>}
      />

      <RibbonGroup
        label="Number"
        row1={
          <ToolbarSelect
            id="num-format"
            label="Number format"
            value={detectFormatKey(state.numberFormat)}
            options={NUMBER_FORMAT_OPTIONS}
            width={108}
            disabled={!ready}
            onChange={(v) => api && setNumberFormatByKey(api, v as NumberFormatKey)}
          />
        }
        row2={<>
          <ToolbarButton id="numfmt-currency" label="Currency" icon="attach_money" pressed={state.numberFormat === NUMBER_FORMATS.currency} disabled={!ready} onClick={() => api && setNumberFormat(api, NUMBER_FORMATS.currency)} />
          <ToolbarButton id="numfmt-percent" label="Percent" icon="percent" pressed={state.numberFormat === NUMBER_FORMATS.percent} disabled={!ready} onClick={() => api && setNumberFormat(api, NUMBER_FORMATS.percent)} />
          <ToolbarButton id="decimal-up" label="Increase decimals" icon="add" disabled={!ready} onClick={() => api && increaseDecimal(api)} />
          <ToolbarButton id="decimal-down" label="Decrease decimals" icon="remove" disabled={!ready} onClick={() => api && decreaseDecimal(api)} />
        </>}
      />

      <RibbonGroup
        label="Insert"
        row1={<>
          <ToolbarDropdown
            id="auto-sum"
            label="AutoSum"
            icon="functions"
            disabled={!ready}
            items={[
              { id: 'SUM', label: 'Sum', icon: 'functions' },
              { id: 'AVERAGE', label: 'Average', icon: 'bar_chart' },
              { id: 'COUNT', label: 'Count', icon: 'numbers' },
              { id: 'MAX', label: 'Max', icon: 'arrow_upward' },
              { id: 'MIN', label: 'Min', icon: 'arrow_downward' },
            ]}
            onDefault={() => api && applyAutoFunction(api, 'SUM')}
            onChoose={(id) => api && applyAutoFunction(api, id as 'SUM' | 'AVERAGE' | 'COUNT' | 'MIN' | 'MAX')}
          />
          <ToolbarButton
            id="insert-chart"
            label="Insert chart"
            icon="bar_chart"
            disabled={!ready}
            onClick={() => document.dispatchEvent(new CustomEvent('casual-open-insert-chart'))}
          />
          <ToolbarButton
            id="insert-pivot"
            label="Insert PivotTable"
            icon="pivot_table_chart"
            disabled={!ready}
            onClick={() => document.dispatchEvent(new CustomEvent('casual-open-insert-pivot'))}
          />
          <ToolbarDropdown
            id="format-as-table"
            label="Format as Table"
            icon="table_rows"
            disabled={!ready}
            items={[
              { id: 'plain', label: 'Plain (no style)', icon: 'grid_on' },
              ...TABLE_THEMES.map((t) => ({
                id: t.id,
                label: t.label,
                icon: 'table_chart',
              })),
            ]}
            onDefault={() => {
              if (!api) return;
              void busy.runBusy('Creating table…', () => formatAsTable(api, 'table-default-0'));
            }}
            onChoose={(id) => {
              if (!api) return;
              void busy.runBusy('Creating table…', () =>
                id === 'plain'
                  ? formatAsTable(api, undefined)
                  : formatAsTable(api, id as TableThemeId),
              );
            }}
          />
        </>}
        row2={<>
          <ToolbarDropdown
            id="sort-filter"
            label="Sort & Filter"
            icon="filter_list"
            disabled={!ready}
            items={[
              { id: 'sort-asc',     label: 'Sort A → Z',          icon: 'arrow_downward' },
              { id: 'sort-desc',    label: 'Sort Z → A',          icon: 'arrow_upward' },
              { id: 'toggle-filter', label: 'Toggle filter',      icon: 'filter_alt' },
            ]}
            onDefault={() => api && state.isMultiCell && sortRange(api, true)}
            onChoose={(id) => {
              if (!api) return;
              if (id === 'sort-asc') sortRange(api, true);
              else if (id === 'sort-desc') sortRange(api, false);
              else if (id === 'toggle-filter') void toggleFilter(api);
            }}
          />
          <ToolbarButton id="insert-hyperlink" label="Insert hyperlink (Ctrl+K)" icon="link" disabled={!ready} onClick={() => api && insertHyperlink(api)} />
          <ToolbarButton id="insert-comment" label="Insert comment" icon="add_comment" disabled={!ready} onClick={() => api && insertComment(api)} />
        </>}
      />

      {/* ── Cells — Insert / Delete dialogs (Ctrl++ / Ctrl+- equivalents).
            Dispatches CustomEvents instead of running the action directly,
            because the dialogs live in MenuBar (single source of truth for
            modal state). */}
      <RibbonGroup
        label="Cells"
        row1={<>
          <ToolbarButton
            id="cells-insert"
            label="Insert cells… (Ctrl++)"
            icon="add_box"
            disabled={!ready}
            onClick={() => document.dispatchEvent(new CustomEvent('casual-open-insert-cells'))}
          />
          <ToolbarButton
            id="cells-delete"
            label="Delete cells… (Ctrl+-)"
            icon="indeterminate_check_box"
            disabled={!ready}
            onClick={() => document.dispatchEvent(new CustomEvent('casual-open-delete-cells'))}
          />
        </>}
        row2={
          <ToolbarButton
            id="format-cells"
            label="Format Cells… (Ctrl+1)"
            icon="settings_applications"
            disabled={!ready}
            onClick={() => document.dispatchEvent(new CustomEvent('casual-open-format-cells'))}
          />
        }
      />

      <RibbonGroup
        label="Editing"
        row1={<>
          <ToolbarButton
            id="find-replace"
            label="Find & Replace (Ctrl+F)"
            icon="search"
            disabled={!ready}
            onClick={() => api && void openFindReplace(api)}
          />
        </>}
        row2={
          <ToolbarButton
            id="clear-formatting"
            label="Clear formatting"
            icon="format_clear"
            disabled={!ready}
            onClick={() => {
              if (!api) return;
              const wb = api.getActiveWorkbook();
              const range = wb?.getActiveSheet()?.getActiveRange();
              // Falls back gracefully if the facade method's missing
              // (older Univer); the Clear-formats command is the
              // canonical reset.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (range as any)?.clearFormat?.();
            }}
          />
        }
      />
    </>
  );
}

/* ── Insert tab ────────────────────────────────────────────────────── */

type InsertTabProps = {
  api: ReturnType<typeof useUniverAPI>;
  ready: boolean;
  ui: ReturnType<typeof useUI>;
  busy: ReturnType<typeof useBusy>;
};

function InsertTab({ api, ready, ui, busy }: InsertTabProps): ReactNode {
  return (
    <>
      <RibbonGroup
        label="Tables"
        row1={
          <ToolbarDropdown
            id="insert-format-as-table"
            label="Format as Table"
            icon="table_rows"
            disabled={!ready}
            items={[
              { id: 'plain', label: 'Plain (no style)', icon: 'grid_on' },
              ...TABLE_THEMES.map((t) => ({ id: t.id, label: t.label, icon: 'table_chart' })),
            ]}
            onDefault={() => {
              if (!api) return;
              void busy.runBusy('Creating table…', () => formatAsTable(api, 'table-default-0'));
            }}
            onChoose={(id) => {
              if (!api) return;
              void busy.runBusy('Creating table…', () =>
                id === 'plain'
                  ? formatAsTable(api, undefined)
                  : formatAsTable(api, id as TableThemeId),
              );
            }}
          />
        }
        row2={
          <ToolbarButton
            id="insert-pivot-2"
            label="Insert PivotTable"
            icon="pivot_table_chart"
            disabled={!ready}
            onClick={() => document.dispatchEvent(new CustomEvent('casual-open-insert-pivot'))}
          />
        }
      />
      <RibbonGroup
        label="Charts"
        row1={
          <ToolbarButton
            id="insert-chart-2"
            label="Insert chart (Alt+F1)"
            icon="bar_chart"
            disabled={!ready}
            onClick={() => document.dispatchEvent(new CustomEvent('casual-open-insert-chart'))}
          />
        }
        row2={
          <ToolbarButton
            id="charts-panel"
            label={ui.chartsPanelVisible ? 'Hide Charts panel' : 'Charts panel'}
            icon="analytics"
            pressed={ui.chartsPanelVisible}
            onClick={ui.toggleChartsPanel}
          />
        }
      />
      <RibbonGroup
        label="Illustrations"
        row1={
          <ToolbarButton
            id="insert-image"
            label="Insert image"
            icon="image"
            disabled={!ready}
            onClick={() => api && insertImage(api)}
          />
        }
        row2={null}
      />
      <RibbonGroup
        label="Links"
        row1={
          <ToolbarButton
            id="insert-hyperlink-2"
            label="Insert hyperlink (Ctrl+K)"
            icon="link"
            disabled={!ready}
            onClick={() => api && insertHyperlink(api)}
          />
        }
        row2={null}
      />
      <RibbonGroup
        label="Comments"
        row1={
          <ToolbarButton
            id="insert-comment-2"
            label="Insert comment"
            icon="add_comment"
            disabled={!ready}
            onClick={() => api && insertComment(api)}
          />
        }
        row2={
          <ToolbarButton
            id="comments-panel"
            label="Comments panel"
            icon="forum"
            disabled={!ready}
            onClick={() => api && toggleCommentPanel(api)}
          />
        }
      />
      <RibbonGroup
        label="Symbols"
        row1={
          <ToolbarButton
            id="insert-function-2"
            label="Insert function (Shift+F3)"
            icon="function"
            disabled={!ready}
            onClick={() => document.dispatchEvent(new CustomEvent('casual-open-insert-function'))}
          />
        }
        row2={null}
      />
    </>
  );
}

/* ── Formulas tab ──────────────────────────────────────────────────── */

type FormulasTabProps = {
  api: ReturnType<typeof useUniverAPI>;
  ready: boolean;
  state: ReturnType<typeof useActiveCellState>;
};

function FormulasTab({ api, ready, state }: FormulasTabProps): ReactNode {
  return (
    <>
      <RibbonGroup
        label="Function Library"
        lead={
          <BigToolbarButton
            id="insert-function-big"
            label="Insert Function (Shift+F3)"
            icon="function"
            disabled={!ready}
            onClick={() => document.dispatchEvent(new CustomEvent('casual-open-insert-function'))}
          />
        }
        row1={
          <ToolbarDropdown
            id="auto-sum-2"
            label="AutoSum"
            icon="functions"
            disabled={!ready}
            items={[
              { id: 'SUM', label: 'Sum', icon: 'functions' },
              { id: 'AVERAGE', label: 'Average', icon: 'bar_chart' },
              { id: 'COUNT', label: 'Count', icon: 'numbers' },
              { id: 'MAX', label: 'Max', icon: 'arrow_upward' },
              { id: 'MIN', label: 'Min', icon: 'arrow_downward' },
            ]}
            onDefault={() => api && applyAutoFunction(api, 'SUM')}
            onChoose={(id) => api && applyAutoFunction(api, id as 'SUM' | 'AVERAGE' | 'COUNT' | 'MIN' | 'MAX')}
          />
        }
        row2={null}
      />
      <RibbonGroup
        label="Calculation"
        row1={
          <ToolbarButton
            id="force-recalc"
            label="Calculate Now (F9)"
            icon="refresh"
            disabled={!ready}
            onClick={() => api && forceRecalculate(api)}
          />
        }
        row2={null}
      />
      {/* placeholder to silence unused-state warning when this tab is
          quiet — the cell-state hook also drives the formula bar so
          it's harmless to subscribe. */}
      <span hidden>{String(state.ready)}</span>
    </>
  );
}

/* ── Data tab ─────────────────────────────────────────────────────── */

type DataTabProps = {
  api: ReturnType<typeof useUniverAPI>;
  ready: boolean;
  state: ReturnType<typeof useActiveCellState>;
};

function DataTab({ api, ready, state }: DataTabProps): ReactNode {
  return (
    <>
      <RibbonGroup
        label="Sort & Filter"
        row1={<>
          <ToolbarButton id="data-sort-asc" label="Sort A → Z" icon="arrow_downward" disabled={!ready} onClick={() => api && sortRange(api, true)} />
          <ToolbarButton id="data-sort-desc" label="Sort Z → A" icon="arrow_upward" disabled={!ready} onClick={() => api && sortRange(api, false)} />
          <ToolbarButton id="data-custom-sort" label="Custom Sort…" icon="sort" disabled={!ready} onClick={() => api && openCustomSort(api)} />
        </>}
        row2={<>
          <ToolbarButton id="data-toggle-filter" label="Toggle Filter (Ctrl+Shift+L)" icon="filter_alt" disabled={!ready} onClick={() => api && void toggleFilter(api)} />
          <ToolbarButton id="data-reapply-filter" label="Re-apply Filter (Ctrl+Alt+L)" icon="filter_alt_off" disabled={!ready} onClick={() => api && void reapplyFilter(api)} />
        </>}
      />
      <RibbonGroup
        label="Data Tools"
        row1={<>
          <ToolbarButton id="data-text-to-columns" label="Text to Columns" icon="view_column" disabled={!ready} onClick={() => api && splitTextToColumns(api)} />
          <ToolbarButton id="data-remove-duplicates" label="Remove Duplicates" icon="filter_none" disabled={!ready || !state.isMultiCell} onClick={() => api && removeDuplicates(api)} />
        </>}
        row2={
          <ToolbarButton id="data-validation" label="Data Validation…" icon="rule" disabled={!ready} onClick={() => api && openDataValidation(api)} />
        }
      />
    </>
  );
}

/* ── Review tab ───────────────────────────────────────────────────── */

type ReviewTabProps = {
  api: ReturnType<typeof useUniverAPI>;
  ready: boolean;
  ui: ReturnType<typeof useUI>;
};

function ReviewTab({ api, ready, ui }: ReviewTabProps): ReactNode {
  return (
    <>
      <RibbonGroup
        label="Comments"
        row1={
          <ToolbarButton
            id="review-insert-comment"
            label="New Comment"
            icon="add_comment"
            disabled={!ready}
            onClick={() => api && insertComment(api)}
          />
        }
        row2={
          <ToolbarButton
            id="review-comments-panel"
            label="Comments panel"
            icon="forum"
            disabled={!ready}
            onClick={() => api && toggleCommentPanel(api)}
          />
        }
      />
      <RibbonGroup
        label="History"
        row1={
          <ToolbarButton
            id="review-history-panel"
            label={ui.historyPanelVisible ? 'Hide History panel' : 'History panel'}
            icon="history"
            pressed={ui.historyPanelVisible}
            onClick={ui.toggleHistoryPanel}
          />
        }
        row2={null}
      />
      <RibbonGroup
        label="Share"
        row1={
          <ToolbarButton
            id="review-share"
            label="Share for co-editing…"
            icon="share"
            disabled={!ready}
            onClick={ui.openShareRoom}
          />
        }
        row2={null}
      />
    </>
  );
}

/* ── View tab ─────────────────────────────────────────────────────── */

type ViewTabProps = {
  api: ReturnType<typeof useUniverAPI>;
  ready: boolean;
  ui: ReturnType<typeof useUI>;
};

/** Read current zoom from the active worksheet (falls back to 1) so
 *  zoom +/- buttons relative-step from the displayed value rather than
 *  a stale cache. Univer's facade doesn't expose getZoomRatio; reach
 *  through the internal worksheet object. */
function readZoom(api: ReturnType<typeof useUniverAPI>): number {
  if (!api) return 1;
  try {
    const wb = api.getActiveWorkbook();
    const sheet = wb?.getActiveSheet();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws = sheet as any;
    const z = ws?._worksheet?.getZoomRatio?.() ?? ws?.getZoomRatio?.();
    return typeof z === 'number' && z > 0 ? z : 1;
  } catch {
    return 1;
  }
}

/** Read the current showGridlines flag from the active worksheet so the
 *  toggle button flips the actual state instead of always going off. */
function readGridlines(api: ReturnType<typeof useUniverAPI>): boolean {
  if (!api) return true;
  try {
    const wb = api.getActiveWorkbook();
    const sheet = wb?.getActiveSheet();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws = sheet as any;
    const cfg = ws?._worksheet?.getConfig?.() ?? ws?.getConfig?.();
    // 0 = hidden, 1/undef = shown
    return cfg?.showGridlines !== 0;
  } catch {
    return true;
  }
}

function ViewTab({ api, ready, ui }: ViewTabProps): ReactNode {
  return (
    <>
      <RibbonGroup
        label="Sheet View"
        row1={<>
          <ToolbarButton
            id="view-gridlines"
            label="Toggle Gridlines"
            icon="grid_on"
            disabled={!ready}
            onClick={() => api && toggleGridlines(api, readGridlines(api))}
          />
          <ToolbarButton
            id="view-formula-bar"
            label={ui.formulaBarVisible ? 'Hide Formula Bar' : 'Show Formula Bar'}
            icon="text_fields"
            pressed={ui.formulaBarVisible}
            onClick={ui.toggleFormulaBar}
          />
          <ToolbarButton
            id="view-menu-bar"
            label={ui.menuBarVisible ? 'Hide Menu Bar (compact)' : 'Show Menu Bar (classic)'}
            icon="menu"
            pressed={ui.menuBarVisible}
            onClick={ui.toggleMenuBar}
          />
        </>}
        row2={null}
      />
      <RibbonGroup
        label="Freeze"
        row1={
          <ToolbarDropdown
            id="freeze"
            label="Freeze Panes"
            icon="ac_unit"
            disabled={!ready}
            items={[
              { id: 'first-row', label: 'Freeze top row', icon: 'border_top' },
              { id: 'first-col', label: 'Freeze first column', icon: 'border_left' },
              { id: 'at-selection', label: 'Freeze at selection', icon: 'crop_free' },
              { id: 'unfreeze', label: 'Unfreeze', icon: 'border_clear' },
            ]}
            onDefault={() => api && freezeFirstRow(api)}
            onChoose={(id) => {
              if (!api) return;
              if (id === 'first-row') freezeFirstRow(api);
              else if (id === 'first-col') freezeFirstColumn(api);
              else if (id === 'at-selection') freezeAtSelection(api);
              else if (id === 'unfreeze') unfreezePanes(api);
            }}
          />
        }
        row2={null}
      />
      <RibbonGroup
        label="Zoom"
        row1={<>
          <ToolbarButton id="zoom-out" label="Zoom out" icon="remove" disabled={!ready} onClick={() => api && setZoom(api, Math.max(0.25, readZoom(api) - 0.1))} />
          <ToolbarButton id="zoom-100" label="Reset zoom (100%)" icon="search" disabled={!ready} onClick={() => api && setZoom(api, 1)} />
          <ToolbarButton id="zoom-in" label="Zoom in" icon="add" disabled={!ready} onClick={() => api && setZoom(api, Math.min(4, readZoom(api) + 0.1))} />
        </>}
        row2={null}
      />
      <RibbonGroup
        label="Panels"
        row1={<>
          <ToolbarButton
            id="panel-tables"
            label={ui.tablesPanelVisible ? 'Hide Tables panel' : 'Tables panel'}
            icon="table_view"
            pressed={ui.tablesPanelVisible}
            onClick={ui.toggleTablesPanel}
          />
          <ToolbarButton
            id="panel-charts"
            label={ui.chartsPanelVisible ? 'Hide Charts panel' : 'Charts panel'}
            icon="analytics"
            pressed={ui.chartsPanelVisible}
            onClick={ui.toggleChartsPanel}
          />
        </>}
        row2={<>
          <ToolbarButton
            id="panel-outline"
            label={ui.outlinePanelVisible ? 'Hide Outline panel' : 'Outline panel'}
            icon="format_list_bulleted"
            pressed={ui.outlinePanelVisible}
            onClick={ui.toggleOutlinePanel}
          />
          <ToolbarButton
            id="panel-history"
            label={ui.historyPanelVisible ? 'Hide History panel' : 'History panel'}
            icon="history"
            pressed={ui.historyPanelVisible}
            onClick={ui.toggleHistoryPanel}
          />
        </>}
      />
    </>
  );
}
