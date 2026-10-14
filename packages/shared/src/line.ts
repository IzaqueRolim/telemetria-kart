import { LatLng, bearing, destination, haversine, toRad, toXY } from './geo';
import { GpsSample, StartFinishLine } from './types';

export const DEFAULT_LINE_HALF_WIDTH_M = 15;
/** Velocidade mínima (m/s) para confiar no heading do GPS ao criar a linha. */
export const MIN_SPEED_FOR_HEADING = 3;
/** Deslocamento mínimo (m) do kart do criador para inferir o sentido da linha. */
export const MIN_DISPLACEMENT_FOR_BEARING = 10;

/**
 * Cria a linha no ponto atual. Se o kart já estiver em movimento e o GPS
 * fornecer heading, o sentido é definido na hora; caso contrário fica pendente
 * e é resolvido por {@link resolveLineBearing} com os próximos pontos.
 */
export function createLine(
  at: { lat: number; lng: number; speed?: number | null; heading?: number | null },
  version: number,
  halfWidthM = DEFAULT_LINE_HALF_WIDTH_M,
): StartFinishLine {
  const hasHeading =
    at.heading != null && at.speed != null && at.speed >= MIN_SPEED_FOR_HEADING && at.heading >= 0;
  return {
    lat: at.lat,
    lng: at.lng,
    bearing: hasHeading ? (at.heading as number) : null,
    halfWidthM,
    version,
  };
}

/**
 * Determina o sentido de corrida a partir dos primeiros pontos do criador após
 * a largada. Prioriza o rumo Doppler do GPS (preciso quando há velocidade):
 * média circular dos 3 primeiros fixes acima de 2 m/s perto da linha. Sem isso,
 * usa o centróide dos pontos entre 12 e 40 m do centro — muito mais estável que
 * um único ponto, que com ruído de GPS pode apontar para o lado errado.
 */
export function resolveLineBearing(
  line: StartFinishLine,
  points: GpsSample[],
  fromT: number,
  minDisplacement = MIN_DISPLACEMENT_FOR_BEARING,
): number | null {
  if (line.bearing != null) return line.bearing;
  const near = points.filter((p) => p.t >= fromT && (p.accuracy == null || p.accuracy <= 25));

  // rumo Doppler dos primeiros fixes em movimento (até 80 m da linha — a 20 m/s e
  // 1 Hz só cabem 2 fixes nos primeiros 40 m)
  const headings: number[] = [];
  for (const p of near) {
    if (haversine(line, p) > 80) break;
    if (p.speed != null && p.speed >= 2 && p.heading != null && p.heading >= 0) headings.push(p.heading);
    if (headings.length >= 3) break;
  }
  const spread = (hs: number[]) => {
    let m = 0;
    for (const a of hs) for (const b of hs) m = Math.max(m, Math.min(Math.abs(a - b), 360 - Math.abs(a - b)));
    return m;
  };
  if (headings.length >= 3 || (headings.length === 2 && spread(headings) < 25)) {
    const sx = headings.reduce((a, h) => a + Math.sin((h * Math.PI) / 180), 0);
    const cy = headings.reduce((a, h) => a + Math.cos((h * Math.PI) / 180), 0);
    return ((Math.atan2(sx, cy) * 180) / Math.PI + 360) % 360;
  }

  const ring = near.filter((p) => {
    const d = haversine(line, p);
    return d >= Math.max(12, minDisplacement) && d <= 60;
  });
  if (ring.length < 3) return null;
  const pts = ring.slice(0, 6);
  const c = { lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lng: pts.reduce((a, p) => a + p.lng, 0) / pts.length };
  return bearing(line, c);
}

/** Média ponderada pela precisão de vários fixes parados (centro da linha mais estável). */
export function averageFix(fixes: Array<{ lat: number; lng: number; accuracy: number | null }>): { lat: number; lng: number; accuracy: number } | null {
  if (!fixes.length) return null;
  let w = 0;
  let lat = 0;
  let lng = 0;
  for (const f of fixes) {
    const a = Math.max(2, f.accuracy ?? 10);
    const wi = 1 / (a * a);
    w += wi;
    lat += f.lat * wi;
    lng += f.lng * wi;
  }
  return { lat: lat / w, lng: lng / w, accuracy: Math.sqrt(1 / w) };
}

/** Extremidades da linha (para desenhar no mapa). */
export function lineEndpoints(line: StartFinishLine): [LatLng, LatLng] | null {
  if (line.bearing == null) return null;
  const c = { lat: line.lat, lng: line.lng };
  return [destination(c, line.bearing - 90, line.halfWidthM), destination(c, line.bearing + 90, line.halfWidthM)];
}

export interface LineFrame {
  /** distância ao longo do sentido de corrida (positivo = depois da linha) */
  along: number;
  /** deslocamento lateral em relação ao centro da linha */
  lateral: number;
}

/** Coordenadas de um ponto no referencial da linha. */
export function toLineFrame(line: StartFinishLine, p: LatLng): LineFrame {
  const b = toRad(line.bearing ?? 0);
  const { x, y } = toXY(line, p);
  // vetor de direção (leste, norte) = (sin b, cos b); perpendicular à direita = (cos b, -sin b)
  return {
    along: x * Math.sin(b) + y * Math.cos(b),
    lateral: x * Math.cos(b) - y * Math.sin(b),
  };
}

export interface SegmentCrossing {
  /** fração [0,1] ao longo do segmento onde a linha foi cruzada */
  fraction: number;
  /** instante interpolado (ms) */
  t: number;
  lateral: number;
}

/**
 * Verifica se o segmento p0→p1 cruza a linha no sentido correto.
 * Cruzamentos no sentido contrário (ré, rodada, ruído) são ignorados.
 */
export function segmentCrossesLine(
  line: StartFinishLine,
  p0: GpsSample,
  p1: GpsSample,
  maxSegmentM = 250,
): SegmentCrossing | null {
  if (line.bearing == null) return null;
  const a = toLineFrame(line, p0);
  const b = toLineFrame(line, p1);
  if (!(a.along <= 0 && b.along > 0)) return null;
  if (b.along - a.along > maxSegmentM) return null;
  const fraction = a.along === b.along ? 0 : -a.along / (b.along - a.along);
  const lateral = a.lateral + fraction * (b.lateral - a.lateral);
  if (Math.abs(lateral) > line.halfWidthM) return null;
  return { fraction, t: Math.round(p0.t + fraction * (p1.t - p0.t)), lateral };
}
