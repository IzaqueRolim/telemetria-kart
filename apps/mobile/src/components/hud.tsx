/**
 * Componentes do painel de corrida — inspirados no RaceChrono e na imagem de
 * referência: cartões escuros com faixa colorida à esquerda, números grandes.
 */
import { ReactNode, useEffect, useState } from 'react';
import { Text, View, ViewStyle } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { fmtLap, fmtSec, Gap, StandingRow } from '@kart/shared';
import { numeric, useThemeColors } from '../lib/theme';
import { Icon, IconName } from './ui';

export function gapParts(gap: Gap | null | undefined): { value: string; unit: string } {
  if (!gap) return { value: '—', unit: '' };
  if (gap.laps > 0) return { value: `+${gap.laps}`, unit: gap.laps === 1 ? 'VOLTA' : 'VOLTAS' };
  return { value: `+${fmtSec(gap.ms)}`, unit: 's' };
}

interface MetricProps {
  icon: IconName;
  label: string;
  value: string;
  unit?: string;
  accent: string;
  valueColor?: string;
  arrow?: 'up' | 'down' | null;
  arrowColor?: string;
  badge?: ReactNode;
  right?: ReactNode;
  sub?: string;
  size?: number;
  style?: ViewStyle;
}

export function MetricCard({ icon, label, value, unit, accent, valueColor, arrow, arrowColor, badge, right, sub, size = 40, style }: MetricProps) {
  const { c } = useThemeColors();
  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor: c.card,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: c.border,
          borderLeftWidth: 6,
          borderLeftColor: accent,
          paddingHorizontal: 14,
          paddingVertical: size > 30 ? 10 : 6,
          justifyContent: 'center',
          minHeight: size > 30 ? 84 : 0,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name={icon} size={size > 30 ? 24 : 18} color={c.muted} />
        <Text numberOfLines={1} style={{ color: c.muted, fontWeight: '800', fontSize: size > 30 ? 14 : 12, letterSpacing: 0.8, flex: 1 }}>
          {label}
        </Text>
        {badge}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
        {arrow ? (
          <Text style={{ color: arrowColor ?? accent, fontSize: size * 0.55, marginRight: 8, marginLeft: 4 }}>{arrow === 'up' ? '▲' : '▼'}</Text>
        ) : null}
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[numeric, { color: valueColor ?? c.text, fontSize: size, letterSpacing: -1, flexShrink: 1 }]}
        >
          {value}
          {unit ? <Text style={{ fontSize: size * 0.5, fontWeight: '700', color: valueColor ?? c.text }}> {unit}</Text> : null}
        </Text>
        <View style={{ flex: 1 }} />
        {right}
      </View>
      {sub ? (
        <Text numberOfLines={1} style={{ color: c.muted, fontSize: 13, fontWeight: '600', marginTop: 2 }}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

/** Mostrador semicircular de velocidade. */
export function SpeedGauge({ kmh, max = 120, size = 84 }: { kmh: number | null; max?: number; size?: number }) {
  const { c } = useThemeColors();
  const r = size / 2 - 7;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const start = Math.PI * 1.1;
  const end = Math.PI * 1.9;
  const point = (a: number, rr = r) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  const arc = (a0: number, a1: number) => {
    const [x0, y0] = point(a0);
    const [x1, y1] = point(a1);
    return `M${x0},${y0} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1},${y1}`;
  };
  const k = Math.max(0, Math.min(1, (kmh ?? 0) / max));
  const a = start + (end - start) * k;
  const [nx, ny] = point(a, r - 10);
  const seg = (end - start) / 3;
  return (
    <Svg width={size} height={size * 0.7} viewBox={`0 ${size * 0.08} ${size} ${size * 0.62}`}>
      <Path d={arc(start, end)} stroke={c.border} strokeWidth={8} fill="none" strokeLinecap="round" />
      <Path d={arc(start, start + seg)} stroke={c.green} strokeWidth={8} fill="none" strokeLinecap="round" />
      {k > 0.33 && <Path d={arc(start + seg, start + seg * 2)} stroke={c.green} strokeWidth={8} fill="none" />}
      {k > 0.66 && <Path d={arc(start + seg * 2, Math.min(a, end))} stroke={c.amber} strokeWidth={8} fill="none" strokeLinecap="round" />}
      <Line x1={cx} y1={cy} x2={nx} y2={ny} stroke={c.text} strokeWidth={4} strokeLinecap="round" />
      <Circle cx={cx} cy={cy} r={5} fill={c.text} />
    </Svg>
  );
}

/** Moldura com cantos em destaque (painel central). */
export function BracketPanel({ children, color, style }: { children: ReactNode; color: string; style?: ViewStyle }) {
  const { c } = useThemeColors();
  const corner = (pos: ViewStyle): ViewStyle => ({ position: 'absolute', width: 46, height: 46, borderColor: color, ...pos });
  return (
    <View
      style={[
        { flex: 1, backgroundColor: c.card, borderRadius: 18, borderWidth: 1, borderColor: c.border, padding: 14, justifyContent: 'center' },
        style,
      ]}
    >
      <View style={corner({ top: 26, left: 14, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 16 })} />
      <View style={corner({ top: 26, right: 14, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 16 })} />
      <View style={corner({ bottom: 26, left: 14, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 16 })} />
      <View style={corner({ bottom: 26, right: 14, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 16 })} />
      {children}
    </View>
  );
}

/** Cronômetro da volta atual (re-renderiza sozinho a ~20 fps). */
export function LapTimer({ startLocalT, size, color }: { startLocalT: number | null; size: number; color?: string }) {
  const { c } = useThemeColors();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (startLocalT == null) return;
    const t = setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(t);
  }, [startLocalT]);
  const text = startLocalT == null ? '--.---' : fmtSec(Math.max(0, now - startLocalT));
  return (
    <Text numberOfLines={1} adjustsFontSizeToFit style={[numeric, { color: color ?? c.text, fontSize: size, letterSpacing: -2, textAlign: 'center' }]}>
      {text}
    </Text>
  );
}

