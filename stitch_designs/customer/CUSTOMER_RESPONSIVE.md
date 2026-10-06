# NABIN Customer - phone + tablet responsive verification

Project `17214277447715826653`. 69 canonical screens, **measured 2026-10-04 from the HTML each screen's newest stored revision actually serves**.

## Method, and what it replaced

The contract being enforced is `DESIGN.md`, "Responsive system (required - not optional)": phone and tablet only, nothing designed above 1024px, and "do not enlarge a phone layout to fill a tablet; recompose it". The rules below are that section turned into measurements, so a failure here cites the design system rather than a reviewer preference.

This document was previously generated from local markup with a whole-document breakpoint count and a canvas taken from the generation ledger. Both were wrong in a way that flattered the project, and the audit that produced this version found it:

| the old measure | why it was wrong | what is used now |
|---|---|---|
| canvas from the run that created the screen | a later edit stores a new revision; the ledger kept naming the old one | `get_screen` on the id the slot's claim chain currently points at |
| `deviceType: MOBILE` in the request | the stored `deviceType` is the answer, and it is not always MOBILE | the stored `deviceType` field |
| breakpoint count over the whole document | the inline Tailwind config contains an `xl:` and a `2xl` key, and `xs:`/`sm:` are phone utilities | count restricted to `md:`/`lg:` inside class attributes |
| widest `max-w-[Npx]` anywhere in the file | that finds a 190px thumbnail and calls it the page column | the width cap on the element carrying `min-h-screen`, per breakpoint |
| "not wider than the previous attempt" | a slot already at 2560px accepted a fresh 2560px render | absolute rule: stored canvas above 1024px is non-conformant |

Two independent axes are measured, and a screen has to pass both. The stored-markup axis is the table above: what each slot's newest revision declares and holds. The rendered axis, reported in its own section below, drives headless Chrome over the canonical HTML at 390 and 768 CSS pixels and reads computed layout. Neither is a judgement by eye, and the markup axis alone is not enough - a screen can declare forty tablet utilities and still paint a narrow column. Stitch records a canvas in device pixels. Every MOBILE screen here is stored at 780px wide, which is a 390 CSS pixel phone at DPR 2; the 1024 cap is applied to the stored number, so 780 passes and 2560 does not.

## Headline

**37 of 69 canonical screens meet the contract as stored. 32 do not.** Nothing in the passing set is a log claim: each was fetched back out of the project and compared byte-for-byte with the canonical file before being counted.

**Scope of that number:** it is a responsiveness verdict only. It says nothing about the content guard or the brand system, and a screen counted here can still print a claim no route supports or paint its colours as raw hex instead of the pinned tokens. `CUSTOMER_SCREEN_AUDIT.md` tests all three and reaches `keep` on none of them; `CUSTOMER_REMEDIATION.md` names the brand faults that are not in this queue and says why they are the owner's decision rather than mine.

| screens | count | what it means |
|---|---|---|
| conformant | 37 | stored as a MOBILE canvas, has a tablet composition, and the served bytes are the canonical render |
| stored on a desktop canvas | 5 | width above 1024px, or stored `deviceType` is DESKTOP; these are the forbidden frame, and an edit cannot shrink a 2560px canvas into a phone |
| no tablet composition | 7 | four or fewer `md:`/`lg:` class utilities, so the screen is a phone layout at every width |
| pinned to a phone column | 2 | the page shell stays under 560px at the tablet breakpoint, which is content compressed into a thin mobile column |
| project and mirror differ | 23 | the newest stored revision is not the file the mirror and gallery show; slots {drift} |

Failure reasons are not mutually exclusive - a desktop-canvas screen usually fails the tablet checks too. Counts of each reason: served != canonical=23, no tablet composition=7, desktop marks=5, canvas>1024=5, device!=MOBILE=5, thin column on a tablet=2, no real tablet adaptation=2.

## The persistence fact that changes how a rejection works

