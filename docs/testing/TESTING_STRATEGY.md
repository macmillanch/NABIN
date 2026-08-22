# NABIN — Automated QA Testing Strategy

**Author**: QA Engineer Agent ([`qa_engineer`](file:///c:/Users/Macmillan/OneDrive/Documents/nabin/.agents/skills/qa_engineer/SKILL.md))  
**Source Agency Agent**: `msitarzewski/agency-agents`

## 1. Test Suite Architecture (`backend/test_suite.js`)
The test suite validates 20 automated checks across 7 core categories:
1. **Health & Platform Status**: Verification of service availability and active metric reporting.
2. **Admin Authentication & RBAC**: Token generation, role-permission verification, team provisioning.
3. **Audit Log Trail**: Retrieval and verification of structured action logs.
4. **Support & Disputes**: Customer ticket creation, message threading, dispute resolution with automated wallet refund crediting.
5. **Finance & Ledger**: GTV metrics calculation, transaction ledger audit, manual credit adjustment processing.
6. **Promotions & Coupons**: Server-side coupon discount calculation and usage enforcement.
7. **Geofencing & Surge**: Zone deployment, surge multiplier calculation, fare estimation.

## 2. Test Execution Command
```bash
node backend/test_suite.js
```
- Benchmark: **20/20 PASSED (100% Pass Rate)**.
