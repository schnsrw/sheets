import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUniverAPI } from '../use-univer';
import { usePresence } from './presence-context';

/**
 * Renders remote peer selections as absolutely-positioned rectangles over
 * the grid. Strategy:
 *
 *   - Read the host (`[data-testid="univer-host"]`) bounding rect to know
 *     the overlay's reference frame.
 *   - For each peer's selection, call `range.getCellRect()` on its corner
 *     cells to derive *content-space* coords (not viewport — those are
 *     pre-scroll positions inside the canvas's drawing space).
 *   - Subtract the current scroll offset (tracked from `api.Event.Scroll`)
 *     and add the canvas-vs-host offset so positions land in the portal's
 *     coordinate frame.
 *   - Rerun on a ticker (rAF every 4 frames ≈ 67ms) so selection updates
 *     and small resize wobbles still settle quickly.
 *
 * The overlay div has `pointer-events: none` so it never blocks cell
 * clicks. CSS handles the color + label styling.
 */

type Rect = {
  clientId: number;
  name: string;
  color: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

export function PresenceLayer() {
  const api = useUniverAPI();
  const { peers } = usePresence();
  const [rects, setRects] = useState<Rect[]>([]);
  const hostRef = useRef<HTMLElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  // Latest scroll offset from Univer's grid. `getCellRect` returns
  // content-space coords; subtract this to land in canvas-visible space.
  const scrollRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Bumped whenever scroll changes so the polling loop knows to recompute
  // even if peer selection didn't move.
  const scrollTickRef = useRef(0);

  // Resolve the Univer host once, then on each render rebuild rects.
  useEffect(() => {
    hostRef.current = document.querySelector('[data-testid="univer-host"]') as HTMLElement | null;
  }, []);

  // Subscribe to Univer's facade Scroll event so we can track the data
  // area offset. Without this the cursor sticks to its *content* position
  // (e.g. row 4) and detaches visually when the user scrolls.
  useEffect(() => {
    if (!api) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyApi = api as any;
    const ev = anyApi.Event?.Scroll;
    if (!ev || typeof anyApi.addEvent !== 'function') return;
    const sub = anyApi.addEvent(ev, (p: { scrollX?: number; scrollY?: number }) => {
      scrollRef.current = {
        x: typeof p.scrollX === 'number' ? p.scrollX : 0,
        y: typeof p.scrollY === 'number' ? p.scrollY : 0,
      };
      scrollTickRef.current += 1;
    }) as { dispose?: () => void } | undefined;
    return () => sub?.dispose?.();
  }, [api]);

  useEffect(() => {
    if (!api) return;
    let raf = 0;
    let frame = 0;
    const tick = () => {
      frame = (frame + 1) % 4;
      if (frame === 0) recompute();
      raf = requestAnimationFrame(tick);
    };
    const recompute = () => {
      const host = hostRef.current ?? (document.querySelector('[data-testid="univer-host"]') as HTMLElement | null);
      if (!host) {
        if (rects.length) setRects([]);
        return;
      }
      // The main grid canvas — its viewport-relative position is the
      // reference frame `getCellRect()` returns coords in. Without the
      // canvas offset we'd anchor cursors at (0,0) of the document.
      const canvas = host.querySelector('canvas[id^="univer-sheet-main-canvas_"]') as HTMLCanvasElement | null;
      if (!canvas) {
        if (rects.length) setRects([]);
        return;
      }
      const hostRect = host.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      // Offset between the canvas's top-left and the host's top-left —
      // this is what we need to add to cell-local coords to land in
      // host-local coords (the portal's coordinate frame).
      const dx = canvasRect.left - hostRect.left;
      const dy = canvasRect.top - hostRect.top;

      const wb = api.getActiveWorkbook();
      if (!wb) {
        if (rects.length) setRects([]);
        return;
      }
      const activeSheet = wb.getActiveSheet();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const activeSheetId = (activeSheet as any)?.getSheetId?.() ?? (activeSheet as any)?.getId?.() ?? '';

      const next: Rect[] = [];
      for (const peer of peers) {
        const sel = peer.selection;
        if (!sel) continue;
        // Mismatched unit ids are normal — every browser gets a random
        // unitId on workbook creation. We render any peer whose sheet id
        // matches the local active sheet (sheet ids ARE deterministic).
        if (sel.s !== activeSheetId) continue;
        try {
          const ws = wb.getActiveSheet();
          if (!ws) continue;
          const tl = ws.getRange(sel.r.sr, sel.r.sc).getCellRect();
          const br = ws.getRange(sel.r.er, sel.r.ec).getCellRect();
          if (!tl || !br) continue;
          // `getCellRect` returns cell positions in the canvas's *content*
          // space — i.e. pre-scroll. Subtract the current scroll offset
          // to land in the visible-canvas frame, then add the canvas-vs-
          // host offset to translate into the portal's coord system.
          const sx = scrollRef.current.x;
          const sy = scrollRef.current.y;
          const left = Math.min(tl.left, br.left) - sx + dx;
          const top = Math.min(tl.top, br.top) - sy + dy;
          const right = Math.max(tl.right, br.right) - sx + dx;
          const bottom = Math.max(tl.bottom, br.bottom) - sy + dy;
          // Clip to the canvas area so cursors don't paint over headers
          // or float into the column-label gutter.
          if (right < dx || bottom < dy) continue;
          if (left > dx + canvasRect.width || top > dy + canvasRect.height) continue;
          next.push({
            clientId: peer.clientId,
            name: peer.name,
            color: peer.color,
            left,
            top,
            width: right - left,
            height: bottom - top,
          });
        } catch {
          /* getCellRect can throw mid-resize — drop this frame for that peer */
        }
      }

      // Cheap diff: only setState when the rect set actually changed,
      // so we don't churn React 15× per second.
      if (rectsEqual(next, rects)) return;
      setRects(next);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // peers + api are the inputs; rects are the output we're managing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, peers]);

  if (rects.length === 0) return null;
  const host = hostRef.current ?? (document.querySelector('[data-testid="univer-host"]') as HTMLElement | null);
  if (!host) return null;

  return createPortal(
    <div
      ref={layerRef}
      className="presence-layer"
      data-testid="presence-layer"
      aria-hidden="true"
    >
      {rects.map((r) => (
        <div
          key={r.clientId}
          className="presence-cursor"
          data-testid="presence-cursor"
          style={
            {
              left: `${r.left}px`,
              top: `${r.top}px`,
              width: `${r.width}px`,
              height: `${r.height}px`,
              ['--presence-color' as string]: r.color,
            } as React.CSSProperties
          }
        >
          <span className="presence-cursor__label">{r.name}</span>
        </div>
      ))}
    </div>,
    host,
  );
}

function rectsEqual(a: Rect[], b: Rect[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (
      x.clientId !== y.clientId ||
      x.left !== y.left ||
      x.top !== y.top ||
      x.width !== y.width ||
      x.height !== y.height ||
      x.name !== y.name ||
      x.color !== y.color
    ) {
      return false;
    }
  }
  return true;
}
