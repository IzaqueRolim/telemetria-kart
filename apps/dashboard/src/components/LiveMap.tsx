import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LatLng, lineEndpoints, LivePosition, PilotInfo, StandingRow, StartFinishLine } from '@kart/shared';
import type { Theme } from '../lib/theme';
import { createTileLayer, MAP_STYLES, MapStyle, savedMapStyle, saveMapStyle } from '../lib/tiles';
const TRAIL_MAX = 160;
/** quanto do histórico de pontos de cada kart fica na memória (ms) */
const BUFFER_MS = 15_000;
/** limites do atraso de reprodução (ms) */
const DELAY_MIN = 400;
const DELAY_MAX = 4000;
/** extrapola no máximo isto além do último ponto antes de parar o kart (ms) */
const EXTRAPOLATE_MS = 400;

interface Sample {
  t: number;
  lat: number;
  lng: number;
}

interface MarkerState {
  marker: L.Marker;
  /** pontos recebidos, em ordem de t (relógio do servidor) */
  buf: Sample[];
  stale: boolean;
  trail: L.LatLng[];
}

/**
 * Reprodução com atraso ("entity interpolation", como em jogos online): os
 * pontos chegam em lotes a cada ~0,5–1 s, então o mapa mostra cada kart um pouco
 * no passado e anda continuamente entre as amostras. O atraso se ajusta ao maior
 * atraso de chegada visto nos últimos segundos e é o mesmo para todos os karts,
 * para que a distância entre eles no mapa seja a real.
 */
class Playback {
  /** amostras de (relógio do servidor − Date.now()) para estimar o relógio do servidor */
  private offsets: { at: number; v: number }[] = [];
  private lags: { at: number; v: number }[] = [];
  private delay = 1500;
  private lastFrame = 0;
  offset = 0;

  observe(serverTime: number, lagMs: number[]) {
    const at = Date.now();
    this.offsets.push({ at, v: serverTime - at });
    this.offsets = this.offsets.filter((o) => at - o.at < 30_000);
    // maior offset = mensagem que chegou mais rápido (menos atraso de rede)
    this.offset = Math.max(...this.offsets.map((o) => o.v));
    for (const v of lagMs) this.lags.push({ at, v });
    this.lags = this.lags.filter((o) => at - o.at < 10_000);
  }

  /** instante (relógio do servidor) a desenhar neste quadro */
  renderTime(): number {
    const now = Date.now();
    const dt = this.lastFrame ? Math.min(100, now - this.lastFrame) : 0;
    this.lastFrame = now;
    const target = this.lags.length
      ? Math.max(DELAY_MIN, Math.min(DELAY_MAX, Math.max(...this.lags.map((o) => o.v)) + 150))
      : this.delay;
    // muda o atraso devagar (no máx. 15% da velocidade) para o movimento não dar trancos
    const step = 0.15 * dt;
    this.delay += Math.max(-step, Math.min(step, target - this.delay));
    return now + this.offset - this.delay;
  }
}

