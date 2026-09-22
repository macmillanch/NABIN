/**
 * The client's copy of the server's permission predicate — for hiding, never for allowing.
 *
 * `adminHoldsPermission` in `backend/src/adminPermissions.js` is the enforcement point, and
 * nothing here changes what a request can do: a caller who types the URL still reaches the
 * route and still gets refused (§2.1 says Express is the only authorisation layer, and this
 * file is the reason that sentence has to stay true). What it decides is whether a screen
 * shows an operator a button that can only answer 403, which §11 answer 10 rules out: a
 * control whose permission the caller's `GET /api/admin/me` does not carry is hidden, and
 * the row says why.
 *
 * The predicate is duplicated on purpose and kept in the same shape as the server's:
 * `SUPER_ADMIN` passes by wildcard *before* its list is consulted. Checking only the list
 * would hide a control from the one account that can always use it, which is the inverse
 * bug and just as hard to see from the screen.
 */
export function heldPermissions(user: { permissions?: unknown } | null | undefined): string[] {
  const list = user?.permissions;
  return Array.isArray(list) ? (list as string[]).filter((p) => typeof p === 'string') : [];
}

export function holdsPermission(
  user: { role?: string | null; permissions?: unknown } | null | undefined,
  permission: string
): boolean {
  return user?.role === 'SUPER_ADMIN' || heldPermissions(user).includes(permission);
}

/**
 * Why a control is not on the screen. Names the permission rather than saying "unauthorised",
 * so the operator reads the same string the server would have refused with.
 */
export function missingGrantNote(
  user: { role?: string | null; permissions?: unknown } | null | undefined,
  permission: string
): string {
  return `Hidden: the ${user?.role ?? 'signed-in'} role holds no \`${permission}\` grant, so this action would be refused. Permissions come from the role and are not editable from the admin panel.`;
}
