'use client';

import ModuleScreen from '@/components/modules';

/**
 * Audit trail from `/api/admin/audit-logs`.
 *
 * Credential fields are not part of the audit projection, so there is nothing to redact here;
 * the screen names the operator, the action, the target and the result, and states the endpoint
 * it read so a report can be traced back to a source.
 */
export default function AuditPage() {
  return <ModuleScreen name="audit" />;
}
