import { ReactNode } from 'react';
import { Link } from '../lib/router';
import type { Theme } from '../lib/theme';

export function Topbar({ theme, onToggleTheme, children }: { theme: Theme; onToggleTheme: () => void; children?: ReactNode }) {
  return (
    <header className="topbar">
      <Link to="/" className="brand">
        <span className="brand-mark">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <path d="M3 17h18M6 17l2.5-7h7L18 17M9 10l1-3h4l1 3" />
          </svg>
        </span>
        <span className="hide-sm">Kart Telemetria</span>
      </Link>
      {children}
      <button className="icon-btn" onClick={onToggleTheme} title="Alternar tema claro/escuro" aria-label="Alternar tema">
        {theme === 'dark' ? '☀' : '☾'}
      </button>
    </header>
  );
}
