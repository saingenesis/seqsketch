import { parseProject, survivingStrokeCount, type Project } from './model';

export type Summary = Pick<Project, 'id' | 'title' | 'artistId' | 'updatedAt' | 'source'> & { curveCount: number; strokeCount: number };
let database: Promise<IDBDatabase> | null = null;

function openDatabase() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('seqsketch', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('projects', { keyPath: 'id' });
      request.result.createObjectStore('summaries', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
    request.onblocked = () => { database = null; reject(new Error('本地存储被其他页面占用。')); };
  });
  return database;
}

export async function saveProject(project: Project) {
  const db = await openDatabase();
  const summary: Summary = {
    id: project.id, title: project.title, artistId: project.artistId, updatedAt: project.updatedAt,
    source: project.source, curveCount: project.curves.length, strokeCount: survivingStrokeCount(project),
  };
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(['projects', 'summaries'], 'readwrite');
    transaction.objectStore('projects').put(project);
    transaction.objectStore('summaries').put(summary);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('保存已中断。'));
  });
}

export async function loadProject(id: string) {
  const db = await openDatabase();
  const result = await new Promise<unknown>((resolve, reject) => {
    const req = db.transaction('projects', 'readonly').objectStore('projects').get(id);
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  return result ? parseProject(result) : null;
}

export async function listProjects(): Promise<Summary[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const req = db.transaction('summaries', 'readonly').objectStore('summaries').getAll();
    req.onsuccess = () => resolve((req.result as Summary[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    req.onerror = () => reject(req.error);
  });
}

export async function deleteProject(id: string) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(['projects', 'summaries'], 'readwrite');
    transaction.objectStore('projects').delete(id);
    transaction.objectStore('summaries').delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function saveExport(text: string, name: string, directory: string): Promise<string> {
  const response = await fetch('/__seqsketch_export', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ directory, name, text }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result.path;
}

export function safeFilename(project: Project) {
  return `${project.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 50)}_${project.id.slice(0, 8)}`;
}
