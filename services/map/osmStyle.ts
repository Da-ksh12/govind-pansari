import type { StyleSpecification } from '@maplibre/maplibre-react-native';

/**
 * Zero-key default tile source (section on map provider: "free/no-key
 * default now, upgrade later"). OpenStreetMap's own tile servers have
 * no SLA and a documented usage policy that discourages heavy
 * production traffic without a custom User-Agent/attribution — fine
 * for this app's current scale, called out in docs/map-architecture.md
 * as the first thing to swap (to a paid raster/vector tile provider)
 * before any real production volume. Swapping is changing this one
 * object, not any call site.
 */
export const osmMapStyle: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm-tiles',
      type: 'raster',
      source: 'osm',
    },
  ],
};
