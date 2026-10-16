/**
 * Motor de corrida do celular do piloto.
 *
 * - Coleta GPS (expo-location) e numera cada amostra (seq) para sincronização idempotente.
 * - Detecta voltas LOCALMENTE com o mesmo algoritmo do servidor → cronômetro,
 *   última/melhor volta e delta funcionam mesmo sem internet.
 * - Mantém uma fila persistente de pontos não confirmados e envia em lotes pelo
 *   WebSocket; ao reconectar, reenvia a partir do último seq confirmado.
 * - Sincroniza o relógio com o servidor (estilo NTP) para que os gaps entre
 *   pilotos usem a mesma base de tempo.
 */
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { io, Socket } from 'socket.io-client';
import {
  Ack,
  averageFix,
  ClockSync,
  clockSample,
  EV,
  FixTimeMapper,
  GeneralReport,
  GpsSample,
  Lap,
  LapDeltaTracker,
  LapDetector,
  PointsAck,
  SessionSnapshot,
  StandingRow,
  StartFinishLine,
} from '@kart/shared';
import { ActiveSession, storage } from './storage';

export type Connection = 'connecting' | 'online' | 'offline';
export type GpsStatus = 'off' | 'searching' | 'ok' | 'weak' | 'denied';

export interface RaceState {
  code: string;
  pilotId: string;
  pilotName: string;
  isHost: boolean;
  trackName: string;
  session: SessionSnapshot | null;
  connection: Connection;
  gps: GpsStatus;
  gpsAccuracy: number | null;
  clockSynced: boolean;
  pending: number;
  recording: boolean;
  /** instante local (Date.now) da última passagem pela linha */
  lapStartLocalT: number | null;
  laps: Lap[];
  lastLap: Lap | null;
  bestLap: Lap | null;
  speedKmh: number | null;
  maxSpeedKmh: number;
  deltaMs: number | null;
  progress: number | null;
  standings: StandingRow[];
  lapFlash: { lap: Lap; personalBest: boolean; at: number } | null;
  report: GeneralReport | null;
  voice: boolean;
  error: string | null;
}

const FLUSH_MS = 500;
const BATCH = 300;
const PERSIST_MS = 3000;
const RESYNC_MS = 30000;

export class RaceEngine {
  state: RaceState;
  private listeners = new Set<() => void>();
  private socket: Socket | null = null;
  private clock = new ClockSync();
  private detector = new LapDetector(null);
  private delta = new LapDeltaTracker();
  private localPoints: GpsSample[] = [];
  private queue: GpsSample[] = [];
  private nextSeq = 0;
  private lineKey = '';
  private watch: Location.LocationSubscription | null = null;
  private lastFix: Location.LocationObject | null = null;
  /** converte o horário do fix (pode ser o do GPS) para o relógio deste celular */
  private fixTime = new FixTimeMapper();
  /** fixes recentes (relógio do celular) para marcar a linha com média de posições */
  private recentFixes: { t: number; lat: number; lng: number; accuracy: number | null; speed: number | null; heading: number | null }[] = [];
  private timers: ReturnType<typeof setInterval>[] = [];
  private flushing = false;
  private dirty = false;
  private stopped = false;

  constructor(
    readonly active: ActiveSession,
    private readonly serverUrl: string,
  ) {
    this.state = {
      code: active.code,
      pilotId: active.pilot.id,
      pilotName: active.pilot.name,
      isHost: active.pilot.isHost,
      trackName: active.trackName,
      session: null,
      connection: 'connecting',
      gps: 'off',
      gpsAccuracy: null,
      clockSynced: false,
      pending: 0,
      recording: false,
      lapStartLocalT: null,
      laps: [],
      lastLap: null,
      bestLap: null,
      speedKmh: null,
      maxSpeedKmh: 0,
      deltaMs: null,
      progress: null,
      standings: [],
      lapFlash: null,
      report: null,
      voice: true,
      error: null,
    };
  }

  // ------------------------------------------------------------ store
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  private set(p: Partial<RaceState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }

