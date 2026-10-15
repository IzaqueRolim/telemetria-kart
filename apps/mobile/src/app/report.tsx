import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, View } from 'react-native';
import { buildPilotReport, fmtDelta, fmtGap, fmtLap, GeneralReport, PilotReport } from '@kart/shared';
import { LapChart } from '../components/LapChart';
import { Btn, Card, ErrorText, H1, Label, Screen } from '../components/ui';
import { api } from '../lib/api';
import { currentEngine, leaveSession } from '../lib/raceEngine';
import { dashboardUrl, storage } from '../lib/storage';
import { numeric, useThemeColors } from '../lib/theme';

/**
 * Relatório individual do piloto. Sem parâmetros, usa a sessão ativa
 * (fim de corrida); com ?code=&pilotId=, abre do histórico.
 */
export default function Report() {
  const { c } = useThemeColors();
  const params = useLocalSearchParams<{ code?: string; pilotId?: string }>();
  const [code, setCode] = useState<string | null>(params.code ?? null);
  const [pilotId, setPilotId] = useState<string | null>(params.pilotId ?? null);
  const [report, setReport] = useState<PilotReport | null>(null);
  const [general, setGeneral] = useState<GeneralReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [server, setServer] = useState('');
  const fromActive = !params.code;

  useEffect(() => {
    dashboardUrl().then(setServer);
    if (fromActive) {
      storage.active().then((a) => {
        if (!a) return router.replace('/');
        setCode(a.code);
        setPilotId(a.pilot.id);
      });
    }
  }, [fromActive]);

  useEffect(() => {
    if (!code || !pilotId) return;
    let alive = true;
    const load = async () => {
      try {
        // espera a fila local ser sincronizada antes de pedir o relatório oficial
        const eng = currentEngine();
        for (let i = 0; i < 10 && eng && eng.state.pending > 0 && eng.state.connection === 'online'; i++) {
          await new Promise((r) => setTimeout(r, 700));
        }
        const [r, g] = await Promise.all([api.pilotReport(code, pilotId), api.report(code)]);
        if (!alive) return;
        setReport(r);
        setGeneral(g);
        setOffline(false);
      } catch (e) {
        // sem internet: monta o relatório com as voltas detectadas no próprio celular
        const eng = currentEngine();
        if (eng && eng.active.code === code) {
          const st = eng.state;
          setReport(
            buildPilotReport(
              { pilotId, name: st.pilotName, number: eng.active.pilot.number, color: eng.active.pilot.color },
              st.laps,
              st.standings.find((r) => r.pilotId === pilotId)?.position ?? null,
              st.maxSpeedKmh / 3.6,
            ),
          );
          setOffline(true);
        } else setError((e as Error).message);
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, [code, pilotId]);

  const finish = async () => {
    if (fromActive) await leaveSession();
    router.replace('/');
  };

  if (!report) {
    return (
      <Screen style={{ alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        {error ? <ErrorText>{error}</ErrorText> : <ActivityIndicator color={c.green} size="large" />}
        {error && <Btn title="Voltar" variant="ghost" onPress={() => router.back()} style={{ marginTop: 16 }} />}
      </Screen>
    );
  }

  const tiles: { k: string; v: string; s?: string; color?: string }[] = [
    { k: 'Posição', v: report.position ? `P${report.position}` : '—', color: report.color },
    { k: 'Voltas', v: String(report.laps.length) },
    { k: 'Melhor', v: fmtLap(report.bestLap?.timeMs), s: report.bestLap ? `volta ${report.bestLap.number}` : '', color: c.purple },
    { k: 'Pior', v: fmtLap(report.worstLap?.timeMs), s: report.worstLap ? `volta ${report.worstLap.number}` : '', color: c.red },
    { k: 'Média', v: fmtLap(report.averageMs), s: report.stdDevMs != null ? `±${(report.stdDevMs / 1000).toFixed(3)} s` : '', color: c.amber },
    {
      k: 'Evolução',
      v: report.improvementMs != null ? fmtDelta(report.improvementMs) : '—',
      s: 'fim vs. início',
      color: report.improvementMs != null && report.improvementMs <= 0 ? c.green : c.red,
    },
    { k: 'Vel. máx', v: report.maxSpeedKmh != null ? `${Math.round(report.maxSpeedKmh)}` : '—', s: 'km/h', color: c.blue },
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, maxWidth: 900, width: '100%', alignSelf: 'center' }}>
        <View>
          <Label style={{ color: c.green }}>Relatório individual · sala {code}</Label>
          <H1>{report.name}</H1>
          {general && <Text style={{ color: c.muted, fontWeight: '700' }}>{general.trackName}</Text>}
        </View>
        {offline && <ErrorText>Sem conexão: relatório calculado com os dados deste celular. Os dados serão sincronizados quando a internet voltar.</ErrorText>}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {tiles.map((t) => (
            <Card key={t.k} accent={t.color ?? c.border} style={{ padding: 12, minWidth: 150, flexGrow: 1 }}>
              <Label style={{ fontSize: 11 }}>{t.k}</Label>
              <Text style={[numeric, { color: c.text, fontSize: 24 }]}>{t.v}</Text>
              {t.s ? <Text style={{ color: c.muted, fontSize: 12 }}>{t.s}</Text> : null}
            </Card>
          ))}
        </View>

        {report.laps.length >= 2 && (
          <Card style={{ padding: 14, gap: 8 }}>
            <Label>Evolução dos tempos e diferença entre voltas</Label>
            <LapChart laps={report.laps} averageMs={report.averageMs} color={report.color} />
          </Card>
        )}

        <Card style={{ padding: 6 }}>
          <View style={{ flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 8 }}>
            {['Volta', 'Tempo', 'vs. ant.', 'vs. melhor'].map((h, i) => (
              <Text key={h} style={{ flex: i === 0 ? 0.7 : 1, color: c.faint, fontWeight: '800', fontSize: 11, letterSpacing: 1, textAlign: i ? 'right' : 'left' }}>
                {h.toUpperCase()}
              </Text>
            ))}
          </View>
          {report.laps.map((l) => (
            <View key={l.number} style={{ flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: c.border }}>
              <Text style={{ flex: 0.7, color: l.isBest ? c.purple : l.isWorst ? c.red : c.text, fontWeight: '800' }}>
                {l.number}
                {l.isBest ? ' ★' : ''}
              </Text>
              <Text style={[numeric, { flex: 1, textAlign: 'right', color: l.isBest ? c.purple : c.text }]}>{fmtLap(l.timeMs)}</Text>
              <Text
                style={[
                  numeric,
                  { flex: 1, textAlign: 'right', color: l.deltaPrevMs == null ? c.muted : l.deltaPrevMs > 0 ? c.red : c.green },
                ]}
              >
                {fmtDelta(l.deltaPrevMs)}
              </Text>
              <Text style={[numeric, { flex: 1, textAlign: 'right', color: c.muted }]}>{l.isBest ? '—' : `+${(l.deltaBestMs / 1000).toFixed(3)}`}</Text>
            </View>
          ))}
          {report.laps.length === 0 && <Text style={{ color: c.muted, padding: 12 }}>Nenhuma volta completa.</Text>}
        </Card>

        {general && (
          <Card style={{ padding: 6 }}>
            <Label style={{ padding: 10 }}>Classificação final</Label>
            {general.standings.map((r) => (
              <View
                key={r.pilotId}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: c.border }}
              >
                <Text style={[numeric, { color: c.text, width: 26, fontSize: 18 }]}>{r.started ? r.position : '–'}</Text>
                <View style={{ width: 5, height: 22, borderRadius: 3, backgroundColor: r.color }} />
                <Text style={{ color: r.pilotId === pilotId ? c.green : c.text, fontWeight: '800', flex: 1 }} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={[numeric, { color: c.muted, width: 34, textAlign: 'right' }]}>{r.laps}V</Text>
                <Text style={[numeric, { color: c.text, width: 84, textAlign: 'right' }]}>{fmtLap(r.bestLapMs)}</Text>
                <Text style={[numeric, { color: c.muted, width: 80, textAlign: 'right' }]}>{r.position === 1 ? 'LÍDER' : fmtGap(r.gapAhead)}</Text>
              </View>
            ))}
          </Card>
        )}

        <Btn title="Ver relatório geral no navegador" variant="ghost" icon="open-in-new" onPress={() => Linking.openURL(`${server}/s/${code}/report`)} />
        <Btn title={fromActive ? 'Concluir' : 'Voltar'} icon="check" onPress={finish} />
      </ScrollView>
    </Screen>
  );
}