A design Stitch returns is stored *before* any local gate judges it. So when a round refuses a render - as the canvas-cap guard refused a 2560px answer - the rejected revision still becomes the slot's newest claim, and the older phone render is not restored. 12 slot(s) carry that shape as this document is written: 16 (MOBILE 780px stored), 22 (MOBILE 780px stored), 24 (DESKTOP 2560px stored), 25 (DESKTOP 2560px stored), 28 (DESKTOP 2560px stored), 30 (MOBILE 780px stored), 31 (DESKTOP 2560px stored), 43 (MOBILE 780px stored), 46 (DESKTOP 2560px stored), 47 (MOBILE 780px stored), 56 (MOBILE 780px stored), 63 (MOBILE 780px stored). Every rejection therefore costs a re-ask, and nothing here treats "the previous revision remains authoritative" as true.

## Rendered evidence, measured in Chrome

The stored HTML and the rendered layout answer different questions, and a screen can pass one and fail the other. `render_audit.mjs` loads each canonical file in headless Chrome at 390 and at 768 CSS pixels (device scale 2, mobile viewport) and reads computed style: the grid track count the browser actually resolved, the width of the widest element that paints content, whether anything sits past the viewport edge, and the touch-target and font sizes. Two width readings are kept: the widest box that paints, and the span the words actually fill; the thin-column rule judges the second, because a full-bleed band can make the first read 1.0 on a page whose column is 400px. 69 of 69 screens are measured this way. Screens 09/10/20/22/25/26/30/32/48/49/50/51/52/53/54/61/66 render **the mirror file**, which is not the revision the project stores - their render evidence describes the intended fix, not the current screen.

| rendered fact | screens | reading |
|---|---|---|
| words paint into under 0.8 of the 768 width | 9 | 16, 43, 46, 47, 52, 54, 55, 56, 63 - this is the thin phone column the brief forbids, and it is visible only as a measured ratio. Slot 24 declares 15 `md:` utilities and still paints its text into 698px of the 768 width, so a class count would have passed it. This reads the span of the painted words, not the widest box: a full-bleed header or footer band spans the viewport and would credit a page whose content column is 400px.
| horizontal scroll at 390 | 0 | - - a broken phone layout: none. No markup rule sees this.
| elements past the viewport edge at 390 | 0 | - - the page itself does not scroll, so this reads as a clipped or bleeding element rather than a bug
| horizontal scroll at 768 | 0 | -
| column count unchanged 390 -> 768 | 14 | the grid does not recompose; these rely on width alone, which is the "stretched phone" shape the brief rejects unless the screen is a single-measure state
| painted text below 12px somewhere on the screen | 49 | legibility, not layout: the smallest rendered size across these is 9px
| touch targets under 44px | 61 | the phone half of the brief is "touch-first, compact, readable" - a screen can be responsive and still be a poor phone UI

**Both axes together: 37 of 69 screens pass the stored-screen rules and render correctly at phone and tablet width.**

### UI quality on a phone, as measured

The brief requires each screen to satisfy responsive conformance *and* UI quality, and the phone half of that is "touch-first, compact, readable". Both are measurable, so they are recorded rather than eyeballed. These are not layout failures and do not add a slot to the re-ask list; they are the second thing a re-ask must be told to fix, because a rebuild that only widens a canvas leaves an 8px caption and a 20px tap exactly where they were.

