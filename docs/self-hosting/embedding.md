# Embedding (WOPI / Mode 2)

> Phase D of the storage-modes work (#49) — landed 2026-06-06.

How another product embeds Casual Sheets to edit its own workbooks.
The flow is plain WOPI: your host (any app that owns the file
bytes) mints a per-file JWT, your iframe / popup loads
`?access_token=…`, the editor authenticates against the URL token —
not the personal-mode cookie — and Save writes back through your
existing `HostIntegration` backend.

For the broader 3-mode picture see
[`docs/STORAGE_MODES.md`](../STORAGE_MODES.md).

---

## When to use this vs Mode 3 (personal docker)

| If you are…                                                                                               | Use                                                       |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Building a SaaS that owns the workbook lifecycle (Quip, Notion, SharePoint, Confluence-style integration) | **Mode 2 / WOPI embed** (this doc)                        |
| Running a homelab / small org docker and you want signups + per-user files                                | **[Mode 3 / Personal docker](./personal-mode.md)**        |
| Just trying it out                                                                                        | **Mode 1** — open the hosted demo at `sheet.schnsrw.live` |

The two modes happily share the same docker image. Set
`CASUAL_JWT_SECRET` (turns Mode 2 on) and `CASUAL_PERSONAL_MODE=multi`
(turns Mode 3 on) and operators have both surfaces — embedded
clients hit `/wopi/*` with JWTs, signed-in users hit `/files/*` with
cookies. The web client picks the right `FileSource` per request
from the URL.

---

## Server requirements

```
CASUAL_JWT_SECRET            ≥ 16 chars. Enables /api/tokens issuance + /wopi auth.
CASUAL_ADMIN_USERNAME        Used to mint the initial admin token over /api/admin/login.
CASUAL_ADMIN_PASSWORD        ↳
CASUAL_STORAGE               local / s3 / postgres — where the file bytes go.
```

When `CASUAL_JWT_SECRET` is **unset**, `/wopi/files/*` is
anonymous-by-URL (v0.0.x back-compat). Don't run that way in
production.

---

## End-to-end flow

```
                ┌──────────────────────┐
your host    →  │  POST /api/admin/login│ → admin JWT
(or operator)   └──────────────────────┘

                ┌─────────────────────────┐
your host    →  │  POST /wopi/files/:id   │ → upload the
                │      /contents          │   workbook bytes
                │  body: <.xlsx bytes>    │   into the host
                │  ?access_token=<admin>  │   integration
                └─────────────────────────┘

                ┌─────────────────────────┐
your host    →  │  POST /api/tokens       │ → per-file JWT
                │  { sub, file_id, role,  │   bound to :id +
                │    ttl_seconds, ... }   │   role (editor /
                └─────────────────────────┘   viewer / admin)

your user    →  GET  /?access_token=<that JWT>
                ↓
                Casual Sheets loads. The PersonalAuthGate is
                **skipped** (URL token wins over cookie auth).
                The web client's WopiFileSource calls:
                ┌─────────────────────────────────┐
                │ GET /wopi/files/:id              │ → CheckFileInfo
                │ GET /wopi/files/:id/contents     │ → workbook bytes
                │ POST /wopi/files/:id/contents    │ → Save (with
                │     X-WOPI-ItemVersion: <etag>   │   If-Match)
                └─────────────────────────────────┘
```

---

## Minting a token (operator-side)

The two-step admin-token + per-file-token shape matches what AWS and
GCP do — the long-lived admin credential mints short-lived per-action
tokens. No long-lived user-facing tokens.

```sh
# 1. Get an admin token (long-lived; minutes to hours).
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/api/admin/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"adminpassword"}' | jq -r .token)

# 2. Upload the workbook bytes that should be edited.
curl -X POST \
  "http://localhost:3000/wopi/files/proposal-q3.xlsx/contents?access_token=$ADMIN_TOKEN" \
  -H 'content-type: application/octet-stream' \
  --data-binary @./proposal-q3.xlsx

# 3. Mint a per-file token for one user.
USER_TOKEN=$(curl -s -X POST http://localhost:3000/api/tokens \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "sub": "joel@acme.example",
    "file_id": "proposal-q3.xlsx",
    "role": "editor",
    "ttl_seconds": 3600,
    "display_name": "Joel"
  }' | jq -r .token)

# 4. Build the URL your user opens.
echo "http://localhost:3000/?access_token=$USER_TOKEN"
```

Drop that URL into an iframe / popup / new tab on your side. The
editor authenticates from the URL token; your user never sees a
Casual Sheets login screen.

### Roles

| Role     | Permissions enforced server-side                                                 |
| -------- | -------------------------------------------------------------------------------- |
| `viewer` | `read` only. `Save` is hidden client-side; PUT returns 403 server-side.          |
| `editor` | `read` + `write`. The default for "let them edit."                               |
| `admin`  | `read` + `write` + `admin`. Can list every file via `/api/files`. Use sparingly. |

### Token lifetime

`ttl_seconds` on `/api/tokens` is what you pass. Common choices:

- **Short** (5–30 min) — re-mint on every page load; tight blast
  radius if leaked.
- **Medium** (1–4 hours) — typical interactive session.
- **Long** (24 hr+) — only for server-to-server / cron-style
  backfills. Avoid for user-facing.

The server returns `exp` in the response so you can compare.

---

## What the WopiFileSource does on the page

- Reads `access_token` from `window.location.search` on boot.
  Decodes the JWT payload (no verification — server checks the
  signature on every call) to grab the `file_id` claim.
- Calls `GET /wopi/files/:id` for `CheckFileInfo` — used to render
  the title and to show the file in the home screen's "Recent" strip
  as the single entry.
- `openRecent(id)` → `GET /wopi/files/:id/contents` — reads
  `X-WOPI-ItemVersion` as the etag and stores it in
  `WorkbookMeta.serverEtag`.
- `save(bytes, …)` → `POST /wopi/files/:id/contents` with the bytes
  - `X-WOPI-ItemVersion: <last-known-etag>`. The server compares;
    on mismatch returns 409 + `{error: version_mismatch, expected,
actual}` which the FileSource surfaces as `{kind: 'conflict'}` —
    the Save action turns that into a "this file was changed
    elsewhere" warning toast.

The cookie is **never** sent to `/wopi/*` (we send
`credentials: 'omit'`) so a logged-in personal-mode account can't
accidentally authenticate against an embed-only resource.

---

## Acceptance — what "embedding shipped" looks like

A fresh `docker run` with `CASUAL_JWT_SECRET` + an admin set
produces:

- [x] Admin can mint an access token bound to a file id via
      `/api/admin/login` → `/api/tokens`
- [x] Loading `/?access_token=<JWT>` skips the personal auth gate
      (verified in `tests/e2e/wopi/wopi-embed-flow.spec.ts`)
- [x] The workbook opens; the workbook context tracks the WOPI
      `X-WOPI-ItemVersion` as `serverEtag`
- [x] Ctrl+S triggers `POST /wopi/files/:id/contents` with the
      etag; the server bumps the version and the source updates the
      tracked etag for the next save
- [x] A second save with a stale etag returns 409
      `version_mismatch` and the client surfaces a conflict toast
      pointing at "reload and try again"

All verified locally on 2026-06-06; CI-level coverage tracked in #49
under the `e2e-wopi` job.
