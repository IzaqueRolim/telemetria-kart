/**
 * Filtro de Kalman 2D (modelo de velocidade constante) para GPS de celular.
 *
 * Por que funciona: a POSIÇÃO do GPS de celular tem erro de 3–10 m, mas a
 * VELOCIDADE (medida por efeito Doppler) tem erro de ~0,1–0,5 m/s e não sofre
 * o mesmo desvio. Fundindo as duas, o traçado deixa de "serpentear" e o
 * instante de passagem pela linha fica bem mais estável.
 *
 * - Estado: [x, y, vx, vy] em metros num plano local.
 * - Ruído de medição da posição = precisão informada pelo aparelho.
 * - Rejeita outliers por distância de Mahalanobis (saltos de multipercurso).
 * - `smoothTrack` aplica também a passada para trás (suavizador RTS) — usada
 *   para desenhar o traçado do circuito e os relatórios, onde não há pressa.
 */
import { fromXY, LatLng, toXY } from './geo';
import { GpsSample } from './types';

type Vec4 = [number, number, number, number];
type Mat4 = number[][]; // 4x4

export interface KalmanOptions {
  /** desvio padrão da aceleração (m/s²) — karts fazem curvas de até ~2 g */
  accelStd: number;
  /** precisão mínima considerada (m), mesmo que o aparelho informe menos */
  minPosStd: number;
  /** precisão usada quando o aparelho não informa */
  defaultPosStd: number;
  /** erro da velocidade Doppler (m/s) */
  velStd: number;
  /** velocidade mínima para confiar no rumo (m/s) */
  minSpeedForHeading: number;
  /** limite de Mahalanobis² para aceitar a posição (2 g.l.; 13.8 ≈ 99,9%) */
  gate: number;
  /** descarta fixes com precisão pior que isso (m) */
  maxAccuracyM: number;
}

export const DEFAULT_KALMAN: KalmanOptions = {
  accelStd: 6,
  minPosStd: 2,
  defaultPosStd: 6,
  velStd: 0.3,
  minSpeedForHeading: 1.2,
  gate: 13.8,
  maxAccuracyM: 60,
};

const I4 = (): Mat4 => [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
];

function mul(a: Mat4, b: Mat4): Mat4 {
  const r: Mat4 = [[], [], [], []];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i][k] * b[k][j];
      r[i][j] = s;
    }
  return r;
}
function tr(a: Mat4): Mat4 {
  return a[0].map((_, j) => a.map((row) => row[j]));
}
function add(a: Mat4, b: Mat4): Mat4 {
  return a.map((row, i) => row.map((v, j) => v + b[i][j]));
}
function sub(a: Mat4, b: Mat4): Mat4 {
  return a.map((row, i) => row.map((v, j) => v - b[i][j]));
}
function mulVec(a: Mat4, v: Vec4): Vec4 {
  return a.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2] + row[3] * v[3]) as Vec4;
}
/** inversa 4x4 por Gauss-Jordan (matrizes de covariância são bem condicionadas) */
function inv4(m: Mat4): Mat4 {
  const a = m.map((r) => [...r]);
  const r = I4();
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let i = c + 1; i < 4; i++) if (Math.abs(a[i][c]) > Math.abs(a[p][c])) p = i;
    [a[c], a[p]] = [a[p], a[c]];
    [r[c], r[p]] = [r[p], r[c]];
    const d = a[c][c] || 1e-12;
    for (let j = 0; j < 4; j++) {
      a[c][j] /= d;
      r[c][j] /= d;
    }
    for (let i = 0; i < 4; i++) {
      if (i === c) continue;
      const f = a[i][c];
      for (let j = 0; j < 4; j++) {
        a[i][j] -= f * a[c][j];
        r[i][j] -= f * r[c][j];
      }
    }
  }
  return r;
}

