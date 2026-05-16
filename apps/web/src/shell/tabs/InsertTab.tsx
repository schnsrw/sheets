import { useUniverAPI } from '../../use-univer';
import { useActiveCellState } from '../../hooks/useActiveCellState';
import {
  autoFitColumns,
  autoFitRows,
  deleteSelectedColumn,
  deleteSelectedRow,
  hideSelectedColumns,
  hideSelectedRows,
  insertColumnLeft,
  insertColumnRight,
  insertComment,
  insertHyperlink,
  insertImage,
  insertNewSheet,
  insertRowAbove,
  insertRowBelow,
  insertTable,
  unhideSelectedColumns,
  unhideSelectedRows,
} from '../tab-actions';
import { RibbonGroup, RibbonRow, ToolbarButton } from '../RibbonControls';

export function InsertTab() {
  const api = useUniverAPI();
  const { ready } = useActiveCellState();
  const enabled = Boolean(api) && ready;

  return (
    <>
      <RibbonGroup label="Rows" rows>
        <RibbonRow>
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
        </RibbonRow>
        <RibbonRow>
          <ToolbarButton
            id="hide-row"
            label="Hide row"
            icon="visibility_off"
            disabled={!enabled}
            onClick={() => api && hideSelectedRows(api)}
          />
          <ToolbarButton
            id="unhide-row"
            label="Unhide row"
            icon="visibility"
            disabled={!enabled}
            onClick={() => api && unhideSelectedRows(api)}
          />
        </RibbonRow>
      </RibbonGroup>

      <RibbonGroup label="Columns" rows>
        <RibbonRow>
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
        </RibbonRow>
        <RibbonRow>
          <ToolbarButton
            id="hide-col"
            label="Hide column"
            icon="visibility_off"
            disabled={!enabled}
            onClick={() => api && hideSelectedColumns(api)}
          />
          <ToolbarButton
            id="unhide-col"
            label="Unhide column"
            icon="visibility"
            disabled={!enabled}
            onClick={() => api && unhideSelectedColumns(api)}
          />
        </RibbonRow>
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

      <RibbonGroup label="Auto-fit">
        <ToolbarButton
          id="autofit-cols"
          label="Auto-fit column width"
          icon="settings_ethernet"
          disabled={!enabled}
          onClick={() => api && autoFitColumns(api)}
        />
        <ToolbarButton
          id="autofit-rows"
          label="Auto-fit row height"
          icon="height"
          disabled={!enabled}
          onClick={() => api && autoFitRows(api)}
        />
      </RibbonGroup>

      <RibbonGroup label="Content">
        <ToolbarButton
          id="insert-table"
          label="Insert table"
          icon="table_rows"
          disabled={!enabled}
          onClick={() => api && insertTable(api)}
        />
        <ToolbarButton
          id="insert-image"
          label="Insert image"
          icon="image"
          disabled={!enabled}
          onClick={() => api && insertImage(api)}
        />
        <ToolbarButton
          id="insert-comment"
          label="Comment"
          icon="comment"
          disabled={!enabled}
          onClick={() => api && insertComment(api)}
        />
        <ToolbarButton
          id="insert-hyperlink"
          label="Hyperlink (Ctrl+K)"
          icon="link"
          disabled={!enabled}
          onClick={() => api && insertHyperlink(api)}
        />
      </RibbonGroup>
    </>
  );
}
