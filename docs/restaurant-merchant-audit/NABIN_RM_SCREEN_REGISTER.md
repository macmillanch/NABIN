# NABIN RESTAURANT MERCHANT — COMPLETE SCREEN REGISTER
## Comprehensive 55-Instance Inventory & Screen Metadata Specification

**Document ID:** NABIN-RM-REGISTER-002  
**Stitch Project ID:** `6689743337313822856`  
**Date:** November 18, 2026  
**Auditor Roles:** Principal Product Designer, Flutter Solution Architect, QA Lead  
**Total Tracked Instances:** 55 (51 UI Screens, 1 System Architecture Document, 2 Brand Logo Assets, 1 Design System Asset)  

---

## 1. COMPLETE SCREEN REGISTER TABLE

| # | Screen ID | Stitch Resource ID | Screen Title | Module | Device Layout | Status | Purpose & Main Actions |
|---|---|---|---|---|---|:---:|---|
| 1 | `ASSET` | `4791187340104291236` | nabin-icon-primary-192.png | Brand Assets | MOBILE (164x192) | Complete | Brand asset vector/raster logo. Actions: Rendered in app headers & splash |
| 2 | `ASSET` | `4791187340104293202` | nabin-wordmark-primary-192.png | Brand Assets | MOBILE (661x192) | Complete | Brand asset vector/raster logo. Actions: Rendered in app headers & splash |
| 3 | `RM-001` | `dd716d3301f54be8b91c721b0f7afa42` | Merchant Welcome | Onboarding | MOBILE (780x2088) | Complete | App welcome & partner onboarding entrypoint. Actions: Login, Register Partner, Language toggle |
| 4 | `RM-002` | `402c95fffcbd40329d5096d85237f6d2` | Merchant Login | Onboarding | MOBILE (780x1768) | Complete | Phone/Email authentication screen. Actions: Input phone number, Send OTP, Alternate email login |
| 5 | `RM-003` | `00d6c02dd3d34693b682f4de937a4a5e` | OTP Verification | Onboarding | MOBILE (780x1768) | Complete | 6-Digit secure OTP verification. Actions: Input 6 digits, Resend code countdown, Auto-verify |
| 6 | `RM-004` | `29b909c19d9b4b9281ecbe3224ec81dd` | Restaurant Business Details | Onboarding | MOBILE (780x4556) | Complete | Restaurant business details form. Actions: Trade name, FSSAI number, Primary cuisine, Cost for two |
| 7 | `RM-005` | `89a6e4d8a5ff48e4919abc9bf108735a` | Restaurant Address and Location | Onboarding | MOBILE (780x2988) | Complete | Restaurant location, map pin & delivery geofence. Actions: Pin on map, Address fields, Delivery radius slider (km) |
| 8 | `RM-006` | `fa873154d3c24da5ac020d6274009798` | Business Documents | Onboarding | MOBILE (780x3540) | Complete | Business documents upload (FSSAI, GSTIN, PAN). Actions: Camera capture, PDF upload, Document expiry date |
| 9 | `RM-007` | `c24e641284a44f6c98d7130a827daef9` | Bank and Settlement Details | Onboarding | MOBILE (780x3078) | Complete | Bank account & settlement details (Penny-Drop). Actions: Account number, IFSC code, Account holder name, Verify |
| 10 | `RM-008` | `9b0db3c459604718be6e5bd4e03ad418` | Onboarding Progress and Verification Status | Onboarding | MOBILE (780x2844) | Complete | Onboarding verification progress & status. Actions: View review checklist, Resubmit rejected doc, Support |
| 11 | `RM-010` | `66d2ee3a77c44973a7d4858c1e2e63c0` | RM-010: Sales & Revenue Analytics | Analytics | MOBILE (780x3938) | Complete | Sales, revenue and order volume analytics. Actions: Date range filter, Gross sales graph, Average prep time |
| 12 | `RM-011` | `9c7464840c9144da910a2abe9be5105f` | RM-011: Dish Performance & Velocity | Analytics | MOBILE (780x5934) | Complete | Dish velocity, popularity & margins performance. Actions: Top selling dishes, High refund items, Margin analysis |
| 13 | `RM-013` | `8aaddc458d4940989e6c03639ac78095` | Order Details #NB-4825 | Order Management | MOBILE (780x3406) | Complete | Granular order details view with itemized checklist. Actions: View items, Check modifiers, Call rider, Print bill |
| 14 | `RM-014` | `cb0e39ec9c9345de9c58b165636cb8d6` | Accept Order | Order Management | MOBILE (780x2104) | Complete | Order acceptance modal with preparation time selection. Actions: Select prep time (+10m, +15m, +25m), Confirm accept |
| 15 | `RM-015` | `2a93a121365b436087e3d7c5ace52e1c` | Reject Order | Order Management | MOBILE (780x2920) | Complete | Structured order rejection dialog with reason codes. Actions: Select reason (Kitchen busy, Item out of stock), Reject |
| 16 | `RM-016` | `93a449da956b4b748927d1668c39219c` | Preparation Time Management | Order Management | MOBILE (780x3302) | Complete | Live prep time adjustment & kitchen rush controls. Actions: Add buffer time (+5m), Rush mode toggle, Alert floor |
| 17 | `RM-017` | `033618c92e754cd69c49b55d6ea11805` | Customer Order Issues & Disputes | Order Management | MOBILE (780x2956) | Complete | Customer order issues, missing items & chat dispute. Actions: Review dispute photo, Offer partial refund, Support chat |
| 18 | `RM-018` | `b5a5065fb27b461098964606a66e4a02` | Cancellation & Refund Management | Order Management | MOBILE (780x3456) | Complete | Cancellation review & refund ledger. Actions: View cancelled order reasons, Waive penalty, Audit log |
| 19 | `RM-020` | `1a7697156f5a40b2a2b41cec5b11db5c` | Order History | Order Management | MOBILE (780x3638) | Complete | Historical completed & cancelled orders archive. Actions: Search order ID, Filter by date/channel, Download receipt |
| 20 | `RM-021` | `d294e07f3ab2497fba1541dc7b4b3d50` | RM-021: New Kitchen Orders | KDS | MOBILE (780x3296) | Complete | KDS New incoming orders queue (Tier 1 chime). Actions: Audio alert, Start cooking button, Station assignment |
| 21 | `RM-022` | `524c9fdb53b64cc29453c00c595503eb` | RM-022: Preparing Orders | KDS | MOBILE (780x3264) | Complete | KDS Preparing orders stage with item strike-through. Actions: Check items done, SLA timer countdown, Bump to Ready |
| 22 | `RM-023` | `11415345ced64acd85af7760e3eb5e44` | RM-023: Ready Orders | KDS | MOBILE (780x3598) | Complete | KDS Ready orders & Expo staging dispatch hub. Actions: Shelf assignment, Verify 4-digit OTP, Complete handover |
| 23 | `RM-024` | `2a8567ffcbbe47998a5e75da75c58ad3` | RM-024: Kitchen Station Management | KDS | MOBILE (780x4250) | Complete | Kitchen station routing configuration. Actions: Create station (Wok, Tandoor, Bar), Map categories |
| 24 | `RM-025` | `ba8484f5fb06427ea43eb9172fc5c41c` | RM-025: KDS Display Settings | KDS | MOBILE (780x3828) | Complete | KDS display, audio alert and card layout settings. Actions: Card size toggle, Chime volume, Dark mode toggle |
| 25 | `RM-026` | `ccd50531c85d41efbb673a12b250e58a` | RM-026: Menu Overview | Menu Management | MOBILE (780x3484) | Complete | Menu catalog overview and active dish counts. Actions: Category navigation, Search menu, Add dish CTA |
| 26 | `RM-027` | `278dc833bfa54ae7b9780b7daa016dfa` | RM-027: Menu Categories | Menu Management | MOBILE (780x2748) | Complete | Menu categories manager. Actions: Reorder categories, Add category, Enable/disable aisle |
| 27 | `RM-028` | `9ad5f54b84b44e97a52aee49929b44b9` | RM-028: Dish Management | Menu Management | MOBILE (780x2292) | Complete | Dish management list with quick stock toggles. Actions: Toggle In-Stock / Out-of-Stock, Edit price, Delete dish |
| 28 | `RM-029` | `6c8cd939356142a98ada04aead573a0a` | RM-029: Add New Dish | Menu Management | MOBILE (780x3398) | Complete | Add new dish form with dietary signifiers. Actions: Dish name, Veg/Non-Veg/Egg pill, Price, Photo upload |
| 29 | `RM-030` | `bae7215212284ee1ba3ba78907368922` | RM-030: Edit Dish | Menu Management | MOBILE (780x3632) | Complete | Edit dish details, descriptions and portion pricing. Actions: Update price, Adjust packaging charge, Save changes |
| 30 | `RM-031` | `2240267ecb334ab99752fa3392fc6bdc` | RM-031: Dish Customization Management | Menu Management | MOBILE (780x3852) | Complete | Dish customization, modifier groups & add-ons manager. Actions: Add modifier group (Spice level, Extra cheese), Min/Max |
| 31 | `RM-032` | `aefb8602dfe84c4da29e6b15c34f3a5d` | RM-032: Menu Availability & Scheduling | Menu Management | MOBILE (780x3528) | Complete | Menu item availability scheduling (Breakfast/Dinner). Actions: Set time windows, Daily recurrence, Automatic off-hours |
| 32 | `RM-033` | `c1afad8c6d4345d5b940a6b3513a6062` | RM-033: Bulk Menu Management | Menu Management | MOBILE (780x2194) | Complete | Bulk menu update & quick inventory sync. Actions: Turn off all desserts, Quick price bump, Export CSV |
| 33 | `RM-034` | `69384befae9b400290de510847c4c7ae` | RM-034: Restaurant Profile & Outlets | Outlets & Store Operations | MOBILE (780x4244) | Complete | Restaurant profile, contact info & outlets selector. Actions: Edit manager phone, Update banner photo, View outlets |
| 34 | `RM-035` | `7d5cb02286ea4429960f066fdba83b60` | RM-035: Operating Hours & Shifts | Outlets & Store Operations | MOBILE (780x3152) | Complete | Store operating hours, weekly shifts & breaks. Actions: Set open/close time, Lunch break pause, Holiday presets |
| 35 | `RM-036` | `30eb516406ae498995607bd796c22b29` | RM-036: Multi-Outlet Network | Outlets & Store Operations | MOBILE (780x3026) | Complete | Multi-outlet network dashboard & brand switcher. Actions: Switch outlet, View consolidated revenue, Add branch |
| 36 | `RM-037` | `c8a080196b214c1dbab5f412e9799152` | RM-037: Service Channels & Fulfilment | Outlets & Store Operations | MOBILE (780x2842) | Complete | Service channel controls (Dine-in, Takeaway, Delivery). Actions: Toggle Dine-in ON/OFF, Toggle Delivery ON/OFF |
| 37 | `RM-038` | `75343f4435f0404e93a411ed3e4ef483` | RM-038: Emergency Store Pause | Outlets & Store Operations | MOBILE (780x3766) | Complete | Emergency store pause with countdown timer. Actions: Pause store for 30m / 1hr / today, Enter pause reason |
| 38 | `RM-040` | `013f6c58ff054fdaa22942477349ae1b` | RM-040: Printer Discovery & Pairing | Hardware & Printing | MOBILE (780x3544) | Complete | Thermal printer discovery & Bluetooth/LAN pairing. Actions: Scan BLE devices, Enter manual IP, Connect printer |
| 39 | `RM-041` | `981f326ac72a424391bc0e42fbd9ff63` | RM-041: Printer Configuration & Specs | Hardware & Printing | MOBILE (780x3614) | Complete | Printer configuration, paper width (58mm/80mm) & cut. Actions: Select 58mm/80mm, Set print density, Test print |
| 40 | `RM-042` | `422ec1707e3c4e8d932b13b4f014e7af` | RM-042: KOT Slip Layout & Preview | Hardware & Printing | MOBILE (780x2720) | Complete | KOT slip layout preview and font calibration. Actions: Toggle large font, Show modifiers, Print sample KOT |
| 41 | `RM-043` | `c321646840ec4a6294ed90c71258f70f` | RM-043: Customer Bill & Invoice Template | Hardware & Printing | MOBILE (780x3568) | Complete | Customer bill & GST tax invoice template customizer. Actions: Set header/footer, Show GST breakdown, Include QR code |
| 42 | `RM-044` | `ed9ccc3119964c4c9bd1bc50801c35e4` | RM-044: Auto-Print Routing Rules | Hardware & Printing | MOBILE (780x3512) | Complete | Auto-print routing matrix & station assignment. Actions: Map Kitchen Order to Printer 1, Bill to Printer 2 |
| 43 | `RM-045` | `87a6cd0498044fe1ba5925fcebe38f04` | RM-045: Print Queue & Diagnostics | Hardware & Printing | MOBILE (780x3340) | Complete | Print spooler queue, error recovery & telemetry. Actions: View pending jobs, Retry failed print, Clear jam log |
| 44 | `RM-046` | `3fa30319cc9e4f80abf12465acfe62be` | RM-046: Finance Overview & Payouts | Finance & Settlements | MOBILE (780x3910) | Complete | Finance overview, net payouts & balance card. Actions: View available balance, Request instant payout, History |
| 45 | `RM-047` | `0b452a6fbd50479b81f1025d49096a01` | RM-047: Daily Settlement & Statement | Finance & Settlements | MOBILE (780x4956) | Complete | Daily settlement statement with PDF/CSV export. Actions: Select settlement date, Download tax invoice, Breakdown |
| 46 | `RM-048` | `fb0e9ff1804a47a19ef02f7beeff06e0` | RM-048: Order Transaction Ledger | Finance & Settlements | MOBILE (780x2998) | Complete | Order transaction ledger with transparent line-item math. Actions: Inspect order gross, commission, deductions, net share |
| 47 | `RM-049` | `89051add0e7b402085a7778e0f0c4e5d` | RM-049: Commission & Deductions Breakdown | Finance & Settlements | MOBILE (780x4570) | Complete | Commission, delivery subsidy & deduction breakdown. Actions: View commission tier %, Payment gateway charge, TCS |
| 48 | `RM-050` | `4928b03b887f4b70b8766a59d80f620e` | RM-050: Bank Accounts & Payout Settings | Finance & Settlements | MOBILE (780x5122) | Complete | Bank account & payout schedule management. Actions: Set default payout account, Change schedule (Daily/Weekly) |
| 49 | `RM-051` | `4424ed00943d4a9c9be5bec46e6ea850` | RM-051: Tax & GST Reports | Finance & Settlements | MOBILE (780x5152) | Complete | Statutory tax reports & GSTR-1 preparation. Actions: Download GSTR-1 summary, Filter month, Export CSV |
| 50 | `RM-098` | `3fd25f47c21c434cb7ff6e439ab53ebe` | Thermal Printer Management | Hardware & Printing | MOBILE (780x2986) | Complete | Thermal printer management hub & status monitor. Actions: View active printers, Add new printer, Quick diagnostics |
| 51 | `RM-100` | `2e9deaf5e85b46ef92040c42bd687337` | KDS Kitchen Board | KDS | MOBILE (780x3420) | Complete | KDS Master Kitchen Board landscape overview. Actions: Multi-column live queue, Bump orders, Station filter |
| 52 | `RM-102` | `7c1f66e523614defb3715b9d59604db6` | Live Order Management | Order Management | MOBILE (780x2884) | Complete | Live order management & acceptance console. Actions: View incoming orders, Audio toggle, Accept, Reject |
| 53 | `RM-104` | `aa10b7fa682b4b9f9dc7a0cf46c040a2` | Restaurant Dashboard | Dashboard | MOBILE (780x4788) | Complete | Restaurant Master Dashboard (Root RMS Home). Actions: Today sales, Active orders count, Quick actions |
| 54 | `SPEC-DOC` | `bab06375c504484188833743890d82cb` | NABIN Design Specs & Journey Flow Map | Documentation | DESKTOP (0x0) | Complete | Authoritative design specs & journey flow map document. Actions: System architecture reference |

---

## 2. METRIC SUMMARY
- Total Active UI Screens: 51
- Total System Docs: 1
- Total Assets: 2
- Total Design Systems: 1
- Total Instances: 55
- Average Screen Width: 780px (Retina 2x mobile base)
- Average Screen Height: ~3200px (Long scroll full-fidelity designs)
