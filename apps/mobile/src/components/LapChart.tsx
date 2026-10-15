import { useState } from 'react';
import { LayoutChangeEvent, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { fmtSec, LapRow } from '@kart/shared';
import { useThemeColors } from '../lib/theme';

/** Evolução dos tempos + barras de diferença entre voltas consecutivas. */
export function LapChart({ laps, averageMs, color }: { laps: LapRow[]; averageMs: number | null; color: string }) {
  const { c } = useThemeColors();
  const [w, setW] = useState(320);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  if (laps.length < 2) return null;

  const H = 190;
  const P = { l: 52, r: 10, t: 10, b: 22 };
  const times = laps.map((l) => l.timeMs);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const pad = Math.max(300, (max - min) * 0.15);
  const lo = min - pad;
  const hi = max + pad;
  const x = (i: number) => P.l + (i / (laps.length - 1)) * (w - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const d = laps.map((l, i) => `${i ? 'L' : 'M'}${x(i)},${y(l.timeMs)}`).join(' ');

  const deltas = laps.filter((l) => l.deltaPrevMs != null);
  const DH = 110;
  const maxAbs = Math.max(200, ...deltas.map((l) => Math.abs(l.deltaPrevMs as number)));
  const mid = DH / 2;
  const bw = (w - P.l - P.r) / Math.max(1, deltas.length);

  return (
    <View onLayout={onLayout} style={{ gap: 10 }}>
      <Svg width={w} height={H}>
        {[0, 1, 2, 3].map((i) => {
          const v = lo + ((hi - lo) * i) / 3;
          return (
            <G key={i}>
              <Line x1={P.l} x2={w - P.r} y1={y(v)} y2={y(v)} stroke={c.border} />
              <SvgText x={P.l - 6} y={y(v) + 4} fontSize={10} fill={c.muted} textAnchor="end">
                {fmtSec(v)}
              </SvgText>
            </G>
          );
        })}
        {averageMs != null && <Line x1={P.l} x2={w - P.r} y1={y(averageMs)} y2={y(averageMs)} stroke={c.amber} strokeDasharray="5 5" />}
        <Path d={d} stroke={color} strokeWidth={3} fill="none" />
        {laps.map((l, i) => (
          <Circle
            key={l.number}
            cx={x(i)}
            cy={y(l.timeMs)}
            r={l.isBest || l.isWorst ? 6 : 3.5}
            fill={l.isBest ? c.purple : l.isWorst ? c.red : c.card}
            stroke={l.isBest ? c.purple : l.isWorst ? c.red : color}
            strokeWidth={2}
          />
        ))}
        {laps.map((l, i) =>
          laps.length <= 12 || i % Math.ceil(laps.length / 12) === 0 ? (
            <SvgText key={`t${l.number}`} x={x(i)} y={H - 6} fontSize={10} fill={c.muted} textAnchor="middle">
              {l.number}
            </SvgText>
          ) : null,
        )}
      </Svg>
      {deltas.length > 0 && (
        <Svg width={w} height={DH}>
          <Line x1={P.l} x2={w - P.r} y1={mid} y2={mid} stroke={c.border} />
          <SvgText x={P.l - 6} y={12} fontSize={10} fill={c.muted} textAnchor="end">
            +{fmtSec(maxAbs)}
          </SvgText>
          <SvgText x={P.l - 6} y={DH - 2} fontSize={10} fill={c.muted} textAnchor="end">
            -{fmtSec(maxAbs)}
          </SvgText>
          {deltas.map((l, i) => {
            const v = l.deltaPrevMs as number;
            const h = (Math.abs(v) / maxAbs) * (mid - 4);
            return (
              <Rect
                key={l.number}
                x={P.l + i * bw + bw * 0.15}
                width={bw * 0.7}
                y={v > 0 ? mid - h : mid}
                height={Math.max(1, h)}
                rx={3}
                fill={v > 0 ? c.red : c.green}
              />
            );
          })}
        </Svg>
      )}
    </View>
  );
}
