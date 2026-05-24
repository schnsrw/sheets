import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { signAccessToken } from '../auth/index';
import { AdminConfigStore, DEFAULT_ADMIN_CONFIG, mergeWithDefaults, redactSecrets } from './config';
import { registerAdminRoutes } from './routes';
import { WebhookDispatcher } from './webhooks';

/**
 * Admin REST + config-store + webhook dispatcher contract.
 *
 * Routes are exercised via fastify.inject() so no live socket runs.
 * The webhook dispatcher is exercised against a small in-process
 * HTTP receiver that listens on localhost:0 and echoes received
 * payloads back through a Promise.
 */

const TEST_SECRET = 'test-secret-please-do-not-use-in-prod-1234';
const TEST_USER = 'admin';
const TEST_PASS = 'opensesame-do-not-use';

let prevEnv: { secret?: string; user?: string; pass?: string };
beforeEach(() => {
  prevEnv = {
    secret: process.env.CASUAL_JWT_SECRET,
    user: process.env.CASUAL_ADMIN_USERNAME,
    pass: process.env.CASUAL_ADMIN_PASSWORD,
  };
  process.env.CASUAL_JWT_SECRET = TEST_SECRET;
  process.env.CASUAL_ADMIN_USERNAME = TEST_USER;
  process.env.CASUAL_ADMIN_PASSWORD = TEST_PASS;
});
afterEach(() => {
  for (const [key, val] of Object.entries({
    CASUAL_JWT_SECRET: prevEnv.secret,
    CASUAL_ADMIN_USERNAME: prevEnv.user,
    CASUAL_ADMIN_PASSWORD: prevEnv.pass,
  })) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
});

async function makeAdminApp() {
  const root = await mkdtemp(join(tmpdir(), 'casual-admin-'));
  const cfgPath = join(root, 'casual-admin.json');
  const store = new AdminConfigStore(cfgPath);
  const app = Fastify();
  registerAdminRoutes(app, store);
  await app.ready();
  return { app, store, cfgPath, root };
}

