# Customer — §4 classification of the 21 out-of-budget queued slots

Source queue: `remediation_queue.json` (2026-10-04 18:58, 21 entries). Every entry in it
carries `truth_flags: []`, so none of the 21 makes a claim the backend cannot support. Each
fault left in the queue is on the form axis (canvas width, tablet composition) or the brand
axis (colour weighting, raw hex instead of tokens). Band 1 is empty at this measurement: 0
slots, per `CUSTOMER_REMEDIATION.md`.

The prompt budget behind these 21 is spent — one attempt plus the one retry the owner allowed
(§4: *Do not spend unauthorized generation quota. Do not attempt repeated generation retries*).
So this document does not re-ask anything. It answers the question §4 actually poses: **which of
these 21 genuinely block Customer closure, and which do not.**

Two measurements do the separating, both already in the queue:

1. **`stored.device` / `stored.canvas`.** Five slots store a 2560×2048 (or 2560×2384) DESKTOP
   canvas. The owner rule of 2026-10-04 is that no NABIN app gets a desktop screen and a canvas
   must not exceed 1024 px. A desktop frame cannot be the source of truth for a phone screen, and
   §5 forbids the reverse direction, so those five are the only ones that *must* be regenerated.
2. **Whether the capability exists at all.** Checked against the route registrations in
   `backend/src/server.js` (read-only, §19). A screen that designs a feature with no route behind
   it is not a design defect waiting for quota — it is scope that has to be decided, and §6 says
   document the absence rather than simulate the success.

## A — actually complete: 0

No slot in this queue is free of a measured form or brand fault, so none is left alone under this
heading. That is a finding, not a hedge: the queue is accurate about what is wrong.

## D — already superseded: 3 (close, no quota, no rebuild)

| slot | band | title | why it is superseded | CUSTOMER |
|---|---|---|---|---|
| 22 | 4 | Saved addresses | No route reads or writes `user_saved_locations`; the shipped app now states the gap on the tile instead of listing invented addresses (#118). Rebuilding this design would put a picture in front of a feature the product does not have. | NEEDS BACKEND: saved-address read/write routes |
| 25 | 2 | Account addresses | Same missing capability as 22, and a 2560×2048 desktop canvas on top. Closing it on capability removes the only reason to spend a desktop-remediation prompt on it. | NEEDS BACKEND: saved-address read/write routes |
| 24 | 2 | Edit profile | No customer-facing profile write route exists: the auth surface is `POST /api/auth/send-otp`, `/verify-otp`, `GET /api/auth/me`, `POST /api/auth/logout`, `/refresh-token` — nothing updates name, phone or email. `POST /api/customer/profile/photo` is the only profile mutation and it registers with no `authenticateUser` middleware, which is one of the unauthenticated media routes already on the open-findings list, so it is not a capability to build UI on. | NEEDS BACKEND: profile update route |

All three stay *documented*, not deleted: the designs remain in the project, and the record says
why they are not the authority for a Flutter page.

## C — genuine Stitch remediation required: 4 (queued, STITCH QUOTA BLOCKED)

| slot | band | title | measured fault | capability | STITCH QUOTA | FLUTTER WORK | BACKEND |
|---|---|---|---|---|---|---|---|
| 28 | 2 | Account history | DESKTOP 2560×2048 canvas, above the 1024 cap, plus `390 spill: 1` | real — `GET /api/customer/activity` | YES | no (page exists, filtered list) | no |
| 31 | 2 | Identity verification | DESKTOP 2560×2384 canvas | real — `POST /api/identity/submit`, `GET /api/identity/status/:userId` | YES | no (both routes exist) | no |
| 46 | 2 | Ride fare estimate | DESKTOP 2560×2050 canvas | real — `POST /api/pricing/estimate` | YES | no (renders inside `/ride-booking`) | no |
| 68 | 4 | Notifications inbox | `390 spill: 2` — content exceeds the phone frame, so the defect is not only the tablet range | real — `GET /api/notifications` | YES | YES (no route registered yet) | no |

These four are the whole of what is genuinely blocking Customer closure *on the design side*, and
none of them can move without generation quota the owner has not authorized. They are marked
`STITCH QUOTA BLOCKED` and nothing else in this pass waits on them.

## B — minor issue, no generation: 14

Every one of these stores a MOBILE canvas at 780 device px = 390 CSS px with `390 overflow: 0px`
and `390 spill: 0`. The phone frame — the frame a customer actually runs — is honest. The fault is
that the composition does not earn the 601–1024 tablet range (`768 text span` well under 768), or
that the palette leans brand-heavy / uses raw hex rather than the `AppTheme` tokens.

That distinction matters because of §5. The direction is Stitch design → Flutter implementation,
and what a customer runs is the Flutter page: its colours come from `AppTheme`/`NabinColor`, not
from a hex value painted in a Stitch canvas, and its tablet behaviour comes from its own layout
code. So a raw-token or brand-weight fault in the design does not propagate into the shipped app,
and the fix belongs in verification of the Flutter page, not in a prompt.

| slot | band | title | 768 text span | Flutter outcome | FLUTTER WORK |
|---|---|---|---|---|---|
| 05 | 4 | Customer home super-app | 736 px | exists (`/home`) | no |
| 16 | 3 | Parcel delivery type and fare | 354 px | exists (`/parcel-booking`) | no |
| 23 | 4 | Account profile | not measured | exists (`/profile`) | no |
| 29 | 4 | Account support | 734 px | exists (`/support`) | no |
| 32 | 4 | Account logout | 720 px | partial (button on `/profile`) | no |
| 37 | 4 | Global retry | 732 px | **new** | **YES** |
| 43 | 3 | Ride home | 543 px | partial (`/ride-booking`) | no |
| 47 | 3 | Ride booking confirmation | 358 px | partial (`/ride-booking`) | no |
| 48 | 4 | Ride searching for driver | 721 px | partial (`/active-ride`) | no |
| 52 | 3 | Ride trip completed | 388 px | partial (`/active-ride`) | no |
| 54 | 3 | Ride rating | 470 px | partial (`/ride-receipt`) | **YES — and blocked** |
| 55 | 3 | Ride history | 558 px | partial (`/activity`) | no |
| 56 | 3 | Food search results | 384 px | **new** | **YES** |
| 63 | 3 | Parcel home | 388 px | partial (`/parcel-booking`) | no |

Two of these are not really a form story at all:

- **54 Ride rating** — there is no rating write route anywhere in `server.js` that a customer can
  call; `UserRepository.updateUser` will set `rating`, but no customer route reaches it. The Flutter
  map already records that the rating step "renders here and cannot submit". The phone design is
  clean; the feature is missing. → CUSTOMER NEEDS BACKEND: a rating write route.
- **37 and 56** need a page built from a design whose only fault is the tablet range. 37 becomes
  part of the shared global-state widget family (33–42), not a route.

## Not measured, stated as not measured

Slots 23 and 25 report `390 widest: Nonepx` and `768 text span: Nonepx`. The paint probe returned
nothing for them. That is an absence of evidence, not evidence of a defect, and 23's classification
as B rests only on the fault the queue *did* measure (`BRAND-HEAVY`, `desktop-chrome`) — its tablet
composition is unverified.

## What this leaves

Of the 21: 3 close as scope decisions (D), 14 are form debt that does not reach the shipped app (B),
and 4 need generation that is not authorized (C). **Customer closure is blocked on exactly 4 design
slots and 3 backend capabilities** — saved addresses, a profile write route, and a rating write
route — and the §10 report carries those, not the twenty-one.
