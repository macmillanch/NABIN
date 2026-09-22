// =========================================================================
// THE authoritative driver-telemetry validator.
//
// It exists because there were two: the WebSocket path checked ranges and the
// REST path checked presence. A driver fix that the socket refused could be
// posted through REST and land in the same fleet map, which is worse than a
// crash — a poisoned position steers dispatch, ETA and trip completion. Both
// transports now call this one function, so a rejection cannot be sidestepped
// by choosing a different door, and the reason string is the same on both.
//
// Deliberately permissive about two things: a numeric string is still a number
// (`"28.61"` is what a JSON encoder on a phone produces all the time), and a
// missing timestamp is acceptable, because both transports worked without one
// before and nothing here is meant to force a client upgrade. What is not
// acceptable is a value that cannot be a position.
// =========================================================================

const RULES = {
  minLat: -90,
  maxLat: 90,
  minLng: -180,
  maxLng: 180,
  // A two-wheeler in Delhi traffic does not do 100 km/h; a car on the expressway
  // might do 120. Anything that could plausibly be an outlier is allowed, and
  // anything that could only be a sensor error or an attack is not.
  maxSpeedKmph: 300,
  // Metres. 5 km of accuracy is a fix worth discarding rather than routing on.
  maxAccuracyMeters: 5000,
  // Clocks are wrong on real devices, so a fix may lead the server by this much
  // before it is treated as fabricated rather than merely misconfigured.
  maxFutureSkewMs: 2 * 60 * 1000,
  // A queued backlog after a dead zone is legitimate; a 1899 timestamp is not.
  // Six hours is long enough for any realistic offline queue and short enough
  // that the stored position is still describable as "where this driver is".
  maxAgeMs: 6 * 60 * 60 * 1000
};

function failure(code, message) {
  return { ok: false, code, message, status: 400 };
}

// null, '', true, {}, [] and NaN all fail this; 0 and '-90' pass it.
function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function validateCoordinate(raw, name, min, max) {
  if (raw === undefined || raw === null || raw === '') {
    return failure('INVALID_COORDINATES', `${name} is required and must be a finite number.`);
  }
  const value = toFiniteNumber(raw);
  if (value === null) {
    return failure('INVALID_COORDINATES', `${name} must be a finite number.`);
  }
  if (value < min || value > max) {
    return failure(
      'COORDINATES_OUT_OF_RANGE',
      `${name} must be between ${min} and ${max}, got ${value}.`
    );
  }
  return { value };
}

function validateOptional(raw, name, min, max, code) {
  if (raw === undefined || raw === null || raw === '') return { value: undefined };
  const value = toFiniteNumber(raw);
  if (value === null) {
    return failure(code, `${name} must be a finite number.`);
  }
  if (value < min || value > max) {
    return failure(code, `${name} must be between ${min} and ${max}, got ${value}.`);
  }
  return { value };
}

/**
 * Validates one driver position report. Accepts the flat REST body and the
 * nested WebSocket frame alike; the caller has already picked which fields to
 * pass in.
 *
 * @returns {{ ok: true, value: object } | { ok: false, code: string, message: string, status: number }}
 */
function validateDriverTelemetry(input = {}) {
  const lat = validateCoordinate(input.lat, 'Latitude', RULES.minLat, RULES.maxLat);
  if (!lat.ok && lat.code) return lat;

  const lng = validateCoordinate(input.lng, 'Longitude', RULES.minLng, RULES.maxLng);
  if (!lng.ok && lng.code) return lng;

  const speed = validateOptional(
    input.speed, 'Speed', 0, RULES.maxSpeedKmph, 'SPEED_IMPLAUSIBLE'
  );
  if (speed.code) return speed;

  const accuracy = validateOptional(
    input.accuracy, 'Accuracy', 0, RULES.maxAccuracyMeters, 'ACCURACY_IMPLAUSIBLE'
  );
  if (accuracy.code) return accuracy;

  let at = null;
  if (input.timestamp !== undefined && input.timestamp !== null && input.timestamp !== '') {
    const parsed = new Date(input.timestamp);
    if (Number.isNaN(parsed.getTime())) {
      return failure('TIMESTAMP_MALFORMED', 'Timestamp must be an ISO-8601 date the server can parse.');
    }
    const now = Date.now();
    if (parsed.getTime() > now + RULES.maxFutureSkewMs) {
      return failure('TIMESTAMP_IN_FUTURE', 'Timestamp is ahead of server time.');
    }
    if (now - parsed.getTime() > RULES.maxAgeMs) {
      return failure('TELEMETRY_STALE', 'Timestamp is older than the accepted reporting window.');
    }
    at = parsed;
  }

  const headingRaw = input.heading === undefined || input.heading === null || input.heading === ''
    ? { value: undefined }
    : validateOptional(input.heading, 'Heading', -360, 360, 'HEADING_INVALID');
  if (headingRaw.code) return headingRaw;

  return {
    ok: true,
    value: {
      lat: lat.value,
      lng: lng.value,
      speed: speed.value,
      accuracy: accuracy.value,
      heading: headingRaw.value,
      // The server's clock, never the client's: a fix that arrives late is stored
      // with the time it arrived, so a driver cannot age their position by lying
      // about when they took it.
      receivedAt: new Date().toISOString(),
      clientTimestamp: at ? at.toISOString() : null
    }
  };
}

module.exports = { validateDriverTelemetry, RULES };
