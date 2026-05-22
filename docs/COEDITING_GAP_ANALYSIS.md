# Co-editing Gap Analysis

This is the v0.0.4 backlog for the collaborative-editing lane. It separates:

- real bugs
- product gaps
- UX / UI debt
- known limitations that are intentional for now

It is based on the current implementation in `apps/web/src/collab/`, the room/server code in `apps/server/src/`, and the collab E2E suites.

## What Already Works

- basic two-peer sync for cell values
- style and structural mutations across peers
- charts syncing through a room
- password-protected rooms
- presence avatars and remote selection cursors
- join/leave room flow
- room teardown / idle GC
- op-log compaction

## Logged Issues

| Severity | Type | Area | Where | Summary |
| --- | --- | --- | --- | --- |
| P0 | Security bug | Auth / permissions | `apps/web/src/collab/bridge.ts`, `apps/server/src/yjs.ts` | View-only mode is enforced only in the client bridge. The server validates the room password, but it does not enforce role. A user who edits the URL or client state can still connect as write. |
| P1 | Bug / flake | Room join | `apps/web/src/collab/CollabDriver.tsx`, `apps/web/src/shell/CreateRoomDialog.tsx`, `tests/e2e/coedit-share.spec.ts` | The share/join path is flaky under combined collab load. In a combined Playwright run, the password submit was blocked by the loading error overlay; rerunning the same spec alone passed. This points to a timing/race issue in the room setup/join pipeline. |
| P1 | UX bug | Join recovery | `apps/web/src/shell/LoadingOverlay.tsx`, `apps/web/src/collab/CollabDriver.tsx` | The loading error overlay is modal and blocks the password prompt. If room load fails, the user can get trapped behind a full-screen error state instead of being guided back to a retry path. |
| P2 | UX / copy mismatch | Name identity | `apps/web/src/collab/NamePrompt.tsx`, `apps/web/src/collab/CollabDriver.tsx` | The prompt copy says the display name can be changed later from the share menu, but there is no visible share-menu entry for name editing. That makes the room identity flow misleading. |
| P2 | Feature limitation | Presence fidelity | `apps/web/src/collab/presence.ts`, `apps/web/src/collab/PresenceLayer.tsx` | Presence only renders the primary selection range and a single live-edit cell. Multi-range selection is intentionally collapsed, so collaborators lose fidelity on more complex selections. |
| P2 | UI limitation | Dense rooms | `apps/web/src/collab/AvatarStack.tsx` | The avatar stack caps visible peers at 4 and hides the rest behind `+N`. That is compact, but in larger rooms it is hard to tell who is present without opening tooltips. |
| P3 | Perf / UX limitation | Join fast path | `apps/web/src/collab/CollabDriver.tsx`, `apps/web/src/shell/CreateRoomDialog.tsx`, `docs/LARGE_FILE_PIPELINE.md` | Room join is still dependent on the xlsx seed path unless the optional gzipped snapshot cache is present. That is correct, but it means large rooms can still pay a parse cost and the fast path is best-effort rather than guaranteed. |
| P3 | Product limitation | Room lifecycle | `docs/CO-EDITING.md`, `apps/server/src/rooms.ts` | Rooms are in-memory only and are lost on server restart by design. This is not a bug, but it is a user-facing limitation that must be obvious in the product docs and room UI. |

## Notes On The Flaky Join Failure

The combined collab suite produced a failure in `tests/e2e/coedit-share.spec.ts` at password submission, but the same spec passed when rerun in isolation.

That means the current state is likely:

- a timing race in the share/join flow under load, or
- a test-environment flake that collides with the loading overlay

Either way, it is worth tracking because it affects confidence in the room onboarding path.

## Coverage Gaps To Keep Watching

- no server-side role enforcement beyond password gating
- no visible display-name edit surface after initial join
- no multi-range presence rendering
- no room history or persistence beyond process lifetime
- no multi-room scale-out

## Recommended Next Issue Split

1. Server-side enforcement for view-only roles.
2. Share/join race hardening and loading-overlay recovery.
3. Display-name editing surface.
4. Presence multi-range fidelity.
5. Room lifecycle messaging and persistence expectations.

