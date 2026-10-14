import { Gap } from './classification';

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

/** 41982 → "0:41.982" */
export function fmtLap(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) return '—';
  const sign = ms < 0 ? '-' : '';
  const v = Math.abs(Math.round(ms));
  const m = Math.floor(v / 60000);
  const s = Math.floor((v % 60000) / 1000);
  return `${sign}${m}:${pad(s, 2)}.${pad(v % 1000, 3)}`;
}

/** 40131 → "40.131"; acima de 1 min usa m:ss.mmm */
export function fmtSec(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) return '—';
  if (Math.abs(ms) >= 60000) return fmtLap(ms);
  const sign = ms < 0 ? '-' : '';
  const v = Math.abs(Math.round(ms));
  return `${sign}${Math.floor(v / 1000)}.${pad(v % 1000, 3)}`;
}

/** Gap de corrida: "+1.200" ou "+1 V" quando há volta de diferença. */
export function fmtGap(gap: Gap | null | undefined): string {
  if (!gap) return '—';
  if (gap.laps > 0) return `+${gap.laps} ${gap.laps === 1 ? 'VOLTA' : 'VOLTAS'}`;
  return `+${fmtSec(gap.ms)}`;
}

/** Delta com sinal: "-0.312" / "+0.312" */
export function fmtDelta(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) return '—';
  return `${ms <= 0 ? '-' : '+'}${fmtSec(Math.abs(ms))}`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m, 2)}:${pad(s % 60, 2)}` : `${m}:${pad(s % 60, 2)}`;
}
