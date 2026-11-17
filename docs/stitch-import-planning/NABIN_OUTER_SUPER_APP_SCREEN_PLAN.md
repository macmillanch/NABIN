# NABIN — OUTER SUPER-APP REQUIRED SCREEN PLAN

**Document ID:** NABIN-PLAN-SUPERAPP-001  
**Project ID:** `489536988828642080`  
**Vertical Accent:** Master Royal Blue (`#1A3BA2`)  
**Total Production Screens:** 22 Screens  

---

## Screen Register & Specifications

| Plan ID | Existing Stitch ID | Screen Name | Role / Purpose | Entry Point | Exit Destination | Shared State Dependencies |
|---|---|---|---|---|---|---|
| **SA-01** | `fe175b02116a41378bce7610fe0302ca` | NABIN-001 Welcome & App Launch | Brand intro & language selection | Cold Start | SA-02 Onboarding | Selected Language |
| **SA-02** | `ca7bb89261e5490b8d4d837db30d5e66` | NABIN-004 Service Showcase | 4-service overview & value prop | SA-01 | SA-03 Login | Auth state check |
| **SA-03** | `914b2d8d1b2e4c8f978f842f3dc6677e` | NABIN-009 Customer Login (+91) | Indian mobile phone input | SA-02 | SA-04 OTP | Phone number controller |
| **SA-04** | `f0ec18963c354e4d96787ae49fe2199b` | NABIN-011 6-Digit OTP Verification | SMS OTP validation & resend | SA-03 | SA-05 Address Setup | Auth token, Session JWT |
| **SA-05** | `0d1bd11f0b8e4681a9eeeb5d0a01670c` | NABIN-016 Location & Landmark Setup | Mandatory Indian Landmark Input | SA-04 / Header tap | SA-07 Map Confirm | Active Landmark & Geohash |
| **SA-06** | `0efd059860294b53a73d7d8a7a6929df` | NABIN-017 Manual Address Search | Autocomplete street / locality | SA-05 | SA-07 Map Confirm | Search query & Places API |
| **SA-07** | `346245e0177f45cf934bdf560678e2c4` | NABIN-018 Pin-on-Map Confirmation | Draggable pin + landmark tag | SA-05 / SA-06 | SA-08 Home | Saved Address Book |
| **SA-08** | `6404eca20f12433bad74944b71b6c8f4` | NABIN-021 Main Marketplace Home | 2x2 Service Grid & Floating Order Bar | Main entry | Ride/Food/Grocery/Parcel | Active orders provider |
| **SA-09** | `2920c8771b934807b6fff455e671fc07` | NABIN-022 Universal Search Hub | Cross-service discovery | SA-08 Top Bar | Deep links to services | Search query |
| **SA-10** | `5ecd27de1c1546479ee98587c9e31f9f` | NABIN-025 Universal Search Empty State | "No results" with trending tags | SA-09 | SA-08 Home | Category suggestions |
| **SA-11** | `ac83522cf3b2423893b2d8feb2952e4e` | NABIN-033 Unified Activity & History | Poly-service order timeline | Bottom Nav | Order detail view | History repository |
| **SA-12** | `774e06e5abec4305abd74ce8fd3cd459` | NABIN-039 Notifications Hub | Operational & promo alerts | Top Bell Icon | Respective order tracker | Push notification stream |
| **SA-13** | `d8895b2847934e41b2d36f13f3cd6121` | NABIN-041 Notification Preferences | Push / WhatsApp / SMS toggles | SA-12 / Profile | SA-12 | User preferences |
| **SA-14** | `4787dd61b6184401a0e992869d8476ce` | NABIN-043 Customer Profile & Account | Personal info, emergency contacts | Bottom Nav | Sub-settings | User profile model |
| **SA-15** | `4f915e269ef1476e983eabbc9fbbd5e1` | NABIN-044 Saved Addresses Management | Home, Work, Other tag editor | SA-14 / Checkout | SA-14 | Address book |
| **SA-16** | `f12158b4317f40ec8ae284eeff0f06f7` | NABIN-045 Payment Methods & Wallet | UPI Intent, Cards, NABIN Cash | SA-14 / Checkout | SA-14 | Wallet balance & cards |
| **SA-17** | `0d45d4e686014b3dbd55e5cb5c9a493d` | NABIN-046 Manage Favourites | Saved restaurants & kirana stores | SA-14 | Service details | Bookmarks repository |
| **SA-18** | `5f23d43289824c0484f38c82f8aef8d4` | NABIN-047 Offers & Promotions | Ecosystem coupon directory | SA-08 Banner | SA-19 Offer Details | Promo engine |
| **SA-19** | `c698c47ebdcd4a2c8b3a195d4e863425` | NABIN-048 Offer Details Modal | Terms & apply code trigger | SA-18 | Respective service | Promo coupon code |
| **SA-20** | `acce6e05294645429a0d825ff861f28a` | NABIN-053 Help & Customer Support | Chat, FAQs, Ticket submission | SA-14 / Orders | Support chat | Zendesk / Internal ticket |
| **SA-21** | `d48d4e68ec034b9cb7a29b2ee79e7c67` | NABIN-061 Offline / No Internet State | Offline banner with retry | Network error | Active screen | Connectivity status |
| **SA-22** | `c0400b8fb868471fb0f63443b1628fd9` | NABIN-062 Server Error / 500 State | Degraded mode indicator | API error | SA-08 Home | Server health status |
