import { useEffect, useState } from 'react';
import { useLoading, type LoadingPhase } from '../loading-context';

/**
 * Centered modal shown while a multi-MB workbook is being opened. The
 * overlay is intentionally render-blocking: clicks during the unit swap
 * race Univer's render phase and can leave the grid blank.
 *
 * Phase order is reading → parsing → mounting. We label each one
 * specifically so a 10 s wait *feels* like progress instead of a
 * mystery hang. The elapsed counter appears at 1.5 s — early enough
 * to reassure but late enough that fast opens never see it.
 */

const PHASE_TEXT: Record<LoadingPhase, string> = {
  reading: 'Reading file…',
  parsing: 'Parsing workbook…',
  mounting: 'Loading into the editor…',
};

export function LoadingOverlay() {
  const { state } = useLoading();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!state) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => {
      setElapsed(Date.now() - state.startedAt);
    }, 250);
    return () => clearInterval(id);
  }, [state]);

  if (!state) return null;

  const showElapsed = elapsed > 1500;
  const showBigFileHint = elapsed > 4000;
  const sizeText = state.sizeBytes ? formatBytes(state.sizeBytes) : null;

  return (
    <div className="loading-overlay" data-testid="loading-overlay" role="status" aria-live="polite">
      <div className="loading-overlay__card" data-testid="loading-overlay-card">
        <div className="loading-overlay__icon" aria-hidden="true">
          <div className="loading-overlay__icon-inner" />
        </div>
        <div className="loading-overlay__title" data-testid="loading-overlay-title">
          Opening <strong>{state.fileName}</strong>
          {sizeText && <span className="loading-overlay__size"> · {sizeText}</span>}
        </div>
        <div className="loading-overlay__phase" data-testid="loading-overlay-phase">
          {PHASE_TEXT[state.phase]}
        </div>
        <div className="loading-overlay__bar" aria-hidden="true">
          <span className="loading-overlay__bar-fill" />
        </div>
        {showElapsed && (
          <div className="loading-overlay__elapsed" data-testid="loading-overlay-elapsed">
            {formatElapsed(elapsed)}
          </div>
        )}
        {showBigFileHint && (
          <div className="loading-overlay__hint">
            Large workbooks can take a few extra seconds to open.
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  const mb = b / (1024 * 1024);
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${mb.toFixed(0)} MB`;
}

function formatElapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)} s elapsed`;
  return `${Math.round(s)} s elapsed`;
}
