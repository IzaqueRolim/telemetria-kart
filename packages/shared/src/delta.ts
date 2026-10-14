/**
 * Delta preditivo (estilo RaceChrono): compara o tempo decorrido na volta atual
 * com o tempo da melhor volta na MESMA distância percorrida desde a linha.
 * Negativo = mais rápido que a melhor volta.
 */
export class LapDeltaTracker {
  private current: Array<[number, number]> = [];
  private best: Array<[number, number]> | null = null;
  private bestTimeMs: number | null = null;

  /** Chamado a cada passagem. `lapTimeMs` vem quando uma volta foi completada. */
  onCrossing(lapTimeMs?: number): void {
    if (lapTimeMs != null && (this.bestTimeMs == null || lapTimeMs < this.bestTimeMs) && this.current.length > 5) {
      this.best = this.current;
      this.bestTimeMs = lapTimeMs;
    }
    this.current = [[0, 0]];
  }

  push(distanceM: number, elapsedMs: number): void {
    if (!this.current.length) return;
    const last = this.current[this.current.length - 1];
    if (distanceM > last[0]) this.current.push([distanceM, elapsedMs]);
  }

  get bestLapDistanceM(): number | null {
    return this.best ? this.best[this.best.length - 1][0] : null;
  }

  delta(distanceM: number, elapsedMs: number): number | null {
    const ref = this.best;
    if (!ref || ref.length < 2) return null;
    if (distanceM <= 0 || distanceM > ref[ref.length - 1][0]) return null;
    let lo = 0;
    let hi = ref.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ref[mid][0] < distanceM) lo = mid;
      else hi = mid;
    }
    const [d0, t0] = ref[lo];
    const [d1, t1] = ref[hi];
    const refT = d1 === d0 ? t0 : t0 + ((distanceM - d0) / (d1 - d0)) * (t1 - t0);
    return Math.round(elapsedMs - refT);
  }

  /** Fração [0,1] da volta percorrida, usando a melhor volta como referência. */
  progress(distanceM: number): number | null {
    const total = this.bestLapDistanceM;
    if (!total) return null;
    return Math.max(0, Math.min(1, distanceM / total));
  }

  reset(): void {
    this.current = [];
    this.best = null;
    this.bestTimeMs = null;
  }
}
