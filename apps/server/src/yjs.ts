import { Hocuspocus } from '@hocuspocus/server';
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
import * as Y from 'yjs';
import type { RoomRegistry } from './rooms.js';
import type { DocStorage } from './storage.js';
import type { ShareLinkRole, ShareRole } from './auth/personal.js';
import { resolveMemberJoin } from './auth/join-role.js';
import { workbookIdForRoom } from './auth/personal-room.js';

/** Resolve a share token to its persisted role/room/password, respecting
 *  expiry, or null. In production this is `PersonalAuthStore.getLinkRole`,
 *  bound in index.ts; null in anonymous-only deploys (no personal store),
 *  in which case any `?share=` token is treated as invalid and rejected. */
export type ResolveLinkRole = (token: string) => ShareLinkRole | null;

/** The authenticated joiner (resolved from the `cs_session` cookie), or
 *  null when anonymous. */
export type SessionUser = { userId: number; isAdmin: boolean };

/** Personal-mode hooks the collab gate needs to enforce member access on
 *  a deterministic `pf-<workbookId>` room (sharing-model §6.2). Bound in
 *  index.ts from the `PersonalAuthStore`; null in anonymous-only deploys,
 *  where the gate NEVER touches a session and the legacy anonymous path
 *  applies unchanged. */
export type PersonalAuth = {
  /** Resolve a `cs_session` cookie value to the signed-in user. */
  resolveSession: (sessionId: string | null | undefined) => SessionUser | null;
  /** True when `userId` owns `workbookId` (file registry `ownerId`). */
  isOwner: (workbookId: string, userId: number) => boolean;
  /** The member's ACL role on `workbookId`, or null. */
  memberRole: (workbookId: string, userId: number) => ShareRole | null;
};

export type AttachHocuspocusOptions = {
  /** Wired only in personal mode. When absent, share tokens can't be
   *  validated, so a `?share=` join is rejected rather than trusted. */
  resolveLinkRole?: ResolveLinkRole | null;
  /** Wired only in personal mode. When absent, the session/member gate is
   *  skipped entirely — pf- rooms aren't reachable yet (next batch wires
   *  the client open flow) and anonymous rooms keep legacy behaviour. */
  personalAuth?: PersonalAuth | null;
  /** Structured logger for the §6.3 audit trail. Defaults to a no-op so
   *  tests / anonymous deploys don't require one. Shaped to match pino's
   *  `(obj, msg)` signature (Fastify's `app.log`), kept structural so we
   *  don't take a hard pino type dependency here. */
  logger?: AuditLogger | null;
};

/** Minimal structured-logger shape — pino's `info(obj, msg?)`. Fastify's
 *  `app.log` satisfies this. */
export type AuditLogger = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
};

/** The session cookie name — must match `personal-routes.ts` COOKIE_NAME. */
const SESSION_COOKIE = 'cs_session';

/** Parse a single cookie value out of a raw `Cookie:` header without a
 *  dependency. Cookies are `name=value; name2=value2`; values may be
 *  percent-encoded. Returns null when the name isn't present. */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      // Malformed encoding — hand back the raw value rather than throw;
      // an invalid session id just resolves to null downstream.
      return raw;
    }
  }
  return null;
}

/**
 * Wire Hocuspocus to a Node http server. Hocuspocus owns the Yjs sync
 * protocol; we hook lifecycle callbacks into our RoomRegistry (accounting)
 * and DocStorage (persistence). The room id is the document name — clients
 * connect with `new HocuspocusProvider({ url, name: roomId })`.
 */
