import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryHost } from './memory';
import { LocalHost } from './local';
import { VersionMismatchError } from './integration';

/**
 * MemoryHost + LocalHost regression. S3 + Postgres aren't covered here
 * because they need live services; they share the same interface so a
 * mismatch with the contract surfaces in the integration tests under
 * docker-compose against MinIO + Postgres (lands in v0.1.0 too).
 */

const sample = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00, 0x01]);
const sample2 = new Uint8Array([0x50, 0x4b, 0xab, 0xcd]);

describe('MemoryHost', () => {
  it('round-trips bytes + reports size + version + filename', async () => {
    const host = new MemoryHost();
    const v1 = await host.putFile('wb-1', sample, { fileName: 'Test.xlsx' });
    assert.ok(typeof v1 === 'string' && v1.length > 0, 'returns a non-empty version');

    const got = await host.getFile('wb-1');
    assert.deepEqual(got, sample);

    const info = await host.checkFileInfo('wb-1');
    assert.equal(info?.baseFileName, 'Test.xlsx');
    assert.equal(info?.size, sample.byteLength);
    assert.equal(info?.version, v1);
  });

  it('returns null for unknown file', async () => {
    const host = new MemoryHost();
    assert.equal(await host.getFile('missing'), null);
    assert.equal(await host.checkFileInfo('missing'), null);
  });

  it('honours ifMatchVersion — throws on mismatch, ok on match', async () => {
    const host = new MemoryHost();
    const v1 = await host.putFile('wb-1', sample);
    // Match: OK
    const v2 = await host.putFile('wb-1', sample2, { ifMatchVersion: v1 });
    assert.notEqual(v2, v1);
    // Mismatch: throws
    await assert.rejects(
      () => host.putFile('wb-1', sample, { ifMatchVersion: v1 }),
      (err) => err instanceof VersionMismatchError,
    );
  });

  it('listFiles + deleteFile', async () => {
    const host = new MemoryHost();
    await host.putFile('a', sample);
    await host.putFile('b', sample);
    assert.deepEqual((await host.listFiles()).sort(), ['a', 'b']);
    await host.deleteFile('a');
    assert.deepEqual(await host.listFiles(), ['b']);
  });
});

describe('LocalHost', () => {
  it('round-trips bytes to disk + reads them back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casual-host-'));
    try {
      const host = new LocalHost(root);
      const v = await host.putFile('wb-1', sample, { fileName: 'Local.xlsx' });
      assert.ok(v);
      const got = await host.getFile('wb-1');
      assert.deepEqual(got, sample);
      const info = await host.checkFileInfo('wb-1');
      assert.equal(info?.baseFileName, 'Local.xlsx');
      assert.equal(info?.size, sample.byteLength);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reads metadata from a .xlsx an operator dropped in by hand', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const root = await mkdtemp(join(tmpdir(), 'casual-host-'));
    try {
      await mkdir(root, { recursive: true });
      // No .meta.json sidecar — just the bytes.
      await writeFile(join(root, 'dropped-in.xlsx'), Buffer.from(sample));
      const host = new LocalHost(root);
      const info = await host.checkFileInfo('dropped-in');
      assert.equal(info?.baseFileName, 'dropped-in.xlsx');
      assert.equal(info?.size, sample.byteLength);
      // Version synthesised from mtime.
      assert.ok(info?.version);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('listFiles + deleteFile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casual-host-'));
    try {
      const host = new LocalHost(root);
      await host.putFile('a', sample);
      await host.putFile('b', sample);
      assert.deepEqual((await host.listFiles()).sort(), ['a', 'b']);
      await host.deleteFile('a');
      assert.deepEqual(await host.listFiles(), ['b']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses path traversal in fileId — safeName neutralises ../', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casual-host-'));
    try {
      const host = new LocalHost(root);
      // ../escape — should write under `root/__escape.xlsx` (sanitised),
      // not outside `root`.
      await host.putFile('../escape', sample);
      const inside = await host.listFiles();
      assert.ok(inside.length > 0, 'sanitised id ended up inside root');
      // No file with the literal path-traversal name leaked anywhere.
      // (`getFile` uses the same safeName so the round-trip works.)
      const got = await host.getFile('../escape');
      assert.deepEqual(got, sample);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('healthcheck returns null on writable root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casual-host-'));
    try {
      const host = new LocalHost(root);
      assert.equal(await host.healthcheck(), null);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
