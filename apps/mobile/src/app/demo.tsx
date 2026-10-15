import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Lap, computeStandings, pilotColor } from '@kart/shared';
import { RaceHud } from '../components/RaceHud';
import type { RaceState } from '../lib/raceEngine';
import { useThemeColors } from '../lib/theme';

/**
 * Demonstração do painel com dados simulados (sem GPS nem servidor) —
 * útil para apresentar o app e conferir o layout em retrato/paisagem.
 */
const PILOTS = [
  { id: 'gabriel', name: 'Gabriel', pace: 40300 },
  { id: 'lucas', name: 'Lucas', pace: 40650 },
  { id: 'me', name: 'Você', pace: 40850 },
  { id: 'marina', name: 'Marina', pace: 41100 },
  { id: 'rafa', name: 'Rafael', pace: 41500 },
  { id: 'bia', name: 'Beatriz', pace: 42100 },
];

function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

export default function Demo() {
  const { c, setPref } = useThemeColors();
  const params = useLocalSearchParams<{ theme?: string; t?: string }>();
  const t0 = useMemo(() => Date.now() - Number(params.t ?? 7 * 41000 + 21000), [params.t]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (params.theme === 'light' || params.theme === 'dark') setPref(params.theme);
  }, [params.theme, setPref]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  const crossings = PILOTS.map((p, i) => {
    const out = [t0 + i * 700];
    for (let k = 1; k < 60; k++) {
      const next = out[k - 1] + p.pace + Math.round((rand(i * 100 + k) - 0.5) * 900) + (k === 1 ? 800 : 0);
      if (next > now) break;
      out.push(next);
    }
    return out;
  });
  const standings = computeStandings(
    PILOTS.map((p, i) => ({ pilotId: p.id, name: p.name, number: i + 1, color: pilotColor(i), crossings: crossings[i] })),
  );
  const mine = crossings[2];
  const laps: Lap[] = mine.slice(1).map((t, k) => ({ number: k + 1, startT: mine[k], endT: t, timeMs: t - mine[k], uncertaintyMs: 60 }));
  const best = laps.reduce<Lap | null>((b, l) => (!b || l.timeMs < b.timeMs ? l : b), null);
  const last = laps[laps.length - 1] ?? null;
  const lapStart = mine[mine.length - 1];
  const elapsed = now - lapStart;
  const progress = best ? Math.min(1, elapsed / best.timeMs) : null;
  const speed = Math.round(52 + 22 * Math.sin(elapsed / 2600) + 6 * Math.sin(elapsed / 700));

  const state: RaceState = {
    code: 'DEMO42',
    pilotId: 'me',
    pilotName: 'Você',
    isHost: true,
    trackName: 'Kartódromo da Zona Leste',
    session: {
      id: 'demo',
      code: 'DEMO42',
      trackId: 't',
      trackName: 'Kartódromo da Zona Leste',
      status: 'RUNNING',
      hostPilotId: 'me',
      targetLaps: 15,
      startedAt: t0,
      finishedAt: null,
      line: { lat: 0, lng: 0, bearing: 90, halfWidthM: 15, version: 1 },
      pilots: PILOTS.map((p, i) => ({ id: p.id, name: p.name, number: i + 1, color: pilotColor(i), isHost: p.id === 'me' })),
      standings,
      trackPath: null,
      serverTime: now,
    },
    connection: 'online',
    gps: 'ok',
    gpsAccuracy: 4,
    clockSynced: true,
    pending: 0,
    recording: true,
    lapStartLocalT: lapStart,
    laps,
    lastLap: last,
    bestLap: best,
    speedKmh: speed,
    maxSpeedKmh: 79,
    deltaMs: best ? Math.round(Math.sin(elapsed / 4000) * 420) : null,
    progress,
    standings,
    lapFlash: last && now - last.endT < 4000 ? { lap: last, personalBest: last === best, at: last.endT } : null,
    report: null,
    voice: true,
    error: null,
  };

  void c;
  return (
    <RaceHud
      state={state}
      actions={{
        resetLine: async () => undefined,
        finish: async () => router.back(),
        toggleVoice: () => undefined,
      }}
    />
  );
}
