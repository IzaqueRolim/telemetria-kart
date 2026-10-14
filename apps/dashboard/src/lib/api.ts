import type { GeneralReport, PilotReport, SessionSnapshot, SessionSummary } from '@kart/shared';

/** URL do servidor. Vazio = mesma origem (proxy do Vite ou dashboard servido pelo backend). */
export const SERVER_URL: string = (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/$/, '') ?? '';

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${SERVER_URL}${path}`);
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.message ?? `Erro ${r.status}`);
  return body as T;
}

export const api = {
  sessions: () => get<SessionSummary[]>('/api/sessions'),
  session: (code: string) => get<SessionSnapshot>(`/api/sessions/${code}`),
  report: (code: string) => get<GeneralReport>(`/api/sessions/${code}/report`),
  pilotReport: (code: string, pilotId: string) => get<PilotReport>(`/api/sessions/${code}/pilots/${pilotId}/report`),
  trace: (code: string, pilotId: string, lap?: number) =>
    get<Array<{ t: number; lat: number; lng: number; speed: number | null }>>(
      `/api/sessions/${code}/pilots/${pilotId}/trace${lap ? `?lap=${lap}` : ''}`,
    ),
};
