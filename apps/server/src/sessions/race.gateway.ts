import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  Ack,
  EV,
  LapEvent,
  LinePayload,
  PilotJoinPayload,
  PointsAck,
  PointsBatchPayload,
  SessionSnapshot,
  SpectatorJoinPayload,
} from '@kart/shared';
import { SessionsService } from './sessions.service';
import { RaceRuntime } from './race-runtime';

interface SocketData {
  code?: string;
  pilotId?: string;
  role?: 'pilot' | 'spectator';
}

const room = (code: string) => `s:${code}`;
const POSITIONS_INTERVAL_MS = 500;

function errMsg(e: unknown): string {
  const anyE = e as { response?: { message?: string }; message?: string };
  return anyE?.response?.message ?? anyE?.message ?? 'Erro';
}

@WebSocketGateway({ cors: { origin: '*' }, pingInterval: 10000, pingTimeout: 8000 })
export class RaceGateway implements OnGatewayInit, OnGatewayDisconnect, OnModuleDestroy {
  private readonly log = new Logger(RaceGateway.name);
  @WebSocketServer() io!: Server;
  private ticker?: NodeJS.Timeout;

  constructor(private readonly sessions: SessionsService) {}

  afterInit(): void {
    this.ticker = setInterval(() => this.tick(), POSITIONS_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.ticker) clearInterval(this.ticker);
  }

  handleDisconnect(socket: Socket): void {
    const d = socket.data as SocketData;
    if (d.role === 'pilot') this.log.debug(`Piloto ${d.pilotId} desconectou de ${d.code}`);
  }

  /** Posições e classificação ao vivo de todas as salas em andamento (2 Hz). */
  private tick(): void {
    const now = Date.now();
    for (const rt of this.sessions.activeRuntimes()) {
      if (rt.status !== 'RUNNING') continue;
      const r = this.io.sockets.adapter.rooms.get(room(rt.code));
      if (!r || r.size === 0) continue;
      // classificação ao vivo (ordem e gaps mudam durante a volta, não só na linha)
      const standings = rt.standings();
      this.io.to(room(rt.code)).emit(EV.POSITIONS, { serverTime: now, positions: rt.positions(now, standings) });
      this.io.to(room(rt.code)).emit(EV.STANDINGS, { serverTime: now, standings });
    }
  }

  private snapshot(rt: RaceRuntime): SessionSnapshot {
    return rt.snapshot(Date.now());
  }

  private broadcastState(rt: RaceRuntime): void {
    this.io.to(room(rt.code)).emit(EV.STATE, this.snapshot(rt));
  }

  private broadcastStandings(rt: RaceRuntime): void {
    this.io.to(room(rt.code)).emit(EV.STANDINGS, { serverTime: Date.now(), standings: rt.standings() });
  }

  private async pilotContext(socket: Socket): Promise<{ rt: RaceRuntime; pilotId: string }> {
    const d = socket.data as SocketData;
    if (d.role !== 'pilot' || !d.code || !d.pilotId) throw new Error('Entre na sala antes');
    return { rt: await this.sessions.getRuntime(d.code), pilotId: d.pilotId };
  }

  // ------------------------------------------------------------------ eventos

  @SubscribeMessage(EV.CLOCK_PING)
  clockPing(@MessageBody() body: { t0?: number }) {
    return { t0: body?.t0 ?? null, serverT: Date.now() };
  }

  @SubscribeMessage(EV.PILOT_JOIN)
  async pilotJoin(@ConnectedSocket() socket: Socket, @MessageBody() body: PilotJoinPayload): Promise<Ack<{ session: SessionSnapshot; lastSeq: number }>> {
    try {
      const rt = await this.sessions.authenticate(body?.code, body?.pilotId, body?.token);
      socket.data = { code: rt.code, pilotId: body.pilotId, role: 'pilot' } satisfies SocketData;
      await socket.join(room(rt.code));
      const lastSeq = rt.pilots.get(body.pilotId)?.lastSeq ?? -1;
      // avisa os demais (lista do lobby)
      socket.to(room(rt.code)).emit(EV.STATE, this.snapshot(rt));
      return { ok: true, data: { session: this.snapshot(rt), lastSeq } };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  @SubscribeMessage(EV.SPECTATOR_JOIN)
  async spectatorJoin(@ConnectedSocket() socket: Socket, @MessageBody() body: SpectatorJoinPayload): Promise<Ack<SessionSnapshot>> {
    try {
      const rt = await this.sessions.getRuntime(body?.code);
      socket.data = { code: rt.code, role: 'spectator' } satisfies SocketData;
      await socket.join(room(rt.code));
      return { ok: true, data: this.snapshot(rt) };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  @SubscribeMessage(EV.POINTS)
  async points(@ConnectedSocket() socket: Socket, @MessageBody() body: PointsBatchPayload): Promise<PointsAck> {
    try {
      const { rt, pilotId } = await this.pilotContext(socket);
      const before = rt.trackPath;
      const res = await this.sessions.ingest(rt, pilotId, body?.points ?? []);
      if (res.lineChanged || before !== rt.trackPath) {
        this.broadcastState(rt);
      } else if (res.events.length) {
        for (const ev of res.events) {
          if (!ev.lap) continue;
          const p = rt.pilots.get(pilotId)!;
          const payload: LapEvent = {
            pilotId,
            lap: ev.lap,
            personalBest: p.detector.bestLap?.number === ev.lap.number,
            sessionBest: rt.isSessionBest(ev.lap.timeMs),
          };
          this.io.to(room(rt.code)).emit(EV.LAP, payload);
        }
        this.broadcastStandings(rt);
      }
      if (rt.status === 'FINISHED' && (res.events.length || res.lineChanged)) {
        this.io.to(room(rt.code)).emit(EV.FINISHED, await this.sessions.generalReport(rt.code));
      }
      return { ok: true, lastSeq: res.lastSeq };
    } catch (e) {
      return { ok: false, lastSeq: -1, error: errMsg(e) };
    }
  }

  @SubscribeMessage(EV.RACE_START)
  async raceStart(@ConnectedSocket() socket: Socket, @MessageBody() body: LinePayload): Promise<Ack> {
    try {
      const { rt, pilotId } = await this.pilotContext(socket);
      await this.sessions.startRace(rt, pilotId, body);
      this.log.log(`Corrida ${rt.code} iniciada`);
      this.broadcastState(rt);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  @SubscribeMessage(EV.LINE_RESET)
  async lineReset(@ConnectedSocket() socket: Socket, @MessageBody() body: LinePayload): Promise<Ack> {
    try {
      const { rt, pilotId } = await this.pilotContext(socket);
      const line = await this.sessions.resetLine(rt, pilotId, body);
      this.io.to(room(rt.code)).emit(EV.LINE, line);
      this.broadcastState(rt);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  @SubscribeMessage(EV.RACE_FINISH)
  async raceFinish(@ConnectedSocket() socket: Socket): Promise<Ack> {
    try {
      const { rt, pilotId } = await this.pilotContext(socket);
      const report = await this.sessions.finish(rt, pilotId);
      this.log.log(`Corrida ${rt.code} encerrada`);
      this.broadcastState(rt);
      this.io.to(room(rt.code)).emit(EV.FINISHED, report);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }
}
