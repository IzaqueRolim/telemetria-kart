import L from 'leaflet';
import type { Theme } from './theme';

/**
 * Fundos de mapa. Os padrões não exigem chave de API:
 *  - satellite: imagens de satélite da Esri (ótimo para ver o kartódromo)
 *  - map: OpenStreetMap (escurecido por filtro CSS no tema escuro)
 *  - none: só o traçado sobre fundo liso, estilo transmissão de F1
 *
 * Para usar um provedor com chave (MapTiler, Stadia, CARTO…), defina no
 * apps/dashboard/.env:
 *   VITE_TILE_URL_DARK=https://api.maptiler.com/maps/dataviz-dark/{z}/{x}/{y}.png?key=SUA_CHAVE
 *   VITE_TILE_URL_LIGHT=https://api.maptiler.com/maps/dataviz/{z}/{x}/{y}.png?key=SUA_CHAVE
 *   VITE_TILE_ATTRIBUTION=&copy; MapTiler &copy; OpenStreetMap
 * Com essas variáveis, a opção "map" passa a usar esse provedor.
 */
export type MapStyle = 'satellite' | 'map' | 'none';

export const MAP_STYLES: { id: MapStyle; label: string }[] = [
  { id: 'satellite', label: 'Satélite' },
  { id: 'map', label: 'Mapa' },
  { id: 'none', label: 'Só traçado' },
];

const env = import.meta.env as Record<string, string | undefined>;
const CUSTOM_DARK = env.VITE_TILE_URL_DARK;
const CUSTOM_LIGHT = env.VITE_TILE_URL_LIGHT ?? CUSTOM_DARK;
const CUSTOM_ATTRIB = env.VITE_TILE_ATTRIBUTION ?? '&copy; OpenStreetMap';

const ESRI_SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const KEY = 'kart-map-style';

export function savedMapStyle(): MapStyle {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'satellite' || v === 'map' || v === 'none') return v;
  } catch {
    /* storage indisponível */
  }
  return 'satellite';
}

export function saveMapStyle(s: MapStyle) {
  try {
    localStorage.setItem(KEY, s);
  } catch {
    /* ignora */
  }
}

/** Cria a camada de fundo (ou null para "só traçado"). */
export function createTileLayer(style: MapStyle, theme: Theme): L.TileLayer | null {
  if (style === 'none') return null;
  if (style === 'satellite') {
    return L.tileLayer(ESRI_SAT, {
      attribution: 'Imagens &copy; Esri, Maxar, Earthstar Geographics',
      maxZoom: 21,
      maxNativeZoom: 19,
    });
  }
  if (CUSTOM_DARK) {
    return L.tileLayer(theme === 'dark' ? CUSTOM_DARK : (CUSTOM_LIGHT as string), {
      attribution: CUSTOM_ATTRIB,
      maxZoom: 21,
      maxNativeZoom: 19,
    });
  }
  return L.tileLayer(OSM, {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 21,
    maxNativeZoom: 19,
    // tema escuro sem provedor pago: inverte as cores do OSM via CSS
    className: theme === 'dark' ? 'tiles-dark' : '',
  });
}
