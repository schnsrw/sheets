# Embed playground

A minimal **host page** that frames the Casual Sheets SDK's in-iframe
runtime and drives the full `<iframe>` postMessage path end-to-end:

- frames the SDK's built `embed.html`,
- serves a `.xlsx` to the iframe on `load.request` (a picked file, or the
  bundled sample),
- receives the workbook snapshot back on save / exit and persists it to
  `localStorage`,
- dispatches host-rendered toolbar commands (Bold / Undo / Redo) and a
  view-mode toggle (editor ↔ preview) into the iframe.

It's the smallest faithful example of how a host (Casual Drive, a WOPI
host, your own app) consumes the editor via `@casualoffice/sheets/embed`
— no React, no bundler, just `EmbedHostTransport` + an `<iframe>`.

```
examples/embed-playground/
  index.html      host page: iframe + toolbar + event log (+ importmap)
  main.ts         host logic: EmbedHostTransport wiring (compiles → main.js)
  sample/         a tiny bundled .xlsx the host serves by default
  embed/sheets/   the SDK runtime, copied in at setup (gitignored)
  tests/e2e/      Playwright round-trip spec
  playwright.embed.config.ts
  tsconfig.json
```

## How it works

```
 host page (index.html + main.js)            iframe (SDK runtime)
 ┌───────────────────────────────┐           ┌──────────────────────────┐
 │ EmbedHostTransport            │  hello →  │ EmbedTransport           │
 │  onLoadRequest  ──── bytes ──────────────▶│  parses xlsx → mounts    │
 │  onSaveNotify   ◀── snapshot ─────────────│  CasualSheets (Univer)   │
 │  onExit         ◀── snapshot ─────────────│                          │
 │  sendCommandExecute(bold) ───────────────▶│  runs the Univer command │
 │  sendSetViewMode(preview) ───────────────▶│  toggles chrome density  │
 └───────────────────────────────┘           └──────────────────────────┘
```

The editor never owns storage — it hands the host a snapshot
(Univer `IWorkbookData` JSON) and the host decides what to do. Here that's
`localStorage`; a real host PUTs to WOPI / Drive / etc.

`main.ts` imports the host transport with the exact public specifier:

```ts
import { EmbedHostTransport } from '@casualoffice/sheets/embed';
```

There's no bundler. The browser resolves that bare specifier via an
**importmap** in `index.html` pointing at the SDK's built ESM, which is
self-contained (no React / Univer at runtime — it's pure protocol code).

## Run it

From the repo root:

```bash
# 1. Build the SDK — emits the self-contained iframe runtime to
#    packages/sdk/dist/embed/ and the host transport to packages/sdk/dist/embed.js
pnpm --filter @casualoffice/sheets build

# 2. Copy the runtime + host transport into this example (gitignored — it's
#    multi-MB build output, not source).
cd examples/embed-playground
cp ../../packages/sdk/dist/embed/{embed-runtime.js,embed.html,parser.worker.js,exporter.worker.js} embed/sheets/
cp ../../packages/sdk/dist/embed.js embed/sheets/host.js

# 3. Compile the host script (main.ts → main.js). Any TS step works; tsc is
#    enough since there's nothing to bundle.
npx tsc

# 4. Serve this directory and open it. `serve` sets correct ES-module MIME
#    types and serves the dir flat.
npx serve .
# → open the printed URL (e.g. http://localhost:3000)
```

Pick an `.xlsx`, watch it mount in the iframe, hit **Save**, and the event
log shows the snapshot coming back to the host. With nothing picked it
serves the bundled `sample/sample.xlsx`.

> The iframe's `<iframe src>` points at `./embed/sheets/embed.html?app=sheet&docId=…&viewMode=editor`.
> Keep the copied files under `embed/sheets/` so that path resolves.

## Test it

```bash
# from examples/embed-playground/ (after steps 1–3 above)
npx playwright test -c playwright.embed.config.ts
```

The spec serves this dir, waits for the iframe editor to boot + render a
sized grid canvas, clicks Save, and asserts the host received an
`IWorkbookData` snapshot back over postMessage.

## Notes

- **Self-contained runtime.** `embed-runtime.js` bundles React + Univer
  (~12 MB, cached after first load) so the iframe has no import map to
  satisfy. The host's `embed.js` is the opposite — tiny, dependency-free.
- **Same-origin.** Host and iframe are served from one origin here, so
  `embedOrigin` is just `window.location.origin`. A cross-origin host
  passes the iframe's real origin instead.
- **Locale.** The runtime bundles a minimal en-US string set; without it
  Univer's `LocaleService` fails to init and the grid renders blank even
  though data loads. (Fixed in the runtime — see `src/embed-runtime/locale.ts`.)
