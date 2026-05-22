# Casual Sheets

**Excel-flavored web spreadsheet with real-time collaborative editing.**

Built on [Univer OSS](https://github.com/dream-num/univer) (Apache-2.0).
Single image — web app, Hocuspocus, and Fastify all in one container.

**Source:** [github.com/schnsrw/sheets](https://github.com/schnsrw/sheets) &nbsp;·&nbsp; **Demo (single-user):** [sheet.schnsrw.live](https://sheet.schnsrw.live/)

---

## Quick Start

```sh
# In-memory rooms — great for a quick try (rooms vanish on restart):
docker run --rm -p 3000:3000 schnsrw/casual-sheets:latest
# open http://localhost:3000
```

### With Redis persistence (recommended)

```sh
docker compose up -d
# open http://localhost:3000
```

Paste this `docker-compose.yml` if you don't want to clone the repo:

```yaml
services:
  app:
    image: schnsrw/casual-sheets:latest
    restart: unless-stopped
    ports: ['3000:3000']
    environment:
      REDIS_URL: redis://redis:6379
      ROOM_TTL_MIN: '15'
    depends_on:
      redis:
        condition: service_healthy

  redis:
    image: redis:7.4-alpine
    restart: unless-stopped
    command: ['redis-server', '--appendonly', 'yes']
    volumes:
      - redis-data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 3s
      retries: 5

volumes:
  redis-data:
```

---

## Co-Edit a Sheet

1. Open `http://localhost:3000`. **File → Share for co-editing…** — set a password + role, get two share URLs.
2. Paste either URL into another browser or device. Joiners appear in the title-bar avatar stack within ~1 s.
3. Move your selection — peers see your named cursor follow it. Type in a cell — peers see characters appear live.

Anonymous sessions — no accounts required. Rooms are addressed at `/r/<roomId>`.

---

## Features

- **Office-style ribbon** — Home, Insert, Formulas, Data, View, Review tabs
- **Full xlsx / ods / csv / tsv round-trip** — parsed and serialised in Web Workers; main thread never blocks
- **Charts** — insert dialog, 8 chart types, drag/resize, format dialog, co-edit sync, PNG embed in `.xlsx`
- **Pivot tables** P0 — group-by + aggregate from the Insert menu
- **Conditional formatting, data validation, drawings** — round-tripped and co-edit synced
- **Autosave** to IndexedDB with a restore banner on reload
- **Co-editing** — live cursors, live-typing ghost, presence avatars, password-protected rooms
- **View-only enforcement** at the Univer engine layer
- **Session-history panel** — per-room op log; review or revert changes
- **Divergence detection** — "Out of sync" pill + "Waiting to reconnect" banner
- **337 Playwright e2e tests** covering all major workflows

---

## Configuration

| Env var | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP + WebSocket listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `REDIS_URL` | _unset_ | Redis connection string; enables Y.Doc persistence with a 7-day TTL |
| `ROOM_TTL_MIN` | `15` | Minutes a room stays alive after the last client disconnects |
| `MAX_UPLOAD_MB` | `100` | Upload cap for xlsx seed and gzipped snapshot |

Build-time knobs (`VITE_MAX_OPEN_MB`, `VITE_SOFT_WARN_MB`, `VITE_COLLAB_ENABLED`) are baked into the image. Override with `--build-arg` when building your own image.

---

## Tags

| Tag | Description |
| --- | --- |
| `latest` | Always the highest published release |
| `0.0.5` | Co-edit fidelity pass — charts, pivots, CF/DV/drawings sync, autosave, 337 e2e tests |
| `0.0.4` | Co-edit polish + large-file pipeline |
| `0.0.3` | CI stability fix |
| `0.0.2` | Co-editing + initial Docker image |

Multi-arch: `linux/amd64` + `linux/arm64`.

---

## What's Inside the Image

- **Web app** — React + Vite + TypeScript, served statically by the same Fastify server.
- **Collab server** — Yjs + Hocuspocus over WebSocket at `/yjs`. Per-mutation op-log with `fromCollab` echo-loop prevention and Stage-6 compaction.
- **xlsx I/O** — ExcelJS running in dedicated Web Workers; main thread never blocks on multi-MB opens or saves.
- **Lazy plugin loading** — conditional formatting, data validation, hyperlinks, drawings, sort, filter, find-replace each load as their own chunk; eager-loaded on snapshot inspection.

---

## License

Apache-2.0. Vendored Univer source retains its upstream Apache-2.0 license; it is not modified and is not part of the build.
