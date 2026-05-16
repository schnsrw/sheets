import { useUniverAPI } from '../../use-univer';
import { useActiveCellState } from '../../hooks/useActiveCellState';
import {
  deleteSelectedColumn,
  deleteSelectedRow,
  insertColumnLeft,
  insertColumnRight,
  insertNewSheet,
  insertRowAbove,
  insertRowBelow,
} from '../tab-actions';
import { RibbonGroup, ToolbarButton } from '../RibbonControls';

export function InsertTab() {
  const api = useUniverAPI();
  const { ready } = useActiveCellState();
  const enabled = Boolean(api) && ready;

  return (
    <>
      <RibbonGroup label="Rows">
        <ToolbarButton
          id="insert-row-above"
          label="Insert row above"
          icon="vertical_align_top"
          disabled={!enabled}
          onClick={() => api && insertRowAbove(api)}
        />
        <ToolbarButton
          id="insert-row-below"
          label="Insert row below"
          icon="vertical_align_bottom"
          disabled={!enabled}
          onClick={() => api && insertRowBelow(api)}
        />
        <ToolbarButton
          id="delete-row"
          label="Delete row"
          icon="delete_sweep"
          disabled={!enabled}
          onClick={() => api && deleteSelectedRow(api)}
        />
      </RibbonGroup>

      <RibbonGroup label="Columns">
        <ToolbarButton
          id="insert-col-left"
          label="Insert column left"
          icon="keyboard_tab_rtl"
          disabled={!enabled}
          onClick={() => api && insertColumnLeft(api)}
        />
        <ToolbarButton
          id="insert-col-right"
          label="Insert column right"
          icon="keyboard_tab"
          disabled={!enabled}
          onClick={() => api && insertColumnRight(api)}
        />
        <ToolbarButton
          id="delete-col"
          label="Delete column"
          icon="folder_delete"
          disabled={!enabled}
          onClick={() => api && deleteSelectedColumn(api)}
        />
      </RibbonGroup>

      <RibbonGroup label="Sheet">
        <ToolbarButton
          id="insert-sheet"
          label="New sheet"
          icon="add_box"
          disabled={!enabled}
          onClick={() => api && insertNewSheet(api)}
        />
      </RibbonGroup>
    </>
  );
}
