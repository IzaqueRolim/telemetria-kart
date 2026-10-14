import { describe, expect, it } from 'vitest';
import { createLine, detectLaps, LapDetector, resolveLineBearing, GpsSample } from '../src';
import { circuit, drive, ORIGIN } from './helpers';

const line = createLine({ lat: ORIGIN.lat, lng: ORIGIN.lng, speed: 10, heading: 90 }, 1);

describe('LapDetector', () => {
  it('conta voltas com tempo correto a velocidade constante', () => {
    const speed = 20;
    const pts = drive({ laps: 5, speedMs: speed, hz: 1 });
    const d = detectLaps(pts, line);
    expect(d.crossings.length).toBe(6); // largada + 5
    const expected = (circuit.length / speed) * 1000;
    for (const lap of d.laps) expect(Math.abs(lap.timeMs - expected)).toBeLessThan(150);
  });

  it('não conta duas vezes com ruído de GPS perto da linha', () => {
    const pts = drive({ laps: 4, speedMs: 15, hz: 5, noiseM: 4, seed: 7 });
    const d = detectLaps(pts, line);
    expect(d.laps.length).toBe(4);
  });

  it('ignora vai-e-vem sobre a linha (ré / oscilação parada)', () => {
    const base = drive({ laps: 1, speedMs: 10, hz: 1, startDist: -30 }).slice(0, 6);
    // kart cruza, volta para trás e cruza de novo em segundos
    const jitter: GpsSample[] = [...base, ...[...base].reverse().slice(1), ...base.slice(1)].map((p, i) => ({
      ...p,
      seq: i,
      t: 1_000_000 + i * 1000,
    }));
    const d = detectLaps(jitter, line);
    expect(d.crossings.length).toBe(1);
  });

  it('rejeita saltos impossíveis (outliers)', () => {
    const pts = drive({ laps: 2, speedMs: 15, hz: 1 });
    pts.splice(20, 0, { ...pts[20], lat: pts[20].lat + 0.01, t: pts[19].t + 500 });
    const d = detectLaps(pts, line);
    expect(d.laps.length).toBe(2);
    expect(d.stats.rejected).toBeGreaterThan(0);
  });

  it('interpola o instante do cruzamento (precisão sub-amostra)', () => {
    const pts = drive({ laps: 3, speedMs: 17.3, hz: 1, t0: 5_000_123 });
    const d = new LapDetector(line);
    d.pushMany(pts);
    // começa 20 m antes da linha a 17.3 m/s → cruza em 1156 ms
    expect(Math.abs(d.crossings[0].t - (5_000_123 + (20 / 17.3) * 1000))).toBeLessThan(30);
  });

  it('conta a largada de quem está parado logo depois da linha (criador)', () => {
    const pts = drive({ laps: 2, speedMs: 15, hz: 1, startDist: 3 });
    const d = detectLaps(pts, line);
    expect(d.laps.length).toBe(2);
  });

  it('resolve o sentido com kart rápido a 1 Hz (poucos fixes perto da linha)', () => {
    const pending = createLine({ lat: ORIGIN.lat, lng: ORIGIN.lng }, 1);
    const pts = drive({ laps: 1, speedMs: 20, hz: 1, startDist: 0 });
    for (let n = 2; n <= 6; n++) {
      const b = resolveLineBearing(pending, pts.slice(0, n), 0);
      if (n >= 3) expect(Math.abs((b as number) - 90)).toBeLessThan(10);
    }
  });

  it('resolve o sentido da linha pelo deslocamento do criador', () => {
    const pending = createLine({ lat: ORIGIN.lat, lng: ORIGIN.lng }, 1);
    expect(pending.bearing).toBeNull();
    const pts = drive({ laps: 1, speedMs: 10, startDist: 0 });
    const b = resolveLineBearing(pending, pts, 0);
    expect(b).not.toBeNull();
    expect(Math.abs((b as number) - 90)).toBeLessThan(10);
  });
});
