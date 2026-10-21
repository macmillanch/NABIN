'use client';

import React, { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import AdminLayout from '@/components/AdminLayout';
import {
  MapPin,
  Plus,
  Trash2,
  Edit3,
  Layers,
  Search,
  CheckCircle,
  AlertCircle,
  X,
  RefreshCw,
  Info,
} from 'lucide-react';
import type { GeofenceZone, LatLngPoint } from '@/components/GeofenceMap';

// Dynamically import GeofenceMap with SSR disabled to guarantee Leaflet only runs in browser
const GeofenceMap = dynamic(() => import('@/components/GeofenceMap'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: '620px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F8FAFC',
        borderRadius: 12,
        border: '1px solid #E2E8F0',
        color: '#64748B',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <MapPin size={32} style={{ margin: '0 auto 10px', color: '#1A3BA2' }} />
        <p style={{ fontWeight: 600 }}>Loading OpenStreetMap Leaflet Engine...</p>
      </div>
    </div>
  ),
});

// Geodesic area calculation for polygon coordinates in km²
function calculatePolygonAreaKm2(coords: LatLngPoint[]): number {
  if (coords.length < 3) return 0;
  const R = 6378137; // Earth radius in meters
  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    const p1 = coords[i];
    const p2 = coords[j];
    const lat1 = (p1.lat * Math.PI) / 180;
    const lat2 = (p2.lat * Math.PI) / 180;
    const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
    area += dLng * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  area = Math.abs((area * R * R) / 4);
  return Number((area / 1_000_000).toFixed(2));
}

// Sample Demo Service Zones (Documented Operational Geography: Delhi NCR)
const INITIAL_DEMO_ZONES: GeofenceZone[] = [
  {
    id: 'zone-del-cp',
    name: 'Connaught Place Commercial Core [Demo Zone]',
    code: 'DEMO-ZONE-CBD-01',
    serviceCategories: ['ride', 'food', 'parcel'],
    status: 'ACTIVE',
    description: 'High-density central business and retail district covering Connaught Place and outer ring (Sample Demo Data).',
    coordinates: [
      { lat: 28.6350, lng: 77.2150 },
      { lat: 28.6350, lng: 77.2250 },
      { lat: 28.6250, lng: 77.2250 },
      { lat: 28.6250, lng: 77.2150 },
    ],
    areaKm2: 1.08,
    strokeColor: '#1A3BA2',
    fillColor: '#1A3BA2',
    createdAt: '2026-09-15T08:00:00Z',
    updatedAt: '2026-10-01T12:00:00Z',
  },
  {
    id: 'zone-del-cybercity',
    name: 'Cyber City DLF Corridor [Demo Zone]',
    code: 'DEMO-ZONE-TECH-02',
    serviceCategories: ['ride', 'food', 'grocery'],
    status: 'ACTIVE',
    description: 'Technology corridor and corporate office cluster (Sample Demo Data).',
    coordinates: [
      { lat: 28.4900, lng: 77.0850 },
      { lat: 28.4950, lng: 77.0950 },
      { lat: 28.4850, lng: 77.0950 },
      { lat: 28.4800, lng: 77.0850 },
    ],
    areaKm2: 0.98,
    strokeColor: '#E8590C',
    fillColor: '#E8590C',
    createdAt: '2026-09-18T10:00:00Z',
    updatedAt: '2026-10-02T15:30:00Z',
  },
  {
    id: 'zone-del-airport',
    name: 'IGI Airport Terminal 3 Corridor [Demo Zone]',
    code: 'DEMO-ZONE-AIRPORT-03',
    serviceCategories: ['ride', 'parcel'],
    status: 'ACTIVE',
    description: 'Airport toll transit corridor and terminal priority queue (Sample Demo Data).',
    coordinates: [
      { lat: 28.5650, lng: 77.0850 },
      { lat: 28.5700, lng: 77.1150 },
      { lat: 28.5450, lng: 77.1200 },
      { lat: 28.5400, lng: 77.0900 },
    ],
    areaKm2: 6.42,
    strokeColor: '#2D5BDB',
    fillColor: '#2D5BDB',
    createdAt: '2026-09-20T11:00:00Z',
    updatedAt: '2026-10-04T09:15:00Z',
  },
  {
    id: 'zone-del-south',
    name: 'South Delhi Residential Cluster [Demo Zone]',
    code: 'DEMO-ZONE-RES-04',
    serviceCategories: ['food', 'grocery', 'parcel'],
    status: 'ACTIVE',
    description: 'Residential quick-commerce and food delivery fulfillment zone (Sample Demo Data).',
    coordinates: [
      { lat: 28.5500, lng: 77.2000 },
      { lat: 28.5550, lng: 77.2350 },
      { lat: 28.5300, lng: 77.2300 },
      { lat: 28.5250, lng: 77.1950 },
    ],
    areaKm2: 7.55,
    strokeColor: '#12A150',
    fillColor: '#12A150',
    createdAt: '2026-09-25T14:00:00Z',
    updatedAt: '2026-10-05T11:45:00Z',
  },
];

