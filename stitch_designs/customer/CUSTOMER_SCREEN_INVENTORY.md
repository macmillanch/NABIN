# NABIN Customer — authoritative Stitch screen inventory

Project `17214277447715826653`. Read from the live project on 2026-10-04, not from any earlier slot count.

## Why the numbers in this file are not the numbers in the project

Two mechanical facts about Stitch, both verified against the API on that read:

1. **`list_screens` is capped at 105 entries and returns no page token.** It dropped the six most recently written screens. `148` screen records are known in total, and 43 of them only by asking `get_screen` for the id directly. Any inventory built from the list alone is silently short.
2. **`edit_screens` creates a new screen and keeps the old one; there is no delete-screen tool** (confirmed against `tools/list`). Every edit round permanently strands its predecessor. So `70` of the project's screen records are superseded renders, not screens of the product.

The unit of truth is therefore the **manifest slot**, not the project list.

## Headline

| measure | count |
|---|---|
| Screen records the project returns | 148 |
| Real screens, by manifest slot | 69 |
| … whose listed id provably serves the canonical render | 66 |
| … whose id could not be proved to serve it | 3 |
| … whose NEWEST stored revision meets the phone+tablet contract | 6 |
| … where the id serving the mirror is not the newest stored revision | 2 |
| … on a phone canvas, by the id serving the mirror | 50 |
| … on a desktop canvas, by the id serving the mirror — must be rebuilt phone+tablet | 19 |
| … MOBILE as the newest stored revision | 48 |
| … DESKTOP as the newest stored revision | 21 |
| | *the two canvas counts differ because a slot can serve a phone render while its newest stored revision is a desktop one; `CUSTOMER_RESPONSIVE.md` audits the newest stored revision, which is the screen the project actually holds.* |
| Superseded renders still resident | 70 |
| `DESIGN.md` assets (one per upload) | 7 |
| Illustration/photo prompts, not screens | 2 |


Mirror and project disagree in two distinct ways, and they are counted separately.

1. **The newest stored id is not the id that serves the mirror** — 24, 30. A round re-asked these, Stitch stored the answer, and the local gate rejected it, so the project now shows a render the mirror never accepted.
2. **No claim in the ledger serves the canonical render** — 48, 52, 54. Here it is the mirror that holds work the project does not: their fixes came back as DOM operations, which an MCP caller cannot apply, so they were never persisted.


## Deliverable 1 + 2 — every screen, with its Stitch id

