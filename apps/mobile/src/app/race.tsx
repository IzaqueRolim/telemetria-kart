import { useKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { RaceHud } from '../components/RaceHud';
import { Screen } from '../components/ui';
import { useRace } from '../lib/useRace';

export default function Race() {
  useKeepAwake();
  const { engine, state, missing } = useRace();

  useEffect(() => {
    if (missing) router.replace('/');
  }, [missing]);
  useEffect(() => {
    if (state?.session?.status === 'FINISHED') router.replace('/report');
    if (state?.session?.status === 'LOBBY') router.replace('/lobby');
  }, [state?.session?.status]);

  if (!state || !engine) return <Screen />;
  return (
    <RaceHud
      state={state}
      actions={{
        resetLine: engine.resetLine,
        finish: engine.finishRace,
        toggleVoice: () => engine.setVoice(!state.voice),
      }}
    />
  );
}

