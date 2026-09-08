import paper from 'paper';
import type { CubicPoints, RawPoint } from './model';

export function fitStroke(rawPoints: RawPoint[], tolerance: number): CubicPoints[] {
  const points = rawPoints.filter((p, i) => !i || Math.hypot(p.x - rawPoints[i - 1].x, p.y - rawPoints[i - 1].y) > 0.05);
  if (points.length < 2) return [];
  const path = new paper.Path({ segments: points.map(p => [p.x, p.y]), insert: false });
  if (path.length < 0.75) { path.remove(); return []; }
  path.simplify(tolerance);
  const curves: CubicPoints[] = path.curves.map(curve => {
    const a = curve.segment1, b = curve.segment2;
    return [
      [a.point.x, a.point.y], [a.point.x + a.handleOut.x, a.point.y + a.handleOut.y],
      [b.point.x + b.handleIn.x, b.point.y + b.handleIn.y], [b.point.x, b.point.y],
    ];
  });
  path.remove();
  return curves;
}