| # | screen | id serving the canonical render | its canvas | newest stored id | stored device + canvas | phone/tablet contract | local file |
|---|---|---|---|---|---|---|---|
| 01 | Splash ⚠ | `3eb9d527a5fb46fb8119c5e0e28b0db6` | 2560x2048 | `3eb9d527a5fb` | DESKTOP 2560x2048 | **fails**: canvas>1024, device!=MOBILE, no tablet composition | 01_Splash |
| 02 | Onboarding ⚠ | `c1151762217d460aa9540ba87c8261c4` | 2560x2048 | `c1151762217d` | DESKTOP 2560x2048 | **fails**: canvas>1024, device!=MOBILE, no tablet composition, thin column on a tablet, no real tablet adaptation | 02_Onboarding |
| 03 | Login phone entry ⚠ | `77701a6881f24203b60a87b8ede03c82` | 2560x2048 | `77701a6881f2` | DESKTOP 2560x2048 | **fails**: canvas>1024, device!=MOBILE, no tablet composition, desktop marks | 03_Login_phone_entry |
| 04 | OTP verification ⚠ | `4d8d6ed1b0214349af419775770f820c` | 2560x2048 | `4d8d6ed1b021` | DESKTOP 2560x2048 | **fails**: canvas>1024, device!=MOBILE, no tablet composition | 04_OTP_verification |
| 05 | Customer home super-app ⚠ | `65fdeedc4d824f8bb5ba71545c9093e2` | 2560x3858 | `65fdeedc4d82` | DESKTOP 2560x3858 | **fails**: canvas>1024, device!=MOBILE, desktop marks | 05_Customer_home_super_app |
| 06 | Food home ⚠ | `1a8f9fd34e904d66b36dacb06218f5fc` | 2560x3720 | `1a8f9fd34e90` | DESKTOP 2560x3720 | **fails**: canvas>1024, device!=MOBILE, desktop marks | 06_Food_home |
| 07 | Food category and subcategory ⚠ | `c033de7b49a34d98a7c08753d158a8d8` | 2560x3148 | `c033de7b49a3` | DESKTOP 2560x3148 | **fails**: canvas>1024, device!=MOBILE, desktop marks | 07_Food_category_and_subcategory |
| 08 | Restaurant detail and menu ⚠ | `aca0ef613f88433ca4a6f2a07d082d26` | 2560x4788 | `aca0ef613f88` | DESKTOP 2560x4788 | **fails**: canvas>1024, device!=MOBILE, desktop marks | 08_Restaurant_detail_and_menu |
| 09 | Dish detail vosa bai | `513d9ed0fbbb4a0a848a3892ea4143a9` | 780x3888 | `513d9ed0fbbb` | MOBILE 780x3888 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 09_Dish_detail_vosa_bai |
| 10 | Food cart and checkout | `b20bdff530684689998327aed09460ea` | 780x2866 | `b20bdff53068` | MOBILE 780x2866 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 10_Food_cart_and_checkout |
| 11 | Food order status | `a7168dac6e324a729906cc62d6baf47a` | 780x2892 | `a7168dac6e32` | MOBILE 780x2892 | **fails**: no tablet composition | 11_Food_order_status |
| 12 | Grocery home ⚠ | `975ece93d11048378446449ab387b97b` | 2560x3326 | `975ece93d110` | DESKTOP 2560x3326 | **fails**: canvas>1024, device!=MOBILE, desktop marks | 12_Grocery_home |
| 13 | Grocery category and subcategory ⚠ | `edf30690483d4e87a1135b0790dee93e` | 2560x4136 | `edf30690483d` | DESKTOP 2560x4136 | **fails**: canvas>1024, device!=MOBILE, desktop marks | 13_Grocery_category_and_subcategory |
| 14 | Grocery product detail | `73cd562f0dd643a79367b3edb4ea2278` | 780x2110 | `73cd562f0dd6` | MOBILE 780x2110 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 14_Grocery_product_detail |
| 15 | Choose a ride ⚠ | `5ad17afe294c4fdeae29c3547e61b666` | 2560x2048 | `5ad17afe294c` | DESKTOP 2560x2048 | **fails**: canvas>1024, device!=MOBILE, desktop marks | 15_Choose_a_ride |
| 16 | Parcel delivery type and fare | `3b14bdf34a6e4c55bfa2ac2f6f56ee48` | 780x2460 | `3b14bdf34a6e` | MOBILE 780x2460 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 16_Parcel_delivery_type_and_fare |
| 17 | Processing payment | `aab639310e11435f88d3cbe81cf6356d` | 780x1768 | `aab639310e11` | MOBILE 780x1768 | **fails**: no tablet composition | 17_Processing_payment |
| 18 | Location select | `5d9d1ac743ff46eaa301fa685c33147a` | 780x2144 | `5d9d1ac743ff` | MOBILE 780x2144 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 18_Location_select |
| 19 | Manual address entry ⚠ | `555e2ca99f464cbd9c23942734839ccb` | 2560x2390 | `555e2ca99f46` | DESKTOP 2560x2390 | **fails**: canvas>1024, device!=MOBILE, desktop marks | 19_Manual_address_entry, 19_Manual_address_entry_responsive |
| 20 | Map picker | `078f2c8fb0ea4bc38e0c574c0d96bbda` | 780x1768 | `078f2c8fb0ea` | MOBILE 780x1768 | **fails**: no tablet composition | 20_Map_picker |
| 21 | Confirm location | `c37fa29365a24d37b93d4beb5b92d42d` | 780x3578 | `c37fa29365a2` | MOBILE 780x3578 | **fails**: desktop marks | 21_Confirm_location, 21_Confirm_location_responsive |
| 22 | Saved addresses | `9a5f6de51f66409bacf07b7970ca5486` | 780x2024 | `9a5f6de51f66` | MOBILE 780x2024 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 22_Saved_addresses |
| 23 | Account profile ⚠ | `97dc0bee71364c64abeeafb1ca463827` | 2560x2320 | `97dc0bee7136` | DESKTOP 2560x2320 | **fails**: canvas>1024, device!=MOBILE, desktop marks | 23_Account_profile, 23_Account_profile_responsive |
| 24 | Edit profile | `4239212fbf64408f9d22b3936be5f880` | 780x2330 | `5c0a09895ef9` | DESKTOP 2560x2050 | **fails**: canvas>1024, device!=MOBILE, served != canonical | 24_Edit_profile |
| 25 | Account addresses | `19563e54599a40d5b7b1f66558da6c25` | 780x2948 | `19563e54599a` | MOBILE 780x2948 | meets | 25_Account_addresses, 25_Account_addresses_responsive |
| 26 | Account wallet | `ffad4b9277c84eee8a6965752d52289b` | 780x2542 | `ffad4b9277c8` | MOBILE 780x2542 | **fails**: no tablet composition, desktop marks | 26_Account_wallet |
| 27 | Account activity | `9ee35cd3c05045a0877d173cdd0f5d16` | 780x2644 | `9ee35cd3c050` | MOBILE 780x2644 | meets | 27_Account_activity |
| 28 | Account history ⚠ | `6fbd9b95320f457ebf2dc3b46431f19d` | 2560x2324 | `6fbd9b95320f` | DESKTOP 2560x2324 | **fails**: canvas>1024, device!=MOBILE | 28_Account_history |
| 29 | Account support | `e90caf2373674a848cc8473b3cb01ffc` | 780x2758 | `e90caf237367` | MOBILE 780x2758 | **fails**: no tablet composition | 29_Account_support |
| 30 | Account settings | `c75ddad8939a4c61881701bf65fce22d` | 780x3690 | `be92f2d2e3d0` | DESKTOP 2560x2318 | **fails**: canvas>1024, device!=MOBILE, served != canonical | 30_Account_settings |
| 31 | Identity verification ⚠ | `605420dd72bb45d788a1af9c10fe67f0` | 2560x3214 | `605420dd72bb` | DESKTOP 2560x3214 | **fails**: canvas>1024, device!=MOBILE, no tablet composition, thin column on a tablet, no real tablet adaptation | 31_Identity_verification |
| 32 | Account logout | `1a48273e1fa0436f9624b91f7056e2e4` | 780x1768 | `1a48273e1fa0` | MOBILE 780x1768 | **fails**: no tablet composition, desktop marks | 32_Account_logout |
| 33 | Global loading | `bb2f2276bb7f4490ab31e8e6f7320ae2` | 780x2184 | `bb2f2276bb7f` | MOBILE 780x2184 | **fails**: no tablet composition, desktop marks | 33_Global_loading |
| 34 | Global skeleton ⚠ | `590c9045e6ed4072b2134308806f4a5a` | 2560x2048 | `590c9045e6ed` | DESKTOP 2560x2048 | **fails**: canvas>1024, device!=MOBILE, no tablet composition, desktop marks | 34_Global_skeleton |
| 35 | Global empty ⚠ | `72315c54214d47ccb5190045cb6d6ca1` | 2560x2052 | `72315c54214d` | DESKTOP 2560x2052 | **fails**: canvas>1024, device!=MOBILE | 35_Global_empty |
| 36 | Global error | `18a70964c0084d76a8f0f9ddbdc144ad` | 780x1768 | `18a70964c008` | MOBILE 780x1768 | meets | 36_Global_error |
| 37 | Global retry | `ac939ec89ce042a6bc9087d9ac965703` | 780x2038 | `ac939ec89ce0` | MOBILE 780x2038 | **fails**: no tablet composition | 37_Global_retry |
| 38 | Global offline | `c636bb15d1d84599a70c3391cac68f79` | 780x3346 | `c636bb15d1d8` | MOBILE 780x3346 | meets | 38_Global_offline |
| 39 | Global pending | `925ace32b9c44bf8987838cbbb72e161` | 780x3176 | `925ace32b9c4` | MOBILE 780x3176 | meets | 39_Global_pending |
| 40 | Global unavailable | `270cfe45c2c3462184389aa7c1ff4da9` | 780x1958 | `270cfe45c2c3` | MOBILE 780x1958 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 40_Global_unavailable |
| 41 | Global disabled ⚠ | `4d89f3c86d194bb4b411524465b6f2be` | 2560x2048 | `4d89f3c86d19` | DESKTOP 2560x2048 | **fails**: canvas>1024, device!=MOBILE | 41_Global_disabled |
| 42 | Global confirmation ⚠ | `cbcaa1062979431192cc068203b2e1ce` | 2560x2048 | `cbcaa1062979` | DESKTOP 2560x2048 | **fails**: canvas>1024, device!=MOBILE | 42_Global_confirmation |
| 43 | Ride home | `bddbabcce9054f04927cafe23542de4c` | 780x2808 | `bddbabcce905` | MOBILE 780x2808 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 43_Ride_home |
| 44 | Ride pickup | `34c0b7b543f848e2b3193f7f208c9564` | 780x1768 | `34c0b7b543f8` | MOBILE 780x1768 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 44_Ride_pickup |
| 45 | Ride destination | `b3b0feca6c3b4deb8df7e80e7971c45f` | 780x1778 | `b3b0feca6c3b` | MOBILE 780x1778 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 45_Ride_destination |
| 46 | Ride fare estimate | `c4af5cf7022b4ea9af84c1e7946019fa` | 780x1778 | `c4af5cf7022b` | MOBILE 780x1778 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 46_Ride_fare_estimate |
| 47 | Ride booking confirmation | `609d29f916c34ec193a4c705a423b581` | 780x2638 | `609d29f916c3` | MOBILE 780x2638 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 47_Ride_booking_confirmation |
| 48 | Ride searching for driver ‡ | `8e31ea6bafdd43e589d73edf8910d4ba` | 780x1834 | `8e31ea6bafdd` | MOBILE 780x1834 | **fails**: no tablet composition, served != canonical | 48_Ride_searching_for_driver |
| 49 | Ride driver assigned | `33f62b1dc12e4d2ca461d6d51be63820` | 780x1874 | `33f62b1dc12e` | MOBILE 780x1874 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 49_Ride_driver_assigned |
| 50 | Ride driver arriving | `0ef5987245c2461aafcf40fc2157a6b3` | 780x1900 | `0ef5987245c2` | MOBILE 780x1900 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 50_Ride_driver_arriving |
| 51 | Ride active trip | `e7c3d6a4698047679115772ba7a67618` | 780x2390 | `e7c3d6a46980` | MOBILE 780x2390 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 51_Ride_active_trip |
| 52 | Ride trip completed ‡ | `e4d652be0d574913bde77668414241e2` | 780x1768 | `e4d652be0d57` | MOBILE 780x1768 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation, served != canonical | 52_Ride_trip_completed |
| 53 | Ride receipt | `6480e9eb32a54d1aaaa7b115fd70e1ba` | 780x2242 | `6480e9eb32a5` | MOBILE 780x2242 | meets | 53_Ride_receipt |
| 54 | Ride rating ‡ | `fe91a5c192ce4be1af16e840ffc3004e` | 780x1768 | `fe91a5c192ce` | MOBILE 780x1768 | **fails**: no tablet composition, served != canonical | 54_Ride_rating |
| 55 | Ride history | `77073e67e2ae42b3a48225e8ff7bfb8e` | 780x1768 | `77073e67e2ae` | MOBILE 780x1768 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation, unminted id | 55_Ride_history |
| 56 | Food search results | `a0ce2245abca4f538432040d5f987e5b` | 780x1768 | `a0ce2245abca` | MOBILE 780x1768 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation, desktop marks | 56_Food_search_results |
| 57 | Food order confirmation | `08ac96f0c8b042fba7b927c0758e1796` | 780x2496 | `08ac96f0c8b0` | MOBILE 780x2496 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 57_Food_order_confirmation |
| 58 | Food order completed | `906086f84db74f3abc84bc12e22aed6b` | 780x2018 | `906086f84db7` | MOBILE 780x2018 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation, desktop marks | 58_Food_order_completed |
| 59 | Grocery product browse | `5fd489fef2c74f258b16bac8867b73f2` | 780x2680 | `5fd489fef2c7` | MOBILE 780x2680 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation, desktop marks | 59_Grocery_product_browse |
| 60 | Grocery cart | `56e4b820f5e94acbaca3bf4763e267c5` | 780x3482 | `56e4b820f5e9` | MOBILE 780x3482 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation, desktop marks | 60_Grocery_cart |
| 61 | Grocery checkout | `4da5513fbb394a6e9a4d3a2d4ea64314` | 780x2982 | `4da5513fbb39` | MOBILE 780x2982 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 61_Grocery_checkout |
| 62 | Grocery order confirmation | `759ce5ca69c547d2a214e3d0a4084dfa` | 780x2550 | `759ce5ca69c5` | MOBILE 780x2550 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation, desktop marks | 62_Grocery_order_confirmation |
| 63 | Parcel home | `9084d80e42844ad7b57dc8f805f151bf` | 780x2292 | `9084d80e4284` | MOBILE 780x2292 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation, unminted id | 63_Parcel_home |
| 64 | Parcel sender details | `f96a933fea2e455cb7f4bb59e77d8564` | 780x2372 | `f96a933fea2e` | MOBILE 780x2372 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 64_Parcel_sender_details |
| 65 | Parcel recipient details | `1b723ac666e843cd9c5a9568b6105008` | 780x2946 | `1b723ac666e8` | MOBILE 780x2946 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation, desktop marks | 65_Parcel_recipient_details |
| 66 | Parcel package details | `c7e53623b91c478b824c3005041975e7` | 780x2840 | `c7e53623b91c` | MOBILE 780x2840 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation, desktop marks | 66_Parcel_package_details |
| 67 | Parcel booking confirmation | `fc61189621f54acfa0bddaa907602c11` | 780x2482 | `fc61189621f5` | MOBILE 780x2482 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 67_Parcel_booking_confirmation |
| 68 | Notifications inbox | `15842fea85684af896954b20fef86f4c` | 780x2490 | `15842fea8568` | MOBILE 780x2490 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 68_Notifications_inbox |
| 69 | Notification preferences | `bfff25f5876f492285a704a7c1517acc` | 780x2484 | `bfff25f5876f` | MOBILE 780x2484 | **fails**: no tablet composition, thin column on a tablet, no real tablet adaptation | 69_Notification_preferences |

