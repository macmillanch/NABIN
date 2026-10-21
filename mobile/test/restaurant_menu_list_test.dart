import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/core/network/nabin_api_service.dart';
import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/core/router/restaurant_router.dart';
import 'package:mobile/features/restaurant/presentation/screens/restaurant_dish_detail_screen.dart';

import 'support/http_stub.dart';

// -----------------------------------------------------------------------------
// R06 — the Restaurant Merchant menu list, held to what the catalogue read returns.
//
// The backend classification behind these tests was measured on 2026-10-08 against the local
// development backend (`backend/r10_contract_probe.js`), and it is why this list is a read view
// and nothing more:
//
//   READ                    supported and durable  GET /api/merchant/catalog (token-scoped)
//   UPDATE NAME             no route
//   UPDATE DESCRIPTION      no route
//   UPDATE CATEGORY         no route
//   UPDATE PRICE            no route for a menu item
//   UPDATE IMAGE            404 MENU_ITEM_NOT_FOUND, and nothing writes products.image_url
//   TOGGLE AVAILABILITY     404 "Restaurant not found." for a real merchant; not durable either
//   CREATE / DELETE ITEM    no route
//
// The `products` read selects id, sku, name, description, category, price, discount_price,
// is_available, in_stock_quantity, image_url, created_at, updated_at. It has no `is_veg`, no
// rating, no review count, no preparation time and no sales column, so a card that shows one of
// those is inventing it.
//
// What this suite guards is narrow and absolute: the card's words come from the row, a blank
// column stays a blank column, availability is stated rather than switched, and no tap writes.
// -----------------------------------------------------------------------------

const String kMerchantId = 'mnr_stub_restaurant';
const String kDishId = 'stub-dish-1';
const String kImageHost = 'cdn.stub-images.example';
const String kMissing = '— Not available';

/// One `products` row, in the shape `server.js:6960` selects it.
///
/// A column a test wants absent is passed as `null`, because NULL is what the real read returns
/// for it — the fabrication this suite exists to catch lived in the `??` fallbacks, not in the
/// transport.
Map<String, dynamic> _row({
  Object? id = kDishId,
  Object? sku = 'STUB-SKU-1',
  Object? name = 'Stub Dish One',
  Object? description = 'Stub description for the first dish.',
  Object? category = 'Stub Category',
  Object? price = 185,
  Object? discountPrice,
  Object? isAvailable = true,
  Object? inStockQuantity = -1,
  Object? imageUrl,
  Object? updatedAt = '2026-09-14T17:56:52.280727+00:00',
  Map<String, dynamic>? extra,
}) {
  return <String, dynamic>{
    'id': id,
    'sku': sku,
    'name': name,
    'description': description,
    'category': category,
    'price': price,
    'discount_price': discountPrice,
    'is_available': isAvailable,
    'in_stock_quantity': inStockQuantity,
    'image_url': imageUrl,
    'updated_at': updatedAt,
    ...?extra,
  };
}

/// The answer every test starts from: a successful, token-scoped catalogue read of one dish, on
/// a console that otherwise has nothing to show.
///
/// `products` replaces the rows; `catalog` replaces the whole envelope, for the cases where the
/// envelope is the point (a refusal, or the degraded read that answers with an empty list).
/// `respond` overrides any single route — return null to fall through to the defaults.
void _menuOk({
  List<Map<String, dynamic>>? products,
  Map<String, dynamic>? catalog,
  (int, String)? Function(String method, Uri url)? respond,
}) {
  (int, String) handler(String method, Uri url, String body) {
    final over = respond?.call(method, url);
    if (over != null) return over;
    final path = url.path;
    if (method == 'GET' && path.endsWith('/merchant/services')) {
      return (200, jsonEncode(<String, dynamic>{
        'success': true,
        'merchantId': kMerchantId,
        'services': <String>['RESTAURANT'],
        'profile': <String, dynamic>{'name': 'Stub Kitchen'},
        'isOpen': true,
      }));
    }
    if (method == 'GET' && path.endsWith('/orders')) {
      return (200, jsonEncode(<String, dynamic>{'success': true, 'orders': <dynamic>[]}));
    }
    if (method == 'GET' && path.endsWith('/dashboard')) {
      return (200, jsonEncode(<String, dynamic>{
        'success': true,
        'restaurant': <String, dynamic>{'id': kMerchantId, 'name': 'Stub Kitchen'},
      }));
    }
    if (method == 'GET' && path.endsWith('/merchant/catalog')) {
      final rows = products ?? <Map<String, dynamic>>[_row()];
      return (200, jsonEncode(catalog ?? <String, dynamic>{
        'success': true,
        'merchantId': kMerchantId,
        'count': rows.length,
        'products': rows,
      }));
    }
    return (404, '{"success":false}');
  }
  stubHandler = handler;
}

