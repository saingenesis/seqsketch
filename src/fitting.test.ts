import { beforeAll, expect, it } from 'vitest';
import paper from 'paper';
import { fitStroke } from './fitting';

beforeAll(() => { paper.setup(new paper.Size(800, 1000)); });

it('fits a continuous curved gesture into finite cubics without losing endpoints or direction', () => {
  const raw = Array.from({ length: 121 }, (_, i) => ({ x: 100 + i * 4, y: 400 + Math.sin(i / 12) * 120, t: i * 5 }));
  const curves = fitStroke(raw, 1.8);
  expect(curves.length).toBeGreaterThan(1);
  expect(curves[0][0]).toEqual([raw[0].x, raw[0].y]);
  expect(curves.at(-1)![3]).toEqual([raw.at(-1)!.x, raw.at(-1)!.y]);
  curves.forEach((c, i) => {
    expect(c.flat().every(Number.isFinite)).toBe(true);
    if (i) expect(curves[i - 1][3]).toEqual(c[0]);
  });
  expect(paper.project.activeLayer.children).toHaveLength(0);
});

it('handles a straight stroke and ignores stationary or subpixel input', () => {
  expect(fitStroke([{ x: 1, y: 1, t: 0 }, { x: 100, y: 100, t: 1 }], 1.8)).toHaveLength(1);
  expect(fitStroke([{ x: 1, y: 1, t: 0 }, { x: 1, y: 1, t: 1 }], 1.8)).toEqual([]);
  expect(fitStroke([{ x: 1, y: 1, t: 0 }, { x: 1.2, y: 1, t: 1 }], 1.8)).toEqual([]);
});
