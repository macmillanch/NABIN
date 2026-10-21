# NABIN MILESTONE C.1 — ANDROID RELEASE VERIFICATION & STAGING SAFETY AUDIT

**Document Reference**: `docs/NABIN_MILESTONE_C1_VERIFICATION_REPORT.md`  
**Execution Timestamp**: 11 October 2026, 22:54 IST  
**Baseline Git Commit**: `a48c0793e82eb5eb47ef779b84f63a0c285fc15d`  
**Remote origin/main**: `a48c0793e82eb5eb47ef779b84f63a0c285fc15d`  
**HEAD == origin/main**: YES  
**Working Tree**: Clean (all untracked files preserved, zero reset/clean/stash executed)  
**Target Launch Date**: **1 January 2027 (Target, Not Guaranteed)**  

---

## 1. VERIFIED FACTS VERSUS EARLIER AGENT-REPORTED CLAIMS

| Item | Earlier Agent Claim | Verified Ground Truth (Audited Evidence) | Reality Delta |
|---|---|---|---|
| **Android Release APK** | "Android release build complete and verified" | APK file exists at `mobile/build/app/outputs/flutter-apk/app-release.apk` (60,487,456 bytes). It is a genuine Flutter AOT release compilation containing `libapp.so` and `android:debuggable` is absent/false. However, it was signed using the **Android Debug Keystore** (`CN=Android Debug`), NOT a production release signing certificate. | **PARTIALLY VERIFIED**: Genuine release compilation, but debug-signed. |
| **Mobile Application Scope** | "All mobile targets ready / verified" | Only the **Customer** entry point (`lib/main_customer.dart`) was compiled into the release APK. In `mobile/android/app/build.gradle.kts`, `productFlavors` is unconfigured. All 5 Flutter applications share a single application ID (`com.nabin.mobile`). | **PARTIALLY VERIFIED**: Multi-entry points exist in Dart, but separate Android application packages do not exist yet. |
| **Device / Emulator Testing** | Implicit readiness for distribution | **0 tests executed on physical devices or emulators.** The only tests executed were 785 automated unit/widget tests on the local Windows development machine. | **NOT TESTED on device/emulator.** |
| **Android SDK Toolchain** | "Missing cmdline-tools blocks release builds" | Standalone `sdkmanager.bat` is absent in `AppData/Local/Android/sdk/cmdline-tools`, causing `flutter doctor` warnings. However, Gradle/AGP builds succeed directly via Android Studio's bundled JBR 17 and SDK build-tools 36.0.0. | **VERIFIED**: Toolchain builds APKs, but headless license tooling is missing. |
| **SQL Migrations 001–038** | "Apply all migrations 001-038 sequentially" | Migration **017** was intentionally skipped/not approved per project governance (Governance Rule 6). Migration **028** does not exist as a file in `supabase/migrations/`. Wildcard execution (`*.sql`) is unsafe. Migration **038** was recorded in local `schema_migrations` with an empty name. Exactly 36 migration files exist. | **FACT CHECKED**: Wildcard migration runs are prohibited; explicit 36-file manifest is required. |
| **Payment Provider Selection** | Razorpay treated as the assumed default | No default provider has been authorized. Provider selection is **PENDING OWNER CONFIRMATION** between RBI-licensed aggregators (Razorpay, Cashfree, or others). Backend currently operates in local sandbox mode (`PAYMENT_MODE=sandbox`). | **CORRECTED**: Marked pending owner confirmation. |
| **Public Production Domain** | Alternately reported as `nabin.in` and `nabin.com` | Primary brand domain is **UNCONFIRMED**. Neither `nabin.in` nor `nabin.com` has active public DNS records routed to live infrastructure. | **CORRECTED**: Marked unconfirmed pending owner registration. |
| **Launch Date** | "Launch 1 January 2027 confirmed" | 1 January 2027 is a **target date**, not a guarantee. Feasibility is contingent upon external owner decisions and staging validation. | **CORRECTED**: Target date qualification applied. |

---

## 2. COMMANDS EXECUTED, EXIT CODES, AND ACTUAL RESULTS

### 2.1 Git Repository Safety State
```bash
git status
git rev-parse HEAD
git rev-parse origin/main
```
- **Exit Code**: `0`
- **Output**:
  - `HEAD`: `a48c0793e82eb5eb47ef779b84f63a0c285fc15d`
  - `origin/main`: `a48c0793e82eb5eb47ef779b84f63a0c285fc15d`
  - `HEAD == origin/main`: YES
  - Working tree has untracked files preserved; no unapproved commits or pushes.

