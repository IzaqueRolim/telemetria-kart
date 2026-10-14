import { buildCircuit, GpsSample, toXY, fromXY } from '../src';

export const ORIGIN = { lat: -23.7, lng: -46.7 };
export const circuit = buildCircuit(ORIGIN);

/** Gera amostras de um kart dando `laps` voltas a velocidade constante. */
export function drive(opts: {
  laps: number;
  speedMs: number;
  hz?: number;
  t0?: number;
  startDist?: number;
  noiseM?: number;
  seed?: number;
}): GpsSample[] {
  const hz = opts.hz ?? 1;
  const t0 = opts.t0 ?? 1_000_000;
  let seed = opts.seed ?? 42;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296 - 0.5;
  };
  const start = opts.startDist ?? -20;
  const total = opts.laps * circuit.length + 60;
  const out: GpsSample[] = [];
  let seq = 0;
  for (let d = start, t = t0; d <= start + total; d += opts.speedMs / hz, t += 1000 / hz) {
    const pos = circuit.at(d);
    let ll = pos.latLng;
    if (opts.noiseM) {
      const xy = toXY(ORIGIN, ll);
      ll = fromXY(ORIGIN, { x: xy.x + rnd() * 2 * opts.noiseM, y: xy.y + rnd() * 2 * opts.noiseM });
    }
    out.push({ seq: seq++, t: Math.round(t), lat: ll.lat, lng: ll.lng, speed: opts.speedMs, heading: pos.heading, accuracy: 4 });
  }
  return out;
}

/** Gerador gaussiano determinístico. */
export function gauss(seed: number) {
  let s = seed >>> 0 || 1;
  const u = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

/**
 * GPS de celular realista: deriva correlacionada (Gauss–Markov, σ e τ) + ruído
 * branco, velocidade/rumo Doppler com erro pequeno.
 */
export function driveNoisy(opts: {
  laps: number;
  speedMs: number;
  hz?: number;
  t0?: number;
  startDist?: number;
  driftM?: number;
  whiteM?: number;
  tauS?: number;
  seed?: number;
  timeOffsetMs?: number;
}): { samples: GpsSample[]; truth: { x: number; y: number }[] } {
  const hz = opts.hz ?? 1;
  const g = gauss(opts.seed ?? 7);
  const drift = opts.driftM ?? 3;
  const white = opts.whiteM ?? 1.5;
  const tau = opts.tauS ?? 30;
  const dt = 1 / hz;
  const a = Math.exp(-dt / tau);
  const b = drift * Math.sqrt(1 - a * a);
  let ex = g() * drift;
  let ey = g() * drift;
  const start = opts.startDist ?? -20;
  const total = opts.laps * circuit.length + 60;
  const samples: GpsSample[] = [];
  const truth: { x: number; y: number }[] = [];
  let seq = 0;
  let t = (opts.t0 ?? 1_000_000) + (opts.timeOffsetMs ?? 0);
  for (let d = start; d <= start + total; d += opts.speedMs * dt, t += 1000 * dt) {
    const pos = circuit.at(d);
    ex = a * ex + b * g();
    ey = a * ey + b * g();
    const xy = { x: pos.xy.x + ex + g() * white, y: pos.xy.y + ey + g() * white };
    const ll = fromXY(ORIGIN, xy);
    truth.push(pos.xy);
    samples.push({
      seq: seq++,
      t: Math.round(t),
      lat: ll.lat,
      lng: ll.lng,
      speed: Math.max(0, opts.speedMs + g() * 0.2),
      heading: (pos.heading + g() * Math.min(20, (0.2 / Math.max(0.5, opts.speedMs)) * 57) + 360) % 360,
      accuracy: Math.round(Math.hypot(drift, white) * 1.4),
    });
  }
  return { samples, truth };
}
