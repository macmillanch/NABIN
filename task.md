# NABIN Project Task Tracker

**Last Updated**: 2026-09-19  
**Current Phase**: Stitch Design Freeze Preparation  
**Git Branch**: main  
**Base Commit**: d0f9d00

---

## Handover Artifacts Created

| File | Status |
|------|--------|
| `scratch/stitch_canonical_manifest.json` | ✅ Created |
| `scratch/canonical_manifest_generator.js` | ✅ Created |
| `nabin_234_visual_qa.json` | ✅ Created |
| `nabin_234_visual_qa.md` | ✅ Created |
| `nabin_stitch_scope_validation.md` | ✅ Created |
| `nabin_stitch_quality_audit.md` | ✅ Created |
| `nabin_stitch_final_status.json` | ✅ Created |
| `nabin_targeted_fix_report.json` | ✅ Created |
| `nabin_targeted_fix_report.md` | ✅ Created |
| `stitch_final_generation_report.json` | ✅ Created |
| `stitch_final_generation_report.md` | ✅ Created |

---

## Current State Verification

### Canonical Requirements: 234/234 ✅
- Customer App (Flutter): 48 screens
- Driver App (Flutter): 38 screens
- Restaurant Merchant App (Flutter): 32 screens
- Grocery Merchant App (Flutter): 30 screens
- Admin App (Flutter): 28 screens
- Customer Web (Next.js): 29 screens
- Admin Web (Next.js): 29 screens

### Targeted Corrections: 14/14 ✅
All 14 edits applied and verified via `get_screen`:
- Vehicle model compliance (3 categories: Bike, Auto, Taxi/Car)
- Grocery model compliance (no warehouse/dark store)
- Scope compliance (removed out-of-scope references)
- Admin auth screen title (metadata)

### Remaining Blocker: 1 Issue

#### req_adm_auth — Stitch Metadata Title
- **Current Title**: "NABIN Admin Brand Logo"
- **Required Title**: "NABIN Admin — Login"
- **UI Content**: ✅ Correct (login form with phone entry, OTP flow)
- **Action Required**: Change ONLY metadata/title via Stitch MCP
- **Verification**: Call `get_screen` on req_adm_auth, verify same screen ID, verify UI intact
- **Priority**: HIGH — Blocks Design Freeze

---

## Repository State

### Modified Files (Uncommitted)
- `admin-web/src/app/layout.tsx`
- `admin-web/src/app/page.tsx`
- `customer-web/src/app/layout.tsx`
- `mobile/lib/core/network/nabin_api_service.dart`
- `mobile/lib/core/widgets/nabin_service_card.dart`
- `mobile/lib/core/widgets/nabin_text_field.dart`
- `mobile/lib/features/admin/presentation/screens/admin_feature_controls_screen.dart`
- `mobile/lib/features/auth/presentation/screens/otp_verification_screen.dart`
- `mobile/lib/features/auth/presentation/screens/phone_entry_screen.dart`
- `mobile/lib/features/driver/presentation/screens/driver_app_shell.dart`
- `mobile/lib/features/grocery_merchant/presentation/screens/grocery_merchant_dashboard.dart`
- `mobile/lib/features/grocery_merchant/presentation/screens/grocery_merchant_inventory_screen.dart`
- `mobile/lib/features/grocery_merchant/presentation/screens/grocery_merchant_login_screen.dart`
- `mobile/lib/features/grocery_merchant/presentation/screens/grocery_merchant_order_detail_screen.dart`
- `mobile/lib/features/grocery_merchant/presentation/screens/grocery_merchant_orders_screen.dart`
- `mobile/lib/features/grocery_merchant/presentation/screens/grocery_merchant_otp_screen.dart`

### Untracked Files
- `admin-web/src/components/AdminLayout.tsx`
- `customer-web/src/components/`
- `mcp_out.txt`
- `mobile/lib/features/driver/presentation/widgets/`
- `readme.txt`

---

## Next Steps (In Order)

1. **Fix req_adm_auth metadata title** via Stitch MCP
   - Change title from "NABIN Admin Brand Logo" to "NABIN Admin — Login"
   - Verify via `get_screen` - same screen ID, UI intact
   
2. **Final Reconciliation** of 7 Stitch projects
   - Use canonical manifest + `get_screen` + `list_screens`
   - Confirm all 234 screens exist and match

3. **Design Freeze**
   - Create `nabin_stitch_design_freeze_report.md`
   - Create `nabin_stitch_design_freeze_report.json`
   - Include all required fields per handover

4. **Implementation Planning**
   - Inspect existing repository structure
   - Read `.agents/AGENTS.md` before modifying code
   - Map Stitch screens to actual application routes
   - Implement shared design tokens
   - Implement NABIN branding (Neuron Regular for logo, Inter for UI)
   - Preserve existing backend contracts

---

## Architectural Constraints (Locked)

### Vehicle Model
- 3 Categories: 2-WHEELER=Bike, 3-WHEELER=Auto, 4-WHEELER=Taxi/Car
- Service Modes (separate): Normal Ride, Shared Ride, Rental
- ONE Driver App for all categories

### Grocery Model
- Independent Merchant → Picks → Packs → Handover → Driver → Customer
- NO dark store, NO warehouse, NO picker, NO fulfillment center

### Branding
- Neuron Regular: NABIN wordmark ONLY
- Inter: All UI text
- Royal Blue: Primary color

### Scope
- 7 approved Stitch projects only
- 234 screens only
- 11 excluded projects (110 screens) permanently out of scope

---

## Implementation Priorities

1. Inspect existing repository structure
2. Read `.agents/AGENTS.md` before modifying code
3. Understand current implementation before changing anything
4. Map Stitch screens to actual application routes/screens
5. Implement shared design tokens
6. Implement NABIN branding
7. Add Neuron Regular as actual NABIN logo font
8. Keep Inter for normal UI
9. Preserve existing backend and security architecture
10. Implement real workflows (no fake/demo flows)
11. No simulated driver jobs, earnings, or API success responses
12. No fictional functionality

---

## Security Governance

- TEST → COMMIT → PUSH → VERIFY
- Never force push, rewrite history, destructive reset
- Never modify remote Supabase without explicit authorization
- Never commit `.kilo/`

---

## Notes

- Stitch MCP is configured and working (see `mcp_out.txt`)
- Do not expose API keys/tokens/credentials
- Do not create replacement MCP configurations
- Before any write operation, perform harmless live MCP read (get_screen on known screen)
- If Stitch quota exhausted: preserve state, continue local prep, resume when quota available