/**
 * Banco em memória que imita o subconjunto do Prisma Client usado pelo
 * SessionsService. Ativado com DB_DRIVER=memory — útil para demonstrações,
 * testes rápidos e para rodar o simulador sem PostgreSQL. Os dados somem ao
 * reiniciar o servidor.
 */
import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

type Row = Record<string, any>;

function pickWhere(rows: Row[], where: Row = {}): Row[] {
  return rows.filter((r) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'in' in v) return (v.in as unknown[]).includes(r[k]);
      return r[k] === v;
    }),
  );
}

function table(name: string, uniques: string[][] = []) {
  const rows: Row[] = [];
  const dupe = (data: Row) => uniques.some((u) => rows.some((r) => u.every((k) => r[k] === data[k])));
  return {
    rows,
    async create({ data }: { data: Row }) {
      if (dupe(data)) {
        const e: any = new Error(`Unique constraint failed on ${name}`);
        e.code = 'P2002';
        throw e;
      }
      const row = { id: data.id ?? randomUUID(), createdAt: new Date(), ...data };
      rows.push(row);
      return { ...row };
    },
    async createMany({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) {
      let count = 0;
      for (const d of data) {
        if (dupe(d)) {
          if (skipDuplicates) continue;
          throw new Error(`Unique constraint failed on ${name}`);
        }
        rows.push({ id: randomUUID(), ...d });
        count++;
      }
      return { count };
    },
    async findUnique({ where }: { where: Row }) {
      const r = pickWhere(rows, where)[0];
      return r ? { ...r } : null;
    },
    async findMany({ where, orderBy, take }: { where?: Row; orderBy?: Row | Row[]; take?: number } = {}) {
      let out = pickWhere(rows, where).map((r) => ({ ...r }));
      const orders = orderBy ? (Array.isArray(orderBy) ? orderBy : [orderBy]) : [];
      if (orders.length) {
        out.sort((a, b) => {
          for (const o of orders) {
            const [k, dir] = Object.entries(o)[0];
            const av = a[k] instanceof Date ? a[k].getTime() : a[k];
            const bv = b[k] instanceof Date ? b[k].getTime() : b[k];
            if (av < bv) return dir === 'desc' ? 1 : -1;
            if (av > bv) return dir === 'desc' ? -1 : 1;
          }
          return 0;
        });
      }
      if (take != null) out = out.slice(0, take);
      return out;
    },
    async update({ where, data }: { where: Row; data: Row }) {
      const r = pickWhere(rows, where)[0];
      if (!r) throw new Error(`${name} não encontrado`);
      for (const [k, v] of Object.entries(data)) if (v !== undefined) r[k] = v;
      return { ...r };
    },
    async upsert({ where, update, create }: { where: Row; update: Row; create: Row }) {
      const r = pickWhere(rows, where)[0];
      if (r) {
        Object.assign(r, update);
        return { ...r };
      }
      return this.create({ data: create });
    },
    async deleteMany({ where }: { where: Row }) {
      const victims = new Set(pickWhere(rows, where));
      const keep = rows.filter((r) => !victims.has(r));
      rows.length = 0;
      rows.push(...keep);
      return { count: victims.size };
    },
  };
}

export class MemoryDb {
  track = table('Track', [['nameKey']]);
  pilot = table('Pilot', [['sessionId', 'number']]);
  gpsPoint = table('GpsPoint', [['pilotId', 'seq']]);
  crossing = table('Crossing', [['pilotId', 'index']]);
  lap = table('Lap', [['pilotId', 'number']]);
  private sessions = table('Session', [['code']]);

  session = {
    create: async ({ data }: { data: Row; include?: Row }) => {
      const { pilots, ...rest } = data;
      const s = await this.sessions.create({ data: { status: 'LOBBY', ...rest } });
      const created = [];
      if (pilots?.create) created.push(await this.pilot.create({ data: { ...pilots.create, sessionId: s.id, joinedAt: new Date() } }));
      return { ...s, pilots: created };
    },
    update: (args: { where: Row; data: Row }) => this.sessions.update(args),
    findUnique: async ({ where }: { where: Row; include?: Row }) => {
      const s = await this.sessions.findUnique({ where });
      if (!s) return null;
      return {
        ...s,
        track: await this.track.findUnique({ where: { id: s.trackId } }),
        pilots: await this.pilot.findMany({ where: { sessionId: s.id }, orderBy: { number: 'asc' } }),
      };
    },
    findMany: async (args: { orderBy?: Row; take?: number; include?: Row }) => {
      const list = await this.sessions.findMany({ orderBy: args.orderBy, take: args.take });
      return Promise.all(
        list.map(async (s) => ({
          ...s,
          track: await this.track.findUnique({ where: { id: s.trackId } }),
          _count: { pilots: this.pilot.rows.filter((p) => p.sessionId === s.id).length },
        })),
      );
    },
  };

  async $transaction(ops: Promise<unknown>[]) {
    return Promise.all(ops);
  }
  async $connect() {}
  async $disconnect() {}
  async onModuleInit() {
    new Logger('MemoryDb').warn('DB_DRIVER=memory — dados em memória, perdidos ao reiniciar.');
  }
}
