/**
 * Simulador de karts.
 *
 *   npm run simulate -- --karts 6                # cria uma sala e corre sozinho
 *   npm run simulate -- --join ABC123 --karts 3  # adiciona karts a uma sala existente
 *
 * Opções:
 *   --server URL      (padrão http://localhost:3000)
 *   --karts N         número de karts (padrão 5)
 *   --hz N            frequência do GPS simulado (padrão 2)
 *   --duration S      encerra a corrida após S segundos (só quando o simulador é o criador; 0 = nunca)
 *   --offline         um dos karts perde a internet por ~12 s no meio da corrida
 *   --pair            o 2º kart anda colado no 1º (teste de "dois celulares lado a lado")
 *   --noise M         deriva do GPS simulado em metros (padrão 3)
 *   --track NOME      nome da pista (padrão "Kartódromo Simulado")
 *   --origin lat,lng  centro do circuito sintético
 */
import { io, Socket } from 'socket.io-client';
import {
  Ack,
  buildCircuit,
  ClockSync,
  clockSample,
  EV,
  FixTimeMapper,
  fromXY,
  GpsSample,
  JoinResult,
  PointsAck,
  SessionSnapshot,
  toXY,
} from '@kart/shared';

const args = process.argv.slice(2);
const opt = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name: string) => args.includes(`--${name}`);

const SERVER = opt('server', 'http://localhost:3000')!.replace(/\/$/, '');
const KARTS = Number(opt('karts', '5'));
const HZ = Number(opt('hz', '2'));
const NOISE = Number(opt('noise', '3')); // deriva do GPS em metros
const DURATION = Number(opt('duration', '0'));
const JOIN = opt('join')?.toUpperCase();
const TRACK = opt('track', 'Kartódromo Simulado')!;
const [oLat, oLng] = (opt('origin', '-23.7015,-46.6975') as string).split(',').map(Number);

const NAMES = ['Gabriel', 'Lucas', 'Marina', 'Beatriz', 'Rafael', 'Júlia', 'Pedro', 'Camila', 'Thiago', 'Larissa', 'Bruno', 'Sofia'];

let circuit = buildCircuit({ lat: oLat, lng: oLng });
let rotation = 0; // graus, para alinhar o circuito a uma linha real (--join)

function positionAt(d: number) {
  const p = circuit.at(d);
  if (!rotation) return p;
  const r = (rotation * Math.PI) / 180;
  const { x, y } = p.xy;
  const xy = { x: x * Math.cos(r) + y * Math.sin(r), y: -x * Math.sin(r) + y * Math.cos(r) };
  return { ...p, latLng: fromXY(circuit.origin, xy), heading: (p.heading + rotation + 360) % 360 };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${SERVER}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.message ?? r.statusText);
  return j as T;
}

function emitAck<T>(s: Socket, ev: string, payload: unknown, timeout = 5000): Promise<T> {
  return s.timeout(timeout).emitWithAck(ev, payload) as Promise<T>;
}

let seed = 1234;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

class SimKart {
  socket!: Socket;
  clock = new ClockSync();
  queue: GpsSample[] = [];
  seq = 0;
  d: number;
  pace: number;
  /** relógio do "celular" errado em até ±60 s (como celulares reais); o GPS tem a hora certa */
  skewMs = Math.round((rnd() - 0.5) * 120_000);
  fixTime = new FixTimeMapper();
  ex = 0;
  ey = 0;
  sysNow() {
    return Date.now() + this.skewMs;
  }
  online = true;
  session!: SessionSnapshot;

  constructor(public join: JoinResult, gridIndex: number) {
    this.d = gridIndex === 0 ? 0 : -6 * gridIndex; // fila indiana atrás da linha
    this.pace = 20 + rnd() * 2.5; // m/s na reta
    this.session = join.session;
  }

  get name() {
    return this.join.pilot.name;
  }

