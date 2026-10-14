/**
 * Amostra de GPS já convertida para o relógio do servidor.
 * `t` é epoch em milissegundos (relógio do servidor, após correção de offset).
 */
export interface GpsSample {
  /** Sequência monotônica por piloto; garante idempotência na sincronização. */
  seq: number;
  t: number;
  lat: number;
  lng: number;
  /** m/s informado pelo GPS (pode ser null em alguns aparelhos). */
  speed: number | null;
  /** graus a partir do norte (null quando parado). */
  heading: number | null;
  /** raio de precisão horizontal em metros. */
  accuracy: number | null;
}

/**
 * Linha virtual de largada/chegada. É um segmento centrado em (lat, lng),
 * perpendicular ao sentido de corrida `bearing`, com meia-largura `halfWidthM`.
 * Enquanto `bearing` for null a linha está "aguardando direção": o centro já foi
 * marcado, mas o sentido só é definido quando o kart do criador se desloca.
 */
export interface StartFinishLine {
  lat: number;
  lng: number;
  bearing: number | null;
  halfWidthM: number;
  version: number;
}

/** Passagem válida pela linha. index 0 = largada (início da volta 1). */
export interface Crossing {
  index: number;
  t: number;
  /** Incerteza estimada do instante (erro de posição GPS / velocidade, limitado a meio intervalo de amostragem). */
  uncertaintyMs: number;
}

export interface Lap {
  number: number; // 1-based
  startT: number;
  endT: number;
  timeMs: number;
  /** Incerteza estimada do tempo da volta (soma das incertezas das duas passagens). */
  uncertaintyMs: number;
}

export type SessionStatus = 'LOBBY' | 'RUNNING' | 'FINISHED';

export interface PilotInfo {
  id: string;
  name: string;
  number: number;
  color: string;
  isHost: boolean;
}
