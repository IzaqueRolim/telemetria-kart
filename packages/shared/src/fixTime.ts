/**
 * Base de tempo dos fixes de GPS.
 *
 * O `timestamp` entregue pelo sistema de localização pode estar no relógio do
 * GPS (UTC dos satélites) enquanto `Date.now()` usa o relógio do celular, que
 * pode estar dezenas de segundos adiantado ou atrasado. Misturar os dois gera
 * gaps falsos e constantes entre pilotos (ex.: 55 s com celulares lado a lado).
 *
 * Este mapeador estima o desvio entre os dois relógios a partir do instante em
 * que cada fix chega (`recvT`, relógio do celular) e converte o timestamp do fix
 * para o relógio do celular — que então é convertido para o do servidor pelo
 * ClockSync.
 *
 * Usa o MÍNIMO de (recebido - fix) numa janela: a latência de entrega é sempre
 * positiva, então o mínimo é a melhor estimativa do desvio puro. Quando os dois
 * relógios já são o mesmo (mínimo entre -0,05 s e 0,3 s), não corrige nada,
 * preservando a precisão do instante original do fix.
 */
export class FixTimeMapper {
  private diffs: number[] = [];
  private _offset = 0;

  constructor(
    private readonly window = 40,
    private readonly sameClockMaxMs = 300,
  ) {}

  /** Converte o timestamp do fix para o relógio do celular. */
  map(fixT: number, recvT: number): number {
    this.diffs.push(recvT - fixT);
    if (this.diffs.length > this.window) this.diffs.shift();
    const min = Math.min(...this.diffs);
    this._offset = min >= -50 && min <= this.sameClockMaxMs ? 0 : min;
    return Math.round(fixT + this._offset);
  }

  /** desvio aplicado (ms): relógio do celular − relógio do fix */
  get offsetMs(): number {
    return this._offset;
  }
}
