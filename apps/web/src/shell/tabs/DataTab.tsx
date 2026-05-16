import { useUniverAPI } from '../../use-univer';
import { useActiveCellState } from '../../hooks/useActiveCellState';
import { sortRange, toggleFilter } from '../tab-actions';
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
    </>
  );
}