function catmull(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

/** posição do kart no instante t: curva suave pelos pontos (segue a curva da pista melhor que uma reta) */
function sampleAt(buf: Sample[], t: number, hold: boolean): [number, number] | null {
  const n = buf.length;
  if (!n) return null;
  const last = buf[n - 1];
  if (t >= last.t || n === 1) {
    if (hold || n === 1) return [last.lat, last.lng];
    const prev = buf[n - 2];
    const span = last.t - prev.t;
    if (span <= 0 || span > 3000) return [last.lat, last.lng];
    const k = Math.min(t - last.t, EXTRAPOLATE_MS) / span;
    return [last.lat + (last.lat - prev.lat) * k, last.lng + (last.lng - prev.lng) * k];
  }
  if (t <= buf[0].t) return [buf[0].lat, buf[0].lng];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (buf[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = buf[lo];
  const b = buf[hi];
  const u = (t - a.t) / (b.t - a.t || 1);
  // buraco grande (sinal perdido): vai em linha reta, a curva poderia "inventar" trajetória
  if (b.t - a.t > 3000) return [a.lat + (b.lat - a.lat) * u, a.lng + (b.lng - a.lng) * u];
  const p0 = buf[Math.max(0, lo - 1)];
  const p3 = buf[Math.min(n - 1, hi + 1)];
  return [catmull(p0.lat, a.lat, b.lat, p3.lat, u), catmull(p0.lng, a.lng, b.lng, p3.lng, u)];
}

interface Props {
  theme: Theme;
  trackPath: LatLng[] | null;
  line: StartFinishLine | null;
  pilots: PilotInfo[];
  positions: Record<string, LivePosition>;
  standings: StandingRow[];
  selected?: string | null;
  onSelect?: (pilotId: string) => void;
}

/**
 * Mapa ao vivo estilo telemetria de F1: traçado do circuito, linha de chegada
 * quadriculada e karts interpolados suavemente entre as amostras de GPS.
 */
export function LiveMap({ theme, trackPath, line, pilots, positions, standings, selected, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const trackLayer = useRef<L.LayerGroup | null>(null);
  const lineLayer = useRef<L.LayerGroup | null>(null);
  const trailLayer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<string, MarkerState>());
  const fitted = useRef<'none' | 'karts' | 'track'>('none');
  const raf = useRef<number>(0);
  const playback = useRef(new Playback());
  const [style, setStyle] = useState<MapStyle>(savedMapStyle);

  // inicialização
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, zoomSnap: 0.25 });
    m.setView([-15.78, -47.93], 4);
    L.control.zoom({ position: 'topright' }).addTo(m);
    trackLayer.current = L.layerGroup().addTo(m);
    trailLayer.current = L.layerGroup().addTo(m);
    lineLayer.current = L.layerGroup().addTo(m);
    map.current = m;

    const loop = () => {
      const t = playback.current.renderTime();
      for (const s of markers.current.values()) {
        const p = sampleAt(s.buf, t, s.stale);
        if (p) s.marker.setLatLng(p);
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      cancelAnimationFrame(raf.current);
      ro.disconnect();
      m.remove();
      map.current = null;
      markers.current.clear();
      fitted.current = 'none';
    };
  }, []);

  // fundo do mapa (satélite / mapa / só traçado)
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    tiles.current?.remove();
    tiles.current = createTileLayer(style, theme);
    if (tiles.current) {
      tiles.current.addTo(m);
      tiles.current.bringToBack();
    }
    saveMapStyle(style);
  }, [theme, style]);

  // traçado do circuito
  useEffect(() => {
    const m = map.current;
    const g = trackLayer.current;
    if (!m || !g) return;
    g.clearLayers();
    if (!trackPath || trackPath.length < 2) return;
    const pts = trackPath.map((p) => [p.lat, p.lng] as [number, number]);
    const dark = theme === 'dark';
    L.polyline(pts, { color: dark ? '#1f2b38' : '#c5d0dc', weight: 22, lineCap: 'round', lineJoin: 'round' }).addTo(g);
    L.polyline(pts, { color: dark ? '#e9eff6' : '#0b1118', weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(g);
    if (fitted.current !== 'track') {
      m.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
      fitted.current = 'track';
    }
  }, [trackPath, theme]);

  // linha de largada/chegada (quadriculada)
  useEffect(() => {
    const g = lineLayer.current;
    if (!g) return;
    g.clearLayers();
    if (!line) return;
    const ends = lineEndpoints(line);
    if (ends) {
      const pts = ends.map((p) => [p.lat, p.lng] as [number, number]);
      L.polyline(pts, { color: '#ffffff', weight: 7, opacity: 1 }).addTo(g);
      L.polyline(pts, { color: '#05080d', weight: 7, dashArray: '4 4' }).addTo(g);
    } else {
      L.circleMarker([line.lat, line.lng], { radius: 7, color: '#f59e0b', weight: 3, fillOpacity: 0.3 })
        .bindTooltip('Linha de largada (aguardando direção)')
        .addTo(g);
    }
  }, [line]);

  // karts
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const leader = standings[0]?.started ? standings[0].pilotId : null;
    const posOf = new Map(standings.map((r) => [r.pilotId, r.position]));
    const seen = new Set<string>();
    let serverTime = -Infinity;
    const lags: number[] = [];
    for (const pos of Object.values(positions)) serverTime = Math.max(serverTime, pos.t + pos.ageMs);

    for (const p of pilots) {
      const pos = positions[p.id];
      if (!pos) continue;
      seen.add(p.id);
      const target = L.latLng(pos.lat, pos.lng);
      let s = markers.current.get(p.id);
      if (!s) {
        const icon = L.divIcon({
          className: '',
          html: `<div class="kart-marker" style="--c:${p.color}"><span>${p.number}</span><label></label></div>`,
          iconSize: [0, 0],
        });
        const marker = L.marker(target, { icon, keyboard: false }).addTo(m);
        marker.on('click', () => onSelect?.(p.id));
        s = { marker, buf: [], stale: pos.stale, trail: [] };
        markers.current.set(p.id, s);
      }
      // junta os pontos novos ao histórico do kart
      const incoming: Sample[] = pos.recent?.length ? pos.recent.map(([t, lat, lng]) => ({ t, lat, lng })) : [{ t: pos.t, lat: pos.lat, lng: pos.lng }];
      const lastT = s.buf.length ? s.buf[s.buf.length - 1].t : -Infinity;
      const added = incoming.filter((x) => x.t > lastT);
      if (added.length) {
        s.buf.push(...added);
        const cut = s.buf[s.buf.length - 1].t - BUFFER_MS;
        while (s.buf.length > 2 && s.buf[0].t < cut) s.buf.shift();
        s.trail.push(target);
        if (s.trail.length > TRAIL_MAX) s.trail.shift();
      }
      s.stale = pos.stale;
      if (!pos.stale) lags.push(pos.ageMs);

      const node = s.marker.getElement()?.querySelector('.kart-marker') as HTMLElement | null;
      if (node) {
        node.classList.toggle('stale', pos.stale);
        node.classList.toggle('leader', p.id === leader);
        const label = node.querySelector('label');
        const place = posOf.get(p.id);
        if (label) label.textContent = `${place ? `P${place} ` : ''}${p.name}`;
        node.style.outline = selected === p.id ? '3px solid var(--accent)' : '';
      }
      s.marker.setZIndexOffset(p.id === leader ? 1000 : selected === p.id ? 900 : 0);
    }
    for (const [id, s] of markers.current) {
      if (!seen.has(id)) {
        s.marker.remove();
        markers.current.delete(id);
      }
    }

    // sem traçado ainda: mostra rastros e enquadra os karts
    const tl = trailLayer.current;
    if (tl) {
      tl.clearLayers();
      if (!trackPath) {
        for (const p of pilots) {
          const s = markers.current.get(p.id);
          if (s && s.trail.length > 1) L.polyline(s.trail, { color: p.color, weight: 3, opacity: 0.55 }).addTo(tl);
        }
      }
    }
    if (Number.isFinite(serverTime)) playback.current.observe(serverTime, lags);

    if (fitted.current === 'none' && seen.size) {
      const b = L.latLngBounds(
        [...markers.current.values()].filter((s) => s.buf.length).map((s) => {
          const l = s.buf[s.buf.length - 1];
          return L.latLng(l.lat, l.lng);
        }),
      );
      m.fitBounds(b.pad(1.5), { maxZoom: 18 });
      fitted.current = 'karts';
    }
  }, [positions, pilots, standings, selected, trackPath, onSelect]);

  return (
    <>
      <div ref={el} className="map" />
      <div className="map-overlay map-style">
        {MAP_STYLES.map((o) => (
          <button key={o.id} className={`chip${style === o.id ? ' on' : ''}`} onClick={() => setStyle(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </>
  );
}
