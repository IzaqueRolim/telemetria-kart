import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Theme } from '../lib/theme';
import { createTileLayer, savedMapStyle } from '../lib/tiles';


function speedColor(k: number): string {
  // azul (lento) → verde → amarelo → vermelho (rápido)
  const stops = [
    [59, 130, 246],
    [34, 197, 94],
    [234, 179, 8],
    [239, 68, 68],
  ];
  const x = Math.max(0, Math.min(0.999, k)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const c = stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * f));
  return `rgb(${c.join(',')})`;
}

/** Traçado de uma volta colorido pela velocidade. */
export function TraceMap({ points, theme }: { points: Array<{ lat: number; lng: number; speed: number | null }>; theme: Theme }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current || points.length < 2) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: false });
    createTileLayer(savedMapStyle(), theme)?.addTo(m);
    const speeds = points.map((p) => p.speed ?? 0);
    const lo = Math.min(...speeds);
    const hi = Math.max(...speeds);
    for (let i = 1; i < points.length; i++) {
      const k = hi > lo ? (speeds[i] - lo) / (hi - lo) : 0.5;
      L.polyline(
        [
          [points[i - 1].lat, points[i - 1].lng],
          [points[i].lat, points[i].lng],
        ],
        { color: speedColor(k), weight: 6, lineCap: 'round' },
      ).addTo(m);
    }
    m.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [20, 20] });
    return () => {
      m.remove();
    };
  }, [points, theme]);
  return <div ref={el} className="mini-map" />;
}
