import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import paper from 'paper';
import { orderedCurves, type CubicPoints, type Curve, type Point, type Project, type RawPoint } from './model';

export type Tool = 'draw' | 'select' | 'nodes' | 'erase' | 'pan';
export type CanvasApi = { fit: () => void; zoomBy: (factor: number) => void; cancel: () => void };
type Props = {
  project: Project; disabled: boolean; tool: Tool; selectedId: string | null; visibleCount: number;
  onSelect: (id: string | null) => void;
  onStroke: (points: RawPoint[], startedAt: string) => void;
  onEdit: (id: string, points: CubicPoints) => void;
  onErase: (ids: Set<string>) => void;
  onZoom: (zoom: number) => void;
  onBusy: (busy: boolean) => void;
};
type Gesture =
  | { kind: 'draw'; id: number; raw: RawPoint[]; startedAt: string; time: number; path: paper.Path }
  | { kind: 'edit'; id: number; curveId: string; original: CubicPoints; points: CubicPoints; anchor: Point; handle: number | null; moved: boolean }
  | { kind: 'erase'; id: number; removed: Set<string> }
  | { kind: 'pan'; id: number; from: Point; offset: Point };

export default forwardRef<CanvasApi, Props>(function Canvas(props, ref) {
  const element = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const coordinates = useRef<HTMLSpanElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const actions = useRef<CanvasApi>({ fit() {}, zoomBy() {}, cancel() {} });
  const redraw = useRef<() => void>(() => {});
  const resetView = useRef<() => void>(() => {});
  useImperativeHandle(ref, () => ({ fit: () => actions.current.fit(), zoomBy: f => actions.current.zoomBy(f), cancel: () => actions.current.cancel() }), []);

  useEffect(() => {
    const canvas = element.current!, container = host.current!;
    const scope = new paper.PaperScope();
    scope.setup(canvas); scope.view.autoUpdate = false;
    const background = new scope.Path.Rectangle(new scope.Rectangle(0, 0, 800, 1000));
    background.fillColor = new scope.Color('#ffffff');
    background.strokeColor = new scope.Color('#d3dad7'); background.strokeWidth = 1;
    background.shadowColor = new scope.Color(0, 0, 0, 0.07);
    background.shadowBlur = 18; background.shadowOffset = new scope.Point(0, 3);
    const artwork = new scope.Group();
    const preview = new scope.Group();
    const overlay = new scope.Group();
    const paths = new Map<string, { path: paper.Path; curve: Curve }>();
    let zoom = 0.5, offset: Point = [0, 0], autoFit = true, frame = 0, gesture: Gesture | null = null;
    let spaceDown = false, lastHit: { at: Point; ids: string[]; index: number } | null = null;
    let width = 0, height = 0;
    const touches = new Map<number, Point>();
    let pinch: { distance: number; zoom: number; world: Point } | null = null;

    function schedule() {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; scope.view.update(); });
    }
    function updateView() {
      scope.view.matrix = new scope.Matrix(zoom, 0, 0, zoom, offset[0], offset[1]);
      background.strokeWidth = 1 / zoom; background.shadowBlur = 18 / zoom;
      propsRef.current.onZoom(zoom); renderOverlay(); schedule();
    }
    function fit() {
      autoFit = true;
      zoom = Math.min((width - 72) / 800, (height - 56) / 1000);
      zoom = Math.max(0.08, zoom);
      offset = [(width - 800 * zoom) / 2, (height - 1000 * zoom) / 2];
      updateView();
    }
    function zoomAt(factor: number, screen: Point = [width / 2, height / 2]) {
      autoFit = false;
      const world: Point = [(screen[0] - offset[0]) / zoom, (screen[1] - offset[1]) / zoom];
      zoom = Math.max(0.08, Math.min(5, zoom * factor));
      offset = [screen[0] - world[0] * zoom, screen[1] - world[1] * zoom];
      updateView();
    }
    function local(e: PointerEvent | WheelEvent): Point {
      const rect = canvas.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top];
    }
    function world(e: PointerEvent | WheelEvent): Point {
      const p = local(e); return [(p[0] - offset[0]) / zoom, (p[1] - offset[1]) / zoom];
    }
    function bound(p: Point): Point { return [Math.max(0, Math.min(800, p[0])), Math.max(0, Math.min(1000, p[1]))]; }
    function inside(p: Point) { return p[0] >= 0 && p[0] <= 800 && p[1] >= 0 && p[1] <= 1000; }
    function setPoints(path: paper.Path, points: CubicPoints) {
      path.removeSegments();
      const [a, b, c, d] = points;
      path.add(new scope.Segment(new scope.Point(a), undefined, new scope.Point(b[0] - a[0], b[1] - a[1])));
      path.add(new scope.Segment(new scope.Point(d), new scope.Point(c[0] - d[0], c[1] - d[1]), undefined));
    }
    function makePath(points: CubicPoints, parent: paper.Group) {
      const path = new scope.Path({ insert: false });
      setPoints(path, points); path.strokeColor = new scope.Color('#111111');
      path.strokeWidth = 1.5; path.strokeCap = 'round'; parent.addChild(path); return path;
    }
    function renderOverlay() {
      overlay.removeChildren();
      const p = propsRef.current;
      const selected = p.selectedId ? paths.get(p.selectedId) : null;
      if (!selected || !selected.path.visible || p.visibleCount !== p.project.curves.length) return;
      const points = gesture?.kind === 'edit' && gesture.curveId === p.selectedId ? gesture.points : selected.curve.points;
      const outline = makePath(points, overlay);
      outline.strokeColor = new scope.Color('#23745e'); outline.strokeWidth = 2 / zoom;
      if (p.tool !== 'nodes') return;
      for (const [a, b] of [[0, 1], [3, 2]]) {
        const line = new scope.Path.Line(new scope.Point(points[a]), new scope.Point(points[b]));
        overlay.addChild(line); line.strokeColor = new scope.Color('#76a392');
        line.strokeWidth = 1 / zoom; line.dashArray = [3 / zoom, 3 / zoom];
      }
      points.forEach((point, i) => {
        const radius = (i === 0 || i === 3 ? 4.4 : 4) / zoom;
        const node = i === 0 || i === 3
          ? new scope.Path.Rectangle(new scope.Rectangle(point[0] - radius, point[1] - radius, radius * 2, radius * 2))
          : new scope.Path.Circle(new scope.Point(point), radius);
        overlay.addChild(node); node.fillColor = new scope.Color(i === 0 ? '#23745e' : '#ffffff');
        node.strokeColor = new scope.Color('#23745e'); node.strokeWidth = 1.3 / zoom;
      });
    }
    function render() {
      const p = propsRef.current, ids = new Set(p.project.curves.map(c => c.id));
      for (const [id, item] of paths) if (!ids.has(id)) { item.path.remove(); paths.delete(id); }
      orderedCurves(p.project).forEach((curve, index) => {
        let item = paths.get(curve.id);
        if (!item) { const path = makePath(curve.points, artwork); path.data.curveId = curve.id; item = { path, curve }; paths.set(curve.id, item); }
        else if (item.curve !== curve && !(gesture?.kind === 'edit' && gesture.curveId === curve.id)) { setPoints(item.path, curve.points); item.curve = curve; }
        item.path.visible = index < p.visibleCount && !(gesture?.kind === 'erase' && gesture.removed.has(curve.id));
      });
      renderOverlay(); schedule();
    }
    function hit(point: Point): string[] {
      const result = artwork.hitTestAll(new scope.Point(point), { stroke: true, fill: false, segments: false, tolerance: 5 / zoom });
      return [...new Set(result.map(r => r.item.data.curveId as string).filter(Boolean))];
    }
    function cancel() {
      if (gesture?.kind === 'edit') {
        const item = paths.get(gesture.curveId); if (item) setPoints(item.path, gesture.original);
      }
      if (gesture?.kind === 'draw') gesture.path.remove();
      gesture = null; propsRef.current.onBusy(false); render();
    }
    function capture(e: PointerEvent) { canvas.setPointerCapture(e.pointerId); propsRef.current.onBusy(true); }
    function pointerDown(e: PointerEvent) {
      if (propsRef.current.disabled) return;
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, local(e)); canvas.setPointerCapture(e.pointerId);
        if (gesture?.kind === 'draw' && e.pointerType === 'touch') return;
        if (touches.size === 2) {
          cancel(); const [a, b] = [...touches.values()];
          const center: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          pinch = { distance: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), zoom, world: [(center[0] - offset[0]) / zoom, (center[1] - offset[1]) / zoom] };
          return;
        }
      }
      if (gesture || (e.button !== 0 && e.button !== 1 && e.button !== 5)) return;
      e.preventDefault(); canvas.focus({ preventScroll: true }); const p = propsRef.current, point = world(e);
      const tool = spaceDown || e.button === 1 || e.pointerType === 'touch' ? 'pan' : e.button === 5 || (e.buttons & 32) ? 'erase' : p.tool;
      if (tool === 'pan') { gesture = { kind: 'pan', id: e.pointerId, from: local(e), offset: [...offset] }; capture(e); return; }
      if (p.visibleCount !== p.project.curves.length || ((tool === 'draw' || tool === 'erase') && !inside(point))) return;
      if (tool === 'draw') {
        const path = new scope.Path({ segments: [new scope.Point(point)], strokeColor: '#111111', strokeWidth: 1.5, strokeCap: 'round', insert: false });
        preview.addChild(path);
        gesture = { kind: 'draw', id: e.pointerId, raw: [{ x: point[0], y: point[1], t: 0 }], startedAt: new Date().toISOString(), time: e.timeStamp, path };
        p.onSelect(null); capture(e); schedule(); return;
      }
      if (tool === 'erase') { gesture = { kind: 'erase', id: e.pointerId, removed: new Set(hit(point)) }; capture(e); render(); return; }
      let handle: number | null = null;
      const selected = p.project.curves.find(c => c.id === p.selectedId);
      if (tool === 'nodes' && selected) {
        let min = 10 / zoom;
        selected.points.forEach((pt, i) => { const d = Math.hypot(pt[0] - point[0], pt[1] - point[1]); if (d < min) { min = d; handle = i; } });
      }
      let curve = handle !== null ? selected : undefined;
      if (!curve) {
        const hits = hit(point);
        if (hits.length) {
          const screen = local(e);
          const repeat = lastHit && Math.hypot(lastHit.at[0] - screen[0], lastHit.at[1] - screen[1]) < 4 && hits.join() === lastHit.ids.join();
          const index = repeat ? (lastHit!.index + 1) % hits.length : 0;
          lastHit = { at: screen, ids: hits, index };
          curve = p.project.curves.find(c => c.id === hits[index]);
        } else lastHit = null;
      }
      p.onSelect(curve?.id ?? null);
      if (curve) {
        gesture = { kind: 'edit', id: e.pointerId, curveId: curve.id, original: curve.points, points: curve.points, anchor: point, handle, moved: false };
        capture(e);
      }
    }
    function pointerMove(e: PointerEvent) {
      const point = world(e);
      if (coordinates.current) coordinates.current.textContent = inside(point) ? `${Math.round(point[0])}, ${Math.round(point[1])}` : '';
      if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
        touches.set(e.pointerId, local(e));
        if (pinch && touches.size === 2) {
          const [a, b] = [...touches.values()], center: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          zoom = Math.max(0.08, Math.min(5, pinch.zoom * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.distance));
          offset = [center[0] - pinch.world[0] * zoom, center[1] - pinch.world[1] * zoom]; autoFit = false; updateView(); return;
        }
      }
      if (!gesture || gesture.id !== e.pointerId) return;
      e.preventDefault();
      if (gesture.kind === 'pan') {
        const pt = local(e); offset = [gesture.offset[0] + pt[0] - gesture.from[0], gesture.offset[1] + pt[1] - gesture.from[1]];
        autoFit = false; updateView(); return;
      }
      if (gesture.kind === 'draw') {
        const events = e.getCoalescedEvents?.();
        for (const event of events?.length ? events : [e]) {
          if (gesture.raw.length >= 25000) break;
          const pt = bound(world(event)), last = gesture.raw[gesture.raw.length - 1];
          if (Math.hypot(pt[0] - last.x, pt[1] - last.y) < 0.05) continue;
          gesture.raw.push({ x: pt[0], y: pt[1], t: Math.max(last.t, event.timeStamp - gesture.time) });
          gesture.path.add(new scope.Point(pt));
        }
        schedule(); return;
      }
      if (gesture.kind === 'erase') {
        hit(point).forEach(id => gesture?.kind === 'erase' && gesture.removed.add(id)); render(); return;
      }
      const dx = point[0] - gesture.anchor[0], dy = point[1] - gesture.anchor[1];
      if (Math.hypot(dx, dy) * zoom < 2 && !gesture.moved) return;
      gesture.moved = true;
      const pts = gesture.original.map(pt => [...pt]) as CubicPoints;
      if (gesture.handle === null) {
        const xs = [pts[0][0], pts[3][0]], ys = [pts[0][1], pts[3][1]];
        const moveX = Math.max(-Math.min(...xs), Math.min(800 - Math.max(...xs), dx));
        const moveY = Math.max(-Math.min(...ys), Math.min(1000 - Math.max(...ys), dy));
        pts.forEach(pt => { pt[0] += moveX; pt[1] += moveY; });
      } else {
        const h = gesture.handle;
        const target: Point = h === 0 || h === 3 ? bound([pts[h][0] + dx, pts[h][1] + dy]) : [pts[h][0] + dx, pts[h][1] + dy];
        if (h === 0 || h === 3) { const adjacent = h === 0 ? 1 : 2; pts[adjacent][0] += target[0] - pts[h][0]; pts[adjacent][1] += target[1] - pts[h][1]; }
        pts[h] = target;
      }
      gesture.points = pts; const item = paths.get(gesture.curveId);
      if (item) setPoints(item.path, pts); renderOverlay(); schedule();
    }
    function pointerUp(e: PointerEvent) {
      touches.delete(e.pointerId);
      if (pinch) { pinch = null; cancel(); return; }
      if (!gesture || gesture.id !== e.pointerId) return;
      if (gesture.kind === 'draw' || gesture.kind === 'edit' || gesture.kind === 'erase') pointerMove(e);
      const completed = gesture; gesture = null; propsRef.current.onBusy(false);
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (completed.kind === 'draw') { completed.path.remove(); propsRef.current.onStroke(completed.raw, completed.startedAt); }
      if (completed.kind === 'edit' && completed.moved) propsRef.current.onEdit(completed.curveId, completed.points);
      if (completed.kind === 'erase' && completed.removed.size) propsRef.current.onErase(completed.removed);
      render();
    }
    function pointerCancel(e: PointerEvent) { touches.delete(e.pointerId); if (gesture?.id === e.pointerId) cancel(); pinch = null; }
    function wheel(e: WheelEvent) {
      e.preventDefault();
      if (gesture && gesture.kind !== 'pan') return;
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.008), local(e));
      else { offset = [offset[0] - e.deltaX, offset[1] - e.deltaY]; autoFit = false; updateView(); }
    }
    function keydown(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.closest('input, textarea, select, [role="dialog"]')) return;
      if (e.code === 'Space') { spaceDown = true; canvas.style.cursor = 'grab'; e.preventDefault(); }
      if (e.key === 'Escape') cancel();
    }
    function keyup(e: KeyboardEvent) { if (e.code === 'Space') { spaceDown = false; canvas.style.cursor = ''; } }
    function blur() { spaceDown = false; canvas.style.cursor = ''; touches.clear(); pinch = null; cancel(); }
    function contextmenu(e: Event) { e.preventDefault(); }
    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      width = rect.width; height = rect.height; scope.view.viewSize = new scope.Size(width, height);
      if (autoFit) fit(); else updateView();
    });
    observer.observe(container);
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerCancel);
    canvas.addEventListener('lostpointercapture', pointerCancel);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('contextmenu', contextmenu);
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur);
    actions.current = { fit, zoomBy: factor => zoomAt(factor), cancel };
    redraw.current = render; resetView.current = () => { cancel(); fit(); }; render();
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerCancel);
      canvas.removeEventListener('lostpointercapture', pointerCancel); canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('contextmenu', contextmenu);
      window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur);
      scope.project.remove();
    };
  }, []);

  useEffect(() => { redraw.current(); }, [props.project.curves, props.visibleCount, props.selectedId, props.tool]);
  useEffect(() => { resetView.current(); }, [props.project.id]);
  return <div ref={host} className="canvas-host" data-tool={props.tool} data-preview={props.visibleCount !== props.project.curves.length}>
    <canvas ref={element} tabIndex={0} aria-label="素描画布" />
    <span className="canvas-coordinates" ref={coordinates} aria-hidden="true" />
  </div>;
});
