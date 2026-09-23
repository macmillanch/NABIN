// =========================================================================
// THE authoritative geographic policy engine.
//
// Before this file, "where is this point" was answered in three places with
// three different answers: the pricing path accepted a caller-supplied zoneId,
// the public evaluate endpoint ran its own `isNaN` check, and the booking routes
// ran neither. One decision point is the only way a server can keep claiming it
// knows where a pickup is.
//
// Two things this engine deliberately does NOT do, because the audit left them
// as product decisions (docs/GEOFENCING_SECURITY_AUDIT.md §14) and a library
// must not answer a question the business has not:
//   1. It never refuses anything for being outside a fence. `insideServiceArea`
//      is reported as a fact; what a fact costs commercially is decision 1.
//   2. It never lets a stored value stand in for a validated one. Coordinates
//      that cannot be parsed are not "outside", an unreadable store is not "no
//      fences", and a compiled-in seed array is not a boundary — which is why
//      `validCoordinates` and `locationValidated` are separate fields rather
//      than one boolean.
//
// Nothing reads state on its own: the host injects it with `bind()`, so the
// engine can be pointed at a broken store in a test and the failure it reports
// is the failure it will report in production.
// =========================================================================

const STORE_STATE = Object.freeze({
  UNREADABLE: 'UNREADABLE',
  VALIDATED_EMPTY: 'VALIDATED_EMPTY',
  VALIDATED: 'VALIDATED'
});

// Reason codes are internal-safe: they name the class of failure, never the
// data behind it. Coordinates never appear in one.
const REASON = Object.freeze({
  INVALID_COORDINATES: 'GEO_INVALID_COORDINATES',
  OUT_OF_RANGE: 'GEO_COORDINATES_OUT_OF_RANGE',
  OUTSIDE_SERVICE_AREA: 'GEO_OUTSIDE_SERVICE_AREA',
  STORE_UNAVAILABLE: 'GEO_STORE_UNAVAILABLE',
  FENCE_INACTIVE: 'GEO_FENCE_INACTIVE',
  RULE_EXPIRED: 'GEO_RULE_EXPIRED',
  RULE_NOT_YET_ACTIVE: 'GEO_RULE_NOT_YET_ACTIVE',
  POLICY_CONFLICT: 'GEO_POLICY_CONFLICT',
  GEOMETRY_INVALID: 'GEO_GEOMETRY_INVALID',
  GEOMETRY_SELF_INTERSECT: 'GEO_GEOMETRY_SELF_INTERSECT',
  // The admin write path. A rule that names a boundary which does not exist, or
  // carries a multiplier it cannot honour, is refused with these rather than
  // quietly bound to somebody else's zone.
  ZONE_UNRESOLVED: 'GEO_ZONE_UNRESOLVED',
  MULTIPLIER_INVALID: 'GEO_MULTIPLIER_INVALID',
  // A stored boundary already owns that zone code. This is a conflict with data,
  // not with the database's availability, and the difference decides whether the
  // caller should retry — retrying a duplicate yields the same duplicate.
  ZONE_CODE_TAKEN: 'GEO_ZONE_CODE_TAKEN',
  // The code an operator typed cannot be stored as typed. Silently shortening it
  // would be a substitution, which is what this whole pass stopped doing.
  ZONE_CODE_INVALID: 'GEO_ZONE_CODE_INVALID'
});

// Operations where an unvalidated location must stop the action rather than
// merely degrade a number. Only used to route a store failure to 503 vs a
// clearly-labelled quote — never to decide service-area eligibility.
const BOOKING_CRITICAL = Object.freeze([
  'RIDE_CREATE', 'PARCEL_CREATE', 'FOOD_CREATE', 'DISPATCH',
  'DRIVER_ACCEPT', 'DRIVER_ARRIVED', 'DRIVER_START', 'DRIVER_COMPLETE'
]);

const SERVICES = Object.freeze(['RIDE', 'PARCEL', 'FOOD', 'DELIVERY', 'ALL']);
const GEOMETRY_TYPES = Object.freeze(['POLYGON', 'CIRCLE']);
const MAX_REPORTED = 20;

const EARTH_RADIUS_M = 6371e3;