  async connect() {
    this.socket = io(SERVER, { transports: ['websocket'], reconnection: true });
    this.socket.on('connect', async () => {
      for (let i = 0; i < 5; i++) {
        const t0 = this.sysNow();
        const r = await emitAck<{ serverT: number }>(this.socket, EV.CLOCK_PING, { t0 });
        this.clock.add(clockSample(t0, r.serverT, this.sysNow()));
      }
      const r = await emitAck<Ack<{ session: SessionSnapshot; lastSeq: number }>>(this.socket, EV.PILOT_JOIN, {
        code: this.join.session.code,
        pilotId: this.join.pilot.id,
        token: this.join.token,
      });
      if (!r.ok) throw new Error(r.error);
      this.session = r.data!.session;
      this.queue = this.queue.filter((p) => p.seq > r.data!.lastSeq);
    });
    this.socket.on(EV.STATE, (s: SessionSnapshot) => (this.session = s));
    await new Promise<void>((res) => this.socket.once('connect', () => setTimeout(res, 300)));
  }

  /** avança a física; dt em segundos */
  step(dt: number) {
    if (this.session.status !== 'RUNNING') return;
    const { curvature } = positionAt(this.d);
    const slow = Math.min(0.4, curvature * 0.15);
    const v = this.pace * (1 - slow) * (0.97 + rnd() * 0.06);
    this.d += v * dt;
  }

  sample() {
    if (this.session.status !== 'RUNNING') return;
    const p = positionAt(this.d);
    // GPS de celular: deriva lenta (≈3 m) + ruído branco (≈1,5 m)
    const g = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
    const a = Math.exp(-1 / (HZ * 30));
    this.ex = a * this.ex + NOISE * Math.sqrt(1 - a * a) * g();
    this.ey = a * this.ey + NOISE * Math.sqrt(1 - a * a) * g();
    const xy = toXY(circuit.origin, p.latLng);
    const ll = fromXY(circuit.origin, { x: xy.x + this.ex + g() * 1.5, y: xy.y + this.ey + g() * 1.5 });
    // o fix vem com a hora do GPS; o app converte para o relógio do celular e depois para o do servidor
    const gpsT = Date.now();
    const localT = this.fixTime.map(gpsT, this.sysNow() + 40 + Math.round(rnd() * 120));
    const { curvature } = p;
    const v = this.pace * (1 - Math.min(0.4, curvature * 0.15));
    this.queue.push({
      seq: this.seq++,
      t: this.clock.toServer(localT),
      lat: ll.lat,
      lng: ll.lng,
      speed: Math.round(v * 100) / 100,
      heading: Math.round(p.heading),
      accuracy: 3 + Math.round(rnd() * 3),
    });
  }

  async flush() {
    if (!this.online || !this.socket.connected || !this.queue.length) return;
    const batch = this.queue.slice(0, 500);
    try {
      const ack = await emitAck<PointsAck>(this.socket, EV.POINTS, { points: batch });
      if (ack.ok) this.queue = this.queue.filter((p) => p.seq > ack.lastSeq);
    } catch {
      /* sem ack: reenviará */
    }
  }

  goOffline(ms: number) {
    console.log(`📵 ${this.name} perdeu a conexão por ${ms / 1000}s (dados ficam no "celular")`);
    this.online = false;
    this.socket.disconnect();
    setTimeout(() => {
      console.log(`📶 ${this.name} voltou — sincronizando ${this.queue.length} pontos`);
      this.online = true;
      this.socket.connect();
    }, ms);
  }
}

