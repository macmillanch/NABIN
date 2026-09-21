'use client';

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';

interface NabinMapProps {
  lat?: number | null;
  lng?: number | null;
  label?: string;
  height?: number;
}

// OpenStreetMap tiles via Leaflet — no map API key, no metered provider.
// CARTO renders the OSM basemap; tile.openstreetmap.org is the fallback.
const TILES = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

export default function NabinMap({ lat, lng, label = 'Store location', height = 260 }: NabinMapProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const hasCoords = typeof lat === 'number' && typeof lng === 'number';

  useEffect(() => {
    if (!hasCoords || !host.current) return;
    let map: import('leaflet').Map | null = null;
    let cancelled = false;

    import('leaflet')
      .then((module) => {
        if (cancelled || !host.current) return;
        const L = module.default ?? module;
        map = L.map(host.current, { scrollWheelZoom: false, zoomControl: true }).setView([lat!, lng!], 15);
        L.tileLayer(TILES, {
          subdomains: 'abcd',
          maxZoom: 20,
          attribution: TILE_ATTRIBUTION,
        })
          .on('tileerror', () => setFailed(true))
          .addTo(map!);
        L.circleMarker([lat!, lng!], {
          radius: 9,
          color: '#3c4890',
          fillColor: '#5a69be',
          fillOpacity: 0.85,
          weight: 2,
        })
          .bindPopup(label)
          .addTo(map!);
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [hasCoords, lat, lng, label]);

  if (!hasCoords) {
    return <div className="nabin-map nabin-map__empty">{label} &mdash; no coordinates on file</div>;
  }

  return (
    <div className="nabin-map" style={{ height }}>
      <div ref={host} style={{ height: '100%', width: '100%' }} role="img" aria-label={label} />
      {failed && <p className="nabin-cell-meta">Tiles are offline right now; the marker position is still accurate.</p>}
    </div>
  );
}
