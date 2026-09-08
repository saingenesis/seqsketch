import http from 'node:http';
import { readFile, realpath, stat, writeFile, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { handleExport } from './export.mjs';

export const APP_ID = 'seqsketch.portable/1';
export const DEFAULT_PORT = 5317;
const runtimeDir = dirname(fileURLToPath(import.meta.url));
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2' };

export async function createSketchServer({ appDir, token, onStop = () => {} }) {
  const root = await realpath(appDir);
  const server = http.createServer(async (request, response) => {
    const send = (status, message, type = 'text/plain; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type }); response.end(request.method === 'HEAD' ? undefined : message);
    };
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin)) return send(403, 'Local requests only.');
    try {
      const url = new URL(request.url, origin);
      if (url.pathname === '/__seqsketch_export' && request.method === 'POST') return handleExport(request, response);
      if (url.pathname === '/__seqsketch_health' && request.method === 'GET') return send(200, JSON.stringify({ app: APP_ID }), 'application/json');
      if (url.pathname === '/__seqsketch_stop' && request.method === 'POST') {
        const supplied = Buffer.from(request.headers['x-seqsketch-token'] ?? '');
        const expected = Buffer.from(token);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return send(403, 'Invalid stop token.');
        send(200, 'Stopped.');
        server.close(onStop);
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return send(405, 'Method not allowed.');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.includes('\0') || pathname.includes('\\')) return send(400, 'Invalid path.');
      const candidate = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      const withinRoot = path => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
      if (!withinRoot(candidate)) return send(403, 'Outside application directory.');
      const actual = await realpath(candidate);
      if (!withinRoot(actual)) return send(403, 'Outside application directory.');
      const info = await stat(actual);
      if (!info.isFile()) return send(404, 'Not found.');
      response.writeHead(200, { 'Content-Type': mimeTypes[extname(actual)] ?? 'application/octet-stream', 'Content-Length': info.size });
      if (request.method === 'HEAD') return response.end();
      const stream = createReadStream(actual);
      stream.on('error', () => response.destroy()); stream.pipe(response);
    } catch (error) {
      if (!response.headersSent) send(error instanceof URIError ? 400 : 404, 'Not found.');
      else response.destroy();
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}

async function main() {
  const appDir = resolve(runtimeDir, '../app');
  const statePath = resolve(runtimeDir, 'server-state.json');
  const token = randomBytes(32).toString('hex');
  async function cleanup() {
    try {
      const state = JSON.parse(await readFile(statePath, 'utf8'));
      if (state.token === token) await unlink(statePath);
    } catch { /* Another launch may already have replaced the state file. */ }
  }
  const server = await createSketchServer({ appDir, token, onStop: cleanup });
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(DEFAULT_PORT, '127.0.0.1', accept); });
  try { await writeFile(statePath, JSON.stringify({ pid: process.pid, port: DEFAULT_PORT, token }), { mode: 0o600 }); }
  catch (error) { server.close(); throw error; }
  process.on('SIGINT', () => server.close(cleanup));
  process.on('SIGTERM', () => server.close(cleanup));
  console.log(`SeqSketch is ready at http://127.0.0.1:${DEFAULT_PORT}/`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
