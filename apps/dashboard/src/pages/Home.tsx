import { FormEvent, useEffect, useState } from 'react';
import { fmtDuration, SessionSummary } from '@kart/shared';
import { Topbar } from '../components/Topbar';
import { api } from '../lib/api';
import { Link, navigate } from '../lib/router';
import type { Theme } from '../lib/theme';

const STATUS: Record<string, string> = { LOBBY: 'Aguardando', RUNNING: 'Ao vivo', FINISHED: 'Encerrada' };

export function Home({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  const [code, setCode] = useState('');
  const [list, setList] = useState<SessionSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.sessions().then(setList).catch((e) => setErr(e.message));
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c.length >= 4) navigate(`/s/${c}`);
  };

  return (
    <>
      <Topbar theme={theme} onToggleTheme={toggleTheme} />
      <div className="page">
        <section className="hero">
          <div className="eyebrow">Telemetria ao vivo</div>
          <h1>
            Acompanhe a corrida <em>em tempo real</em>
          </h1>
          <p>Digite o código da sala mostrado no app do piloto. Não precisa instalar nada — funciona no celular e no computador.</p>
          <form className="code-form" onSubmit={submit}>
            <input
              className="input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="CÓDIGO"
              aria-label="Código da sala"
              autoFocus
              inputMode="text"
              autoCapitalize="characters"
            />
            <button className="btn" type="submit">
              Assistir
            </button>
          </form>
        </section>

        <div className="section-title" style={{ paddingLeft: 0 }}>
          Sessões recentes
        </div>
        {err && <p className="error">{err}</p>}
        {list && list.length === 0 && <p className="muted">Nenhuma sessão ainda. Crie uma sala pelo app do piloto.</p>}
        <div className="list">
          {list?.map((s) => (
            <Link key={s.code} to={s.status === 'FINISHED' ? `/s/${s.code}/report` : `/s/${s.code}`} className="card list-item">
              <span className="num" style={{ fontWeight: 700, letterSpacing: '0.15em' }}>
                {s.code}
              </span>
              <span>
                <strong style={{ textTransform: 'uppercase' }}>{s.trackName}</strong>
                <span className="muted" style={{ display: 'block', fontSize: 13 }}>
                  {new Date(s.startedAt ?? s.createdAt).toLocaleString('pt-BR')} · {s.pilots} pilotos
                  {s.startedAt && s.finishedAt ? ` · ${fmtDuration(s.finishedAt - s.startedAt)}` : ''}
                </span>
              </span>
              <span className={`pill${s.status === 'RUNNING' ? ' live' : s.status === 'FINISHED' ? ' done' : ''}`}>{STATUS[s.status]}</span>
              <span className="muted">›</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
