import { useUniverAPI } from '../../use-univer';
import { useActiveCellState } from '../../hooks/useActiveCellState';
import { showCommentModal, toggleCommentPanel } from '../tab-actions';
import { RibbonGroup, ToolbarButton } from '../RibbonControls';

export function ReviewTab() {
  const api = useUniverAPI();
  const { ready } = useActiveCellState();
  const enabled = Boolean(api) && ready;

  return (
    <>
      <RibbonGroup label="Comments">
        <ToolbarButton
          id="new-comment"
          label="New comment"
          icon="add_comment"
          disabled={!enabled}
          onClick={() => api && showCommentModal(api)}
        />
        <ToolbarButton
          id="toggle-comments-panel"
          label="Show comments panel"
          icon="forum"
          disabled={!enabled}
          onClick={() => api && toggleCommentPanel(api)}
        />
      </RibbonGroup>

      <RibbonGroup label="Protect">
        <ToolbarButton
          id="protect-sheet"
          label="Protect sheet — coming soon"
          icon="lock"
          disabled
        />
        <ToolbarButton
          id="protect-workbook"
          label="Protect workbook — coming soon"
          icon="vpn_lock"
          disabled
        />
      </RibbonGroup>
    </>
  );
}
