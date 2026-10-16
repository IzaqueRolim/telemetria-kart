import { describe, expect, it } from 'vitest';
import {
  computeStandings,
  createLine,
  detectLaps,
  FixTimeMapper,
  GpsKalman,
  LapDetector,
  LiveOrder,
  ProgressTracker,
  smoothTrack,
  toXY,
  TrackReference,
} from '../src';
import { circuit, driveNoisy, ORIGIN } from './helpers';

const line = createLine({ lat: ORIGIN.lat, lng: ORIGIN.lng, speed: 10, heading: 90 }, 1);

function lateralRms(points: { lat: number; lng: number }[], truth: { x: number; y: number }[]) {
  let s = 0;
  points.forEach((p, i) => {
    const q = toXY(ORIGIN, p);
    s += (q.x - truth[i].x) ** 2 + (q.y - truth[i].y) ** 2;
  });
  return Math.sqrt(s / points.length);
}

describe('filtro de Kalman', () => {
  it('reduz o erro do traçado (kart a 1 Hz)', () => {
    const { samples, truth } = driveNoisy({ laps: 2, speedMs: 15, hz: 1, driftM: 1.5, whiteM: 3, seed: 3 });
    const kf = new GpsKalman();
    const filtered = samples.map((p) => kf.push(p)!);
    const smooth = smoothTrack(samples);
    const raw = lateralRms(samples, truth);
    expect(lateralRms(filtered, truth)).toBeLessThan(raw * 0.85);
    expect(lateralRms(smooth, truth)).toBeLessThan(raw * 0.7);
  });

  it('caminhando devagar, o traçado suavizado não serpenteia', () => {
    const { samples, truth } = driveNoisy({ laps: 0.4, speedMs: 1.4, hz: 1, driftM: 2, whiteM: 3, seed: 11 });
    const raw = lateralRms(samples, truth);
    expect(lateralRms(smoothTrack(samples), truth)).toBeLessThan(raw * 0.75);
  });
});

describe('detecção com ruído realista', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`kart, 1 Hz, ruído de celular (seed ${seed}) conta todas as voltas`, () => {
      const { samples } = driveNoisy({ laps: 4, speedMs: 16, hz: 1, driftM: 3, whiteM: 2.5, seed });
      const d = detectLaps(samples, line);
      expect(d.laps.length).toBe(4);
      // limite físico: ~3 m de erro ao longo da pista ÷ 16 m/s ≈ 0,2 s por passagem
      const expected = (circuit.length / 16) * 1000;
      for (const l of d.laps) expect(Math.abs(l.timeMs - expected)).toBeLessThan(650);
    });
  }

  it('a pé (1,4 m/s) com GPS ruim conta as voltas', () => {
    const { samples } = driveNoisy({ laps: 2, speedMs: 1.4, hz: 1, driftM: 4, whiteM: 4, seed: 9 });
    expect(detectLaps(samples, line).laps.length).toBe(2);
  });

  it('dois celulares lado a lado têm o mesmo tempo de passagem', () => {
    const a = driveNoisy({ laps: 3, speedMs: 15, hz: 1, seed: 21 });
    const b = driveNoisy({ laps: 3, speedMs: 15, hz: 1, seed: 22, timeOffsetMs: 400 });
    const da = detectLaps(a.samples, line);
    const db = detectLaps(b.samples, line);
    // 400 ms de defasagem entre amostragens + erros independentes de ~3 m em cada aparelho
    da.crossings.forEach((c, i) => expect(Math.abs(c.t - db.crossings[i].t)).toBeLessThan(700));
  });
});

describe('base de tempo do GPS', () => {
  it('corrige celular com relógio do sistema 55 s adiantado', () => {
    const m = new FixTimeMapper();
    let out = 0;
    for (let i = 0; i < 20; i++) {
      const gps = 1_000_000 + i * 1000; // tempo real (satélite)
      const recv = gps + 55_000 + 80 + (i % 3) * 40; // relógio do celular + latência
      out = m.map(gps, recv);
    }
    expect(Math.abs(out - (1_000_000 + 19 * 1000 + 55_000))).toBeLessThan(100);
  });

  it('não mexe quando o fix já vem no relógio do celular', () => {
    const m = new FixTimeMapper();
    for (let i = 0; i < 10; i++) expect(m.map(5000 + i * 1000, 5000 + i * 1000 + 120)).toBe(5000 + i * 1000);
  });
});