async function main() {
  let host: SimKart | null = null;
  const karts: SimKart[] = [];

  if (JOIN) {
    for (let i = 0; i < KARTS; i++) {
      const j = await post<JoinResult>(`/api/sessions/${JOIN}/join`, { pilotName: `SIM ${NAMES[i % NAMES.length]}` });
      karts.push(new SimKart(j, i + 1));
    }
  } else {
    const created = await post<JoinResult>('/api/sessions', { trackName: TRACK, pilotName: NAMES[0] });
    host = new SimKart(created, 0);
    karts.push(host);
    for (let i = 1; i < KARTS; i++) {
      const j = await post<JoinResult>(`/api/sessions/${created.session.code}/join`, { pilotName: NAMES[i % NAMES.length] });
      karts.push(new SimKart(j, i));
    }
  }
  if (flag('pair') && karts.length > 1) {
    // dois "celulares" lado a lado no mesmo kart: o gap entre eles deve ser ~0
    karts[1].pace = karts[0].pace;
    karts[1].d = karts[0].d;
    karts[1].step = function (dt: number) {
      if (this.session.status === 'RUNNING') this.d = karts[0].d;
      void dt;
    };
  }
  const code = karts[0].join.session.code;
  for (const k of karts) await k.connect();

  console.log(`\n🏁 Sala ${code} com ${karts.length} karts simulados`);
  console.log(`   Dashboard: ${SERVER.replace(':3000', ':5173')}/s/${code}  (ou ${SERVER}/s/${code} com o build servido pelo backend)\n`);

  if (JOIN) {
    // alinha o circuito sintético à linha definida pelo celular real
    console.log('Aguardando o criador iniciar a corrida...');
    while (karts[0].session.status !== 'RUNNING' || !karts[0].session.line) await new Promise((r) => setTimeout(r, 500));
    const line = karts[0].session.line;
    circuit = buildCircuit({ lat: line.lat, lng: line.lng });
    rotation = line.bearing != null ? line.bearing - circuit.at(0).heading : 0;
  } else if (host) {
    await new Promise((r) => setTimeout(r, 1500));
    const start = positionAt(0);
    const r = await emitAck<Ack>(host.socket, EV.RACE_START, { lat: start.latLng.lat, lng: start.latLng.lng, speed: 0, heading: null });
    if (!r.ok) throw new Error(r.error);
    console.log('🟢 Largada! (o sentido da linha é definido quando o kart do criador se desloca)');
  }

  const t0 = Date.now();
  let lastSample = 0;
  let lastFlush = 0;
  let offlineDone = false;
  const PHYS_DT = 0.05;

  const timer = setInterval(async () => {
    const now = Date.now();
    for (const k of karts) k.step(PHYS_DT);
    if (now - lastSample >= 1000 / HZ) {
      lastSample = now;
      for (const k of karts) k.sample();
    }
    if (now - lastFlush >= 1000) {
      lastFlush = now;
      karts.forEach((k) => k.flush());
    }
    if (flag('offline') && !offlineDone && now - t0 > 40_000 && karts.length > 2) {
      offlineDone = true;
      karts[2].goOffline(12_000);
    }
    if (host && DURATION > 0 && now - t0 > DURATION * 1000) {
      clearInterval(timer);
      await Promise.all(karts.map((k) => k.flush()));
      await new Promise((r) => setTimeout(r, 1200));
      await Promise.all(karts.map((k) => k.flush()));
      const r = await emitAck<Ack>(host.socket, EV.RACE_FINISH, {});
      console.log(r.ok ? `🏁 Corrida encerrada. Relatório: ${SERVER}/api/sessions/${code}/report` : r.error);
      setTimeout(() => process.exit(0), 500);
    }
  }, PHYS_DT * 1000);

  karts[0].socket.on(EV.LAP, (e: { pilotId: string; lap: { number: number; timeMs: number }; sessionBest: boolean }) => {
    const k = karts.find((x) => x.join.pilot.id === e.pilotId);
    console.log(`⏱  ${k?.name ?? e.pilotId} volta ${e.lap.number}: ${(e.lap.timeMs / 1000).toFixed(3)}s${e.sessionBest ? '  ★ melhor da sessão' : ''}`);
  });
}

main().catch((e) => {
  console.error('Erro no simulador:', e.message ?? e);
  process.exit(1);
});
