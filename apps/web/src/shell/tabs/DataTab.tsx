import { useUniverAPI } from '../../use-univer';
import { useActiveCellState } from '../../hooks/useActiveCellState';
import {
  openConditionalFormatting,
  openDataValidation,
  removeDuplicates,
  sortRange,
  splitTextToColumns,
  toggleFilter,
} from '../tab-actions';
import { RibbonGroup, ToolbarButton } from '../RibbonControls';

export function DataTab() {
  const api = useUniverAPI();
  const { ready, isMultiCell } = useActiveCellState();
  const enabled = Boolean(api) && ready;

  return (
    <>
      <RibbonGroup label="Sort">
        <ToolbarButton
          id="sort-asc"
          label="Sort ascending (A → Z)"
          icon="arrow_downward"
          disabled={!enabled || !isMultiCell}
          onClick={() => api && sortRange(api, true)}
        />
        <ToolbarButton
          id="sort-desc"
          label="Sort descending (Z → A)"
          icon="arrow_upward"
          disabled={!enabled || !isMultiCell}
          onClick={() => api && sortRange(api, false)}
        />
      </RibbonGroup>

      <RibbonGroup label="Filter">
        <ToolbarButton
          id="filter-toggle"
          label="Toggle filter"
          icon="filter_alt"
          disabled={!enabled || !isMultiCell}
          onClick={() => api && toggleFilter(api)}
        />
      </RibbonGroup>

      <RibbonGroup label="Rules">
        <ToolbarButton
          id="data-validation"
          label="Data validation"
          icon="rule"
          disabled={!enabled}
          onClick={() => api && openDataValidation(api)}
        />
        <ToolbarButton
          id="conditional-formatting"
          label="Conditional formatting"
          icon="palette"
          disabled={!enabled}
          onClick={() => api && openConditionalFormatting(api)}
        />
      </RibbonGroup>

      <RibbonGroup label="Data tools">
        <ToolbarButton
          id="text-to-columns"
          label="Text to Columns"
          icon="splitscreen"
          disabled={!enabled || !isMultiCell}
          onClick={() => api && splitTextToColumns(api)}
        />
        <ToolbarButton
          id="remove-duplicates"
          label="Remove Duplicates"
          icon="filter_list_off"
          disabled={!enabled || !isMultiCell}
          onClick={() => api && removeDuplicates(api)}
        />
      </RibbonGroup>
    </>
  );
}