| # | screen | smallest type | painted runs under 12px | smallest tap | taps under 44px |
|---|---|---|---|---|---|
| 12 | Grocery home | 9px | 44 | 16px | 13 of 19 |
| 45 | Ride destination | 9px | 15 | 28px | 8 of 14 |
| 14 | Grocery product detail | 9px | 12 | 36px | 6 of 15 |
| 21 | Confirm location | 10px | 15 | 16px | 2 of 10 |
| 37 | Global retry | 10px | 18 | 16px | 8 of 13 |
| 60 | Grocery cart | 10px | 6 | 16px | 21 of 22 |
| 66 | Parcel package details | 10px | 17 | 16px | 5 of 11 |
| 59 | Grocery product browse | 10px | 27 | 20px | 17 of 18 |
| 13 | Grocery category and subcategory | 10px | 28 | 24px | 20 of 25 |
| 65 | Parcel recipient details | 10px | 15 | 24px | 7 of 13 |
| 02 | Onboarding | 10px | 4 | 28px | 2 of 3 |
| 43 | Ride home | 10px | 16 | 28px | 5 of 11 |
| 50 | Ride driver arriving | 10px | 15 | 28px | 11 of 13 |
| 51 | Ride active trip | 10px | 20 | 28px | 2 of 11 |
| 16 | Parcel delivery type and fare | 10px | 7 | 30px | 4 of 10 |
| 46 | Ride fare estimate | 10px | 7 | 30px | 6 of 8 |
| 49 | Ride driver assigned | 10px | 12 | 30px | 3 of 9 |
| 06 | Food home | 10px | 11 | 32px | 10 of 16 |
| 44 | Ride pickup | 10px | 6 | 32px | 9 of 16 |
| 07 | Food category and subcategory | 10px | 16 | 34px | 12 of 25 |
| 15 | Choose a ride | 10px | 21 | 36px | 3 of 9 |
| 67 | Parcel booking confirmation | 10px | 6 | 36px | 4 of 10 |
| 64 | Parcel sender details | 10px | 9 | 38px | 6 of 8 |
| 29 | Account support | 10px | 22 | 44px | 0 of 8 |
| 53 | Ride receipt | 10px | 3 | 48px | 0 of 8 |
| 05 | Customer home super-app | 11px | 7 | 16px | 15 of 23 |
| 18 | Location select | 11px | 3 | 16px | 6 of 12 |
| 03 | Login phone entry | 11px | 6 | 20px | 3 of 9 |
| 04 | OTP verification | 11px | 5 | 20px | 6 of 12 |
| 27 | Account activity | 11px | 4 | 20px | 6 of 11 |
| 01 | Splash | 11px | 7 | 24px | 1 of 3 |
| 20 | Map picker | 11px | 4 | 24px | 7 of 13 |
| 47 | Ride booking confirmation | 11px | 15 | 26px | 5 of 11 |
| 56 | Food search results | 11px | 11 | 26px | 4 of 9 |
| 17 | Processing payment | 11px | 5 | 28px | 2 of 7 |
| 28 | Account history | 11px | 22 | 28px | 14 of 19 |
| 61 | Grocery checkout | 11px | 2 | 28px | 2 of 10 |
| 19 | Manual address entry | 11px | 9 | 30px | 9 of 16 |
| 40 | Global unavailable | 11px | 1 | 30px | 3 of 10 |
| 08 | Restaurant detail and menu | 11px | 1 | 32px | 18 of 24 |
| 24 | Edit profile | 11px | 5 | 34px | 3 of 12 |
| 41 | Global disabled | 11px | 3 | 34px | 2 of 9 |
| 48 | Ride searching for driver | 11px | 3 | 36px | 2 of 7 |
| 63 | Parcel home | 11px | 3 | 38px | 7 of 8 |
| 30 | Account settings | 11px | 2 | 40px | 2 of 8 |
| 38 | Global offline | 11px | 5 | 40px | 1 of 8 |
| 11 | Food order status | 11px | 1 | 44px | 0 of 9 |
| 57 | Food order confirmation | 11px | 1 | 44px | 0 of 9 |
| 26 | Account wallet | 11px | 4 | 48px | 0 of 9 |
| 10 | Food cart and checkout | 12px | 0 | 16px | 8 of 16 |
| 52 | Ride trip completed | 12px | 0 | 16px | 2 of 8 |
| 68 | Notifications inbox | 12px | 0 | 18px | 10 of 15 |
| 23 | Account profile | 12px | 0 | 24px | 4 of 10 |
| 36 | Global error | 12px | 0 | 24px | 4 of 11 |
| 55 | Ride history | 12px | 0 | 24px | 6 of 11 |
| 42 | Global confirmation | 12px | 0 | 30px | 3 of 10 |
| 33 | Global loading | 12px | 0 | 32px | 5 of 13 |
| 39 | Global pending | 12px | 0 | 32px | 3 of 10 |
| 09 | Dish detail vosa bai | 12px | 0 | 36px | 2 of 11 |
| 25 | Account addresses | 12px | 0 | 40px | 2 of 10 |
| 31 | Identity verification | 12px | 0 | 40px | 2 of 8 |
| 34 | Global skeleton | 12px | 0 | 40px | 1 of 6 |
| 35 | Global empty | 12px | 0 | 40px | 2 of 8 |
| 58 | Food order completed | 12px | 0 | 40px | 7 of 9 |
| 69 | Notification preferences | 12px | 0 | 40px | 1 of 7 |
| 32 | Account logout | 12px | 0 | 42px | 2 of 9 |
| 22 | Saved addresses | 12px | 0 | 44px | 0 of 9 |
| 54 | Ride rating | 12px | 0 | 44px | 0 of 7 |
| 62 | Grocery order confirmation | 12px | 0 | 44px | 0 of 9 |

