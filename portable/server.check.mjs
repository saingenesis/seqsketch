import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import http from 'node:http';
import { createSketchServer, APP_ID } from './server.mjs';

test('portable server serves only the app and requires its private stop token', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'seqsketch-server-'));
  const appDir = join(folder, 'app');
  await mkdir(appDir);
  await writeFile(join(appDir, 'index.html'), '<!doctype html><title>Test</title>');
  await writeFile(join(appDir, 'main.js'), 'console.log("test")');
  await writeFile(join(folder, 'private.txt'), 'not public');
  const server = await createSketchServer({ appDir, token: 'private-test-token' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.ok(resolve(folder).startsWith(`${resolve(tmpdir())}${sep}seqsketch-server-`));
    await rm(folder, { recursive: true, force: true });
  });
  const index = await fetch(base);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /<title>Test/);
  assert.match(index.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const script = await fetch(`${base}/main.js`);
  assert.match(script.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(base, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(`${base}/__seqsketch_health`).then(r => r.json())).app, APP_ID);
  assert.equal((await fetch(`${base}/private.txt`)).status, 404);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  assert.equal((await fetch(base, { headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal((await fetch(`${base}/__seqsketch_stop`, { method: 'POST' })).status, 403);
  for (const path of ['/%2e%2e%2fprivate.txt', '/%5c..%5cprivate.txt', '/%ZZ']) {
    const status = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); }).on('error', reject);
    });
    assert.ok(status >= 400, path);
  }
  assert.equal((await fetch(`${base}/__seqsketch_stop`, { method: 'POST', headers: { 'X-SeqSketch-Token': 'private-test-token' } })).status, 200);
});
