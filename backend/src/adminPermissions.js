/**
 * The single definition of what each administrator role may do.
 *
 * Before this, the answer existed three times and the copies disagreed: the boot sync
 * handed `SUPER_ADMIN` forty permission strings, `createAdminAccount` handed the same
 * role eighteen, and the bootstrap route handed it a third list again. Because the boot
 * sync overwrites the in-memory entry, an administrator provisioned through the API was
 * authorised differently *after the next restart* than at the moment they were created —
 * and which list won depended on a process lifetime rather than a decision. An audit of
 * "what may this account do" could not be answered from any of them.
 *
 * All three read paths now come through here, so a grant change is one edit with one
 * effect.
 *
 * The role set is closed by the database, not by this file:
 * `admin_accounts.role` carries `CHECK (role IN (...))` from
 * `backend/migrations/001_central_schema.sql:178`. Adding a role means a migration, so
 * the five names below are the only ones that can exist, and a row that somehow carries
 * anything else is a fault to refuse rather than a job to guess at.
 */

const KNOWN_ADMIN_ROLES = Object.freeze([
  'SUPER_ADMIN',
  'KYC_SPECIALIST',
  'OPERATIONS',
  'FINANCE_AUDITOR',
  'SUPPORT_AGENT'
]);

/**
 * The whole catalogue, in one list.
 *
 * Every string here corresponds to a guard or a field-level check that exists in the
 * code, and nothing outside it is checked anywhere. `SUPER_ADMIN` carries all of it
 * explicitly, which changes no decision — `requirePermission` already admits that role
 * by wildcard — but makes `GET /api/admin/me` report the same set the role can actually
 * exercise. It did not: the three copies this module replaces disagreed, so a freshly
 * bootstrapped administrator was shown `campaign.*` while a restart-synced one was not,
 * and eleven guarded routes (`advertisement.*`, `campaign.*`, `catalog.manage`,
 * `grocery.review`, `orders.manage`) appeared in nobody's list at all.
 *
 * Granting any of those to a *non*-super role is the area-33 matrix decision, and it is
 * made in `docs/ADMIN_FEATURE_SPECIFICATION.md` §4 rather than here: a name appears in a
 * non-super list below only because §4 says that role holds it. `customers.read` is the
 * first such grant made from the catalogue itself — before it, the matrix in §4 and the
 * lists here had never been reconciled, because no customer route existed to gate.
 */
const SUPER_ADMIN_GRANTS = Object.freeze([
  'admin_accounts.create', 'admin_accounts.manage',
  'advertisement.create', 'advertisement.edit', 'advertisement.delete',
  'audit.view', 'audit.export',
  'campaign.view', 'campaign.create', 'campaign.edit', 'campaign.publish', 'campaign.delete',
  'catalog.manage',
  'customers.read', 'customers.suspend',
  'finance.view', 'finance.refund', 'finance.adjust', 'finance.settlement',
  'fleet.manage',
  'geofence.view', 'geofence.create', 'geofence.edit', 'geofence.delete',
  'grocery.review',
  'identity_verification.view', 'identity_verification.review', 'identity_verification.approve',
  'identity_verification.reject', 'identity_verification.request_resubmission',
  'identity_documents.view', 'identity_documents.download',
  'merchant.manage',
  'notification.view', 'notification.broadcast',
  'orders.manage',
  'pricing.edit',
  'promotion.view', 'promotion.create', 'promotion.edit', 'promotion.activate',
  'security.view', 'security.session.revoke',
  'services.view', 'services.pause', 'services.resume', 'services.emergency_killswitch',
  'support.view', 'support.respond', 'support.resolve', 'support.escalate',
  'surge.view', 'surge.create', 'surge.edit', 'surge.activate'
]);

const KYC_SPECIALIST_GRANTS = Object.freeze([
  'identity_verification.view', 'identity_verification.review', 'identity_verification.approve', 'identity_verification.reject',
  'identity_verification.request_resubmission', 'identity_documents.view', 'audit.view'
]);

const OPERATIONS_GRANTS = Object.freeze([
  'identity_verification.view', 'customers.read', 'fleet.manage', 'merchant.manage', 'support.view', 'support.respond', 'geofence.view', 'surge.view'
]);

const FINANCE_AUDITOR_GRANTS = Object.freeze([
  'finance.view', 'finance.refund', 'finance.adjust', 'finance.settlement', 'audit.view'
]);

