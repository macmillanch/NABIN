# NABIN — Product & Feature Matrix

**Author**: Product Manager Agent ([`product_manager`](file:///c:/Users/Macmillan/OneDrive/Documents/nabin/.agents/skills/product_manager/SKILL.md))  
**Source Agency Agent**: `msitarzewski/agency-agents`

## 1. Supported Platform Applications & Scopes

### A. NABIN Customer App
- **Ride Booking**: 2-Wheeler (Bike), 3-Wheeler (Auto), 4-Wheeler (Cab/Sedan/SUV), live fare estimates, driver matching.
- **Food Delivery**: Restaurant discovery, item customizations, checkout with UPI/Cards/Wallet, live order tracking.
- **Parcel Delivery**: Express pickup & drop-off, OTP verification upon delivery, package type selection.
- **Account & Payments**: NABIN Wallet balance, payment method management, support ticket creation, order history.

### B. NABIN Driver App
- **Job Radar**: Incoming ride/delivery requests, pickup distance, fare payout estimate, accept/reject toggles.
- **Navigation & Trip Execution**: Turn-by-turn routing, pickup OTP verification, customer chat & call.
- **Earnings & Verification**: Daily/weekly earnings breakdown, payout requests, KYC document submission.

### C. NABIN Merchant App
- **Store & Menu Management**: Restaurant profile, menu items, pricing, availability toggles.
- **Order Dispatch**: Incoming food order alerts, preparation status, rider assignment tracking.
- **Settlements**: Earnings overview, weekly payout history.

### D. NABIN Admin Dashboard
- **Operations & Compliance**: KYC identity reviews, audit trail logs, support dispute resolution, surge zone controls, pricing rules, promo code creation.

## 2. Explicit Non-Goals & Constraints
- ❌ **No Bus/Train/RedBus Booking**: Out of scope for NABIN local mobility.
- ❌ **No Fragmented Databases**: Every application interacts with the single unified backend.
