import type { CreateSessionBody, GeneralReport, JoinResult, PilotReport, SessionSnapshot } from '@kart/shared';
import { storage } from './storage';

async function request<T>(path: string, init?: RequestInit, timeoutMs = 10000): Promise<T> {
  const base = await storage.serverUrl();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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

function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * POST que cria algo (sala, piloto). O servidor gratuito pode estar dormindo e
 * levar ~1 min para acordar: tenta de novo sozinho, sempre com o MESMO requestId,
 * para o servidor devolver a sala já criada em vez de criar outra.
 */
async function createOnce<T>(path: string, body: object, onWait?: (msg: string) => void): Promise<T> {
  const payload = JSON.stringify({ ...body, requestId: newRequestId() });
  const deadline = Date.now() + 90_000;
  for (let attempt = 0; ; attempt++) {
    try {
      return await request<T>(path, { method: 'POST', body: payload }, 25_000);
    } catch (e) {
      const msg = (e as Error).message ?? '';
      const transient = msg.startsWith('Servidor não respondeu') || msg.startsWith('Sem conexão') || /^Erro 5\d\d/.test(msg);
      if (!transient || Date.now() > deadline) throw e;
      onWait?.('Servidor acordando… aguarde (pode levar até 1 minuto)');
      await new Promise((r) => setTimeout(r, Math.min(5000, 1500 * (attempt + 1))));
    }
  }
}

export const api = {
  create: (body: CreateSessionBody, onWait?: (msg: string) => void) => createOnce<JoinResult>('/api/sessions', body, onWait),
  join: (code: string, pilotName: string, onWait?: (msg: string) => void) =>
    createOnce<JoinResult>(`/api/sessions/${code.toUpperCase()}/join`, { pilotName }, onWait),
  /** acorda o servidor em segundo plano (sem bloquear a tela) */
  wake: () => request<{ ok: boolean }>('/api/health', undefined, 60_000).catch(() => undefined),
  session: (code: string) => request<SessionSnapshot>(`/api/sessions/${code}`),
  report: (code: string) => request<GeneralReport>(`/api/sessions/${code}/report`),
  pilotReport: (code: string, pilotId: string) => request<PilotReport>(`/api/sessions/${code}/pilots/${pilotId}/report`),
  health: () => request<{ ok: boolean }>('/api/health'),
};
