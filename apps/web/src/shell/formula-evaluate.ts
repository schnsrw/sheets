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

/**
 * Pure stepping logic for the Evaluate Formula dialog (Excel's Formulas →
 * Evaluate Formula). It walks a formula one sub-expression at a time:
 * the innermost-leftmost parenthesised group / function call is found,
 * the dialog evaluates it (via the formula engine's `executeFormulas`),
 * and its value is substituted back in. When no parentheses remain, the
 * whole remaining expression is the final step.
 *
 * Kept Univer-free so the stepping + value formatting are exhaustively
 * unit-testable with a mock evaluator; the dialog supplies the real async
 * evaluator. String literals (with Excel's `""` escaping) are respected so
 * parens/quotes inside text aren't mistaken for structure.
 */

export interface FormulaStep {
  /** The sub-expression to evaluate next (e.g. `SUM(A1:A2)` or `(1+2)`). */
  sub: string;
  /** Start/end indices of `sub` within the expression (end exclusive). */
  start: number;
  end: number;
}

const IDENT = /[A-Za-z0-9_.]/;

/**
 * Find the innermost-leftmost group to evaluate next. Forward-scan keeping a
 * stack of `(` positions; the first `)` closes the current innermost group.
 * If an identifier directly precedes the `(`, it's a function call and the
 * step covers the whole call; otherwise it's a bare grouping paren. Returns
 * null when no parentheses remain (the caller evaluates the whole rest).
 */
export function nextStep(expr: string): FormulaStep | null {
  const stack: number[] = [];
  let inString = false;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (inString) {
      if (c === '"') {
        if (expr[i + 1] === '"') {
          i++; // escaped quote — skip the pair
          continue;
        }
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '(') {
      stack.push(i);
      continue;
    }
    if (c === ')') {
      const open = stack.pop();
      if (open == null) continue; // unbalanced — let the engine surface it
      // Walk back over a function-name identifier preceding `(`.
      let nameStart = open;
      while (nameStart > 0 && IDENT.test(expr[nameStart - 1])) nameStart--;
      const isCall = nameStart < open;
      const start = isCall ? nameStart : open;
      return { sub: expr.slice(start, i + 1), start, end: i + 1 };
    }
  }
  return null;
}

/** Format an engine value for substitution back into the expression. */
export function formatValue(v: unknown): string {
  if (v == null) return '0'; // empty resolves to 0 in arithmetic
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '#NUM!';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  const s = String(v);
  // Excel error literals propagate as-is; other text is quoted ("" escaped).
  if (/^#[A-Z0-9/?!]+$/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Replace `[start,end)` of `expr` with `valueStr`. */
export function substitute(expr: string, start: number, end: number, valueStr: string): string {
  return expr.slice(0, start) + valueStr + expr.slice(end);
}

/** Strip a single leading `=` (and surrounding space) from a cell formula. */
export function stripEquals(formula: string): string {
  return formula.replace(/^\s*=/, '').trim();
}
