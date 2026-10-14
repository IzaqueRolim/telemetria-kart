/**
 * Circuito sintético (≈ 900 m) usado pelos testes e pelo simulador de karts.
 * Não é usado em produção.
 */
import { LatLng, XY, fromXY } from './geo';

const WAYPOINTS: XY[] = [
  { x: 0, y: 0 },
  { x: 120, y: 0 },
  { x: 200, y: 5 },
  { x: 240, y: 35 },
  { x: 235, y: 80 },
  { x: 190, y: 105 },
  { x: 140, y: 90 },
  { x: 110, y: 60 },
  { x: 70, y: 70 },
  { x: 40, y: 110 },
  { x: -10, y: 115 },
  { x: -50, y: 90 },
  { x: -60, y: 45 },
  { x: -40, y: 10 },
];

function catmullRom(p0: XY, p1: XY, p2: XY, p3: XY, t: number): XY {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
}

export interface Circuit {
  origin: LatLng;
  pathXY: XY[];
  path: LatLng[];
  cumulative: number[];
  length: number;
  /** posição e rumo a `d` metros da linha de largada (d pode exceder uma volta) */
  at(d: number): { xy: XY; latLng: LatLng; heading: number; curvature: number };
}

export function buildCircuit(origin: LatLng, subdivisions = 12): Circuit {
  const n = WAYPOINTS.length;
  const pathXY: XY[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = WAYPOINTS[(i - 1 + n) % n];
    const p1 = WAYPOINTS[i];
    const p2 = WAYPOINTS[(i + 1) % n];
    const p3 = WAYPOINTS[(i + 2) % n];
    for (let s = 0; s < subdivisions; s++) pathXY.push(catmullRom(p0, p1, p2, p3, s / subdivisions));
  }
  pathXY.push(pathXY[0]);
  const cumulative = [0];
  for (let i = 1; i < pathXY.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(pathXY[i].x - pathXY[i - 1].x, pathXY[i].y - pathXY[i - 1].y));
  }
  const length = cumulative[cumulative.length - 1];
  const path = pathXY.map((p) => fromXY(origin, p));

  const headingAt = (i: number) => {
    const a = pathXY[i];
    const b = pathXY[Math.min(i + 1, pathXY.length - 1)];
    return ((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI + 360) % 360;
  };

  return {
    origin,
    pathXY,
    path,
    cumulative,
    length,
    at(d: number) {
      const dd = ((d % length) + length) % length;
      let i = 0;
      while (i < cumulative.length - 2 && cumulative[i + 1] < dd) i++;
      const seg = cumulative[i + 1] - cumulative[i] || 1;
      const f = (dd - cumulative[i]) / seg;
      const a = pathXY[i];
      const b = pathXY[i + 1];
      const xy = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      const h0 = headingAt(i);
      const h1 = headingAt(Math.min(i + 1, pathXY.length - 2));
      let dh = Math.abs(h1 - h0);
      if (dh > 180) dh = 360 - dh;
      return { xy, latLng: fromXY(origin, xy), heading: h0, curvature: dh / seg };
    },
  };
}
