'use client';

import ModuleScreen from '@/components/modules';

/**
 * Finance. Metrics only, straight from `/api/admin/finance/metrics`.
 *
 * There is no write control on this screen by decision. Money leaves the platform through the
 * guarded, atomic, idempotent finance routes and the ledger stays balanced by `journal_lines`
 * constraints; a dashboard button that could move a balance is not this page's job.
 */
export default function FinancePage() {
  return <ModuleScreen name="finance" />;
}
