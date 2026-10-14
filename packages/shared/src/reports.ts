import { computeStandings, PilotTiming, StandingRow } from './classification';
import { Lap } from './types';

export interface LapRow extends Lap {
  /** diferença para a volta anterior (negativo = mais rápida) */
  deltaPrevMs: number | null;
  /** diferença para a melhor volta do piloto */
  deltaBestMs: number;
  isBest: boolean;
  isWorst: boolean;
}

export interface PilotReport {
  pilotId: string;
  name: string;
  number: number;
  color: string;
  position: number | null;
  laps: LapRow[];
  bestLap: Lap | null;
  worstLap: Lap | null;
  averageMs: number | null;
  medianMs: number | null;
  stdDevMs: number | null;
  /** inclinação da reta de tendência (ms por volta; negativo = evoluindo) */
  trendMsPerLap: number | null;
  /** média das 3 últimas menos média das 3 primeiras (negativo = evoluiu) */
  improvementMs: number | null;
  maxSpeedKmh: number | null;
}

export interface GeneralReport {
  sessionCode: string;
  trackName: string;
  startedAt: number | null;
  finishedAt: number | null;
  standings: StandingRow[];
  fastestLap: { pilotId: string; name: string; lapNumber: number; timeMs: number } | null;
}

export function lapsFromCrossings(crossings: number[], uncertainties: number[] = []): Lap[] {
  const laps: Lap[] = [];
  for (let k = 1; k < crossings.length; k++) {
    laps.push({
      number: k,
      startT: crossings[k - 1],
      endT: crossings[k],
      timeMs: crossings[k] - crossings[k - 1],
      uncertaintyMs: (uncertainties[k - 1] ?? 0) + (uncertainties[k] ?? 0),
    });
  }
  return laps;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function buildPilotReport(
  pilot: { pilotId: string; name: string; number: number; color: string },
  laps: Lap[],
  position: number | null,
  maxSpeedMs: number | null,
): PilotReport {
  const times = laps.map((l) => l.timeMs);
  let best: Lap | null = null;
  let worst: Lap | null = null;
  for (const l of laps) {
    if (!best || l.timeMs < best.timeMs) best = l;
    if (!worst || l.timeMs > worst.timeMs) worst = l;
  }
  const rows: LapRow[] = laps.map((l, i) => ({
    ...l,
    deltaPrevMs: i > 0 ? l.timeMs - laps[i - 1].timeMs : null,
    deltaBestMs: best ? l.timeMs - best.timeMs : 0,
    isBest: l === best,
    isWorst: laps.length > 1 && l === worst,
  }));

  let averageMs: number | null = null;
  let medianMs: number | null = null;
  let stdDevMs: number | null = null;
  let trend: number | null = null;
  let improvement: number | null = null;
  if (times.length) {
    averageMs = Math.round(mean(times));
    const s = [...times].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    medianMs = s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
    stdDevMs = Math.round(Math.sqrt(mean(times.map((t) => (t - (averageMs as number)) ** 2))));
  }
  if (times.length >= 2) {
    const xs = times.map((_, i) => i + 1);
    const mx = mean(xs);
    const my = mean(times);
    let num = 0;
    let den = 0;
    xs.forEach((x, i) => {
      num += (x - mx) * (times[i] - my);
      den += (x - mx) ** 2;
    });
    trend = Math.round(num / den);
    const k = Math.min(3, Math.floor(times.length / 2));
    improvement = Math.round(mean(times.slice(-k)) - mean(times.slice(0, k)));
  }

  return {
    ...pilot,
    position,
    laps: rows,
    bestLap: best,
    worstLap: worst,
    averageMs,
    medianMs,
    stdDevMs,
    trendMsPerLap: trend,
    improvementMs: improvement,
    maxSpeedKmh: maxSpeedMs != null ? Math.round(maxSpeedMs * 36) / 10 : null,
  };
}

export function buildGeneralReport(
  meta: { sessionCode: string; trackName: string; startedAt: number | null; finishedAt: number | null },
  pilots: PilotTiming[],
): GeneralReport {
  const standings = computeStandings(pilots);
  let fastest: GeneralReport['fastestLap'] = null;
  for (const r of standings) {
    if (r.bestLapMs != null && (!fastest || r.bestLapMs < fastest.timeMs)) {
      fastest = { pilotId: r.pilotId, name: r.name, lapNumber: r.bestLapNumber ?? 0, timeMs: r.bestLapMs };
    }
  }
  return { ...meta, standings, fastestLap: fastest };
}
