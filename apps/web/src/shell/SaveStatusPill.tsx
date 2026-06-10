import { useEffect, useState } from 'react';
import { useSaveStatus } from './save-status-context';

/**
 * Title-bar pill that surfaces the save status. UX_AUDIT.md §4.3.
 *
 * States:
 *   idle    — render nothing (no clutter when there's nothing to say)
 *   saving  — "Saving…" with a spinner
 *   saved   — "Saved" + relative-time ("just now" / "2 min ago")
 *   error   — "Save failed" with the underlying message as a tooltip
 *
 * The relative-time string ticks every 30 s so it stays roughly
 * correct without burning a render every second. Cleared whenever
 * the status moves off `saved`.
 */
export function SaveStatusPill() {
  const { status } = useSaveStatus();

  const [, forceTick] = useState(0);
  useEffect(() => {
    if (status.kind !== 'saved') return;
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [status.kind]);

  if (status.kind === 'idle') return null;

  let label = '';
  let tone: 'neutral' | 'success' | 'error' = 'neutral';
  let title = '';
  if (status.kind === 'saving') {
    label = 'Saving…';
    tone = 'neutral';
  } else if (status.kind === 'saved') {
    label = `Saved ${formatRelative(Date.now() - status.savedAt)}`;
    tone = 'success';
    title = `Saved at ${new Date(status.savedAt).toLocaleTimeString()}`;
  } else if (status.kind === 'error') {
    label = 'Save failed';
    tone = 'error';
    title = status.message;
  }

  return (
    <span
      className={`save-status-pill save-status-pill--${tone}`}
      data-testid="save-status-pill"
      data-state={status.kind}
      role="status"
      aria-live="polite"
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 500,
        background:
          tone === 'success'
            ? 'rgba(34,197,94,0.10)'
            : tone === 'error'
              ? 'rgba(239,68,68,0.10)'
              : 'rgba(100,116,139,0.10)',
        color:
          tone === 'success' ? '#15803d' : tone === 'error' ? '#b91c1c' : '#475569',
      }}
    >
      {status.kind === 'saving' && (
        <span
          aria-hidden="true"
          style={{
            width: 10,
            height: 10,
            border: '2px solid currentColor',
            borderRightColor: 'transparent',
            borderRadius: '50%',
            animation: 'save-status-spin 800ms linear infinite',
          }}
        />
      )}
      <span>{label}</span>
    </span>
  );
}

function formatRelative(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return 'just now';
  const sec = Math.round(ms / 1000);
  if (sec < 30) return 'just now';
  if (sec < 90) return '1 min ago';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}
