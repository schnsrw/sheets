# Material Symbols icon-font subset

Icons in the sheets app are **font ligatures** — `apps/web/src/shell/Icon.tsx`
renders the icon name (e.g. `bar_chart`) as text in the Material Symbols
Outlined variable font, and the font's ligature table substitutes the whole
name with one glyph.

The full variable font is **~3.8 MB woff2**. The app uses ~150 distinct icons.
`material-symbols-outlined.subset.woff2` (in `apps/web/public/fonts/`) is a
subset down to **~93 KB** that contains only those ligatures, with all four
variable axes (`FILL` / `GRAD` / `opsz` / `wght`) retained so filled and
weighted icons still shape correctly.

The subset is loaded for the **desktop (Tauri) build only**, by the `@font-face`
block in `apps/web/src/desk-bridge-bootstrap.ts`. The web build keeps using the
Google Fonts CDN (`apps/web/index.html`).

## Regenerate

Run from the repo root, pointing `--master` at any full Material Symbols
Outlined variable woff2 (e.g. the one bundled in the desktop shell, or a fresh
download from Google Fonts):

```sh
python3 scripts/fonts/subset-material-symbols.py \
  --master /path/to/material-symbols-outlined.woff2 \
  --out apps/web/public/fonts/material-symbols-outlined.subset.woff2
```

The script:

1. collects every icon name used across `apps/web/src` (static `<Icon name="x">`
   literals, `icon: 'x'` config keys, ternary strings inside
   `<Icon name={...}>`, and the `NAME_REMAP` targets in `Icon.tsx`);
2. shapes each through the master font with HarfBuzz and **drops any candidate
   that does not collapse to a single glyph** (those are false positives such as
   a radio `name="orientation"`, not real icons);
3. subsets by the resolved glyph ids + the component letter glyphs with
   `--no-layout-closure` (a plain `--text` subset keeps the entire ~6000-icon
   ligature set, because every icon's input characters are present);
4. **re-verifies coverage** on the produced subset — every collected name must
   still shape to exactly one glyph, or the script exits non-zero and writes
   nothing.

`icon-names.json` is the regenerated manifest of the icon names the subset
covers (an audit artifact).

Requires `fonttools` and `uharfbuzz` (`pip install fonttools uharfbuzz`) and
`pyftsubset` on `PATH`.

## License

Material Symbols is licensed under the Apache License 2.0 — compatible with this
project. The subset is a mechanical reduction of the upstream font and carries
the same license.