function refusal(code, message) {
  return { code, message };
}

// 0 and '-90' are legitimate; '', null, true, {}, [], 'abc', NaN and the two
// infinities are not. A numeric string is accepted only where the caller says
// its contract already publishes that (driver telemetry does, since CH-08).
function toFiniteNumber(raw, allowNumericString) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (allowNumericString && typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseCoordinate(raw, { label, min, max, allowNumericString = false }) {
  if (raw === undefined || raw === null || raw === '' || typeof raw === 'boolean') {
    return { ok: false, code: REASON.INVALID_COORDINATES, message: `${label} is required and must be a finite number.` };
  }
  if (Array.isArray(raw) || typeof raw !== 'number' && typeof raw !== 'string') {
    return { ok: false, code: REASON.INVALID_COORDINATES, message: `${label} must be a number, not a ${Array.isArray(raw) ? 'list' : 'structured value'}.` };
  }
  const value = toFiniteNumber(raw, allowNumericString);
  if (value === null) {
    return { ok: false, code: REASON.INVALID_COORDINATES, message: `${label} must be a finite number.` };
  }
  if (value < min || value > max) {
    return { ok: false, code: REASON.OUT_OF_RANGE, message: `${label} must be between ${min} and ${max}.` };
  }
  return { ok: true, value };
}

function validateLatitude(raw, options = {}) {
  return parseCoordinate(raw, { label: 'Latitude', min: -90, max: 90, ...options });
}

function validateLongitude(raw, options = {}) {
  return parseCoordinate(raw, { label: 'Longitude', min: -180, max: 180, ...options });
}

// A caller may hand a coordinate pair in a body, a query string or a socket
// frame. `numericStrings: true` is how the transports that already publish that
// contract keep working; the geo decision paths do not use it.
function validateCoordinatePair(lat, lng, { numericStrings = false } = {}) {
  const latitude = validateLatitude(lat, { allowNumericString: numericStrings });
  if (!latitude.ok) return latitude;
  const longitude = validateLongitude(lng, { allowNumericString: numericStrings });
  if (!longitude.ok) return longitude;
  return { ok: true, value: { lat: latitude.value, lng: longitude.value } };
}

function isPointInCircle(lat, lng, centerLat, centerLng, radiusMeters) {
  const phi1 = (lat * Math.PI) / 180;
  const phi2 = (centerLat * Math.PI) / 180;
  const deltaPhi = ((centerLat - lat) * Math.PI) / 180;
  const deltaLambda = ((centerLng - lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_M * c <= radiusMeters;
}

function isPointInPolygon(lat, lng, polygonCoords) {
  const ring = normalizeRing(polygonCoords);
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lat, yi = ring[i].lng;
    const xj = ring[j].lat, yj = ring[j].lng;
    const intersect = ((yi > lng) !== (yj > lng)) &&
      (lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function samePoint(a, b) {
  return a.lat === b.lat && a.lng === b.lng;
}

// A closed ring repeats its first vertex. Counting that repeat as a corner
// would make a correct 4-sided fence need 5 points, so normalise first.
function normalizeRing(coords) {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  const points = [];
  for (const vertex of coords) {
    if (!vertex || typeof vertex !== 'object') return null;
    const lat = toFiniteNumber(vertex.lat ?? vertex.latitude, true);
    const lng = toFiniteNumber(vertex.lng ?? vertex.longitude ?? vertex.lon, true);
    if (lat === null || lng === null) return null;
    points.push({ lat, lng });
  }
  if (points.length > 1 && samePoint(points[0], points[points.length - 1])) points.pop();
  return points;
}

function segmentsIntersect(p1, p2, p3, p4) {
  const d = (p2.lat - p1.lat) * (p4.lng - p3.lng) - (p2.lng - p1.lng) * (p4.lat - p3.lat);
  if (d === 0) return false;
  const t = ((p3.lat - p1.lat) * (p4.lng - p3.lng) - (p3.lng - p1.lng) * (p4.lat - p3.lat)) / d;
  const u = ((p3.lat - p1.lat) * (p2.lng - p1.lng) - (p3.lng - p1.lng) * (p2.lat - p1.lat)) / d;
  return t > 0 && t < 1 && u > 0 && u < 1;
}

// Ray-casting is undefined on a self-crossing ring: the parity flips twice and
// a point that is obviously outside reads as inside. Refusing the shape at the
// write is cheaper than explaining the answer later.
function ringSelfIntersects(ring) {
  if (ring.length < 4) return false;
  for (let i = 0; i < ring.length; i++) {
    const a1 = ring[i];
    const a2 = ring[(i + 1) % ring.length];
    for (let j = i + 1; j < ring.length; j++) {
      const b1 = ring[j];
      const b2 = ring[(j + 1) % ring.length];
      if (samePoint(a1, b1) || samePoint(a1, b2) || samePoint(a2, b1) || samePoint(a2, b2)) continue;
      if (segmentsIntersect(a1, a2, b1, b2)) return { at: [i, j] };
    }
  }
  return false;
}

// Used by the admin write path. Geometry is never repaired here: a shape the
// operator did not draw must not become a boundary that reprices strangers, so
// anything unsound is a refusal that names what is wrong.
function validateFenceGeometry(payload = {}) {
  const type = String(payload.type || payload.geometryType || '').trim().toUpperCase();
  if (!GEOMETRY_TYPES.includes(type)) {
    return { ok: false, code: REASON.GEOMETRY_INVALID, message: `Geometry type must be one of ${GEOMETRY_TYPES.join(' or ')}.` };
  }

  const surcharge = payload.surcharge !== undefined ? payload.surcharge : payload.surchargeAmount;
  let surchargeAmount = null;
  if (surcharge !== undefined && surcharge !== null) {
    const amount = toFiniteNumber(surcharge, true);
    if (amount === null || amount < 0) {
      return { ok: false, code: REASON.GEOMETRY_INVALID, message: 'Surcharge must be a finite, non-negative number.' };
    }
    surchargeAmount = amount;
  }

  const multiplier = payload.surgeMultiplier;
  let surgeMultiplier = null;
  if (multiplier !== undefined && multiplier !== null) {
    const value = toFiniteNumber(multiplier, true);
    if (value === null || value < 1) {
      return { ok: false, code: REASON.GEOMETRY_INVALID, message: 'Surge multiplier must be a finite number of at least 1.' };
    }
    surgeMultiplier = value;
  }

  const allowedServices = payload.allowedServices;
  if (allowedServices !== undefined && allowedServices !== null) {
    if (!Array.isArray(allowedServices) || allowedServices.length === 0 ||
        allowedServices.some(s => !SERVICES.includes(String(s).toUpperCase()))) {
      return { ok: false, code: REASON.GEOMETRY_INVALID, message: `Allowed services must be a non-empty list drawn from ${SERVICES.join(', ')}.` };
    }
  }

  // What the caller stored must be what the caller meant, so the sound shape
  // comes back normalised rather than the original payload being trusted to be.
  const modifiers = { surcharge: surchargeAmount, surgeMultiplier };

  if (type === 'CIRCLE') {
    // A circle arrives in three shapes: {center}, {centerLat, centerLng}, or the
    // {center, radiusMeters} object this repository writes into `coordinates`.
    const stored = payload.coordinates && !Array.isArray(payload.coordinates) ? payload.coordinates : null;
    const center = (payload.center && typeof payload.center === 'object' && payload.center.lat !== undefined)
      ? payload.center
      : (stored?.center && typeof stored.center === 'object' ? stored.center : { lat: payload.centerLat, lng: payload.centerLng });
    const lat = validateLatitude(center?.lat);
    if (!lat.ok) return { ok: false, code: REASON.GEOMETRY_INVALID, message: `A circle needs a centre: ${lat.message}` };
    const lng = validateLongitude(center?.lng);
    if (!lng.ok) return { ok: false, code: REASON.GEOMETRY_INVALID, message: `A circle needs a centre: ${lng.message}` };
    const radius = toFiniteNumber(payload.radiusMeters ?? stored?.radiusMeters, true);
    if (radius === null || radius <= 0) {
      return { ok: false, code: REASON.GEOMETRY_INVALID, message: 'A circle needs a positive radiusMeters.' };
    }
    return { ok: true, value: { type, ...modifiers, center: { lat: lat.value, lng: lng.value }, radiusMeters: radius } };
  }

  const raw = payload.coordinates;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, code: REASON.GEOMETRY_INVALID, message: 'A polygon needs coordinates: a list of at least three vertices.' };
  }
  const ring = normalizeRing(raw);
  if (!ring) {
    return { ok: false, code: REASON.GEOMETRY_INVALID, message: 'Every polygon vertex must carry a finite lat and lng.' };
  }
  if (ring.length < 3) {
    return {
      ok: false,
      code: REASON.GEOMETRY_INVALID,
      message: `A polygon needs at least three distinct vertices; ${raw.length} submitted point(s) describe ${ring.length} corner(s), which encloses nothing.`
    };
  }
  for (const vertex of ring) {
    const lat = validateLatitude(vertex.lat);
    if (!lat.ok) return { ok: false, code: REASON.GEOMETRY_INVALID, message: `Polygon vertex rejected: ${lat.message}` };
    const lng = validateLongitude(vertex.lng);
    if (!lng.ok) return { ok: false, code: REASON.GEOMETRY_INVALID, message: `Polygon vertex rejected: ${lng.message}` };
  }
  const crossing = ringSelfIntersects(ring);
  if (crossing) {
    return { ok: false, code: REASON.GEOMETRY_SELF_INTERSECT, message: 'Polygon edges cross each other, so "inside" has no consistent answer.' };
  }
  return { ok: true, value: { type, ...modifiers, coordinates: ring } };
}

function minutesOfDay(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (clock) {
    const hours = Number(clock[1]);
    if (hours > 23) return null;
    return hours * 60 + Number(clock[2]) + Number(clock[3] || 0) / 60;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCHours() * 60 + parsed.getUTCMinutes();
}

function minutesNow(timestamp) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp || Date.now());
  return date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
}

// A time-of-day window, which may wrap midnight. Reported, never enforced:
// whether these columns bind at all is §14 decision 4.
function windowStatus(rule, now) {
  const start = minutesOfDay(rule.startTime ?? rule.start_time);
  const end = minutesOfDay(rule.endTime ?? rule.end_time);
  if (start === null && end === null) return { inWindow: null, code: null };
  const open = start !== null && now >= start;
  const closes = end !== null && now < end;
  if (start !== null && end !== null && start > end) {
    // A window that wraps midnight is open from `start` to the end of one day and
    // from the start of the next until `end`. Outside it, the clock has not
    // reached today's opening yet.
    const openAcrossMidnight = now >= start || now < end;
    return { inWindow: openAcrossMidnight, code: openAcrossMidnight ? null : REASON.RULE_NOT_YET_ACTIVE };
  }
  if (start !== null && end !== null) {
    const inside = open && closes;
    // "Past the end" and "before the start" are different facts, and an operator
    // reading a rejection needs to know which one a window produced. Without this
    // a rule that ended an hour ago and one that opens in an hour both answered
    // "not now".
    return { inWindow: inside, code: inside ? null : (open ? REASON.RULE_EXPIRED : REASON.RULE_NOT_YET_ACTIVE) };
  }
  if (start !== null) return { inWindow: open, code: open ? null : REASON.RULE_NOT_YET_ACTIVE };
  return { inWindow: closes, code: closes ? null : REASON.RULE_EXPIRED };
}

// Two fences with the same shape are one boundary recorded twice — usually by a
// harness that ran twice. Charging them twice is not an overlap policy, so the
// identity of a shape, not its row, is what pricing sees.
function fenceSignature(fence) {
  const geometry = fenceShape(fence);
  if (!geometry) return `ROW|${fence.id ?? fence.name}`;
  if (geometry.kind === 'circle') {
    return `CIRCLE|${geometry.center.lat}|${geometry.center.lng}|${geometry.radiusMeters}`;
  }
  // Sorted, not sequential: the same boundary re-entered from a different
  // starting vertex is still the same boundary.
  return `POLYGON|${geometry.ring.map(p => `${p.lat},${p.lng}`).sort().join(';')}`;
}

// The shape a fence actually claims, or null when it claims one it does not
// have. A CIRCLE row with no centre used to be evaluated with an invented 3500 m
// radius, which is a 3.5 km boundary nobody drew.
function fenceShape(fence) {
  const type = String(fence.type || fence.geometryType || '').toUpperCase();
  if (type === 'CIRCLE') {
    const centerLat = toFiniteNumber(fence.center?.lat, true);
    const centerLng = toFiniteNumber(fence.center?.lng, true);
    const radius = toFiniteNumber(fence.radiusMeters, true);
    if (centerLat === null || centerLng === null || centerLat < -90 || centerLat > 90 ||
        centerLng < -180 || centerLng > 180 || radius === null || radius <= 0) return null;
    return { kind: 'circle', center: { lat: centerLat, lng: centerLng }, radiusMeters: radius };
  }
  if (type === 'POLYGON') {
    const ring = normalizeRing(fence.coordinates);
    if (!ring || ring.length < 3) return null;
    for (const vertex of ring) {
      if (vertex.lat < -90 || vertex.lat > 90 || vertex.lng < -180 || vertex.lng > 180) return null;
    }
    return { kind: 'polygon', ring };
  }
  return null;
}

function containsPoint(shape, lat, lng) {
  if (shape.kind === 'circle') {
    return isPointInCircle(lat, lng, shape.center.lat, shape.center.lng, shape.radiusMeters);
  }
  return isPointInPolygon(lat, lng, shape.ring);
}

function describeFence(fence) {
  return {
    id: fence.id ?? null,
    name: fence.name ?? fence.zoneName ?? null,
    zoneCode: fence.zoneCode ?? fence.code ?? null,
    type: fence.type ?? fence.geometryType ?? null,
    category: fence.category ?? null,
    surcharge: Number(fence.surcharge ?? fence.surchargeAmount ?? 0) || 0,
    surgeMultiplier: Number(fence.surgeMultiplier ?? 1) || 1,
    status: fence.status ?? (fence.isActive === false ? 'INACTIVE' : 'ACTIVE')
  };
}

function describeRule(rule) {
  return {
    id: rule.id ?? null,
    zoneId: rule.zoneId ?? null,
    zoneName: rule.zoneName ?? null,
    service: String(rule.service || 'ALL').toUpperCase(),
    surgeMultiplier: Number(rule.surgeMultiplier || 1),
    maxMultiplier: Number(rule.maxMultiplier || 3.0),
    cappedMultiplier: Math.min(Number(rule.maxMultiplier || 3.0), Number(rule.surgeMultiplier || 1.0)),
    priority: rule.priority ?? null,
    window: { start: rule.startTime ?? null, end: rule.endTime ?? null }
  };
}

function emptyOutcome(reason) {
  return {
    coordinatesSupplied: true,
    validCoordinates: false,
    locationValidated: false,
    insideServiceArea: false,
    matchedFences: [],
    applicablePricingZones: [],
    applicableSurgeRules: [],
    activeZoneName: null,
    effectiveSurgeMultiplier: 1.0,
    totalSurcharge: 0,
    platformWideSurgeRule: null,
    nonApplicable: null,
    rejectionReason: reason || null
  };
}

function bounded(list) {
  if (list.length <= MAX_REPORTED) return list;
  return list.slice(0, MAX_REPORTED);
}

class GeoPolicyService {
  constructor() {
    this.source = null;
  }

  // The host (database.js) hands over accessors, not a copy, so a re-hydration
  // is visible on the next call without re-binding.
  bind(source) {
    this.source = source;
    return this;
  }

  isBookingCritical(operation) {
    return BOOKING_CRITICAL.includes(String(operation || '').toUpperCase());
  }

  storeState() {
    if (!this.source) {
      return { fences: STORE_STATE.UNREADABLE, rules: STORE_STATE.UNREADABLE, source: 'unbound', readAt: null };
    }
    const state = this.source.storeState ? this.source.storeState() : null;
    return {
      fences: state?.fences || STORE_STATE.UNREADABLE,
      rules: state?.rules || STORE_STATE.UNREADABLE,
      source: state?.source || 'memory',
      // When this copy was read, not merely what it currently says. "VALIDATED"
      // and "VALIDATED, twelve minutes ago" are different answers for an operator
      // deciding whether the console is showing live geography, and the second is
      // the one that makes a stale cache visible instead of merely possible.
      readAt: state?.readAt ?? null
    };
  }

  // What the store holds, independent of any point. A rule with no zone binding
  // can never be contained, so it is platform-wide by construction; saying so in
  // a count is how that stops being a surprise.
  inventory() {
    const state = this.storeState();
    if (!this.source) return { storeState: state, available: false };
    const fences = this.source.fences() || [];
    const rules = this.source.rules() || [];
    const shapes = new Map();
    let malformedFences = 0;
    for (const fence of fences) {
      const geometry = fenceShape(fence);
      if (!geometry) { malformedFences++; continue; }
      const signature = fenceSignature(fence);
      shapes.set(signature, (shapes.get(signature) || 0) + 1);
    }
    const active = rules.filter(r => r.status === 'ACTIVE');
    return {
      storeState: state,
      available: state.fences !== STORE_STATE.UNREADABLE && state.rules !== STORE_STATE.UNREADABLE,
      fenceCount: fences.length,
      activeFenceCount: fences.filter(f => f.status === 'ACTIVE').length,
      inactiveFenceCount: fences.filter(f => f.status && f.status !== 'ACTIVE').length,
      malformedFenceCount: malformedFences,
      distinctFenceShapes: shapes.size,
      duplicatedFenceShapes: [...shapes.values()].filter(n => n > 1).length,
      duplicateFenceRows: [...shapes.values()].reduce((sum, n) => sum + (n > 1 ? n - 1 : 0), 0),
      ruleCount: rules.length,
      activeRuleCount: active.length,
      activeRulesWithoutZoneBinding: active.filter(r => r.zoneId === undefined || r.zoneId === null).length,
      globalSurgeMultiplier: Number(this.source.globalSurgeMultiplier?.() ?? 1.0) || 1.0
    };
  }

  /**
   * @param {object} input
   * @param {*} input.latitude
   * @param {*} input.longitude
   * @param {string} [input.service]
   * @param {string} [input.operation]
   * @param {Date|number|string} [input.timestamp] server clock unless a caller
   *   is deliberately replaying a moment; never a client's claim about now
   * @param {object} [input.authenticatedUser] carried for the caller's own audit
   *   line; no identity changes what a coordinate is inside, and that is the
   *   property, not an omission
   * @param {*} [input.requestedZoneId] accepted so a caller can report what the
   *   client asked for; it cannot move price, area or multiplier by any path
   */
  evaluate(input = {}) {
    const rawLat = input.latitude !== undefined ? input.latitude : input.lat;
    const rawLng = input.longitude !== undefined ? input.longitude : input.lng;
    const state = this.storeState();
    const storeReadable = state.fences !== STORE_STATE.UNREADABLE && state.rules !== STORE_STATE.UNREADABLE;
    const requestedZoneIdIgnored = input.requestedZoneId !== undefined && input.requestedZoneId !== null;

    // "No location given" and "nonsense location" are different facts and the
    // difference is the whole of Phase 2's fail-safe requirement: an absent pair
    // is the documented contract for a standard-area quote, a half pair is not.
    const latGiven = rawLat !== undefined && rawLat !== null;
    const lngGiven = rawLng !== undefined && rawLng !== null;
    if (!latGiven && !lngGiven) {
      return { ...emptyOutcome(null), coordinatesSupplied: false, requestedZoneIdIgnored, storeState: state };
    }
    if (!latGiven || !lngGiven) {
      return {
        ...emptyOutcome(refusal(REASON.INVALID_COORDINATES, 'A coordinate pair must supply both latitude and longitude.')),
        requestedZoneIdIgnored,
        storeState: state
      };
    }

    const coords = validateCoordinatePair(rawLat, rawLng, { numericStrings: Boolean(input.allowNumericStrings) });
    if (!coords.ok) {
      return { ...emptyOutcome(refusal(coords.code, coords.message)), requestedZoneIdIgnored, storeState: state };
    }

    const { lat, lng } = coords.value;
    const service = String(input.service || input.serviceType || 'RIDE').toUpperCase();

    if (!storeReadable) {
      // An unreadable store is not an empty world. It is a world nothing can be
      // asserted about, and the only thing safe to say is that nothing matched.
      return {
        ...emptyOutcome(refusal(REASON.STORE_UNAVAILABLE, 'Geographic policy could not be validated right now.')),
        validCoordinates: true,
        requestedZoneIdIgnored,
        storeState: state
      };
    }

    const fences = this.source.fences() || [];
    const rules = this.source.rules() || [];
    const globalMultiplier = Number(this.source.globalSurgeMultiplier?.() ?? 1.0) || 1.0;
    const now = minutesNow(input.timestamp);

    const matchedByIdentity = new Map();
    const skipped = { inactiveFences: 0, malformedFences: 0, duplicateShapesExcluded: 0, unrequestedInactiveFences: [] };

    for (const fence of fences) {
      if (fence.status && fence.status !== 'ACTIVE') {
        skipped.inactiveFences++;
        continue;
      }
      const geometry = fenceShape(fence);
      if (!geometry) {
        skipped.malformedFences++;
        continue;
      }
      if (!containsPoint(geometry, lat, lng)) continue;

      const signature = fenceSignature(fence);
      const existing = matchedByIdentity.get(signature);
      if (existing) {
        skipped.duplicateShapesExcluded++;
        continue;
      }
      matchedByIdentity.set(signature, fence);
    }

    const matchedFences = [...matchedByIdentity.values()].map(describeFence);

    const matchedIds = new Set([...matchedByIdentity.values()].map(f => f.id));
    // Aggregation keeps the shape the platform has always used — highest
    // multiplier wins, surcharge adds up across distinct boundaries. Whether
    // genuinely different overlapping zones should sum or defer to the
    // highest-priority one is §14 decision 3 and is not answered here.
    let effectiveSurgeMultiplier = globalMultiplier;
    let totalSurcharge = 0;
    for (const fence of matchedByIdentity.values()) {
      const multiplier = Number(fence.surgeMultiplier || 1);
      if (multiplier > effectiveSurgeMultiplier) effectiveSurgeMultiplier = multiplier;
      totalSurcharge += Number(fence.surcharge || 0);
    }

    // Rule selection preserves the semantics the platform already has, because
    // precedence between competing rules is §14 decision 3/4 and this engine
    // has no authority to improve on "the first matching rule per boundary,
    // newest write first" by inventing a ranking. What it adds is visibility:
    // the same rules that are active but uncontained are counted and named, so
    // the difference between "applied because you are there" and "applied
    // because the row says ACTIVE" is on the record.
    const applicableSurgeRules = [];
    const seenRuleIds = new Set();
    const outsideWindow = [];
    let inactiveRules = 0;
    let duplicateRulesExcluded = 0;
    let statusOnlyMatches = 0;
    let platformWideSurgeRule = null;

    for (const fence of matchedByIdentity.values()) {
      const ruleServiceMatches = (rule) => {
        const s = String(rule.service || 'ALL').toUpperCase();
        return s === 'ALL' || s === service;
      };
      const candidates = rules.filter(r => r.zoneId === fence.id && r.status === 'ACTIVE' && ruleServiceMatches(r));
      const rule = candidates[0];
      // The selection stays "the first matching rule per boundary, newest write
      // first" because ranking two competing rules is §14 decision 3. What the
      // engine adds is the count: two active rules on one boundary is a pricing
      // bug waiting to be found, and it cannot stay invisible.
      if (candidates.length > 1) duplicateRulesExcluded += candidates.length - 1;
      if (!rule || seenRuleIds.has(rule.id)) {
        if (rule && seenRuleIds.has(rule.id)) duplicateRulesExcluded++;
        continue;
      }
      seenRuleIds.add(rule.id);
      const contribution = Math.min(Number(rule.maxMultiplier || 3.0), Number(rule.surgeMultiplier || 1.0));
      const { inWindow, code } = windowStatus(rule, now);
      if (inWindow === false) outsideWindow.push({ id: rule.id ?? null, name: rule.zoneName ?? null, code: code || REASON.RULE_EXPIRED });
      applicableSurgeRules.push({
        id: rule.id ?? null,
        zoneId: rule.zoneId ?? null,
        zoneName: rule.zoneName ?? fence.name,
        service: String(rule.service || 'ALL').toUpperCase(),
        surgeMultiplier: Number(rule.surgeMultiplier || 1),
        maxMultiplier: Number(rule.maxMultiplier || 3.0),
        priority: rule.priority ?? null,
        // The code travels with the window so an admin reading one rule line can
        // tell why it did not bind without cross-referencing the summary counters.
        window: { start: rule.startTime ?? null, end: rule.endTime ?? null, inWindow, code: code || null },
        effectiveMultiplier: contribution,
        basis: 'CONTAINED',
        // Reported, not enforced: a rule outside its own window still moves the
        // price today, and switching that off is a price change that §14 decision
        // 4 has to authorise. `inWindow === false` + `wouldApplyIfEnforced` is the
        // number that would move, so the decision can be made with it in hand.
        applied: contribution > effectiveSurgeMultiplier,
        wouldApplyIfEnforced: inWindow !== false && contribution > effectiveSurgeMultiplier
      });
      if (contribution > effectiveSurgeMultiplier) effectiveSurgeMultiplier = contribution;
    }

    // `platformWideSurgeRule` is reported exactly as the pricing path has always
    // consumed it: the first active rule that matches the service, with no
    // containment test at all. Changing that selection is §14 decision 4, so the
    // engine keeps the behaviour and labels it — `STATUS_ONLY` means "this
    // modifier reached a price without the point being inside its zone".
    for (const rule of rules) {
      if (rule.status !== 'ACTIVE') {
        inactiveRules++;
        continue;
      }
      const ruleService = String(rule.service || 'ALL').toUpperCase();
      if (ruleService !== 'ALL' && ruleService !== service) continue;
      if (!(rule.zoneId !== undefined && rule.zoneId !== null && matchedIds.has(rule.zoneId))) statusOnlyMatches++;
      if (!platformWideSurgeRule) {
        platformWideSurgeRule = {
          ...describeRule(rule),
          basis: rule.zoneId !== undefined && rule.zoneId !== null && matchedIds.has(rule.zoneId) ? 'CONTAINED' : 'STATUS_ONLY'
        };
      }
    }

    return {
      coordinatesSupplied: true,
      coordinate: { lat, lng },
      evaluatedAt: new Date(input.timestamp || Date.now()).toISOString(),
      validCoordinates: true,
      locationValidated: true,
      insideServiceArea: matchedFences.length > 0,
      matchedFences,
      applicablePricingZones: matchedFences,
      applicableSurgeRules,
      activeZoneName: matchedFences.length > 0 ? matchedFences.map(z => z.name).join(', ') : null,
      effectiveSurgeMultiplier: Math.round(effectiveSurgeMultiplier * 100) / 100,
      totalSurcharge: Math.round(totalSurcharge * 100) / 100,
      requestedZoneIdIgnored,
      platformWideSurgeRule,
      nonApplicable: {
        inactiveFences: skipped.inactiveFences,
        malformedFences: skipped.malformedFences,
        duplicateShapesExcluded: skipped.duplicateShapesExcluded,
        inactiveRules,
        duplicateRulesExcluded,
        rulesOutsideWindow: bounded(outsideWindow),
        activeRulesWithoutContainment: statusOnlyMatches,
        requestedZoneIdIgnored
      },
      rejectionReason: null,
      storeState: state
    };
  }
}

const geoPolicyService = new GeoPolicyService();
geoPolicyService.REASON = REASON;
geoPolicyService.STORE_STATE = STORE_STATE;
geoPolicyService.BOOKING_CRITICAL = BOOKING_CRITICAL;
geoPolicyService.validateCoordinatePair = validateCoordinatePair;
geoPolicyService.validateFenceGeometry = validateFenceGeometry;
geoPolicyService.isPointInCircle = isPointInCircle;
geoPolicyService.isPointInPolygon = isPointInPolygon;
geoPolicyService.fenceSignature = fenceSignature;

module.exports = geoPolicyService;
