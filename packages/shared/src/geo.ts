/**
 * Utilitários geodésicos. Para distâncias de kartódromo (< 2 km) uma projeção
 * local equiretangular é precisa ao centímetro e muito mais barata que a
 * geodésia completa — é ela que usamos para cruzamento de linha.
 */

export const EARTH_RADIUS_M = 6371008.8;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface XY {
  x: number; // metros para leste
  y: number; // metros para norte
}

const DEG = Math.PI / 180;

export function toRad(deg: number): number {
  return deg * DEG;
}

export function toDeg(rad: number): number {
  return rad / DEG;
}

/** Distância em metros (haversine). */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Rumo inicial de a para b, em graus [0, 360) a partir do norte. */
export function bearing(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Ponto a `distM` metros de `p` no rumo `bearingDeg`. */
export function destination(p: LatLng, bearingDeg: number, distM: number): LatLng {
  const δ = distM / EARTH_RADIUS_M;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(p.lat);
  const λ1 = toRad(p.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lng: ((toDeg(λ2) + 540) % 360) - 180 };
}

/** Projeção local (metros) relativa a `origin`. */
export function toXY(origin: LatLng, p: LatLng): XY {
  const x = toRad(p.lng - origin.lng) * EARTH_RADIUS_M * Math.cos(toRad(origin.lat));
  const y = toRad(p.lat - origin.lat) * EARTH_RADIUS_M;
  return { x, y };
}

export function fromXY(origin: LatLng, xy: XY): LatLng {
  return {
    lat: origin.lat + toDeg(xy.y / EARTH_RADIUS_M),
    lng: origin.lng + toDeg(xy.x / (EARTH_RADIUS_M * Math.cos(toRad(origin.lat)))),
  };
}

export function msToKmh(ms: number): number {
  return ms * 3.6;
}
