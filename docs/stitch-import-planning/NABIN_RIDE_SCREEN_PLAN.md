# NABIN — RIDE REQUIRED SCREEN PLAN

**Document ID:** NABIN-PLAN-RIDE-001  
**Project ID:** `15895521349027986707`  
**Vertical Accent:** Royal Blue (`#1A3BA2`)  
**Total Production Screens:** 16 Screens  

---

## Screen Register & Specifications

| Plan ID | Existing Stitch ID | Screen Name | Role / Purpose | Entry Point | Exit Destination |
|---|---|---|---|---|---|
| **RD-01** | `512117cb16164a56beb457a7d7a99024` | RIDE-001 Ride Home & Discovery | Map base, recent destinations, service switcher | Super-App Home | RD-02 Location Search |
| **RD-02** | `688fd04399b64356a631baa12842799d` | RIDE-002 Location Search & Suggestions | Multi-stop waypoints & landmark search | RD-01 | RD-03 Map Pin Adjust |
| **RD-03** | `36fc851cdb4943f897f2299cc0455cf0` | RIDE-003 Map Pin Adjustment & Pickup Confirm | Precise curbside pickup marker | RD-02 | RD-04 Category Select |
| **RD-04** | `b73eb74d974f46eda03b93df688f5fc9` | RIDE-004 Category Selection & Fare Comparison | Bike, Auto, Cab fares & ETAs | RD-03 | RD-07 Checkout |
| **RD-05** | `dc7dff8f57c14871959d821dba64fd71` | RIDE-005 Rentals Experience | 2hr / 4hr / 8hr hourly packages | RD-04 Tab | RD-07 Checkout |
| **RD-06** | `83b947e406114449b85b3acc0c400954` | RIDE-006 Shared Ride Specialized Booking | Co-passenger routing & seat selector | RD-04 Tab | RD-07 Checkout |
| **RD-07** | `e0bd329f376e48c9b06fbac8e1eedaab` | RIDE-007 Checkout & Fare Breakdown | Itemized base fare, tolls, surge, payment | RD-04/05/06 | RD-08 Driver Radar |
| **RD-08** | `1203a0534ba74a6896048004b68d5246` | RIDE-008 Live Radar Driver Search | Dispatch radar animation & countdown | RD-07 | RD-09 Driver Assigned |
| **RD-09** | `20042be00ea840cf93d58d2c67d6bf3c` | RIDE-009 Driver Assigned & Approaching | 4-Digit Curbside OTP & Captain details | RD-08 | RD-10 Active Trip |
| **RD-10** | `c712907be8ef42d4b655745a834c20de` | RIDE-010 Active Trip in Progress | Live destination ETA, route line, SOS | RD-09 | RD-11 Trip Completed |
| **RD-11** | `5b7bc73c7b074913b08d7e9ce24fb6b4` | RIDE-011 Trip Completed & Digital Receipt | Driver tip, star rating, final fare | RD-10 | Super-App Home |
| **RD-12** | `ca81dbd628a5475f97647545d1f5c4e6` | RIDE-012 Ride History & Activity Log | Past trips, receipts, repeat ride | RD-01 Menu | RD-11 Receipt |
| **RD-13** | `542196bc27f543559ead3866c04be9a8` | RIDE-013 Emergency & Safety Shield Center | 112 SOS, WhatsApp live trip share | RD-10 Shield | RD-10 Active Trip |
| **RD-14** | `894e824b60e745758113c0c88ce781ea` | RIDE-014 Cancellation & Refund Policy | Driver delay / reason checklist | RD-08/09 | RD-01 Ride Home |
| **RD-15** | `a5e3c9e76720430fb7f0f2cd53556a03` | RIDE-015 Service Availability & Edge States | No cabs available / high demand | RD-08 Timeout | RD-04 Category Select |
| **RD-16** | `e0e9ff3583204e59ae9663a88d5d5740` | RIDE-016 In-App Driver Chat & Messaging | Curbside coordination & quick messages | RD-09/10 Chat | RD-09/10 |
