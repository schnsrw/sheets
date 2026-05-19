import type { ChartModel } from './types';

/**
 * Excel auto-names charts as "Chart 1", "Chart 2", ..., picking the
 * lowest unused suffix even if intermediate charts have been deleted
 * (so deleting Chart 2 then inserting again gives you Chart 2, not
 * Chart 4). Match that.
 *
 * Operates on `ChartModel.title` — see the Chart Selection Pane for
 * inline rename.
 */
export function nextChartName(existing: ChartModel[]): string {
  const used = new Set<number>();
  for (const c of existing) {
    if (!c.title) continue;
    const m = /^Chart (\d+)$/.exec(c.title);
    if (m) used.add(Number(m[1]));
  }
  let n = 1;
  while (used.has(n)) n++;
  return `Chart ${n}`;
}
