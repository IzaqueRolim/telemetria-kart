import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Btn, Card, ErrorText, Field, H1, Icon, Label, Screen } from '../components/ui';
import { api } from '../lib/api';
import { leaveSession } from '../lib/raceEngine';
import { ActiveSession, storage } from '../lib/storage';
import { useThemeColors } from '../lib/theme';

export default function Home() {
  const { c, cycle } = useThemeColors();
  const [name, setName] = useState('');
  const [track, setTrack] = useState('');
  const [laps, setLaps] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [server, setServer] = useState('');
  const [showServer, setShowServer] = useState(false);

  useFocusEffect(
    useCallback(() => {
      storage.lastName().then((n) => n && setName((cur) => cur || n));
      storage.active().then(setActive);
      storage.serverUrl().then(setServer);
    }, []),
  );

  const enter = async (kind: 'create' | 'join') => {
    setError(null);
    const pilotName = name.trim();
    if (!pilotName) return setError('Informe seu nome ou apelido.');
    if (kind === 'create' && !track.trim()) return setError('Informe o nome da pista.');
    if (kind === 'join' && code.trim().length < 4) return setError('Digite o código da sala.');
    setBusy(kind);
    try {
      await leaveSession();
      const r =
        kind === 'create'
          ? await api.create({ trackName: track.trim(), pilotName, targetLaps: laps ? Number(laps) : null })
          : await api.join(code.trim(), pilotName);
      await storage.setLastName(pilotName);
      await storage.setActive({ code: r.session.code, pilot: r.pilot, token: r.token, trackName: r.session.trackName });
      router.push(r.session.status === 'RUNNING' ? '/race' : '/lobby');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 640, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: c.green, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="racing-helmet" size={30} color={c.onAccent} />
            </View>
            <View style={{ flex: 1 }}>
              <H1 style={{ fontSize: 24 }}>KART TELEMETRIA</H1>
              <Text style={{ color: c.muted, fontWeight: '600' }}>Cronometragem e posição ao vivo</Text>
            </View>
            <Pressable onPress={cycle} hitSlop={10}>
              <Icon name="theme-light-dark" color={c.muted} />
            </Pressable>
          </View>

          {active && (
            <Card accent={c.amber} style={{ padding: 16, gap: 10 }}>
              <Label>Corrida em andamento</Label>
              <Text style={{ color: c.text, fontSize: 18, fontWeight: '800' }}>
                {active.trackName} · sala {active.code}
              </Text>
              <Btn title="Voltar para a sala" icon="flag-checkered" onPress={() => router.push('/lobby')} />
            </Card>
          )}

          <Field label="Seu nome ou apelido" value={name} onChangeText={setName} placeholder="Ex.: Raquel" maxLength={24} autoCapitalize="words" />

          <Card style={{ padding: 16, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="flag-checkered" color={c.green} />
              <Label style={{ color: c.text }}>Nova pista</Label>
            </View>
            <Field label="Nome da pista" value={track} onChangeText={setTrack} placeholder="Ex.: Kartódromo da Zona Leste" maxLength={40} />
            <Field
              label="Total de voltas (opcional)"
              value={laps}
              onChangeText={(v) => setLaps(v.replace(/\D/g, '').slice(0, 3))}
              keyboardType="number-pad"
              placeholder="Livre"
            />
            <Btn title="Criar sala" icon="plus" loading={busy === 'create'} disabled={!!busy} onPress={() => enter('create')} />
          </Card>

          <Card style={{ padding: 16, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="account-group" color={c.blue} />
              <Label style={{ color: c.text }}>Entrar em uma sala</Label>
            </View>
            <Field
              label="Código da sala"
              value={code}
              onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="ABC123"
              autoCapitalize="characters"
              autoCorrect={false}
              style={{ letterSpacing: 6, fontSize: 24, textAlign: 'center' }}
            />
            <Btn title="Entrar" variant="ghost" icon="login" loading={busy === 'join'} disabled={!!busy} onPress={() => enter('join')} />
          </Card>

          <ErrorText>{error}</ErrorText>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Btn title="Histórico" variant="ghost" icon="history" compact style={{ flex: 1 }} onPress={() => router.push('/history')} />
            <Btn title="Servidor" variant="ghost" icon="cog-outline" compact style={{ flex: 1 }} onPress={() => setShowServer((s) => !s)} />
          </View>
          <Btn title="Ver demonstração do painel" variant="ghost" icon="monitor-dashboard" compact onPress={() => router.push('/demo')} />
          {showServer && (
            <Card style={{ padding: 16, gap: 10 }}>
              <Field
                label="Endereço do servidor"
                value={server}
                onChangeText={setServer}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="http://192.168.0.10:3000"
                style={{ fontSize: 15 }}
              />
              <Btn
                title="Salvar e testar"
                compact
                onPress={async () => {
                  await storage.setServerUrl(server);
                  setError(null);
                  try {
                    await api.health();
                    setError(null);
                    setShowServer(false);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              />
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
