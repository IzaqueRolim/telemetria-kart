/**
 * Circuito sintético usado pelos testes e pelo simulador de karts. Não é usado em produção.
 *
 * Traçado de kartódromo montado em estacionamento de shopping (≈ 785 m, cabe em
 * 180 × 105 m): reta dos boxes, cotovelo à direita, sequência de grampos de
 * raio ≈ 6 m no fundo e um "zigue-zague" no miolo — os trechos paralelos ficam a
 * ≥ 17 m um do outro, mais que o erro típico do GPS de celular.
 * Eixos em metros: x = leste, y = norte; a largada está em (0,0) rumo leste.
 */
import { LatLng, XY, fromXY } from './geo';

const RAW: [number, number][] = [
  [45, 100], [110, 100], [150, 100], [175, 92], [185, 70], [185, 30], [180, 8], [166, -2], [152, 5],
  [148, 25], [135, 36], [122, 25], [120, 7], [106, -3], [92, 6], [90, 30], [77, 41], [64, 30], [60, 12],
  [45, 0], [25, 5], [10, 25], [12, 45], [30, 56], [70, 58], [96, 61], [107, 65], [110, 71], [106, 78],
  [96, 81], [60, 81], [24, 80], [13, 84], [10, 92], [16, 99], [28, 101],
];
// desloca para a largada (meio da reta dos boxes) ficar na origem
const WAYPOINTS: XY[] = RAW.map(([x, y]) => ({ x: x - 45, y: y - 100 }));

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
      const n = pathXY.length - 1;
      const i0 = (i - 2 + n) % n;
      const i1 = (i + 2) % n;
      let dh = Math.abs(headingAt(i1) - headingAt(i0));
      if (dh > 180) dh = 360 - dh;
      const span = ((cumulative[i1] - cumulative[i0] + length) % length) || seg;
      // curvatura em graus por metro (raio ≈ 57,3 / curvatura)
      return { xy, latLng: fromXY(origin, xy), heading: headingAt(i), curvature: dh / span };
    },
  };
}