Across the project: smallest rendered type 9px, smallest touch target 16px, and 69 screens carry at least one of the two measurements.

## Per journey

| journey | screens | conformant | desktop canvas | no tablet comp | phone-column pinned |
|---|---|---|---|---|---|
| RIDE | 13 | 3 | 1 | 3 | 1 |
| GLOBAL STATES | 10 | 9 | 0 | 1 | 0 |
| FOOD | 9 | 6 | 0 | 1 | 0 |
| GROCERY | 7 | 6 | 0 | 0 | 0 |
| PARCEL | 6 | 3 | 0 | 0 | 0 |
| ACCOUNT | 5 | 0 | 2 | 0 | 0 |
| LOCATION | 5 | 3 | 0 | 0 | 0 |
| AUTH | 4 | 4 | 0 | 0 | 0 |
| ACTIVITY/HISTORY | 3 | 1 | 1 | 1 | 1 |
| SETTINGS | 2 | 1 | 0 | 0 | 0 |
| WALLET | 2 | 1 | 0 | 0 | 0 |
| HOME | 1 | 0 | 0 | 0 | 0 |
| IDENTITY VERIFICATION | 1 | 0 | 1 | 0 | 0 |
| SUPPORT | 1 | 0 | 0 | 1 | 0 |

## Every screen