⚠ = the id in column 3 serves the canonical render but the screen was generated on a 2560px desktop canvas. ‡ = no claim in the ledger serves the canonical render.
The two right-hand id columns differ on the drift slots: column 3 is the id whose bytes match the mirror, column 5 is what the project currently shows for the slot.

## Deliverable 7 — duplicates, variants and superseded renders

Titles the project holds more than once. The canonical id is the one in the table above; every other id under the same title is a stranded predecessor that still renders and still appears in the project.

- **NABIN Ride — Choose Destination (Clean Mobile)** — 3 records; no slot claims it: `d68e15eb1b9c`, `e1322501cb96`, `66206f7527dd`
- **NABIN Ride — Choose Pickup Location** — 4 records; canonical is slot 18: `723da1719bb2`, `c04a88b001d2`, `5d9d1ac743ff`, `b747ec6cf8e3`
- **NABIN Ride — Fare Estimate (Mobile)** — 2 records; no slot claims it: `0e7e282de6bd`, `bd32044c0556`
- **NABIN Ride — Mobility Home (Aizawl)** — 5 records; no slot claims it: `e81abdfdf704`, `1cb60642ce5d`, `14d36cb9d15c`, `d293171fb48b`, `fcc39eb6216b`
- **NABIN Ride — Pre-Booking Confirmation (Mobile)** — 2 records; no slot claims it: `e9e22482bff9`, `a72ae640ac91`
- **NABIN Ride — Rate Trip (Support Redirect)** — 2 records; no slot claims it: `09159e489575`, `f19d326343f9`
- **NABIN Ride — Trip Underway** — 2 records; no slot claims it: `887d48f9c7f8`, `f9a05326e315`
- **NABIN Ride — Trip Underway (Mobile)** — 2 records; no slot claims it: `de5902bf83f3`, `715db294f581`
- **NABIN Super-App — Customer Home** — 2 records; no slot claims it: `f70e74ba7134`, `6407a085d0de`
- **NABIN — Help & Support (Mobile)** — 2 records; no slot claims it: `ce3a444b0e64`, `993f9657b430`
- **NABIN — Identity Verification (Mobile)** — 2 records; no slot claims it: `0b23fd6849a6`, `1c570463093a`
- **NABIN — Notification Settings (Mobile)** — 2 records; canonical is slot 30: `23ea1f01eda5`, `c75ddad8939a`
- **NABIN — Wallet & Payment Methods (Mobile)** — 2 records; no slot claims it: `75f5dd62ac75`, `f8f662e285ec`