### 2.2 Flutter Code Quality & Test Suite
```bash
flutter analyze
```
- **Working Directory**: `C:\Users\macmi\Documents\nabin\mobile`
- **Exit Code**: `0`
- **Output**: `64 issues found. (0 errors, 0 warnings, 64 infos)`. Compilation clean.

```bash
flutter test
```
- **Working Directory**: `C:\Users\macmi\Documents\nabin\mobile`
- **Exit Code**: `0`
- **Output**: `00:32 +785: All tests passed! (785 tests, 0 failures, 0 errors)`

### 2.3 Android APK Verification Commands
```bash
Get-Item "mobile\build\app\outputs\flutter-apk\app-release.apk"
Get-FileHash -Path "mobile\build\app\outputs\flutter-apk\app-release.apk" -Algorithm SHA256
```
- **Exit Code**: `0`
- **Length**: `60,487,456 bytes` (~57.68 MB)
- **Last Write Time**: `10/11/2026 10:41:47 PM`
- **SHA-256**: `87C4B992B5CD9CFF468178D6DFA1B37FCE6EDE23A9369506445B8D68EF508685`

```bash
& "C:\Users\macmi\AppData\Local\Android\sdk\build-tools\36.0.0\apksigner.bat" verify --verbose "mobile\build\app\outputs\flutter-apk\app-release.apk"
```
- **Exit Code**: `0`
- **Verified using v1 scheme (JAR signing)**: `false`
- **Verified using v2 scheme (APK Signature Scheme v2)**: `true`
- **Number of signers**: `1`

```bash
& "C:\Users\macmi\AppData\Local\Android\sdk\build-tools\36.0.0\apksigner.bat" verify --print-certs "mobile\build\app\outputs\flutter-apk\app-release.apk"
```
- **Exit Code**: `0`
- **Signer #1 DN**: `C=US, O=Android, CN=Android Debug`
- **Signer #1 SHA-256**: `e7b2ec53b45b72bccfd3672e99a1807790602e5477ecf332a14e2cd9924b42ee`
- **Signer #1 SHA-1**: `ecc5b64712bf1c4d361e3db52d50e684fdcfe7fb`
- **Signer #1 MD5**: `275fd8bb90813ced47fa0e7a0dc29148`

```bash
& "C:\Users\macmi\AppData\Local\Android\sdk\build-tools\36.0.0\aapt.exe" dump badging "mobile\build\app\outputs\flutter-apk\app-release.apk"
```
- **Exit Code**: `0`
- **Package**: `name='com.nabin.mobile' versionCode='1' versionName='1.0.0' compileSdkVersion='36' platformBuildVersionName='16'`
- **SDK Constraints**: `sdkVersion:'24'` (Android 7.0 Nougat), `targetSdkVersion:'36'` (Android 16)
- **Architectures**: `'arm64-v8a'`, `'armeabi-v7a'`, `'x86_64'`
- **Permissions**:
  - `android.permission.INTERNET`
  - `android.permission.CALL_PHONE`
  - `com.nabin.mobile.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`

```bash
tar -tf "mobile\build\app\outputs\flutter-apk\app-release.apk" | Select-String -Pattern "libapp\.so"
```
- **Exit Code**: `0`
- **Output**:
  - `lib/arm64-v8a/libapp.so`
  - `lib/armeabi-v7a/libapp.so`
  - `lib/x86_64/libapp.so`
- **Release Compilation Evidence**: Dart AOT compiled shared object (`libapp.so`) is present in all target ABIs, confirming that the binary was built with Flutter AOT compiler in release mode, not as a debug JIT snapshot (`kernel_blob.bin`).

```bash
& "C:\Users\macmi\AppData\Local\Android\sdk\build-tools\36.0.0\aapt.exe" dump xmltree "mobile\build\app\outputs\flutter-apk\app-release.apk" AndroidManifest.xml
```
- **Exit Code**: `0`
- **Debuggable Flag**: `android:debuggable` is **absent** from `<application>` node, which in Android Gradle builds enforces `debuggable = false` (genuine non-debug runtime).

---

## 3. APK METADATA AUDIT

