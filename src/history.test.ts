import { expect, it } from 'vitest';
import { editorReducer, type EditorState } from './history';
import { addStroke, createProject, removeCurves, type CubicPoints } from './model';

it('undoes complete gestures, preserves metadata, restores identities, and branches history', () => {
  let state: EditorState = { project: createProject('ARTIST'), past: [], future: [] };
  const points: CubicPoints = [[0, 0], [10, 10], [20, 10], [30, 0]];
  state = editorReducer(state, { type: 'geometry', geometry: addStroke(state.project, [{ x: 0, y: 0, t: 0 }], [points, points], state.project.createdAt) });
  const curves = state.project.curves;
  state = editorReducer(state, { type: 'metadata', values: { title: 'Named artwork' } });
  state = editorReducer(state, { type: 'undo' });
  expect(state.project.curves).toHaveLength(0);
  expect(state.project.strokes).toHaveLength(0);
  expect(state.project.title).toBe('Named artwork');
  state = editorReducer(state, { type: 'redo' });
  expect(state.project.curves).toBe(curves);
  state = editorReducer(state, { type: 'geometry', geometry: removeCurves(state.project, new Set([curves[0].id])) });
  state = editorReducer(state, { type: 'undo' });
  expect(state.project.curves).toBe(curves);
  state = editorReducer(state, { type: 'geometry', geometry: removeCurves(state.project, new Set([curves[1].id])) });
  expect(state.future).toHaveLength(0);
  expect(state.project.curves[0].id).toBe(curves[0].id);
});
