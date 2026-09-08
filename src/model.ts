export type Point = [number, number];
export type CubicPoints = [Point, Point, Point, Point];
export type RawPoint = { x: number; y: number; t: number };
export type SequenceUnit = 'curve' | 'stroke';
export type SequenceLine = { id: string; creationOrder: number; curves: Curve[] };
export type Curve = {
  id: string;
  strokeId: string;
  creationOrder: number;
  segmentIndex: number;
  points: CubicPoints;
};
export type Stroke = { id: string; order: number; startedAt: string; rawPoints: RawPoint[] };
export type Geometry = {
  curves: Curve[];
  strokes: Stroke[];
  nextCurveOrder: number;
  nextStrokeOrder: number;
};
export type Project = Geometry & {
  schemaVersion: 'seqsketch.project/1.1';
  sequenceUnit: SequenceUnit;
  id: string;
  title: string;
  artistId: string;
  createdAt: string;
  updatedAt: string;
  canvas: { width: number; height: number; strokeWidth: number };
  fittingTolerance: number;
  source: 'participant' | 'example';
};

export const LIMITS = { curves: 12000, strokes: 12000, rawPoints: 600000, fileBytes: 64 * 1024 * 1024 };
export const makeId = () => crypto.randomUUID();
export const orderedCurves = (project: Pick<Project, 'curves'>) => [...project.curves].sort((a, b) => a.creationOrder - b.creationOrder);
export const survivingStrokeCount = (project: Pick<Project, 'curves'>) => new Set(project.curves.map(c => c.strokeId)).size;
export const getGeometry = (p: Project): Geometry => ({ curves: p.curves, strokes: p.strokes, nextCurveOrder: p.nextCurveOrder, nextStrokeOrder: p.nextStrokeOrder });

export function sequenceLines(project: Pick<Project, 'curves' | 'strokes' | 'sequenceUnit'>): SequenceLine[] {
  const curves = orderedCurves(project);
  if (project.sequenceUnit === 'curve') return curves.map(c => ({ id: c.id, creationOrder: c.creationOrder, curves: [c] }));
  const groups = new Map<string, Curve[]>();
  for (const curve of curves) {
    const group = groups.get(curve.strokeId);
    if (group) group.push(curve); else groups.set(curve.strokeId, [curve]);
  }
  return [...project.strokes].sort((a, b) => a.order - b.order)
    .filter(s => groups.has(s.id)).map(s => ({ id: s.id, creationOrder: s.order, curves: groups.get(s.id)! }));
}

export function createProject(artistId: string, sequenceUnit: SequenceUnit = 'curve'): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: 'seqsketch.project/1.1', sequenceUnit, id: makeId(), title: '未命名素描', artistId,
    createdAt: now, updatedAt: now, canvas: { width: 800, height: 1000, strokeWidth: 1.5 },
    fittingTolerance: 1.8, source: 'participant', curves: [], strokes: [], nextCurveOrder: 0, nextStrokeOrder: 0,
  };
}

export function addStroke(project: Project, rawPoints: RawPoint[], segments: CubicPoints[], startedAt: string): Geometry {
  if (!segments.length) return getGeometry(project);
  if (project.curves.length + segments.length > LIMITS.curves) throw new Error('曲线数量已达到单件作品上限，请保存当前作品。');
  if (project.strokes.length >= LIMITS.strokes || rawPoints.length + project.strokes.reduce((n, s) => n + s.rawPoints.length, 0) > LIMITS.rawPoints) {
    throw new Error('采样数据已达到单件作品上限，请保存当前作品。');
  }
  const strokeId = makeId();
  return {
    curves: [...project.curves, ...segments.map((points, segmentIndex) => ({ id: makeId(), strokeId, creationOrder: project.nextCurveOrder + segmentIndex, segmentIndex, points }))],
    strokes: [...project.strokes, { id: strokeId, order: project.nextStrokeOrder, startedAt, rawPoints }],
    nextCurveOrder: project.nextCurveOrder + segments.length,
    nextStrokeOrder: project.nextStrokeOrder + 1,
  };
}

export function removeCurves(project: Project, ids: Set<string>): Geometry {
  // Raw input stays in the editable project; the research export filters deleted strokes.
  return { ...getGeometry(project), curves: project.curves.filter(c => !ids.has(c.id)) };
}

