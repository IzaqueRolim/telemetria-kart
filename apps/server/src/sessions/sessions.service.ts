import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, SessionStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import {
  buildGeneralReport,
  buildPilotReport,
  createLine,
  CreateSessionBody,
  GeneralReport,
  GpsSample,
  JoinResult,
  LatLng,
  LinePayload,
  PilotInfo,
  pilotColor,
  PilotReport,
  SessionSummary,
  smoothTrack,
  StartFinishLine,
} from '@kart/shared';
import { PrismaService } from '../prisma/prisma.service';
import { IngestResult, RaceRuntime } from './race-runtime';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PILOTS = 30;
/** por quanto tempo um requestId repetido devolve o mesmo resultado */
const IDEMPOTENCY_TTL_MS = 10 * 60_000;
/** salas que nunca largaram somem da lista depois disso */
const ABANDONED_LOBBY_MS = 3 * 60 * 60_000;

function newCode(len = 6): string {
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

function cleanName(v: unknown, field: string, max = 24): string {
  if (typeof v !== 'string' || !v.trim()) throw new BadRequestException(`${field} é obrigatório`);
  return v.trim().replace(/\s+/g, ' ').slice(0, max);
}

const ms = (d: Date | null | undefined) => (d ? d.getTime() : null);

@Injectable()
export class SessionsService {
  private readonly log = new Logger(SessionsService.name);
  private readonly runtimes = new Map<string, RaceRuntime>();
  private readonly loading = new Map<string, Promise<RaceRuntime>>();
  /** fila por sessão para serializar escritas de voltas (evita corrida entre lotes) */
  private readonly writeQueue = new Map<string, Promise<unknown>>();
  /**
   * Pedidos de criar/entrar já recebidos, por requestId. Com o servidor dormindo
   * (Render free), o 1º pedido acorda o servidor e cria a sala, mas o app já
   * desistiu por timeout e reenvia — sem isto, nasciam duas salas.
   */
  private readonly idempotent = new Map<string, { at: number; result: Promise<JoinResult> }>();

  constructor(private readonly db: PrismaService) {}

  activeRuntimes(): RaceRuntime[] {
    return [...this.runtimes.values()];
  }

  // ---------------------------------------------------------------- salas

  /** Executa `fn` uma única vez por requestId; reenvios recebem o mesmo resultado. */
  private once(kind: string, requestId: unknown, fn: () => Promise<JoinResult>): Promise<JoinResult> {
    if (typeof requestId !== 'string' || requestId.length < 8 || requestId.length > 64) return fn();
    const now = Date.now();
    for (const [k, v] of this.idempotent) if (now - v.at > IDEMPOTENCY_TTL_MS) this.idempotent.delete(k);
    const key = `${kind}:${requestId}`;
    const hit = this.idempotent.get(key);
    if (hit) {
      this.log.log(`Pedido repetido (${key}) — devolvendo o resultado anterior`);
      return hit.result;
    }
    const result = fn();
    this.idempotent.set(key, { at: now, result });
    // falhou: libera o id para uma nova tentativa de verdade
    result.catch(() => this.idempotent.delete(key));
    return result;
  }

  create(body: CreateSessionBody): Promise<JoinResult> {
    return this.once('create', body?.requestId, () => this.doCreate(body));
  }

  private async doCreate(body: CreateSessionBody): Promise<JoinResult> {
    const trackName = cleanName(body?.trackName, 'Nome da pista', 40);
    const pilotName = cleanName(body?.pilotName, 'Nome do piloto');
    const targetLaps =
      body?.targetLaps != null && Number.isFinite(+body.targetLaps) && +body.targetLaps > 0
        ? Math.min(999, Math.floor(+body.targetLaps))
        : null;
    const nameKey = trackName.toLowerCase();
    const track = await this.db.track.upsert({
      where: { nameKey },
      update: {},
      create: { name: trackName, nameKey },
    });

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newCode();
      try {
        const token = randomBytes(24).toString('hex');
        const session = await this.db.session.create({
          data: {
            code,
            trackId: track.id,
            targetLaps,
            pilots: { create: { name: pilotName, number: 1, color: pilotColor(0), token } },
          },
          include: { pilots: true },
        });
        const host = session.pilots[0];
        await this.db.session.update({ where: { id: session.id }, data: { hostPilotId: host.id } });
        this.runtimes.delete(code);
        const rt = await this.getRuntime(code);
        this.log.log(`Sala ${code} criada (${trackName}) por ${pilotName}`);
        return { session: rt.snapshot(Date.now()), pilot: rt.pilots.get(host.id)!.info, token };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
    throw new Error('Não foi possível gerar um código de sala');
  }

  join(code: string, pilotNameRaw: unknown, requestId?: unknown): Promise<JoinResult> {
    return this.once(`join:${String(code ?? '').toUpperCase()}`, requestId, () => this.doJoin(code, pilotNameRaw));
  }

  private async doJoin(code: string, pilotNameRaw: unknown): Promise<JoinResult> {
    const pilotName = cleanName(pilotNameRaw, 'Nome do piloto');
    const rt = await this.getRuntime(code);
    if (rt.status === 'FINISHED') throw new BadRequestException('Esta corrida já foi encerrada');
    if (rt.pilots.size >= MAX_PILOTS) throw new BadRequestException('Sala cheia');
    const used = new Set([...rt.pilots.values()].map((p) => p.info.number));
    let number = 1;
    while (used.has(number)) number++;
    const token = randomBytes(24).toString('hex');
    const pilot = await this.db.pilot.create({
      data: { sessionId: rt.sessionId, name: pilotName, number, color: pilotColor(number - 1), token },
    });
    const info: PilotInfo = { id: pilot.id, name: pilot.name, number, color: pilot.color, isHost: false };
    rt.addPilot(info);
    return { session: rt.snapshot(Date.now()), pilot: info, token };
  }

  async authenticate(code: string, pilotId: string, token: string): Promise<RaceRuntime> {
    const rt = await this.getRuntime(code);
    const pilot = await this.db.pilot.findUnique({ where: { id: pilotId } });
    if (!pilot || pilot.sessionId !== rt.sessionId || pilot.token !== token) {
      throw new ForbiddenException('Credenciais do piloto inválidas');
    }
    return rt;
  }

  async list(limit = 30): Promise<SessionSummary[]> {
    const rows = await this.db.session.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, limit),
      include: { track: true, _count: { select: { pilots: true } } },
    });
    const now = Date.now();
    return rows
      .filter((r) => !(r.status === SessionStatus.LOBBY && now - r.createdAt.getTime() > ABANDONED_LOBBY_MS))
      .map((r) => ({
      code: r.code,
      trackName: r.track.name,
      status: r.status,
      startedAt: ms(r.startedAt),
      finishedAt: ms(r.finishedAt),
      pilots: r._count.pilots,
      createdAt: r.createdAt.getTime(),
    }));
  }

  // ---------------------------------------------------------------- runtime

  async getRuntime(codeRaw: string): Promise<RaceRuntime> {
    const code = String(codeRaw ?? '').trim().toUpperCase();
    const cached = this.runtimes.get(code);
    if (cached) return cached;
    const pending = this.loading.get(code);
    if (pending) return pending;
    const p = this.loadRuntime(code).finally(() => this.loading.delete(code));
    this.loading.set(code, p);
    return p;
  }

  /** Reconstrói o estado a partir do banco (reinício do servidor, sessão antiga). */
  private async loadRuntime(code: string): Promise<RaceRuntime> {
    const s = await this.db.session.findUnique({
      where: { code },
      include: { track: true, pilots: { orderBy: { number: 'asc' } } },
    });
    if (!s) throw new NotFoundException(`Sala ${code} não encontrada`);
    const rt = new RaceRuntime(
      s.id,
      s.code,
      s.trackId,
      s.track.name,
      s.status,
      s.hostPilotId,
      s.targetLaps,
      ms(s.startedAt),
      ms(s.finishedAt),
      (s.line as unknown as StartFinishLine) ?? null,
    );
    rt.setTrackPath((s.trackPath as unknown as LatLng[]) ?? null);
    for (const p of s.pilots) {
      rt.addPilot({ id: p.id, name: p.name, number: p.number, color: p.color, isHost: p.id === s.hostPilotId });
    }
    if (s.startedAt) {
      const points = await this.db.gpsPoint.findMany({ where: { sessionId: s.id }, orderBy: [{ pilotId: 'asc' }, { seq: 'asc' }] });
      const byPilot = new Map<string, GpsSample[]>();
      for (const pt of points) {
        const arr = byPilot.get(pt.pilotId) ?? [];
        arr.push({ seq: pt.seq, t: Number(pt.t), lat: pt.lat, lng: pt.lng, speed: pt.speed, heading: pt.heading, accuracy: pt.accuracy });
        byPilot.set(pt.pilotId, arr);
      }
      for (const [pilotId, arr] of byPilot) {
        // reprocessa respeitando a sequência contígua
        rt.ingest(pilotId, arr, Date.now());
      }
    }
    this.runtimes.set(code, rt);
    return rt;
  }

  // ---------------------------------------------------------------- corrida

  private assertHost(rt: RaceRuntime, pilotId: string) {
    if (rt.hostPilotId !== pilotId) throw new ForbiddenException('Apenas o criador da sala pode fazer isso');
  }

  async startRace(rt: RaceRuntime, pilotId: string, at: LinePayload): Promise<void> {
    this.assertHost(rt, pilotId);
    if (rt.status !== 'LOBBY') throw new BadRequestException('A corrida já foi iniciada');
    this.assertCoords(at);
    const now = Date.now();
    const line = createLine(at, 1);
    rt.status = 'RUNNING';
    rt.startedAt = now;
    rt.setLine(line);
    await this.db.session.update({
      where: { id: rt.sessionId },
      data: { status: SessionStatus.RUNNING, startedAt: new Date(now), line: line as unknown as Prisma.InputJsonValue },
    });
  }

  async resetLine(rt: RaceRuntime, pilotId: string, at: LinePayload): Promise<StartFinishLine> {
    this.assertHost(rt, pilotId);
    if (rt.status !== 'RUNNING') throw new BadRequestException('A corrida não está em andamento');
    this.assertCoords(at);
    const fresh = createLine(at, (rt.line?.version ?? 0) + 1);
    // o sentido da pista não muda: se o kart estiver parado, mantém o rumo anterior
    if (fresh.bearing == null && rt.line?.bearing != null) fresh.bearing = rt.line.bearing;
    rt.setLine(fresh);
    await this.persistLine(rt);
    await this.syncTiming(rt, [...rt.pilots.keys()]);
    return fresh;
  }

  async finish(rt: RaceRuntime, pilotId: string): Promise<GeneralReport> {
    this.assertHost(rt, pilotId);
    if (rt.status === 'FINISHED') return this.generalReport(rt.code);
    const now = Date.now();
    rt.status = 'FINISHED';
    rt.finishedAt = now;
    const report = this.buildGeneral(rt);
    await this.enqueue(rt, async () => {
      await this.db.session.update({
        where: { id: rt.sessionId },
        data: {
          status: SessionStatus.FINISHED,
          finishedAt: new Date(now),
          report: report as unknown as Prisma.InputJsonValue,
        },
      });
      await this.db.track.update({
        where: { id: rt.trackId },
        data: {
          line: (rt.line ?? undefined) as unknown as Prisma.InputJsonValue,
          path: (rt.trackPath ?? undefined) as unknown as Prisma.InputJsonValue,
        },
      });
      for (const p of rt.pilots.values()) {
        await this.db.pilot.update({ where: { id: p.info.id }, data: { maxSpeedMs: p.detector.maxSpeedMs || null } });
      }
    });
    return report;
  }

  async ingest(rt: RaceRuntime, pilotId: string, points: GpsSample[]): Promise<IngestResult> {
    if (!Array.isArray(points)) throw new BadRequestException('points inválido');
    if (rt.status === 'LOBBY') return { lastSeq: rt.pilots.get(pilotId)?.lastSeq ?? -1, accepted: [], events: [], lineChanged: false, trackPathChanged: false };
    const valid = points
      .filter((p) => p && Number.isInteger(p.seq) && Number.isFinite(p.t) && Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .slice(0, 2000);
    const res = rt.ingest(pilotId, valid, Date.now());
    if (!res.accepted.length && !res.lineChanged) return res;

    await this.enqueue(rt, async () => {
      if (res.accepted.length) {
        await this.db.gpsPoint.createMany({
          data: res.accepted.map((p) => ({
            sessionId: rt.sessionId,
            pilotId,
            seq: p.seq,
            t: BigInt(p.t),
            lat: p.lat,
            lng: p.lng,
            speed: p.speed,
            heading: p.heading,
            accuracy: p.accuracy,
          })),
          skipDuplicates: true,
        });
      }
    });
    if (res.lineChanged) {
      await this.persistLine(rt);
      await this.syncTiming(rt, [...rt.pilots.keys()]);
    } else if (res.events.length) {
      await this.syncTiming(rt, [pilotId]);
    }
    if (res.trackPathChanged) {
      await this.enqueue(rt, () =>
        this.db.session.update({ where: { id: rt.sessionId }, data: { trackPath: rt.trackPath as unknown as Prisma.InputJsonValue } }),
      );
    }
    // pontos sincronizados depois da bandeirada (piloto estava offline): atualiza o relatório
    if (rt.status === 'FINISHED' && (res.events.length || res.lineChanged)) {
      const report = this.buildGeneral(rt);
      await this.enqueue(rt, () =>
        this.db.session.update({ where: { id: rt.sessionId }, data: { report: report as unknown as Prisma.InputJsonValue } }),
      );
    }
    return res;
  }

  // ---------------------------------------------------------------- relatórios

  private buildGeneral(rt: RaceRuntime): GeneralReport {
    return buildGeneralReport(
      { sessionCode: rt.code, trackName: rt.trackName, startedAt: rt.startedAt, finishedAt: rt.finishedAt },
      [...rt.pilots.values()].map((p) => ({
        pilotId: p.info.id,
        name: p.info.name,
        number: p.info.number,
        color: p.info.color,
        crossings: p.crossingTimes,
      })),
    );
  }

  async generalReport(code: string): Promise<GeneralReport> {
    return this.buildGeneral(await this.getRuntime(code));
  }

  async pilotReport(code: string, pilotId: string): Promise<PilotReport> {
    const rt = await this.getRuntime(code);
    const p = rt.pilots.get(pilotId);
    if (!p) throw new NotFoundException('Piloto não encontrado');
    const row = rt.standings().find((r) => r.pilotId === pilotId);
    return buildPilotReport(
      { pilotId, name: p.info.name, number: p.info.number, color: p.info.color },
      [...p.detector.laps],
      row?.started ? row.position : null,
      p.detector.maxSpeedMs || null,
    );
  }

  /** Traçado do piloto (para comparação de trajetórias / replay — evolução futura). */
  async pilotTrace(code: string, pilotId: string, lap?: number, rawOnly = false): Promise<Array<{ t: number; lat: number; lng: number; speed: number | null }>> {
    const rt = await this.getRuntime(code);
    const p = rt.pilots.get(pilotId);
    if (!p) throw new NotFoundException('Piloto não encontrado');
    let raw = p.points;
    let from = -Infinity;
    let to = Infinity;
    if (lap) {
      const l = p.detector.laps.find((x) => x.number === lap);
      if (!l) return [];
      from = l.startT;
      to = l.endT;
      raw = raw.filter((s) => s.t >= l.startT - 3000 && s.t <= l.endT + 3000);
    }
    if (rawOnly) return raw.filter((s) => s.t >= from && s.t <= to).map((s) => ({ t: s.t, lat: s.lat, lng: s.lng, speed: s.speed, heading: s.heading, accuracy: s.accuracy }));
    // traçado suavizado (Kalman ida e volta) — o bruto do celular "serpenteia"
    return smoothTrack(raw)
      .filter((s) => s.t >= from && s.t <= to)
      .map((s) => ({ t: s.t, lat: s.lat, lng: s.lng, speed: s.speed }));
  }

  // ---------------------------------------------------------------- persistência

  private assertCoords(at: LinePayload) {
    if (!at || !Number.isFinite(at.lat) || !Number.isFinite(at.lng)) throw new BadRequestException('Posição GPS inválida');
  }

  private enqueue<T>(rt: RaceRuntime, fn: () => Promise<T>): Promise<T> {
    const prev = this.writeQueue.get(rt.sessionId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.writeQueue.set(rt.sessionId, next.catch(() => undefined));
    return next;
  }

  private persistLine(rt: RaceRuntime) {
    return this.enqueue(rt, () =>
      this.db.session.update({ where: { id: rt.sessionId }, data: { line: rt.line as unknown as Prisma.InputJsonValue } }),
    );
  }

  /** Regrava passagens e voltas dos pilotos indicados a partir do estado em memória. */
  private syncTiming(rt: RaceRuntime, pilotIds: string[]) {
    return this.enqueue(rt, async () => {
      const crossings: Prisma.CrossingCreateManyInput[] = [];
      const laps: Prisma.LapCreateManyInput[] = [];
      for (const id of pilotIds) {
        const p = rt.pilots.get(id);
        if (!p) continue;
        for (const c of p.detector.crossings) {
          crossings.push({ sessionId: rt.sessionId, pilotId: id, index: c.index, t: BigInt(c.t), uncertaintyMs: c.uncertaintyMs });
        }
        for (const l of p.detector.laps) {
          laps.push({
            sessionId: rt.sessionId,
            pilotId: id,
            number: l.number,
            startT: BigInt(l.startT),
            endT: BigInt(l.endT),
            timeMs: l.timeMs,
            uncertaintyMs: l.uncertaintyMs,
          });
        }
      }
      await this.db.$transaction([
        this.db.crossing.deleteMany({ where: { pilotId: { in: pilotIds } } }),
        this.db.lap.deleteMany({ where: { pilotId: { in: pilotIds } } }),
        this.db.crossing.createMany({ data: crossings }),
        this.db.lap.createMany({ data: laps }),
      ]);
    });
  }
}
