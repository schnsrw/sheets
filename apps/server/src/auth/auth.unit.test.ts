import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { MemoryHost } from '../host/memory';
import { registerWopiRoutes } from '../wopi';
import {
  ROLE_PERMISSIONS,
  isJwtEnabled,
  resolvePermissions,
  signAccessToken,
} from './index';

/**
 * Auth contract: token issuance, signature + claim validation, route
 * enforcement, role-permission resolution.
 *
 * All tests run with a deterministic test secret so the
 * sign-then-verify round-trip is hermetic. JWT_ENABLED state is reset
 * via the env var between tests.
 */

const TEST_SECRET = 'test-secret-please-do-not-use-in-prod-1234';
let prevSecret: string | undefined;

beforeEach(() => {
  prevSecret = process.env.CASUAL_JWT_SECRET;
  process.env.CASUAL_JWT_SECRET = TEST_SECRET;
});
afterEach(() => {
  if (prevSecret === undefined) delete process.env.CASUAL_JWT_SECRET;
  else process.env.CASUAL_JWT_SECRET = prevSecret;
});

async function makeApp() {
  const app = Fastify();
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );
  registerWopiRoutes(app, new MemoryHost());
  await app.ready();
  return app;
}

const sample = Buffer.from('PK\x03\x04 some payload bytes');

describe('JWT enabled flag', () => {
  it('reads CASUAL_JWT_SECRET ≥ 16 chars', () => {
    assert.equal(isJwtEnabled(), true);
  });

  it('returns false when the secret is too short', () => {
    process.env.CASUAL_JWT_SECRET = 'short';
    assert.equal(isJwtEnabled(), false);
  });

  it('returns false when the secret is unset', () => {
    delete process.env.CASUAL_JWT_SECRET;
    assert.equal(isJwtEnabled(), false);
  });
});

describe('role → permissions resolution', () => {
  it('admin has every flag', () => {
    const p = resolvePermissions('admin', undefined);
    for (const v of Object.values(p)) assert.equal(v, true);
  });

  it('viewer can read + download, not write/comment/share/admin', () => {
    const p = resolvePermissions('viewer', undefined);
    assert.equal(p.read, true);
    assert.equal(p.download, true);
    assert.equal(p.write, false);
    assert.equal(p.comment, false);
    assert.equal(p.share, false);
    assert.equal(p.admin, false);
  });

  it('commenter can read + comment, not write', () => {
    const p = resolvePermissions('commenter', undefined);
    assert.equal(p.read, true);
    assert.equal(p.comment, true);
    assert.equal(p.write, false);
  });

  it('claim overrides flip role defaults', () => {
    // A viewer with `download: false` — useful for "no export" tokens.
    const p = resolvePermissions('viewer', { download: false });
    assert.equal(p.read, true);
    assert.equal(p.download, false);
  });

  it('anonymous has no flags set', () => {
    const p = ROLE_PERMISSIONS.anonymous;
    for (const v of Object.values(p)) assert.equal(v, false);
  });
});

