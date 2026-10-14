import { fmtDuration, fmtGap, fmtLap, GeneralReport } from '@kart/shared';
import { navigate } from '../lib/router';

/** Relatório geral da corrida (classificação final). */
export function ReportView({ report }: { report: GeneralReport }) {
  const rows = report.standings;
  const podium = rows.filter((r) => r.started).slice(0, 3);
  const duration = report.startedAt && report.finishedAt ? report.finishedAt - report.startedAt : null;
  const date = report.startedAt ? new Date(report.startedAt).toLocaleString('pt-BR') : '';

  return (
    <div className="page">
      <div className="report-head">
        <div>
          <div className="eyebrow">Resultado final · sala {report.sessionCode}</div>
          <h1>{report.trackName}</h1>
          <div className="muted">
            {date}
            {duration != null && ` · duração ${fmtDuration(duration)}`}
          </div>
        </div>
        <div className="no-print" style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(window.location.href)}>
            Copiar link
          </button>
          <button className="btn ghost" onClick={() => window.print()}>
            Imprimir / PDF
          </button>
        </div>
      </div>

      {podium.length > 0 && (
        <div className="podium">
          {podium.map((r) => (
            <div key={r.pilotId} className="card" style={{ ['--c' as string]: r.color }}>
              <div className="p">P{r.position}</div>
              <div className="n">{r.name}</div>
              <div className="muted num">
                {r.laps} voltas · melhor {fmtLap(r.bestLapMs)}
              </div>
            </div>
          ))}
        </div>
      )}

      {report.fastestLap && (
        <div className="card panel-pad" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="pill" style={{ color: 'var(--purple)', borderColor: 'var(--purple)' }}>
            Volta mais rápida
          </span>
          <strong>{report.fastestLap.name}</strong>
          <span className="num" style={{ color: 'var(--purple)', fontWeight: 700, fontSize: 20 }}>
            {fmtLap(report.fastestLap.timeMs)}
          </span>
          <span className="muted">volta {report.fastestLap.lapNumber}</span>
        </div>
      )}

      <div className="card table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Pos</th>
              <th>Piloto</th>
              <th className="r">Voltas</th>
              <th className="r">Melhor volta</th>
              <th className="r">Tempo total</th>
              <th className="r">Intervalo</th>
              <th className="r">Gap p/ líder</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pilotId} className="clickable" onClick={() => navigate(`/s/${report.sessionCode}/pilot/${r.pilotId}`)}>
                <td style={{ fontWeight: 900, fontSize: 17 }}>{r.started ? r.position : '–'}</td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                    <span className="cbar" style={{ background: r.color, height: 20 }} />
                    <span className="knum" style={{ width: 30 }}>
                      {r.number}
                    </span>
                    <strong style={{ textTransform: 'uppercase' }}>{r.name}</strong>
                  </span>
                </td>
                <td className="r num">{r.laps}</td>
                <td className="r num" style={r.pilotId === report.fastestLap?.pilotId ? { color: 'var(--purple)', fontWeight: 700 } : undefined}>
                  {fmtLap(r.bestLapMs)} {r.bestLapNumber ? <span className="muted">(V{r.bestLapNumber})</span> : null}
                </td>
                <td className="r num">{fmtLap(r.totalTimeMs)}</td>
                <td className="r num">{r.position === 1 ? (r.gapBehind ? `${fmtGap(r.gapBehind)} p/ 2º` : '—') : fmtGap(r.gapAhead)}</td>
                <td className="r num">{r.position === 1 ? 'LÍDER' : fmtGap(r.gapLeader)}</td>
                <td className="r muted no-print">detalhes ›</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
        Classificação por voltas completadas e pela ordem de passagem na linha de chegada. O intervalo é a diferença entre as
        passagens pela linha na mesma volta — não a diferença entre tempos de volta nem a distância física entre os karts.
        Tempos com precisão de milissegundos interpolados entre amostras de GPS; a incerteza real depende da frequência do GPS
        de cada celular.
      </p>
    </div>
  );
}
