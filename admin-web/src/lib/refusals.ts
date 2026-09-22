/**
 * One reader for the way the admin API refuses (directive 4, spec §2.7).
 *
 * A refusal arrives in three classes and an operator has to tell them apart from one line:
 *
 *   4xx  the request is wrong — fix it and send it again.
 *   5xx  the platform is unreachable — change nothing, retry later.
 *   5xx with `applied: true`  the change **landed** and only its audit record failed. This
 *        is not a rejection and retrying it can double-apply a real mutation, so the copy
 *        says "reconcile this", never "nothing happened".
 *
 * The backend already sends the server's own words in `error`; they go to the operator
 * verbatim rather than being re-derived here, because the route knows which of the three
 * classes it is answering and this file does not.
 */
export interface Refusal {
  message: string;
  code: string | null;
  applied: boolean;
  status: number | null;
  requestId: string | null;
}

interface RefusalBody {
  error?: unknown;
  code?: unknown;
  applied?: unknown;
  requestId?: unknown;
}

export function readRefusal(err: unknown, fallback: string): Refusal {
  const response = (err as { response?: { status?: unknown; data?: RefusalBody } })?.response;
  const body = response?.data ?? {};
  const serverMessage = typeof body.error === 'string' && body.error.trim() ? body.error.trim() : null;
  const applied = body.applied === true;
  const code = typeof body.code === 'string' ? body.code : null;
  const status = typeof response?.status === 'number' ? response.status : null;
  const requestId = typeof body.requestId === 'string' ? body.requestId : null;

  if (applied) {
    // The dangerous one, so it leads with the fact rather than the failure.
    return {
      message: `This landed, and its audit record could not be written${serverMessage ? `: ${serverMessage}` : ''} Do not repeat the action — reconcile the missing record instead.${requestId ? ` (ref ${requestId})` : ''}`,
      code,
      applied,
      status,
      requestId
    };
  }

  return {
    message: serverMessage ?? fallback,
    code,
    applied,
    status,
    requestId
  };
}

/**
 * The three classes are also the three places a `catch` with no body goes wrong: an
 * unreachable store answered by a network-layer rejection has no `response` at all, and
 * "your input is invalid" is a lie there. Used when the caller has no server copy to show.
 */
export function readTransportFailure(err: unknown, fallback: string): string {
  const hasResponse = Boolean((err as { response?: unknown })?.response);
  return hasResponse ? fallback : `${fallback} The platform API could not be reached — this is our outage, not your request.`;
}
