import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';
import { Btn, Card, ErrorText, Icon, Label, Screen, SignalBadge } from '../components/ui';
import { leaveSession } from '../lib/raceEngine';
import { dashboardUrl, storage } from '../lib/storage';
import { numeric, useThemeColors } from '../lib/theme';
import { useRace } from '../lib/useRace';

export default function Lobby() {
  const { c } = useThemeColors();
  const { engine, state, missing } = useRace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState('');

  useEffect(() => {
    dashboardUrl().then(setServer);
  }, []);
  useEffect(() => {
    if (missing) router.replace('/');
  }, [missing]);
  useEffect(() => {
    if (state?.session?.status === 'RUNNING') router.replace('/race');
    if (state?.session?.status === 'FINISHED') router.replace('/report');
  }, [state?.session?.status]);

  if (!state) return <Screen />;
  const s = state.session;
  const viewer = `${server}/s/${state.code}`;
  const gpsReady = state.gps === 'ok' || state.gps === 'weak';

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      await engine!.startRace();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Label>{state.trackName}</Label>
          <SignalBadge gps={state.gps} accuracy={state.gpsAccuracy} connection={state.connection} pending={state.pending} />
        </View>

        <Card style={{ padding: 20, alignItems: 'center', gap: 6 }}>
          <Label>Código da sala</Label>
          <Text style={[numeric, { color: c.green, fontSize: 52, letterSpacing: 10 }]}>{state.code}</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <Btn
              title="Compartilhar"
              icon="share-variant"
              compact
              variant="ghost"
              onPress={() =>
                Share.share({ message: `Entre na corrida no app Kart Telemetria com o código ${state.code}.\nAcompanhe ao vivo: ${viewer}` })
              }
            />
            <Btn title="Copiar" icon="content-copy" compact variant="ghost" onPress={() => Clipboard.setStringAsync(state.code)} />
          </View>
          <Text style={{ color: c.muted, textAlign: 'center', marginTop: 8 }}>Espectadores assistem em {viewer}</Text>
        </Card>

        <Card style={{ padding: 16, gap: 10 }}>
          <Label>Pilotos ({s?.pilots.length ?? 0})</Label>
          {s?.pilots.map((p) => (
            <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 }}>
              <View style={{ width: 6, height: 28, borderRadius: 3, backgroundColor: p.color }} />
              <Text style={[numeric, { color: c.muted, width: 28 }]}>#{p.number}</Text>
              <Text style={{ color: c.text, fontSize: 18, fontWeight: '800', flex: 1 }}>{p.name}</Text>
              {p.id === state.pilotId && <Text style={{ color: c.green, fontWeight: '800' }}>VOCÊ</Text>}
              {p.isHost && <Icon name="crown" size={20} color={c.amber} />}
            </View>
          ))}
        </Card>

        {state.isHost ? (
          <Card accent={c.green} style={{ padding: 16, gap: 12 }}>
            <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>
              Posicione seu kart sobre a linha de largada/chegada e toque em iniciar. A posição do seu GPS vira a linha virtual; a direção é
              definida assim que você começar a andar.
            </Text>
            <Text style={{ color: c.muted }}>Os demais karts devem largar atrás da linha.</Text>
            <Btn title={gpsReady ? 'Iniciar corrida' : 'Aguardando GPS…'} icon="flag-checkered" loading={busy} disabled={!gpsReady || state.connection !== 'online'} onPress={start} />
          </Card>
        ) : (
          <Card style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Icon name="timer-sync-outline" color={c.amber} />
            <Text style={{ color: c.text, fontSize: 16, fontWeight: '700', flex: 1 }}>Aguardando o criador iniciar a corrida…</Text>
          </Card>
        )}

        <ErrorText>{error ?? state.error}</ErrorText>
        {state.connection === 'offline' && <ErrorText>Sem conexão com o servidor ({server}).</ErrorText>}

        <Btn
          title="Sair da sala"
          variant="ghost"
          compact
          onPress={async () => {
            await leaveSession();
            router.replace('/');
          }}
        />
      </ScrollView>
    </Screen>
  );
}
