import type { IWorkbookData } from '@univerjs/core';
import {
  CHARTS_RESOURCE_NAME,
  type ChartModel,
  type ChartsResourceV1,
  type ChartType,
} from './types';

/**
 * Round-trip helpers for the charts plugin resource. The resource lives on
 * `IWorkbookData.resources` and is carried through xlsx via the hidden
 * `__casual_sheets_resources__` sheet we already use for outline groups,
 * and through collab via Univer's snapshot-load path.
 */

const VALID_TYPES: ChartType[] = ['bar', 'line', 'pie', 'scatter'];

function isValidChart(c: unknown): c is ChartModel {
  if (!c || typeof c !== 'object') return false;
  const r = c as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.sheetId !== 'string') return false;
  if (!VALID_TYPES.includes(r.type as ChartType)) return false;
  const src = r.source as Record<string, unknown> | undefined;
  const pos = r.pos as Record<string, unknown> | undefined;
  if (!src || !pos) return false;
  for (const k of ['startRow', 'endRow', 'startColumn', 'endColumn'] as const) {
    if (typeof src[k] !== 'number' || typeof pos[k] !== 'number') return false;
  }
  return true;
}

/** Read chart models out of a snapshot. Tolerant of older / missing payloads. */
export function readChartsFromSnapshot(data: IWorkbookData | undefined): ChartModel[] {
  if (!data?.resources?.length) return [];
  const entry = data.resources.find((r) => r.name === CHARTS_RESOURCE_NAME);
  if (!entry?.data) return [];
  try {
    const parsed = JSON.parse(entry.data) as Partial<ChartsResourceV1>;
    if (parsed?.v !== 1 || !Array.isArray(parsed.charts)) return [];
    return parsed.charts.filter(isValidChart);
  } catch {
    /* corrupt payload — drop silently, the workbook still opens fine */
    return [];
  }
}

/** Merge chart models INTO `data.resources` for export. Mutates in place. */
export function writeChartsIntoSnapshot(
  data: IWorkbookData,
  charts: ChartModel[],
): void {
  const existing = data.resources ?? [];
  const filtered = existing.filter((r) => r.name !== CHARTS_RESOURCE_NAME);
  if (charts.length === 0) {
    data.resources = filtered;
    return;
  }
  const payload: ChartsResourceV1 = { v: 1, charts };
  data.resources = [...filtered, { name: CHARTS_RESOURCE_NAME, data: JSON.stringify(payload) }];
}
