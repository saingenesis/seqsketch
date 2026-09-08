import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine, Check, CheckCircle2, ChevronDown, Circle, CircleAlert, Download, Eraser,
  FileJson, FilePlus2, FolderOpen, Hand, HardDrive, Image, Layers3, Maximize, Minus,
  MousePointer2, PanelRightClose, PanelRightOpen, Pause, Pencil, Play, Plus, Redo2,
  RotateCcw, Save, SkipBack, SkipForward, Spline, Trash2, Undo2, X,
} from 'lucide-react';
import SketchCanvas, { type CanvasApi, type Tool } from './Canvas';
import { addStroke, createProject, curvePath, dataset, exportSvg, getGeometry, LIMITS, orderedCurves, parseProject, removeCurves, replaceCurve, sequenceLines, survivingStrokeCount, type CubicPoints, type Curve, type Geometry, type Point, type Project, type RawPoint, type SequenceLine, type SequenceUnit } from './model';
import { editorReducer } from './history';
import { fitStroke } from './fitting';
import { createExample } from './example';
import { deleteProject, saveExport, listProjects, loadProject, safeFilename, saveProject, type Summary } from './storage';

const tools: { id: Tool; label: string; icon: typeof Pencil }[] = [
  { id: 'draw', label: '自由手绘', icon: Pencil }, { id: 'select', label: '选择与移动', icon: MousePointer2 },
  { id: 'nodes', label: '曲线节点', icon: Spline }, { id: 'erase', label: '擦除线条', icon: Eraser }, { id: 'pan', label: '平移画布', icon: Hand },
];
const pad = (v: number) => String(v).padStart(3, '0');
const readableTime = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

function getArtist() {
  try {
    let id = localStorage.getItem('seqsketch.artist');
    if (!id) { id = `A-${crypto.randomUUID().slice(0, 6).toUpperCase()}`; localStorage.setItem('seqsketch.artist', id); }
    return id;
  } catch { return `A-${crypto.randomUUID().slice(0, 6).toUpperCase()}`; }
}

function IconButton({ label, children, active, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode; active?: boolean }) {
  return <button type="button" {...rest} className={`icon-button ${active ? 'active' : ''} ${className}`} aria-label={label} aria-pressed={active} data-tip={label}>{children}</button>;
}

function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const element = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = element.current!;
    (root.querySelector<HTMLElement>('button, input, [tabindex="0"]') ?? root).focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); }
      if (e.key === 'Tab') {
        const focusables = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select, [tabindex="0"]')];
        const first = focusables[0], last = focusables.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    root.addEventListener('keydown', keydown);
    return () => { root.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);
  return <div className="dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={element} tabIndex={-1}>
      <div className="dialog-heading"><h2>{title}</h2><IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton></div>
      {children}
    </div>
  </div>;
}

function CurveThumbnail({ curves }: { curves: Curve[] }) {
  const xs = curves.flatMap(c => c.points.map(p => p[0])), ys = curves.flatMap(c => c.points.map(p => p[1]));
  const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(12, Math.max(...xs) - minX), h = Math.max(12, Math.max(...ys) - minY);
  const margin = Math.max(w, h) * 0.1 + 2;
  return <svg aria-hidden="true" className="curve-thumbnail" viewBox={`${minX - margin} ${minY - margin} ${w + 2 * margin} ${h + 2 * margin}`}>
    <path d={curves.map(c => curvePath(c.points)).join(' ')} fill="none" stroke="currentColor" vectorEffect="non-scaling-stroke" strokeWidth="1.1" />
  </svg>;
}