  // ------------------------------------------------------------ ciclo de vida
  async start() {
    const saved = await storage.queue(this.active.code, this.active.pilot.id);
    if (saved) {
      this.queue = saved.points;
      this.nextSeq = saved.nextSeq;
      this.localPoints = [...saved.points];
    }
    this.set({ voice: await storage.voice(), pending: this.queue.length });
    this.connect();
    this.startGps();
    this.timers.push(setInterval(() => this.flush(), FLUSH_MS));
    this.timers.push(setInterval(() => this.persist(), PERSIST_MS));
    this.timers.push(setInterval(() => this.syncClock(2), RESYNC_MS));
  }

  stop() {
    this.stopped = true;
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.watch?.remove();
    this.watch = null;
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.persist(true);
  }

  setVoice(on: boolean) {
    this.set({ voice: on });
    storage.setVoice(on);
  }

  // ------------------------------------------------------------ rede
  private connect() {
    const socket = io(this.serverUrl, { transports: ['websocket'], reconnection: true, reconnectionDelayMax: 3000 });
    this.socket = socket;
    socket.on('connect', () => this.onConnect());
    socket.on('disconnect', () => this.set({ connection: 'offline' }));
    socket.on('connect_error', () => this.set({ connection: 'offline' }));
    socket.on(EV.STATE, (s: SessionSnapshot) => this.onSession(s));
    socket.on(EV.STANDINGS, (p: { standings: StandingRow[] }) => this.set({ standings: p.standings }));
    socket.on(EV.FINISHED, (r: GeneralReport) => this.set({ report: r }));
  }

  private async syncClock(n: number) {
    const s = this.socket;
    if (!s?.connected) return;
    for (let i = 0; i < n; i++) {
      try {
        const t0 = Date.now();
        const r = (await s.timeout(3000).emitWithAck(EV.CLOCK_PING, { t0 })) as { serverT: number };
        this.clock.add(clockSample(t0, r.serverT, Date.now()));
      } catch {
        /* ignora amostra */
      }
    }
    this.set({ clockSynced: this.clock.synced });
  }

  private async onConnect() {
    await this.syncClock(6);
    try {
      const r = (await this.socket!.timeout(8000).emitWithAck(EV.PILOT_JOIN, {
        code: this.active.code,
        pilotId: this.active.pilot.id,
        token: this.active.token,
      })) as Ack<{ session: SessionSnapshot; lastSeq: number }>;
      if (!r.ok || !r.data) {
        this.set({ error: r.error ?? 'Não foi possível entrar na sala', connection: 'offline' });
        return;
      }
      const { lastSeq } = r.data;
      this.queue = this.queue.filter((p) => p.seq > lastSeq);
      if (this.nextSeq <= lastSeq) this.nextSeq = lastSeq + 1;
      this.set({ connection: 'online', error: null, pending: this.queue.length });
      this.onSession(r.data.session);
      this.flush();
    } catch {
      this.set({ connection: 'offline' });
    }
  }

  private async flush() {
    const s = this.socket;
    if (this.flushing || !s?.connected || this.state.connection !== 'online' || !this.queue.length) return;
    this.flushing = true;
    try {
      const batch = this.queue.slice(0, BATCH).map((p) => ({ ...p, t: this.clock.toServer(p.t) }));
      const ack = (await s.timeout(6000).emitWithAck(EV.POINTS, { points: batch })) as PointsAck;
      if (ack.ok) {
        this.queue = this.queue.filter((p) => p.seq > ack.lastSeq);
        this.dirty = true;
        this.set({ pending: this.queue.length });
      }
    } catch {
      /* sem ack: tenta de novo no próximo ciclo */
    } finally {
      this.flushing = false;
    }
  }

  private persist(force = false) {
    if (!this.dirty && !force) return;
    this.dirty = false;
    storage.setQueue(this.active.code, this.active.pilot.id, this.nextSeq, this.queue.slice(-20000));
  }

