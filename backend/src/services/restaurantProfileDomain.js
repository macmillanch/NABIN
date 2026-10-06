/**
 * The declared domain of a restaurant's own discovery profile.
 *
 * Migration 034 added `merchants.cuisines`, `merchants.cover_image_url` and
 * `merchants.standard_delivery_minutes`, and `GET /api/restaurants` projects all three.
 * Before this file the only way those columns could be written was a direct
 * service-role call, which is how a nullable column becomes a lie: the first person
 * to fill it in would do it without bounds, and the customer card would render it.
 *
 * What these validators protect is the card's central claim — that a cuisine, a
 * photograph and a delivery window on a NABIN restaurant were stated by the restaurant.
 * So the rules are deliberately narrow:
 *
 *   cuisines                   ≤ 12 entries, each 1–40 characters after trimming, no
 *                              duplicates ignoring case. No fixed list of allowed
 *                              cuisines: this schema has no cuisine taxonomy, and an
 *                              allowlist invented here would become the taxonomy by
 *                              accident. The empty list and null both mean "not declared".
 *   cover_image_url            absolute http(s) URL, ≤ 2048 characters, with a host.
 *                              Not a dish image and not a campaign image — those are
 *                              `products.image_url` and `advertisements.image_url`.
 *                              This string is fetched by the customer's device, so a
 *                              `file://`, `javascript:` or data: URI is refused at the
 *                              boundary rather than relying on the client to filter it.
 *   standard_delivery_minutes  whole number, 5–180, matching the column CHECK exactly.
 *                              It is the merchant's own stated window, not an SLA and
 *                              not a live ETA; above 180 the number stops being a
 *                              delivery time and becomes an apology.
 *
 * Nothing here can set `merchants.rating`. There is no reviews table in this schema,
 * so a rating written through this route would be a fabricated score with an
 * authenticated face on it. Ratings need a ratings domain.
 *
 * Partial-update semantics match `inventoryDomain`: `undefined` (key absent) means
 * "leave the column alone", `null` means "clear it", anything else must validate.
 */

const CUISINE_MAX_COUNT = 12;            // chk_merchants_cuisines_cardinality
const CUISINE_MAX_LENGTH = 40;
const COVER_URL_MAX_LENGTH = 2048;       // chk_merchants_cover_image_url_scheme
const DELIVERY_MINUTES_MIN = 5;          // chk_merchants_standard_delivery_minutes
const DELIVERY_MINUTES_MAX = 180;

class RestaurantProfileValueError extends Error {
  constructor(field, reason, received) {
    super(`${field} ${reason}`);
    this.code = 'INVALID_RESTAURANT_PROFILE';
    this.status = 400;
    this.statusCode = 400;
    this.field = field;
    this.reason = reason;
    this.received = typeof received === 'string' ? received : JSON.stringify(received);
  }
}

function validateCuisines(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!Array.isArray(raw)) {
    throw new RestaurantProfileValueError('cuisines', 'must be an array of cuisine names', raw);
  }
  if (raw.length > CUISINE_MAX_COUNT) {
    throw new RestaurantProfileValueError(
      'cuisines',
      `must not list more than ${CUISINE_MAX_COUNT} cuisines — the card shows one line and the filter shows one circle each`,
      raw,
    );
  }
  const cleaned = [];
  const seen = new Set();
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      throw new RestaurantProfileValueError('cuisines', 'must contain only names, not numbers or objects', entry);
    }
    const name = entry.trim();
    if (name === '') {
      throw new RestaurantProfileValueError('cuisines', 'must not contain a blank entry', entry);
    }
    if (name.length > CUISINE_MAX_LENGTH) {
      throw new RestaurantProfileValueError('cuisines', `each name must be at most ${CUISINE_MAX_LENGTH} characters`, name);
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      throw new RestaurantProfileValueError('cuisines', 'must not repeat a cuisine', name);
    }
    seen.add(key);
    cleaned.push(name);
  }
  return cleaned;
}

function validateCoverImageUrl(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'string') {
    throw new RestaurantProfileValueError('coverImageUrl', 'must be a URL string or null', raw);
  }
  const value = raw.trim();
  if (value === '') return null; // an emptied text field means "no banner", same as null
  if (value.length > COVER_URL_MAX_LENGTH) {
    throw new RestaurantProfileValueError('coverImageUrl', `must be at most ${COVER_URL_MAX_LENGTH} characters`, value);
  }
  if (/\s/.test(value)) {
    throw new RestaurantProfileValueError('coverImageUrl', 'must not contain spaces', value);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch (err) {
    throw new RestaurantProfileValueError('coverImageUrl', 'must be an absolute URL', raw);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new RestaurantProfileValueError('coverImageUrl', 'must be an http or https URL', value);
  }
  if (parsed.hostname === '') {
    throw new RestaurantProfileValueError('coverImageUrl', 'must name a host', value);
  }
  return value;
}

function validateStandardDeliveryMinutes(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  let value = raw;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!/^\d{1,3}$/.test(text)) {
      throw new RestaurantProfileValueError('standardDeliveryMinutes', 'must be a plain whole number of minutes', raw);
    }
    value = Number(text);
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new RestaurantProfileValueError('standardDeliveryMinutes', 'must be a whole number of minutes', raw);
  }
  if (value < DELIVERY_MINUTES_MIN || value > DELIVERY_MINUTES_MAX) {
    throw new RestaurantProfileValueError(
      'standardDeliveryMinutes',
      `must be between ${DELIVERY_MINUTES_MIN} and ${DELIVERY_MINUTES_MAX} minutes`,
      raw,
    );
  }
  return value;
}

/**
 * Reads the three writable profile fields off a request body.
 *
 * @returns {{fields: string[], patch: object}} `fields` names what the caller actually
 *          sent, so the caller can refuse an update that would change nothing.
 * @throws {RestaurantProfileValueError} on any value outside the domain.
 */
function validateRestaurantProfilePatch(body) {
  const source = body && typeof body === 'object' ? body : {};
  const cuisines = validateCuisines(source.cuisines);
  const coverImageUrl = validateCoverImageUrl(source.coverImageUrl);
  const standardDeliveryMinutes = validateStandardDeliveryMinutes(source.standardDeliveryMinutes);

  const patch = {};
  const fields = [];
  if (cuisines !== undefined) { patch.cuisines = cuisines; fields.push('cuisines'); }
  if (coverImageUrl !== undefined) { patch.cover_image_url = coverImageUrl; fields.push('coverImageUrl'); }
  if (standardDeliveryMinutes !== undefined) {
    patch.standard_delivery_minutes = standardDeliveryMinutes;
    fields.push('standardDeliveryMinutes');
  }
  return { fields, patch };
}

module.exports = {
  validateCuisines,
  validateCoverImageUrl,
  validateStandardDeliveryMinutes,
  validateRestaurantProfilePatch,
  RestaurantProfileValueError,
  CUISINE_MAX_COUNT,
  CUISINE_MAX_LENGTH,
  COVER_URL_MAX_LENGTH,
  DELIVERY_MINUTES_MIN,
  DELIVERY_MINUTES_MAX,
};