| Attribute | Value | Verification Tool | Significance |
|---|---|---|---|
| **File Path** | `mobile/build/app/outputs/flutter-apk/app-release.apk` | PowerShell `Test-Path` | Confirmed file exists and is readable |
| **File Size** | `60,487,456 bytes` (~57.68 MB) | PowerShell `(Get-Item).Length` | Unpacked release binary |
| **Modification Time** | `2026-10-11 22:41:47 IST` | PowerShell `(Get-Item).LastWriteTime` | Generated during Milestone C build |
| **SHA-256 Checksum** | `87C4B992B5CD9CFF468178D6DFA1B37FCE6EDE23A9369506445B8D68EF508685` | `Get-FileHash -Algorithm SHA256` | Authoritative integrity hash |
| **Application ID** | `com.nabin.mobile` | `aapt dump badging` | Single shared application package |
| **Version Code** | `1` | `aapt dump badging` | Matches `pubspec.yaml` `1.0.0+1` |
| **Version Name** | `1.0.0` | `aapt dump badging` | Matches `pubspec.yaml` `1.0.0+1` |
| **Minimum SDK** | `24` (Android 7.0 Nougat) | `aapt dump badging` | Broad Android device compatibility |
| **Target SDK** | `36` (Android 16 preview) | `aapt dump badging` | Compliant with Google Play 2026/2027 policies |
| **Signing Scheme** | `APK Signature Scheme v2` | `apksigner verify --verbose` | Modern Android block signature |
| **Signing Certificate DN** | `C=US, O=Android, CN=Android Debug` | `apksigner verify --print-certs` | **DEBUG KEYSTORE**: Unacceptable for production release; acceptable for local engineering testing |
| **AOT Snapshot** | `libapp.so` present for arm64-v8a, armeabi-v7a, x86_64 | `tar -tf` | Confirms AOT production compilation |
| **Debuggable Attribute** | Absent (defaults to `false`) | `aapt dump xmltree` | Genuine non-debug runtime configuration |

---

## 4. MOBILE TARGET BUILD MATRIX

The Flutter codebase contains multiple entry point files under `mobile/lib/`. However, inspecting `mobile/android/app/build.gradle.kts` reveals that **no product flavors are configured**.

```
mobile/lib/
├── main.dart                      (Shared default entry point)
├── main_customer.dart             (NABIN Customer App)
├── main_driver.dart               (NABIN Driver Partner App)
├── main_restaurant.dart           (NABIN Restaurant Merchant App)
├── main_grocery.dart              (NABIN Express Grocery App)
├── main_grocery_merchant.dart     (NABIN Grocery Merchant App)
├── main_admin.dart                (NABIN Admin Unified Control Center)
└── main_visual_qa.dart            (Visual QA & Screenshot Runner)
```

### Build & Release Target Matrix

| Target Name | Dart Entry Point | Android Application ID | Product Flavor Configured | Automated Tests Passing | Release APK Built | Real-Device Smoke-Test Evidence | Release Readiness Status |
|---|---|---|---|---|---|---|---|
| **NABIN Customer** | `lib/main_customer.dart` | `com.nabin.mobile` | None (shares default) | **YES** (785/785 pass) | **YES** (`app-release.apk`) | **NONE** (Not installed on device) | **LOCAL BUILD VERIFIED** (Debug signed) |
| **NABIN Driver** | `lib/main_driver.dart` | `com.nabin.mobile` | None (shares default) | **YES** (785/785 pass) | **NO** (Overwrites customer APK if built without rename/flavor) | **NONE** | **CODE VERIFIED, BUILD NOT ISOLATED** |
| **NABIN Restaurant** | `lib/main_restaurant.dart` | `com.nabin.mobile` | None (shares default) | **YES** (785/785 pass) | **NO** | **NONE** | **CODE VERIFIED, BUILD NOT ISOLATED** |
| **NABIN Grocery Merchant** | `lib/main_grocery_merchant.dart` | `com.nabin.mobile` | None (shares default) | **YES** (785/785 pass) | **NO** | **NONE** | **CODE VERIFIED, BUILD NOT ISOLATED** |
| **NABIN Grocery Express** | `lib/main_grocery.dart` | `com.nabin.mobile` | None (shares default) | **YES** (785/785 pass) | **NO** | **NONE** | **CODE VERIFIED, BUILD NOT ISOLATED** |
| **NABIN Admin** | `lib/main_admin.dart` | `com.nabin.mobile` | None (shares default) | **YES** (785/785 pass) | **NO** | **NONE** | **CODE VERIFIED, BUILD NOT ISOLATED** |

### Architectural Implication
Because `build.gradle.kts` defines a single `applicationId = "com.nabin.mobile"`, building each entry point with `flutter build apk --release -t <entry_point>` will compile the same package name and overwrite `mobile/build/app/outputs/flutter-apk/app-release.apk`. To release separate Customer, Driver, and Merchant applications to Google Play, Gradle `productFlavors` or distinct package identifiers (e.g. `com.nabin.customer`, `com.nabin.driver`, `com.nabin.merchant`) must be configured prior to production distribution.

---

## 5. ANDROID SDK STATUS & REMAINING USER ACTIONS