### Content overlaps between differently-named screens

The duplicates above share a title. These do not: each pair is two screens covering one capability, which is the class the brief asks deliverable 7 to surface. Declared here because overlap is a product judgement, but every slot cited must exist in the manifest, so an overlap cannot be claimed about a screen that has since been merged away.

- **27 and 28** — Account activity ("recent orders and trips across services", `GET /api/customer/activity`) and Account history ("completed rides, food and grocery orders", `GET /api/customer/orders`) are two lists over two read routes of the same rows. Both are real endpoints, so neither is a fabrication; the question is why a customer has two buttons that open the same set.
- **28 and 55** — Account history and Ride history filter one dataset by different means. `GET /api/customer/orders` has no service parameter, so 55 can only be a client-side filter over 28's rows - see consistency finding D5 for how it should be drawn.
- **30 and 69** — Account settings already claims notifications ("Notifications, language, data, about") and 69 is a dedicated screen over the same `GET/PUT /api/notifications/preferences` pair. 69 was generated because the preference routes had no screen at all; the merge direction needs the owner, not another screen.
- **15 and 43** — Choose a ride (15) and the rebuilt ride home (43) both collect pickup, vehicle and fare. 15 is the pre-redesign entry kept for its render; 43-47 are the canonical chain. Flutter builds from 43, and 15 stays in the project as a stranded variant.
- **11 and 57** — Food order status (11) and food order confirmation (57) both open on a placed order: 11 tracks the lifecycle, 57 is the moment the booking is accepted. Adjacent rather than duplicated - 57 hands to 11 - but the pair needs one owner decision on whether a confirmation deserves its own screen or a state of the tracking screen.

