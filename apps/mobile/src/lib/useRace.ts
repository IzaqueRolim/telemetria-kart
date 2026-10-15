import { useEffect, useState, useSyncExternalStore } from 'react';
import { getEngine, RaceEngine, RaceState } from './raceEngine';
import { storage } from './storage';

const noopSubscribe = () => () => {};
const nullState = () => null;

/** Liga a tela ao motor de corrida da sessão ativa. */
export function useRace(): { engine: RaceEngine | null; state: RaceState | null; missing: boolean } {
  const [engine, setEngine] = useState<RaceEngine | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    storage.active().then(async (active) => {
      if (!active) {
        if (alive) setMissing(true);
        return;
      }
      const e = await getEngine(active);
      if (alive) setEngine(e);
    });
    return () => {
      alive = false;
    };
  }, []);

  const state = useSyncExternalStore(engine ? engine.subscribe : noopSubscribe, engine ? engine.getState : nullState);
  return { engine, state, missing };
}