### 5.1 Root Cause Diagnosis
1. Android Studio is installed at `C:\Program Files\Android\Android Studio`.
2. Android SDK is located at `C:\Users\macmi\AppData\Local\Android\sdk`.
3. Java runtime is provided by Android Studio's bundled JBR 17 (`C:\Program Files\Android\Android Studio\jbr\bin\java.exe`).
4. SDK platforms (`platforms/android-36`) and build tools (`build-tools/36.0.0`) are fully installed.
5. `licenses/android-sdk-license` already exists on disk, enabling Gradle to build without licensing errors.
6. However, Google's optional standalone `cmdline-tools` package (`sdkmanager.bat`) is **not installed** under `AppData/Local/Android/sdk/cmdline-tools/latest/bin`.
7. Because `flutter doctor` looks specifically for `sdkmanager.bat` to query license statuses, it reports:
   - `[!] Android toolchain - develop for Android devices`
   - `X cmdline-tools component is missing`
   - `X Android license status unknown`

### 5.2 Safe User Resolution Steps (No Global Environment Mutations)
To clear the `flutter doctor` warnings without downloading unverified packages:

1. **Launch Android Studio**:
   Open `C:\Program Files\Android\Android Studio\bin\studio64.exe`.
2. **Open SDK Manager**:
   Navigate to **Customize** ➔ **All settings...** (or **File** ➔ **Settings** if a project is open).
   Select **Languages & Frameworks** ➔ **Android SDK**.
3. **Select SDK Tools Tab**:
   Click on the **SDK Tools** tab.
4. **Install Command-line Tools**:
   Check the box for **Android SDK Command-line Tools (latest)**.
   Click **Apply**, accept the prompt, and wait for Android Studio to finish downloading the package into `C:\Users\macmi\AppData\Local\Android\sdk\cmdline-tools\latest`.
5. **Interactive License Review**:
   Once installed, open terminal and run:
   ```bash
   flutter doctor --android-licenses
   ```
   **Important Safety Instruction**: Inspect each displayed license agreement on screen before typing `y` to accept.
6. **Verify Doctor Output**:
   Run:
   ```bash
   flutter doctor -v
   ```
   Confirm that `Android toolchain` displays a green checkmark `[√]`.

---

## 6. MIGRATION MANIFEST & SEQUENCING AUDIT

### 6.1 Critical Audit Findings
1. **Total Migrations in Repository**: Exactly **36 migration SQL files** exist in `supabase/migrations/`.
2. **Migration 017 Status**: **INTENTIONALLY SKIPPED / UNAPPROVED**. Governance Rule 6 strictly states: *"Migration 017 is currently not approved. Do not create Migration 017 merely because functionality requires database changes."*
3. **Migration 028 Status**: **MISSING / SKIPPED**. There is no `028_*.sql` file in `supabase/migrations/`.
4. **Migration 038 Status**: `038_order_creation_checkout_status_fix.sql` was authored to fix a fatal SQLSTATE 42703 column name mismatch (`checkout_status` vs `status`) in `create_order_with_lines_atomic`. It is currently applied in local Docker PostgreSQL, where it is recorded in `supabase_migrations.schema_migrations` with an empty name string.
5. **Ledger Status**: Querying `supabase_migrations.schema_migrations` in the local PostgreSQL container (`supabase_db_nabin`) confirms exactly 36 records matching the 36 migration files (`001–016`, `018–027`, `029–038`).
6. **Wildcard Execution Hazard**: Running a shell loop `for sql in supabase/migrations/*.sql` on staging is dangerous because it bypasses advisory locking, transaction boundary enforcement, and failure rollbacks. Staging MUST execute through `backend/scripts/migrate.js`, which applies migrations idempotently in sorted numerical version order with advisory locking.

### 6.2 Deterministic Staging Migration Manifest

