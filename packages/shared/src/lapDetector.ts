import { haversine } from './geo';
import { GpsKalman, KalmanOptions } from './kalman';
import { segmentCrossesLine, toLineFrame } from './line';
import { Crossing, GpsSample, Lap, StartFinishLine } from './types';

export interface LapDetectorOptions {
  /** Descarta amostras com precisão pior que isso (m). */
  maxAccuracyM: number;
  /** Descarta saltos que implicariam velocidade acima disso (m/s). ~200 km/h. */
  maxImpliedSpeedMs: number;
  /** Tempo mínimo de volta (ms) — evita contagem dupla. */
  minLapMs: number;
  /** Distância mínima percorrida entre passagens (m). */
  minLapDistanceM: number;
  /** Depois de cruzar, é preciso se afastar isto do centro da linha para "rearmar". */
  rearmDistanceM: number;
  /** Ignora pontos anteriores a este instante (largada autorizada pelo criador). */
  startAfterT: number;
  /**
   * Na largada, um kart parado logo DEPOIS da linha (ex.: o próprio criador, cuja
   * posição define a linha, com ruído de GPS) conta a largada ao começar a andar.
   */
  startToleranceM: number;
  /** Filtra os fixes com Kalman (posição + velocidade Doppler) antes de detectar. */
  smoothing: boolean;
  kalman?: Partial<KalmanOptions>;
}

export const DEFAULT_DETECTOR_OPTIONS: LapDetectorOptions = {
  maxAccuracyM: 30,
  maxImpliedSpeedMs: 55,
  minLapMs: 10_000,
  minLapDistanceM: 100,
  rearmDistanceM: 25,
  startAfterT: 0,
  startToleranceM: 6,
  smoothing: true,
};

export interface CrossingEvent {
  type: 'crossing';
  crossing: Crossing;
  /** volta recém-completada (ausente na passagem de largada) */
  lap?: Lap;
}

/**
 * Detector incremental de voltas. Determinístico: os mesmos pontos com a mesma
 * linha produzem as mesmas voltas — por isso roda tanto no celular (feedback
 * imediato, inclusive offline) quanto no servidor (fonte oficial da classificação).
 *
 * Proteções contra oscilação do GPS:
 *  - filtro de Kalman (posição + velocidade Doppler) com rejeição de outliers;
 *  - filtro de precisão e de saltos impossíveis;
 *  - só conta cruzamento no sentido de corrida (produto escalar positivo);
 *  - histerese: após uma passagem, só rearma depois de se afastar `rearmDistanceM`;
 *  - tempo e distância mínimos entre passagens.
 */
export class LapDetector {
  readonly opts: LapDetectorOptions;
  private line: StartFinishLine | null;
  private prev: GpsSample | null = null;
  private armed = true;
  private _crossings: Crossing[] = [];
  private _laps: Lap[] = [];
  private _distanceSinceCrossing = 0;
  private _maxSpeedMs = 0;
  private _lastSpeedMs: number | null = null;
  private _accepted = 0;
  private _rejected = 0;
  private kf: GpsKalman | null;

  constructor(line: StartFinishLine | null, opts: Partial<LapDetectorOptions> = {}) {
    this.line = line;
    this.opts = { ...DEFAULT_DETECTOR_OPTIONS, ...opts };
    this.kf = this.opts.smoothing ? new GpsKalman(this.opts.kalman) : null;
  }

  get crossings(): readonly Crossing[] {
    return this._crossings;
  }
  get laps(): readonly Lap[] {
    return this._laps;
  }
  /** última amostra aceita (já filtrada quando `smoothing` está ligado) */
  get lastSample(): GpsSample | null {
    return this.prev;
  }
  get distanceSinceCrossing(): number {
    return this._distanceSinceCrossing;
  }
  get maxSpeedMs(): number {
    return this._maxSpeedMs;
  }
  get currentSpeedMs(): number | null {
    return this._lastSpeedMs;
  }
  get hasStarted(): boolean {
    return this._crossings.length > 0;
  }
  get lastCrossingT(): number | null {
    return this._crossings.length ? this._crossings[this._crossings.length - 1].t : null;
  }
  get stats() {
    return { accepted: this._accepted, rejected: this._rejected };
  }
  get bestLap(): Lap | null {
    let best: Lap | null = null;
    for (const l of this._laps) if (!best || l.timeMs < best.timeMs) best = l;
    return best;
  }

  /** Troca a linha e reinicia o estado — o chamador deve reprocessar os pontos. */
  reset(line: StartFinishLine | null, startAfterT?: number): void {
    this.line = line;
    if (startAfterT != null) this.opts.startAfterT = startAfterT;
    this.prev = null;
    this.armed = true;
    this._crossings = [];
    this._laps = [];
    this._distanceSinceCrossing = 0;
    this._maxSpeedMs = 0;
    this._lastSpeedMs = null;
    this._accepted = 0;
    this._rejected = 0;
    this.kf?.reset();
  }

