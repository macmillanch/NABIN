'use client';

import React, { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface GeofenceZone {
  id: string;
  name: string;
  code: string;
  serviceCategories: ('ride' | 'food' | 'grocery' | 'parcel')[];
  status: 'ACTIVE' | 'INACTIVE';
  description: string;
  coordinates: LatLngPoint[]; // minimum 3 points for polygon
  radiusMeters?: number; // optional for circle zones
  areaKm2: number;
  strokeColor: string;
  fillColor: string;
  createdAt: string;
  updatedAt: string;
}

interface GeofenceMapProps {
  zones: GeofenceZone[];
  selectedZoneId: string | null;
  onSelectZone: (zoneId: string) => void;
  isDrawing: boolean;
  drawingPoints: LatLngPoint[];
  onAddDrawingPoint: (point: LatLngPoint) => void;
  isEditingVertices: boolean;
  editingPoints: LatLngPoint[];
  onUpdateVertex: (index: number, newPoint: LatLngPoint) => void;
  onRemoveVertex: (index: number) => void;
  height?: string | number;
}

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export default function GeofenceMap({
  zones,
  selectedZoneId,
  onSelectZone,
  isDrawing,
  drawingPoints,
  onAddDrawingPoint,
  isEditingVertices,
  editingPoints,
  onUpdateVertex,
  onRemoveVertex,
  height = '620px',
}: GeofenceMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layersGroupRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drawingLayerGroupRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editingLayerGroupRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [cursorCoords, setCursorCoords] = useState<LatLngPoint | null>(null);

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;
    let cancelled = false;

    import('leaflet')
      .then((LModule) => {
        if (cancelled || !mapContainerRef.current) return;
        const L = LModule.default ?? LModule;

        // Default to documented service geography (Delhi NCR operational hub 28.6139, 77.2090)
        const initialLat = 28.6139;
        const initialLng = 77.209;
        const initialZoom = 12;

        const map = L.map(mapContainerRef.current, {
          center: [initialLat, initialLng],
          zoom: initialZoom,
          zoomControl: false,
        });

        // Add sleek zoom control at bottom right
        L.control.zoom({ position: 'bottomright' }).addTo(map);

        L.tileLayer(TILES, {
          maxZoom: 19,
          attribution: TILE_ATTRIBUTION,
        }).addTo(map);

        layersGroupRef.current = L.layerGroup().addTo(map);
        drawingLayerGroupRef.current = L.layerGroup().addTo(map);
        editingLayerGroupRef.current = L.layerGroup().addTo(map);

        map.on('mousemove', (e: { latlng: { lat: number; lng: number } }) => {
          setCursorCoords({ lat: Number(e.latlng.lat.toFixed(5)), lng: Number(e.latlng.lng.toFixed(5)) });
        });

        mapInstanceRef.current = map;
        setMapReady(true);
      })
      .catch((err) => {
        console.error('Failed to initialize Leaflet map:', err);
      });

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Handle map click for drawing mode
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleClick = (e: any) => {
      if (isDrawing) {
        onAddDrawingPoint({
          lat: Number(e.latlng.lat.toFixed(6)),
          lng: Number(e.latlng.lng.toFixed(6)),
        });
      }
    };

    if (isDrawing) {
      map.getContainer().style.cursor = 'crosshair';
      map.on('click', handleClick);
    } else {
      map.getContainer().style.cursor = '';
      map.off('click', handleClick);
    }

    return () => {
      map.off('click', handleClick);
    };
  }, [isDrawing, onAddDrawingPoint]);

  // Render Saved Zones
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !layersGroupRef.current) return;
    import('leaflet').then((LModule) => {
      const L = LModule.default ?? LModule;
      layersGroupRef.current.clearLayers();

      zones.forEach((zone) => {
        if (!zone.coordinates || zone.coordinates.length < 3) return;
        const latLngs: [number, number][] = zone.coordinates.map((c) => [c.lat, c.lng]);
        const isSelected = zone.id === selectedZoneId;

        const polygon = L.polygon(latLngs, {
          color: isSelected ? '#1A3BA2' : zone.strokeColor || '#2D5BDB',
          weight: isSelected ? 4 : 2,
          fillColor: zone.fillColor || zone.strokeColor || '#2D5BDB',
          fillOpacity: isSelected ? 0.4 : 0.2,
          dashArray: isSelected ? '6, 6' : undefined,
        });

        polygon.on('click', (e: { originalEvent: { stopPropagation: () => void } }) => {
          e.originalEvent.stopPropagation();
          onSelectZone(zone.id);
        });

        polygon.bindTooltip(
          `<strong>${zone.name}</strong><br/><span style="font-size:11px; color:#475569;">${zone.serviceCategories.join(', ').toUpperCase()} · ${zone.areaKm2.toFixed(2)} km²</span>`,
          { sticky: true, className: 'nabin-map-tooltip' }
        );

        layersGroupRef.current.addLayer(polygon);
      });
    });
  }, [zones, selectedZoneId, onSelectZone, mapReady]);

  // Render Active Drawing State
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !drawingLayerGroupRef.current) return;
    import('leaflet').then((LModule) => {
      const L = LModule.default ?? LModule;
      drawingLayerGroupRef.current.clearLayers();

      if (!isDrawing || drawingPoints.length === 0) return;

      const latLngs: [number, number][] = drawingPoints.map((p) => [p.lat, p.lng]);

      // Draw polyline connecting vertices
      if (drawingPoints.length > 1) {
        const polyline = L.polyline(latLngs, {
          color: '#1A3BA2',
          weight: 3,
          dashArray: '4, 4',
        });
        drawingLayerGroupRef.current.addLayer(polyline);
      }

      // If at least 3 points, show translucent polygon preview
      if (drawingPoints.length >= 3) {
        const previewPolygon = L.polygon(latLngs, {
          color: '#1A3BA2',
          weight: 1,
          fillColor: '#3E5CC4',
          fillOpacity: 0.25,
        });
        drawingLayerGroupRef.current.addLayer(previewPolygon);
      }

      // Draw markers for each point
      drawingPoints.forEach((point, index) => {
        const isStart = index === 0;
        const marker = L.circleMarker([point.lat, point.lng], {
          radius: isStart ? 8 : 6,
          color: isStart ? '#22A447' : '#1A3BA2',
          fillColor: '#FFFFFF',
          fillOpacity: 1,
          weight: 3,
        });

        marker.bindTooltip(isStart ? 'Start Point (Click to Close)' : `Point #${index + 1}`, {
          permanent: false,
          direction: 'top',
        });

        if (isStart && drawingPoints.length >= 3) {
          marker.on('click', (e: { originalEvent: { stopPropagation: () => void } }) => {
            e.originalEvent.stopPropagation();
            // User clicked start marker to close polygon
          });
        }

        drawingLayerGroupRef.current.addLayer(marker);
      });
    });
  }, [isDrawing, drawingPoints, mapReady]);

  // Render Draggable Editing Vertex Handles
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !editingLayerGroupRef.current) return;
    import('leaflet').then((LModule) => {
      const L = LModule.default ?? LModule;
      editingLayerGroupRef.current.clearLayers();

      if (!isEditingVertices || editingPoints.length === 0) return;

      // Draw active polygon for edited zone
      const latLngs: [number, number][] = editingPoints.map((p) => [p.lat, p.lng]);
      const editPolygon = L.polygon(latLngs, {
        color: '#E8590C',
        weight: 3,
        fillColor: '#F59E0B',
        fillOpacity: 0.25,
        dashArray: '5, 5',
      });
      editingLayerGroupRef.current.addLayer(editPolygon);

      // Add draggable handle for each vertex
      editingPoints.forEach((point, index) => {
        // Create custom draggable marker
        const handle = L.marker([point.lat, point.lng], {
          draggable: true,
          icon: L.divIcon({
            className: 'nabin-vertex-handle',
            html: `<div style="width:16px;height:16px;background:#FFFFFF;border:3px solid #E8590C;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:grab;"></div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          }),
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        handle.on('drag', (e: any) => {
          const newPos = e.target.getLatLng();
          onUpdateVertex(index, {
            lat: Number(newPos.lat.toFixed(6)),
            lng: Number(newPos.lng.toFixed(6)),
          });
        });

        // Tooltip with coordinates and delete prompt
        handle.bindTooltip(
          `Vertex #${index + 1}: ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}<br/><small style="color:#DC2626">Right-click to remove</small>`,
          { direction: 'top' }
        );

        // Right click to delete vertex
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        handle.on('contextmenu', (e: any) => {
          e.originalEvent.preventDefault();
          onRemoveVertex(index);
        });

        editingLayerGroupRef.current.addLayer(handle);
      });
    });
  }, [isEditingVertices, editingPoints, onUpdateVertex, onRemoveVertex, mapReady]);

  // Fit bounds helper when selected zone changes
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !selectedZoneId) return;
    const selected = zones.find((z) => z.id === selectedZoneId);
    if (!selected || selected.coordinates.length < 3) return;

    import('leaflet').then((LModule) => {
      const L = LModule.default ?? LModule;
      const boundsCoords: [number, number][] = selected.coordinates.map((c) => [c.lat, c.lng]);
      const bounds = L.latLngBounds(boundsCoords);
      mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    });
  }, [selectedZoneId, zones, mapReady]);

  const fitAllZones = () => {
    if (!mapInstanceRef.current || zones.length === 0) return;
    import('leaflet').then((LModule) => {
      const L = LModule.default ?? LModule;
      const allCoords: [number, number][] = [];
      zones.forEach((z) => {
        z.coordinates.forEach((c) => allCoords.push([c.lat, c.lng]));
      });
      if (allCoords.length > 0) {
        const bounds = L.latLngBounds(allCoords);
        mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50] });
      }
    });
  };

  const centerDelhiHub = () => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.setView([28.6139, 77.2090], 12);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height, borderRadius: 12, overflow: 'hidden' }}>
      <div
        ref={mapContainerRef}
        style={{ width: '100%', height: '100%', zIndex: 1 }}
        role="region"
        aria-label="Interactive Geofencing Service Zone Map"
      />

      {/* Floating Basemap Controls Overlay */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          right: 14,
          zIndex: 1000,
          display: 'flex',
          gap: 8,
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(8px)',
          padding: '6px 10px',
          borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
          border: '1px solid rgba(226, 232, 240, 0.8)',
        }}
      >
        <button
          type="button"
          onClick={fitAllZones}
          title="Fit view to all active service zones"
          style={{
            background: '#F1F5F9',
            border: '1px solid #CBD5E1',
            borderRadius: 6,
            padding: '5px 10px',
            fontSize: 12,
            fontWeight: 600,
            color: '#1E293B',
            cursor: 'pointer',
          }}
        >
          Fit All Zones
        </button>
        <button
          type="button"
          onClick={centerDelhiHub}
          title="Reset map view to Delhi NCR operational hub"
          style={{
            background: '#F1F5F9',
            border: '1px solid #CBD5E1',
            borderRadius: 6,
            padding: '5px 10px',
            fontSize: 12,
            fontWeight: 600,
            color: '#1E293B',
            cursor: 'pointer',
          }}
        >
          Reset View
        </button>
      </div>

      {/* Real-time Cursor Coordinates Bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: 12,
          zIndex: 1000,
          background: 'rgba(15, 23, 42, 0.82)',
          backdropFilter: 'blur(6px)',
          color: '#F8FAFC',
          padding: '4px 10px',
          borderRadius: 6,
          fontSize: 11,
          fontFamily: 'monospace',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        <span>📍</span>
        <span>
          {cursorCoords ? `LAT: ${cursorCoords.lat.toFixed(5)}  |  LNG: ${cursorCoords.lng.toFixed(5)}` : 'Move cursor over map'}
        </span>
        {isDrawing && (
          <span style={{ color: '#4ADE80', fontWeight: 'bold', marginLeft: 6 }}>
            · DRAWING MODE (Click map to add points)
          </span>
        )}
        {isEditingVertices && (
          <span style={{ color: '#FBBF24', fontWeight: 'bold', marginLeft: 6 }}>
            · EDITING VERTICES (Drag points to reshape)
          </span>
        )}
      </div>
    </div>
  );
}