/** Atualização escalar sequencial (componentes independentes) — evita inversões 2x2. */
function scalarUpdate(x: Vec4, P: Mat4, idx: number, z: number, r: number): { x: Vec4; P: Mat4; nis: number } {
  const S = P[idx][idx] + r;
  const y = z - x[idx];
  const K = [P[0][idx] / S, P[1][idx] / S, P[2][idx] / S, P[3][idx] / S];
  const nx = x.map((v, i) => v + K[i] * y) as Vec4;
  const nP = P.map((row, i) => row.map((v, j) => v - K[i] * P[idx][j]));
  return { x: nx, P: nP, nis: (y * y) / S };
}

export interface FilteredSample extends GpsSample {
  /** velocidade estimada (m/s) */
  vx: number;
  vy: number;
  /** desvio padrão estimado da posição (m) */
  posStd: number;
}

interface Step {
  t: number;
  xf: Vec4;
  Pf: Mat4;
  xp: Vec4;
  Pp: Mat4;
  F: Mat4;
  src: GpsSample;
}

export class GpsKalman {
  readonly opts: KalmanOptions;
  private origin: LatLng | null = null;
  private x: Vec4 = [0, 0, 0, 0];
  private P: Mat4 = I4();
  private t = 0;
  private rejectedInRow = 0;
  /** histórico para o suavizador (só quando `keepHistory`) */
  readonly steps: Step[] = [];

  constructor(
    opts: Partial<KalmanOptions> = {},
    private readonly keepHistory = false,
  ) {
    this.opts = { ...DEFAULT_KALMAN, ...opts };
  }

  reset(): void {
    this.origin = null;
    this.rejectedInRow = 0;
    this.steps.length = 0;
  }

  private posStd(p: GpsSample) {
    return Math.max(this.opts.minPosStd, p.accuracy ?? this.opts.defaultPosStd);
  }

  private velocityOf(p: GpsSample): [number, number] | null {
    if (p.speed == null || p.speed < 0) return null;
    if (p.speed < this.opts.minSpeedForHeading) return p.speed < 0.3 ? [0, 0] : null;
    if (p.heading == null || p.heading < 0) return null;
    const h = (p.heading * Math.PI) / 180;
    return [p.speed * Math.sin(h), p.speed * Math.cos(h)];
  }

  private init(p: GpsSample) {
    this.origin = { lat: p.lat, lng: p.lng };
    const v = this.velocityOf(p) ?? [0, 0];
    const s = this.posStd(p);
    this.x = [0, 0, v[0], v[1]];
    this.P = [
      [s * s, 0, 0, 0],
      [0, s * s, 0, 0],
      [0, 0, 25, 0],
      [0, 0, 0, 25],
    ];
    this.t = p.t;
    this.rejectedInRow = 0;
  }