function SequenceList({ lines, unit, selectedId, onSelect, visibleCount, strokeNumbers }: {
  lines: SequenceLine[]; unit: SequenceUnit; selectedId: string | null; onSelect: (id: string) => void; visibleCount: number; strokeNumbers: Map<string, number>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const itemHeight = 48;
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - 3);
  const end = Math.min(lines.length, start + Math.ceil(height / itemHeight) + 6);
  useEffect(() => {
    if (!host.current) return;
    const obs = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height)); obs.observe(host.current);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    const index = lines.findIndex(line => line.curves.some(c => c.id === selectedId)), el = host.current;
    if (index < 0 || !el) return;
    if (index * itemHeight < el.scrollTop) el.scrollTop = index * itemHeight;
    if ((index + 1) * itemHeight > el.scrollTop + el.clientHeight) el.scrollTop = (index + 1) * itemHeight - el.clientHeight;
  }, [selectedId, lines]);
  const previousCount = useRef(lines.length);
  useEffect(() => {
    if (lines.length > previousCount.current && host.current) host.current.scrollTop = host.current.scrollHeight;
    previousCount.current = lines.length;
    if (host.current && !lines.length) { host.current.scrollTop = 0; setScrollTop(0); }
  }, [lines.length]);
  return <div className="curve-list" ref={host} onScroll={e => setScrollTop(e.currentTarget.scrollTop)} aria-label="曲线列表">
    {!lines.length ? <div className="empty-list"><Spline size={27} strokeWidth={1.1} /><span>暂无线条</span><span className="empty-count">000</span></div>
      : <div style={{ height: lines.length * itemHeight, position: 'relative' }}>
        {lines.slice(start, end).map((line, localIndex) => {
          const index = start + localIndex;
          const curve = line.curves[0], selected = line.curves.some(c => c.id === selectedId);
          const label = unit === 'curve' ? '曲线' : '落笔';
          return <button key={line.id} className={`curve-row ${selected ? 'selected' : ''} ${index >= visibleCount ? 'unrevealed' : ''}`}
            style={{ top: index * itemHeight }} onClick={() => onSelect(curve.id)} aria-label={`选择${label} ${index + 1}`} aria-pressed={selected}>
            <span className="curve-number">{pad(index + 1)}</span><CurveThumbnail curves={line.curves} />
            <span className="curve-row-text"><span>{label} {pad(index + 1)}</span><small>{unit === 'curve' ? `落笔 ${pad((strokeNumbers.get(curve.strokeId) ?? 0) + 1)} · 第 ${curve.segmentIndex + 1} 段` : `${line.curves.length} 段曲线 · 原始落笔 ${line.creationOrder + 1}`}</small></span>
            <span className="row-dot" />
          </button>;
        })}
      </div>}
  </div>;
}

