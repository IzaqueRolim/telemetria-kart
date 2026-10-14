/**
 * Classificação de corrida por passagens válidas na linha.
 *
 * Três métricas DIFERENTES, que não devem ser confundidas:
 *  - Tempo de volta: intervalo entre duas passagens do MESMO piloto.
 *  - Gap de corrida: diferença entre os instantes em que DOIS pilotos passaram
 *    pela linha na mesma volta (n-ésima passagem de cada um). É o "intervalo"
 *    da F1 e só muda quando alguém cruza a linha.
 *  - Distância física: metros em linha reta entre as posições atuais
 *    (ver {@link physicalDistances}); não diz quem está à frente na corrida.
 *
 * Ordenação: mais voltas completadas primeiro; empate → quem completou a última
 * volta antes (menor instante de passagem). Nunca se compara apenas a última volta.
 */

import { haversine, LatLng } from './geo';
import type { LiveProgress } from './progress';

export interface PilotTiming {
  pilotId: string;
  name: string;
  number: number;
  color: string;
  /** instantes (ms, relógio do servidor) das passagens válidas; [0] = largada */
  crossings: number[];
  /** progresso contínuo ao longo da pista (opcional; habilita ordem e gap ao vivo) */
  progress?: LiveProgress | null;
}

export interface Gap {
  ms: number;
  /** voltas de diferença (piloto retardatário). Quando > 0, exiba "+N V". */
  laps: number;
}

export interface StandingRow {
  position: number;
  pilotId: string;
  name: string;
  number: number;
  color: string;
  started: boolean;
  laps: number;
  lastCrossingT: number | null;
  bestLapMs: number | null;
  bestLapNumber: number | null;
  lastLapMs: number | null;
  totalTimeMs: number | null;
  gapAhead: Gap | null;
  gapBehind: Gap | null;
  gapLeader: Gap | null;
  /** distância percorrida desde a largada (m), quando há traçado de referência */
  distanceM: number | null;
  /** os gaps desta linha vêm do progresso ao longo da pista (contínuos) */
  liveGaps: boolean;
}

function lapCount(c: number[]): number {
  return Math.max(0, c.length - 1);
}

/** Gap entre `ahead` (à frente) e `behind`, medido na última passagem de `behind`. */
export function raceGap(ahead: number[], behind: number[]): Gap | null {
  if (!ahead.length || !behind.length) return null;
  const n = behind.length - 1;
  if (ahead.length - 1 < n) return null; // ordem inconsistente
  const tBehind = behind[n];
  let laps = 0;
  for (let k = n + 1; k < ahead.length; k++) if (ahead[k] <= tBehind) laps++;
  const ms = tBehind - ahead[n];
  // negativo só acontece com dados incompletos (piloto offline ainda sincronizando)
  if (ms < 0) return null;
  return { ms, laps };
}

/**
 * Gap ao vivo: quanto tempo depois do kart da frente o de trás passou pelo
 * ponto da pista onde está agora. Atualiza a cada amostra, não só na linha.
 */
export function liveGap(ahead: LiveProgress, behind: LiveProgress, lapLengthM: number): Gap | null {
  const tA = ahead.timeAt(behind.D);
  if (tA == null) return null;
  const ms = behind.t - tA;
  if (ms < 0) return null;
  return { ms, laps: Math.max(0, Math.floor((ahead.D - behind.D) / lapLengthM)) };
}

function gapBetween(ahead: PilotTiming, behind: PilotTiming, L: number | null): Gap | null {
  if (L && ahead.progress && behind.progress && behind.crossings.length && ahead.crossings.length) {
    const g = liveGap(ahead.progress, behind.progress, L);
    if (g) return g;
  }
  return raceGap(ahead.crossings, behind.crossings);
}

function compareLive(a: PilotTiming, b: PilotTiming): number {
  const sa = a.crossings.length > 0;
  const sb = b.crossings.length > 0;
  if (sa && sb && a.progress && b.progress) {
    const la = lapCount(a.crossings);
    const lb = lapCount(b.crossings);
    // voltas confirmadas na linha mandam; dentro da mesma volta, quem andou mais
    if (la !== lb) return lb - la;
    if (Math.abs(a.progress.D - b.progress.D) > 0.5) return b.progress.D - a.progress.D;
  }
  return compare(a, b);
}

function compare(a: PilotTiming, b: PilotTiming): number {
  const sa = a.crossings.length > 0;
  const sb = b.crossings.length > 0;
  if (sa !== sb) return sa ? -1 : 1;
  if (!sa) return a.number - b.number;
  const la = lapCount(a.crossings);
  const lb = lapCount(b.crossings);
  if (la !== lb) return lb - la;
  const ta = a.crossings[a.crossings.length - 1];
  const tb = b.crossings[b.crossings.length - 1];
  if (ta !== tb) return ta - tb;
  return a.number - b.number;
}

/**
 * @param lapLengthM comprimento da volta de referência. Quando informado e os
 *   pilotos têm `progress`, a ordem e os gaps são contínuos (ao vivo). Sem ele,
 *   tudo é medido nas passagens pela linha (usado no resultado oficial).
 */
export function computeStandings(pilots: PilotTiming[], lapLengthM: number | null = null): StandingRow[] {
  const sorted = [...pilots].sort(lapLengthM ? compareLive : compare);
  const leader = sorted[0];
  return sorted.map((p, i) => {
    const c = p.crossings;
    let bestLapMs: number | null = null;
    let bestLapNumber: number | null = null;
    for (let k = 1; k < c.length; k++) {
      const t = c[k] - c[k - 1];
      if (bestLapMs == null || t < bestLapMs) {
        bestLapMs = t;
        bestLapNumber = k;
      }
    }
    const ahead = sorted[i - 1];
    const behind = sorted[i + 1];
    return {
      position: i + 1,
      pilotId: p.pilotId,
      name: p.name,
      number: p.number,
      color: p.color,
      started: c.length > 0,
      laps: lapCount(c),
      lastCrossingT: c.length ? c[c.length - 1] : null,
      bestLapMs,
      bestLapNumber,
      lastLapMs: c.length > 1 ? c[c.length - 1] - c[c.length - 2] : null,
      totalTimeMs: c.length > 1 ? c[c.length - 1] - c[0] : null,
      gapAhead: ahead ? gapBetween(ahead, p, lapLengthM) : null,
      gapBehind: behind ? gapBetween(p, behind, lapLengthM) : null,
      gapLeader: i > 0 && leader ? gapBetween(leader, p, lapLengthM) : null,
      distanceM: p.progress && c.length ? Math.round(p.progress.D) : null,
      liveGaps: !!(lapLengthM && p.progress),
    };
  });
}

/** Gap que o piloto deve ver: o da frente, ou — se for o líder — o de trás. */
export function referenceGap(row: StandingRow): { kind: 'ahead' | 'behind'; gap: Gap } | null {
  if (row.position === 1) return row.gapBehind ? { kind: 'behind', gap: row.gapBehind } : null;
  return row.gapAhead ? { kind: 'ahead', gap: row.gapAhead } : null;
}

/** Distância física em linha reta (m) até o kart imediatamente à frente na classificação. */
export function physicalDistances(
  standings: StandingRow[],
  positions: Record<string, LatLng | undefined>,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  standings.forEach((row, i) => {
    const me = positions[row.pilotId];
    const other = i > 0 ? positions[standings[i - 1].pilotId] : undefined;
    out[row.pilotId] = me && other ? haversine(me, other) : null;
  });
  return out;
}
