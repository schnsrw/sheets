# File storage modes

How users open, save, and find their files across the three ways Casual Sheets is deployed.

This is the design contract. Implementation tracker:
**[#49](https://github.com/CasualOffice/sheets/issues/49)**.

Driven by feature request **[#48](https://github.com/CasualOffice/sheets/issues/48)**:
"save files to a container volume so when the user launches the app the last
file used is open" + "list the most recent files." Generalized to cover all
three deployment shapes so we don't paint ourselves into a corner.

---

## The three modes

| Mode               | Deploy                                        | Auth                                                        | Storage                                            | Who it's for                                                               |
| ------------------ | --------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| **1 — Pages**      | Static SPA (GitHub Pages, S3, CDN)            | None                                                        | Browser (IDB + optional File System Access folder) | Hosted demo. Quick try. Single device.                                     |
| **2 — WOPI**       | Docker + `CASUAL_STORAGE=local\|s3\|postgres` | JWT issued by embedding host                                | Server (`HostIntegration` backends)                | Team / org. Embedded in another app. Or driven by an external file system. |
| **3 — Standalone** | Docker + bind-mount `/data`                   | Username + password (account, server-issued session cookie) | Server (`local` backend by default)                | Personal use. "My files in my container." Joel's request.                  |

Modes 2 and 3 share the same server-side `HostIntegration` (already built:
`apps/server/src/host/integration.ts`). The auth model and the file-listing
surface are what differs.

---

## Shared web-side abstraction: `FileSource`

One interface, three implementations. The Office shell, recent-files list,
File menu, autosave, and version-history all consume this — none of them
branch on deploy mode.

```ts
// apps/web/src/file-source/types.ts (new module)

export interface FileSource {
  readonly kind: 'browser' | 'wopi' | 'personal';
  readonly label: string; // shown in UI ("This browser", "My files", "Acme Drive")

  list(opts?: { folderId?: string }): Promise<FileEntry[]>;
  open(id: string): Promise<{ bytes: ArrayBuffer; name: string; etag?: string }>;
  save(
    id: string | null,
    bytes: ArrayBuffer,
    opts?: { etag?: string; name?: string },
  ): Promise<{ id: string; etag: string }>;
  rename(id: string, newName: string): Promise<void>;
  delete(id: string): Promise<void>;

  // Hooks the recent-files store + landing screen use
  watchRecent(cb: (recent: FileEntry[]) => void): () => void;
  rememberLastOpened(id: string | null): Promise<void>;
  lastOpened(): Promise<string | null>;
}

export type FileEntry = {
  id: string;
  name: string;
  size: number;
  modifiedAt: number;
  source: FileSource['kind'];
  // Provenance — Mode 1 may carry a FSA file handle, Mode 2/3 may carry a path
  meta?: Record<string, unknown>;
};
```

`FileSource` is selected once at app boot from a small probe:

1. `__COLLAB_BUILD__` true + `GET /auth/me` returns 200 → `PersonalFileSource`
2. `__COLLAB_BUILD__` true + WOPI token in URL → `WopiFileSource`
3. Else → `BrowserFileSource` (Mode 1; also the fallback when offline)

The probe lives in `apps/web/src/file-source/select.ts`. Everything else just
imports `useFileSource()` from `apps/web/src/file-source/context.tsx`.

---

## Mode 1 — Pages (browser-only)

### What exists today

- `apps/web/src/recent-files/store.ts` — IDB, 10-slot LRU, 60-day TTL.
- `apps/web/src/autosave/` — single recovery slot per browser.
- `apps/web/src/version-history/` — per-workbook timeline in IDB.
- Landing screen with template gallery.

### What's new

1. **Recent-files strip on the landing screen** — top 5, big thumbnails, click
   to reopen. Empty state: "Open or drop a file to begin." Below the template
   gallery, not above it (templates are the "new doc" path).
2. **Auto-reopen banner** — if there's a last-opened entry less than 7 days
   old, show _"Reopen `report.xlsx`?"_ with Open / Dismiss above the landing.
3. **File System Access integration** (Chromium-only, progressive enhancement):
   - First Save with no folder pinned → prompts to pick a folder; remembers
     the handle in IDB.
   - Subsequent Save → writes directly to disk, no download dance.
   - Open dialog gains a "From my Sheets folder" section listing `*.xlsx`
     entries in the pinned folder.
   - Firefox / Safari: fall back to existing download blob + filesystem-
     picker for Open. The pinned-folder UI is conditionally rendered on
     `'showDirectoryPicker' in window`.

### UX flow — landing screen (Mode 1, returning user)

```
┌────────────────────────────────────────────────────────────────────┐
│  Casual Sheets                                            (theme)  │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  📄  Reopen `Q3-budget.xlsx`?                                      │
│       Last edited 2 hours ago                  [ Open ]  [ × ]    │
│                                                                    │
├──────── Recent files ─────────────────────────────────────────────┤
│                                                                    │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │         │  │         │  │         │  │         │  │         │ │
│  │ Q3-bud  │  │ invoice │  │ stocks  │  │ todos   │  │ travel  │ │
│  │  .xlsx  │  │  .xlsx  │  │  .xlsx  │  │  .xlsx  │  │  .xlsx  │ │
│  │ 2 h ago │  │ Mon     │  │ Apr 12  │  │ Mar 28  │  │ Mar 04  │ │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘ │
│                                                                    │
│  [ + New blank ]   [ + Open from disk ]   [ 📁 Pin a folder ]    │
│                                                                    │
├──────── Templates ────────────────────────────────────────────────┤
│  (existing template gallery — unchanged)                           │
└────────────────────────────────────────────────────────────────────┘
```

### UX flow — Save (Mode 1)

```
User hits Ctrl+S
   │
   ├─ Has pinned folder + file from that folder?
   │     ├─ yes → writeFile(handle) — no download. Toast: "Saved to disk."
   │     └─ no  → continue
   │
   ├─ Has pinned folder + new file?
   │     ├─ yes → write into pinned folder as <Untitled>.xlsx.
   │     │       Toast: "Saved to your Sheets folder."
   │     └─ no  → continue
   │
   └─ No folder pinned → existing download-blob flow.
         First time per session, toast offers:
         "Pin a folder to save here automatically." [Pin folder]
```

### Build notes

- File System Access API is Chromium-only. Wrap behind `if
('showDirectoryPicker' in window)`. Detected once at boot, exposed via
  the same `useFileSource()` hook (BrowserFileSource methods become no-ops
  on unsupported browsers).
- The pinned folder handle goes in IDB (`navigator.storage` survives across
  sessions). Requires re-authorising on each page load — show a one-tap
  "Reconnect folder" pill when the handle exists but lost permission.
- Recent files keep using `recordRecentFile()`; thumbnails are skipped in
  v1 (cell-grid screenshot is a separate workstream).

---

## Mode 3 — Standalone (personal docker, single account)

### Why this before Mode 2

Most self-hosters are one person on a NAS / homelab / VPS — not a team
embedding sheets in their own app. Mode 3 covers that path with the
least new code. Mode 2 (WOPI multi-user UI) builds on top.

### Server-side additions

- **Users table** in SQLite at `/data/users.db` (single-binary, no
  external DB dependency). `bcrypt` password hashes. `created_at`,
  `is_admin`. Driven by a new `apps/server/src/auth/personal.ts`.
- **Routes**:
  - `POST /auth/signup` — creates the first account, marks it admin.
    After the first account exists, signup is gated behind admin invite
    (single-tenant by default; multi-user opt-in via env).
  - `POST /auth/login` — issues an `HttpOnly; Secure; SameSite=Lax`
    session cookie. Session table in the same SQLite, 30-day rolling
    expiry.
  - `POST /auth/logout` — invalidates the session row.
  - `GET /auth/me` — returns `{ user_id, name, is_admin }` or 401.
- **File scoping** — every WOPI `file_id` is namespaced by `user_id`
  via a path prefix in the `local` host backend
  (`/data/workbooks/<user_id>/<file_id>.xlsx`). The `s3` backend uses
  the same prefix as a key. No code in the web app needs to know.
- **Listing route** — `GET /files` returns this user's files (the
  existing WOPI `GET /wopi/files` admin route stays admin-only, used
  by the admin panel).
- **`CASUAL_PERSONAL_MODE` env** — `none|single|multi`:
  - `none` — Mode 2 (WOPI / external host). Today's behaviour. Default.
  - `single` — only one account, signup disabled after the first.
  - `multi` — open signup (operator can disable via admin panel).

### Web-side additions

- **`PersonalFileSource`** implementing the interface above. List → `GET
/files`. Open → `GET /wopi/files/:id/contents`. Save → `POST
/wopi/files/:id/contents` (handles `If-Match` 412 with a conflict
  prompt).
- **Auth gate component** (`apps/web/src/auth/PersonalAuthGate.tsx`)
  wraps the app shell. Renders the signup/login UI when `GET /auth/me`
  returns 401.
- **Account menu** — top-right (where the theme toggle is). Avatar
  initial → menu: _My files · Account · Sign out_. "Account" opens a
  modal with username, password change, "delete account" (admin can't
  delete the last admin).

### UX flow — first launch (no accounts yet)

```
┌────────────────────────────────────────────────────────────────────┐
│                                                                    │
│                      🟢 Casual Sheets                              │
│                                                                    │
│              Welcome. Create your account to begin.                │
│                                                                    │
│              ┌────────────────────────────────────┐                │
│              │  Username                          │                │
│              │  [ joel                          ] │                │
│              │                                    │                │
│              │  Password                          │                │
│              │  [ ••••••••••                    ] │                │
│              │                                    │                │
│              │           [ Create account ]       │                │
│              └────────────────────────────────────┘                │
│                                                                    │
│           This account is the admin. Choose a strong               │
│           password — there is no email reset.                      │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### UX flow — landing (Mode 3, signed in)

```
┌────────────────────────────────────────────────────────────────────┐
│  Casual Sheets                              (theme)   ( J ▾ )      │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  📄  Reopen `Q3-budget.xlsx`?                                      │
│       Last edited 2 hours ago, in your files   [ Open ]  [ × ]    │
│                                                                    │
├──────── My files ─────────────────────────────  [ + Upload .xlsx ]┤
│                                                                    │
│  Name                          Size      Modified                  │
│  ─────────────────────────────────────────────────────────────    │
│  📄  Q3-budget.xlsx            41 KB     2 hours ago      ⋯       │
│  📄  invoice.xlsx              12 KB     Monday           ⋯       │
│  📄  stocks.xlsx              183 KB     Apr 12           ⋯       │
│  📄  travel-2026.xlsx           7 KB     Mar 04           ⋯       │
│                                                                    │
│  [ + New blank ]                                                   │
│                                                                    │
├──────── Templates ────────────────────────────────────────────────┤
│  (templates → "Use template" creates a new file in your account)   │
└────────────────────────────────────────────────────────────────────┘
```

The `⋯` opens an inline menu: _Rename · Download .xlsx · Duplicate · Delete_.

### UX flow — Save (Mode 3)

```
User hits Ctrl+S
   │
   ├─ File has server id → PutFile with If-Match: <etag>
   │     ├─ 200 OK   → toast "Saved" (debounced; first save in 5 s window)
   │     ├─ 412 conflict → modal:
   │     │     "This file was changed elsewhere. Discard your changes
   │     │      or save as a copy?"
   │     │      [ Discard and reload ]  [ Save as copy ]
   │     └─ 5xx     → toast "Couldn't save" + retry on next change
   │
   └─ No server id (new doc) → POST /files → toast "Saved as `<name>`"
```

Autosave continues to write to IDB as a local crash buffer; the server
copy is the source of truth.

### Account modal

```
┌─────────────────  Account  ───────────────────┐
│                                                │
│   Username:   joel                             │
│   Created:    2026-06-06                       │
│   Role:       admin                            │
│                                                │
│   ── Change password ──                        │
│   Current:    [ •••••••••• ]                   │
│   New:        [ •••••••••• ]                   │
│   Confirm:    [ •••••••••• ]                   │
│                          [ Update password ]   │
│                                                │
│   ── Storage ──                                │
│   12 files, 3.1 MB used                        │
│                                                │
│   ── Danger zone ──                            │
│   [ Delete my account ]   (disabled for the    │
│                            last admin)         │
└────────────────────────────────────────────────┘
```

---

## Mode 2 — WOPI (multi-user, embedded / external host)

### Stays mostly server-side

Mode 2 is the WOPI-driven shape we already have. The web app receives
a token in the URL (`?wopi_src=…&access_token=…`) issued by the
embedding host. The web app's `WopiFileSource`:

- Reads the token from the URL on boot.
- `list()` is unsupported — the embedding host owns navigation. Hides
  the "My files" sidebar; landing screen jumps straight to the editor
  with the token's file loaded.
- `open()` / `save()` use the existing WOPI routes with the token.

### What's new

- A tiny **`WopiFileSource`** implementation in
  `apps/web/src/file-source/wopi.ts`.
- A boot-time guard: when a WOPI token is present, skip the home screen
  and load the named file directly. On 412/conflict, the same modal as
  Mode 3.
- No new auth UI — the embedding host owns sign-in.

### When Mode 2 makes sense in-house (no embedding host)

For teams that just want shared files without writing an embedder, the
admin panel can mint JWTs from
**Admin → Files → Get share link**. That link works exactly like the
embedded WOPI URL — opens the editor with the file loaded. Effectively
a "share with anyone who has the link" mode without building a real
user system. (We already have JWT issuance in
`apps/server/src/wopi.ts`.)

---

## Phasing

Each phase is independently shippable.

### Phase A — Mode 1 polish _(landed: af48b32, 2026-06-06)_

- [x] Recent-files strip on the landing screen (already wired pre-A)
- [x] Auto-reopen banner
- [x] File System Access folder pinning (Chromium); FF/Safari keep
      today's download-blob path
- [x] Save-to-folder bypass for the download flow
- [x] e2e: reopen banner + FSA support-gating
- [ ] 50 MB IDB soft warning — follow-up, lands alongside Phase C

### Phase B — `FileSource` extraction _(landed: d885c3d, 2026-06-06)_

- [x] `FileSource` interface + `BrowserFileSource` impl
- [x] `useFileSource()` + `useRecentFiles()` hooks; provider mounted in App
- [x] `file-actions` Save routes through the source; HomeScreen recent
      open + delete routes through the source
- [x] Unit contract tests (`MockFileSource`, `SaveResult` discriminator
      pin)

### Phase C — Mode 3 standalone _(in progress)_

Decisions taken on 2026-06-06:

- **Password recovery: CLI only.** Documented `docker exec ...
casual-sheets reset-password <user>`. No SMTP plumbing in v1.
- **Multi-user admin visibility: none.** Per-user isolation total. An
  admin's role is config + room limits, not reading other users' files.
- **Upload size cap: reuse `MAX_UPLOAD_MB`** (default 25 MB). One knob
  across WS-seed and personal upload.

Implementation checklist:

- [ ] `better-sqlite3` + `bcrypt` deps; `users` + `sessions` tables
      at `/data/users.db`
- [ ] `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`,
      `GET /auth/me`. `HttpOnly; Secure; SameSite=Lax` cookies, 30-day
      rolling expiry.
- [ ] `CASUAL_PERSONAL_MODE` env (`none|single|multi`); admin-panel
      toggle.
- [ ] Per-user namespacing in `local` / `s3` / `postgres` host
      backends via path prefix.
- [ ] `GET /files` user-scoped listing route; `POST /files` upload;
      `DELETE /files/:id`. Tied into existing WOPI routes.
- [ ] `PersonalAuthGate` component (signup / login UI)
- [ ] `PersonalFileSource` (HTTP impl of the FileSource contract)
- [ ] Account modal (password change, sign out, delete account —
      blocked for the last admin)
- [ ] `casual-sheets reset-password <user>` CLI subcommand
- [ ] Migration: `CASUAL_BOOTSTRAP_USER` env on first launch creates
      the owner account and adopts any orphan files in
      `/data/workbooks/`
- [ ] Docs: `docs/self-hosting/personal-mode.md` + `ENV.md` updates

**e2e coverage (full flow tests).** Phase C ships with the user
journey verified end-to-end, not just unit-level. Specs:

- **personal-mode-happy-path.spec.ts** — first launch → signup as
  admin → land on "My files" (empty) → upload a real .xlsx → file
  shows in the list → click to open → edit → Save (toast: "Saved to
  …") → reload, file is still there with the edit → sign out →
  login → file still there
- **personal-mode-multi-user.spec.ts** — user A creates, user B
  signs up (multi mode), user B's My files list does not see user
  A's files; admin's My files list is identical to a regular user's
  (no cross-user visibility)
- **personal-mode-conflict.spec.ts** — two sessions on same file →
  one saves first → other gets 412 → conflict modal offers
  "Discard and reload" vs "Save as copy"
- **personal-mode-session.spec.ts** — expired cookie → app returns
  to login screen on next action; wrong password shows error
  toast; duplicate username rejected; `single` mode rejects second
  signup
- **personal-mode-cli-reset.spec.ts** — start the docker server
  with a seeded user; run `docker exec … reset-password`; login
  with the new password; old password rejected
- **personal-mode-migration.spec.ts** — pre-Phase-C `/data` volume
  with `workbooks/` and no `users.db` → set
  `CASUAL_BOOTSTRAP_USER=joel:p4ssword` → first launch creates the
  account and adopts the orphan files into Joel's listing

### Phase D — Mode 2 WOPI UI _(landed: 2026-06-06)_

- [x] `WopiFileSource` implementation
- [x] Boot-time URL token detection + direct-to-editor flow
- [x] Conflict toast on 409 / version_mismatch — shared shape with
      Mode 3's 412
- [x] In-place save with `X-WOPI-ItemVersion` / If-Match — also
      fixed the Mode 3 duplicate-files issue the close-out comment
      flagged
- [x] Docs: `docs/self-hosting/embedding.md` with the operator
      curl recipe + token issuance examples
- [ ] Admin → Files → "Get share link" UI — deferred. Operators
      mint via `POST /api/admin/login` → `POST /api/tokens` per
      the embedding doc; UI is a follow-up polish item with no
      user blocked on it.

**e2e coverage**: `tests/e2e/wopi/wopi-embed-flow.spec.ts` — admin
login + mint + seed + WopiFileSource open + Ctrl+S in-place PUT +
stale-etag 409 conflict. Runs via `playwright.wopi.config.ts`.

---

## Decisions log

All four originally-open questions were resolved on 2026-06-06, all
to the doc's recommended option. Captured here so the rationale doesn't
get lost between the issue thread and the code:

1. **Mode 3 password recovery: CLI only.** No SMTP plumbing in v1.
   `docker exec ... casual-sheets reset-password <user>` is documented
   in `docs/self-hosting/personal-mode.md`. Rationale: homelab/NAS
   users typically don't have an MTA; smaller env surface.
2. **Mode 3 multi-user admin visibility: none.** Per-user isolation
   total. Admin role is config + room limits, not file access.
3. **Mode 1 quota: soft warning at 50 MB.** `navigator.storage.estimate()`
   probe on home mount; banner above the reopen banner. Lands as a
   Phase A follow-up alongside Phase C.
4. **Mode 3 upload cap: reuse `MAX_UPLOAD_MB`** (default 25 MB). One
   knob across the existing WS-seed flow and personal upload. Operators
   can bump per deploy.

---

## Out of scope (for now)

- **Sharing files between users in Mode 3.** Personal storage = personal.
  Cross-user collab still uses the existing room-URL flow (anonymous,
  ephemeral). A real shared-drive UI is a separate workstream.
- **Folder tree in Mode 3.** Flat listing in v1. Folders only if users
  ask.
- **File versioning across the server.** Today's per-workbook
  version-history (IDB) is enough for local recovery; server-side
  version listing waits for a real ask.
- **OAuth providers in Mode 3.** Local username/password only. Google /
  GitHub / SSO go in a later phase when there's demand and an obvious
  identity backbone to plug into.