export function replaceCurve(project: Project, id: string, points: CubicPoints): Geometry {
  return { ...getGeometry(project), curves: project.curves.map(c => c.id === id ? { ...c, points } : c) };
}

export function dataset(project: Project) {
  const curves = orderedCurves(project);
  const strokeOrders = new Map(project.strokes.map(s => [s.id, s.order]));
  const strokeIndices = new Map<string, number>();
  for (const c of curves) if (!strokeIndices.has(c.strokeId)) strokeIndices.set(c.strokeId, strokeIndices.size);
  const round = (v: number) => Math.round(v * 1e8) / 1e8;
  const exportedCurves = curves.map((c, index) => ({
    id: c.id, sequence: index, creationOrder: c.creationOrder,
    strokeId: c.strokeId, strokeIndex: strokeIndices.get(c.strokeId)!, sourceStrokeOrder: strokeOrders.get(c.strokeId)!,
    sourceSegmentIndex: c.segmentIndex,
    isStrokeStart: index === 0 || curves[index - 1].strokeId !== c.strokeId,
    isStrokeEnd: index === curves.length - 1 || curves[index + 1].strokeId !== c.strokeId,
    points: c.points.map(([x, y]) => [round(x / project.canvas.width), round(y / project.canvas.height)]),
  }));
  const byId = new Map(exportedCurves.map(c => [c.id, c]));
  const lines = sequenceLines(project).map((line, sequence) => ({
    id: line.id, sequence, creationOrder: line.creationOrder,
    curves: line.curves.map(c => byId.get(c.id)!),
  }));
  return {
    schemaVersion: 'seqsketch.dataset/1.1', sequenceUnit: project.sequenceUnit,
    lineCount: lines.length, lines, sampleId: project.id, artistId: project.artistId,
    title: project.title, source: project.source, createdAt: project.createdAt, updatedAt: project.updatedAt,
    canvas: { width: project.canvas.width, height: project.canvas.height },
    style: { color: '#111111', opacity: 1, strokeWidth: project.canvas.strokeWidth, strokeWidthUnit: 'canvas' },
    coordinates: { origin: 'top-left', xScale: project.canvas.width, yScale: project.canvas.height, normalized: true, controlPointsMayExceedCanvas: true },
    curveType: 'cubic-bezier', sequenceBase: 0, ordering: 'original-creation-order-final-surviving-geometry',
    fitting: { algorithm: 'paper.js-path-simplify', libraryVersion: '0.12.18', tolerance: project.fittingTolerance, toleranceUnit: 'canvas' },
    curveCount: curves.length, strokeCount: strokeIndices.size,
    curves: exportedCurves,
  };
}

export function curvePath(points: CubicPoints) {
  const f = ([x, y]: Point) => `${+x.toFixed(4)} ${+y.toFixed(4)}`;
  return `M ${f(points[0])} C ${f(points[1])} ${f(points[2])} ${f(points[3])}`;
}

function xml(text: string) {
  return text.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));
}

