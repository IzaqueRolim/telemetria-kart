/**
 * Contrato de comunicação em tempo real (Socket.IO) e REST.
 * Todos os instantes `t` usam o relógio do servidor (ms epoch).
 */
import { StandingRow } from './classification';
import { LatLng } from './geo';
import { GpsSample, Lap, PilotInfo, SessionStatus, StartFinishLine } from './types';

export const EV = {
  // cliente → servidor
  PILOT_JOIN: 'pilot:join',
  SPECTATOR_JOIN: 'spectator:join',
  POINTS: 'points:batch',
  RACE_START: 'race:start',
  LINE_RESET: 'race:line:reset',
  RACE_FINISH: 'race:finish',
  CLOCK_PING: 'clock:ping',
  // servidor → clientes
  STATE: 'session:state',
  LINE: 'session:line',
  POSITIONS: 'live:positions',
  STANDINGS: 'live:standings',
  LAP: 'live:lap',
  FINISHED: 'session:finished',
  ERROR: 'session:error',
} as const;

/** Após este tempo sem pontos, a posição do piloto é marcada como desatualizada. */
export const STALE_AFTER_MS = 5000;

export interface SessionSnapshot {
  id: string;
  code: string;
  trackId: string;
  trackName: string;
  status: SessionStatus;
  hostPilotId: string | null;
  targetLaps: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  line: StartFinishLine | null;
  pilots: PilotInfo[];
  standings: StandingRow[];
  /** traçado do circuito (primeira volta completa registrada), para desenhar no mapa */
  trackPath: LatLng[] | null;
  serverTime: number;
}

export interface LivePosition {
  pilotId: string;
  lat: number;
  lng: number;
  t: number;
  speedKmh: number | null;
  heading: number | null;
  /** sem dados recentes (piloto offline / GPS perdido) */
  stale: boolean;
  ageMs: number;
  /** distância física em linha reta até o kart à frente na classificação (m) */
  distanceAheadM: number | null;
  /** fração aproximada da volta atual [0,1] */
  lapProgress: number | null;
  /**
   * Últimos pontos filtrados [t, lat, lng] (≈ 4 s). O mapa usa para animar o kart
   * de forma contínua entre as amostras, em vez de "teleportar" a cada lote.
   */
  recent?: [number, number, number][];
}

export interface LapEvent {
  pilotId: string;
  lap: Lap;
  personalBest: boolean;
  sessionBest: boolean;
}

export interface PilotJoinPayload {
  code: string;
  pilotId: string;
  token: string;
}

export interface SpectatorJoinPayload {
  code: string;
}

export interface PointsBatchPayload {
  points: GpsSample[];
}

export interface PointsAck {
  ok: boolean;
  /** maior seq persistida em ordem; o cliente descarta tudo até ele */
  lastSeq: number;
  error?: string;
}

export interface LinePayload {
  lat: number;
  lng: number;
  speed?: number | null;
  heading?: number | null;
}

export interface Ack<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

// ---------- REST ----------
export interface CreateSessionBody {
  trackName: string;
  pilotName: string;
  targetLaps?: number | null;
  /**
   * Identificador gerado pelo app para esta tentativa. Reenvios com o mesmo id
   * (timeout, servidor acordando) devolvem a MESMA sala em vez de criar outra.
   */
  requestId?: string;
}
export interface JoinSessionBody {
  pilotName: string;
  /** idem: evita piloto duplicado quando o app reenvia o pedido */
  requestId?: string;
}
export interface JoinResult {
  session: SessionSnapshot;
  pilot: PilotInfo;
  token: string;
}
export interface SessionSummary {
  code: string;
  trackName: string;
  status: SessionStatus;
  startedAt: number | null;
  finishedAt: number | null;
  pilots: number;
  createdAt: number;
}
