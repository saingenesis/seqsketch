import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function handleExport(request, response) {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const { directory, name, text } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    await mkdir(directory, { recursive: true });
    const path = resolve(directory, name);
    await writeFile(path, text, 'utf8');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ path }));
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: error.message }));
  }
}
