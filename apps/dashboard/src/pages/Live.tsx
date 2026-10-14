import { useCallback, useEffect, useState } from 'react';
import { fmtDuration, fmtLap } from '@kart/shared';
import { LiveMap } from '../components/LiveMap';
import { ReportView } from '../components/ReportView';
import { Topbar } from '../components/Topbar';
import { Tower } from '../components/Tower';
import { api } from '../lib/api';
import { Link } from '../lib/router';
import type { Theme } from '../lib/theme';
import { useLiveSession } from '../lib/useLiveSession';
import type { GeneralReport } from '@kart/shared';

function useNow(ms = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function Live({ code, theme, toggleTheme }: { code: string; theme: Theme; toggleTheme: () => void }) {
  const live = useLiveSession(code);
  const [selected, setSelected] = useState<string | null>(null);
  const [report, setReport] = useState<GeneralReport | null>(null);
  const now = useNow();
  const s = live.session;
  const onSelect = useCallback((id: string) => setSelected((cur) => (cur === id ? null : id)), []);

  // corrida encerrada: carrega o relatório geral
  useEffect(() => {
    if (live.report) setReport(live.report);
    else if (s?.status === 'FINISHED') api.report(s.code).then(setReport).catch(() => undefined);
  }, [s?.status, s?.code, live.report]);

  const status = s?.status;
  const elapsed = s?.startedAt ? (s.finishedAt ?? now + live.clockOffset) - s.startedAt : null;
  const leaderLaps = live.standings[0]?.laps ?? 0;
  const staleCount = Object.values(live.positions).filter((p) => p.stale).length;
  const nameOf = (id: string) => s?.pilots.find((p) => p.id === id);

  return (
    <>
      <Topbar theme={theme} onToggleTheme={toggleTheme}>
        <span className="divider hide-sm" />
        <div className="track-title">
          {s?.trackName ?? 'Conectando…'}
          <small>SALA {code}</small>
        </div>
        <span className="spacer" />
        {staleCount > 0 && status === 'RUNNING' && (
          <span className="pill warn hide-sm">{staleCount} sem sinal</span>
        )}
        {status === 'RUNNING' && s?.targetLaps ? (
          <span className="pill hide-sm num">
            Volta {Math.min(leaderLaps + 1, s.targetLaps)}/{s.targetLaps}
          </span>
        ) : null}
        {elapsed != null && <span className="clock">{fmtDuration(elapsed)}</span>}
        {!live.connected ? (
          <span className="pill warn">Reconectando</span>
        ) : status === 'RUNNING' ? (
          <span className="pill live">Ao vivo</span>
        ) : status === 'FINISHED' ? (
          <span className="pill done">Encerrada</span>
        ) : (
          <span className="pill">Aguardando largada</span>
        )}
      </Topbar>

      {live.error && !s ? (
        <div className="page">
          <p className="error">{live.error}</p>
          <Link to="/">← Voltar</Link>
        </div>
      ) : status === 'FINISHED' && report ? (
        <ReportView report={report} />
      ) : (
        <div className="live-layout">
          <aside className="live-side">
            <div className="section-title">
              <span>Classificação</span>
              <span>{s?.pilots.length ?? 0} pilotos</span>
            </div>
            <Tower standings={live.standings} positions={live.positions} selected={selected} onSelect={onSelect} />
            {status === 'LOBBY' && (
              <p className="muted" style={{ padding: '0 16px' }}>
                Os pilotos estão entrando na sala. A corrida começa quando o criador tocar em <b>Iniciar corrida</b> no app.
              </p>
            )}
            {live.feed.length > 0 && (
              <>
                <div className="section-title">Últimas voltas</div>
                <div className="feed">
                  {live.feed.map((f) => {
                    const p = nameOf(f.pilotId);
                    return (
                      <div key={f.key} className={`feed-item${f.sessionBest ? ' sb' : f.personalBest ? ' pb' : ''}`}>
                        <span className="cbar" style={{ background: p?.color, height: 16 }} />
                        <strong style={{ textTransform: 'uppercase' }}>{p?.name}</strong>
                        <span className="muted">V{f.lap.number}</span>
                        <span className="t num">
                          {f.sessionBest ? '★ ' : ''}
                          {fmtLap(f.lap.timeMs)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </aside>
          <section className="live-map">
            <LiveMap
              theme={theme}
              trackPath={s?.trackPath ?? null}
              line={s?.line ?? null}
              pilots={s?.pilots ?? []}
              positions={live.positions}
              standings={live.standings}
              selected={selected}
              onSelect={onSelect}
            />
            {Object.keys(live.positions).length === 0 && (
              <div className="map-overlay map-empty">
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>
                    {status === 'RUNNING' ? 'Aguardando sinais de GPS…' : 'O mapa aparece quando a corrida começar'}
                  </div>
                  <div style={{ marginTop: 6 }}>O traçado é desenhado automaticamente após a primeira volta completa.</div>
                </div>
              </div>
            )}
            {s?.line && s.line.bearing == null && status === 'RUNNING' && (
              <div className="map-overlay" style={{ top: 12, left: 12 }}>
                <span className="chip">Linha marcada · a direção é definida quando o kart do criador andar</span>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
