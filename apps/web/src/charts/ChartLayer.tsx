import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUniverAPI } from '../use-univer';
import { useCharts } from './charts-context';
import { ChartOverlay } from './ChartOverlay';

/**
 * Renders every chart in the store. Same anchoring strategy as
 * PresenceLayer:
 *
 *   - Find the univer-host + main grid canvas.
 *   - Translate the chart's cell-coordinate pos into a host-local
 *     CSS box: `getCellRect(corner)` gives canvas-local pre-scroll
 *     coords; subtract `scrollX/scrollY` (tracked via Univer's
 *     Scroll event), add the canvas-vs-host offset.
 *   - Only render charts whose sheet matches the active sheet
 *     (Excel hides charts on inactive sheets).
 *   - Rerun the math every animation frame so the chart sticks
 *     to its cell anchor through scroll + resize + zoom.
 *
 * Mounts into the univer-host via a portal so the overlay paints
 * on top of the canvas at the same z-stack as PresenceLayer.
 */
type RenderedChart = {
  id: string;
  rect: { left: number; top: number; width: number; height: number };
};

export function ChartLayer() {
  const api = useUniverAPI();
  const { charts } = useCharts();
  const [rendered, setRendered] = useState<RenderedChart[]>([]);
  // rAF callback closes over `rendered` from when the effect ran. The effect
  // re-runs only on [api, charts] changes, so a sheet-switch (which leaves
  // both inputs untouched) would compare new computed rects against the
  // stale closure copy — `rectsEqual` could return true while React state
  // still holds the previous overlays. Mirror state into a ref so the
  // diff always sees the live value.
  const renderedRef = useRef<RenderedChart[]>(rendered);
  renderedRef.current = rendered;
  const hostRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef({ x: 0, y: 0 });
  const scrollTickRef = useRef(0);

  useEffect(() => {
    hostRef.current = document.querySelector('[data-testid="univer-host"]') as HTMLElement | null;
  }, []);

  // The chart's screen position is the cell's canvas-local rect minus
  // the viewport scroll offset. `Event.Scroll` would be the natural
  // hook, but it doesn't fire on programmatic scrolls (scrollToCell)
  // and the registration timing is fragile against lifecycle stages.
  // `getScrollState()` is the authoritative read — poll it every
  // animation frame and diff. Cheap (a few number reads) and correct.

  useEffect(() => {
    if (!api) return;
    let raf = 0;
    let lastScrollTick = scrollTickRef.current;
    let lastScrollAtFrame = -1000;
    let frame = 0;

    const recompute = () => {
      const host =
        hostRef.current ?? (document.querySelector('[data-testid="univer-host"]') as HTMLElement | null);
      if (!host) {
        if (renderedRef.current.length) setRendered([]);
        return;
      }
      const canvas = host.querySelector('canvas[id^="univer-sheet-main-canvas_"]') as HTMLCanvasElement | null;
      if (!canvas) {
        if (renderedRef.current.length) setRendered([]);
        return;
      }
      const hostRect = host.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const dx = canvasRect.left - hostRect.left;
      const dy = canvasRect.top - hostRect.top;

      const wb = api.getActiveWorkbook();
      if (!wb) {
        if (renderedRef.current.length) setRendered([]);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const activeSheet = wb.getActiveSheet() as any;
      const activeSheetId = activeSheet?.getSheetId?.();

      // Read viewport scroll directly from the worksheet — each frame
      // is cheap (a handful of property reads) and dodges Univer's
      // flaky `Event.Scroll` dispatch (doesn't fire on `scrollToCell`,
      // and the listener registration races the render lifecycle).
      // Cell rects come back canvas-local + pre-scroll; we convert by
      // asking for the rect of the cell currently at viewport top-left
      // — that rect's `top/left` IS the scroll offset to subtract.
      let sx = 0;
      let sy = 0;
      const scrollState = activeSheet?.getScrollState?.() as
        | { sheetViewStartRow?: number; sheetViewStartColumn?: number; offsetX?: number; offsetY?: number }
        | undefined;
      if (scrollState) {
        try {
          const r = scrollState.sheetViewStartRow ?? 0;
          const c = scrollState.sheetViewStartColumn ?? 0;
          const topLeft = activeSheet.getRange(r, c).getCellRect();
          if (topLeft) {
            sx = topLeft.left + (scrollState.offsetX ?? 0);
            sy = topLeft.top + (scrollState.offsetY ?? 0);
          }
        } catch {
          /* skeleton not ready — leave scroll at 0 this frame */
        }
      }
      if (sx !== scrollRef.current.x || sy !== scrollRef.current.y) {
        scrollRef.current = { x: sx, y: sy };
        scrollTickRef.current += 1;
      }

      const out: RenderedChart[] = [];
      for (const c of charts) {
        if (c.sheetId !== activeSheetId) continue;
        try {
          const tl = activeSheet.getRange(c.pos.startRow, c.pos.startColumn).getCellRect();
          const br = activeSheet.getRange(c.pos.endRow, c.pos.endColumn).getCellRect();
          if (!tl || !br) continue;
          const left = Math.min(tl.left, br.left) - sx + dx;
          const top = Math.min(tl.top, br.top) - sy + dy;
          const right = Math.max(tl.right, br.right) - sx + dx;
          const bottom = Math.max(tl.bottom, br.bottom) - sy + dy;
          // Clip — charts mostly off-canvas don't render (saves
          // ECharts a redraw); partially off is fine because the
          // overlay overflow:hidden on the layer below clips it.
          if (right < dx || bottom < dy) continue;
          if (left > dx + canvasRect.width || top > dy + canvasRect.height) continue;
          out.push({
            id: c.id,
            rect: { left, top, width: right - left, height: bottom - top },
          });
        } catch {
          /* getCellRect can throw mid-resize — drop this frame */
        }
      }
      if (rectsEqual(out, renderedRef.current)) return;
      setRendered(out);
    };

    const tick = () => {
      const tickNow = ++frame;
      const scrollChanged = scrollTickRef.current !== lastScrollTick;
      if (scrollChanged) {
        lastScrollTick = scrollTickRef.current;
        lastScrollAtFrame = tickNow;
      }
      const inScrollTail = tickNow - lastScrollAtFrame < 20;
      if (inScrollTail || tickNow % 4 === 0) recompute();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // charts + api are the inputs; rendered is the output.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, charts]);

  if (rendered.length === 0) return null;
  const host =
    hostRef.current ?? (document.querySelector('[data-testid="univer-host"]') as HTMLElement | null);
  if (!host) return null;

  return createPortal(
    <div
      className="chart-layer"
      data-testid="chart-layer"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}
    >
      {rendered.map((r) => {
        const model = charts.find((c) => c.id === r.id);
        if (!model) return null;
        return (
          <div
            key={r.id}
            // Re-enable pointer events on the chart itself so tooltips
            // work; layer stays click-through above the canvas.
            style={{ pointerEvents: 'auto', position: 'absolute', inset: 0 }}
          >
            <ChartOverlay model={model} rect={r.rect} />
          </div>
        );
      })}
    </div>,
    host,
  );
}

function rectsEqual(a: RenderedChart[], b: RenderedChart[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id) return false;
    if (
      x.rect.left !== y.rect.left ||
      x.rect.top !== y.rect.top ||
      x.rect.width !== y.rect.width ||
      x.rect.height !== y.rect.height
    ) {
      return false;
    }
  }
  return true;
}
