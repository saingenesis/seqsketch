import { getGeometry, type Geometry, type Project } from './model';

export type EditorState = { project: Project; past: Geometry[]; future: Geometry[] };
export type Action =
  | { type: 'geometry'; geometry: Geometry }
  | { type: 'metadata'; values: Partial<Pick<Project, 'title' | 'artistId' | 'sequenceUnit'>> }
  | { type: 'undo' | 'redo' }
  | { type: 'load'; project: Project };

export function editorReducer(state: EditorState, action: Action): EditorState {
  const updatedAt = new Date().toISOString();
  if (action.type === 'load') return { project: action.project, past: [], future: [] };
  if (action.type === 'metadata') return { ...state, project: { ...state.project, ...action.values, updatedAt } };
  if (action.type === 'geometry') return {
    project: { ...state.project, ...action.geometry, updatedAt },
    past: [...state.past.slice(-59), getGeometry(state.project)], future: [],
  };
  if (action.type === 'undo' && state.past.length) return {
    project: { ...state.project, ...state.past[state.past.length - 1], updatedAt },
    past: state.past.slice(0, -1), future: [getGeometry(state.project), ...state.future],
  };
  if (action.type === 'redo' && state.future.length) return {
    project: { ...state.project, ...state.future[0], updatedAt },
    past: [...state.past, getGeometry(state.project)], future: state.future.slice(1),
  };
  return state;
}