  // ------------------------------------------------------------ sessão
  private onSession(s: SessionSnapshot) {
    const wasRunning = this.state.session?.status === 'RUNNING';
    this.set({ session: s, standings: s.standings, trackName: s.trackName });
    if (s.status === 'RUNNING' && !this.state.recording) this.set({ recording: true });
    if (s.line && s.startedAt) {
      const key = `${s.line.version}:${s.line.bearing ?? 'pending'}`;
      if (key !== this.lineKey) {
        this.lineKey = key;
        this.rebuild(s.line, s.startedAt);
      }
    }
    if (s.status === 'FINISHED') {
      this.set({ recording: false });
      if (wasRunning || !this.state.report) {
        // última sincronização antes de mostrar o relatório
        this.flush();
        storage.addHistory({
          code: s.code,
          trackName: s.trackName,
          pilotId: this.active.pilot.id,
          pilotName: this.active.pilot.name,
          date: s.startedAt ?? Date.now(),
        });
      }
    }
  }

  /** Linha nova (ou direção resolvida): reprocessa todos os pontos locais. */
  private rebuild(line: StartFinishLine, startedAtServer: number) {
    const startLocal = startedAtServer - this.clock.offsetMs;
    this.detector.reset(line, startLocal);
    this.delta.reset();
    for (const p of this.localPoints) this.process(p, true);
    this.publishTiming();
  }

