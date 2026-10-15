import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { fmtDelta, fmtSec } from '@kart/shared';
import { BestLapsStrip, BracketPanel, gapParts, LapTimer, MetricCard, ProgressBar, SpeedGauge } from './hud';
import { Btn, Icon, Screen, SignalBadge } from './ui';
import type { RaceState } from '../lib/raceEngine';
import { numeric, useThemeColors } from '../lib/theme';

const FLASH_MS = 5000;

export interface HudActions {
  resetLine: () => Promise<void>;
  finish: () => Promise<void>;
  toggleVoice: () => void;
}

/** Painel de corrida (puro: recebe o estado; usado também pela tela de demonstração). */
export function RaceHud({ state, actions }: { state: RaceState; actions: HudActions }) {
  const { c, cycle } = useThemeColors();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const [, tick] = useState(0);

  // re-render para expirar o "flash" da volta completada
  useEffect(() => {
    if (!state.lapFlash) return;
    const t = setTimeout(() => tick((x) => x + 1), FLASH_MS + 50);
    return () => clearTimeout(t);
  }, [state.lapFlash]);

  const me = state.standings.find((r) => r.pilotId === state.pilotId) ?? null;
  const total = state.session?.pilots.length ?? 1;
  const isLeader = !!me?.started && me.position === 1;
  const sessionBest = state.standings.reduce<number | null>((b, r) => (r.bestLapMs != null && (b == null || r.bestLapMs < b) ? r.bestLapMs : b), null);
  const hasSessionBest = me?.bestLapMs != null && me.bestLapMs === sessionBest;
  const flash = state.lapFlash && Date.now() - state.lapFlash.at < FLASH_MS ? state.lapFlash : null;
  const currentLap = state.lapStartLocalT != null ? state.laps.length + 1 : 0;
  const target = state.session?.targetLaps;
  const linePending = state.session?.line?.bearing == null;

  const confirm = (title: string, msg: string, fn: () => Promise<void>) =>
    Alert.alert(title, msg, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Confirmar',
        style: 'destructive',
        onPress: () => fn().catch((e) => Alert.alert('Erro', (e as Error).message)),
      },
    ]);

  // ---------------------------------------------------------------- cartões
  const leaderGap = gapParts(me?.gapLeader);
  const aheadGap = gapParts(me?.gapAhead);
  const behindGap = gapParts(me?.gapBehind);
  // tamanhos derivados da altura disponível (celular deitado tem ~390 px de altura)
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const avail = height - 175; // cabeçalho + faixa inferior + espaçamentos
  const size = landscape ? clamp(((avail - 20) / 3 - 38) / 1.15, 22, 46) : clamp(width * 0.072, 24, 40);

  const gapLeaderCard = (
    <MetricCard
      icon="timer-outline"
      label="GAP LÍDER"
      accent={c.green}
      value={isLeader ? 'LÍDER' : leaderGap.value}
      unit={isLeader ? '' : leaderGap.unit}
      valueColor={isLeader ? c.green : undefined}
      arrow={isLeader || !me?.gapLeader ? null : 'up'}
      arrowColor={c.green}
      size={size}
    />
  );
  const gapAheadCard = (
    <MetricCard
      icon="car-multiple"
      label={isLeader ? 'À FRENTE' : 'GAP À FRENTE'}
      accent={c.red}
      value={isLeader ? '—' : aheadGap.value}
      unit={isLeader ? '' : aheadGap.unit}
      arrow={isLeader || !me?.gapAhead ? null : 'up'}
      arrowColor={c.red}
      sub={isLeader ? 'ninguém à sua frente' : undefined}
      size={size}
    />
  );
  const gapBehindCard = (
    <MetricCard
      icon="car-side"
      label={isLeader ? 'VANTAGEM P/ 2º' : 'GAP ATRÁS'}
      accent={c.green}
      value={behindGap.value}
      unit={behindGap.unit}
      valueColor={isLeader && me?.gapBehind ? c.green : undefined}
      arrow={me?.gapBehind ? 'down' : null}
      arrowColor={c.green}
      size={size}
    />
  );
  const bestCard = (
    <MetricCard
      icon="timer-outline"
      label="MELHOR VOLTA"
      accent={c.green}
      value={state.bestLap ? fmtSec(state.bestLap.timeMs) : '—'}
      unit={state.bestLap ? 's' : ''}
      right={
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: c.muted, fontWeight: '800', fontSize: 12, letterSpacing: 0.8 }}>ÚLTIMA</Text>
          <Text style={[numeric, { color: c.text, fontSize: Math.max(18, size * 0.55) }]}>{state.lastLap ? fmtSec(state.lastLap.timeMs) : '—'}</Text>
        </View>
      }
      badge={
        hasSessionBest ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              borderWidth: 1,
              borderColor: c.green,
              backgroundColor: c.greenSoft,
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 3,
            }}
          >
            <Icon name="trophy-outline" size={16} color={c.green} />
            <Text style={{ color: c.green, fontWeight: '900' }}>P1</Text>
          </View>
        ) : null
      }
      size={size}
    />
  );
  const speedCard = (
    <MetricCard
      icon="speedometer"
      label={`VELOCIDADE · MÁX ${state.maxSpeedKmh}`}
      accent={c.blue}
      value={state.speedKmh != null ? String(state.speedKmh) : '—'}
      unit="km/h"
      right={<SpeedGauge kmh={state.speedKmh} max={Math.max(100, state.maxSpeedKmh + 10)} size={landscape ? 84 : 70} />}
      size={size}
    />
  );
  const delta = state.deltaMs;
  const good = delta != null && delta <= 0;
  const thisLapCard = (
    <MetricCard
      icon="timer-sync-outline"
      label="ESTA VOLTA"
      accent={delta == null ? c.border : good ? c.green : c.red}
      value={delta == null ? (state.bestLap ? '—' : '1ª VOLTA') : good ? 'BOA' : 'LENTA'}
      valueColor={delta == null ? c.muted : good ? c.green : c.red}
      sub={delta != null ? `${fmtDelta(delta)} s vs. melhor` : 'delta vs. sua melhor volta'}
      right={
        delta != null ? (
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: good ? c.green : c.red,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name={good ? 'check-bold' : 'close-thick'} size={26} color={good ? c.onAccent : '#fff'} />
          </View>
        ) : null
      }
      size={size}
    />
  );

  // ---------------------------------------------------------------- painel central
  const timerSize = landscape ? clamp(Math.min(width * 0.11, (avail - 135) / 2.1), 34, 120) : Math.min(width * 0.2, 92);
  const center = (
    <BracketPanel color={c.green} style={{ alignItems: 'stretch' }}>
      <View style={{ alignItems: 'center' }}>
        <Text style={{ color: c.muted, fontWeight: '800', letterSpacing: 1.2, fontSize: 15 }}>POSIÇÃO</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <Text style={[numeric, { color: c.text, fontSize: timerSize * 0.85, fontWeight: "900", lineHeight: timerSize * 0.95 }]}>
            {me?.started ? `P${me.position}` : 'P–'}
          </Text>
          <Text style={[numeric, { color: c.muted, fontSize: timerSize * 0.32, marginLeft: 6, marginBottom: timerSize * 0.12 }]}>/{total}</Text>
        </View>
        <Text style={{ color: flash ? (flash.personalBest ? c.green : c.text) : c.muted, fontWeight: '800', letterSpacing: 1.2, fontSize: 15 }}>
          {flash
            ? flash.personalBest
              ? `VOLTA ${flash.lap.number} · MELHOR VOLTA!`
              : `VOLTA ${flash.lap.number} CONCLUÍDA`
            : state.lapStartLocalT == null
              ? linePending
                ? 'AGUARDANDO DIREÇÃO DA LINHA'
                : 'CRUZE A LINHA DE LARGADA'
              : 'TEMPO DA VOLTA'}
        </Text>
      </View>
      {flash ? (
        <Text numberOfLines={1} adjustsFontSizeToFit style={[numeric, { color: flash.personalBest ? c.green : c.text, fontSize: timerSize, textAlign: 'center', letterSpacing: -2 }]}>
          {fmtSec(flash.lap.timeMs)}
        </Text>
      ) : (
        <LapTimer startLocalT={state.lapStartLocalT} size={timerSize} />
      )}
      <View style={{ paddingHorizontal: 18, marginTop: 6 }}>
        <ProgressBar value={state.progress} color={c.green} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 12 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            borderWidth: 2,
            borderColor: c.green,
            backgroundColor: c.greenSoft,
            borderRadius: 999,
            paddingHorizontal: 16,
            paddingVertical: 6,
          }}
        >
          <Icon name="timer-outline" size={20} color={c.green} />
          <Text style={{ color: c.green, fontWeight: '900', letterSpacing: 1 }}>VOLTA ATUAL</Text>
        </View>
        <Text style={[numeric, { color: c.text, fontSize: 24 }]}>
          {currentLap || '–'}
          {target ? <Text style={{ color: c.muted }}> / {target}</Text> : null}
        </Text>
      </View>
    </BracketPanel>
  );

  // ---------------------------------------------------------------- cabeçalho
  const header = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: c.card,
        borderColor: c.border,
        borderWidth: 1,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 8,
        flexWrap: landscape ? 'nowrap' : 'wrap',
      }}
    >
      <Icon name="racing-helmet" size={30} />
      <View style={{ flex: 1, minWidth: 140 }}>
        <Text numberOfLines={1} style={{ color: c.text, fontWeight: '900', fontSize: 16, letterSpacing: 0.6 }}>
          {state.trackName.toUpperCase()}
        </Text>
        <Text numberOfLines={1} style={{ color: c.muted, fontWeight: '800', fontSize: 13 }}>
          PILOTO: <Text style={{ color: c.green }}>{state.pilotName.toUpperCase()}</Text>
          {'  ·  '}SALA {state.code}
        </Text>
      </View>
      {state.isHost && (
        <>
          <Btn title="Linha" icon="flag-checkered" compact variant="ghost" holdMs={1200} onPress={() =>
            confirm('Redefinir linha de largada', 'A linha passa para a sua posição atual e todas as voltas serão recalculadas.', actions.resetLine)
          } />
          <Btn title="Encerrar" icon="stop" compact variant="danger" holdMs={1500} onPress={() =>
            confirm('Encerrar corrida', 'A coleta de dados termina para todos os pilotos e os relatórios são gerados.', actions.finish)
          } />
        </>
      )}
      <Pressable onPress={actions.toggleVoice} hitSlop={8}>
        <Icon name={state.voice ? 'volume-high' : 'volume-off'} color={state.voice ? c.text : c.muted} />
      </Pressable>
      <Pressable onPress={cycle} hitSlop={8}>
        <Icon name="theme-light-dark" color={c.muted} />
      </Pressable>
      <SignalBadge gps={state.gps} accuracy={state.gpsAccuracy} connection={state.connection} pending={state.pending} />
    </View>
  );

  const banners = <Banners state={state} linePending={linePending} />;

  if (landscape) {
    return (
      <Screen style={{ padding: 10 }}>
        <View style={{ flex: 1, gap: 10 }}>
          {header}
          {banners}
          <View style={{ flex: 1, flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1, gap: 10 }}>
              {gapLeaderCard}
              {gapAheadCard}
              {gapBehindCard}
            </View>
            <View style={{ flex: 1.25 }}>{center}</View>
            <View style={{ flex: 1, gap: 10 }}>
              {bestCard}
              {speedCard}
              {thisLapCard}
            </View>
          </View>
          <BestLapsStrip standings={state.standings} meId={state.pilotId} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 10, gap: 10 }}>
        {header}
        {banners}
        <View style={{ minHeight: 330 }}>{center}</View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {gapAheadCard}
          {gapBehindCard}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {gapLeaderCard}
          {thisLapCard}
        </View>
        {bestCard}
        {speedCard}
        <BestLapsStrip standings={state.standings} meId={state.pilotId} vertical />
      </ScrollView>
    </Screen>
  );
}

function Banners({ state, linePending }: { state: RaceState; linePending: boolean }) {
  const { c } = useThemeColors();
  const items: { color: string; text: string }[] = [];
  if (state.connection === 'offline')
    items.push({ color: c.amber, text: `SEM INTERNET · o cronômetro continua e ${state.pending} pontos serão sincronizados` });
  if (linePending)
    items.push({
      color: c.blue,
      text: state.isHost ? 'Comece a andar: a direção da linha é definida pelo seu movimento' : 'Aguardando o criador definir a direção da linha',
    });
  if (state.gps === 'denied' || state.gps === 'weak') items.push({ color: c.red, text: state.error ?? `GPS fraco (±${state.gpsAccuracy ?? '?'} m)` });
  if (!items.length) return null;
  return (
    <View style={{ gap: 6 }}>
      {items.map((b) => (
        <View key={b.text} style={{ backgroundColor: c.card, borderLeftWidth: 5, borderLeftColor: b.color, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
          <Text style={{ color: b.color, fontWeight: '800' }}>{b.text}</Text>
        </View>
      ))}
    </View>
  );
}
