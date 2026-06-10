---
'@schnsrw/casual-sheets': minor
---

Ship the SDK iframe-delivery architecture for sheets (Phase 2 of doc 16
in the parent docx repo). Mirror of `@schnsrw/docx-js-editor@1.1.0`.

The existing `<CasualSheets>` direct-mount stays — no breaking change.
Adds a new `<CasualSheetsIframe>` component that renders the editor
inside a same-origin iframe. CSS isolation (Univer's design tokens
stop bleeding into the host's tree), React-runtime isolation, and the
Univer-vs-host font-cascade problems all go away when consumers
switch from direct-mount to iframe.

### What the consumer-facing API looks like

```tsx
import { CasualSheetsIframe } from '@schnsrw/casual-sheets';

<CasualSheetsIframe
  fileSource={{
    open: async (id) => ({ bytes, name, etag }), // host's bytes shim
  }}
  docId={file.id}
  viewMode="preview"             // or "editor"
  embedBasePath="/embed/sheets"   // defaults to /embed/sheets
  onSelectionChanged={…}
  onError={…}
/>;
```

No iframe, no postMessage, no `EmbedTransport` wiring in the consumer.
Bytes flow host → iframe via `casual.load.request` envelopes; inside
the iframe the runtime parses xlsx → `IWorkbookData` via the SDK's
own `xlsxToWorkbookData` (Phase A of #56) and mounts `<CasualSheets>`
with the snapshot.

### Build artifacts

Two new files in `dist/embed/`:

- `embed-runtime.js` (132 KB self-contained ESM) — mounts the editor
  inside the iframe; loads xlsx bytes via the wire, converts, renders.
- `embed.html` — the 1 KB static HTML document the iframe loads.

Consumers copy these into their public dir at `embedBasePath` (default
`/embed/sheets`). A Vite plugin that does the copy ships in v0.5.x;
for v0.5.0 the contract is a two-line postinstall:

```sh
mkdir -p web/public/embed/sheets
cp node_modules/@schnsrw/casual-sheets/dist/embed/* web/public/embed/sheets/
```

### Wire protocol additions

- `casual.command.set.viewmode` — live preview ↔ editor toggle.
- `casual.error` — editor → host fatal-error signal.

Both mirror the docx repo's `13-iframe-protocol.md` extension.

### What's not in this minor

- The full ref API (`flushSave`, `getSelection`, signing through iframe)
  — ships in v0.5.x once Drive proves the wire end-to-end.
- The Vite plugin — v0.5.x.
- Preview-mode chrome hiding inside the iframe — currently surfaced
  via `data-view-mode` attribute on the embed root + CSS gates in
  embed.html; v0.5.x wires the attribute to component-level `ui` props.
- xlsx export from the iframe — Phase B of #56 still pending.