| # | screen | stored id | device | canvas | tablet bp | page column (phone -> tablet) | rendered fill 390/768 | columns 390->768 | desktop marks | served = canonical | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 01 | Splash | `e66aa83fdb0a` | MOBILE | 780x2368 | 8 | fluid -> fluid | 1/1 widest box; 704px of words at 768 | 2->12 | 0 | yes | pass |
| 02 | Onboarding | `08083d712a39` | MOBILE | 780x2114 | 7 | fluid -> fluid | 1/1 widest box; 736px of words at 768 | 1->12 | 0 | yes | pass |
| 03 | Login phone entry | `bdd6496c89cc` | MOBILE | 780x1768 | 8 | fluid -> fluid | 1/1 widest box; 724px of words at 768 | 3->2 | 0 | yes | pass |
| 04 | OTP verification | `5410c81bc678` | MOBILE | 780x1768 | 5 | fluid -> fluid | 1/1 widest box; 736px of words at 768 | 6->6 (same) | 0 | yes | pass |
| 05 | Customer home super-app | `5bfccd6a2c53` | MOBILE | 780x5526 | 21 | 1024 -> none | 1/1 widest box; 736px of words at 768 | 2->4 | 1 | yes | FAIL: desktop marks |
| 06 | Food home | `fda7ddbd1554` | MOBILE | 780x5278 | 12 | fluid -> fluid | 1/1 widest box; 730px of words at 768 | 1->12 | 0 | yes | pass |
| 07 | Food category and subcategory | `1b063547370b` | MOBILE | 780x3174 | 27 | 1024 -> none | 1/1 widest box; 720px of words at 768 | 2->4 | 0 | yes | pass |
| 08 | Restaurant detail and menu | `665d1d6f76ba` | MOBILE | 780x5178 | 11 | fluid -> fluid | 1/1 widest box; 781px of words at 768 | 1->2 | 0 | yes | pass |
| 09 | Dish detail vosa bai | `8591a20bb2c7` | MOBILE | 780x3994 | 9 | fluid -> fluid | 1/1 widest box; 728px of words at 768 | 1->12 | 0 | **no** | FAIL: served != canonical |
| 10 | Food cart and checkout | `bc9aeb5e81dc` | MOBILE | 780x3396 | 8 | fluid -> fluid | 1/1 widest box; 736px of words at 768 | 1->12 | 0 | **no** | FAIL: served != canonical |
| 11 | Food order status | `e35ee6fd7de2` | MOBILE | 780x2888 | 9 | fluid -> fluid | 1/1 widest box; 736px of words at 768 | 1->12 | 0 | yes | pass |
| 12 | Grocery home | `31999f14ca85` | MOBILE | 780x4148 | 24 | 1024 -> none | 1/1 widest box; 720px of words at 768 | 2->6 | 0 | yes | pass |
| 13 | Grocery category and subcategory | `e79548564fb9` | MOBILE | 780x3520 | 37 | fluid -> fluid | 1/1 widest box; 736px of words at 768 | 2->4 | 0 | yes | pass |
| 14 | Grocery product detail | `bf0716ca724e` | MOBILE | 780x3350 | 9 | fluid -> fluid | 1/1 widest box; 730px of words at 768 | 1->12 | 0 | yes | pass |
| 15 | Choose a ride | `c2ff8ad44f98` | MOBILE | 780x3116 | 4 | fluid -> fluid | 1/1 widest box; 730px of words at 768 | 2->12 | 0 | yes | pass |
| 16 | Parcel delivery type and fare | `862cbfde96d6` | MOBILE | 780x3096 | 10 | fluid -> fluid | 1/0.51 widest box; 354px of words at 768 | 1->1 (same) | 0 | **no** | FAIL: served != canonical, thin tablet column |
| 17 | Processing payment | `97d5d31b614f` | MOBILE | 780x2400 | 12 | fluid -> fluid | 1/1 widest box; 736px of words at 768 | 1->12 | 0 | yes | pass |
| 18 | Location select | `f30ff23452fb` | MOBILE | 780x2388 | 20 | fluid -> fluid | 1/1 widest box; 728px of words at 768 | 1->2 | 0 | yes | pass |
| 19 | Manual address entry | `89c5c3f40a56` | MOBILE | 780x3372 | 12 | fluid -> fluid | 1/1 widest box; 736px of words at 768 | 1->12 | 0 | yes | pass |
| 20 | Map picker | `da0e5e500fa0` | MOBILE | 780x2464 | 5 | fluid -> fluid | 1/1 widest box; 730px of words at 768 | 1->12 | 0 | **no** | FAIL: served != canonical |
| 21 | Confirm location | `cb48fe1873aa` | MOBILE | 780x2816 | 9 | fluid -> fluid | 1/1 widest box; 730px of words at 768 | 2->12 | 0 | yes | pass |
| 22 | Saved addresses | `30edb1af751c` | MOBILE | 780x2688 | 8 | 1024 -> none | 1/1 widest box; 736px of words at 768 | 1->2 | 1 | **no** | FAIL: desktop marks, served != canonical |
| 23 | Account profile | `5df29f4c89b1` | MOBILE | 780x3906 | 4 | fluid -> fluid | 1/1 widest box; 720px of words at 768 | 1->12 | 1 | yes | FAIL: desktop marks |
| 24 | Edit profile | `9a3d34c03d4f` | DESKTOP | 2560x2048 | 15 | 1024 -> none | 1/1 widest box; 698px of words at 768 | 2->12 | 0 | yes | FAIL: canvas>1024, device!=MOBILE |
| 25 | Account addresses | `19e05aa9e6b7` | DESKTOP | 2560x2048 | 17 | fluid -> fluid | 1/1 widest box; 720px of words at 768 | 1->2 | 0 | **no** | FAIL: canvas>1024, device!=MOBILE, served != canonical |
| 26 | Account wallet | `b63fd35e0b92` | MOBILE | 780x2864 | 11 | fluid -> fluid | 1/1 widest box; 736px of words at 768 | 2->12 | 0 | **no** | FAIL: served != canonical |
| 27 | Account activity | `9ee35cd3c050` | MOBILE | 780x2644 | 17 | 1024 -> none | 1/1 widest box; 704px of words at 768 | 1->2 | 0 | yes | pass |
| 28 | Account history | `5f2819820d0c` | DESKTOP | 2560x2048 | 5 | 1024 -> none | 1/1 widest box; 734px of words at 768 | 1->2 | 0 | yes | FAIL: canvas>1024, device!=MOBILE |
| 29 | Account support | `e90caf237367` | MOBILE | 780x2758 | 3 | 896 -> none | 1/1 widest box; 734px of words at 768 | 1->2 | 0 | yes | FAIL: no tablet composition |
| 30 | Account settings | `24e3089c7fe7` | MOBILE | 780x3566 | 8 | fluid -> fluid | 1/1 widest box; 736px of words at 768 | 1->2 | 0 | **no** | FAIL: served != canonical |
| 31 | Identity verification | `4e9151c2108e` | DESKTOP | 2560x2384 | 29 | fluid -> fluid | 1/1 widest box; 695px of words at 768 | 1->2 | 0 | yes | FAIL: canvas>1024, device!=MOBILE |
| 32 | Account logout | `75c481b8fce1` | MOBILE | 780x1768 | 18 | 1024 -> none | 1/1 widest box; 720px of words at 768 | 1->2 | 1 | **no** | FAIL: desktop marks, served != canonical |
| 33 | Global loading | `04d6bb2678fb` | MOBILE | 780x1838 | 4 | fluid -> fluid | 1/1 widest box; 728px of words at 768 | 1->2 | 0 | yes | pass |
| 34 | Global skeleton | `52dfbadb3210` | MOBILE | 780x2988 | 5 | fluid -> fluid | 1/1 widest box; 723px of words at 768 | 2->4 | 0 | yes | pass |
| 35 | Global empty | `bf0d7736cc9b` | MOBILE | 780x2492 | 12 | 1024 -> none | 1/1 widest box; 719px of words at 768 | 1->2 | 0 | yes | pass |
| 36 | Global error | `18a70964c008` | MOBILE | 780x1768 | 6 | 448 -> 800 | 1/0.88 widest box; 640px of words at 768 | 1->1 (same) | 0 | yes | pass |
| 37 | Global retry | `ac939ec89ce0` | MOBILE | 780x2038 | 1 | fluid -> fluid | 1/1 widest box; 732px of words at 768 | 1->2 | 0 | yes | FAIL: no tablet composition |
| 38 | Global offline | `c636bb15d1d8` | MOBILE | 780x3346 | 11 | fluid -> fluid | 1/1 widest box; 736px of words at 768 | 1->12 | 0 | yes | pass |
| 39 | Global pending | `925ace32b9c4` | MOBILE | 780x3176 | 13 | fluid -> fluid | 1/1 widest box; 724px of words at 768 | 1->12 | 0 | yes | pass |
| 40 | Global unavailable | `a9ed6feba6b1` | MOBILE | 780x2876 | 10 | fluid -> fluid | 1/1 widest box; 728px of words at 768 | 1->12 | 0 | yes | pass |
| 41 | Global disabled | `ba29bc2a3812` | MOBILE | 780x2974 | 5 | fluid -> fluid | 1/1 widest box; 732px of words at 768 | 1->2 | 0 | yes | pass |
| 42 | Global confirmation | `33e47c841866` | MOBILE | 780x1768 | 11 | 1024 -> none | 1/1 widest box; 723px of words at 768 | 1->1 (same) | 0 | yes | pass |
| 43 | Ride home | `077c2c56e319` | MOBILE | 780x3308 | 7 | fluid -> fluid | 1/1 widest box; 543px of words at 768 | 1->1 (same) | 0 | **no** | FAIL: served != canonical, thin tablet column |
| 44 | Ride pickup | `fafd714a57db` | MOBILE | 780x3064 | 7 | fluid -> fluid | 1/1 widest box; 728px of words at 768 | 1->12 | 0 | yes | pass |
| 45 | Ride destination | `9cd17d8625dd` | MOBILE | 780x2564 | 13 | fluid -> fluid | 1/1 widest box; 732px of words at 768 | 2->12 | 0 | yes | pass |
| 46 | Ride fare estimate | `19cfd3afd1d5` | DESKTOP | 2560x2050 | 19 | fluid -> fluid | 1/1 widest box; 526px of words at 768 | 1->1 (same) | 0 | **no** | FAIL: canvas>1024, device!=MOBILE, served != canonical, thin tablet column |
| 47 | Ride booking confirmation | `f23303fa4117` | MOBILE | 780x3908 | 11 | fluid -> fluid | 1/0.51 widest box; 358px of words at 768 | 2->2 (same) | 0 | **no** | FAIL: served != canonical, thin tablet column |
| 48 | Ride searching for driver | `8e31ea6bafdd` | MOBILE | 780x1834 | 0 | fluid -> fluid | 1/1 widest box; 721px of words at 768 | 1->1 (same) | 0 | **no** | FAIL: no tablet composition, served != canonical |
| 49 | Ride driver assigned | `b02cb341c432` | MOBILE | 780x2918 | 6 | fluid -> fluid | 1/1 widest box; 736px of words at 768 | 1->12 | 0 | **no** | FAIL: served != canonical |
| 50 | Ride driver arriving | `a3d42f88a471` | MOBILE | 780x3638 | 7 | fluid -> fluid | 1/1 widest box; 736px of words at 768 | 1->12 | 0 | **no** | FAIL: served != canonical |
| 51 | Ride active trip | `31dd2e5e438a` | MOBILE | 780x3458 | 4 | fluid -> fluid | 1/1 widest box; 703px of words at 768 | 5->12 | 0 | **no** | FAIL: served != canonical |
| 52 | Ride trip completed | `e4d652be0d57` | MOBILE | 780x1768 | 0 | 420 -> none | 1/0.55 widest box; 388px of words at 768 | 1->1 (same) | 0 | **no** | FAIL: no tablet composition, thin column on a tablet, no real tablet adaptation, served != canonical, thin tablet column |
| 53 | Ride receipt | `5a42a25994ea` | MOBILE | 780x2444 | 9 | fluid -> fluid | 1/1 widest box; 736px of words at 768 | 1->2 | 0 | **no** | FAIL: served != canonical |
| 54 | Ride rating | `fe91a5c192ce` | MOBILE | 780x1768 | 0 | fluid -> fluid | 1/1 widest box; 470px of words at 768 | 2->2 (same) | 0 | **no** | FAIL: no tablet composition, served != canonical, thin tablet column |
| 55 | Ride history | `77073e67e2ae` | MOBILE | 780x1768 | 0 | 448 -> none | 1/0.58 widest box; 558px of words at 768 | 1->1 (same) | 0 | yes | FAIL: no tablet composition, thin column on a tablet, no real tablet adaptation, thin tablet column |
| 56 | Food search results | `f131efa0227c` | MOBILE | 780x2020 | 1 | fluid -> fluid | 1/0.55 widest box; 384px of words at 768 | 1->1 (same) | 0 | **no** | FAIL: no tablet composition, served != canonical, thin tablet column |
| 57 | Food order confirmation | `9e3568ddc34b` | MOBILE | 780x2680 | 11 | fluid -> fluid | 1/1 widest box; 715px of words at 768 | 1->12 | 0 | yes | pass |
| 58 | Food order completed | `1aa63662c32e` | MOBILE | 780x2590 | 8 | fluid -> fluid | 1/1 widest box; 735px of words at 768 | 1->12 | 0 | yes | pass |
| 59 | Grocery product browse | `e691c8855003` | MOBILE | 780x2590 | 16 | fluid -> fluid | 1/1 widest box; 723px of words at 768 | 2->3 | 0 | yes | pass |
| 60 | Grocery cart | `538fdf226002` | MOBILE | 780x3452 | 16 | fluid -> fluid | 1/1 widest box; 736px of words at 768 | 1->12 | 0 | yes | pass |
| 61 | Grocery checkout | `360e4ca86e88` | MOBILE | 780x3090 | 9 | fluid -> fluid | 1/1 widest box; 736px of words at 768 | 1->12 | 0 | **no** | FAIL: served != canonical |
| 62 | Grocery order confirmation | `94525a14f321` | MOBILE | 780x2972 | 17 | fluid -> fluid | 1/1 widest box; 736px of words at 768 | 1->12 | 0 | yes | pass |
| 63 | Parcel home | `c5198bc0d9b2` | MOBILE | 780x2550 | 19 | fluid -> fluid | 1/0.55 widest box; 388px of words at 768 | 1->1 (same) | 0 | **no** | FAIL: served != canonical, thin tablet column |
| 64 | Parcel sender details | `72704035eed4` | MOBILE | 780x3278 | 8 | fluid -> fluid | 1/1 widest box; 722px of words at 768 | 3->12 | 0 | yes | pass |
| 65 | Parcel recipient details | `950bec8c1b96` | MOBILE | 780x3298 | 7 | fluid -> fluid | 1/1 widest box; 719px of words at 768 | 3->12 | 0 | yes | pass |
| 66 | Parcel package details | `8b8167d8335e` | MOBILE | 780x3704 | 6 | fluid -> fluid | 1/1 widest box; 726px of words at 768 | 3->12 | 0 | **no** | FAIL: served != canonical |
| 67 | Parcel booking confirmation | `bddda92cb639` | MOBILE | 780x2394 | 16 | fluid -> fluid | 1/1 widest box; 736px of words at 768 | 1->12 | 0 | yes | pass |
| 68 | Notifications inbox | `dc2ad656f974` | MOBILE | 780x3380 | 4 | fluid -> fluid | 1/1 widest box; 736px of words at 768 | 2->2 (same) | 1 | yes | FAIL: desktop marks |
| 69 | Notification preferences | `1b6dbf962df1` | MOBILE | 780x3064 | 12 | fluid -> fluid | 1/1 widest box; 726px of words at 768 | 1->12 | 0 | yes | pass |

