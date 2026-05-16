import { Icon } from './Icon';
import { useUniverAPI } from '../use-univer';
import { redo, undo } from './home-tab-actions';

type Props = { filename: string };

export function TitleBar({ filename }: Props) {
  const api = useUniverAPI();

  return (
    <header className="titlebar" data-testid="titlebar" role="banner">
      <span className="titlebar__brand">
        <Icon name="grid_view" size="sm" className="titlebar__brand-icon" />
        <span>casual sheets</span>
      </span>
      <span className="titlebar__divider" aria-hidden="true" />

      <div className="titlebar__qat" role="toolbar" aria-label="Quick access">
        <button
          type="button"
          className="titlebar__qat-btn"
          data-testid="qat-undo"
          aria-label="Undo (Ctrl+Z)"
          title="Undo (Ctrl+Z)"
          disabled={!api}
          onClick={() => api && undo(api)}
        >
          <Icon name="undo" size="sm" />
        </button>
        <button
          type="button"
          className="titlebar__qat-btn"
          data-testid="qat-redo"
          aria-label="Redo (Ctrl+Y)"
          title="Redo (Ctrl+Y)"
          disabled={!api}
          onClick={() => api && redo(api)}
        >
          <Icon name="redo" size="sm" />
        </button>
      </div>

      <span className="titlebar__divider" aria-hidden="true" />
      <span className="titlebar__filename" data-testid="titlebar-filename">
        {filename}
      </span>
      <span className="titlebar__spacer" />
    </header>
  );
}
