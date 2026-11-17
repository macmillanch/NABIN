# NABIN — INCOMPLETE & DEFECTIVE SCREEN REPORT

**Document ID:** NABIN-INCOMPLETE-REPORT-001  
**Status:** AUDITED  

---

## 1. Identified Visual & Functional Incompleteness

| Project | Screen ID | Label | Identified Issue | Severity | Required Remediation |
|---|---|---|---|---|---|
| **Super-App** | `NABIN-016` | Location & Address Setup | Missing mandatory "Nearby Landmark" form validation state | **HIGH** | Add landmark error banner & input highlight |
| **Super-App** | `NABIN-021` | Main Marketplace Home | Floating order bar only displays static mock text | **MEDIUM** | Replace with multi-vertical dynamic state provider |
| **Ride** | `RIDE-002` | Location Search | Lacks intermediate waypoint "+" button | **MEDIUM** | Add multi-stop waypoint input row |
| **Ride** | `RIDE-009` | Driver Approaching | OTP badge lacks high-contrast visual lock container | **HIGH** | Standardize 4-digit curbside OTP card in Royal Blue |
| **Food** | `FOOD-008` | Dish Customization | Portion modifier lacks required vs optional label | **MEDIUM** | Enforce single-select radio for portion, multi-select for add-ons |
| **Food** | `FOOD-009` | Food Cart | Blanket tax display rather than Section 9(5) 5% breakdown | **HIGH** | Itemize Section 9(5) restaurant GST vs delivery partner fee |
| **Grocery** | `GROCERY-018` | Order Review & Checkout | Shows single GST bucket instead of item-level slabs | **HIGH** | Implement item-level GST breakdown (`0%`, `5%`, `12%`, `18%`) |
| **Grocery** | `GROCERY-022` | Product Replacement | Lacks clear price delta (+₹ / -₹) approval button | **HIGH** | Add price adjustment confirmation before item replacement |
| **Parcel** | `PARCEL-006` | Package Details | Weight slider lacks auto-vehicle tier trigger explanation | **HIGH** | Add dynamic banner: *"Parcels >15kg require Auto/3-Wheeler"* |
| **Parcel** | `PARCEL-023` | Delivery Handover | Lacks Proof of Delivery (POD) photo capture button | **MEDIUM** | Integrate receiver signature & camera snapshot card |