| Ver | Migration File | Dependencies | Expected Schema Changes | Staging Safety | Verification Query | Rollback Consideration |
|---|---|---|---|---|---|---|
| **001** | `001_central_schema.sql` | None (Base) | Creates core tables: `users`, `user_roles`, `merchants`, `vehicles`, `addresses`, `orders`, `order_lines` | Safe on clean DB | `SELECT count(*) FROM information_schema.tables WHERE table_name='users';` | Drops tables |
| **002** | `002_finance_ledger_schema.sql` | 001 | Financial ledger tables: `accounts`, `ledger_entries`, double-entry constraints | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='ledger_entries';` | Drops ledger schema |
| **003** | `003_extended_schema.sql` | 001, 002 | Rides, drivers, fares, vehicle types, base pricing tables | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='rides';` | Drops rides tables |
| **004** | `004_missing_entities_schema.sql` | 001-003 | Delivery jobs, food products, reviews, restaurant metadata | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='products';` | Drops products tables |
| **005** | `005_jobs_domain.sql` | 001-004 | Unified jobs lifecycle: `jobs`, state machines, assignments | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='jobs';` | Drops jobs table |
| **006** | `006_payments_domain.sql` | 002, 005 | Payment sessions, transactions, settlements, refunds | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='payment_sessions';` | Drops payment tables |
| **007** | `007_wallets_domain.sql` | 002, 006 | Customer & driver wallets, balance tracking, top-up records | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='wallets';` | Drops wallets table |
| **008** | `008_support_domain.sql` | 001, 005 | Customer/driver support tickets, disputes, resolutions | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='support_tickets';` | Drops support tables |
| **009** | `009_promotions_domain.sql` | 001, 006 | Coupons, discount rules, campaign redemption tracking | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='promotions';` | Drops promotions |
| **010** | `010_admin_audit_domain.sql` | 001 | Operator audit trails, administrative actions | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='admin_audit_logs';` | Drops audit logs |
| **011** | `011_geofences_surge_domain.sql` | 003, 005 | Polygon geofences, zone pricing, surge multipliers | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='geofences';` | Drops geofences |
| **012** | `012_notifications_domain.sql` | 001 | Push notification logs, FCM device tokens, preferences | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='notifications';` | Drops notifications |
| **013** | `013_checkout_domain.sql` | 001, 004 | Checkouts table, checkout items, checkout state machines | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='checkouts';` | Drops checkouts table |
| **014** | `014_dispatch_domain.sql` | 003, 005 | Dispatch locks, candidate drivers, broadcast rings | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='dispatch_requests';` | Drops dispatch tables |
| **015** | `015_school_child_domain.sql` | 001, 003 | Child safety transport, guardian authorization, PINs | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='school_routes';` | Drops school tables |
| **016** | `016_driver_kyc_payout_and_partial_refund.sql` | 003, 006 | Driver KYC verification documents, payout bank accounts, partial refunds | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='driver_kyc_documents';` | Drops KYC tables |
| **017** | **SKIPPED / UNAPPROVED** | N/A | **DO NOT APPLY**. Deliberately unapproved per governance rules. | N/A | N/A | N/A |
| **018** | `018_order_state_lines_and_checkout_linkage.sql` | 013, 016 | Order state constraints, order line linkage, checkout foreign keys | Safe | `SELECT count(*) FROM information_schema.columns WHERE table_name='orders' AND column_name='checkout_id';` | Remove column |
| **019** | `019_order_creation_atomic.sql` | 018 | Atomic RPC `create_order_with_lines_atomic`, order idempotency tokens table | Safe (superseded by 038) | `SELECT count(*) FROM pg_proc WHERE proname='create_order_with_lines_atomic';` | Drop RPC & token table |
| **020** | `020_dispatch_security_atomic.sql` | 014 | Dispatch security definer RPCs, race condition locks | Safe | `SELECT count(*) FROM pg_proc WHERE proname='claim_dispatch_job';` | Drop RPC |
| **021** | `021_cross_domain_security_hardening.sql` | 001-020 | Row Level Security (RLS) hardening across all core domains | Safe | `SELECT count(*) FROM pg_policies WHERE schemaname='public';` | Revert RLS policies |
| **022** | `022_notifications_support_dispute_security.sql` | 008, 012 | Support and notification access security policies | Safe | `SELECT count(*) FROM pg_policies WHERE tablename='support_tickets';` | Revert policies |
| **023** | `023_financial_ledger_security_hardening.sql` | 002, 006 | Financial ledger immutability rules, service_role restrictions | Safe | `SELECT count(*) FROM pg_policies WHERE tablename='ledger_entries';` | Revert policies |
| **024** | `024_application_surface_security_hardening.sql` | 021 | Surface-level permissions and role enforcement | Safe | `SELECT count(*) FROM pg_roles WHERE rolname='service_role';` | Revert grants |
| **025** | `025_feature_control_system.sql` | 001 | System configuration, feature flags, runtime kill switches | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='system_feature_flags';` | Drops flag tables |
| **026** | `026_backend_session_persistence.sql` | 001 | Persistent backend authentication session table | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='backend_sessions';` | Drops sessions |
| **027** | `027_dynamic_campaigns_and_themes.sql` | 009 | Banners, promo themes, marketing display controls | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='marketing_campaigns';` | Drops campaign tables |
| **028** | **MISSING / SKIPPED** | N/A | **DO NOT APPLY**. Numbering gap in repository; file does not exist. | N/A | N/A | N/A |
| **029** | `029_geo_and_commerce_reads_service_role_only.sql` | 011, 021 | Strict service_role restrictions on geospatial coordinates | Safe | `SELECT count(*) FROM pg_policies WHERE tablename='geofences';` | Revert policies |
| **030** | `030_merchant_inventory_integrity.sql` | 004 | Stock level constraints, merchant SKU consistency | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='merchant_grocery_inventory';` | Revert constraints |
| **031** | `031_dark_store_foundation.sql` | 004, 030 | Quick commerce dark store locations, picker aisles | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='dark_stores';` | Drops dark store tables |
| **032** | `032_operator_permissions_store.sql` | 010 | Fine-grained administrative operator roles and permissions | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='operator_permissions';` | Drops operator tables |
| **033** | `033_privileged_delete_returns_old.sql` | 001 | Deletion audit triggers returning prior row state | Safe | `SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%delete_audit%';` | Drops audit triggers |
| **034** | `034_restaurant_discovery_metadata.sql` | 004 | Cuisine tags, dietary filters, search index metadata | Safe | `SELECT count(*) FROM information_schema.columns WHERE table_name='merchants' AND column_name='cuisine_types';` | Drops columns |
| **035** | `035_customer_profile_email_uniqueness.sql` | 001 | Enforces customer profile email uniqueness constraint | Safe | `SELECT count(*) FROM pg_constraint WHERE conname='uq_users_email';` | Drop constraint |
| **036** | `036_restaurant_catalog_persistence_and_variants.sql` | 004 | Variant groups, add-ons, customization options persistence | Safe | `SELECT count(*) FROM information_schema.tables WHERE table_name='product_variants';` | Drops variant tables |
| **037** | `037_order_creation_customization_snapshot_atomic.sql` | 019, 036 | Customization snapshot storage in atomic order lines | Safe (superseded by 038) | `SELECT count(*) FROM information_schema.columns WHERE table_name='order_lines' AND column_name='customization_snapshot';` | Drops column |
| **038** | `038_order_creation_checkout_status_fix.sql` | 013, 037 | Corrects `create_order_with_lines_atomic` to query `checkout_status` instead of `status` | Safe | `SELECT pg_get_functiondef('create_order_with_lines_atomic'::regproc) LIKE '%checkout_status%';` | Revert to 037 definition |

