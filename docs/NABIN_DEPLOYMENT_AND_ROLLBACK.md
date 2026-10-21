# NABIN — DEPLOYMENT AND ROLLBACK OPERATIONAL RUNBOOK

**Document Reference**: `docs/NABIN_DEPLOYMENT_AND_ROLLBACK.md`  
**Current Date**: 11 October 2026  
**Target Release**: 1 January 2027  
**Status**: APPROVED OPERATIONAL STANDARD  

---

## 1. ARCHITECTURE DEPLOYMENT MODEL

```
                                  [DNS / CDN]
                          (Cloudflare / Route53)
                                    │
           ┌────────────────────────┼────────────────────────┐
           │                        │                        │
     [Vercel Edge]           [Load Balancer]          [Vercel Edge]
   Customer / Admin          (HTTPS / WSS)          Merchant Portals
      Web Apps                      │                    Web Apps
                                    ▼
                         [NABIN Unified Backend]
                         (Docker / ECS / Cloud Run)
                                    │
                                    ▼
                         [Supabase PostgreSQL]
                       (Primary DB + Auth + Storage)
```

---

## 2. PRE-DEPLOYMENT GATES

Before ANY deployment to Staging or Production, ALL of the following criteria must be satisfied:

1. **Git State Verification**:
   ```bash
   git status --short
   git rev-parse HEAD
   git rev-parse origin/main
   ```
   *Requirement*: Working tree must be clean, and `HEAD == origin/main`.
2. **Local Regression Verification**:
   All 7 core test suites must pass 100% against local Docker target:
   - `test_migration_019.js` (52/52 PASS)
   - `restaurant_catalog_checkout_test.js` (28/28 PASS)
   - `test_phase7_security.js` (46/46 PASS)
   - `driver_operations_test.js` (66/66 PASS)
   - `admin_identity_gates_test.js` (74/74 PASS)
   - `test_phase4_orders.js` (66/66 PASS)
   - `test_phase5_payments.js` (62/62 PASS)
3. **Web Production Builds**:
   All 5 Next.js web applications must compile cleanly with zero TypeScript errors (`npm run build`).
4. **Database Migration Dry-Run**:
   All new migrations must be validated on an isolated database clone before applying to shared environments.
5. **Secrets & Environment Isolation**:
   Verify that staging/production environment variables do not leak local development credentials or vice versa.

---

## 3. DATABASE MIGRATION PROCEDURES

### Migration Safety Rules
- Migrations 001 through 016 are locked legacy baselines.
- Migrations 017 through 038 must be applied sequentially.
- Every migration must be **backward-compatible** with existing running backend code (expand-and-contract pattern).
- Never run `DROP TABLE`, `TRUNCATE`, or destructive column drops during deployment.

### Application Sequence
1. **Pre-Migration Backup**:
   Take full transactional snapshot of PostgreSQL:
   ```bash
   pg_dump -h <DB_HOST> -U postgres -d postgres --format=custom --file=nabin_pre_migration_$(date +%Y%m%d_%H%M%S).dump
   ```
2. **Apply Migrations Sequentially**:
   ```bash
   # In staging/production CI pipeline:
   supabase db push --include-all
   # Or using explicit psql pipeline:
   for f in supabase/migrations/*.sql; do
     psql -h <DB_HOST> -U postgres -d postgres -f "$f"
   done
   ```
3. **Verify Migration Status**:
   ```sql
   SELECT version, inserted_at FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 10;
   ```

---

## 4. BACKEND CONTAINER DEPLOYMENT

### Build & Package
```bash
docker build -t nabin-backend:release-20270101 -f backend/Dockerfile backend/
```

### Staged Rollout (Rolling / Blue-Green)
1. Deploy new container version with `HEALTHCHECK` configured on `GET /api/health`.
2. Traffic router waits for health check to answer `200 { status: 'healthy', database: 'connected' }`.
3. Shift 10% traffic -> verify error rate (< 0.01%).
4. Shift 100% traffic -> terminate previous container revision.

---

## 5. WEB APPLICATION DEPLOYMENT (VERCEL)

### Deployment Commands
```bash
# Customer Web
cd customer-web && vercel --prod
# Admin Web
cd admin-web && vercel --prod
# Restaurant Merchant Web
cd restaurant-merchant-web && vercel --prod
# Grocery Merchant Web
cd grocery-merchant-web && vercel --prod
# Unified Merchant Web
cd merchant-web && vercel --prod
```

### Post-Deploy Smoke Checks
- Verify landing page loads and static assets return HTTP 200.
- Verify API connectivity to backend `/api/health`.
- Verify user session persistence across page reloads.

---

## 6. ROLLBACK PROCEDURES

### Scenario A: Web Frontend Failure
- **Trigger**: Client-side JavaScript errors, broken layout, or failed API calls.
- **Action**: Immediate rollback in Vercel dashboard:
  1. Open Vercel Project -> Deployments.
  2. Locate previous stable deployment -> Click "Instant Rollback / Promote to Production".
  3. Rollback executes in < 30 seconds with zero downtime.

### Scenario B: Backend Service Failure
- **Trigger**: Error rate > 1%, uncaught exceptions, or latency spike > 2000ms.
- **Action**:
  1. Route traffic back to previous container image:
     ```bash
     docker service update --image nabin-backend:previous-stable nabin_backend_service
     ```
  2. Verify previous container answers `/api/health` successfully.
  3. Inspect crash logs and Sentry alerts.

### Scenario C: Database Migration Failure
- **Trigger**: Migration failure, lock contention, or SQLSTATE exception.
- **Action**:
  1. If migration was additive (new tables/columns): **DO NOT ROLL BACK DB IMMEDIATELY**. Revert backend code to previous release while leaving additive schema intact.
  2. If data corruption occurred: Restore from pre-migration dump:
     ```bash
     pg_restore -h <DB_HOST> -U postgres -d postgres --clean --if-exists nabin_pre_migration_<TIMESTAMP>.dump
     ```
  3. If Supabase Point-in-Time-Recovery (PITR) is enabled:
     Restore database to exact timestamp prior to migration start.

---

## 7. INCIDENT RESPONSE & EMERGENCY KILL SWITCHES

NABIN implements dedicated operational kill switches controlled by Super Admin:

1. **Service Pause Kill Switches**:
   - Pause Ride Hailing: `POST /api/admin/services/ride/pause`
   - Pause Food Delivery: `POST /api/admin/services/food/pause`
   - Pause Grocery Mart: `POST /api/admin/services/grocery/pause`
   - Impact: Instantly refuses new bookings with HTTP 423 and broadcast notice without taking down web servers.
2. **Maintenance Mode**:
   - Backend returns HTTP 503 with operational advisory for unauthenticated clients while allowing admin triage.
3. **Audit Trail**:
   - Every kill switch actuation is durably logged in `public.audit_logs` with operator identity, IP address, and timestamp.
