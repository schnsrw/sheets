/**
 * Copyright 2026 Casual Office
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useMemo, useState } from 'react';
import type { FUniver } from '@univerjs/core/facade';
import { Dialog } from './Dialog';
import { formatValue, nextStep, stripEquals, substitute } from './formula-evaluate';

/**
 * Evaluate Formula (Excel's Formulas → Evaluate Formula). Steps through the
 * active cell's formula one sub-expression at a time — the innermost group is
 * underlined, "Evaluate" computes it (via the engine's `executeFormulas`, which
 * calculates off-cell without touching the sheet) and substitutes the value,
 * until a single result remains. The stepping is pure (`formula-evaluate.ts`);
 * this wires the active cell + the async evaluator.
 */

type Props = {
  api: FUniver;
  onClose: () => void;
};

export function EvaluateFormulaDialog({ api, onClose }: Props) {
  const wb = api.getActiveWorkbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ws = wb?.getActiveSheet() as any;
  const range = ws?.getActiveRange?.();

  const meta = useMemo(() => {
    const rawFormula: string = range?.getFormula?.() ?? '';
    return {
      rawFormula,
      hasFormula: typeof rawFormula === 'string' && rawFormula.trim().startsWith('='),
      row: range?.getRow?.() ?? 0,
      col: range?.getColumn?.() ?? 0,
      wbId: wb?.getId?.() ?? '',
      sheetId: ws?.getSheetId?.() ?? '',
    };
    // range identity is stable for the dialog's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [expr, setExpr] = useState(() => stripEquals(meta.rawFormula));
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = done ? null : nextStep(expr);

  // Evaluate the next sub-expression (or the whole remaining expression) via
  // the formula engine. `executeFormulas` computes the string against the live
  // sheet and returns the value without committing anything to the cell.
  const evaluate = async (sub: string): Promise<unknown> => {
    const f = api.getFormula();
    const formulas = {
      [meta.wbId]: { [meta.sheetId]: { [meta.row]: { [meta.col]: [`=${sub}`] } } },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = (await (f as any).executeFormulas(formulas, 8000)) as any;
    return res?.[meta.wbId]?.[meta.sheetId]?.[meta.row]?.[meta.col]?.[0]?.value;
  };

  const onEvaluate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (step) {
        const v = await evaluate(step.sub);
        setExpr(substitute(expr, step.start, step.end, formatValue(v)));
      } else {
        const v = await evaluate(expr);
        setExpr(formatValue(v));
        setDone(true);
      }
    } catch {
      setError('Could not evaluate this step.');
    } finally {
      setBusy(false);
    }
  };

  const onRestart = () => {
    setExpr(stripEquals(meta.rawFormula));
    setDone(false);
    setError(null);
  };

  // Render the expression with the next step underlined.
  const rendered = step ? (
    <>
      {expr.slice(0, step.start)}
      <u style={{ textDecorationColor: 'var(--color-accent, #107c41)' }}>
        {expr.slice(step.start, step.end)}
      </u>
      {expr.slice(step.end)}
    </>
  ) : (
    expr
  );

  return (
    <Dialog
      title="Evaluate Formula"
      onClose={onClose}
      data-testid="evaluate-formula-dialog"
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            data-testid="evaluate-formula-restart"
            onClick={onRestart}
            disabled={!meta.hasFormula || busy}
          >
            Restart
          </button>
          <button
            type="button"
            className="btn-primary"
            data-testid="evaluate-formula-evaluate"
            onClick={onEvaluate}
            disabled={!meta.hasFormula || done || busy}
          >
            {busy ? 'Evaluating…' : 'Evaluate'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            data-testid="evaluate-formula-close"
            onClick={onClose}
          >
            Close
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 360 }}>
        {!meta.hasFormula ? (
          <div data-testid="evaluate-formula-empty" style={{ fontSize: 13 }}>
            The active cell doesn&rsquo;t contain a formula.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
              {done
                ? 'Result:'
                : 'Click Evaluate to compute the underlined expression. Repeat to step through.'}
            </div>
            <div
              data-testid="evaluate-formula-expr"
              style={{
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                fontSize: 13,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                padding: 'var(--space-3)',
                border: '1px solid var(--color-divider)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-surface-alt)',
                minHeight: 24,
              }}
            >
              {rendered}
            </div>
            {error && (
              <div
                data-testid="evaluate-formula-error"
                style={{ color: 'var(--color-danger, #c4321a)', fontSize: 12 }}
              >
                {error}
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