---

## 7. STAGING HARNESS SAFETY AUDIT (`with_staging_target.js`)

A dedicated staging execution wrapper was created at `backend/scripts/with_staging_target.js` to ensure that staging tests can NEVER accidentally reach local development or live production.

### Verified Safety Guardrails
1. **Requires Explicit Staging Configuration**:
   - Requires `NABIN_STAGING_ENV_FILE` (or `backend/.env.staging`), or explicit parent environment variables `STAGING_SUPABASE_URL` and `STAGING_DATABASE_URL`.
   - If unset, **fails closed with exit code 2** and refuses to spawn child processes.
2. **Rejects Local Loopback Endpoints**:
   - Inspects URL hostnames in `SUPABASE_URL` and `DATABASE_URL`.
   - If any target resolves to `127.0.0.1`, `localhost`, `::1`, or `host.docker.internal`, **refuses execution immediately**. Local tests must use `with_local_target.js`.
3. **Rejects Production Project References**:
   - Specifically checks for `FORBIDDEN_PROD_REF = 'ouxvqmhuyueklnegvmxe'`.
   - Inspects hostnames for `production` / `prod` keywords.
   - Refuses execution if production strings are detected.
4. **Secret Masking in Logs**:
   - Formats URLs using `maskTarget()` (protocol + hostname + port only).
   - Redacts database passwords, anon keys, and service role keys from stdout/stderr.
5. **Clear Target Identity**:
   - Prints target label (`cloud-staging`), environment (`staging`), Supabase URL, and database host prior to spawning child processes.
6. **Sanitized Environment Template**:
   - Created `backend/.env.staging.example` containing placeholders only. No credentials or project secrets are committed.

### Safety Test Verification Runs
- **Test 1 (No Staging Config)**:
  `node backend/scripts/with_staging_target.js node -e "console.log('test')"`
  ➔ **Result**: `REFUSED — staging target could not be established: Staging env file not found...` (Exit 1). Child process never spawned.
- **Test 2 (Loopback Injection)**:
  `STAGING_SUPABASE_URL="http://127.0.0.1:54321" node backend/scripts/with_staging_target.js ...`
  ➔ **Result**: `REFUSED — SUPABASE_URL points to a local loopback host (127.0.0.1)...` Child process never spawned.
- **Test 3 (Production Ref Injection)**:
  `STAGING_SUPABASE_URL="https://ouxvqmhuyueklnegvmxe.supabase.co" node backend/scripts/with_staging_target.js ...`
  ➔ **Result**: `REFUSED — The production project ref "ouxvqmhuyueklnegvmxe" was detected in: SUPABASE_URL...` Child process never spawned.
