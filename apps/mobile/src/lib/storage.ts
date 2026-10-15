import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import type { GpsSample, PilotInfo } from '@kart/shared';

const K = {
  server: 'kart:server',
  name: 'kart:name',
  active: 'kart:active',
  history: 'kart:history',
  voice: 'kart:voice',
  queue: (code: string, pilotId: string) => `kart:queue:${code}:${pilotId}`,
};

/** Credenciais da sessão atual (permite voltar à corrida se o app fechar). */
export interface ActiveSession {
  code: string;
  pilot: PilotInfo;
  token: string;
  trackName: string;
}

export interface HistoryEntry {
  code: string;
  trackName: string;
  pilotId: string;
  pilotName: string;
  date: number;
}

async function getJSON<T>(key: string): Promise<T | null> {
  try {
    const v = await AsyncStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function setJSON(key: string, value: unknown): Promise<void> {
  return AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => undefined);
}

/**
 * URL padrão do servidor: EXPO_PUBLIC_SERVER_URL, depois `extra.serverUrl` do app.json,
 * depois o IP do computador que roda o Metro (desenvolvimento) na porta 3000.
 */
export function defaultServerUrl(): string {
  const env = process.env.EXPO_PUBLIC_SERVER_URL;
  if (env) return env;
  const extra = (Constants.expoConfig?.extra as { serverUrl?: string } | undefined)?.serverUrl;
  if (extra) return extra;
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:3000` : 'http://192.168.0.10:3000';
}

/** Endereço do dashboard dos espectadores (padrão: o próprio servidor, que também o serve). */
export async function dashboardUrl(): Promise<string> {
  const env = process.env.EXPO_PUBLIC_DASHBOARD_URL;
  return (env || (await storage.serverUrl())).replace(/\/$/, '');
}

export const storage = {
  async serverUrl(): Promise<string> {
    return (await AsyncStorage.getItem(K.server).catch(() => null)) || defaultServerUrl();
  },
  setServerUrl: (url: string) => AsyncStorage.setItem(K.server, url.trim().replace(/\/$/, '')).catch(() => undefined),

  lastName: () => AsyncStorage.getItem(K.name).catch(() => null),
  setLastName: (n: string) => AsyncStorage.setItem(K.name, n).catch(() => undefined),

  voice: async () => (await AsyncStorage.getItem(K.voice).catch(() => null)) !== 'off',
  setVoice: (on: boolean) => AsyncStorage.setItem(K.voice, on ? 'on' : 'off').catch(() => undefined),

  active: () => getJSON<ActiveSession>(K.active),
  setActive: (s: ActiveSession | null) => (s ? setJSON(K.active, s) : AsyncStorage.removeItem(K.active).catch(() => undefined)),

  history: async () => (await getJSON<HistoryEntry[]>(K.history)) ?? [],
  async addHistory(e: HistoryEntry) {
    const list = (await storage.history()).filter((x) => !(x.code === e.code && x.pilotId === e.pilotId));
    await setJSON(K.history, [e, ...list].slice(0, 100));
  },

  /** Fila de pontos ainda não confirmados pelo servidor (sobrevive a reinício do app). */
  queue: (code: string, pilotId: string) => getJSON<{ nextSeq: number; points: GpsSample[] }>(K.queue(code, pilotId)),
  setQueue: (code: string, pilotId: string, nextSeq: number, points: GpsSample[]) =>
    setJSON(K.queue(code, pilotId), { nextSeq, points }),
  clearQueue: (code: string, pilotId: string) => AsyncStorage.removeItem(K.queue(code, pilotId)).catch(() => undefined),
};