export function ProgressBar({ value, color }: { value: number | null; color: string }) {
  const { c } = useThemeColors();
  return (
    <View style={{ height: 12, borderRadius: 6, backgroundColor: c.card2, overflow: 'hidden', borderWidth: 1, borderColor: c.border }}>
      <View style={{ width: `${Math.round((value ?? 0) * 100)}%`, height: '100%', backgroundColor: color, borderRadius: 6 }} />
    </View>
  );
}

/** Faixa inferior "Melhores voltas da pista" (top 3 da sessão). */
export function BestLapsStrip({ standings, meId, vertical }: { standings: StandingRow[]; meId: string; vertical?: boolean }) {
  const { c } = useThemeColors();
  const top = standings
    .filter((r) => r.bestLapMs != null)
    .sort((a, b) => (a.bestLapMs as number) - (b.bestLapMs as number))
    .slice(0, 3);
  const first = top[0]?.bestLapMs ?? 0;
  return (
    <View
      style={{
        backgroundColor: c.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: c.border,
        flexDirection: vertical ? 'column' : 'row',
        alignItems: vertical ? 'stretch' : 'center',
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: vertical ? 8 : 14,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: vertical ? undefined : 150 }}>
        <Icon name="crosshairs-gps" size={26} color={c.muted} />
        <Text style={{ color: c.muted, fontWeight: '800', fontSize: 13, letterSpacing: 0.8 }}>MELHORES VOLTAS{'\n'}DA PISTA</Text>
      </View>
      {top.length === 0 ? (
        <Text style={{ color: c.faint, fontWeight: '700', flex: 1 }}>Nenhuma volta completa ainda</Text>
      ) : (
        top.map((r, i) => {
          const me = r.pilotId === meId;
          return (
            <View
              key={r.pilotId}
              style={{
                flex: vertical ? undefined : 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                borderLeftWidth: vertical ? 0 : 1,
                borderLeftColor: c.border,
                paddingLeft: vertical ? 0 : 12,
              }}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  backgroundColor: i === 0 ? c.greenSoft : c.card2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: i === 0 ? c.green : c.border,
                }}
              >
                <Text style={[numeric, { color: i === 0 ? c.green : c.text, fontSize: 18 }]}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: me ? c.green : c.muted, fontWeight: '800', fontSize: 12, letterSpacing: 0.6 }}>
                  {me ? 'VOCÊ' : r.name.toUpperCase()}
                </Text>
                <Text style={[numeric, { color: i === 0 ? c.green : c.text, fontSize: 19 }]}>{fmtLap(r.bestLapMs)}</Text>
              </View>
              <Text style={[numeric, { color: c.muted, fontSize: 13, fontWeight: '700' }]}>
                {i === 0 ? '—' : `+${fmtSec((r.bestLapMs as number) - first)}`}
              </Text>
            </View>
          );
        })
      )}
    </View>
  );
}
