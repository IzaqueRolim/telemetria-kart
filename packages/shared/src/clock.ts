/**
 * Sincronização de relógio estilo NTP. Os relógios dos celulares podem diferir
 * em centenas de ms; como o gap entre pilotos compara instantes medidos em
 * aparelhos diferentes, todos os tempos são convertidos para o relógio do servidor.
 */
export interface ClockSample {
  offsetMs: number; // serverTime - localTime
  rttMs: number;
}

export function clockSample(t0Local: number, serverT: number, t1Local: number): ClockSample {
  const rtt = t1Local - t0Local;
  return { offsetMs: Math.round(serverT - (t0Local + t1Local) / 2), rttMs: rtt };
}

export class ClockSync {
  private samples: ClockSample[] = [];
  private _offset = 0;
  private _synced = false;

  constructor(private readonly maxSamples = 20) {}

  add(s: ClockSample): void {
    if (s.rttMs < 0 || s.rttMs > 5000) return;
    this.samples.push(s);
    if (this.samples.length > this.maxSamples) this.samples.shift();
    // usa a mediana das amostras com menor RTT (as mais confiáveis)
    const best = [...this.samples].sort((a, b) => a.rttMs - b.rttMs).slice(0, Math.max(3, Math.ceil(this.samples.length / 2)));
    const offs = best.map((x) => x.offsetMs).sort((a, b) => a - b);
    this._offset = offs[Math.floor(offs.length / 2)];
    this._synced = true;
  }

  get offsetMs(): number {
    return this._offset;
  }
  get synced(): boolean {
    return this._synced;
  }
  /** melhor RTT observado — indica a incerteza da sincronização (~rtt/2) */
  get bestRttMs(): number | null {
    return this.samples.length ? Math.min(...this.samples.map((s) => s.rttMs)) : null;
  }

  toServer(localT: number): number {
    return Math.round(localT + this._offset);
  }
  now(): number {
    return this.toServer(Date.now());
  }
}