export function attachHocuspocus(
  httpServer: Server,
  rooms: RoomRegistry,
  storage: DocStorage,
  pathPrefix = '/yjs',
  options: AttachHocuspocusOptions = {},
): { hocuspocus: Hocuspocus; close: () => Promise<void> } {
  const resolveLinkRole = options.resolveLinkRole ?? null;
  const personalAuth = options.personalAuth ?? null;
  const auditLog = options.logger ?? null;
  /** Emit a §6.3 audit event. No-op when no logger is wired. NEVER pass
   *  a token value or password through here — only the fields below. */
  const audit = (event: Record<string, unknown>) => {
    auditLog?.info(event, 'share.audit');
  };
  // Debounce per-room saves so a rapid burst of edits doesn't hammer Redis.
  // 500 ms feels right for "still feels live, doesn't write on every keystroke".
  const SAVE_DEBOUNCE_MS = 500;
  const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
  const queueSave = (name: string, doc: Y.Doc) => {
    const existing = pendingSaves.get(name);
    if (existing) clearTimeout(existing);
    pendingSaves.set(
      name,
      setTimeout(async () => {
        pendingSaves.delete(name);
        try {
          const update = Y.encodeStateAsUpdate(doc);
          await storage.save(name, update);
        } catch (err) {
          console.warn('[hocuspocus] save failed for', name, err);
        }
      }, SAVE_DEBOUNCE_MS),
    );
  };

  const hocuspocus = new Hocuspocus({
    name: 'casual-sheets',
    async onLoadDocument({ documentName, document }) {
      // 1) If the room was pre-seeded via /api/rooms (xlsx upload path),
      //    apply that first.
      const room = rooms.get(documentName);
      if (room?.seed) Y.applyUpdate(document, room.seed);
      // 2) Restore the latest persisted state from the storage backend.
      const persisted = await storage.load(documentName);
      if (persisted) Y.applyUpdate(document, persisted);
      return document;
    },
    /**
     * Server-side view-only enforcement. Until this hook landed, only
     * the client's `applyViewOnlyMode` + Univer's permission gate
     * stopped a view-role joiner from mutating the room — easily
     * bypassed by a crafted client.
     *
     * Hocuspocus's `ConnectionConfiguration.readOnly` flag, when set
     * in `onAuthenticate`, makes the underlying message receiver
     * reject any incoming sync update for that socket. Setting it
     * here is the only authoritative gate we control.
     *
     * Auth otherwise stays open — the room-password gate runs in the
     * upgrade handler (HTTP-level), and Hocuspocus's own auth flow is
     * effectively a no-op for anonymous rooms.
     *
     * Share-token enforcement (sharing-model §6.1): when the join URL
     * carries `?share=<token>`, the server becomes AUTHORITATIVE. We
     * IGNORE the client `?role=` entirely and derive the privilege from
     * the persisted, room-bound token via the pure resolver.
     *
     * Member enforcement (sharing-model §6.2): when the room is a
     * deterministic `pf-<workbookId>` personal-file room AND no token is
     * present, we derive the privilege from the joiner's SESSION (the
     * `cs_session` cookie → owner / admin / member ACL). An anonymous
     * joiner on a pf- room is REJECTED. The session/member gate runs ONLY
     * when `personalAuth` is wired AND the room is a pf- room — anonymous
     * random rooms NEVER pass through it.
     *
     * Any reject (token failure OR no-access) THROWS — Hocuspocus turns a
     * throw in onAuthenticate into a closed connection (its `Unauthorized`
     * close), matching the unauthorized pattern the upgrade handler uses
     * for the room password. Without a token AND on a non-pf- room we fall
     * through to the EXACT legacy anonymous behaviour below.
     *
     * NOTE (scope): this member gate is INERT until the next batch wires
     * the CLIENT open flow to connect personal files to `pf-` rooms — no
     * client reaches a pf- room yet, so in practice only the §6.1 token
     * path + the legacy anonymous path fire today. That's expected.
     */
    async onAuthenticate({ requestParameters, requestHeaders, connection, documentName }) {
      const token = requestParameters.get('share') ?? null;
      const sharePassword = requestParameters.get('sp') ?? null;

      // Resolve the signed-in user from the cs_session cookie — ONLY when
      // a personal store is wired. The cookie rides the WS upgrade request
      // headers (Hocuspocus surfaces them as `requestHeaders`).
      const session = personalAuth
        ? personalAuth.resolveSession(readCookie(requestHeaders.cookie, SESSION_COOKIE))
        : null;

      const decision = resolveMemberJoin({
        documentName,
        token,
        sharePassword,
        session,
        // No personal store wired (anonymous-only deploy) → no token can
        // be validated, so treat every token as unknown (rejects below).
        lookupLink: (t) => (resolveLinkRole ? resolveLinkRole(t) : null),
        isOwner: (workbookId, userId) =>
          personalAuth ? personalAuth.isOwner(workbookId, userId) : false,
        memberRole: (workbookId, userId) =>
          personalAuth ? personalAuth.memberRole(workbookId, userId) : null,
      });

      const workbookId = workbookIdForRoom(documentName);

      if ('reject' in decision) {
        // Refuse the connection. Throwing is the documented way to fail
        // Hocuspocus auth; it closes the socket. We deliberately do NOT
        // leak WHICH check failed to the client (all reasons collapse to
        // one error) — only the server log distinguishes them.
        audit({
          evt: 'share.join',
          workbookId,
          actor: session?.userId ?? null,
          role: null,
          via: 'reject',
          reason: decision.reject,
        });
        throw new Error(`join rejected: ${decision.reject}`);
      }

      if (
        decision.via === 'share-token' ||
        decision.via === 'owner' ||
        decision.via === 'admin' ||
        decision.via === 'member'
      ) {
        // comment → readOnly (binary). Fine-grained comment-mode (permit
        // comment mutations, block cell edits) is the same DEFERRED
        // follow-up noted in resolveJoinRole — it needs Univer-permission
        // work in the client, not this server gate.
        connection.readOnly = decision.readOnly;
        audit({
          evt: 'share.join',
          workbookId,
          actor: session?.userId ?? null,
          role: decision.role,
          via: decision.via === 'share-token' ? 'token' : decision.via,
        });
        return { role: decision.role, via: decision.via };
      }

      // ── No token, non-pf- room → legacy anonymous path, unchanged. ──
      const role = requestParameters.get('role');
      if (role === 'view') {
        connection.readOnly = true;
      }
      // Returned object becomes `context` on later hooks. Surface the
      // role so logs / metrics can attribute writes correctly.
      return { role: role === 'view' ? 'view' : 'write' };
    },
    async onChange({ documentName, document }) {
      queueSave(documentName, document as Y.Doc);
    },
    async onConnect({ documentName }) {
      rooms.onConnect(documentName);
    },
    async onDisconnect({ documentName }) {
      rooms.onDisconnect(documentName);
    },
  });

  // Fastify's WebSocket plugin would also work but we keep dependencies
  // minimal — raw ws + manual upgrade routing.
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (req: IncomingMessage, socket: import('node:net').Socket, head: Buffer) => {
    const rawUrl = req.url ?? '/';
    if (!rawUrl.startsWith(pathPrefix)) return;
    // Parse query string so the client can authenticate the WS upgrade
    // with `?room=<id>&p=<password>`. Without the room id we can't
    // validate, so we reject — Hocuspocus would otherwise let the
    // connection through and discover the room name from the protocol
    // handshake AFTER we've already accepted.
    const parsed = new URL(rawUrl, 'http://internal');
    const roomId = parsed.searchParams.get('room');
    const password = parsed.searchParams.get('p');
    const passwordBad =
      roomId !== null && rooms.get(roomId) !== undefined && !rooms.passwordOk(roomId, password);
    // Always complete the WS upgrade — even for bad-password rejections.
    // Pre-upgrade HTTP 401 responses surface in the browser only as
    // close-code 1006 ("abnormal"), indistinguishable from network
    // drops, so the client can't tell auth from outage and silently
    // reconnects forever. Completing the upgrade then closing with the
    // app-defined 4401 code gives the client a frame it can route to
    // the password prompt.
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (passwordBad) {
        try {
          // 4401 = app-defined "unauthorized" (RFC 6455 reserves 4000–4999
          // for private use). The client's onClose handler matches on this.
          ws.close(4401, 'unauthorized');
        } catch {
          // Best-effort — if close throws we just drop the socket.
          try {
            ws.terminate();
          } catch {
            /* swallow */
          }
        }
        return;
      }
      handleConnection(ws, req);
    });
  };

  httpServer.on('upgrade', onUpgrade);

  const handleConnection = (ws: WebSocket, req: IncomingMessage) => {
    // Hocuspocus expects (websocket, request, context). Context is optional
    // and we don't need auth tokens for anonymous rooms.
    hocuspocus.handleConnection(
      ws as unknown as Parameters<typeof hocuspocus.handleConnection>[0],
      req,
    );
  };

  return {
    hocuspocus,
    close: async () => {
      // Flush any pending debounced saves before we tear down.
      for (const [, timer] of pendingSaves) clearTimeout(timer);
      pendingSaves.clear();
      httpServer.off('upgrade', onUpgrade);
      wss.close();
      await hocuspocus.destroy();
    },
  };
}