  /** Processa um fix. Retorna a amostra filtrada, ou null se foi rejeitada. */
  push(p: GpsSample): FilteredSample | null {
    if (p.accuracy != null && p.accuracy > this.opts.maxAccuracyM) return null;
    if (!this.origin) {
      this.init(p);
      return this.emit(p, I4(), [...this.x] as Vec4, this.P);
    }
    const dt = (p.t - this.t) / 1000;
    if (dt <= 0) return null;
    if (dt > 15) {
      // lacuna longa (sem sinal): reinicia em vez de extrapolar
      const origin = this.origin;
      this.init(p);
      const xy = toXY(origin, p);
      this.origin = origin;
      this.x = [xy.x, xy.y, this.x[2], this.x[3]];
      return this.emit(p, I4(), [...this.x] as Vec4, this.P);
    }

    // ---- predição
    const F: Mat4 = [
      [1, 0, dt, 0],
      [0, 1, 0, dt],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    const q = this.opts.accelStd ** 2;
    const dt2 = dt * dt;
    const dt3 = dt2 * dt;
    const dt4 = dt3 * dt;
    const Q: Mat4 = [
      [(dt4 / 4) * q, 0, (dt3 / 2) * q, 0],
      [0, (dt4 / 4) * q, 0, (dt3 / 2) * q],
      [(dt3 / 2) * q, 0, dt2 * q, 0],
      [0, (dt3 / 2) * q, 0, dt2 * q],
    ];
    const xp = mulVec(F, this.x);
    const Pp = add(mul(mul(F, this.P), tr(F)), Q);

    // ---- validação (gate) da posição
    const z = toXY(this.origin, p);
    const r = this.posStd(p) ** 2;
    const dx = z.x - xp[0];
    const dy = z.y - xp[1];
    const nis = (dx * dx) / (Pp[0][0] + r) + (dy * dy) / (Pp[1][1] + r);
    if (nis > this.opts.gate * 2 && this.rejectedInRow < 3) {
      // outlier: mantém a predição, mas não avança o tempo da medição
      this.rejectedInRow++;
      return null;
    }
    this.rejectedInRow = 0;

    // ---- atualização: posição e velocidade Doppler
    let x = xp;
    let P = Pp;
    ({ x, P } = scalarUpdate(x, P, 0, z.x, r));
    ({ x, P } = scalarUpdate(x, P, 1, z.y, r));
    const v = this.velocityOf(p);
    if (v) {
      const rv = this.opts.velStd ** 2 + (0.03 * (p.speed ?? 0)) ** 2;
      ({ x, P } = scalarUpdate(x, P, 2, v[0], rv));
      ({ x, P } = scalarUpdate(x, P, 3, v[1], rv));
    }
    this.x = x;
    this.P = P;
    this.t = p.t;
    return this.emit(p, F, xp, Pp);
  }

  private emit(p: GpsSample, F: Mat4, xp: Vec4, Pp: Mat4): FilteredSample {
    if (this.keepHistory) {
      this.steps.push({ t: p.t, xf: [...this.x] as Vec4, Pf: this.P.map((r) => [...r]), xp, Pp, F, src: p });
    }
    return this.toSample(p, this.x, this.P);
  }

  private toSample(p: GpsSample, x: Vec4, P: Mat4): FilteredSample {
    const ll = fromXY(this.origin as LatLng, { x: x[0], y: x[1] });
    const speed = Math.hypot(x[2], x[3]);
    const heading = speed > 0.5 ? ((Math.atan2(x[2], x[3]) * 180) / Math.PI + 360) % 360 : p.heading;
    return {
      seq: p.seq,
      t: p.t,
      lat: ll.lat,
      lng: ll.lng,
      speed,
      heading,
      accuracy: Math.sqrt((P[0][0] + P[1][1]) / 2),
      vx: x[2],
      vy: x[3],
      posStd: Math.sqrt((P[0][0] + P[1][1]) / 2),
    };
  }

  /** Suavizador Rauch–Tung–Striebel sobre o histórico (requer keepHistory). */
  smoothed(): FilteredSample[] {
    const n = this.steps.length;
    if (!n || !this.origin) return [];
    const xs: Vec4[] = new Array(n);
    const Ps: Mat4[] = new Array(n);
    xs[n - 1] = this.steps[n - 1].xf;
    Ps[n - 1] = this.steps[n - 1].Pf;
    for (let k = n - 2; k >= 0; k--) {
      const cur = this.steps[k];
      const nxt = this.steps[k + 1];
      const C = mul(mul(cur.Pf, tr(nxt.F)), inv4(nxt.Pp));
      const dxs = xs[k + 1].map((v, i) => v - nxt.xp[i]) as Vec4;
      const corr = mulVec(C, dxs);
      xs[k] = cur.xf.map((v, i) => v + corr[i]) as Vec4;
      Ps[k] = add(cur.Pf, mul(mul(C, sub(Ps[k + 1], nxt.Pp)), tr(C)));
    }
    return this.steps.map((s, k) => this.toSample(s.src, xs[k], Ps[k]));
  }
}

/** Filtra (ida) e suaviza (volta) uma sequência inteira de fixes. */
export function smoothTrack(points: GpsSample[], opts: Partial<KalmanOptions> = {}): FilteredSample[] {
  const kf = new GpsKalman(opts, true);
  for (const p of points) kf.push(p);
  return kf.smoothed();
}