describe('AdminConfigStore', () => {
  it('writes defaults on first load + reads them back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casual-admin-'));
    try {
      const path = join(root, 'cfg.json');
      const store = new AdminConfigStore(path);
      const cfg = await store.load();
      assert.equal(cfg.branding.appName, 'Casual Sheets');
      assert.equal(cfg.basePath, '');
      // File should exist on disk after the first load.
      const raw = await readFile(path, 'utf8');
      assert.ok(JSON.parse(raw));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('patch deep-merges + preserves untouched sections', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casual-admin-'));
    try {
      const store = new AdminConfigStore(join(root, 'cfg.json'));
      await store.load();
      const patched = await store.patch({
        branding: { appName: 'Acme Sheets', accentColor: '#ff0000' },
      });
      assert.equal(patched.branding.appName, 'Acme Sheets');
      assert.equal(patched.branding.accentColor, '#ff0000');
      // Untouched sections retain defaults.
      assert.equal(patched.storage.backend, 'memory');
      assert.equal(patched.limits.maxRooms, 1000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('redactSecrets blanks S3 secret + OIDC client secret', () => {
    const cfg = mergeWithDefaults({
      storage: { s3: { secretKey: 'hunter2' } },
      auth: { oidc: { clientSecret: 'opensesame' } },
    });
    const r = redactSecrets(cfg);
    assert.equal(r.storage.s3.secretKey, '***');
    assert.equal(r.auth.oidc.clientSecret, '***');
  });

  it('patch preserves prior secret when inbound is the *** sentinel', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casual-admin-'));
    try {
      const store = new AdminConfigStore(join(root, 'cfg.json'));
      await store.patch({ storage: { s3: { secretKey: 'real-secret' } } });
      // Round-trip: panel sends back *** for unchanged secret field.
      const next = await store.patch({ storage: { s3: { secretKey: '***' } } });
      assert.equal(next.storage.s3.secretKey, 'real-secret');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('Admin routes', () => {
  it('GET /api/admin/status reports configured: true', async () => {
    const { app, root } = await makeAdminApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/admin/status' });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), { configured: true });
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('GET /api/admin/status reports configured: false when env unset', async () => {
    delete process.env.CASUAL_ADMIN_USERNAME;
    const { app, root } = await makeAdminApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/admin/status' });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), { configured: false });
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('POST /api/admin/login with valid creds returns an admin JWT', async () => {
    const { app, root } = await makeAdminApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/login',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ username: TEST_USER, password: TEST_PASS }),
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.ok(body.token);
      assert.equal(body.username, TEST_USER);
      assert.ok(body.ttl_seconds > 0);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('POST /api/admin/login with wrong creds returns 401', async () => {
    const { app, root } = await makeAdminApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/login',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ username: TEST_USER, password: 'wrong' }),
      });
      assert.equal(res.statusCode, 401);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('GET /api/admin/config without auth → 401', async () => {
    const { app, root } = await makeAdminApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/admin/config' });
      assert.equal(res.statusCode, 401);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('GET /api/admin/config with admin JWT returns redacted config', async () => {
    const { app, store, root } = await makeAdminApp();
    try {
      await store.patch({ storage: { s3: { secretKey: 'real-secret-bytes' } } });
      const tok = signAccessToken({ sub: TEST_USER, file_id: '*', role: 'admin' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/config',
        headers: { authorization: `Bearer ${tok}` },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.storage.s3.secretKey, '***');
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('PUT /api/admin/config writes + reads back', async () => {
    const { app, root } = await makeAdminApp();
    try {
      const tok = signAccessToken({ sub: TEST_USER, file_id: '*', role: 'admin' });
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/config',
        headers: {
          authorization: `Bearer ${tok}`,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({
          branding: { appName: 'Acme Sheets', accentColor: '#abc123' },
          basePath: '/sheets',
          webhooks: [
            {
              name: 'audit-log',
              url: 'https://example.test/hook',
              events: ['file.saved'],
              secret: 'shh',
              enabled: true,
            },
          ],
        }),
      });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.branding.appName, 'Acme Sheets');
      assert.equal(body.branding.accentColor, '#abc123');
      assert.equal(body.basePath, '/sheets');
      assert.equal(body.webhooks.length, 1);
      assert.equal(body.webhooks[0].name, 'audit-log');
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('PUT /api/admin/config with editor (non-admin) → 403', async () => {
    const { app, root } = await makeAdminApp();
    try {
      const tok = signAccessToken({ sub: 'edit-user', file_id: 'wb-1', role: 'editor' });
      const res = await app.inject({
        method: 'PUT',
        url: '/api/admin/config',
        headers: {
          authorization: `Bearer ${tok}`,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ branding: { appName: 'Acme' } }),
      });
      assert.equal(res.statusCode, 403);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('Admin routes 503 when env unset', async () => {
    delete process.env.CASUAL_ADMIN_USERNAME;
    const { app, root } = await makeAdminApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/login',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ username: 'a', password: 'b' }),
      });
      assert.equal(res.statusCode, 503);
      assert.equal(res.json().error, 'admin_not_configured');
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('WebhookDispatcher', () => {
  /** Spin up a tiny HTTP receiver that resolves a promise with the
   *  first request it gets. Returns the URL + the promise. */
  async function makeReceiver(): Promise<{
    url: string;
    received: Promise<{ headers: Record<string, string | string[] | undefined>; body: string }>;
    close: () => void;
  }> {
    const http = await import('node:http');
    let resolveReq: (v: { headers: Record<string, string | string[] | undefined>; body: string }) => void;
    const received = new Promise<{ headers: Record<string, string | string[] | undefined>; body: string }>(
      (resolve) => (resolveReq = resolve),
    );
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        resolveReq({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
        res.statusCode = 200;
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    return {
      url: `http://127.0.0.1:${port}/hook`,
      received,
      close: () => server.close(),
    };
  }

  it('dispatches to a subscribed webhook with HMAC signature when secret set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casual-admin-'));
    try {
      const store = new AdminConfigStore(join(root, 'cfg.json'));
      const recv = await makeReceiver();
      await store.patch({
        webhooks: [
          {
            name: 'test',
            url: recv.url,
            events: ['file.saved'],
            secret: 'top-secret-key',
            enabled: true,
          },
        ],
      });
      const dispatcher = new WebhookDispatcher(store, {
        info: () => {},
        warn: () => {},
      });
      dispatcher.emit('file.saved', { fileId: 'wb-1', size: 1024 });
      const req = await recv.received;
      recv.close();

      const sig = req.headers['x-casual-signature'];
      assert.ok(typeof sig === 'string' && sig.startsWith('sha256='));
      const expected =
        'sha256=' +
        createHmac('sha256', 'top-secret-key').update(req.body).digest('hex');
      assert.equal(sig, expected);

      const body = JSON.parse(req.body);
      assert.equal(body.event, 'file.saved');
      assert.deepEqual(body.payload, { fileId: 'wb-1', size: 1024 });
      assert.equal(req.headers['x-casual-event'], 'file.saved');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips disabled subscriptions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casual-admin-'));
    try {
      const store = new AdminConfigStore(join(root, 'cfg.json'));
      const recv = await makeReceiver();
      await store.patch({
        webhooks: [
          {
            name: 'disabled',
            url: recv.url,
            events: ['file.saved'],
            secret: '',
            enabled: false,
          },
        ],
      });
      const dispatcher = new WebhookDispatcher(store, {
        info: () => {},
        warn: () => {},
      });
      dispatcher.emit('file.saved', { fileId: 'wb-1' });
      // Wait briefly to confirm nothing fires.
      const racer = new Promise<'fired'>((res) =>
        recv.received.then(() => res('fired')),
      );
      const timeout = new Promise<'idle'>((res) =>
        setTimeout(() => res('idle'), 300),
      );
      const outcome = await Promise.race([racer, timeout]);
      recv.close();
      assert.equal(outcome, 'idle');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

void DEFAULT_ADMIN_CONFIG;
