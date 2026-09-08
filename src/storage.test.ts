import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { createProject } from './model';
import { deleteProject, listProjects, loadProject, saveProject } from './storage';

it('deletes both stored geometry and its library entry while preserving other projects', async () => {
  const removed = createProject('DELETE-TEST');
  const kept = createProject('KEEP-TEST', 'stroke');
  await saveProject(removed);
  await saveProject(kept);
  await deleteProject(removed.id);
  expect(await loadProject(removed.id)).toBeNull();
  expect((await listProjects()).map(p => p.id)).not.toContain(removed.id);
  expect(await loadProject(kept.id)).toEqual(kept);
});
