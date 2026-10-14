import { fmtSec, LapRow } from '@kart/shared';

/** Evolução dos tempos de volta (SVG puro). */
export function LapChart({ laps, averageMs, color }: { laps: LapRow[]; averageMs: number | null; color: string }) {
  if (laps.length < 2) return <p className="muted">São necessárias ao menos 2 voltas para o gráfico.</p>;
  const W = 640;
  const H = 240;
  const P = { l: 54, r: 14, t: 14, b: 28 };
  const times = laps.map((l) => l.timeMs);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const pad = Math.max(300, (max - min) * 0.15);
  const lo = min - pad;
  const hi = max + pad;
  const x = (i: number) => P.l + (i / (laps.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const ticks = 4;
  const path = laps.map((l, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(l.timeMs).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Gráfico de tempos por volta">
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = lo + ((hi - lo) * i) / ticks;
        return (
          <g key={i}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={P.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" fontFamily="var(--mono)">
              {fmtSec(v)}
            </text>
          </g>
        );
      })}
      {averageMs != null && (
        <g>
          <line x1={P.l} x2={W - P.r} y1={y(averageMs)} y2={y(averageMs)} stroke="var(--amber)" strokeDasharray="5 5" />
          <text x={W - P.r} y={y(averageMs) - 6} textAnchor="end" fontSize="11" fill="var(--amber)">
            média
          </text>
        </g>
      )}
      <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" />
      {laps.map((l, i) => (
        <g key={l.number}>
          <circle
            cx={x(i)}
            cy={y(l.timeMs)}
            r={l.isBest || l.isWorst ? 6 : 4}
            fill={l.isBest ? 'var(--purple)' : l.isWorst ? 'var(--red)' : 'var(--panel)'}
            stroke={l.isBest ? 'var(--purple)' : l.isWorst ? 'var(--red)' : color}
            strokeWidth="2"
          >
            <title>{`Volta ${l.number}: ${fmtSec(l.timeMs)}s`}</title>
          </circle>
          {(laps.length <= 20 || i % Math.ceil(laps.length / 20) === 0) && (
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">
              {l.number}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** Diferença entre voltas consecutivas (barras: verde = mais rápida). */
export function DeltaBars({ laps }: { laps: LapRow[] }) {
  const rows = laps.filter((l) => l.deltaPrevMs != null);
  if (!rows.length) return null;
  const W = 640;
  const H = 160;
  const P = { l: 54, r: 14, t: 10, b: 24 };
  const maxAbs = Math.max(200, ...rows.map((l) => Math.abs(l.deltaPrevMs as number)));
  const bw = (W - P.l - P.r) / rows.length;
  const mid = P.t + (H - P.t - P.b) / 2;
  const scale = (H - P.t - P.b) / 2 / maxAbs;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Diferença entre voltas consecutivas">
      <line x1={P.l} x2={W - P.r} y1={mid} y2={mid} stroke="var(--line-2)" />
      <text x={P.l - 8} y={P.t + 10} textAnchor="end" fontSize="11" fill="var(--muted)" fontFamily="var(--mono)">
        +{fmtSec(maxAbs)}
      </text>
      <text x={P.l - 8} y={H - P.b} textAnchor="end" fontSize="11" fill="var(--muted)" fontFamily="var(--mono)">
        -{fmtSec(maxAbs)}
      </text>
      {rows.map((l, i) => {
        const d = l.deltaPrevMs as number;
        const h = Math.abs(d) * scale;
        return (
          <g key={l.number}>
            <rect
              x={P.l + i * bw + bw * 0.15}
              width={bw * 0.7}
              y={d > 0 ? mid - h : mid}
              height={Math.max(1, h)}
              rx="3"
              fill={d > 0 ? 'var(--red)' : 'var(--accent)'}
            >
              <title>{`Volta ${l.number}: ${d > 0 ? '+' : ''}${fmtSec(d)}s vs anterior`}</title>
            </rect>
            {(rows.length <= 20 || i % Math.ceil(rows.length / 20) === 0) && (
              <text x={P.l + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">
                {l.number}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
