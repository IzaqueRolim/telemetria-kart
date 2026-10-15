import {
  computeStandings,
  CrossingEvent,
  GpsSample,
  haversine,
  LapDetector,
  LatLng,
  LivePosition,
  PilotInfo,
  physicalDistances,
  ProgressTracker,
  resolveLineBearing,
  smoothTrack,
  TrackReference,
  SessionSnapshot,
  SessionStatus,
  STALE_AFTER_MS,
  StandingRow,
  StartFinishLine,
} from '@kart/shared';

export class PilotRuntime {
  /** pontos brutos (como chegaram do celular) */
  points: GpsSample[] = [];
  /** pontos filtrados pelo Kalman do detector (usados no mapa e no progresso) */
  filtered: GpsSample[] = [];
  readonly progress = new ProgressTracker();
  lastSeq = -1;
  lastReceivedAt = 0;
  readonly detector: LapDetector;

  constructor(public info: PilotInfo, line: StartFinishLine | null, startAfterT: number) {
    this.detector = new LapDetector(line, { startAfterT });
  }

  /** Passa um ponto bruto pelo detector e atualiza o progresso na pista. */
  feed(raw: GpsSample, ref: TrackReference | null) {
    const before = this.detector.stats.accepted;
    const ev = this.detector.push(raw);
    if (this.detector.stats.accepted > before) {
      const f = this.detector.lastSample as GpsSample;
      this.filtered.push(f);
      if (ref && this.detector.hasStarted) {
        this.progress.update(ref, f, this.detector.crossings.length - 1, this.detector.lastCrossingT as number);
      }
    }
    return ev;
  }

  /** Reprocessa todos os pontos brutos (linha nova ou traçado novo). */
  replay(line: StartFinishLine | null, startAfterT: number, ref: TrackReference | null) {
    this.detector.reset(line, startAfterT);
    this.filtered = [];
    this.progress.reset();
    for (const p of this.points) this.feed(p, ref);
  }

  get crossingTimes(): number[] {
    return this.detector.crossings.map((c) => c.t);
  }
}

export interface IngestResult {
  lastSeq: number;
  accepted: GpsSample[];
  events: CrossingEvent[];
  /** a linha mudou (sentido resolvido) e todas as voltas foram recalculadas */
  lineChanged: boolean;
  trackPathChanged: boolean;
}

/**
 * Estado em memória de uma sessão. É a fonte oficial de voltas e classificação:
 * recebe os pontos de todos os pilotos (em ordem de seq), roda o mesmo detector
 * do celular e recalcula tudo de forma determinística quando a linha muda.
 */
export class RaceRuntime {
  pilots = new Map<string, PilotRuntime>();
  trackPath: LatLng[] | null = null;
  trackLengthM: number | null = null;
  trackRef: TrackReference | null = null;

  constructor(
    public readonly sessionId: string,
    public readonly code: string,
    public readonly trackId: string,
    public readonly trackName: string,
    public status: SessionStatus,
    public hostPilotId: string | null,
    public targetLaps: number | null,
    public startedAt: number | null,
    public finishedAt: number | null,
    public line: StartFinishLine | null,
  ) {}

  addPilot(info: PilotInfo): PilotRuntime {
    const existing = this.pilots.get(info.id);
    if (existing) return existing;
    const p = new PilotRuntime(info, this.line, this.startedAt ?? 0);
    this.pilots.set(info.id, p);
    return p;
  }

  setTrackPath(path: LatLng[] | null): void {
    this.trackPath = path;
    if (path && path.length > 1) {
      let len = 0;
      for (let i = 1; i < path.length; i++) len += haversine(path[i - 1], path[i]);
      this.trackLengthM = len;
    } else this.trackLengthM = null;
    this.rebuildReference();
  }

  /** Referência da pista para o progresso ao vivo (precisa do traçado e do sentido da linha). */
  private rebuildReference() {
    const ok = this.trackPath && this.trackPath.length > 8 && this.line?.bearing != null;
    this.trackRef = ok ? new TrackReference(this.trackPath as LatLng[], this.line as StartFinishLine) : null;
    if (this.trackRef) this.trackLengthM = this.trackRef.length;
    for (const p of this.pilots.values()) {
      p.progress.reset();
      if (!this.trackRef) continue;
      let k = 0;
      const cr = p.detector.crossings;
      for (const f of p.filtered) {
        while (k < cr.length && cr[k].t <= f.t) k++;
        if (k >= 1) p.progress.update(this.trackRef, f, k - 1, cr[k - 1].t);
      }
    }
  }