function PointFields({ curve, onEdit }: { curve: Curve; onEdit: (id: string, points: CubicPoints) => void }) {
  const [draft, setDraft] = useState(curve.points.map(pt => pt.map(v => v.toFixed(2))));
  useEffect(() => setDraft(curve.points.map(pt => pt.map(v => v.toFixed(2)))), [curve]);
  function commit(index: number, axis: number) {
    const v = Number(draft[index][axis]);
    if (!draft[index][axis].trim() || !Number.isFinite(v) || Math.abs(v) > 100000) { setDraft(curve.points.map(pt => pt.map(n => n.toFixed(2)))); return; }
    if (Math.abs(v - curve.points[index][axis]) < 0.005) return;
    const points = curve.points.map(pt => [...pt]) as CubicPoints; points[index][axis] = v; onEdit(curve.id, points);
  }
  return <div className="point-fields">
    <div className="point-columns"><span /><span>X</span><span>Y</span></div>
    {draft.map((pt, i) => <div className="point-row" key={i}>
      <label className={i === 0 || i === 3 ? 'endpoint' : ''}>P{i}</label>
      {pt.map((v, j) => <input key={j} type="number" step="0.25" aria-label={`P${i} ${j ? 'Y' : 'X'}`} value={v}
        onChange={e => setDraft(old => old.map((p, pi) => pi === i ? p.map((n, ni) => ni === j ? e.target.value : n) : p))}
        onBlur={() => commit(i, j)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />)}
    </div>)}
  </div>;
}

function MetadataField({ id, label, value, maxLength, onCommit }: { id: string; label: string; value: string; maxLength: number; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <><label className="field-label" htmlFor={id}>{label}</label><input id={id} maxLength={maxLength} value={draft}
    onChange={e => { setDraft(e.target.value); if (e.target.value.trim()) onCommit(e.target.value); }}
    onBlur={() => { const next = draft.trim() || value; setDraft(next); if (next !== value) onCommit(next); }} /></>;
}

export default function App() {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => ({ project: createProject(getArtist()), past: [], future: [] }));
  const { project } = state;
  const projectRef = useRef(project); projectRef.current = project;
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<Tool>('draw');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.5);
  const [busy, setBusy] = useState(false);
  const [sidebar, setSidebar] = useState(() => window.innerWidth >= 960);
  const [sideTab, setSideTab] = useState<'curves' | 'project'>('curves');
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<'export' | 'library' | null>(null);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [librarySearch, setLibrarySearch] = useState('');
  const [exportDirectory, setExportDirectory] = useState(() => localStorage.getItem('seqsketch.exportDirectory') ?? '');
  const [deleteTarget, setDeleteTarget] = useState<Summary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | 'error'>('saving');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(8);
  const canvasRef = useRef<CanvasApi>(null);
  const openInput = useRef<HTMLInputElement>(null);
  const saveRevision = useRef<Project | null>(null);
  const saveTimer = useRef<number>(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const ordered = useMemo(() => orderedCurves(project), [project.curves]);
  const lines = useMemo(() => sequenceLines(project), [project.curves, project.strokes, project.sequenceUnit]);
  const strokeNumbers = useMemo(() => new Map(project.strokes.map(s => [s.id, s.order])), [project.strokes]);
  const selectedCurve = useMemo(() => ordered.find(c => c.id === selectedId), [ordered, selectedId]);
  const selectedIndex = selectedCurve ? ordered.findIndex(c => c.id === selectedId) : -1;
  const selectedLine = lines.find(line => line.curves.some(c => c.id === selectedId));
  const visibleLineCount = previewCount === null ? lines.length : Math.min(previewCount, lines.length);
  const visibleCount = lines.slice(0, visibleLineCount).reduce((n, line) => n + line.curves.length, 0);
  const readOnly = visibleLineCount !== lines.length;
  const activeTool = tools.find(t => t.id === tool)!;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const activeId = localStorage.getItem('seqsketch.active');
        const loaded = activeId ? await loadProject(activeId) : null;
        if (!cancelled && loaded) { dispatch({ type: 'load', project: loaded }); saveRevision.current = loaded; }
      } catch { if (!cancelled) setError('未能恢复本地工程。可通过“打开工程”载入已保存的文件。'); }
      finally { if (!cancelled) setReady(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    setSaveStatus('saving');
    const timer = window.setTimeout(async () => {
      try {
        await saveProject(project);
        if (projectRef.current === project) {
          localStorage.setItem('seqsketch.active', project.id);
          saveRevision.current = project; setSaveStatus('saved');
        }
      } catch {
        if (projectRef.current === project) { setSaveStatus('error'); setError('本地自动保存失败。请立即保存工程文件，避免数据丢失。'); }
      }
    }, 650);
    saveTimer.current = timer;
    return () => window.clearTimeout(timer);
  }, [project, ready]);

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => { if (busy || saveRevision.current !== projectRef.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [busy]);

  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 3200); return () => clearTimeout(id); }, [toast]);
  useEffect(() => { if (selectedId && !project.curves.some(c => c.id === selectedId)) setSelectedId(null); }, [selectedId, project.curves]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('pointerdown', close); return () => document.removeEventListener('pointerdown', close);
  }, [menu]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setPreviewCount(count => {
      const next = (count ?? 0) + 1;
      if (next >= lines.length) { setPlaying(false); return null; }
      return next;
    }), 1000 / speed);
    return () => clearInterval(timer);
  }, [playing, speed, lines.length]);

  const resetPreview = useCallback(() => { setPlaying(false); setPreviewCount(null); }, []);
  const commitGeometry = useCallback((geometry: Geometry) => {
    resetPreview(); dispatch({ type: 'geometry', geometry });
  }, [resetPreview]);
  const onEdit = useCallback((id: string, points: CubicPoints) => {
    commitGeometry(replaceCurve(projectRef.current, id, points));
  }, [commitGeometry]);
  const onErase = useCallback((ids: Set<string>) => {
    commitGeometry(removeCurves(projectRef.current, ids));
  }, [commitGeometry]);
  const onStroke = useCallback((points: RawPoint[], startedAt: string) => {
    try {
      const p = projectRef.current, segments = fitStroke(points, p.fittingTolerance);
      if (!segments.length) { setToast('未记录过短的线条'); return; }
      commitGeometry(addStroke(p, points, segments, startedAt));
    } catch (e) { setError(e instanceof Error ? e.message : '笔画处理失败，请保存工程后重试。'); }
  }, [commitGeometry]);

  function changeTool(next: Tool) { canvasRef.current?.cancel(); resetPreview(); setTool(next); }
  async function writeExport(text: string, suffix: string) {
    if (!exportDirectory.trim()) { setDialog('export'); return; }
    try {
      const path = await saveExport(text, `${safeFilename(projectRef.current)}${suffix}`, exportDirectory.trim());
      setToast(`已保存到 ${path}`);
    } catch (e) {
      setError(`文件保存失败：${(e as Error).message}`);
    }
  }
  function saveFile() {
    setMenu(false);
    return writeExport(JSON.stringify(projectRef.current), '.seqsketch.json');
  }
  function changeSequenceUnit(sequenceUnit: SequenceUnit) {
    canvasRef.current?.cancel(); resetPreview(); setSelectedId(null);
    dispatch({ type: 'metadata', values: { sequenceUnit } });
  }
  async function switchProject(next: Project) {
    canvasRef.current?.cancel(); resetPreview(); setSelectedId(null); setMenu(false);
    try { await saveProject(projectRef.current); }
    catch { setError('当前作品未能保存，切换已取消。请先保存工程文件。'); return false; }
    dispatch({ type: 'load', project: next }); setDialog(null); setTool('draw'); setError('');
    return true;
  }
  async function openLibrary() {
    setMenu(false);
    try { await saveProject(projectRef.current); setSummaries(await listProjects()); setLibrarySearch(''); setDialog('library'); }
    catch { setError('无法读取本地作品库，请保存工程文件。'); }
  }
  async function confirmDelete() {
    const target = deleteTarget!;
    setDeleting(true);
    const deletingCurrent = target.id === projectRef.current.id;
    if (deletingCurrent) { window.clearTimeout(saveTimer.current); canvasRef.current?.cancel(); resetPreview(); }
    try {
      await deleteProject(target.id);
      const remaining = await listProjects();
      if (deletingCurrent) {
        const next = remaining.length ? (await loadProject(remaining[0].id))! : createProject(project.artistId, project.sequenceUnit);
        await saveProject(next);
        projectRef.current = next; saveRevision.current = next;
        localStorage.setItem('seqsketch.active', next.id);
        dispatch({ type: 'load', project: next }); setSelectedId(null); setTool('draw');
      }
      setSummaries(await listProjects()); setDeleteTarget(null); setToast('作品已删除');
    } catch { setError('作品删除失败。'); }
    finally { setDeleting(false); }
  }
  async function openFile(file: File) {
    setMenu(false);
    try {
      if (file.size > LIMITS.fileBytes) throw new Error('工程文件超过 64 MB。');
      const next = parseProject(JSON.parse(await file.text()));
      const existing = await loadProject(next.id);
      const current = projectRef.current.id === next.id ? projectRef.current : existing;
      if (current && Date.parse(current.updatedAt) > Date.parse(next.updatedAt)) {
        const confirmed = window.confirm('本地有这个作品的较新版本。仍要打开导入的版本吗？');
        if (!confirmed) return;
      }
      if (await switchProject(next)) setToast('工程已打开');
    } catch (e) { setError(e instanceof SyntaxError ? '文件不是有效的 JSON 工程。' : e instanceof Error ? e.message : '工程读取失败。'); }
  }
  function exportTraining() {
    if (!project.artistId.trim() || !project.title.trim()) { setError('请填写作品名称和匿名作者编号。'); return; }
    return writeExport(JSON.stringify(dataset(project), null, 2), `.${project.sequenceUnit}.dataset.json`);
  }
  function exportVector() {
    return writeExport(exportSvg(project), `.${project.sequenceUnit}.svg`);
  }
  function undo() { canvasRef.current?.cancel(); resetPreview(); dispatch({ type: 'undo' }); }
  function redo() { canvasRef.current?.cancel(); resetPreview(); dispatch({ type: 'redo' }); }

  const keyActions = useRef({ saveFile, undo, redo, changeTool, selectedId, dialog, menu, readOnly, ready, busy });
  keyActions.current = { saveFile, undo, redo, changeTool, selectedId, dialog, menu, readOnly, ready, busy };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const a = keyActions.current;
      if (a.dialog || !a.ready || a.busy) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); a.saveFile(); return; }
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? a.redo() : a.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); a.redo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); openInput.current?.click(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const shortcuts: Record<string, Tool> = { p: 'draw', v: 'select', a: 'nodes', e: 'erase', h: 'pan' };
      if (shortcuts[e.key.toLowerCase()]) { e.preventDefault(); a.changeTool(shortcuts[e.key.toLowerCase()]); }
      if (e.key === 'Escape') { setMenu(false); setSelectedId(null); }
      if (a.readOnly) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && a.selectedId) { e.preventDefault(); onErase(new Set([a.selectedId])); }
      if (e.key.startsWith('Arrow') && a.selectedId) {
        const c = projectRef.current.curves.find(c => c.id === a.selectedId); if (!c) return;
        e.preventDefault(); const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        onEdit(c.id, c.points.map(([x, y]) => [x + dx, y + dy]) as CubicPoints);
      }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [onErase, onEdit]);

  function selectCurve(id: string) { canvasRef.current?.cancel(); resetPreview(); setSelectedId(id); setTool('nodes'); }
  const filteredSummaries = summaries.filter(s => `${s.title} ${s.artistId}`.toLowerCase().includes(librarySearch.toLowerCase()));

  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><span className="brand-mark"><Spline size={23} strokeWidth={1.6} /></span><div><h1>序描</h1><span>SEQSKETCH</span></div></div>
      <div className="header-divider" />
      <div className="project-heading"><span className="project-kicker">{project.source === 'example' ? '内置示例' : '素描采集'}</span><span className="project-title">{project.title}</span></div>
      <div className={`save-status ${saveStatus}`} role="status">{saveStatus === 'saved' ? <CheckCircle2 size={14} /> : saveStatus === 'error' ? <CircleAlert size={14} /> : <span className="saving-dot" />}<span>{saveStatus === 'saved' ? '已在本机保存' : saveStatus === 'error' ? '保存失败' : ready ? '保存中' : '载入中'}</span></div>
      <div className="header-actions"><button className="text-button library-button" aria-label="作品库" onClick={openLibrary} disabled={!ready || busy}><FolderOpen size={17} /><span>作品库</span></button><button className="primary-button export-button" onClick={() => setDialog('export')} disabled={!ready || busy || !ordered.length}><Download size={16} /><span>导出数据</span></button></div>
    </header>

    <div className="command-bar">
      <div className="file-menu-container" ref={menuRef}>
        <button className={`text-button file-menu-button ${menu ? 'open' : ''}`} onClick={() => setMenu(!menu)} disabled={!ready || busy} aria-expanded={menu} aria-haspopup="menu"><FileJson size={16} /><span>作品</span><ChevronDown size={12} /></button>
        {menu && <div className="file-menu" role="menu">
          <button role="menuitem" onClick={() => void switchProject(createProject(project.artistId, project.sequenceUnit))}><FilePlus2 size={16} />新建作品</button>
          <button role="menuitem" onClick={() => { setMenu(false); openInput.current?.click(); }}><FolderOpen size={16} />打开工程</button>
          <button role="menuitem" onClick={saveFile}><Save size={16} />保存工程</button>
          <div className="menu-rule" />
          <button role="menuitem" onClick={() => { setMenu(false); exportVector(); }} disabled={!ordered.length}><Image size={16} />导出 SVG</button>
          <button role="menuitem" onClick={() => void switchProject({ ...createExample(project.artistId), sequenceUnit: project.sequenceUnit })}><Spline size={16} />载入人像示例</button>
        </div>}
      </div>
      <span className="toolbar-divider" />
      <IconButton label="保存工程" onClick={saveFile} disabled={!ready || busy}><Save size={17} /></IconButton>
      <IconButton label="撤销" onClick={undo} disabled={!state.past.length || busy}><Undo2 size={18} /></IconButton>
      <IconButton label="重做" onClick={redo} disabled={!state.future.length || busy}><Redo2 size={18} /></IconButton>
      <span className="toolbar-divider" />
      <div className="fixed-ink"><span className="ink-line" /><span>1.5 px</span></div>
      <div className="command-spacer" />
      <span className="canvas-format">800 × 1000</span>
      <IconButton label={sidebar ? '收起侧栏' : '展开侧栏'} onClick={() => setSidebar(!sidebar)} active={sidebar}>{sidebar ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</IconButton>
    </div>

    <div className="recording-bar"><span>记录模式</span><div className="mode-switch" role="group" aria-label="记录模式">
      <button aria-pressed={project.sequenceUnit === 'curve'} disabled={!ready || busy} onClick={() => changeSequenceUnit('curve')}><Spline size={14} />贝塞尔曲线</button>
      <button aria-pressed={project.sequenceUnit === 'stroke'} disabled={!ready || busy} onClick={() => changeSequenceUnit('stroke')}><Pencil size={14} />一次落笔</button>
    </div><span className="line-total">{lines.length} 条线</span></div>

    {error && <div className="error-banner" role="alert"><CircleAlert size={16} /><span>{error}</span><button onClick={saveFile}>保存工程</button><IconButton label="关闭提示" onClick={() => setError('')}><X size={16} /></IconButton></div>}

    <main className={`workspace ${sidebar ? 'sidebar-open' : ''}`}>
      <nav className="tool-rail" aria-label="绘图工具">
        <div className="primary-tools">{tools.map(({ id, label, icon: Icon }) => <IconButton key={id} label={label} active={tool === id} onClick={() => changeTool(id)} disabled={!ready}><Icon size={21} strokeWidth={1.65} /></IconButton>)}</div>
        <div className="rail-bottom"><span className="tool-rule" /><IconButton label="删除选中曲线" className="danger" disabled={!selectedId || busy || readOnly} onClick={() => selectedId && onErase(new Set([selectedId]))}><Trash2 size={19} /></IconButton></div>
      </nav>
      <section className="drawing-area" aria-label="绘图工作区">
        <div className="canvas-heading"><div><span className={`status-dot ${readOnly ? 'amber' : ''}`} /><span>{readOnly ? '顺序预览' : activeTool.label}</span>{project.source === 'example' && <span className="example-tag">示例</span>}</div><span>画布 01</span></div>
        <SketchCanvas ref={canvasRef} project={project} disabled={!ready || dialog !== null} tool={tool} selectedId={selectedId} visibleCount={visibleCount}
          onSelect={setSelectedId} onStroke={onStroke} onEdit={onEdit} onErase={onErase} onZoom={setZoom} onBusy={setBusy} />
        <div className="canvas-statusbar">
          <div className="drawing-count"><span data-testid="curve-count">{ordered.length}</span> 段曲线 <span className="status-separator">/</span> <span data-testid="stroke-count">{survivingStrokeCount(project)}</span> 次落笔</div>
          <div className="zoom-controls"><IconButton label="缩小" onClick={() => canvasRef.current?.zoomBy(1 / 1.2)}><Minus size={15} /></IconButton><button className="zoom-value" onClick={() => canvasRef.current?.fit()} aria-label="缩放比例，点击适应画布">{Math.round(zoom * 100)}%</button><IconButton label="放大" onClick={() => canvasRef.current?.zoomBy(1.2)}><Plus size={15} /></IconButton><IconButton label="适应画布" onClick={() => canvasRef.current?.fit()}><Maximize size={15} /></IconButton></div>
        </div>
        <div className={`sequence-bar ${readOnly || playing ? 'preview-active' : ''}`}>
          <div className="playback-controls"><IconButton label="回到序列开头" onClick={() => { canvasRef.current?.cancel(); setPlaying(false); setSelectedId(null); setPreviewCount(0); }} disabled={!ordered.length || busy}><SkipBack size={16} /></IconButton>
            <IconButton label={playing ? '暂停预览' : '播放绘制顺序'} className="play-button" onClick={() => { canvasRef.current?.cancel(); setSelectedId(null); if (!playing && visibleLineCount >= lines.length) setPreviewCount(0); setPlaying(!playing); }} disabled={!ordered.length || busy}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</IconButton>
            <IconButton label="显示完整作品" onClick={resetPreview} disabled={!ordered.length || busy}><SkipForward size={16} /></IconButton>
          </div>
          <input className="sequence-slider" type="range" min="0" max={Math.max(1, lines.length)} step="1" value={visibleLineCount} aria-label="绘制顺序进度" disabled={!ordered.length || busy}
            style={{ '--progress': `${lines.length ? visibleLineCount / lines.length * 100 : 0}%` } as React.CSSProperties}
            onChange={e => { setPlaying(false); setSelectedId(null); const n = Number(e.target.value); setPreviewCount(n === lines.length ? null : n); }} />
          <span className="sequence-counter">{pad(visibleLineCount)} <span>/ {pad(lines.length)}</span></span>
          <select value={speed} onChange={e => setSpeed(Number(e.target.value))} aria-label="预览速度">{[4, 8, 16, 32].map(n => <option key={n} value={n}>{n} 条/s</option>)}</select>
        </div>
      </section>

      {sidebar && <aside className="inspector" aria-label="作品侧栏">
        <div className="side-tabs" role="tablist"><button role="tab" aria-selected={sideTab === 'curves'} onClick={() => setSideTab('curves')}><Layers3 size={15} />绘制序列<span>{lines.length}</span></button><button role="tab" aria-selected={sideTab === 'project'} onClick={() => setSideTab('project')}><FileJson size={15} />作品</button></div>
        {sideTab === 'curves' ? <>
          <div className="list-heading"><span>{project.sequenceUnit === 'curve' ? '曲线' : '落笔'}</span><span>创建顺序 <ArrowDownToLine size={12} /></span></div>
          <SequenceList key={`${project.id}-${project.sequenceUnit}`} lines={lines} unit={project.sequenceUnit} selectedId={selectedId} onSelect={selectCurve} visibleCount={visibleLineCount} strokeNumbers={strokeNumbers} />
          {selectedCurve && !readOnly ? <section className="curve-inspector"><div className="section-heading"><h2>曲线 {pad(selectedIndex + 1)}</h2><div><IconButton label="取消选择" onClick={() => setSelectedId(null)}><X size={15} /></IconButton><IconButton label="删除当前曲线" className="danger" onClick={() => onErase(new Set([selectedCurve.id]))}><Trash2 size={15} /></IconButton></div></div>
            {project.sequenceUnit === 'stroke' && <select className="segment-select" aria-label="落笔内曲线" value={selectedId!} onChange={e => selectCurve(e.target.value)}>{selectedLine!.curves.map(c => <option key={c.id} value={c.id}>第 {c.segmentIndex + 1} 段曲线</option>)}</select>}
            <PointFields curve={selectedCurve} onEdit={onEdit} /><div className="curve-origin"><span>原始序号</span><span>{selectedCurve.creationOrder + 1}</span></div></section>
            : <div className="sequence-summary"><span className="black-dot" /><span>三次贝塞尔</span><span className="summary-right">黑色 · 不透明</span></div>}
        </> : <div className="project-properties">
          <section><h2>作品信息</h2><MetadataField key={`${project.id}-title`} id="title" label="作品名称" maxLength={100} value={project.title} onCommit={title => dispatch({ type: 'metadata', values: { title } })} />
            <MetadataField key={`${project.id}-artist`} id="artist" label="匿名作者编号" maxLength={64} value={project.artistId} onCommit={artistId => { dispatch({ type: 'metadata', values: { artistId } }); try { localStorage.setItem('seqsketch.artist', artistId); } catch { /* Export remains available without local storage. */ } }} />
            <dl className="properties"><dt>作品编号</dt><dd className="mono" title={project.id}>{project.id.slice(0, 8)}</dd><dt>创建时间</dt><dd>{readableTime(project.createdAt)}</dd><dt>数据来源</dt><dd>{project.source === 'example' ? '内置合成示例' : '参与者绘制'}</dd></dl>
          </section>
          <section><h2>画布</h2><dl className="properties"><dt>尺寸</dt><dd>800 × 1000</dd><dt>线宽</dt><dd>1.5 px</dd><dt>线条颜色</dt><dd><span className="black-dot" />黑色</dd><dt>不透明度</dt><dd>100%</dd></dl></section>
          <section><h2>采集统计</h2><div className="stat-pair"><div><strong>{ordered.length}</strong><span>保留曲线</span></div><div><strong>{survivingStrokeCount(project)}</strong><span>保留落笔</span></div></div><dl className="properties"><dt>原始采样点</dt><dd>{project.strokes.reduce((n, s) => n + s.rawPoints.length, 0).toLocaleString()}</dd><dt>坐标系</dt><dd>左上角原点</dd></dl></section>
          <div className="local-badge"><HardDrive size={15} /><span>本机作品库</span></div>
        </div>}
      </aside>}
    </main>

    <input type="file" ref={openInput} accept=".json,application/json" className="hidden" aria-label="打开工程文件" onChange={e => { const f = e.target.files?.[0]; if (f) void openFile(f); e.currentTarget.value = ''; }} />
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    {dialog === 'export' && <Dialog title="导出作品" onClose={() => setDialog(null)}>
      <div className="export-body"><div className="export-project"><div className="export-icon"><Spline size={24} /></div><div><h3>{project.title}</h3><span>{project.artistId} · {project.id.slice(0, 8)}</span></div></div>
        {project.source === 'example' && <div className="example-notice"><CircleAlert size={16} />数据来源：内置合成示例</div>}
        <dl className="export-facts"><div><dt>记录模式</dt><dd>{project.sequenceUnit === 'curve' ? '贝塞尔曲线' : '一次落笔'}</dd></div><div><dt>序列线条</dt><dd>{lines.length}</dd></div><div><dt>顺序</dt><dd>最初创建顺序</dd></div><div><dt>坐标</dt><dd>归一化</dd></div></dl>
        <label className="field-label" htmlFor="export-directory">导出文件夹</label><input id="export-directory" className="export-directory" value={exportDirectory} placeholder="例如 D:\素描数据" onChange={e => { setExportDirectory(e.target.value); localStorage.setItem('seqsketch.exportDirectory', e.target.value); }} />
        <div className="export-destination-note">同名文件将更新</div>
        <div className="export-options"><button disabled={!exportDirectory.trim() || !ordered.length} onClick={exportTraining}><FileJson size={21} /><span><strong>训练数据</strong><small>JSON · {project.sequenceUnit === 'curve' ? '按曲线排列' : '按落笔分组'}</small></span><Download size={17} /></button><button disabled={!exportDirectory.trim() || !ordered.length} onClick={exportVector}><Image size={21} /><span><strong>矢量作品</strong><small>SVG · 最终保留线条</small></span><Download size={17} /></button><button disabled={!exportDirectory.trim()} onClick={saveFile}><Save size={21} /><span><strong>完整工程</strong><small>JSON · 曲线与原始采样点</small></span><Download size={17} /></button></div>
      </div><div className="dialog-footer"><button className="text-button" onClick={() => setDialog(null)}>完成</button></div>
    </Dialog>}
    {dialog === 'library' && !deleteTarget && <Dialog title="本机作品库" onClose={() => setDialog(null)} wide>
      <div className="library-toolbar"><input value={librarySearch} onChange={e => setLibrarySearch(e.target.value)} placeholder="搜索作品或作者编号" aria-label="搜索作品" /><button className="primary-button" onClick={() => void switchProject(createProject(project.artistId, project.sequenceUnit))}><Plus size={16} />新建作品</button></div>
      <div className="library-list"><div className="library-labels"><span>作品</span><span>曲线</span><span>更新</span><span>操作</span></div>
        {filteredSummaries.length ? filteredSummaries.map(s => <div key={s.id} className="library-row"><button className="library-open" aria-label={`打开作品 ${s.title}`} onClick={async () => { try { const p = await loadProject(s.id); if (p) await switchProject(p); else setError('这件作品无法读取。'); } catch { setError('这件作品的数据无效，请尝试打开工程备份。'); } }}>
          <span className="library-title"><span>{s.title}{s.id === project.id && <span className="current-tag">当前</span>}</span><small>{s.artistId}{s.source === 'example' ? ' · 示例' : ''}</small></span><span>{s.curveCount}</span><time>{readableTime(s.updatedAt)}</time>
        </button><IconButton label={`删除作品 ${s.title}`} className="danger" onClick={() => setDeleteTarget(s)}><Trash2 size={16} /></IconButton></div>) : <div className="library-empty">没有匹配的作品</div>}
      </div><div className="dialog-footer"><span>{summaries.length} 件作品</span><button className="text-button" onClick={() => { setDialog(null); openInput.current?.click(); }}><FolderOpen size={16} />打开工程文件</button></div>
    </Dialog>}
    {deleteTarget && <Dialog title="删除作品" onClose={() => setDeleteTarget(null)}>
      <div className="delete-body"><p>{deleteTarget.title}</p><span>将从本机作品库中删除，已导出的文件不受影响。</span></div>
      <div className="dialog-footer"><button className="text-button" disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</button><button className="delete-button" disabled={deleting} onClick={confirmDelete}><Trash2 size={16} />{deleting ? '删除中' : '删除作品'}</button></div>
    </Dialog>}
  </div>;
}
