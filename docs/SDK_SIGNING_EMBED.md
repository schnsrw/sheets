# SDK, signing, iframe embedding — sheet

How to embed Casual Sheet inside another app (Drive specifically;
3rd-party hosts more broadly) and how the document-signature
pipeline works inside it. Mirrors the document/ repo's
`docs/internal/13-iframe-protocol.md` + `14-sdk-delivery.md` —
**the protocol is uniform**, only the field anchor changes.

## TL;DR

Three orthogonal axes — pick by host:

| Host you control? | Same React tree? | Use                                                                             |
| ----------------- | ---------------- | ------------------------------------------------------------------------------- |
| yes, React        | yes              | **SDK** (`apps/web/src/embed` + `apps/web/src/signing` as integration surfaces) |
| yes, non-React    | no               | **Iframe** (`/embed` route via EmbedTransport)                                  |
| no (3rd party)    | no               | **Iframe + WOPI** (the existing WOPI handoff)                                   |

Drive picks SDK. WOPI stays for 3rd parties.

## What's in this repo today

The protocol surfaces live in `apps/web/src/`:

- **`signing/`** — document-signature pipeline. Mirror-of-mirror
  with the document/ repo (same TypeScript files, same wire
  shapes). Only the field anchor differs: sheet uses
  `{ kind: 'sheet', sheet: string, cell: string }`; document uses
  `{ kind: 'doc', paraId: string }`.
  - `controller.ts` — pure state machine (12 node:test cases).
  - `SigningProvider.tsx` + `useSigning()` — React context bridge.
  - `SigningPane.tsx` — floating right-anchored sidebar walking the
    signer through fields.
  - `captures.tsx` — three capture surfaces (Drawn / Typed / Uploaded).
  - `types.ts` — wire envelopes mirroring docs/internal/13-iframe-protocol.md.
- **`embed/`** — iframe delivery surface.
  - `EmbedTransport.ts` — postMessage bridge for the `/embed`
    iframe route. Validates origin, dispatches envelopes by `type`,
    supports request/response correlation by `id`.
  - `protocol.ts` — wire envelope types (`app: 'sheet'`).

Both modules are byte-equivalent across docs and sheet — the
files were copied. Future refactors should extract them into a
shared `@casual/protocol` package; for now duplicating
keeps each product shippable independently.

## Anchor — the sheet-specific bit

A signature field anchors to a cell range in a named sheet:

```ts
const field: SignatureField = {
  fieldId: 'accountant-sig',
  label: 'Accountant signature',
  required: true,
  anchor: { kind: 'sheet', sheet: 'Q3 P&L', cell: 'B47' },
  methods: ['drawn', 'typed'],
};
```

A drawn signature stamps as a floating image over the cell range.
A typed signature lands in the cell directly. Everything else
about the flow — banner, sequential mode, complete event,
cancel — is identical to docs.

## Drive integration sketch

When Drive integrates this repo as an SDK consumer:

```tsx
import { SigningProvider, SigningPane } from '@/signing';
import { EmbedTransport } from '@/embed';

// ...inside Drive's React surface, around the Univer mount...
<SigningProvider session={signingSession} documentBytes={currentBytes}>
  <YourSheetMount />
  <SigningPane banner="Signing as Alice for Acme Co." />
</SigningProvider>;
```

For the iframe path, Drive opens
`https://sheet.example/embed?app=sheet&config=<base64url-JSON>`
and uses postMessage to drive `casual.signature.request` /
`signature.field.signed` / `signature.complete` envelopes —
same envelope shapes as docs, only `app: 'sheet'` and the
anchor shape change.

## What's NOT in this batch (deferred)

- **Stamping into the `.xlsx`** — v1 the editor returns the
  signature material via `onFieldSigned` / the iframe
  `signature.field.signed` envelope; Drive's Rust side owns
  stamping the bytes into the workbook. v2 lands client-side
  stamping (cell formula / image insertion) once we decide
  whether to expand the cell or float the signature image.
- **Univer-side signing UI** — the SigningPane is a generic
  floating sidebar. It overlays Univer's surface; it doesn't
  paint into Univer's canvas. A future pass could decorate the
  anchored cell with a signature affordance (similar to data
  validation indicators), but that's editor-surface work, not
  protocol work.
- **`/embed` route** — `apps/web/src/main.tsx` doesn't yet
  branch on `/embed` to mount a stripped-down sheet configured
  from EmbedConfig. The EmbedTransport class is ready; the
  router branch is the missing piece.

## Implementation status

- ✅ Signing module copied + node:test cases pass.
- ✅ EmbedTransport copied + node:test cases pass (sheet flavour).
- ✅ Types uniform with docs.
- ⬜ `/embed` Vite route + EmbedConfig parser.
- ⬜ Drive integration in `drive/`.

## Why this doc exists

So the next person reading the sheet repo sees the signing +
embed surfaces are intentional mirrors of the document repo's,
not copy-paste drift. The `controller.ts` and `EmbedTransport.ts`
files are protocol-level; product changes go through the doc in
`document/docs/internal/13-iframe-protocol.md` first, then land in
both repos.