describe('gap e ordem ao vivo', () => {
  const ref = new TrackReference(circuit.path, line);

  function track(samples: ReturnType<typeof driveNoisy>['samples']) {
    const det = new LapDetector(line);
    const prog = new ProgressTracker();
    for (const s of samples) {
      const before = det.stats.accepted;
      det.push(s);
      if (det.stats.accepted > before && det.hasStarted) {
        prog.update(ref, det.lastSample!, det.crossings.length - 1, det.lastCrossingT!);
      }
    }
    return { det, prog };
  }

  it('mede o intervalo no meio da volta (kart 2 s atrás)', () => {
    const a = driveNoisy({ laps: 2.5, speedMs: 15, hz: 1, seed: 31 });
    const b = driveNoisy({ laps: 2.5, speedMs: 15, hz: 1, seed: 32, timeOffsetMs: 2000 });
    const cut = (s: typeof a.samples, t: number) => s.filter((p) => p.t <= t);
    const tNow = 1_000_000 + 2.3 * (circuit.length / 15) * 1000; // no meio da 3ª volta
    const A = track(cut(a.samples, tNow));
    const B = track(cut(b.samples, tNow));
    const rows = computeStandings(
      [
        { pilotId: 'A', name: 'A', number: 1, color: '', crossings: A.det.crossings.map((c) => c.t), progress: A.prog },
        { pilotId: 'B', name: 'B', number: 2, color: '', crossings: B.det.crossings.map((c) => c.t), progress: B.prog },
      ],
      ref.length,
    );
    expect(rows[0].pilotId).toBe('A');
    expect(rows[1].liveGaps).toBe(true);
    expect(Math.abs((rows[1].gapAhead?.ms ?? 0) - 2000)).toBeLessThan(350);
  });

  it('mostra a ultrapassagem antes da linha de chegada', () => {
    // B larga 1 s atrás mas é 10% mais rápido: passa A no meio da 2ª volta
    const a = driveNoisy({ laps: 3, speedMs: 14, hz: 1, seed: 41 });
    const b = driveNoisy({ laps: 3, speedMs: 15.4, hz: 1, seed: 42, timeOffsetMs: 1000 });
    const L = circuit.length;
    const tNow = 1_000_000 + 1000 + ((1.6 * L + 20) / 15.4) * 1000; // B em 1,6 voltas
    const cut = (s: typeof a.samples) => s.filter((p) => p.t <= tNow);
    const A = track(cut(a.samples));
    const B = track(cut(b.samples));
    const rows = computeStandings(
      [
        { pilotId: 'A', name: 'A', number: 1, color: '', crossings: A.det.crossings.map((c) => c.t), progress: A.prog },
        { pilotId: 'B', name: 'B', number: 2, color: '', crossings: B.det.crossings.map((c) => c.t), progress: B.prog },
      ],
      ref.length,
    );
    expect(A.det.laps.length).toBe(B.det.laps.length);
    expect(rows[0].pilotId).toBe('B');
  });
});

describe('ordem ao vivo com karts colados', () => {
  const ref = new TrackReference(circuit.path, line);

  /** Simula o servidor: cada celular entrega lotes a cada ~1 s, em instantes diferentes. */
  function race(gapM: number, speedMs: number, seeds: [number, number], useOrder: boolean) {
    const offset = (gapM / speedMs) * 1000;
    const a = driveNoisy({ laps: 4, speedMs, hz: 1, seed: seeds[0] }).samples;
    const b = driveNoisy({ laps: 4, speedMs, hz: 1, seed: seeds[1], timeOffsetMs: offset }).samples;
    const mk = (samples: typeof a, phaseMs: number) => ({ samples, i: 0, phaseMs, det: new LapDetector(line), prog: new ProgressTracker() });
    const karts = { A: mk(a, 130), B: mk(b, 710) };
    const order = useOrder ? new LiveOrder() : undefined;
    const leaders: string[] = [];
    const t0 = 1_000_000 + circuit.length / speedMs * 1000 + 5000; // a partir da 2ª volta
    const tEnd = 1_000_000 + 3.8 * (circuit.length / speedMs) * 1000;
    for (let now = 1_000_000; now <= tEnd; now += 500) {
      for (const k of Object.values(karts)) {
        // o lote só chega no "segundo" deste celular
        const delivered = Math.floor((now - k.phaseMs) / 1000) * 1000 + k.phaseMs;
        while (k.i < k.samples.length && k.samples[k.i].t <= delivered - 200) {
          const before = k.det.stats.accepted;
          k.det.push(k.samples[k.i++]);
          if (k.det.stats.accepted > before && k.det.hasStarted) {
            k.prog.update(ref, k.det.lastSample!, k.det.crossings.length - 1, k.det.lastCrossingT!);
          }
        }
      }
      if (now < t0) continue;
      const rows = computeStandings(
        Object.entries(karts).map(([id, k], n) => ({
          pilotId: id,
          name: id,
          number: n + 1,
          color: '',
          crossings: k.det.crossings.map((c) => c.t),
          progress: k.prog.ready ? k.prog : null,
        })),
        ref.length,
        order,
      );
      leaders.push(rows[0].pilotId);
    }
    const changes = leaders.filter((l, i) => i > 0 && l !== leaders[i - 1]).length;
    const aShare = leaders.filter((l) => l === 'A').length / leaders.length;
    return { changes, aShare };
  }

  it('não fica alternando P1/P2 com o de trás a poucos metros', () => {
    for (const seeds of [[51, 52], [61, 62], [71, 72], [81, 82]] as [number, number][]) {
      const r = race(8, 14, seeds, true);
      expect(r.changes).toBeLessThanOrEqual(2);
      expect(r.aShare).toBeGreaterThan(0.85);
    }
  });

  it('compara os karts no mesmo instante, mesmo com lotes chegando em tempos diferentes', () => {
    // sem histerese, mas com alinhamento no tempo: 15 m atrás nunca vira P1
    const r = race(15, 14, [91, 92], false);
    expect(r.aShare).toBe(1);
  });
});
