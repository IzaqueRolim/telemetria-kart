import type { CreateSessionBody, GeneralReport, JoinResult, PilotReport, SessionSnapshot } from '@kart/shared';
import { storage } from './storage';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await storage.serverUrl();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(`${base}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
      throw new Error(msg ?? `Erro ${r.status}`);
    }
    return body as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`Servidor não respondeu (${base})`);
    if ((e as Error).message?.includes('Network request failed')) throw new Error(`Sem conexão com o servidor (${base})`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  create: (body: CreateSessionBody) => request<JoinResult>('/api/sessions', { method: 'POST', body: JSON.stringify(body) }),
  join: (code: string, pilotName: string) =>
    request<JoinResult>(`/api/sessions/${code.toUpperCase()}/join`, { method: 'POST', body: JSON.stringify({ pilotName }) }),
  session: (code: string) => request<SessionSnapshot>(`/api/sessions/${code}`),
  report: (code: string) => request<GeneralReport>(`/api/sessions/${code}/report`),
  pilotReport: (code: string, pilotId: string) => request<PilotReport>(`/api/sessions/${code}/pilots/${pilotId}/report`),
  health: () => request<{ ok: boolean }>('/api/health'),
};
