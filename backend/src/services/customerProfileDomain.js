/**
 * The declared domain of a customer's own profile name and email address.
 *
 * `users.name` and `users.email` are the two identity fields a customer is allowed to
 * state about themselves (001_central_schema.sql:18-19). Until now nothing in this
 * backend could write either one on the customer's own behalf: the only writer of
 * `users.name`/`users.email` was the identity submission's side effect, so the profile
 * screen could only ever display what another flow had put there — including the
 * placeholder every sign-in mints (`<phone>@user.nabin.in`, database.js).
 *
 * What these validators protect is that a name and an address on a NABIN account were
 * stated by the person who owns it, and nothing else. So the writable set is exactly
 * two columns, and the rules are deliberately narrow:
 *
 *   name   1-100 characters after trimming, matching the column. `users.name` is
 *          NOT NULL, so an empty name has no representation in the row: it is refused,
 *          not stored as a blank.
 *   email  lowercased and trimmed, ≤ 150 characters, syntactically an address, and
 *          unique across accounts (migration 035's partial index). An emptied field
 *          means "not stated" and clears the column to NULL — the same reading
 *          `restaurantProfileDomain` gives an emptied cover-image field, and the reason
 *          migration 035 keeps NULL and empty out of its uniqueness rule.
 *
 * The email rule is a SYNTAX check, not a verification. There is no mail transport in
 * this backend (`grep -rin "nodemailer\|smtp\|sendEmail" backend/src` returns nothing)
 * and no verification column in the schema (`grep -rin "email_verified"
 * supabase/migrations` returns nothing), so nothing here can claim an address was
 * confirmed, and a customer who states someone else's address is only stopped by the
 * uniqueness rule below. That gap is stated rather than papered over: an account's email
 * is a self-reported detail, not a proven one.
 *
 * Nothing else is writable through this door. `wallet_balance`, `account_status`,
 * `identity_status`, `dob`, `address`, `rating`, `phone` and every id column are absent
 * from the patch by construction — a key the caller sends that is not `name` or `email`
 * is dropped here, so it cannot reach the UPDATE statement no matter what the body
 * claims. Changing a password or an identity document is a different domain with
 * different guards, and this one refuses to stand in for it.
 *
 * Partial-update semantics match `restaurantProfileDomain`: `undefined` (key absent)
 * means "leave the column alone", `null` means "clear it where the column allows it",
 * anything else must validate.
 */

const NAME_MAX_LENGTH = 100;   // users.name VARCHAR(100) NOT NULL
const EMAIL_MAX_LENGTH = 150;  // users.email VARCHAR(150)

// A pragmatic address shape: something before the @, a host, and a dot-separated label
// of at least two characters. Deliberately not an RFC 5322 parser — the cases that
// matter here are the accidental ones (no @, no domain, a space in the middle, a
// truncated paste), and every exotic form this would accept is still one mailbox that
// either exists or does not.
const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

class CustomerProfileValueError extends Error {
  constructor(field, reason, received) {
    super(`${field} ${reason}`);
    this.code = 'INVALID_CUSTOMER_PROFILE';
    this.status = 400;
    this.statusCode = 400;
    this.field = field;
    this.reason = reason;
    // Never echo a whole value into a log line or an error body if it is long; the
    // caller needs to know which field failed, and the first 80 characters is enough.
    this.received = typeof received === 'string'
      ? received.slice(0, 80)
      : JSON.stringify(received);
  }
}

function validateName(raw) {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') {
    throw new CustomerProfileValueError('name', 'must be a text value', raw);
  }
  const value = raw.trim();
  if (value === '') {
    throw new CustomerProfileValueError(
      'name',
      'cannot be empty — this account needs a name to show, and the column does not hold a blank one',
      raw,
    );
  }
  if (value.length > NAME_MAX_LENGTH) {
    throw new CustomerProfileValueError('name', `must be at most ${NAME_MAX_LENGTH} characters`, raw);
  }
  return value;
}

/**
 * @returns {string|null|undefined} the address to store, or NULL for "not stated".
 */
function validateEmail(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'string') {
    throw new CustomerProfileValueError('email', 'must be an email address or null', raw);
  }
  const value = raw.trim().toLowerCase();
  if (value === '') return null;   // an emptied field means "no address on file"
  if (value.length > EMAIL_MAX_LENGTH) {
    throw new CustomerProfileValueError('email', `must be at most ${EMAIL_MAX_LENGTH} characters`, raw);
  }
  if (/\s/.test(value)) {
    throw new CustomerProfileValueError('email', 'must not contain spaces', raw);
  }
  if (!EMAIL_PATTERN.test(value)) {
    throw new CustomerProfileValueError('email', 'must be a valid email address like name@example.com', raw);
  }
  return value;
}

/**
 * Reads the two writable profile fields off a request body.
 *
 * @returns {{fields: string[], patch: object}} `fields` names what the caller actually
 *          sent, so the caller can refuse an update that would change nothing. `patch`
 *          holds snake_case column names only — nothing outside `name` and `email` can
 *          appear in it, because the object is built from the two lines below and not
 *          from the body.
 * @throws {CustomerProfileValueError} on any value outside the domain.
 */
function validateCustomerProfilePatch(body) {
  const source = body && typeof body === 'object' ? body : {};
  const name = validateName(source.name);
  const email = validateEmail(source.email);

  const patch = {};
  const fields = [];
  if (name !== undefined) { patch.name = name; fields.push('name'); }
  if (email !== undefined) { patch.email = email; fields.push('email'); }
  return { fields, patch };
}

module.exports = {
  validateName,
  validateEmail,
  validateCustomerProfilePatch,
  CustomerProfileValueError,
  NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
};