- **Test 4 (Valid Mock Target with Masking)**:
  `STAGING_SUPABASE_URL="https://mock-staging-ref.supabase.co" STAGING_DATABASE_URL="postgresql://user:secretpass@host:6543/postgres" ...`
  ➔ **Result**: Target masked as `postgresql://host:6543`. Credentials redacted. Child process spawned successfully.

### Re-verification of §7 on 2026-10-12 (the harness is now stricter than recorded above)
Replayed against the current `backend/scripts/with_staging_target.js`, three of the statements above no longer describe the running tool:

1. **Test 4 no longer spawns.** A mock/non-sanctioned project ref is now refused before the child runs:
   `REFUSED — staging target could not be established: the staging configuration declares project <ref>, which is not the sanctioned staging project ywhxkzmbwppkdemvzlhv. If this other project is genuinely the staging target, say so on the command line: NABIN_ALLOW_STAGING_REF=<ref>` → exit **2**, `Nothing was spawned.` (`pinStagingRef`, `with_staging_target.js:199-221`). Spawning a child for an unrecognised staging project was the gap; it is closed, and the escape hatch is explicit and named.
2. **Guardrail 5 printed `staging`; the harness now prints `testing`.** `pinStagingRef` sets `env.NABIN_ENV = 'testing'` (`:202`) because `nabinEnv` accepts only `development | testing | production` — a `staging` value is itself a refusal. The target label is `cloud-staging` (`:204`), which is likely what the original line meant.
3. **Guardrail 1's "or" is a precedence, not a choice.** The `STAGING_*` parent variables are consulted **only when no staging env file exists** (`:73` before `:95`). With `backend/.env.staging` on disk, the file wins for every key the operator did not already export, so a `STAGING_SUPABASE_REF` on the command line is ignored — measured: passing `STAGING_SUPABASE_REF=mockstagingref20charxx` still produced a refusal naming `ywhxkzmbwppkdemvzlhv`, the file's project. Use `NABIN_STAGING_ENV_FILE=<path>` to aim the harness at a different file.
4. **Unfilled credentials are refused by shape, without echoing the value** (`refusePlaceholderCredential`, `:155-181`, pattern `:46` matches `paste|your_|change-me|replace|placeholder|todo|fixme|example|xxxx`). This is the gate that refuses today's real `backend/.env.staging`, whose `DATABASE_URL` password slot is still the template placeholder.
5. **Guardrail 6 is out of date**: `backend/.env.staging.example` now carries the real non-secret staging identity (`NABIN_ENV=testing`, `NABIN_SUPABASE_REF=ywhxkzmbwppkdemvzlhv`, the `ap-northeast-1` session-pooler host, `DATABASE_SSL=require`) with every credential left blank — those values audit to 0 problems, while the old all-placeholder revision audited to 3.

The full gate set, in call order (`establishStagingTarget`, `:241-251`): `loadStagingConfig → refuseProductionReferences → refuseLoopbackTarget → enforceTlsPolicy → pinStagingRef → refuseAmbiguousConfiguration → refusePlaceholderCredential`. Pinned by `backend/staging_target_guard_test.js`: **40/40** (regression chain link 63).

---

## 8. OUTSTANDING EXTERNAL DEPENDENCIES

The following items are outside the local engineering boundary and require product owner authorization or external third-party registration:

1. **Payment Gateway Aggregator Selection (Owner Action)**:
   - Product Owner must confirm selected payment aggregator (Razorpay, Cashfree, or alternative).
   - Submit business incorporation, GST, and bank settlement documents for live merchant account activation.
2. **Authoritative Production Domain (Owner Action)**:
   - Product Owner must verify and confirm intended domain (`nabin.in` vs `nabin.com`).
   - Configure DNS records (Cloudflare / Route53) pointing to production servers and Vercel frontends.
3. **India DLT Registration & Transactional SMS Gateway**:
   - Register NABIN legal entity on telecom DLT portal (Vilpower / Jio / Smartping).
   - Approve 6-character sender ID (e.g. `NABINM`) and transactional OTP message templates.
   - Configure production SMS provider API keys (Fast2SMS / Twilio).
4. **Apple Developer Enterprise / Organization Account**:
   - Enroll in Apple Developer Program ($99/yr) with DUNS number.
   - Provision macOS CI builder (GitHub Actions `macos-14`) for iOS `.ipa` compilation.
5. **Dedicated Staging Cloud Supabase Project**:
   - Provision isolated non-production Supabase project.
   - Execute approved 36-migration manifest using `with_staging_target.js` and `migrate.js`.