  // ------------------------------------------------------------ GPS
  private async startGps() {
    this.set({ gps: 'searching' });
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      this.set({ gps: 'denied', error: 'Permita o acesso à localização para cronometrar as voltas.' });
      return;
    }
    if (this.stopped) return;
    this.watch = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 200, distanceInterval: 0 },
      (loc) => this.onLocation(loc),
      (err) => this.set({ error: `GPS: ${err}` }),
    );
  }

  private onLocation(loc: Location.LocationObject) {
    this.lastFix = loc;
    const acc = loc.coords.accuracy ?? null;
    // IMPORTANTE: o timestamp do fix pode estar no relógio do GPS e o Date.now() no
    // relógio do sistema (que pode estar dezenas de segundos errado). Tudo passa a
    // usar o relógio do sistema; o ClockSync converte depois para o do servidor.
    const t = this.fixTime.map(Math.round(loc.timestamp), Date.now());
    const speedRaw = loc.coords.speed != null && loc.coords.speed >= 0 ? loc.coords.speed : null;
    const headingRaw = loc.coords.heading != null && loc.coords.heading >= 0 ? loc.coords.heading : null;
    this.recentFixes.push({ t, lat: loc.coords.latitude, lng: loc.coords.longitude, accuracy: acc, speed: speedRaw, heading: headingRaw });
    this.recentFixes = this.recentFixes.filter((f) => t - f.t <= 6000);
    const gps: GpsStatus = acc == null ? 'ok' : acc <= 12 ? 'ok' : 'weak';
    if (gps !== this.state.gps || acc !== this.state.gpsAccuracy) this.set({ gps, gpsAccuracy: acc != null ? Math.round(acc) : null });

    const s = this.state.session;
    if (!this.state.recording || !s || s.status !== 'RUNNING' || !s.startedAt) return;
    const startLocal = s.startedAt - this.clock.offsetMs;
    const last = this.localPoints[this.localPoints.length - 1];
    if (t < startLocal - 1000 || (last && t <= last.t)) return;

    const sample: GpsSample = {
      seq: this.nextSeq++,
      t,
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      speed: speedRaw,
      heading: headingRaw,
      accuracy: acc,
    };
    this.localPoints.push(sample);
    this.queue.push(sample);
    this.dirty = true;
    this.process(sample, false);
    this.publishTiming();
    this.set({ pending: this.queue.length });
  }

  private process(p: GpsSample, replay: boolean) {
    const ev = this.detector.push(p);
    if (ev) {
      this.delta.onCrossing(ev.lap?.timeMs);
      if (ev.lap && !replay) this.announceLap(ev.lap);
    }
    const lastT = this.detector.lastCrossingT;
    if (lastT != null) this.delta.push(this.detector.distanceSinceCrossing, p.t - lastT);
  }

  private publishTiming() {
    const d = this.detector;
    const laps = [...d.laps];
    const lastT = d.lastCrossingT;
    const last = d.lastSample;
    const elapsed = lastT != null && last ? last.t - lastT : null;
    const speed = d.currentSpeedMs;
    this.set({
      laps,
      lastLap: laps[laps.length - 1] ?? null,
      bestLap: d.bestLap,
      lapStartLocalT: lastT,
      speedKmh: speed != null ? Math.round(speed * 3.6) : null,
      maxSpeedKmh: Math.round(d.maxSpeedMs * 3.6),
      deltaMs: elapsed != null ? this.delta.delta(d.distanceSinceCrossing, elapsed) : null,
      progress: this.delta.progress(d.distanceSinceCrossing),
    });
  }

  private announceLap(lap: Lap) {
    const best = this.detector.bestLap;
    const personalBest = best?.number === lap.number;
    this.set({ lapFlash: { lap, personalBest, at: Date.now() } });
    Haptics.notificationAsync(personalBest ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(
      () => undefined,
    );
    if (this.state.voice) {
      const s = Math.floor(lap.timeMs / 1000);
      const tenths = Math.floor((lap.timeMs % 1000) / 100);
      const me = this.state.standings.find((r) => r.pilotId === this.active.pilot.id);
      const parts = [`Volta ${lap.number}`, `${s} ponto ${tenths}`];
      if (personalBest && lap.number > 1) parts.push('melhor volta');
      if (me?.started) parts.push(`posição ${me.position}`);
      Speech.stop().catch(() => undefined);
      Speech.speak(parts.join('. '), { language: 'pt-BR', rate: 1.05 });
    }
  }

  // ------------------------------------------------------------ ações do criador
  /**
   * Posição para marcar a linha. Em movimento: o último fix com rumo Doppler.
   * Parado: média ponderada dos fixes dos últimos 5 s (reduz o erro do ponto).
   */
  private fixPayload() {
    const now = Date.now();
    const recent = this.recentFixes.filter((f) => now - f.t <= 5000 && (f.accuracy == null || f.accuracy <= 30));
    const last = recent[recent.length - 1];
    if (!last) throw new Error('Aguardando sinal de GPS');
    if (last.speed != null && last.speed >= 3 && last.heading != null) {
      return { lat: last.lat, lng: last.lng, speed: last.speed, heading: last.heading };
    }
    const avg = averageFix(recent) as { lat: number; lng: number; accuracy: number };
    const best = Math.min(...recent.map((f) => f.accuracy ?? 99));
    if (best > 20) {
      throw new Error(`GPS impreciso (±${Math.round(best)} m). Vá para céu aberto e aguarde alguns segundos.`);
    }
    return { lat: avg.lat, lng: avg.lng, speed: last.speed, heading: last.heading };
  }

  private async hostAction(ev: string, payload: unknown) {
    if (!this.socket?.connected) throw new Error('Sem conexão com o servidor');
    const r = (await this.socket.timeout(8000).emitWithAck(ev, payload)) as Ack;
    if (!r.ok) throw new Error(r.error ?? 'Falha');
  }

  startRace = () => this.hostAction(EV.RACE_START, this.fixPayload());
  resetLine = () => this.hostAction(EV.LINE_RESET, this.fixPayload());
  finishRace = async () => {
    await this.flush();
    await this.hostAction(EV.RACE_FINISH, {});
  };

  /** Hora atual no relógio do servidor (para o tempo de prova). */
  serverNow() {
    return this.clock.toServer(Date.now());
  }
}

// ------------------------------------------------------------ instância única
let current: RaceEngine | null = null;

export async function getEngine(active: ActiveSession): Promise<RaceEngine> {
  if (current && current.active.code === active.code && current.active.pilot.id === active.pilot.id) return current;
  current?.stop();
  current = new RaceEngine(active, await storage.serverUrl());
  await current.start();
  return current;
}

export function currentEngine(): RaceEngine | null {
  return current;
}

export async function leaveSession() {
  if (current) {
    const { code, pilot } = current.active;
    const done = current.state.session?.status === 'FINISHED' && current.state.pending === 0;
    current.stop();
    current = null;
    if (done) await storage.clearQueue(code, pilot.id);
  }
  await storage.setActive(null);
}
