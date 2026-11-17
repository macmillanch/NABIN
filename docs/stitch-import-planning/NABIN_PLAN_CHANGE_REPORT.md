# NABIN — PLAN REVISION & CHANGE REPORT

**Document ID:** NABIN-CHANGE-REPORT-001  
**Date:** November 17, 2026  
**Auditor:** Principal Solution & UI/UX Architect  
**Status:** COMPLETE & AUDITED  

---

## 1. Summary of Incorporated Changes

| Section | Previous Draft (Plan 002) | Final Approved Plan (Plan 003) | Reason / Authority |
|---|---|---|---|
| **1. Ride Regulations** | Cited 2020 guidelines; hardcoded ₹25 stop fee and ₹2.50/min wait fee. | **Updated to MoRTH Motor Vehicle Aggregator Guidelines 2025 (MVAG 2025)** and applicable State rules. Stop fee and waiting rates converted to **configurable parameters in `city_rate_cards`**. | Regulatory accuracy under updated central & state aggregator frameworks. |
| **2. Food GST Treatment** | Basic 5% Section 9(5) assumption. | **Harmonized with the April 2025 "Specified Premises" Framework**: 5% GST on standalone cloud kitchens/restaurants under Section 9(5); 18% GST tier automatically applied if premises declared room tariff is $\ge$ ₹7,500/day. | Compliance with statutory notification amendments effective April 2025. |
| **3. Grocery HSN Rates** | Category-based tax slabs. | **Strict HSN code + packaging/labelling condition architecture**: Rates driven dynamically by 8-digit HSN code + `is_prepackaged_labelled` flag (CBIC Notifs 06/2022 & 07/2022). | Statutory GST Council compliance. |
| **4. Parameter Rigidity** | Fixed numeric values in plan text. | **All operational and business parameters marked as configurable database attributes** (`city_rate_cards`, `tax_engine_config`). | Flexibility across diverse municipal and Tier-1/2/3 launch zones. |
| **5. Screen ID Collision Check** | Abstract gap IDs. | **Assigned explicit, unique identifiers (`SA-GAP-01`, `RD-GAP-01`, `FD-GAP-01`, `GR-GAP-01`)** with zero collision risk against existing IDs. | Preservation of original screen references. |
| **6. Stitch Cloud Safety Audit** | Unverified assertion. | **Live verified against all 176 instances**: Zero modifications, renames, or deletions have been made in Google Stitch. | Mandatory non-destructive governance rule. |

---

## 2. Preservation Status Audit Certificate
- **Google Stitch Cloud Status:** **100% UNMODIFIED**
- **Existing Screen Instances:** **176 of 176 INTACT**
- **Original Screen IDs:** **100% PRESERVED**
- **13 Super-App Duplicate Screens:** **PRESERVED IN STITCH AS REFERENCE DESIGNS**
- **Ready for Implementation Authorization:** **YES**