export function exportSvg(project: Project) {
  const { width, height, strokeWidth } = project.canvas;
  const paths = sequenceLines(project).map((line, i) => `  <path id="${xml(line.id)}" data-sequence="${i}" data-stroke-id="${xml(line.curves[0].strokeId)}" d="${line.curves.map(c => curvePath(c.points)).join(' ')}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n<title>${xml(project.title)}</title>\n<metadata>${xml(JSON.stringify({ schemaVersion: 'seqsketch.svg/1.1', sequenceUnit: project.sequenceUnit, sampleId: project.id, artistId: project.artistId, source: project.source }))}</metadata>\n<g fill="none" stroke="#111111" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">\n${paths}\n</g>\n</svg>`;
}

export function parseProject(value: unknown): Project {
  const fail = (): never => { throw new Error('工程格式无效，或数据不符合当前版本。请选择序描工程 JSON。'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const p = value as Omit<Project, 'schemaVersion' | 'sequenceUnit'> & { schemaVersion: string; sequenceUnit?: SequenceUnit };
  const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const integer = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
  const str = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  const date = (v: unknown) => str(v, 64) && Number.isFinite(Date.parse(v as string));
  if (!['seqsketch.project/1.0', 'seqsketch.project/1.1'].includes(p.schemaVersion) || !str(p.id, 128) || !str(p.artistId, 64) || !str(p.title, 100)
    || !date(p.createdAt) || !date(p.updatedAt) || !['participant', 'example'].includes(p.source)
    || !p.canvas || p.canvas.width !== 800 || p.canvas.height !== 1000 || p.canvas.strokeWidth !== 1.5
    || !finite(p.fittingTolerance) || p.fittingTolerance < 0.1 || p.fittingTolerance > 20
    || !integer(p.nextCurveOrder) || !integer(p.nextStrokeOrder)
    || !Array.isArray(p.curves) || !Array.isArray(p.strokes)
    || p.curves.length > LIMITS.curves || p.strokes.length > LIMITS.strokes) return fail();
  const strokeIds = new Set<string>();
  const strokeOrders = new Set<number>();
  let rawCount = 0;
  for (const s of p.strokes) {
    if (!s || !str(s.id, 128) || strokeIds.has(s.id) || !integer(s.order) || strokeOrders.has(s.order)
      || s.order >= p.nextStrokeOrder || !date(s.startedAt) || !Array.isArray(s.rawPoints)) return fail();
    strokeIds.add(s.id); strokeOrders.add(s.order); rawCount += s.rawPoints.length;
    if (rawCount > LIMITS.rawPoints) return fail();
    let previousT = -1;
    for (const point of s.rawPoints) {
      if (!point || !finite(point.x) || !finite(point.y) || !finite(point.t)
        || point.x < 0 || point.x > p.canvas.width || point.y < 0 || point.y > p.canvas.height
        || point.t < previousT || point.t < 0) return fail();
      previousT = point.t;
    }
  }
  const ids = new Set<string>();
  const orders = new Set<number>();
  const segmentIds = new Set<string>();
  for (const c of p.curves) {
    const key = `${c?.strokeId}:${c?.segmentIndex}`;
    if (!c || !str(c.id, 128) || ids.has(c.id) || !strokeIds.has(c.strokeId)
      || !integer(c.creationOrder) || orders.has(c.creationOrder) || c.creationOrder >= p.nextCurveOrder
      || !integer(c.segmentIndex) || segmentIds.has(key) || !Array.isArray(c.points) || c.points.length !== 4) return fail();
    ids.add(c.id); orders.add(c.creationOrder); segmentIds.add(key);
    for (const point of c.points) if (!Array.isArray(point) || point.length !== 2 || point.some(v => !finite(v) || Math.abs(v) > 100000)) return fail();
  }
  let lastStrokeOrder = -1;
  let lastSegmentIndex = -1;
  const strokeOrderMap = new Map(p.strokes.map(s => [s.id, s.order]));
  for (const c of orderedCurves(p)) {
    const order = strokeOrderMap.get(c.strokeId)!;
    if (order < lastStrokeOrder || (order === lastStrokeOrder && c.segmentIndex <= lastSegmentIndex)) return fail();
    lastSegmentIndex = c.segmentIndex; lastStrokeOrder = order;
  }
  // Rebuild known fields to avoid retaining unrelated or untrusted input properties.
  return {
    schemaVersion: 'seqsketch.project/1.1', sequenceUnit: p.sequenceUnit ?? 'curve', id: p.id, title: p.title, artistId: p.artistId,
    createdAt: p.createdAt, updatedAt: p.updatedAt, source: p.source,
    canvas: { width: p.canvas.width, height: p.canvas.height, strokeWidth: p.canvas.strokeWidth }, fittingTolerance: p.fittingTolerance,
    nextCurveOrder: p.nextCurveOrder, nextStrokeOrder: p.nextStrokeOrder,
    curves: p.curves.map(c => ({ id: c.id, strokeId: c.strokeId, creationOrder: c.creationOrder, segmentIndex: c.segmentIndex, points: c.points.map(pt => [...pt]) as CubicPoints })),
    strokes: p.strokes.map(s => ({ id: s.id, order: s.order, startedAt: s.startedAt, rawPoints: s.rawPoints.map(pt => ({ x: pt.x, y: pt.y, t: pt.t })) })),
  };
}
