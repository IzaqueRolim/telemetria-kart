import { describe, expect, it } from 'vitest';
import { computeStandings, raceGap, referenceGap, buildPilotReport, lapsFromCrossings, fmtGap, fmtLap } from '../src';

const p = (id: string, n: number, crossings: number[]) => ({ pilotId: id, name: id, number: n, color: '#fff', crossings });

describe('classificação', () => {
  it('ordena por voltas e depois por quem passou primeiro', () => {
    const s = computeStandings([
      p('B', 2, [0, 41000, 82500]),
      p('A', 1, [500, 41200, 81800]),
      p('C', 3, [900, 42000]),
    ]);
    expect(s.map((r) => r.pilotId)).toEqual(['A', 'B', 'C']);
    expect(s[1].gapAhead).toEqual({ ms: 700, laps: 0 });
    expect(s[0].gapAhead).toBeNull();
    expect(s[0].gapBehind).toEqual({ ms: 700, laps: 0 });
    expect(referenceGap(s[0])?.kind).toBe('behind');
    // C está uma volta atrás em número, mas o gap mede na passagem 1 dos dois
    expect(s[2].gapAhead).toEqual({ ms: 1000, laps: 0 });
  });

  it('não compara só a última volta', () => {
    // B fez a última volta mais rápida, mas A está à frente na corrida
    const s = computeStandings([p('A', 1, [0, 40000, 80000]), p('B', 2, [3000, 45000, 82000])]);
    expect(s[0].pilotId).toBe('A');
    expect(s[1].lastLapMs).toBeLessThan(s[0].lastLapMs as number);
  });

  it('detecta retardatário', () => {
    const g = raceGap([0, 40000, 80000, 120000], [1000, 85000]);
    expect(g?.laps).toBe(1);
    expect(fmtGap(g)).toBe('+1 VOLTA');
  });

  it('não mostra gap negativo quando os dados estão incompletos', () => {
    // B passou na largada antes, mas ainda não sincronizou a volta 1
    const s = computeStandings([p('A', 1, [500, 41000]), p('B', 2, [0])]);
    expect(s[1].pilotId).toBe('B');
    expect(s[1].gapAhead).toBeNull();
  });

  it('relatório individual', () => {
    const laps = lapsFromCrossings([0, 42000, 83000, 123500, 163000]);
    const r = buildPilotReport({ pilotId: 'A', name: 'A', number: 1, color: '#fff' }, laps, 1, 20);
    expect(r.bestLap?.timeMs).toBe(39500);
    expect(r.worstLap?.timeMs).toBe(42000);
    expect(r.laps[1].deltaPrevMs).toBe(-1000);
    expect(r.trendMsPerLap).toBeLessThan(0);
    expect(r.maxSpeedKmh).toBe(72);
    expect(fmtLap(41982)).toBe('0:41.982');
  });
});
