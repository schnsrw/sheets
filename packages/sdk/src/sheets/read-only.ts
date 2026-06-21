import { CustomCommandExecutionError, ICommandService, IPermissionService } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import { WorkbookEditablePermission } from '@univerjs/sheets';

/**
 * Command ids that MUTATE a sheet — opening the cell editor, writing values,
 * styling, structural edits, clipboard paste. The read-only veto cancels any
 * command whose id matches. Navigation (selection, scroll, zoom, sheet switch),
 * copy, and undo/redo deliberately fall through so preview stays usable.
 *
 * `set-cell-edit-visible` / `set-activate-cell-edit` are the editor-open
 * operations — blocking them is what actually stops keyboard typing, since the
 * cell editor never opens. The rest stop programmatic / paste / menu mutations.
 */
const READONLY_BLOCK =
  /(set-cell-edit-visible|set-activate-cell-edit|set-range-values|set-style|set-bold|set-italic|set-underline|set-strike|set-font|set-background|set-text|set-horizontal|set-vertical|set-wrap|set-rotation|set-border|set-number-format|insert-|delete-|remove-|clear-selection|cut-content|paste|move-range|move-rows|move-cols|merge|split|add-worksheet|set-worksheet-name|set-worksheet-row|set-worksheet-col|auto-fill|reorder|set-defined-name|set-tab-color|set-frozen-cancel)/;

/**
 * Make a workbook genuinely READ-ONLY.
 *
 * Two layers, because they cover different host setups:
 *
 *  1. **Command veto** (`beforeCommandExecuted` → throw
 *     `CustomCommandExecutionError`) — cancels every mutating command. This is
 *     the load-bearing layer for the iframe embed, whose minimal plugin set does
 *     NOT enforce `WorkbookEditablePermission` (verified: the editor still
 *     accepts edits with the permission flipped off).
 *  2. **Permission flip** (`WorkbookEditablePermission` → false) — on the full
 *     `<CasualSheets>` host path this also greys out mutating menu items and
 *     stops the editor opening; harmless where unenforced.
 *
 * Returns a disposer that removes the veto and restores the prior editable
 * state (for callers that toggle a live unit between preview/editor).
 */
export function applyReadOnly(
  univerApi: FUniver,
  unitId: string,
  onBlock?: (commandId: string) => void,
): () => void {
  const injector = (univerApi as unknown as { _injector?: { get(t: unknown): unknown } })._injector;

  // Layer 1: veto mutating commands — the only layer the minimal embed enforces.
  const cmd = injector?.get(ICommandService) as
    | { beforeCommandExecuted(l: (info: { id: string }) => void): { dispose(): void } }
    | undefined;
  const vetoDisposable = cmd?.beforeCommandExecuted((info) => {
    if (READONLY_BLOCK.test(info.id)) {
      onBlock?.(info.id);
      throw new CustomCommandExecutionError(`read-only: blocked ${info.id}`);
    }
  });

  // Layer 2: permission flip (best-effort; load-bearing only on full hosts).
  const svc = injector?.get(IPermissionService) as
    | {
        addPermissionPoint(p: unknown): boolean;
        updatePermissionPoint(id: string, value: unknown): void;
        getPermissionPoint(id: string): { value: unknown } | undefined;
      }
    | undefined;

  // Constructing the point yields the deterministic id Univer derives for the
  // workbook-edit permission; we don't keep the instance otherwise.
  const id = new WorkbookEditablePermission(unitId).id;
  let prev: unknown;
  if (svc) {
    try {
      const existing = svc.getPermissionPoint(id);
      if (existing) {
        prev = existing.value;
        svc.updatePermissionPoint(id, false);
      } else {
        const point = new WorkbookEditablePermission(unitId);
        point.value = false;
        svc.addPermissionPoint(point);
      }
    } catch {
      /* best-effort — the veto above is the load-bearing layer */
    }
  }

  return () => {
    vetoDisposable?.dispose();
    try {
      svc?.updatePermissionPoint(id, prev === undefined ? true : prev);
    } catch {
      /* swallow */
    }
  };
}

/**
 * Read the current `WorkbookEditablePermission` value for a unit — `true`
 * (editable), `false` (read-only), or `undefined` if the point isn't
 * registered yet. Lets hosts/tests confirm {@link applyReadOnly} took.
 */
export function getEditable(univerApi: FUniver, unitId: string): boolean | undefined {
  const injector = (univerApi as unknown as { _injector?: { get(t: unknown): unknown } })._injector;
  const svc = injector?.get(IPermissionService) as
    | { getPermissionPoint(id: string): { value: unknown } | undefined }
    | undefined;
  if (!svc) return undefined;
  const id = new WorkbookEditablePermission(unitId).id;
  const point = svc.getPermissionPoint(id);
  return point ? (point.value as boolean) : undefined;
}