  /**
   * Recebe um lote do piloto. Só aceita a continuação exata da sequência
   * (seq = lastSeq + 1 ...). Duplicatas são ignoradas; buracos param o lote —
   * o celular reenviará a partir do lastSeq confirmado.
   */
  ingest(pilotId: string, batch: GpsSample[], now: number): IngestResult {
    const p = this.pilots.get(pilotId);
    const res: IngestResult = { lastSeq: -1, accepted: [], events: [], lineChanged: false, trackPathChanged: false };
    if (!p) return res;
    const sorted = [...batch].sort((a, b) => a.seq - b.seq);
    for (const s of sorted) {
      if (s.seq <= p.lastSeq) continue;
      if (s.seq !== p.lastSeq + 1) break;
      if ((this.finishedAt != null && s.t > this.finishedAt) || s.t > now + 30_000) {
        // após a bandeirada, ou relógio do aparelho claramente errado: descarta, mas confirma
        p.lastSeq = s.seq;
        continue;
      }
      const clean: GpsSample = {
        seq: s.seq,
        t: Math.round(s.t),
        lat: s.lat,
        lng: s.lng,
        speed: s.speed ?? null,
        heading: s.heading ?? null,
        accuracy: s.accuracy ?? null,
      };
      p.points.push(clean);
      p.lastSeq = s.seq;
      res.accepted.push(clean);
      const ev = p.feed(clean, this.trackRef);
      if (ev) res.events.push(ev);
    }
    if (res.accepted.length) p.lastReceivedAt = now;
    res.lastSeq = p.lastSeq;

    // sentido da linha ainda pendente: resolve pelo deslocamento do criador
    if (this.line && this.line.bearing == null && pilotId === this.hostPilotId && this.startedAt) {
      const b = resolveLineBearing(this.line, p.points, this.startedAt);
      if (b != null) {
        this.setLine({ ...this.line, bearing: b });
        res.lineChanged = true;
        res.events = [];
      }
    }

    if (!this.trackPath) {
      const path = this.extractTrackPath();
      if (path) {
        this.setTrackPath(path);
        res.trackPathChanged = true;
      }
    }
    return res;
  }

  /** Troca a linha e reprocessa todos os pontos de todos os pilotos. */
  setLine(line: StartFinishLine): void {
    this.line = line;
    for (const p of this.pilots.values()) p.replay(line, this.startedAt ?? 0, null);
    this.rebuildReference();
  }

  /**
   * Traçado do circuito: primeira volta completa de qualquer piloto, filtrada e
   * suavizada (Kalman ida + volta) e reamostrada a cada ~2 m.
   */
  extractTrackPath(): LatLng[] | null {
    for (const p of this.pilots.values()) {
      const lap = p.detector.laps[0];
      if (!lap) continue;
      const raw = p.points.filter((s) => s.t >= lap.startT - 3000 && s.t <= lap.endT + 3000);
      if (raw.length < 8) continue;
      const smooth = smoothTrack(raw).filter((s) => s.t >= lap.startT && s.t <= lap.endT);
      if (smooth.length < 6) continue;
      const out: LatLng[] = [{ lat: smooth[0].lat, lng: smooth[0].lng }];
      for (const s of smooth) {
        if (haversine(out[out.length - 1], s) >= 2) out.push({ lat: s.lat, lng: s.lng });
      }
      out.push(out[0]);
      return out;
    }
    return null;
  }

  standings(): StandingRow[] {
    return computeStandings(
      [...this.pilots.values()].map((p) => ({
        pilotId: p.info.id,
        name: p.info.name,
        number: p.info.number,
        color: p.info.color,
        crossings: p.crossingTimes,
        progress: this.trackRef && p.progress.ready ? p.progress : null,
      })),
      this.trackRef?.length ?? null,
    );
  }

  positions(now: number, standings = this.standings()): LivePosition[] {
    const latest: Record<string, LatLng | undefined> = {};
    for (const p of this.pilots.values()) {
      const last = p.filtered[p.filtered.length - 1] ?? p.points[p.points.length - 1];
      if (last) latest[p.info.id] = last;
    }
    const dist = physicalDistances(standings, latest);
    const out: LivePosition[] = [];
    for (const p of this.pilots.values()) {
      const last = p.filtered[p.filtered.length - 1] ?? p.points[p.points.length - 1];
      const lastRaw = p.points[p.points.length - 1];
      if (!last || !lastRaw) continue;
      const ageMs = Math.max(0, now - lastRaw.t);
      const speed = p.detector.currentSpeedMs ?? last.speed;
      out.push({
        pilotId: p.info.id,
        lat: last.lat,
        lng: last.lng,
        t: last.t,
        speedKmh: speed != null ? Math.round(speed * 36) / 10 : null,
        heading: last.heading,
        stale: this.status === 'RUNNING' && ageMs > STALE_AFTER_MS,
        ageMs,
        distanceAheadM: dist[p.info.id] != null ? Math.round(dist[p.info.id] as number) : null,
        lapProgress:
          this.trackRef && p.progress.ready
            ? Math.max(0, Math.min(1, (p.progress.D - (p.detector.crossings.length - 1) * this.trackRef.length) / this.trackRef.length))
            : null,
      });
    }
    return out;
  }

  pilotInfos(): PilotInfo[] {
    return [...this.pilots.values()].map((p) => p.info).sort((a, b) => a.number - b.number);
  }

  snapshot(now: number): SessionSnapshot {
    return {
      id: this.sessionId,
      code: this.code,
      trackId: this.trackId,
      trackName: this.trackName,
      status: this.status,
      hostPilotId: this.hostPilotId,
      targetLaps: this.targetLaps,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      line: this.line,
      pilots: this.pilotInfos(),
      standings: this.standings(),
      trackPath: this.trackPath,
      serverTime: now,
    };
  }

  isSessionBest(timeMs: number): boolean {
    for (const p of this.pilots.values()) for (const l of p.detector.laps) if (l.timeMs < timeMs) return false;
    return true;
  }
}
