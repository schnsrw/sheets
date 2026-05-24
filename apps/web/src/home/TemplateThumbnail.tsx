import type { PreviewCell, Template } from './registry';

/**
 * Stylised mini-grid used as the thumbnail on each template card. Hand-
 * tuned previews from `registry.ts` drive the cells; the accent strip
 * plus column header band mirror what the actual template's first sheet
 * shows when opened. No xlsx parsing happens until the user picks a
 * template — the preview is plain DOM, GPU-cheap, and reads cleanly at
 * card size (~280×180).
 */
export function TemplateThumbnail({ template }: { template: Template }) {
  const { preview, accent } = template;
  const cols = Math.max(preview.header.length, ...preview.rows.map((r) => r.length));

  return (
    <div
      className="tpl-thumb"
      role="img"
      aria-label={`${template.name} preview`}
      style={{ ['--tpl-accent' as string]: accent }}
    >
      {/* Sheet-tab strip at top — establishes "this is a spreadsheet". */}
      <div className="tpl-thumb__strip" />
      <div className="tpl-thumb__grid" data-cols={cols}>
        {/* Column header band */}
        <div className="tpl-thumb__row tpl-thumb__row--head">
          {preview.header.slice(0, cols).map((h, i) => (
            <span key={i} className="tpl-thumb__cell tpl-thumb__cell--head">
              {h}
            </span>
          ))}
        </div>
        {preview.rows.map((row, ri) => (
          <div key={ri} className="tpl-thumb__row" data-zebra={ri % 2 === 1 ? '1' : '0'}>
            {Array.from({ length: cols }).map((_, ci) => {
              const cell = row[ci];
              return <CellView key={ci} cell={cell ?? ''} />;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function CellView({ cell }: { cell: PreviewCell }) {
  if (typeof cell === 'string') {
    return <span className="tpl-thumb__cell">{cell}</span>;
  }
  const { v, fmt, color } = cell;
  const cls = ['tpl-thumb__cell'];
  if (fmt === 'currency' || fmt === 'percent') cls.push('tpl-thumb__cell--num');
  if (fmt === 'date') cls.push('tpl-thumb__cell--date');
  if (fmt === 'muted') cls.push('tpl-thumb__cell--muted');
  if (fmt === 'bold') cls.push('tpl-thumb__cell--bold');
  if (fmt === 'badge') {
    return (
      <span className="tpl-thumb__cell">
        <span className="tpl-thumb__badge" style={color ? { color, borderColor: color } : undefined}>
          {v}
        </span>
      </span>
    );
  }
  return (
    <span className={cls.join(' ')} style={color ? { color } : undefined}>
      {v}
    </span>
  );
}
