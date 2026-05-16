import { useUniverAPI } from '../../use-univer';
import { useActiveCellState } from '../../hooks/useActiveCellState';
import { applyAutoFunction, insertFunction } from '../tab-actions';
import { RibbonGroup, ToolbarDropdown } from '../RibbonControls';

/**
 * Curated function categories — Excel's exact taxonomy with the most
 * commonly-used functions surfaced. Clicking inserts =FN(selection) or
 * =FN() depending on selection size.
 */
type FunctionCategory = {
  id: string;
  label: string;
  icon: string;
  functions: { id: string; label: string; icon: string }[];
};

const MATH: FunctionCategory = {
  id: 'fn-math',
  label: 'Math & Trig',
  icon: 'calculate',
  functions: [
    { id: 'SUM', label: 'SUM', icon: 'functions' },
    { id: 'ABS', label: 'ABS', icon: 'plus_minus' },
    { id: 'INT', label: 'INT', icon: 'looks_3' },
    { id: 'MOD', label: 'MOD', icon: 'percent' },
    { id: 'POWER', label: 'POWER', icon: 'superscript' },
    { id: 'ROUND', label: 'ROUND', icon: 'circle' },
    { id: 'SQRT', label: 'SQRT', icon: 'square_foot' },
    { id: 'SUMIF', label: 'SUMIF', icon: 'filter_alt' },
  ],
};

const STATISTICAL: FunctionCategory = {
  id: 'fn-stat',
  label: 'Statistical',
  icon: 'bar_chart',
  functions: [
    { id: 'AVERAGE', label: 'AVERAGE', icon: 'show_chart' },
    { id: 'COUNT', label: 'COUNT', icon: 'numbers' },
    { id: 'COUNTA', label: 'COUNTA', icon: 'pin' },
    { id: 'COUNTIF', label: 'COUNTIF', icon: 'filter_alt' },
    { id: 'MAX', label: 'MAX', icon: 'arrow_upward' },
    { id: 'MIN', label: 'MIN', icon: 'arrow_downward' },
    { id: 'MEDIAN', label: 'MEDIAN', icon: 'horizontal_split' },
    { id: 'STDEV', label: 'STDEV', icon: 'show_chart' },
  ],
};

const TEXT: FunctionCategory = {
  id: 'fn-text',
  label: 'Text',
  icon: 'title',
  functions: [
    { id: 'CONCATENATE', label: 'CONCATENATE', icon: 'merge' },
    { id: 'LEFT', label: 'LEFT', icon: 'format_align_left' },
    { id: 'RIGHT', label: 'RIGHT', icon: 'format_align_right' },
    { id: 'MID', label: 'MID', icon: 'format_align_center' },
    { id: 'LEN', label: 'LEN', icon: 'straighten' },
    { id: 'UPPER', label: 'UPPER', icon: 'keyboard_capslock' },
    { id: 'LOWER', label: 'LOWER', icon: 'text_fields' },
    { id: 'TRIM', label: 'TRIM', icon: 'content_cut' },
  ],
};

const DATE: FunctionCategory = {
  id: 'fn-date',
  label: 'Date & Time',
  icon: 'event',
  functions: [
    { id: 'TODAY', label: 'TODAY', icon: 'today' },
    { id: 'NOW', label: 'NOW', icon: 'schedule' },
    { id: 'DATE', label: 'DATE', icon: 'calendar_today' },
    { id: 'YEAR', label: 'YEAR', icon: 'event_available' },
    { id: 'MONTH', label: 'MONTH', icon: 'event_note' },
    { id: 'DAY', label: 'DAY', icon: 'event_busy' },
    { id: 'WEEKDAY', label: 'WEEKDAY', icon: 'date_range' },
    { id: 'DATEDIF', label: 'DATEDIF', icon: 'calculate' },
  ],
};

const LOGICAL: FunctionCategory = {
  id: 'fn-logical',
  label: 'Logical',
  icon: 'rule',
  functions: [
    { id: 'IF', label: 'IF', icon: 'question_mark' },
    { id: 'AND', label: 'AND', icon: 'all_inclusive' },
    { id: 'OR', label: 'OR', icon: 'view_module' },
    { id: 'NOT', label: 'NOT', icon: 'block' },
    { id: 'IFERROR', label: 'IFERROR', icon: 'error' },
    { id: 'IFS', label: 'IFS', icon: 'splitscreen' },
  ],
};

const LOOKUP: FunctionCategory = {
  id: 'fn-lookup',
  label: 'Lookup & Reference',
  icon: 'search',
  functions: [
    { id: 'VLOOKUP', label: 'VLOOKUP', icon: 'unfold_more' },
    { id: 'HLOOKUP', label: 'HLOOKUP', icon: 'unfold_less' },
    { id: 'INDEX', label: 'INDEX', icon: 'list' },
    { id: 'MATCH', label: 'MATCH', icon: 'tune' },
    { id: 'INDIRECT', label: 'INDIRECT', icon: 'arrow_forward' },
    { id: 'CHOOSE', label: 'CHOOSE', icon: 'check_box' },
  ],
};

const CATEGORIES = [MATH, STATISTICAL, TEXT, DATE, LOGICAL, LOOKUP];

export function FormulasTab() {
  const api = useUniverAPI();
  const { ready } = useActiveCellState();
  const enabled = Boolean(api) && ready;

  return (
    <>
      <RibbonGroup label="AutoSum">
        <ToolbarDropdown
          id="auto-sum"
          label="AutoSum"
          icon="functions"
          disabled={!enabled}
          items={[
            { id: 'SUM', label: 'Sum', icon: 'functions' },
            { id: 'AVERAGE', label: 'Average', icon: 'bar_chart' },
            { id: 'COUNT', label: 'Count', icon: 'numbers' },
            { id: 'MAX', label: 'Max', icon: 'arrow_upward' },
            { id: 'MIN', label: 'Min', icon: 'arrow_downward' },
          ]}
          onDefault={() => api && applyAutoFunction(api, 'SUM')}
          onChoose={(id) => {
            if (!api) return;
            applyAutoFunction(api, id as 'SUM' | 'AVERAGE' | 'COUNT' | 'MIN' | 'MAX');
          }}
        />
      </RibbonGroup>

      <RibbonGroup label="Function library">
        {CATEGORIES.map((cat) => (
          <ToolbarDropdown
            key={cat.id}
            id={cat.id}
            label={cat.label}
            icon={cat.icon}
            disabled={!enabled}
            items={cat.functions}
            onDefault={() => api && insertFunction(api, cat.functions[0].id)}
            onChoose={(name) => api && insertFunction(api, name)}
          />
        ))}
      </RibbonGroup>
    </>
  );
}