  push(raw: GpsSample): CrossingEvent | null {
    if (raw.t < this.opts.startAfterT) return null;
    let p: GpsSample = raw;
    if (this.kf) {
      const f = this.kf.push(raw);
      if (!f) {
        this._rejected++;
        return null;
      }
      p = f;
    } else if (raw.accuracy != null && raw.accuracy > this.opts.maxAccuracyM) {
      this._rejected++;
      return null;
    }
    const prev = this.prev;
    let segDist = 0;
    if (prev) {
      const dt = p.t - prev.t;
      if (dt <= 0) {
        this._rejected++;
        return null;
      }
      segDist = haversine(prev, p);
      if (segDist / (dt / 1000) > this.opts.maxImpliedSpeedMs) {
        this._rejected++;
        return null; // salto impossível: ruído de GPS
      }
      const derived = segDist / (dt / 1000);
      const speed = p.speed != null && p.speed >= 0 ? p.speed : derived;
      this._lastSpeedMs = speed;
      if (speed > this._maxSpeedMs && speed <= this.opts.maxImpliedSpeedMs) this._maxSpeedMs = speed;
    } else if (p.speed != null && p.speed >= 0) {
      this._lastSpeedMs = p.speed;
    }
    this._accepted++;

    let event: CrossingEvent | null = null;
    const line = this.line;
    if (line && line.bearing != null) {
      if (!this.armed && haversine(line, p) >= this.opts.rearmDistanceM) this.armed = true;
      if (prev && this.armed) {
        const hit = segmentCrossesLine(line, prev, p);
        if (hit) event = this.tryRegister(hit.t, this.uncertainty(prev, p, segDist), segDist * hit.fraction);
        else if (!this._crossings.length) {
          const a = toLineFrame(line, prev);
          const b = toLineFrame(line, p);
          if (
            a.along > 0 &&
            a.along <= this.opts.startToleranceM &&
            Math.abs(a.lateral) <= line.halfWidthM &&
            b.along > a.along + 0.5
          ) {
            event = this.tryRegister(prev.t, this.uncertainty(prev, p, segDist), 0);
          }
        }
      }
    }

    this._distanceSinceCrossing += segDist;
    this.prev = p;
    return event;
  }

  pushMany(points: Iterable<GpsSample>): CrossingEvent[] {
    const out: CrossingEvent[] = [];
    for (const p of points) {
      const e = this.push(p);
      if (e) out.push(e);
    }
    return out;
  }

  /**
   * Incerteza estimada de um cruzamento (ms): erro de posição do GPS dividido
   * pela velocidade, limitado à metade do intervalo entre as amostras.
   */
  private uncertainty(a: GpsSample, b: GpsSample, segDist: number): number {
    const dt = b.t - a.t;
    const speed = segDist / Math.max(0.001, dt / 1000);
    const acc = ((a.accuracy ?? 5) + (b.accuracy ?? 5)) / 2;
    const byPosition = speed > 0.5 ? (acc / speed) * 1000 : dt / 2;
    return Math.max(1, Math.round(Math.min(dt / 2, byPosition)));
  }

  private tryRegister(t: number, uncertaintyMs: number, distBeforeLine: number): CrossingEvent | null {
    const last = this._crossings[this._crossings.length - 1];
    const distSince = this._distanceSinceCrossing + distBeforeLine;
    if (last) {
      if (t - last.t < this.opts.minLapMs) return null;
      if (distSince < this.opts.minLapDistanceM) return null;
    }
    const crossing: Crossing = {
      index: this._crossings.length,
      t,
      uncertaintyMs,
    };
    this._crossings.push(crossing);
    this.armed = false;
    // a distância da volta nova começa no ponto exato da linha
    this._distanceSinceCrossing = -distBeforeLine;

    let lap: Lap | undefined;
    if (last) {
      lap = {
        number: crossing.index,
        startT: last.t,
        endT: t,
        timeMs: t - last.t,
        uncertaintyMs: last.uncertaintyMs + crossing.uncertaintyMs,
      };
      this._laps.push(lap);
    }
    return { type: 'crossing', crossing, lap };
  }
}

/** Atalho para reprocessar um histórico inteiro (servidor e redefinição de linha). */
export function detectLaps(
  points: Iterable<GpsSample>,
  line: StartFinishLine | null,
  opts: Partial<LapDetectorOptions> = {},
): LapDetector {
  const d = new LapDetector(line, opts);
  d.pushMany(points);
  return d;
}
