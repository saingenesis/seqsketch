import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { handleExport } from '../portable/export.mjs';

it('saves JSON and SVG into the requested folder and updates the selected file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seqsketch-export-'));
  const server = createServer(handleExport);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const files = ['sample.curve.dataset.json', 'sample.stroke.dataset.json', 'sample.seqsketch.json', 'sample.stroke.svg'];
  try {
    for (const name of files) {
      const text = name.endsWith('.svg') ? '<svg></svg>' : '{"sample":"test"}';
      const response = await fetch(`http://127.0.0.1:${address.port}`, { method: 'POST', body: JSON.stringify({ directory, name, text }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ path: join(directory, name) });
      expect(await readFile(join(directory, name), 'utf8')).toBe(text);
    }
    await fetch(`http://127.0.0.1:${address.port}`, { method: 'POST', body: JSON.stringify({ directory, name: files[0], text: '{"updated":true}' }) });
    expect(await readFile(join(directory, files[0]), 'utf8')).toBe('{"updated":true}');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const name of files) await rm(join(directory, name));
    await rmdir(directory);
  }
});
