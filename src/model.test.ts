import { describe, expect, it } from 'vitest';
import { addStroke, createProject, dataset, exportSvg, parseProject, removeCurves, replaceCurve, sequenceLines, type CubicPoints, type Project } from './model';
import { createExample } from './example';

const a: CubicPoints = [[80, 100], [160, 150], [240, 150], [320, 100]];
const b: CubicPoints = [[320, 100], [400, 50], [480, 50], [560, 100]];
const raw = [{ x: 80, y: 100, t: 0 }, { x: 320, y: 100, t: 80 }];
function fixture() {
  let p = createProject('TEST-ARTIST');
  p = { ...p, ...addStroke(p, raw, [a, b], p.createdAt) };
  return { ...p, ...addStroke(p, raw, [a], p.createdAt) };
}

describe('research sequence', () => {
  it('switches sequence units without changing geometry or original identities', () => {
    const p = fixture();
    const curves = dataset(p);
    const strokes = dataset({ ...p, sequenceUnit: 'stroke' });
    expect(curves.sequenceUnit).toBe('curve');
    expect(curves.lines.map(line => line.curves.length)).toEqual([1, 1, 1]);
    expect(strokes).toMatchObject({ sequenceUnit: 'stroke', lineCount: 2 });
    expect(strokes.lines.map(line => line.curves.length)).toEqual([2, 1]);
    expect(strokes.lines.map(line => line.sequence)).toEqual([0, 1]);
    expect(strokes.lines.flatMap(line => line.curves)).toEqual(curves.curves);
    expect(sequenceLines({ ...p, sequenceUnit: 'stroke' })[0].curves).toEqual(p.curves.slice(0, 2));
  });

  it('keeps partial strokes grouped and omits wholly deleted strokes', () => {
    let p = { ...fixture(), sequenceUnit: 'stroke' as const };
    const strokeId = p.strokes[0].id;
    p = { ...p, ...replaceCurve(p, p.curves[1].id, a) };
    p = { ...p, ...removeCurves(p, new Set([p.curves[0].id])) };
    p.curves.reverse();
    expect(dataset(p).lines[0]).toMatchObject({ id: strokeId, sequence: 0, creationOrder: 0, curves: [{ sourceSegmentIndex: 1 }] });
    p = { ...p, ...removeCurves(p, new Set(p.curves.filter(c => c.strokeId === strokeId).map(c => c.id))) };
    expect(dataset(p).lines).toHaveLength(1);
    expect(dataset(p).lines[0]).toMatchObject({ sequence: 0, creationOrder: 1 });
  });

  it('exports one SVG path per pen gesture without bridging edited or deleted segments', () => {
    const p = { ...fixture(), sequenceUnit: 'stroke' as const };
    const svg = exportSvg(p);
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).toContain('data-sequence="0"');
    expect(svg).toContain('M 80 100 C 160 150 240 150 320 100 M 320 100');
  });

  it('imports old projects in curve mode and round-trips both new modes', () => {
    const p = fixture();
    const { sequenceUnit: _unit, ...legacy } = p;
    expect(parseProject({ ...legacy, schemaVersion: 'seqsketch.project/1.0' })).toEqual(p);
    expect(parseProject({ ...p, sequenceUnit: 'stroke' })).toEqual({ ...p, sequenceUnit: 'stroke' });
    expect(dataset(createProject('TEST', 'stroke')).lines).toEqual([]);
  });

  it('preserves creation order and identities after edits, removals, and new input', () => {
    let p = fixture();
    const original = p.curves[1];
    const edited: CubicPoints = [[320, 110], [400, -50], [480, 60], [560, 110]];
    p = { ...p, ...replaceCurve(p, original.id, edited) };
    p = { ...p, ...removeCurves(p, new Set([p.curves[0].id])) };
    p = { ...p, ...addStroke(p, raw, [b], p.createdAt) };
    p.curves.reverse();
    const output = dataset(p);
    expect(output.curves.map(c => c.sequence)).toEqual([0, 1, 2]);
    expect(output.curves.map(c => c.creationOrder)).toEqual([1, 2, 3]);
    expect(output.curves[0]).toMatchObject({ id: original.id, strokeId: original.strokeId, sourceSegmentIndex: 1, isStrokeStart: true, isStrokeEnd: true });
    expect(output.curves[0].points).toEqual([[0.4, 0.11], [0.5, -0.05], [0.6, 0.06], [0.7, 0.11]]);
    expect(p.strokes[0].rawPoints).toEqual(raw);
    expect(JSON.stringify(output)).not.toContain('rawPoints');
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('preserves pen-down groups and direction while excluding deleted groups', () => {
    let p = fixture();
    const output = dataset(p);
    expect(output.curves.map(c => [c.strokeIndex, c.isStrokeStart, c.isStrokeEnd])).toEqual([[0, true, false], [0, false, true], [1, true, true]]);
    expect(output.curves[0].points[3]).toEqual(output.curves[1].points[0]);
    p = { ...p, ...removeCurves(p, new Set(p.curves.slice(0, 2).map(c => c.id))) };
    expect(dataset(p)).toMatchObject({ curveCount: 1, strokeCount: 1 });
    expect(dataset(p).curves[0]).toMatchObject({ sequence: 0, creationOrder: 2, strokeIndex: 0, sourceStrokeOrder: 1 });
  });

  it('exports each surviving cubic as its own ordered SVG path and escapes metadata', () => {
    const p = fixture(); p.title = '<script>"&';
    const svg = exportSvg(p);
    expect(svg.match(/<path /g)).toHaveLength(3);
    expect(svg).toContain('&lt;script&gt;&quot;&amp;');
    expect(svg.indexOf(p.curves[0].id)).toBeLessThan(svg.indexOf(p.curves[1].id));
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('<image');
  });

  it('marks synthetic examples explicitly and supports empty final geometry', () => {
    const example = createExample('TEST');
    expect(parseProject(example)).toEqual(example);
    expect(dataset(example).source).toBe('example');
    expect(example.curves.length).toBeGreaterThan(150);
    expect(dataset(createProject('TEST'))).toMatchObject({ curveCount: 0, strokeCount: 0, curves: [] });
  });
});

describe('project validation', () => {
  const invalid: [string, (p: Project) => void][] = [
    ['duplicate identity', p => { p.curves[1].id = p.curves[0].id; }],
    ['duplicate order', p => { p.curves[1].creationOrder = p.curves[0].creationOrder; }],
    ['dangling stroke', p => { p.curves[0].strokeId = 'missing'; }],
    ['nonfinite geometry', p => { p.curves[0].points[1][0] = Infinity; }],
    ['reversed source segments', p => { p.curves[0].segmentIndex = 2; }],
    ['reversed stroke order', p => { p.strokes[0].order = 1; p.strokes[1].order = 0; }],
    ['decreasing sample time', p => { p.strokes[0].rawPoints[1].t = -1; }],
    ['raw sample outside canvas', p => { p.strokes[0].rawPoints[0].x = -1; }],
    ['non-monotonic next sequence', p => { p.nextCurveOrder = 1; }],
    ['empty artist', p => { p.artistId = '   '; }],
    ['unsupported canvas', p => { p.canvas.width = 400; }],
  ];
  it.each(invalid)('rejects %s', (_, change) => {
    const p = structuredClone(fixture()); change(p); expect(() => parseProject(p)).toThrow();
  });
  it('rejects training data and removes unrelated project fields', () => {
    const p = fixture();
    expect(() => parseProject(dataset(p))).toThrow();
    expect(parseProject({ ...p, extra: 'discard', canvas: { ...p.canvas, extra: 'discard' } })).toEqual(p);
  });
});
