/**
 * Progresso ao longo da pista — base do gap e da ordem AO VIVO.
 *
 * Com o traçado de referência do circuito, cada posição filtrada do kart é
 * projetada sobre a pista, gerando a distância percorrida desde a largada:
 *
 *     D = voltas_completas × L + distância_na_volta
 *
 * Assim dá para saber quem está na frente a qualquer momento (não só na linha)
 * e calcular o intervalo como na F1: "quanto tempo depois do kart da frente eu
 * passei por ESTE ponto da pista".
 */
import { fromXY, LatLng, toXY, XY } from './geo';
import { StartFinishLine } from './types';

export class TrackReference {
  readonly length: number;
  private readonly xy: XY[];
  private readonly cum: number[];
  private readonly origin: LatLng;

  constructor(path: LatLng[], line: StartFinishLine) {
    this.origin = { lat: line.lat, lng: line.lng };
    let pts = path.map((p) => toXY(this.origin, p));
    // remove fechamento duplicado
    if (pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1) pts.pop();

    // começa no ponto mais próximo da linha
    let iMin = 0;
    pts.forEach((p, i) => {
      if (Math.hypot(p.x, p.y) < Math.hypot(pts[iMin].x, pts[iMin].y)) iMin = i;
    });
    pts = [...pts.slice(iMin), ...pts.slice(0, iMin)];

    // garante o sentido de corrida
    if (line.bearing != null && pts.length > 3) {
      const b = (line.bearing * Math.PI) / 180;
      const k = Math.min(3, pts.length - 1);
      const dir = { x: pts[k].x - pts[0].x, y: pts[k].y - pts[0].y };
      if (dir.x * Math.sin(b) + dir.y * Math.cos(b) < 0) pts = [pts[0], ...pts.slice(1).reverse()];
    }
    pts.push(pts[0]);
    this.xy = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    this.length = this.cum[this.cum.length - 1];
  }

  /** Distância ao longo da pista [0, L) e afastamento lateral do ponto. */
  project(p: LatLng, hint: number | null = null, window = 90): { d: number; lateral: number } {
    const q = toXY(this.origin, p);
    const L = this.length;
    let best = { d: 0, lateral: Infinity };
    const scan = (useWindow: boolean) => {
      for (let i = 0; i < this.xy.length - 1; i++) {
        if (useWindow && hint != null) {
          const mid = (this.cum[i] + this.cum[i + 1]) / 2;
          let diff = Math.abs(mid - (((hint % L) + L) % L));
          diff = Math.min(diff, L - diff);
          if (diff > window) continue;
        }
        const a = this.xy[i];
        const b = this.xy[i + 1];
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const len2 = vx * vx + vy * vy || 1e-9;
        const u = Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / len2));
        const px = a.x + u * vx;
        const py = a.y + u * vy;
        const dist = Math.hypot(q.x - px, q.y - py);
        if (dist < best.lateral) best = { d: this.cum[i] + u * Math.sqrt(len2), lateral: dist };
      }
    };
    scan(hint != null);
    if (best.lateral > 30) scan(false);
    return { d: best.d % L, lateral: best.lateral };
  }

  pointAt(d: number): LatLng {
    const L = this.length;
    const dd = ((d % L) + L) % L;
    let i = 0;
    while (i < this.cum.length - 2 && this.cum[i + 1] < dd) i++;
    const f = (dd - this.cum[i]) / (this.cum[i + 1] - this.cum[i] || 1);
    const a = this.xy[i];
    const b = this.xy[i + 1];
    return fromXY(this.origin, { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
}

export interface LiveProgress {
  /** distância total percorrida desde a largada (m) */
  D: number;
  /** instante (ms, relógio do servidor) da amostra que gerou D */
  t: number;
  /** instante em que este piloto passou pela distância D (interpolado) */
  timeAt(D: number): number | null;
  /**
   * Distância percorrida no instante t (interpolada no histórico). Base da ordem
   * ao vivo: cada celular manda pontos em instantes diferentes, então comparar o
   * último D de cada um mistura "agora" com "1 s atrás" — a 50 km/h isso são ~14 m.
   */
  distanceAt(t: number): number | null;
}

/** Histórico (D, t) de um piloto — monotônico em D. */
export class ProgressTracker implements LiveProgress {
  private Ds: number[] = [];
  private Ts: number[] = [];
  private lastLaps = -1;
  private lastInLap = 0;
  private lastT = 0;
  D = 0;
  t = 0;

  get ready(): boolean {
    return this.Ds.length > 0;
  }

  reset(): void {
    this.Ds = [];
    this.Ts = [];
    this.lastLaps = -1;
    this.lastInLap = 0;
    this.lastT = 0;
    this.D = 0;
    this.t = 0;
  }

  /**
   * @param lapsDone voltas completas (passagens − 1); a amostra é posterior à última passagem
   * @param lastCrossingT instante da última passagem
   */
  update(ref: TrackReference, p: { lat: number; lng: number; t: number; speed: number | null }, lapsDone: number, lastCrossingT: number): void {
    const L = ref.length;
    const speed = p.speed ?? 0;
    let hint: number;
    if (lapsDone !== this.lastLaps) hint = (speed * (p.t - lastCrossingT)) / 1000;
    else hint = this.lastInLap + (speed * (p.t - this.lastT)) / 1000;
    const { d } = ref.project(p, hint);
    // escolhe d, d−L ou d+L — o mais coerente com a volta atual
    let inLap = d;
    for (const c of [d - L, d + L]) if (Math.abs(c - hint) < Math.abs(inLap - hint)) inLap = c;
    inLap = Math.max(-0.2 * L, Math.min(1.2 * L, inLap));

    this.lastLaps = lapsDone;
    this.lastInLap = inLap;
    this.lastT = p.t;

    const D = lapsDone * L + inLap;
    const prevD = this.Ds.length ? this.Ds[this.Ds.length - 1] : -Infinity;
    if (D > prevD) {
      this.Ds.push(D);
      this.Ts.push(p.t);
      this.D = D;
    }
    this.t = p.t;
  }

  distanceAt(t: number): number | null {
    const Ts = this.Ts;
    const n = Ts.length;
    if (!n) return null;
    if (t >= Ts[n - 1]) return this.Ds[n - 1];
    if (t <= Ts[0]) return this.Ds[0];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (Ts[mid] <= t) lo = mid;
      else hi = mid;
    }
    if (Ts[hi] === Ts[lo]) return this.Ds[lo];
    const f = (t - Ts[lo]) / (Ts[hi] - Ts[lo]);
    return this.Ds[lo] + f * (this.Ds[hi] - this.Ds[lo]);
  }

  timeAt(D: number): number | null {
    const Ds = this.Ds;
    const n = Ds.length;
    if (!n || D < Ds[0] || D > Ds[n - 1]) return null;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (Ds[mid] <= D) lo = mid;
      else hi = mid;
    }
    if (Ds[hi] === Ds[lo]) return this.Ts[lo];
    const f = (D - Ds[lo]) / (Ds[hi] - Ds[lo]);
    return Math.round(this.Ts[lo] + f * (this.Ts[hi] - this.Ts[lo]));
  }
}
