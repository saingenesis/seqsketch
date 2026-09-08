import { spawn, execFile } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { APP_ID, DEFAULT_PORT } from './server.mjs';

const runtimeDir = dirname(fileURLToPath(import.meta.url));
const url = `http://127.0.0.1:${DEFAULT_PORT}/`;

async function health() {
  try {
    const response = await fetch(`${url}__seqsketch_health`, { signal: AbortSignal.timeout(1000), redirect: 'error' });
    if (!response.ok) return { occupied: true };
    try { return await response.json(); } catch { return { occupied: true }; }
  } catch { return null; }
}

async function main() {
  const action = process.argv[2] ?? 'start';
  if (!['start', 'stop'].includes(action)) throw new Error('Use start or stop.');
  const current = await health();
  if (action === 'stop') {
    if (!current) { console.log('SeqSketch is already stopped.'); return; }
    if (current.app !== APP_ID) throw new Error('Port 5317 belongs to another program. Nothing was stopped.');
    let state;
    try { state = JSON.parse(await readFile(resolve(runtimeDir, 'server-state.json'), 'utf8')); }
    catch { throw new Error('This copy did not start the running server. Use the stop file in the folder that started it.'); }
    const response = await fetch(`${url}__seqsketch_stop`, { method: 'POST', headers: { 'X-SeqSketch-Token': state.token }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('Could not stop this server. Use the original folder to stop it.');
    for (let attempt = 0; attempt < 20; attempt++) {
      if (!(await health())) { console.log('SeqSketch stopped. Saved drawings remain in your browser.'); return; }
      await delay(100);
    }
    throw new Error('The server is still stopping. Try again in a few seconds.');
  }
  if (current && current.app !== APP_ID) throw new Error('Port 5317 is occupied by another program.');
  if (!current) {
    const log = openSync(resolve(runtimeDir, 'server.log'), 'a');
    const child = spawn(process.execPath, [resolve(runtimeDir, 'server.mjs')], { cwd: runtimeDir, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
    closeSync(log);
    await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
    child.unref();
    let started = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const status = await health();
      if (status?.app === APP_ID) { started = true; break; }
      await delay(200);
    }
    if (!started) throw new Error('Startup failed. Check runtime/server.log and whether port 5317 is available.');
  }
  console.log(`SeqSketch: ${url}`);
  if (!process.argv.includes('--no-open')) {
    const command = process.platform === 'win32' ? 'powershell.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${url}'`] : [url];
    await new Promise(accept => execFile(command, args, { windowsHide: true }, error => {
      if (error) console.log(`Open this address in your browser: ${url}`);
      accept();
    }));
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
