import { useEffect, useState } from 'react';
import { fmtDelta, fmtLap, GeneralReport, PilotReport } from '@kart/shared';
import { DeltaBars, LapChart } from '../components/LapChart';
import { ReportView } from '../components/ReportView';
import { Topbar } from '../components/Topbar';
import { TraceMap } from '../components/TraceMap';
import { api } from '../lib/api';
import { Link } from '../lib/router';
import type { Theme } from '../lib/theme';

interface PageProps {
  code: string;
  theme: Theme;
  toggleTheme: () => void;
}

export function GeneralReportPage({ code, theme, toggleTheme }: PageProps) {
  const [report, setReport] = useState<GeneralReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.report(code).then(setReport).catch((e) => setErr(e.message));
  }, [code]);
  return (
    <>
      <Topbar theme={theme} onToggleTheme={toggleTheme}>
        <span className="spacer" />
        <Link to={`/s/${code}`} className="icon-btn" style={{ textDecoration: 'none' }}>
          Ao vivo
        </Link>
      </Topbar>
      {err && <p className="page error">{err}</p>}
      {report && <ReportView report={report} />}
    </>
  );
}

export function PilotReportPage({ code, pilotId, theme, toggleTheme }: PageProps & { pilotId: string }) {
  const [r, setR] = useState<PilotReport | null>(null);
  const [trace, setTrace] = useState<Array<{ lat: number; lng: number; speed: number | null }>>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .pilotReport(code, pilotId)
      .then((rep) => {
        setR(rep);
        if (rep.bestLap) api.trace(code, pilotId, rep.bestLap.number).then(setTrace).catch(() => undefined);
      })
      .catch((e) => setErr(e.message));
  }, [code, pilotId]);

  return (
    <>
      <Topbar theme={theme} onToggleTheme={toggleTheme}>
        <span className="spacer" />
        <Link to={`/s/${code}/report`} className="icon-btn" style={{ textDecoration: 'none' }}>
          ‹ Classificação
        </Link>
      </Topbar>
      <div className="page">
        {err && <p className="error">{err}</p>}
        {r && (
          <>
            <div className="report-head">
              <div>
                <div className="eyebrow">Relatório individual · sala {code}</div>
                <h1 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="cbar" style={{ background: r.color, height: 34, width: 8 }} />#{r.number} {r.name}
                </h1>
              </div>
              <button className="btn ghost no-print" onClick={() => window.print()}>
                Imprimir / PDF
              </button>
            </div>

            <div className="stats">
              <Stat k="Posição" v={r.position ? `P${r.position}` : '—'} c={r.color} />
              <Stat k="Voltas" v={String(r.laps.length)} />
              <Stat k="Melhor volta" v={fmtLap(r.bestLap?.timeMs)} s={r.bestLap ? `volta ${r.bestLap.number}` : ''} c="var(--purple)" />
              <Stat k="Pior volta" v={fmtLap(r.worstLap?.timeMs)} s={r.worstLap ? `volta ${r.worstLap.number}` : ''} c="var(--red)" />
              <Stat k="Média" v={fmtLap(r.averageMs)} s={`mediana ${fmtLap(r.medianMs)}`} c="var(--amber)" />
              <Stat k="Consistência" v={r.stdDevMs != null ? `±${(r.stdDevMs / 1000).toFixed(3)}s` : '—'} s="desvio padrão" />
              <Stat
                k="Evolução"
                v={r.improvementMs != null ? fmtDelta(r.improvementMs) : '—'}
                s={r.trendMsPerLap != null ? `${r.trendMsPerLap <= 0 ? 'melhorando' : 'piorando'} ${Math.abs(r.trendMsPerLap)} ms/volta` : 'fim vs. início'}
                c={r.improvementMs != null && r.improvementMs <= 0 ? 'var(--accent)' : 'var(--red)'}
              />
              <Stat k="Vel. máxima" v={r.maxSpeedKmh != null ? `${Math.round(r.maxSpeedKmh)}` : '—'} s="km/h (GPS)" c="var(--blue)" />
            </div>

            <div className="grid-2">
              <div className="card panel-pad">
                <div className="section-title" style={{ padding: '0 0 8px' }}>
                  Evolução dos tempos
                </div>
                <LapChart laps={r.laps} averageMs={r.averageMs} color={r.color} />
                <div className="section-title" style={{ padding: '14px 0 8px' }}>
                  Diferença para a volta anterior
                </div>
                <DeltaBars laps={r.laps} />
              </div>
              <div className="card panel-pad">
                <div className="section-title" style={{ padding: '0 0 8px' }}>
                  Melhor volta · velocidade no traçado
                </div>
                {trace.length > 1 ? <TraceMap points={trace} theme={theme} /> : <p className="muted">Sem traçado disponível.</p>}
              </div>
            </div>

            <div className="card table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Volta</th>
                    <th className="r">Tempo</th>
                    <th className="r">vs. anterior</th>
                    <th className="r">vs. melhor</th>
                    <th className="r" title="Incerteza estimada: erro de posição do GPS ÷ velocidade na linha">Incerteza</th>
                  </tr>
                </thead>
                <tbody>
                  {r.laps.map((l) => (
                    <tr key={l.number}>
                      <td>
                        {l.number}
                        {l.isBest && <span style={{ color: 'var(--purple)', marginLeft: 8, fontWeight: 700 }}>MELHOR</span>}
                        {l.isWorst && <span style={{ color: 'var(--red)', marginLeft: 8, fontWeight: 700 }}>PIOR</span>}
                      </td>
                      <td className="r num" style={l.isBest ? { color: 'var(--purple)', fontWeight: 700 } : undefined}>
                        {fmtLap(l.timeMs)}
                      </td>
                      <td className={`r num ${l.deltaPrevMs == null ? '' : l.deltaPrevMs > 0 ? 'up' : 'down'}`}>{fmtDelta(l.deltaPrevMs)}</td>
                      <td className="r num muted">{l.isBest ? '—' : `+${(l.deltaBestMs / 1000).toFixed(3)}`}</td>
                      <td className="r num muted">±{l.uncertaintyMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Stat({ k, v, s, c }: { k: string; v: string; s?: string; c?: string }) {
  return (
    <div className="card stat" style={c ? { ['--c' as string]: c } : undefined}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {s && <div className="s">{s}</div>}
    </div>
  );
}