const SUPPORT_AGENT_GRANTS = Object.freeze([
  'support.view', 'support.respond', 'support.resolve', 'audit.view', 'customers.read'
]);

const ROLE_GRANTS = Object.freeze({
  SUPER_ADMIN: SUPER_ADMIN_GRANTS,
  KYC_SPECIALIST: KYC_SPECIALIST_GRANTS,
  OPERATIONS: OPERATIONS_GRANTS,
  FINANCE_AUDITOR: FINANCE_AUDITOR_GRANTS,
  SUPPORT_AGENT: SUPPORT_AGENT_GRANTS
});

function isKnownAdminRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_GRANTS, String(role || '').toUpperCase());
}

/**
 * The grants for a role, or `null` when the role is not one the schema allows.
 *
 * `null` rather than `[]` on purpose: an empty list is a legitimate answer for a role we
 * recognise and simply haven't granted anything, while `null` means the account itself is
 * not interpretable and the caller must decide what that means — refuse the sign-in,
 * refuse the write, or hydrate with nothing and say so in the log. What the callers must
 * not do is what this replaced: `defaultPermissionsMap[role] || defaultPermissionsMap.OPERATIONS`,
 * which turned an unreadable role into a job nobody assigned (database.js:3966 before the
 * fix). Falling back to `OPERATIONS` grants; falling back to `[]` only hides.
 */
function grantsForRole(role) {
  const normalised = String(role || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(ROLE_GRANTS, normalised) ? ROLE_GRANTS[normalised] : null;
}

/**
 * The gates, next to the grants they consult.
 *
 * These three lived in `server.js`, which meant two things. A test that wanted to prove a
 * refusal had to boot a second server on the port the first one holds, so the conditional
 * gate below — the one no real role can be denied by, because the grants never split that
 * way — was unprovable. And `adminHoldsPermission` was the only copy of the answer while
 * handlers kept re-spelling the question (`req.admin.permissions.includes(...)` plus a role
 * equality test), which is how the same permission came to be enforced four ways with four
 * wordings. A refusal that reads differently depending on which check caught you is not a
 * policy; it is whatever the nearest line of code happened to be.
 */
function adminHoldsPermission(admin, requiredPerm) {
  return Boolean(admin) && (admin.role === 'SUPER_ADMIN' ||
    (Array.isArray(admin.permissions) && admin.permissions.includes(requiredPerm)));
}

function permissionRefusal(req, res, requiredPerm, status) {
  return res.status(status).json({
    success: false,
    error: status === 401
      ? 'Authentication required'
      : `Access Denied: Missing required permission [${requiredPerm}]. Current role: ${req.admin.role}`,
    requestId: req.id
  });
}

/**
 * Route middleware: refuse before the handler unless the account holds `requiredPerm`.
 *
 * `SUPER_ADMIN` passes by wildcard before its list is consulted, which is why every probe
 * of a super-only name proves reachability and nothing about the grant.
 */
function requirePermission(requiredPerm) {
  return (req, res, next) => {
    if (!req.admin) return permissionRefusal(req, res, requiredPerm, 401);
    if (adminHoldsPermission(req.admin, requiredPerm)) return next();
    return permissionRefusal(req, res, requiredPerm, 403);
  };
}

// One route carries three different powers, so the decision in the body chooses which
// permission the call needs. An unknown decision is left to the method, which refuses it
// as a 400 — this gate is not a validator.
const IDENTITY_DECISION_PERMISSIONS = Object.freeze({
  APPROVE: 'identity_verification.approve',
  REJECT: 'identity_verification.reject',
  REQUEST_RESUBMISSION: 'identity_verification.request_resubmission'
});

function requireIdentityDecision(req, res, next) {
  const required = IDENTITY_DECISION_PERMISSIONS[String((req.body && req.body.decision) || '').toUpperCase()];
  if (!required) return next();
  if (!req.admin) return permissionRefusal(req, res, required, 401);
  if (adminHoldsPermission(req.admin, required)) return next();
  return permissionRefusal(req, res, required, 403);
}

module.exports = {
  KNOWN_ADMIN_ROLES,
  ROLE_GRANTS,
  isKnownAdminRole,
  grantsForRole,
  adminHoldsPermission,
  requirePermission,
  requireIdentityDecision,
  IDENTITY_DECISION_PERMISSIONS
};
