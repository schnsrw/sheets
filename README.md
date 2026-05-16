# sheet

Web-based **Excel-equivalent** with real-time co-editing, built on [Univer](https://github.com/dream-num/univer) (OSS, Apache-2.0).

## Status

**Phase 0 — scaffold + smoke test.** Office-style React shell mounted on a single-player Univer workbook, with Playwright e2e in place.

- ✅ pnpm workspace, strict TypeScript, ESLint + Prettier
- ✅ `apps/web` — Vite + React, Univer 0.22.1 (native chrome hidden, custom Office shell)
- ✅ `apps/server` — Fastify scaffold (placeholder upload/download endpoints)
- ✅ Playwright e2e config + smoke tests
- ⏳ Phase 1 — wire ribbon buttons to Univer commands
- ⏳ Phase 2 — Yjs collab bridge + Hocuspocus server
- ⏳ Phase 3 — presence (cursors, selections, avatars)

See [`PLAN.md`](./PLAN.md) for the phased plan.

## Repo layout

```
.
├── apps/
│   ├── web/                ← Vite + React frontend, mounts Univer
│   └── server/             ← Fastify backend (Hocuspocus + xlsx routes land in Phase 2)
├── packages/               ← collab-bridge, xlsx-converter, shared types (TBD)
├── tests/e2e/              ← Playwright e2e suites
├── docs/
│   ├── ARCHITECTURE.md     ← system architecture
│   └── RESEARCH.md         ← Univer technical brief
├── vendor/univer/          ← read-only Univer source clone (do not modify, do not build)
├── PLAN.md
├── CLAUDE.md
├── playwright.config.ts
├── pnpm-workspace.yaml
└── package.json
```

## Develop

Prereqs: Node ≥ 18.17, pnpm 10+.

```sh
pnpm install                    # one-time
pnpm dev:web                    # http://127.0.0.1:5273
pnpm dev:server                 # http://127.0.0.1:3000 (placeholder)
pnpm test:e2e                   # Playwright e2e (auto-starts dev server)
pnpm test:e2e:ui                # Playwright UI mode
pnpm lint                       # eslint
pnpm format                     # prettier --write
pnpm typecheck                  # tsc across packages
```

## License

Project code: TBD. Vendored Univer source is Apache-2.0 (DreamNum Co., Ltd.).