## Work this measures, in the order it has to happen

1. 5 slots must be re-rendered on a phone canvas (24, 25, 28, 31, 46). An edit call is the only route that persists, and each answer has to be verified from the stored render, because MOBILE is a request.
2. 7 slots need a real tablet composition; 9 of those also pin their page column below 560px, so widening the canvas alone leaves the compressed-column failure in place.
3. 0 slots () are broken on the phone itself in the browser - sideways scroll or content past the viewport edge - which no markup rule can see, and 7 (16, 43, 46, 47, 54, 56, 63) paint a narrow column at 768 while their markup declared enough utilities to look adapted. A re-ask for these must name the rendered fact, not the class count, or the next answer repeats the same shape.
4. 23 slots (09, 10, 16, 20, 22, 25, 26, 30, 32, 43, 46, 47, 48, 49, 50, 51, 52, 53, 54, 56, 61, 63, 66) hold a revision the mirror has never served. Until they are re-asked, the gallery and `screens.json` describe renders the project does not have - `screens.json` now records that per slot instead of hiding it.
5. 2 screens print a job or order reference outside the five canonical examples (55, 63). On a booking list or a history that is the screen doing its job - slot 55 shows four rides and slot 63 three parcels, each with its own job number, in the shape `JOB-<8 digits>-<3 digits>` that JobRepository.js:211 mints - so it is not counted as a fault here. What is refused is a *new* number: the write gate rejects a rebuilt screen that prints a reference the screen did not already carry and that is not one of the five, which is how one booking ends up with two identities across a journey.

The two axes are counted together: 32 slots fail the stored-screen rules and the union with what Chrome paints is 32, which says every render failure sits inside the stored failure set - a screen that paints badly also declared badly. `apply_r3e.directives()` builds the work list from that union and adds the screens whose only fault is copy, so the directives it emits are the authority on how many screens go back and what each is told to change. UI quality is tracked separately and is not a re-ask reason on its own - see the touch-target and type rows above.

## Flutter implication

A Stitch canvas tells nothing about Flutter layout, because Flutter takes no breakpoints from HTML: the Customer app sizes with `LayoutBuilder`/`MediaQuery.widthBehindBreakpoint` conventions in `mobile/lib`. What this audit does bind is the *contract* the Dart screens must satisfy: a phone composition at <=430 logical px, a second composition between 600 and 1024, and no desktop branch at all. A screen failing here is a design that has not decided its tablet behaviour, so the Dart implementation would have to invent it - which is why these are treated as design work and not as an implementation detail.
