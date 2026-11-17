# NABIN — PARCEL REQUIRED SCREEN PLAN

**Document ID:** NABIN-PLAN-PARCEL-001  
**Project ID:** `14684086286758455985`  
**Vertical Accent:** Vibrant Purple (`#7047B8`)  
**Total Production Screens:** 26 Screens  

---

## Screen Register & Specifications

| Plan ID | Existing Stitch ID | Screen Name | Role / Purpose | Entry Point | Exit Destination |
|---|---|---|---|---|---|
| **PC-01** | `511354bd17a54dc9b8ad973d862c0db0` | PARCEL-001 Parcel Home | Service overview, send package CTA | Super-App Home | PC-02 Pickup Loc |
| **PC-02** | `86fe00ebef044744bc7d4011648c3f9b` | PARCEL-002 Pickup Location Selection | Sender address + mandatory landmark | PC-01 | PC-03 Drop Loc |
| **PC-03** | `731f5e6bedd147a59fbd4edb9bf3477b` | PARCEL-003 Drop-Off Location Selection | Receiver address + mandatory landmark | PC-02 | PC-04 Map Confirm |
| **PC-04** | `af886ae0f5e34b7c85bdf6cca9d031e6` | PARCEL-004 Route Map Confirmation | Distance & route overview | PC-03 | PC-05 Category |
| **PC-05** | `148ece1d7d2e49d1a4cb9206f34a823d` | PARCEL-005 Package Type Selection | Documents, Food, Electronics, Box | PC-04 | PC-06 Details |
| **PC-06** | `0e2fc83e8efe412cbf6214d1a0b1c51a` | PARCEL-006 Package Weight & Dimensions | <5kg, 5-15kg (2W) vs >15kg (3W Auto) | PC-05 | PC-07 Photo |
| **PC-07** | `85b3b86a310a4407a8e61f412263f8e2` | PARCEL-007 Package Photos | Visual condition snapshot | PC-06 | PC-08 Declaration |
| **PC-08** | `ada27834d7564171b47f51d68de4d6b7` | PARCEL-008 Contents Declaration | Prohibited items sign-off | PC-07 | PC-09 Sender Form |
| **PC-09** | `89bb56e556f1411291b84eee5a735885` | PARCEL-009 Sender Contact Details | Name, phone, floor/gate note | PC-08 | PC-10 Recipient |
| **PC-10** | `28cf908f60694ab89b6fdb7e2d46ac1b` | PARCEL-010 Recipient Contact Details | Name, phone, OTP receiver toggle | PC-09 | PC-11 Delivery Opt |
| **PC-11** | `4861a336556d48c5a601a8da04fd07b1` | PARCEL-011 Delivery Options | Standard vs. Express Priority | PC-10 | PC-12 Schedule |
| **PC-12** | `9e30484fcae645fc99c30c8f857d3685` | PARCEL-012 Schedule Pickup Slot | Instant dispatch vs. Later today | PC-11 | PC-13 Estimate |
| **PC-13** | `94aba707c59d4f2aa1b0362fe9663e60` | PARCEL-013 Price Estimate | Distance base fare + weight tier fee | PC-12 | PC-14 Review |
| **PC-14** | `d20da0d2ca3e4dafbdf1c99838150670` | PARCEL-014 Booking Review | Summary checklist & receiver OTP flag | PC-13 | PC-15 Payment |
| **PC-15** | `c91d96a2f8a4441ca17c012c638cecdf` | PARCEL-015 Payment Methods | UPI, Cards, Sender Pay vs Receiver Pay| PC-14 | PC-16 Confirmation |
| **PC-16** | `7341044dc58046ce9f3b104294ec6c67` | PARCEL-016 Booking Confirmation | Parcel tracking ID generated | PC-15 | PC-17 Matching |
| **PC-17** | `a03f875125b6438490138486a323112c` | PARCEL-017 Courier Radar Matching | Dispatch radar animation | PC-16 | PC-18 Assigned |
| **PC-18** | `dc1a79ced9ad442398897e7dc35a2ff1` | PARCEL-018 Courier Assigned | Courier name, plate number, phone | PC-17 | PC-19 Pickup Appr |
| **PC-19** | `f3f838d386ec40368dd484a9faaa37f3` | PARCEL-019 Pickup Approaching | Curbside countdown to pickup | PC-18 | PC-20 Verification |
| **PC-20** | `6bb1daeac1b545a8ab5f5618443abd64` | PARCEL-020 Package Pickup & Verification | Sender handover code & package photo | PC-19 | PC-21 In Transit |
| **PC-21** | `574e644636074f8a9488fce1c7b654f9` | PARCEL-021 Parcel In Transit | Live map vector to destination | PC-20 | PC-23 Handover |
| **PC-22** | `70095da745c64463968f179c61177b8a` | PARCEL-022 Customer & Courier Chat | Route guidance & delivery instructions | PC-21 Chat | PC-21 Transit |
| **PC-23** | `8d9e63cecd18420182201290486e00f0` | PARCEL-023 Delivery Handover & Proof (POD) | Recipient 4-digit OTP & POD photo | PC-21 | PC-24 Delivered |
| **PC-24** | `f64dcf78b7d84e3ca11be00900b4a7b8` | PARCEL-024 Parcel Delivered | Delivery timestamp & signed receipt | PC-23 | Super-App Home |
| **PC-25** | `130391a5eed84ca794c2a156f7658d79` | PARCEL-025 Booking History & Details | Past parcels, download invoice | Profile Activity| PC-24 Delivered |
| **PC-26** | `18a23fb8c7fa4586b6ae2c6c083ace5b` | PARCEL-026 Cancellation, Support & Edge States | Recipient unavailable / return to sender | Edge state | PC-01 Home |