/// The painted text of the mounted tree, for the scans that must read the whole screen at once.
String paintedText(WidgetTester tester) =>
    tester.widgetList<Text>(find.byType(Text)).map((t) => t.data ?? '').join(' | ');

/// Requests to the API only: the photo loader goes through the same stubbed client, and a picture
/// is not a read of the merchant's data.
List<String> get apiRequests => stubSeen.where((s) => s.contains('/api/')).toList();

/// Writes of any verb, anywhere in the run. The menu tab is a view; this must stay empty.
List<String> get writeRequests =>
    stubSeen.where((s) => !s.startsWith('GET ')).toList();

/// Pumps the real merchant console with a signed-in RESTAURANT merchant and opens its Menu tab.
///
/// `restaurantRouter` is a singleton whose location survives between tests, so this parks it at
/// `/dashboard` before the first frame instead of assuming where the last test left it. That
/// ordering matters: a dish detail left on screen mounts for one frame and fires its own
/// catalogue read, and a test that stubs "the catalogue fails" would then be failing the wrong
/// read. The surface is tall because the menu is a `ListView`: cards below the fold are evicted,
/// and a `find` on their text would then fail for reasons that have nothing to do with what the
/// screen was told.
Future<void> pumpMenuTab(WidgetTester tester) async {
  tester.view.physicalSize = const Size(2400, 3000);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);
  SessionManager.instance.saveSession(
    token: 'merchant-token',
    user: <String, dynamic>{'id': kMerchantId, 'restaurantId': kMerchantId, 'name': 'Stub Kitchen'},
  );
  restaurantRouter.go('/dashboard');
  await tester.pumpWidget(MaterialApp.router(routerConfig: restaurantRouter));
  // A loading spinner never settles, so the event loop is driven with fixed pumps.
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
  await tester.tap(find.descendant(
    of: find.byType(NavigationBar),
    matching: find.text('Menu'),
  ));
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    NabinApiService.setAuthToken('merchant-token');
  });

  tearDown(() {
    HttpOverrides.global = null;
    NabinApiService.setAuthToken(null);
    SessionManager.instance.clearSession();
  });

  group('the card says what the row says', () {
    testWidgets('R06-01 the stored name, description, category and price are shown as returned',
        (tester) async {
      _menuOk(products: <Map<String, dynamic>>[
        _row(
          name: 'Braised Ridge Gourd',
          description: 'Cooked with smoked pork.',
          category: 'Sunday Specials',
          price: 240,
        ),
      ]);
      await pumpMenuTab(tester);

      expect(find.text('Braised Ridge Gourd'), findsOneWidget);
      expect(find.text('Cooked with smoked pork.'), findsOneWidget);
      expect(find.text('Sunday Specials'), findsOneWidget);
      expect(find.text('₹240'), findsOneWidget);
    });

    testWidgets('R06-02 a row with no name is not renamed "Untitled item"', (tester) async {
      _menuOk(products: <Map<String, dynamic>>[_row(name: null)]);
      await pumpMenuTab(tester);

      expect(find.text('Untitled item'), findsNothing);
      expect(find.descendant(of: find.byType(ListView), matching: find.text(kMissing)),
          findsWidgets);
    });

    testWidgets('R06-03 a name that is only whitespace is blank, not relabelled', (tester) async {
      _menuOk(products: <Map<String, dynamic>>[_row(name: '   ')]);
      await pumpMenuTab(tester);

      expect(find.text('Untitled item'), findsNothing);
      // Safe trimming happened; nothing was substituted for the value that was not there.
      expect(find.text(kMissing), findsWidgets);
    });

    testWidgets('R06-04 a row with no price is not priced at ₹0', (tester) async {
      _menuOk(products: <Map<String, dynamic>>[_row(price: null)]);
      await pumpMenuTab(tester);

      expect(find.text('₹0'), findsNothing);
      expect(find.textContaining('₹0'), findsNothing);
    });

    testWidgets('R06-05 a stored price is painted exactly, paise and all', (tester) async {
      _menuOk(products: <Map<String, dynamic>>[
        _row(id: 'stub-dish-a', price: 95.5),
        _row(id: 'stub-dish-b', price: 12),
      ]);
      await pumpMenuTab(tester);

      expect(find.text('₹95.5'), findsOneWidget);
      expect(find.text('₹12'), findsOneWidget);
    });

    testWidgets('R06-06 a row with no category is not filed under "Menu"', (tester) async {
      _menuOk(products: <Map<String, dynamic>>[_row(category: null)]);
      await pumpMenuTab(tester);

      // Scoped to the list: the header and the navigation bar legitimately say 'Menu'.
      expect(find.descendant(of: find.byType(ListView), matching: find.text('Menu')),
          findsNothing);
      expect(find.descendant(of: find.byType(ListView), matching: find.text(kMissing)),
          findsWidgets);
    });

    testWidgets('R06-07 a missing description is not written on the merchant\'s behalf',
        (tester) async {
      _menuOk(products: <Map<String, dynamic>>[_row(description: null)]);
      await pumpMenuTab(tester);

      expect(find.text('Stub description for the first dish.'), findsNothing);
      expect(find.descendant(of: find.byType(ListView), matching: find.text(kMissing)),
          findsWidgets);
    });

    testWidgets('R06-08 the card quotes the stored price, not the discount wearing its clothes',
        (tester) async {
      // `discount_price ?? price` used to paint whichever column was set as one unlabelled
      // number. The labelled pair lives on the dish detail; the card may not guess at it.
      _menuOk(products: <Map<String, dynamic>>[_row(price: 200, discountPrice: 150)]);
      await pumpMenuTab(tester);

      expect(find.text('₹200'), findsOneWidget);
      expect(find.text('₹150'), findsNothing);
    });

    testWidgets('R06-09 a discount with no price leaves the price blank', (tester) async {
      _menuOk(products: <Map<String, dynamic>>[_row(price: null, discountPrice: 150)]);
      await pumpMenuTab(tester);

      expect(find.text('₹150'), findsNothing);
      expect(find.text('₹0'), findsNothing);
    });

    testWidgets('R06-10 two rows keep their own values, side by side', (tester) async {
      _menuOk(products: <Map<String, dynamic>>[
        _row(id: 'stub-dish-a', name: 'First Stub Dish', category: 'First Category', price: 60),
        _row(id: 'stub-dish-b', name: 'Second Stub Dish', category: 'Second Category', price: 75),
      ]);
      await pumpMenuTab(tester);

      expect(find.text('First Stub Dish'), findsOneWidget);
      expect(find.text('Second Stub Dish'), findsOneWidget);
      expect(find.text('First Category'), findsOneWidget);
      expect(find.text('Second Category'), findsOneWidget);
      expect(find.text('₹60'), findsOneWidget);
      expect(find.text('₹75'), findsOneWidget);
      // Each card is keyed by the id the read gave it, so it cannot address another store's dish.
      expect(find.byKey(const ValueKey('r06-menu-row-stub-dish-a')), findsOneWidget);
      expect(find.byKey(const ValueKey('r06-menu-row-stub-dish-b')), findsOneWidget);
    });

    testWidgets('R06-11 the list borrows no second read and sends no id of its own',
        (tester) async {
      _menuOk();
      await pumpMenuTab(tester);

      expect(stubSaw('GET', '/merchant/catalog'), isTrue);
      // The tab adds no catalogue request of its own beyond the console's single read, and the
      // URL carries no merchant or restaurant id — the backend scopes the read to the bearer.
      expect(stubSeen.where((s) => s.contains('/merchant/catalog')).length, 1);
      expect(apiRequests.where((s) => s.contains('/menu/')), isEmpty);
    });

    testWidgets('R06-12 the values survive the list recycling them', (tester) async {
      _menuOk(products: <Map<String, dynamic>>[
        for (var i = 0; i < 24; i++) _row(id: 'stub-dish-$i', name: 'Stub Dish $i', price: 100 + i),
      ]);
      await pumpMenuTab(tester);

      expect(find.text('Stub Dish 0'), findsOneWidget);
      // Scroll far enough that the first cards are disposed, then back. A single drag cannot
      // reach row 23: the list is ~24 cards tall and a drag moves exactly its offset.
      for (var i = 0; i < 4; i++) {
        await tester.drag(find.byType(ListView), const Offset(0, -2000));
        for (var k = 0; k < 4; k++) {
          await tester.pump(const Duration(milliseconds: 40));
        }
      }
      expect(find.text('Stub Dish 0'), findsNothing);
      expect(find.text('Stub Dish 23'), findsOneWidget);

      for (var i = 0; i < 4; i++) {
        await tester.drag(find.byType(ListView), const Offset(0, 2000));
        for (var k = 0; k < 4; k++) {
          await tester.pump(const Duration(milliseconds: 40));
        }
      }

      expect(find.text('Stub Dish 0'), findsOneWidget);
      expect(find.text('₹100'), findsOneWidget);
      expect(writeRequests, isEmpty);
    });
  });

  group('availability is read, not switched', () {
    testWidgets('R06-13 is_available true reads as available, in the dish detail\'s words',
        (tester) async {
      _menuOk(products: <Map<String, dynamic>>[_row(isAvailable: true)]);
      await pumpMenuTab(tester);

      expect(find.text('Available for orders'), findsOneWidget);
    });

    testWidgets('R06-14 is_available false reads as not available', (tester) async {
      _menuOk(products: <Map<String, dynamic>>[_row(isAvailable: false)]);
      await pumpMenuTab(tester);

      expect(find.text('Not available for orders'), findsOneWidget);
      expect(find.text('Available for orders'), findsNothing);
    });

    testWidgets('R06-15 a row that says nothing about availability is not called unavailable',
        (tester) async {
      _menuOk(products: <Map<String, dynamic>>[_row(isAvailable: null)]);
      await pumpMenuTab(tester);

      expect(find.text('Not stated by NABIN'), findsOneWidget);
      expect(find.text('Available for orders'), findsNothing);
      expect(find.text('Not available for orders'), findsNothing);
    });

    testWidgets('R06-16 no availability control exists on the list', (tester) async {
      _menuOk(products: <Map<String, dynamic>>[_row(isAvailable: true)]);
      await pumpMenuTab(tester);

      expect(find.byType(Switch), findsNothing);
      expect(find.byType(SwitchListTile), findsNothing);
      expect(find.byType(Checkbox), findsNothing);
      expect(find.byType(ToggleButtons), findsNothing);
      // The old copy called `is_available` a stock statement; stock is a different column, and
      // 'Disabled' was the other half of the same pretence.
      expect(find.textContaining('In Stock'), findsNothing);
      expect(find.text('Disabled'), findsNothing);
    });

    testWidgets('R06-17 nothing on this screen can aim at the non-durable toggle',
        (tester) async {
      _menuOk(products: <Map<String, dynamic>>[
        _row(isAvailable: true),
        _row(id: 'stub-dish-b', isAvailable: false),
      ]);
      await pumpMenuTab(tester);

      // Tapping a card is the only gesture the list offers, and it navigates (R06-24).
      await tester.tap(find.byKey(const ValueKey('r06-menu-row-stub-dish-b')));
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(writeRequests, isEmpty);
      expect(stubSeen.any((s) => s.contains('/toggle')), isFalse);
    });

    testWidgets('R06-18 a refused read that succeeds on retry comes back from the server',
        (tester) async {
      // The read is refused for as long as the flag stands, not "once": held down to the state
      // the screen is in rather than to how many requests happened to be made on the way there.
      var refuse = true;
      _menuOk(
        products: <Map<String, dynamic>>[
          _row(name: 'Smoked Bamboo Shoot', price: 130, category: 'Seasonal', isAvailable: false),
        ],
        respond: (method, url) {
          if (refuse && url.path.endsWith('/merchant/catalog')) {
            return (503, jsonEncode({'success': false, 'error': 'Store unavailable'}));
          }
          return null;
        },
      );
      await pumpMenuTab(tester);

      expect(find.text('Menu unavailable'), findsOneWidget);
      expect(find.text('No dishes listed yet'), findsNothing);

      refuse = false;
      await tester.tap(find.text('Try again'));
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(find.text('Smoked Bamboo Shoot'), findsOneWidget);
      expect(find.text('₹130'), findsOneWidget);
      expect(find.text('Seasonal'), findsOneWidget);
      expect(find.text('Not available for orders'), findsOneWidget);
    });
  });

  group('the columns this read does not have stay off the card', () {
    testWidgets('R06-19 no vegetarian mark is painted from a column products has never had',
        (tester) async {
      // Even a row that DID carry `is_veg` must produce no badge: `products` has no such column,
      // so honouring the key would bless a value the contract cannot deliver.
      _menuOk(products: <Map<String, dynamic>>[
        _row(name: 'Bamboo Shoot Pickle', extra: <String, dynamic>{'is_veg': true}),
        _row(id: 'stub-dish-b', name: 'Fish Head Curry', extra: <String, dynamic>{'is_veg': false}),
      ]);
      await pumpMenuTab(tester);

      expect(find.byIcon(Icons.fiber_manual_record), findsNothing);
      expect(find.text('Vegetarian'), findsNothing);
      expect(find.text('Non-vegetarian'), findsNothing);
    });

    testWidgets('R06-20 no rating, review, sales or preparation-time claim appears',
        (tester) async {
      _menuOk();
      await pumpMenuTab(tester);

      final painted = paintedText(tester);
      for (final internal in <String>[
        'rating', 'Rating', 'review', 'Review', 'sold', 'sales', 'Sales', 'ordersToday',
        'salesToday', 'prep', 'Prep', '4.8', '★',
      ]) {
        expect(painted, isNot(contains(internal)), reason: internal);
      }
    });

    testWidgets('R06-21 no image is invented for a dish that has none', (tester) async {
      _menuOk(products: <Map<String, dynamic>>[_row(imageUrl: null)]);
      await pumpMenuTab(tester);

      expect(find.byType(Image), findsNothing);
      // A placeholder is not a request: nothing left the process but the console's own reads.
      expect(stubSeen.where((s) => s.contains(kImageHost)), isEmpty);
    });

    testWidgets('R06-22 the photo the card asks for is the stored URL, not a remade one',
        (tester) async {
      const stored = 'https://$kImageHost/dish/stub-one.jpg';
      _menuOk(products: <Map<String, dynamic>>[_row(imageUrl: stored)]);
      await pumpMenuTab(tester);

      expect(find.byType(Image), findsOneWidget);
      final image = tester.widget<Image>(find.byType(Image));
      expect((image.image as NetworkImage).url, stored);
      // No resized variant, no stand-in from another store, no second host: the widget carries the
      // one URL the row supplied. (`flutter_test`'s Image.network does not fetch through
      // HttpOverrides.global, so the request itself is not observable here — the URL it would
      // fetch is, and that is the claim this test makes.)
      expect(stubSeen.where((s) => s.contains(kImageHost)), isEmpty);
      expect(writeRequests, isEmpty);
    });

    testWidgets('R06-23 a photo that will not load falls back to the placeholder, not a substitute',
        (tester) async {
      _menuOk(products: <Map<String, dynamic>>[
        _row(imageUrl: 'https://$kImageHost/dish/missing.jpg'),
      ]);
      await pumpMenuTab(tester);

      // The default handler answers 404 for anything that is not one of the console's reads, so
      // the picture fails and the placeholder is what remains.
      expect(find.byIcon(Icons.fastfood_rounded), findsOneWidget);
      expect(find.textContaining('https://'), findsNothing);
    });

    testWidgets('R06-24 no upload control, and no storage promise, on a read-only card',
        (tester) async {
      _menuOk(products: <Map<String, dynamic>>[_row(imageUrl: null)]);
      await pumpMenuTab(tester);

      expect(find.textContaining('Change photo'), findsNothing);
      expect(find.textContaining('Upload'), findsNothing);
      expect(find.byIcon(Icons.photo_camera), findsNothing);
      expect(find.byIcon(Icons.photo_camera_rounded), findsNothing);
    });
  });

  group('the list is a view, not an editor', () {
    testWidgets('R06-25 a card tap opens that dish\'s own read-only detail', (tester) async {
      _menuOk();
      await pumpMenuTab(tester);

      await tester.tap(find.byKey(const ValueKey('r06-menu-row-$kDishId')));
      for (var i = 0; i < 20; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }

      expect(find.byType(RestaurantDishDetailScreen), findsOneWidget);
      expect(writeRequests, isEmpty);
    });

    testWidgets('R06-26 no create, delete, edit or save affordance is left on the tab',
        (tester) async {
      _menuOk();
      await pumpMenuTab(tester);

      expect(find.text('Add Dish'), findsNothing);
      expect(find.byIcon(Icons.add), findsNothing);
      expect(find.byIcon(Icons.edit), findsNothing);
      expect(find.byIcon(Icons.edit_outlined), findsNothing);
      expect(find.byIcon(Icons.delete), findsNothing);
      expect(find.byIcon(Icons.delete_outline), findsNothing);
      expect(find.text('Save'), findsNothing);
      expect(find.text('Update'), findsNothing);

      // Inside the list the only interactive thing is the card itself: no button of any shape.
      expect(
        find.descendant(
          of: find.byType(ListView),
          matching: find.bySubtype<ButtonStyleButton>(),
        ),
        findsNothing,
      );
    });

    testWidgets('R06-27 the header states the limitation instead of hiding behind a button',
        (tester) async {
      _menuOk();
      await pumpMenuTab(tester);

      expect(find.text('Menu Catalog'), findsOneWidget);
      expect(find.text('No editing in this app'), findsOneWidget);
    });

    testWidgets('R06-28 nothing claims a change was saved', (tester) async {
      _menuOk(products: <Map<String, dynamic>>[_row(), _row(id: 'stub-dish-b')]);
      await pumpMenuTab(tester);

      final painted = paintedText(tester);
      for (final claim in <String>[
        'Saved', 'saved', 'Updated', 'updated', 'Changes saved', 'Enabled', 'enabled', 'Disabled',
      ]) {
        expect(painted, isNot(contains(claim)), reason: claim);
      }
    });

    testWidgets('R06-29 the tab keeps its fields inside a narrow phone width', (tester) async {
      // Every field blank at once is the widest text this list can be handed: '— Not available'
      // sits opposite 'Not available for orders' in the same Row. The surface is resized AFTER
      // the console has loaded, so what is measured is the Menu tab and not the Dashboard tab
      // that would otherwise be painted at this width on the way in.
      _menuOk(products: <Map<String, dynamic>>[
        _row(name: null, description: null, category: null, price: null, isAvailable: false),
      ]);
      await pumpMenuTab(tester);
      tester.view.physicalSize = const Size(780, 1600); // 390 logical — a small phone
      tester.view.devicePixelRatio = 2.0;
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      // Taken, not fixed: the shell's app-bar store switcher overflows at this width on EVERY
      // tab (restaurant_main_shell.dart:1532 and :1562) — the two pills in the test font, whose
      // glyphs are far wider than the app's real ones. That chrome is outside R06's brief, so
      // this test cannot make a whole-frame "no exceptions" claim without pretending the shell
      // is responsive. What it does claim is the narrower, own-to-this-tab thing: the boxes the
      // menu list painted are inside the surface.
      while (true) {
        if (tester.takeException() == null) break;
      }

      // Nothing the card was told is painted off the surface.
      for (final label in <String>[
        kMissing, 'Not available for orders', 'No editing in this app', 'Menu Catalog',
      ]) {
        final finder = find.text(label);
        expect(finder, findsWidgets, reason: label);
        for (var i = 0; i < finder.evaluate().length; i++) {
          expect(tester.getBottomRight(finder.at(i)).dx, lessThanOrEqualTo(390.0), reason: label);
        }
      }
    });
  });

  group('a refused read is never an empty menu', () {
    testWidgets('R06-30 a 403 shows a refusal, not "no dishes listed yet"', (tester) async {
      _menuOk(respond: (method, url) {
        if (url.path.endsWith('/merchant/catalog')) {
          return (403, jsonEncode({'success': false, 'code': 'MERCHANT_MISMATCH'}));
        }
        return null;
      });
      await pumpMenuTab(tester);

      expect(find.text('Menu unavailable'), findsOneWidget);
      expect(find.text('No dishes listed yet'), findsNothing);
      expect(find.text('Stub Dish One'), findsNothing);
    });

    testWidgets('R06-31 a closed session is still an error state, never an empty store',
        (tester) async {
      _menuOk(respond: (method, url) {
        if (url.path.endsWith('/merchant/catalog')) {
          return (401, jsonEncode({'success': false, 'error': 'Authentication required.'}));
        }
        return null;
      });
      await pumpMenuTab(tester);

      expect(find.text('Menu unavailable'), findsOneWidget);
      expect(find.text('No dishes listed yet'), findsNothing);
    });

    testWidgets('R06-32 a degraded read that answers with an empty list is called unreadable',
        (tester) async {
      // This is the envelope `server.js` returns when Postgres cannot be reached: success, zero
      // rows, `degraded: true`. Rendered as an empty menu it tells a merchant their dishes are
      // gone, on the strength of a field that says the opposite.
      _menuOk(catalog: <String, dynamic>{
        'success': true,
        'merchantId': kMerchantId,
        'count': 0,
        'products': <Map<String, dynamic>>[],
        'degraded': true,
      });
      await pumpMenuTab(tester);

      expect(find.text('Menu unavailable'), findsOneWidget);
      expect(find.text('No dishes listed yet'), findsNothing);
    });

    testWidgets('R06-33 a genuine empty catalogue is still shown as empty', (tester) async {
      _menuOk(products: <Map<String, dynamic>>[]);
      await pumpMenuTab(tester);

      expect(find.text('No dishes listed yet'), findsOneWidget);
      expect(find.text('Menu unavailable'), findsNothing);
    });

    testWidgets('R06-34 the empty message points at no entrance that does not exist',
        (tester) async {
      _menuOk(products: <Map<String, dynamic>>[]);
      await pumpMenuTab(tester);

      // It used to name a "merchant portal" as where dishes get added. No route here creates
      // one, so the sentence cannot promise a way in this app has not measured.
      final painted = paintedText(tester);
      expect(painted, isNot(contains('portal')));
      expect(painted, isNot(contains('Portal')));
    });
  });

  group('the scans', () {
    testWidgets('R06-35 no fixture, demo or Stitch-derived value is painted on the tab',
        (tester) async {
      _menuOk(products: <Map<String, dynamic>>[
        _row(),
        _row(id: 'stub-dish-b', name: null, category: null, price: null, isAvailable: null),
      ]);
      await pumpMenuTab(tester);

      final painted = paintedText(tester);
      for (final invented in <String>[
        'Aizawl', 'MZ-01', 'ORD-MZ-9941', 'Vanlalruati', 'Lalremruata', 'Delhi', 'Imphal',
        'Central Hub', 'GATEWAY_TIMEOUT', '504', '₹420', '₹120', 'Untitled item', 'Biryani',
        'Paneer', 'Gulab Jamun', 'Chaap', 'Unsplash', 'in_memory', 'in-memory', 'Postgres',
        'postgres', 'server.js', 'ReferenceError', 'Cloudinary', 'undefined', 'is_veg', 'rest_1',
        kMerchantId, kDishId,
      ]) {
        expect(painted, isNot(contains(invented)), reason: invented);
      }
      // A blank is painted as the honest marker, never as the word for nothing.
      expect(painted, isNot(contains('null')));
      expect(painted, contains(kMissing));
      expect(painted, contains('Not stated by NABIN'));
    });

    testWidgets('R06-36 the list ships the session bearer and no identity or key of its own',
        (tester) async {
      _menuOk();
      await pumpMenuTab(tester);

      for (var i = 0; i < stubSeen.length; i++) {
        if (!stubSeen[i].contains('/api/')) continue;
        expect(stubHeaders[i]['authorization'], 'Bearer merchant-token');
      }
      final raw = stubSeen.join('\n') + stubHeaders.map((h) => h.values.join(' ')).join(' ');
      for (final secret in <String>[
        'service_role', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'sk-', 'service-key',
      ]) {
        expect(raw, isNot(contains(secret)), reason: secret);
      }
    });

    testWidgets('R06-37 the menu tab sends no write at all, ever', (tester) async {
      _menuOk(products: <Map<String, dynamic>>[
        _row(isAvailable: true),
        _row(id: 'stub-dish-b', isAvailable: false),
        _row(id: 'stub-dish-c', isAvailable: null),
      ]);
      await pumpMenuTab(tester);

      expect(apiRequests.any((s) => s.contains('/merchant/catalog')), isTrue);
      expect(writeRequests, isEmpty, reason: 'a read view must not send a single write');
    });
  });
}