describe('JWT-secured WOPI routes', () => {
  it('rejects requests with no token (401)', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/wopi/files/wb-1' });
    assert.equal(res.statusCode, 401);
    await app.close();
  });

  it('rejects tokens with mismatched file_id (403)', async () => {
    const app = await makeApp();
    const token = signAccessToken({
      sub: 'alice',
      file_id: 'wb-OTHER',
      role: 'editor',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/wopi/files/wb-1',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error, 'file_id_mismatch');
    await app.close();
  });

  it('rejects malformed tokens (401)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: '/wopi/files/wb-1',
      headers: { authorization: 'Bearer not.a.jwt' },
    });
    assert.equal(res.statusCode, 401);
    await app.close();
  });

  it('viewer token can GET but cannot PUT (read ok, write 403)', async () => {
    const app = await makeApp();
    const host = new MemoryHost();
    // Replace the host wired in makeApp() — register a fresh wopi
    // route block on a new Fastify instance so we control which host
    // the routes see.
    const app2 = Fastify();
    app2.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer' },
      (_r, b, done) => done(null, b),
    );
    registerWopiRoutes(app2, host);
    await app2.ready();
    await host.putFile('wb-1', new Uint8Array(sample), { fileName: 'A.xlsx' });

    const tokenViewer = signAccessToken({
      sub: 'bob',
      file_id: 'wb-1',
      role: 'viewer',
    });
    const get = await app2.inject({
      method: 'GET',
      url: '/wopi/files/wb-1/contents',
      headers: { authorization: `Bearer ${tokenViewer}` },
    });
    assert.equal(get.statusCode, 200);
    assert.equal(get.rawPayload.length, sample.length);

    const put = await app2.inject({
      method: 'POST',
      url: '/wopi/files/wb-1/contents',
      headers: {
        authorization: `Bearer ${tokenViewer}`,
        'content-type': 'application/octet-stream',
      },
      payload: sample,
    });
    assert.equal(put.statusCode, 403);
    assert.equal(put.json().error, 'write_not_permitted');

    await app2.close();
    await app.close();
  });

  it('editor token can PUT', async () => {
    const host = new MemoryHost();
    const app = Fastify();
    app.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer' },
      (_r, b, done) => done(null, b),
    );
    registerWopiRoutes(app, host);
    await app.ready();

    const tokenEditor = signAccessToken({
      sub: 'carol',
      file_id: 'wb-9',
      role: 'editor',
    });
    const put = await app.inject({
      method: 'POST',
      url: '/wopi/files/wb-9/contents',
      headers: {
        authorization: `Bearer ${tokenEditor}`,
        'content-type': 'application/octet-stream',
      },
      payload: sample,
    });
    assert.equal(put.statusCode, 200);
    assert.ok(put.json().ok);
    await app.close();
  });

  it('CheckFileInfo response surfaces claims + role + features', async () => {
    const host = new MemoryHost();
    const app = Fastify();
    registerWopiRoutes(app, host);
    await app.ready();
    await host.putFile('wb-1', new Uint8Array(sample), { fileName: 'Pricing.xlsx' });

    const tok = signAccessToken({
      sub: 'dave@acme.example',
      display_name: 'Dave',
      file_id: 'wb-1',
      role: 'editor',
      features: { ai: true },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/wopi/files/wb-1',
      headers: { authorization: `Bearer ${tok}` },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.BaseFileName, 'Pricing.xlsx');
    assert.equal(body.UserId, 'dave@acme.example');
    assert.equal(body.UserFriendlyName, 'Dave');
    assert.equal(body.ReadOnly, false);
    assert.equal(body.UserCanWrite, true);
    assert.equal(body.casualRole, 'editor');
    assert.equal(body.casualPermissions.write, true);
    assert.equal(body.casualFeatures.ai, true); // override took effect
    assert.equal(body.casualFeatures.charts, true); // default kept
    await app.close();
  });

  it('access_token query string works (WOPI standard)', async () => {
    const host = new MemoryHost();
    const app = Fastify();
    registerWopiRoutes(app, host);
    await app.ready();
    await host.putFile('wb-1', new Uint8Array(sample));

    const tok = signAccessToken({
      sub: 'eve',
      file_id: 'wb-1',
      role: 'editor',
    });
    const res = await app.inject({
      method: 'GET',
      url: `/wopi/files/wb-1?access_token=${encodeURIComponent(tok)}`,
    });
    assert.equal(res.statusCode, 200);
    await app.close();
  });
});

describe('Token issuance endpoint', () => {
  it('admin can mint tokens for any user/file', async () => {
    const app = await makeApp();
    const adminTok = signAccessToken({
      sub: 'owner',
      file_id: 'wb-admin',
      role: 'admin',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: {
        authorization: `Bearer ${adminTok}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({
        sub: 'guest',
        file_id: 'wb-shared',
        role: 'viewer',
        ttl_seconds: 30,
      }),
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(typeof body.token === 'string');
    assert.equal(body.claims.sub, 'guest');
    assert.equal(body.claims.role, 'viewer');
    assert.equal(body.resolved_permissions.write, false);
    await app.close();
  });

  it('non-admin token cannot mint (403)', async () => {
    const app = await makeApp();
    const editorTok = signAccessToken({
      sub: 'editor-user',
      file_id: 'wb-1',
      role: 'editor',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: {
        authorization: `Bearer ${editorTok}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({
        sub: 'guest',
        file_id: 'wb-other',
        role: 'viewer',
      }),
    });
    assert.equal(res.statusCode, 403);
    await app.close();
  });

  it('issuance fails fast when JWT secret unset', async () => {
    delete process.env.CASUAL_JWT_SECRET;
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ sub: 'a', file_id: 'b', role: 'viewer' }),
    });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error, 'jwt_not_configured');
    await app.close();
  });
});

describe('/api/me self-introspection', () => {
  it('reports anonymous when no token', async () => {
    delete process.env.CASUAL_JWT_SECRET;
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().anonymous, true);
    await app.close();
  });

  it('reports resolved permissions + features for a token', async () => {
    const app = await makeApp();
    const tok = signAccessToken({
      sub: 'frank',
      display_name: 'Frank',
      file_id: 'wb-7',
      role: 'commenter',
      features: { ai: true, exportFiles: false },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${tok}` },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.anonymous, false);
    assert.equal(body.role, 'commenter');
    assert.equal(body.sub, 'frank');
    assert.equal(body.displayName, 'Frank');
    assert.equal(body.fileId, 'wb-7');
    assert.equal(body.permissions.comment, true);
    assert.equal(body.permissions.write, false);
    assert.equal(body.features.ai, true);
    assert.equal(body.features.exportFiles, false);
    await app.close();
  });
});

describe('Back-compat: JWT disabled means anonymous WOPI', () => {
  it('GET succeeds without a token when JWT is unconfigured', async () => {
    delete process.env.CASUAL_JWT_SECRET;
    const host = new MemoryHost();
    const app = Fastify();
    registerWopiRoutes(app, host);
    await app.ready();
    await host.putFile('wb-1', new Uint8Array(sample));

    const res = await app.inject({
      method: 'GET',
      url: '/wopi/files/wb-1',
    });
    assert.equal(res.statusCode, 200);
    await app.close();
  });
});