### Superseded renders resident in the project

Not part of the product. They cannot be deleted through the API; if the project must read cleanly, they are either tolerated or the project is rebuilt from the canonical set. 70 records:

- `60cd9a3cee6b471e85b8ef294c5687ca` — Kapam Restaurant — Menu & Details (DESKTOP, 2560x4798)
- `3a52c60d381a402cb141a280563bab7b` — Kapam Restaurant — Vosa Bai Dish Detail (DESKTOP, 2560x3650)
- `df8feadc66de44c498744848cf94dc84` — NABIN Food — Cart & Checkout (DESKTOP, 2560x3662)
- `0d8206bb0af440d78b1f99cc2fd1931a` — NABIN Food — Home & Restaurants (DESKTOP, 2560x3768)
- `c365844236ad44a4af52787032fba0c6` — NABIN Food — Live Order Lifecycle Tracking (DESKTOP, 2560x2588)
- `c752a14d870f4c6a978f5a1d10492f4d` — NABIN Grocery — Miniket Rice 5kg Product Detail (DESKTOP, 2560x4472)
- `36c495f62fef44e8aa029ca8300f7c24` — NABIN Mobility — Ride Home (Mobile) (MOBILE, 780x3526)
- `cd1a9554d6a34acfbf131af967ccb157` — NABIN Mobility — Ride Home (Responsive) (MOBILE, 780x5960)
- `6a8b2599e46041ddb503a7edcc6d5700` — NABIN Parcel — Send Flow & Booking Confirmation (DESKTOP, 2560x2426)
- `49a216d50f154c4d9dd4238e57b2116c` — NABIN Ride — Account Rides Activity (MOBILE, 780x1768)
- `d68e15eb1b9c4c588158dbbd6aed5157` — NABIN Ride — Choose Destination (Clean Mobile) (MOBILE, 780x3014)
- `e1322501cb964866b70cac4e1218db47` — NABIN Ride — Choose Destination (Clean Mobile) (DESKTOP, 2560x2560)
- `66206f7527dd4fb4b46089ac70402cd5` — NABIN Ride — Choose Destination (Clean Mobile) (DESKTOP, 2560x2752)
- `723da1719bb24583a248cf4b4014ed0e` — NABIN Ride — Choose Pickup Location (MOBILE, 780x2632)
- `c04a88b001d242cab2b698a62ccfee47` — NABIN Ride — Choose Pickup Location (MOBILE, 780x2332)
- `b747ec6cf8e3431486db8cffe7663c43` — NABIN Ride — Choose Pickup Location (MOBILE, 780x2320)
- `6055af2f48de4a97bda48d6a59eea810` — NABIN Ride — Confirm Ride Booking (Mobile) (MOBILE, 780x2288)
- `e68126c1b5e84c419f6f84eacfd848fe` — NABIN Ride — Driver Assigned (MOBILE, 780x1788)
- `e80496ea4afc4ff687e56a3b9e221466` — NABIN Ride — Driver En Route to Pickup (MOBILE, 780x1906)
- `4b03c737b0014279abc5696bad417368` — NABIN Ride — Enter Pickup Address (Mobile) (MOBILE, 780x1906)
- `0e7e282de6bd4c41ac018855142f4127` — NABIN Ride — Fare Estimate (Mobile) (MOBILE, 780x1768)
- `bd32044c055640d9b3e8fc1c7801fa4e` — NABIN Ride — Fare Estimate (Mobile) (MOBILE, 780x2220)
- `e81abdfdf70444d0b4b2d0cfe8a4f656` — NABIN Ride — Mobility Home (Aizawl) (MOBILE, 780x3090)
- `1cb60642ce5d4819a32309b39194bdb7` — NABIN Ride — Mobility Home (Aizawl) (DESKTOP, 2560x3576)
- `14d36cb9d15c41d49a7bdf305d9a8648` — NABIN Ride — Mobility Home (Aizawl) (MOBILE, 780x3230)
- `d293171fb48b4abd92c0d2359b8ee20b` — NABIN Ride — Mobility Home (Aizawl) (MOBILE, 780x3638)
- `fcc39eb6216b4a6bba2bf67a21d96506` — NABIN Ride — Mobility Home (Aizawl) (DESKTOP, 2560x3590)
- `bd9ba25e311c4b03819210163fe90b81` — NABIN Ride — Mobility Home (Mobile) (MOBILE, 780x3124)
- `cce8146b9061469baa2b8ab7174ee85a` — NABIN Ride — Pending Driver Acceptance (MOBILE, 780x2122)
- `ab02dcc036ac49b28f01772d45c12236` — NABIN Ride — Pickup Location Capture (Aizawl) (MOBILE, 780x2420)
- `3f2656b30f1641c78e2867c04ca20fd4` — NABIN Ride — Pickup Location Capture (Mobile) (MOBILE, 780x3560)
- `e9e22482bff947aba3b6c818bc0a2d4e` — NABIN Ride — Pre-Booking Confirmation (Mobile) (MOBILE, 780x4304)
- `a72ae640ac914bde9f538916f14468e8` — NABIN Ride — Pre-Booking Confirmation (Mobile) (MOBILE, 780x4348)
- `4c18f45ae3db458295caaefd6f56c2c0` — NABIN Ride — Pre-Booking Location Confirmation (MOBILE, 780x3940)
- `09159e4895754c67b584afb60f530d64` — NABIN Ride — Rate Trip (Support Redirect) (DESKTOP, 2560x2048)
- `f19d326343f94c41a1945046a610e26f` — NABIN Ride — Rate Trip (Support Redirect) (MOBILE, 780x1768)
- `8ee35611bd1a4b3d856d9386115e96d6` — NABIN Ride — Review & Confirm Booking (MOBILE, 780x2638)
- `ff87cdba545d4a6b9d09ffb962eb0a42` — NABIN Ride — Ride Complete (Arrival) (MOBILE, 780x1768)
- `7f2976f127694984bfeab14a47c167b1` — NABIN Ride — Trip Summary (MOBILE, 780x2116)
- `887d48f9c7f84205a7dfd918ffa1d670` — NABIN Ride — Trip Underway (MOBILE, 780x2430)
- `f9a05326e315441d9e9b7483d715f85d` — NABIN Ride — Trip Underway (DESKTOP, 2560x2108)
- `de5902bf83f3436ba85b7ead9208277a` — NABIN Ride — Trip Underway (Mobile) (DESKTOP, 2560x2048)
- `715db294f5814cd4b3ba65ddae2e156d` — NABIN Ride — Trip Underway (Mobile) (MOBILE, 780x2432)
- `9d380673a5e24d309c1705a4dc332f78` — NABIN Ride — Vehicle Selection & Route Quote (DESKTOP, 2560x2048)
- `f70e74ba71344539858d7b8f7c37b016` — NABIN Super-App — Customer Home (DESKTOP, 2560x3908)
- `6407a085d0de4c98938f02527714cefa` — NABIN Super-App — Customer Home (DESKTOP, 2560x3682)
- `b335b5979c8d4b1ca7e490cb1c96dbbd` — NABIN — Activity (Empty State) (MOBILE, 780x2080)
- `8408e75770f64f6c8a6d523eab009f5b` — NABIN — Activity (Failed Reload & In-Flight Retry) (DESKTOP, 2560x2076)
- `1e4b33a1164541a0b291e2b86e3d4920` — NABIN — Activity Feed (Mobile) (DESKTOP, 2560x2612)
- `04155fa629024ec48302cea9571d8249` — NABIN — Addresses (Mobile) (MOBILE, 780x2100)
- `14acfbfc635c4c0f90262495caf7c315` — NABIN — Addresses (Responsive) (MOBILE, 780x3972)
- `31d29971f74040f082ab67db041c1fa3` — NABIN — Completed Order History (Food & Instamart) (MOBILE, 780x3054)
- `e303d4bbf1e54cc495dcffd38e50e44d` — NABIN — Customer Profile Hub (Mobile) (MOBILE, 780x2158)
- `8f9586cf75994275a99a5e1df6fe1957` — NABIN — Edit Profile (Responsive) (MOBILE, 780x3982)
- `64809136848e4559b1867bec59e86451` — NABIN — Feature Disabled (403 Regional Restriction) (DESKTOP, 2560x3202)
- `ce3a444b0e644e1e831459fa5edbb578` — NABIN — Help & Support (Mobile) (MOBILE, 780x1858)
- `993f9657b4304b4c8945a2ef766e9eba` — NABIN — Help & Support (Mobile) (MOBILE, 780x2216)
- `0b23fd6849a641ccbf2d1c3d95b6ed8e` — NABIN — Identity Verification (Mobile) (DESKTOP, 2560x3434)
- `1c570463093a4257b24d65c0256caf49` — NABIN — Identity Verification (Mobile) (MOBILE, 780x2780)
- `42dadd94b828490bbe7c43156e719ac6` — NABIN — Log Out Confirmation Modal (Mobile) (MOBILE, 780x2102)
- `23ea1f01eda54d18bf5133ac37fb0c3f` — NABIN — Notification Settings (Mobile) (MOBILE, 780x3542)
- `e38bec119d8b4586b2aa0a7978f9185e` — NABIN — Offline & Network Unavailable State (Mobile) (DESKTOP, 2560x2860)
- `f0e5c971213545279c028d9e90a2d841` — NABIN — Onboarding (1 of 3) (DESKTOP, 2560x2048)
- `3ad4b1b9b3d7464fad52c08141b04ad4` — NABIN — Payment Pending Verification (Mobile) (MOBILE, 780x2548)
- `fe51ef9b6137467d9e7b98bc8ed89b67` — NABIN — Payment Processing & Terminal States (DESKTOP, 2560x2738)
- `dcbc1c45054e4174a9f850454ad09cbd` — NABIN — Request Failed (Error State) (DESKTOP, 2560x2048)
- `fe490ff538c54e3b8c73a508f08d69e9` — NABIN — Service Paused (Operational Lock) (MOBILE, 780x2750)
- `d7d0eb947bef463caa1550e3ff0390d0` — NABIN — Unified Customer Activity Feed (Responsive) (MOBILE, 780x3842)
- `75f5dd62ac754f119aed23f27c0bd16b` — NABIN — Wallet & Payment Methods (Mobile) (MOBILE, 780x2912)
- `f8f662e285ec4ae3bbca191446f983ce` — NABIN — Wallet & Payment Methods (Mobile) (MOBILE, 780x3124)

### Non-screen records

7 `DESIGN.md` assets — one is created per `upload_design_md` call, so the count is an edit history, not content. 2 illustration/photo prompts.
- `06def0264bbf41249ee26ab2776eaff9` — A modern, clean, premium vector-style isometric 3D digital illustration for an on-demand super app onboarding screen in Mizoram. Depicting a sleek scooter delivery rider and a cab navigating through lush, stylized rolling green hills of Aizawl under a clear sky with modern geometric buildings and map location pin. Vibrant royal blue (#1A3BA2), crisp white, soft blue, and energetic accents. Minimalist, premium tech aesthetic with soft shadows, clean vector rendering on clean background, isolated, elegant product illustration. (1200x896)
- `9deabe63eb38440d97be326435f56fc5` — Delicious authentic Mizo dish Vosa Bai (traditional wood-smoked pork stew with tender pumpkin leaves, fermented soybeans bekang, organic bamboo shoot, and wild hill herbs in herbal broth) served in a rustic ceramic bowl with warm ambient lighting on a wooden table, fresh herbs garnish, professional food photography, top-down angled shot, mouthwatering detail. (1376x768)
