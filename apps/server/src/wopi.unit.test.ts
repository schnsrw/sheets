import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { MemoryHost } from './host/memory';
import { registerWopiRoutes } from './wopi';

/**
 * WOPI endpoint integration test — runs against a Fastify instance with
 * a MemoryHost. Uses `fastify.inject()` so no live HTTP socket is
 * involved; tests run in process. Validates the three core routes
 * (CheckFileInfo / GetFile / PutFile) plus the listing + healthcheck.
 */

async function makeApp() {
  const app = Fastify();
  // PutFile receives raw bytes; mirror the parser block from index.ts
  // so the test exercises the same content-type plumbing prod uses.
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );
  app.addContentTypeParser(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );
  const host = new MemoryHost();
  registerWopiRoutes(app, host);
  await app.ready();
  return { app, host };
}

const sample = Buffer.from('PK\x03\x04\x14\x00\x00\x00');

describe('WOPI routes', () => {
  it('CheckFileInfo returns 404 for unknown file', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/wopi/files/missing' });
    assert.equal(res.statusCode, 404);
    await app.close();
  });

  it('PutFile then GetFile round-trips the bytes', async () => {
    const { app, host } = await makeApp();
    await host.putFile('wb-1', new Uint8Array(sample));

    const get = await app.inject({
      method: 'GET',
      url: '/wopi/files/wb-1/contents',
    });
    assert.equal(get.statusCode, 200);
    assert.equal(get.rawPayload.length, sample.length);
    // ItemVersion header should be present.
    assert.ok(get.headers['x-wopi-itemversion']);
    await app.close();
  });

  it('CheckFileInfo returns the WOPI-shaped JSON', async () => {
    const { app, host } = await makeApp();
    await host.putFile('wb-1', new Uint8Array(sample), { fileName: 'Pricing.xlsx' });

    const res = await app.inject({ method: 'GET', url: '/wopi/files/wb-1' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.BaseFileName, 'Pricing.xlsx');
    assert.equal(body.Size, sample.length);
    assert.ok(typeof body.Version === 'string');
    await app.close();
  });

  it('PutFile via POST creates the file when missing', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/wopi/files/wb-new/contents',
      headers: { 'content-type': 'application/octet-stream' },
      payload: sample,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.ok);
    assert.ok(body.version);
    assert.equal(body.bytes, sample.length);

    // Confirm subsequent GET returns the bytes we wrote.
    const get = await app.inject({
      method: 'GET',
      url: '/wopi/files/wb-new/contents',
    });
    assert.equal(get.statusCode, 200);
    assert.equal(get.rawPayload.length, sample.length);
    await app.close();
  });

  it('PutFile honours X-WOPI-ItemVersion as If-Match — 409 on mismatch', async () => {
    const { app, host } = await makeApp();
    await host.putFile('wb-1', new Uint8Array(sample));

    const res = await app.inject({
      method: 'POST',
      url: '/wopi/files/wb-1/contents',
      headers: {
        'content-type': 'application/octet-stream',
        'x-wopi-itemversion': 'wrong-version-string',
      },
      payload: sample,
    });
    assert.equal(res.statusCode, 409);
    const body = res.json();
    assert.equal(body.error, 'version_mismatch');
    await app.close();
  });

  it('listing endpoint returns the host backend label', async () => {
    const { app, host } = await makeApp();
    await host.putFile('a', new Uint8Array(sample));
    await host.putFile('b', new Uint8Array(sample));

    const res = await app.inject({ method: 'GET', url: '/api/files' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.backend, 'memory');
    assert.deepEqual([...body.files].sort(), ['a', 'b']);
    await app.close();
  });

  it('healthcheck endpoint returns ok for the in-memory backend', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/files/_health' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true, backend: 'memory' });
    await app.close();
  });
});
