# Casual Sheets — Release plan for v0.1.0

The first version-bumped release. v0.0.x has been the "build a real
editor end-to-end" arc; v0.1.0 is **the first release that earns its
self-host story**: real persistence (WOPI host contract over 3
storage backends), a customisation surface (admin panel for branding
+ storage + limits), audited Docker build (proper labels + env-var
docs + semver tag scheme), and the last open xlsx round-trip gap
(complex pivot cache passthrough).

v1.0.0 is **not** this release. v1.0.0 means semver-bound API
stability; the WOPI host contract and the admin-panel config schema
are net-new surfaces that will iterate. v1.0.0 lands when those have
shipped + iterated through at least one minor (v0.2.0). v0.1.0 says
"real production-grade release with substantial new capability"
without committing to the v1 API freeze yet.

## What ships in v0.1.0

### 1 · P6.1 — complex pivot cache passthrough

Files authored with pivot tables currently lose the
`xl/pivotCaches/**` and `xl/pivotTables/**` parts on round-trip. Same
byte-passthrough pattern as the VBA passthrough that landed in v0.0.7
on `main`, but pivots need extra OOXML surgery:

- Capture parts at parse time via JSZip (already wired for VBA — extend
  `passthrough-resource.ts`).
- On export, **rel renumber** across `xl/_rels/workbook.xml.rels` +
  `xl/worksheets/_rels/sheet*.xml.rels`.
- **Inject `<pivotCaches>`** into the ExcelJS-regenerated
  `xl/workbook.xml` with the remapped `rId`s.
- Patch `[Content_Types].xml` `<Override>` entries for the new parts.
- Audit probe: 46 / 46 → **48 / 48** (pivot-cache survives + pivot-
  tables survive). New `.xlsx` fixture with a real pivot table in the
  lossiness audit suite.

**Estimated effort**: ~2 days.

### 2 · Docker build labeling + env-var docs

- **OCI image labels** (`org.opencontainers.image.*`) for every image
  pushed to Docker Hub: title, description, source, version, revision,
  licenses, vendor, url.
- **Semver tag scheme**: `v0.1.0`, `v0.1`, `v0`, `latest`. Platform-
  suffixed tags for amd64 / arm64. Multi-arch manifest tying them.
- **Documented env vars** — every runtime knob the server reads,
  with default + accepted values + which feature it controls. Lives
  in `docs/DOCKERHUB.md` and rendered into the admin panel as
  authoritative reference.
- Build args for `VERSION`, `GIT_SHA`, `BUILD_DATE` baked into the
  image labels.

**Estimated effort**: ~1 day.

### 3 · WOPI integration MVP — 3 backends behind one interface

Real persistence. The biggest piece of v0.1.0.

**Shape:**
- `server.host.Integration` TypeScript interface mirroring the Go
  shape in `schnsrw/docx` (`backend/internal/host/`): `getFile`,
  `putFile`, `checkFileInfo`.
- Hocuspocus persistence adapter wired so room snapshots survive
  server restarts.
- WOPI host contract endpoints (`/wopi/files/{id}` GET +
  `/wopi/files/{id}/contents` GET + PUT).
- Backend selection via `CASUAL_STORAGE` env var:
  - `CASUAL_STORAGE=s3` — AWS S3, MinIO, Cloudflare R2, B2.
    Configured via `CASUAL_S3_ENDPOINT` / `CASUAL_S3_BUCKET` /
    `CASUAL_S3_ACCESS_KEY` / `CASUAL_S3_SECRET_KEY`.
  - `CASUAL_STORAGE=postgres` — single `workbooks` table with
    `bytea` payload. `CASUAL_PG_URL` connection string.
  - `CASUAL_STORAGE=local` — bind-mount filesystem.
    `CASUAL_LOCAL_PATH=/data` (default).
- Backwards-compatible default: when no `CASUAL_STORAGE` is set, the
  current in-memory + Redis-snapshot path stays (zero migration for
  existing users).

**Estimated effort**: ~7-10 days.

### 4 · Admin panel — branding + storage + networking + room limits + auth hooks

- **Server-side JSON config** at `/data/casual-admin.json` (path
  configurable). React panel reads + writes via authenticated REST.
- **Branding**: logo (uploaded → stored in the storage backend),
  app name, accent colour. Picked up by the React app at load time
  via a `/api/branding` endpoint; values bind into the existing CSS
  custom-properties (`--color-accent`, etc).
- **Storage configuration**: WOPI backend selection + credentials,
  redacted in the GET response. Test-connection button proves the
  config before writing.
- **Networking** — operator-side knobs that get this past a real
  reverse proxy without surprises:
  - **CORS allowlist**: origins that may call the API. Reads
    `CASUAL_CORS_ORIGINS` as a comma-separated list; admin panel
    edits the same value through the JSON config. Default: same-
    origin only.
  - **Trusted proxy** / `X-Forwarded-*` handling: which proxy IPs
    we accept forwarded headers from. Fastify's `trustProxy` option
    surfaced through admin + env (`CASUAL_TRUST_PROXY`).
  - **Public origin**: the public URL the server should report in
    redirects, WOPI `BaseFileName`, share-link generation, OG
    canonical URLs. Reads `CASUAL_PUBLIC_ORIGIN`; admin form lets
    the operator confirm without redeploying.
  - **HSTS toggle + max-age**: emit `Strict-Transport-Security`
    header when the operator confirms HTTPS terminates upstream.
