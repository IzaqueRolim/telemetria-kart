import { fmtGap, fmtLap, LivePosition, StandingRow } from '@kart/shared';

const ROW_H = 46;
const ROW_GAP = 6;

interface Props {
  standings: StandingRow[];
  positions: Record<string, LivePosition>;
  selected?: string | null;
  onSelect?: (pilotId: string) => void;
}

/**
 * Torre de classificação. As linhas são posicionadas por transform, então as
 * ultrapassagens aparecem animadas (como na transmissão de F1).
 */
export function Tower({ standings, positions, selected, onSelect }: Props) {
  const sessionBest = standings.reduce<number | null>(
    (b, r) => (r.bestLapMs != null && (b == null || r.bestLapMs < b) ? r.bestLapMs : b),
    null,
  );
  // ordem estável de renderização (por id) para a animação funcionar
  const byId = [...standings].sort((a, b) => a.pilotId.localeCompare(b.pilotId));

  return (
    <div className="tower">
      <div className="tower-head">
        <span>Pos</span>
        <span />
        <span>#</span>
        <span>Piloto</span>
        <span className="r">V<span className="hide-xs">oltas</span></span>
        <span className="r">Melhor</span>
        <span className="r" title="Gap de corrida para o piloto imediatamente à frente (líder: vantagem sobre o 2º)">
          Intervalo
        </span>
      </div>
      <div className="tower-body" style={{ height: standings.length * (ROW_H + ROW_GAP) }}>
        {byId.map((r) => {
          const pos = positions[r.pilotId];
          const stale = !!pos?.stale;
          const isLeader = r.position === 1 && r.started;
          const dist = pos?.distanceAheadM;
          return (
            <div
              key={r.pilotId}
              className={`tower-row${stale ? ' stale' : ''}${selected === r.pilotId ? ' selected' : ''}`}
              style={{ transform: `translateY(${(r.position - 1) * (ROW_H + ROW_GAP)}px)` }}
              onClick={() => onSelect?.(r.pilotId)}
            >
              <span className="pos">{r.started ? r.position : '–'}</span>
              <span className="cbar" style={{ background: r.color }} />
              <span className="knum">{r.number}</span>
              <span className="pname">
                {r.name}
                <small>
                  {stale ? (
                    <span className="tag-stale">⚠ posição desatualizada</span>
                  ) : !r.started ? (
                    'aguardando largada'
                  ) : (
                    <>
                      última {fmtLap(r.lastLapMs)}
                      {dist != null && r.position > 1 ? ` · ${dist} m do kart à frente` : ''}
                    </>
                  )}
                </small>
              </span>
              <span className="r num">{r.laps}</span>
              <span className={`r num best${r.bestLapMs != null && r.bestLapMs === sessionBest ? ' purple' : ''}`}>
                {fmtLap(r.bestLapMs)}
              </span>
              <span className="r num">
                {isLeader ? (
                  <span className="gap-lead">
                    {r.gapBehind ? fmtGap(r.gapBehind) : 'LÍDER'}
                    {r.gapBehind && <span className="cell-sub">LÍDER</span>}
                  </span>
                ) : (
                  fmtGap(r.gapAhead)
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