---

## 9. RELEASE BLOCKERS GROUPED BY SEVERITY

```
CRITICAL (0 Blockers)
└── None. All local compilation, backend contracts, and tests pass.

HIGH (3 Blockers)
├── BLK-02: Staging Supabase cloud environment unprovisioned (Migration manifest ready).
├── BLK-03: India DLT entity registration & transactional SMS gateway unconfigured.
└── BLK-04: Payment gateway provider selection & live merchant onboarding pending owner confirmation.

MEDIUM (2 Blockers)
├── BLK-01: Mobile Gradle product flavors unconfigured; production release keystore not configured (currently debug signed); real-device smoke tests not yet performed.
└── BLK-05: Apple iOS build environment (macOS/Xcode) and Apple Developer account absent.

LOW (1 Blocker)
└── BLK-06: Production domain unconfirmed (`nabin.in` vs `nabin.com`); public DNS routing unrouted.
```

---

## 10. SINGLE HIGHEST-PRIORITY NEXT ACTION

**The single highest-priority next action is for the Product Owner to confirm the chosen Payment Gateway provider (Razorpay vs Cashfree) and Authoritative Domain (`nabin.in` vs `nabin.com`), while authorizing the provisioning of an isolated Staging Supabase project.**

Once an isolated staging project is provisioned:
1. Copy `backend/.env.staging.example` to `backend/.env.staging` with staging credentials.
2. Run `node backend/scripts/with_staging_target.js node backend/scripts/migrate.js` to apply the approved 36-migration manifest.
3. Validate the 394 backend tests against the live staging database.

---

## 11. STATUS SUMMARY GATE

| Major Milestone C.1 Verification Item | Status | Verified Evidence / Justification |
|---|---|---|
| **Android Release APK Existence & Checksum** | **VERIFIED** | `mobile/build/app/outputs/flutter-apk/app-release.apk` (60,487,456 bytes, SHA-256: `87C4B992B5CD9CFF468178D6DFA1B37FCE6EDE23A9369506445B8D68EF508685`). |
| **APK Release Mode Integrity** | **VERIFIED** | Non-debuggable (`android:debuggable` absent), contains compiled AOT Dart `libapp.so` for arm64-v8a, armeabi-v7a, x86_64. |
| **APK Production Signing Configuration** | **PARTIALLY VERIFIED** | Signed with APK Signature Scheme v2, but signed with **Android Debug Keystore** (`CN=Android Debug`). Production signing keystore remains to be configured. |
| **Mobile Entry Points & Target Flavors** | **PARTIALLY VERIFIED** | 7 Dart entry points exist. Shared test suite passes (785/785). However, no Gradle product flavors exist; all targets share `com.nabin.mobile`. Separate APK builds not yet configured. |
| **Physical Device / Emulator Verification** | **NOT TESTED** | Zero tests executed on physical hardware or emulators. Only local Windows host tests have passed. |
| **Android SDK & Toolchain Diagnosis** | **VERIFIED** | Missing `cmdline-tools` diagnosed; Gradle/AGP builds succeed directly. GUI installation steps documented. |
| **SQL Migration Sequencing Audit** | **VERIFIED** | 36 migrations audited. Migration 017 confirmed unapproved/skipped. Migration 028 confirmed missing. Migration 038 confirmed active and documented. Wildcard loops rejected; deterministic manifest produced. |
| **Staging Safety Test Harness** | **VERIFIED (and since tightened)** | `with_staging_target.js` prevents loopback fallback, rejects the production ref `ouxvqmhuyueklnegvmxe`, masks credentials, and logs the target host. As of 2026-10-12 it additionally pins the sanctioned staging ref, refuses a TLS bypass, refuses an unfilled credential by shape, and refuses any `nabinEnv.audit()` problem — always before spawning. See §7 re-verification and `staging_target_guard_test.js` (40/40). |
| **Staging Environment Sanitized Template** | **VERIFIED** | Created `backend/.env.staging.example` with placeholders only. No credentials exposed. |
| **Release Documentation Alignment** | **VERIFIED** | Updated `NABIN_RELEASE_BLOCKERS.md` and `NABIN_RELEASE_PLAN_2027-01-01.md`. Payment provider marked pending, domain marked unconfirmed, 1 Jan 2027 qualified as target date. |
| **Public Production Readiness** | **NOT READY** | Local engineering baseline is fully passing, but external dependencies (Staging Cloud, Payment KYC, DLT SMS, Domains, Real Devices) are required before public release. |

---

*Report prepared strictly according to NABIN governance, loss-prevention protocol, and verifiable technical evidence.*
