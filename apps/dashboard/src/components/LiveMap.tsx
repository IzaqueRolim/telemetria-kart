import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LatLng, lineEndpoints, LivePosition, PilotInfo, StandingRow, StartFinishLine } from '@kart/shared';
import type { Theme } from '../lib/theme';
import { createTileLayer, MAP_STYLES, MapStyle, savedMapStyle, saveMapStyle } from '../lib/tiles';
const ANIM_MS = 520;
const TRAIL_MAX = 160;

interface MarkerState {
  marker: L.Marker;
  from: L.LatLng;
  to: L.LatLng;
  start: number;
  trail: L.LatLng[];
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
      const now = performance.now();
      for (const s of markers.current.values()) {
        const k = Math.min(1, (now - s.start) / ANIM_MS);
        if (k < 1 || !s.marker.getLatLng().equals(s.to)) {
          s.marker.setLatLng([s.from.lat + (s.to.lat - s.from.lat) * k, s.from.lng + (s.to.lng - s.from.lng) * k]);
        }
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
    const now = performance.now();
    const leader = standings[0]?.started ? standings[0].pilotId : null;
    const posOf = new Map(standings.map((r) => [r.pilotId, r.position]));
    const seen = new Set<string>();

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
        s = { marker, from: target, to: target, start: now, trail: [] };
        markers.current.set(p.id, s);
      } else if (!s.to.equals(target)) {
        s.from = s.marker.getLatLng();
        s.to = target;
        s.start = now;
      }
      s.trail.push(target);
      if (s.trail.length > TRAIL_MAX) s.trail.shift();

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
    if (fitted.current === 'none' && seen.size) {
      const b = L.latLngBounds([...markers.current.values()].map((s) => s.to));
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