- **Room limits**: max rooms, max file size, room TTL, max users
  per room. Read by the Hocuspocus auth + Fastify upload handlers.
- **Auth provider hooks**: form UI for OIDC / SAML / JWT — **stubs
  only in v0.1**. Backend reads the config but doesn't gate anything
  on it yet; lands in v0.2.
- **Admin auth**: gated by `CASUAL_ADMIN_PASSWORD` env var (set on
  install). v0.2 adds proper admin accounts.

**Estimated effort**: ~6-8 days (was 5-7 — networking pieces add
about a day of admin-panel UI + middleware integration).

### 5 · Self-hosting docs on the site

Operators need a clear landing for "how do I run this in production"
that goes beyond the README's one-liner. Lands as a new docs section
on `schnsrw.live/docs/sheets/` under the existing content collection:

- **Self-hosting overview** — single-container vs. behind-proxy, when
  to add Redis, when to add real persistence (WOPI).
- **Reverse-proxy recipes** — nginx, Caddy, Traefik. All three need
  the WebSocket upgrade header passed through cleanly + a `client_max_body_size` bump for the upload path; recipes show the
  minimum config + a comment per directive.
- **TLS / custom domain** — Let's Encrypt with the three proxies,
  custom-domain DNS pointers, `CASUAL_PUBLIC_ORIGIN` setup.
- **CORS** — when you need it (admin API from a different origin),
  when you don't (same-origin web app), the `CASUAL_CORS_ORIGINS`
  env var, common mistakes.
- **Scaling** — single-process limits (today's shape), Redis
  persistence enabled, horizontal scale-out pre-requisites (sticky
  WebSocket sessions, shared state for awareness, etc) — labelled
  honestly as "v0.2 lane" with the open questions called out.
- **Backups** — per-backend (S3 versioning, Postgres `pg_dump`,
  local-fs rsync). Restore drill.

Generated from markdown in `sheet/docs/self-hosting/*.md` and pulled
into the site via the existing `scripts/sync-docs.mjs` pipeline.

**Estimated effort**: ~2 days.

### 6 · Release wrapper

- Tag `v0.1.0`.
- Release notes (this doc, condensed).
- New `sheets-v0.1.0.md` in `../site/src/content/changelog/`.
- Refreshed `README.md` — Docker run examples for each backend,
  admin-panel reference, env-var matrix, links to the new self-
  hosting docs.
- Updated `og.png` for the v0.1 milestone (badges, version chip).
- Post on launch channels using the existing copy in
  `../site/_drafts/launch/`.

**Estimated effort**: ~half day.

---

## Order of operations

1. **P6.1** first — small, isolated, ships independently. Closes the
   lossiness story before the bigger work starts.
2. **Docker labeling + env-var docs** — codifies the configuration
   surface that WOPI + admin panel build on.
3. **WOPI MVP** — biggest piece, most operational risk. Lands as a
   single PR per backend would be ideal, but they share the interface
   so one PR is acceptable if scope stays clean.
4. **Admin panel** — slots in after WOPI so the storage-config
   controls live where users expect. Networking (CORS / trust-proxy /
   HSTS / public-origin) ships in the same PR as the rest of the
   admin surface so the docs reference one config schema.
5. **Self-hosting docs** — written against the now-stable env-var +
   admin schema so the recipes don't drift mid-release.
6. **Release wrapper** — last.

## Out of scope for v0.1.0 (deferred to v0.2 / later)

- Auth provider backend implementations (OIDC / SAML / JWT). v0.1
  ships only the schema + UI form.
- Multiple-admin accounts. v0.1 uses a single `CASUAL_ADMIN_PASSWORD`.
- Per-tenant isolation. v0.1 is single-tenant.
- Cross-region replication, multi-process scale-out. v0.1 stays
  single-process (P8 lane).
- Self-service room invites with email. v0.1 stays anonymous-by-URL.
- AI / LLM features. Univer's command bus is extensible; left as a
  v0.3+ slot.

## Success criteria (when v0.1.0 ships)

- `pnpm test:unit` clean
- All Playwright e2e suites green (current 357 + the new ones below)
- Lossiness audit **48 / 48** (pivots probe added)
- New e2e for each WOPI backend (3 specs minimum)
- New e2e for the admin panel
- Docker image builds + smoke-tests pass on amd64 + arm64
- Live demo at `sheet.schnsrw.live/` updated
- Docker Hub `schnsrw/casual-sheets:v0.1.0` + `:v0.1` + `:v0` +
  `:latest` published
- Changelog entry on `schnsrw.live/changelog/`

## Tag history reference

| Version | Date | Notes |
|---------|------|-------|
| v0.0.2 | 2026-05-17 | Phase 1 — single-user editor |
| v0.0.3 | 2026-05-17 | Phase 2 — co-edit |
| v0.0.4 | 2026-05-18 | Phase 3 — presence + history |
| v0.0.5 | 2026-05-23 | Phase 4 — feature breadth |
| v0.0.6 | 2026-05-23 | Phase 5 — Excel-parity wave |
| _untagged_ | _on main_ | Univer 0.24 · VBA passthrough · home gallery · SEO · mobile lane |
| **v0.1.0** | **target — ~3-4 weeks out** | **WOPI · admin · pivot cache · Docker labels** |