export default function GeofencingPage() {
  const [zones, setZones] = useState<GeofenceZone[]>(INITIAL_DEMO_ZONES);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>('zone-del-cp');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('ALL');

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingPoints, setDrawingPoints] = useState<LatLngPoint[]>([]);

  // Editing state
  const [isEditingVertices, setIsEditingVertices] = useState(false);
  const [editingPoints, setEditingPoints] = useState<LatLngPoint[]>([]);

  // Zone Form State (for creating / editing zone metadata)
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formCategories, setFormCategories] = useState<('ride' | 'food' | 'grocery' | 'parcel')[]>([
    'ride',
    'food',
    'grocery',
    'parcel',
  ]);
  const [formStatus, setFormStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [formValidationError, setFormValidationError] = useState<string | null>(null);

  // Deletion Confirmation Modal
  const [zoneToDelete, setZoneToDelete] = useState<GeofenceZone | null>(null);

  // Success / Notice Toast
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const selectedZone = useMemo(() => zones.find((z) => z.id === selectedZoneId) || null, [zones, selectedZoneId]);

  // Filtered zones list
  const filteredZones = useMemo(() => {
    return zones.filter((z) => {
      const matchesSearch =
        z.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        z.code.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory =
        filterCategory === 'ALL' ||
        (filterCategory === 'ACTIVE' && z.status === 'ACTIVE') ||
        (filterCategory === 'INACTIVE' && z.status === 'INACTIVE') ||
        z.serviceCategories.includes(filterCategory.toLowerCase() as ('ride' | 'food' | 'grocery' | 'parcel'));
      return matchesSearch && matchesCategory;
    });
  }, [zones, searchQuery, filterCategory]);

  // Start Drawing a New Polygon
  const handleStartDrawing = () => {
    setIsCreatingNew(true);
    setSelectedZoneId(null);
    setIsEditingVertices(false);
    setIsDrawing(true);
    setDrawingPoints([]);
    setFormName('');
    setFormCode(`DEMO-ZONE-0${zones.length + 1}`);
    setFormDesc('');
    setFormCategories(['ride', 'food', 'grocery', 'parcel']);
    setFormStatus('ACTIVE');
    setFormValidationError(null);
    setNotice({ text: 'Drawing Mode Activated: Click anywhere on the map to place boundary vertices.', ok: true });
  };

  // Add a point to current drawing
  const handleAddDrawingPoint = (point: LatLngPoint) => {
    setDrawingPoints((prev) => [...prev, point]);
    setFormValidationError(null);
  };

  // Cancel Drawing / Editing
  const handleCancel = () => {
    setIsDrawing(false);
    setIsEditingVertices(false);
    setIsCreatingNew(false);
    setDrawingPoints([]);
    setEditingPoints([]);
    setFormValidationError(null);
    if (zones.length > 0 && !selectedZoneId) {
      setSelectedZoneId(zones[0].id);
    }
  };

  // Start editing existing zone's vertices
  const handleStartEditingVertices = (zone: GeofenceZone) => {
    setSelectedZoneId(zone.id);
    setIsCreatingNew(false);
    setIsDrawing(false);
    setIsEditingVertices(true);
    setEditingPoints([...zone.coordinates]);
    setNotice({
      text: `Editing vertices for "${zone.name}": Drag circular handles on the map to adjust boundaries.`,
      ok: true,
    });
  };

  // Update a single vertex from dragging
  const handleUpdateVertex = (index: number, newPoint: LatLngPoint) => {
    setEditingPoints((prev) => {
      const updated = [...prev];
      updated[index] = newPoint;
      return updated;
    });
  };

  // Remove a vertex
  const handleRemoveVertex = (index: number) => {
    if (editingPoints.length <= 3) {
      setNotice({ text: 'A service zone boundary requires a minimum of 3 vertices.', ok: false });
      return;
    }
    setEditingPoints((prev) => prev.filter((_, i) => i !== index));
    setNotice({ text: `Removed vertex #${index + 1}.`, ok: true });
  };

  // Save Vertex Edits
  const handleSaveVertexEdits = () => {
    if (!selectedZoneId) return;
    if (editingPoints.length < 3) {
      setFormValidationError('Polygon requires at least 3 coordinates.');
      return;
    }
    const newArea = calculatePolygonAreaKm2(editingPoints);
    setZones((prev) =>
      prev.map((z) =>
        z.id === selectedZoneId
          ? {
              ...z,
              coordinates: editingPoints,
              areaKm2: newArea,
              updatedAt: new Date().toISOString(),
            }
          : z
      )
    );
    setIsEditingVertices(false);
    setEditingPoints([]);
    setNotice({ text: 'Updated service zone boundaries successfully in local preview state.', ok: true });
  };

  // Save Newly Drawn Zone
  const handleSaveNewZone = () => {
    if (!formName.trim()) {
      setFormValidationError('Zone name is required.');
      return;
    }
    if (drawingPoints.length < 3) {
      setFormValidationError('At least 3 boundary vertices are required to form a closed polygon.');
      return;
    }
    if (formCategories.length === 0) {
      setFormValidationError('Select at least one applicable service category.');
      return;
    }

    const area = calculatePolygonAreaKm2(drawingPoints);
    const newZone: GeofenceZone = {
      id: `zone-${Date.now()}`,
      name: formName.trim(),
      code: formCode.trim() || `Z-NEW-${zones.length + 1}`,
      serviceCategories: formCategories,
      status: formStatus,
      description: formDesc.trim() || 'Service coverage polygon boundary.',
      coordinates: drawingPoints,
      areaKm2: area,
      strokeColor: formCategories.includes('food') ? '#E8590C' : '#1A3BA2',
      fillColor: formCategories.includes('food') ? '#E8590C' : '#1A3BA2',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setZones((prev) => [newZone, ...prev]);
    setSelectedZoneId(newZone.id);
    setIsDrawing(false);
    setIsCreatingNew(false);
    setDrawingPoints([]);
    setNotice({
      text: `Created new zone "${newZone.name}" (${area} km²) in local demo preview!`,
      ok: true,
    });
  };

  // Toggle active status
  const handleToggleStatus = (zoneId: string) => {
    setZones((prev) =>
      prev.map((z) => (z.id === zoneId ? { ...z, status: z.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } : z))
    );
  };

  // Delete Zone
  const handleConfirmDelete = () => {
    if (!zoneToDelete) return;
    setZones((prev) => prev.filter((z) => z.id !== zoneToDelete.id));
    if (selectedZoneId === zoneToDelete.id) {
      setSelectedZoneId(zones.find((z) => z.id !== zoneToDelete.id)?.id || null);
    }
    setZoneToDelete(null);
    setNotice({ text: `Zone "${zoneToDelete.name}" removed from local preview state.`, ok: true });
  };

  // Toggle category in form
  const handleToggleCategory = (cat: 'ride' | 'food' | 'grocery' | 'parcel') => {
    setFormCategories((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  };

  return (
    <AdminLayout title="Geofencing & Service Zones">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Top Header Bar & Demo Notice */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            background: '#FFFFFF',
            padding: '18px 24px',
            borderRadius: 12,
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  background: '#E9EEF9',
                  color: '#1A3BA2',
                  padding: '6px',
                  borderRadius: 8,
                  display: 'inline-flex',
                }}
              >
                <MapPin size={22} />
              </span>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', margin: 0 }}>
                Geofencing & Service-Zone Management
              </h1>
              <span
                style={{
                  background: '#FEF3C7',
                  color: '#92400E',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: 999,
                  border: '1px solid #FCD34D',
                }}
              >
                DEMO PREVIEW · UI ONLY
              </span>
            </div>
            <p style={{ fontSize: 13, color: '#64748B', margin: '6px 0 0', maxWidth: '780px' }}>
              Define, inspect, and reshape geographic operational boundaries for Ride-Hailing, Food Delivery, Quick
              Commerce, and Parcel Express using high-precision OpenStreetMap Leaflet vectors.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {!isDrawing && !isEditingVertices && (
              <button
                type="button"
                onClick={handleStartDrawing}
                style={{
                  background: '#1A3BA2',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 8,
                  padding: '10px 18px',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 2px 8px rgba(26, 59, 162, 0.25)',
                }}
              >
                <Plus size={18} />
                <span>Draw New Zone</span>
              </button>
            )}
          </div>
        </div>

        {/* Feedback Alert Toast */}
        {notice && (
          <div
            style={{
              background: notice.ok ? '#F0FDF4' : '#FEF2F2',
              border: `1px solid ${notice.ok ? '#86EFAC' : '#FCA5A5'}`,
              color: notice.ok ? '#166534' : '#991B1B',
              padding: '10px 16px',
              borderRadius: 8,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {notice.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              <span>{notice.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setNotice(null)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit' }}
            >
              <X size={15} />
            </button>
          </div>
        )}

        {/* Main Workspace Grid: Map Workspace + Zone Management & Editor Panel */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.85fr) minmax(360px, 1.15fr)',
            gap: 20,
            alignItems: 'start',
          }}
          className="nabin-geofencing-grid"
        >
          {/* Left Column: Interactive Map & Map Controls */}
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: 12,
              border: '1px solid #E2E8F0',
              padding: 16,
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Layers size={18} style={{ color: '#1A3BA2' }} />
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#1E293B' }}>
                  Interactive Service Boundary Map
                </h3>
                <span
                  style={{
                    fontSize: 11,
                    background: '#F1F5F9',
                    color: '#475569',
                    padding: '2px 8px',
                    borderRadius: 6,
                    fontWeight: 600,
                  }}
                >
                  {zones.length} Zones Registered
                </span>
              </div>

              {/* Map Legend */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, fontWeight: 600 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 10, height: 10, background: '#1A3BA2', borderRadius: 2 }} />
                  Ride / Multi
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 10, height: 10, background: '#E8590C', borderRadius: 2 }} />
                  Food
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 10, height: 10, background: '#12A150', borderRadius: 2 }} />
                  Grocery
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 10, height: 10, background: '#2D5BDB', borderRadius: 2 }} />
                  Transit
                </span>
              </div>
            </div>

            {/* The Actual Leaflet Map Canvas */}
            <GeofenceMap
              zones={zones}
              selectedZoneId={selectedZoneId}
              onSelectZone={(id) => {
                setSelectedZoneId(id);
                setIsDrawing(false);
                setIsEditingVertices(false);
                setIsCreatingNew(false);
              }}
              isDrawing={isDrawing}
              drawingPoints={drawingPoints}
              onAddDrawingPoint={handleAddDrawingPoint}
              isEditingVertices={isEditingVertices}
              editingPoints={editingPoints}
              onUpdateVertex={handleUpdateVertex}
              onRemoveVertex={handleRemoveVertex}
              height={620}
            />

            {/* Active Drawing / Vertex Editing Bar */}
            {isDrawing && (
              <div
                style={{
                  background: '#F8FAFC',
                  border: '1px solid #CBD5E1',
                  borderRadius: 8,
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1A3BA2' }}>
                    Active Polygon Drawing: {drawingPoints.length} vertices captured
                  </div>
                  <div style={{ fontSize: 12, color: '#64748B' }}>
                    {drawingPoints.length < 3
                      ? `Click on the map to place at least ${3 - drawingPoints.length} more point${3 - drawingPoints.length > 1 ? 's' : ''}.`
                      : `Valid closed shape! Estimated Area: ${calculatePolygonAreaKm2(drawingPoints)} km². Complete zone details in the panel.`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setDrawingPoints([])}
                    style={{
                      background: '#FFFFFF',
                      border: '1px solid #CBD5E1',
                      padding: '6px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Clear Points
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    style={{
                      background: '#F1F5F9',
                      border: '1px solid #CBD5E1',
                      padding: '6px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {isEditingVertices && (
              <div
                style={{
                  background: '#FFFBEB',
                  border: '1px solid #FDE68A',
                  borderRadius: 8,
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#92400E' }}>
                    Boundary Reshaping Active: {editingPoints.length} vertices
                  </div>
                  <div style={{ fontSize: 12, color: '#78350F' }}>
                    Drag any handle on the map to reposition. Right-click a handle to delete that vertex.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={handleSaveVertexEdits}
                    style={{
                      background: '#22A447',
                      color: '#FFFFFF',
                      border: 'none',
                      padding: '7px 14px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Save Boundaries
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    style={{
                      background: '#FFFFFF',
                      border: '1px solid #CBD5E1',
                      padding: '7px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Zone Management Panel & Zone Editor */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Zone Creation or Edit Form */}
            {isCreatingNew ? (
              <div
                style={{
                  background: '#FFFFFF',
                  borderRadius: 12,
                  border: '2px solid #1A3BA2',
                  padding: 20,
                  boxShadow: '0 4px 12px rgba(26, 59, 162, 0.08)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 16,
                  }}
                >
                  <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: '#1A3BA2' }}>
                    Create Service Zone
                  </h3>
                  <button
                    type="button"
                    onClick={handleCancel}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748B' }}
                  >
                    <X size={18} />
                  </button>
                </div>

                {formValidationError && (
                  <div
                    style={{
                      background: '#FEF2F2',
                      border: '1px solid #FCA5A5',
                      color: '#991B1B',
                      padding: '8px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      marginBottom: 14,
                    }}
                  >
                    {formValidationError}
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 4 }}>
                      Zone Name *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Connaught Place Commercial Core [Demo Zone]"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: 6,
                        border: '1px solid #CBD5E1',
                        fontSize: 13,
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 4 }}>
                      Zone Code
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. DEMO-ZONE-05"
                      value={formCode}
                      onChange={(e) => setFormCode(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: 6,
                        border: '1px solid #CBD5E1',
                        fontSize: 13,
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 6 }}>
                      Active Service Categories *
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {(['ride', 'food', 'grocery', 'parcel'] as const).map((cat) => {
                        const checked = formCategories.includes(cat);
                        return (
                          <button
                            type="button"
                            key={cat}
                            onClick={() => handleToggleCategory(cat)}
                            style={{
                              padding: '5px 10px',
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: 'pointer',
                              border: checked ? '1px solid #1A3BA2' : '1px solid #CBD5E1',
                              background: checked ? '#E9EEF9' : '#FFFFFF',
                              color: checked ? '#1A3BA2' : '#64748B',
                              textTransform: 'uppercase',
                            }}
                          >
                            {cat}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 4 }}>
                      Description & Operational Notes
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Dispatch rules, peak hour notes, driver priority..."
                      value={formDesc}
                      onChange={(e) => setFormDesc(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: 6,
                        border: '1px solid #CBD5E1',
                        fontSize: 13,
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 4 }}>
                      Operational Status
                    </label>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="zoneStatus"
                          checked={formStatus === 'ACTIVE'}
                          onChange={() => setFormStatus('ACTIVE')}
                        />
                        Active
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="zoneStatus"
                          checked={formStatus === 'INACTIVE'}
                          onChange={() => setFormStatus('INACTIVE')}
                        />
                        Inactive (Planned)
                      </label>
                    </div>
                  </div>

                  {/* Vertices Summary */}
                  <div
                    style={{
                      background: '#F8FAFC',
                      padding: 10,
                      borderRadius: 6,
                      border: '1px solid #E2E8F0',
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                      <span>Vertices Captured:</span>
                      <span style={{ color: drawingPoints.length >= 3 ? '#22A447' : '#DC2626' }}>
                        {drawingPoints.length} points
                      </span>
                    </div>
                    {drawingPoints.length >= 3 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontWeight: 600 }}>
                        <span>Estimated Surface Area:</span>
                        <span style={{ color: '#1A3BA2' }}>{calculatePolygonAreaKm2(drawingPoints)} km²</span>
                      </div>
                    )}
                  </div>

                  {/* Form Action Buttons */}
                  <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                    <button
                      type="button"
                      onClick={handleSaveNewZone}
                      style={{
                        flex: 1,
                        background: '#1A3BA2',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: 6,
                        padding: '10px 14px',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Save Service Zone
                    </button>
                    <button
                      type="button"
                      onClick={handleCancel}
                      style={{
                        background: '#F1F5F9',
                        border: '1px solid #CBD5E1',
                        borderRadius: 6,
                        padding: '10px 14px',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ) : selectedZone ? (
              /* Selected Zone Details Card */
              <div
                style={{
                  background: '#FFFFFF',
                  borderRadius: 12,
                  border: '1px solid #E2E8F0',
                  padding: 20,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          background: selectedZone.status === 'ACTIVE' ? '#DCFCE7' : '#F1F5F9',
                          color: selectedZone.status === 'ACTIVE' ? '#15803D' : '#64748B',
                          padding: '2px 8px',
                          borderRadius: 999,
                        }}
                      >
                        {selectedZone.status}
                      </span>
                      <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#64748B' }}>
                        {selectedZone.code}
                      </span>
                    </div>
                    <h3 style={{ fontSize: 17, fontWeight: 800, color: '#0F172A', margin: '6px 0 2px' }}>
                      {selectedZone.name}
                    </h3>
                  </div>

                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => handleStartEditingVertices(selectedZone)}
                      title="Edit polygon boundary vertices"
                      style={{
                        background: '#EFF6FF',
                        color: '#1D4ED8',
                        border: '1px solid #BFDBFE',
                        borderRadius: 6,
                        padding: '6px 10px',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Edit3 size={14} />
                      <span>Reshape</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoneToDelete(selectedZone)}
                      title="Delete zone from local preview"
                      style={{
                        background: '#FEF2F2',
                        color: '#DC2626',
                        border: '1px solid #FECACA',
                        borderRadius: 6,
                        padding: '6px 10px',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <p style={{ fontSize: 13, color: '#475569', margin: '12px 0 16px', lineHeight: 1.4 }}>
                  {selectedZone.description}
                </p>

                {/* Metrics Grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: 10,
                    marginBottom: 16,
                  }}
                >
                  <div style={{ background: '#F8FAFC', padding: 10, borderRadius: 8, border: '1px solid #E2E8F0' }}>
                    <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>SURFACE AREA</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#1A3BA2' }}>
                      {selectedZone.areaKm2.toFixed(2)} km²
                    </div>
                  </div>
                  <div style={{ background: '#F8FAFC', padding: 10, borderRadius: 8, border: '1px solid #E2E8F0' }}>
                    <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>BOUNDARY POINTS</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A' }}>
                      {selectedZone.coordinates.length} Vertices
                    </div>
                  </div>
                </div>

                {/* Services Tags */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    ENABLED SERVICES
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {selectedZone.serviceCategories.map((cat) => (
                      <span
                        key={cat}
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          background: '#E9EEF9',
                          color: '#1A3BA2',
                          padding: '3px 8px',
                          borderRadius: 6,
                          textTransform: 'uppercase',
                        }}
                      >
                        {cat}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Boundary Vertices List Accordion */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    GEOGRAPHIC VERTICES (LAT / LNG)
                  </div>
                  <div
                    style={{
                      maxHeight: 140,
                      overflowY: 'auto',
                      background: '#F8FAFC',
                      border: '1px solid #E2E8F0',
                      borderRadius: 6,
                      fontSize: 11,
                      fontFamily: 'monospace',
                    }}
                  >
                    {selectedZone.coordinates.map((pt, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '4px 8px',
                          borderBottom: '1px solid #F1F5F9',
                        }}
                      >
                        <span style={{ color: '#64748B' }}>#{idx + 1}</span>
                        <span>{pt.lat.toFixed(5)}, {pt.lng.toFixed(5)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Status Toggle Switch */}
                <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Operational Status</span>
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(selectedZone.id)}
                    style={{
                      background: selectedZone.status === 'ACTIVE' ? '#22A447' : '#94A3B8',
                      color: '#FFFFFF',
                      border: 'none',
                      borderRadius: 999,
                      padding: '4px 14px',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {selectedZone.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                  </button>
                </div>
              </div>
            ) : null}

            {/* Existing Zones Directory List */}
            <div
              style={{
                background: '#FFFFFF',
                borderRadius: 12,
                border: '1px solid #E2E8F0',
                padding: 16,
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12,
                }}
              >
                <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: '#0F172A' }}>
                  Zone Inventory ({filteredZones.length})
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setZones(INITIAL_DEMO_ZONES);
                    setNotice({ text: 'Reset zones inventory to default sample regions.', ok: true });
                  }}
                  title="Reset to default demo zones"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#64748B',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 11,
                  }}
                >
                  <RefreshCw size={12} />
                  <span>Reset Defaults</span>
                </button>
              </div>

              {/* Search & Category Filter */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                <div style={{ position: 'relative' }}>
                  <Search
                    size={14}
                    style={{ position: 'absolute', left: 10, top: 10, color: '#94A3B8' }}
                  />
                  <input
                    type="text"
                    placeholder="Search by zone name or code..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '7px 10px 7px 32px',
                      borderRadius: 6,
                      border: '1px solid #CBD5E1',
                      fontSize: 12,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                  {['ALL', 'RIDE', 'FOOD', 'GROCERY', 'ACTIVE', 'INACTIVE'].map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setFilterCategory(filter)}
                      style={{
                        padding: '3px 8px',
                        borderRadius: 999,
                        fontSize: 10.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        border: filterCategory === filter ? '1px solid #1A3BA2' : '1px solid #E2E8F0',
                        background: filterCategory === filter ? '#1A3BA2' : '#F8FAFC',
                        color: filterCategory === filter ? '#FFFFFF' : '#64748B',
                      }}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              </div>

              {/* List of Zones */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
                {filteredZones.map((zone) => {
                  const isSelected = zone.id === selectedZoneId;
                  return (
                    <div
                      key={zone.id}
                      onClick={() => {
                        setSelectedZoneId(zone.id);
                        setIsDrawing(false);
                        setIsEditingVertices(false);
                        setIsCreatingNew(false);
                      }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: isSelected ? '2px solid #1A3BA2' : '1px solid #E2E8F0',
                        background: isSelected ? '#F0F4FF' : '#FFFFFF',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: zone.status === 'ACTIVE' ? '#22A447' : '#94A3B8',
                            }}
                          />
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#1E293B' }}>{zone.name}</span>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#1A3BA2' }}>
                          {zone.areaKm2.toFixed(1)} km²
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginTop: 6,
                          fontSize: 11,
                          color: '#64748B',
                        }}
                      >
                        <span>{zone.serviceCategories.map((c) => c.toUpperCase()).join(' · ')}</span>
                        <span>{zone.coordinates.length} pts</span>
                      </div>
                    </div>
                  );
                })}

                {filteredZones.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '24px 12px', color: '#94A3B8', fontSize: 13 }}>
                    No service zones found matching your filter.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Informational Guidance Footer */}
        <div
          style={{
            background: '#F8FAFC',
            border: '1px solid #E2E8F0',
            borderRadius: 12,
            padding: '14px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 12.5,
            color: '#475569',
          }}
        >
          <Info size={18} style={{ color: '#1A3BA2', flexShrink: 0 }} />
          <div>
            <strong>Operational Rule:</strong> Geofence boundaries govern real-time driver allocation, dynamic surge
            multipliers, restaurant delivery radii, and micro-fulfillment grocery hubs. Polygon coordinates are
            rendered natively via Leaflet vector layers without metered map API costs.
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {zoneToDelete && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: 12,
              padding: 24,
              maxWidth: 420,
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', margin: '0 0 10px' }}>
              Confirm Zone Deletion
            </h3>
            <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.5, margin: '0 0 20px' }}>
              Are you sure you want to remove <strong>{zoneToDelete.name}</strong> ({zoneToDelete.code})? This will
              remove the zone from your local preview inventory.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setZoneToDelete(null)}
                style={{
                  background: '#F1F5F9',
                  border: '1px solid #CBD5E1',
                  borderRadius: 6,
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                style={{
                  background: '#DC2626',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Delete Zone
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
