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
// R10 — Restaurant Merchant Dish Detail.
//
// The backend classification this suite exists to hold in place was measured against the local
// development backend on 2026-10-08 (`backend/r10_contract_probe.js`, with direct PostgreSQL
// reads as the witness):
//
//   READ                    supported and durable  GET /api/merchant/catalog (token-scoped)
//   UPDATE NAME             no route   (Express 404 page)
//   UPDATE DESCRIPTION      no route
//   UPDATE CATEGORY         no route
//   UPDATE PRICE            no route for a menu item
//   UPDATE IMAGE            404 MENU_ITEM_NOT_FOUND, and nothing writes products.image_url
//   TOGGLE AVAILABILITY     404 "Restaurant not found." for a real merchant; not durable either
//   CREATE / DELETE ITEM    no route
//
// So the screen is read-only, and these tests are the guarantee that it stays that way: one GET,
// no write, no control that pretends, no value the read did not return.
// -----------------------------------------------------------------------------

const String kMerchantId = 'mnr_stub_restaurant';
const String kDishId = 'stub-dish-1';
const String kImageHost = 'cdn.stub-images.example';

/// One `products` row in the shape `server.js:6960` selects. Columns a test wants absent are
/// passed as `null`, because that is what the real read returns for them.
Map<String, dynamic> _row({
  String id = kDishId,
  Object? sku = 'STUB-SKU-1',
  Object? name = 'Stub Dish One',
  Object? description = 'Stub description for the first dish.',
  Object? category = 'Stub Category',
  Object? price = 60,
  Object? discountPrice,
  Object? isAvailable = true,
  Object? inStockQuantity = -1,
  Object? imageUrl,
  Object? updatedAt = '2026-09-14T17:56:52.280727+00:00',
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
  };
}

/// The handler every test starts from: a live, successful, token-scoped catalogue read of one
/// dish. Tests replace it wholesale when they need a different answer.
void _catalogOk({List<Map<String, dynamic>>? products, (int, String) Function(String, Uri)? respond}) {
  stubHandler = (method, url, body) {
    if (respond != null) return respond(method, url);
    final path = url.path;
    if (method == 'GET' && path.endsWith('/merchant/catalog')) {
      final rows = products ?? <Map<String, dynamic>>[_row()];
      return (200, jsonEncode(<String, dynamic>{
        'success': true,
        'merchantId': kMerchantId,
        'count': rows.length,
        'products': rows,
      }));
    }
    // Image bytes and anything else this screen is not supposed to ask for.
    return (404, '{"success":false}');
  };
}

/// Requests to the API only: the photo loader also goes through the stubbed client, and it must
/// not be counted as a read of the merchant's data.
List<String> get apiRequests => stubSeen.where((s) => s.contains('/api/')).toList();

int get apiRequestCount => apiRequests.length;

/// Advances time far enough for a route transition to finish and any read in flight to land.
///
/// Bounded on purpose: `pumpAndSettle` never returns while a `CircularProgressIndicator` is on
/// screen, and this screen shows exactly that while a read is in flight.
Future<void> pumpFrames(WidgetTester tester, [int frames = 30]) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

/// Pumps the screen on its own, the way the router builds it after the auth redirect.
///
/// The default surface is wide (the tablet frame the Stitch brief asks for), and `dpr` is
/// separate because a physical size of 390 at dpr 3.0 is a 130logical dp phone, not a 390 one.
Future<void> pumpDetail(
    WidgetTester tester, {
      String dishId = kDishId,
      Size surface = const Size(2400, 3000),
      double dpr = 3.0,
    }) async {
  tester.view.physicalSize = surface;
  tester.view.devicePixelRatio = dpr;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    home: RestaurantDishDetailScreen(dishId: dishId),
  ));
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

/// Pumps the real router with a signed-in merchant session.
///
/// `restaurantRouter` is a singleton, so its location survives from one test to the next; every
/// caller therefore drives it to a known place instead of assuming it is where the last test left
/// it. The redirect still runs, so an unauthenticated caller lands on `/login` even when asked
/// for `/dashboard` — that is part of what these tests observe.
Future<void> pumpRouter(WidgetTester tester, {bool signedIn = true}) async {
  tester.view.physicalSize = const Size(2400, 3000);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);
  if (signedIn) {
    SessionManager.instance.saveSession(
      token: 'merchant-token',
      user: <String, dynamic>{'id': kMerchantId, 'restaurantId': kMerchantId, 'name': 'Stub Kitchen'},
    );
  }
  await tester.pumpWidget(MaterialApp.router(routerConfig: restaurantRouter));
  restaurantRouter.go(signedIn ? '/dashboard' : '/login');
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

  group('the read is one authenticated, self-scoped GET', () {
    testWidgets('R10-01 the detail screen reads the merchant catalogue', (tester) async {
      _catalogOk();
      await pumpDetail(tester);

      expect(stubSaw('GET', '/merchant/catalog'), isTrue);
      expect(find.byType(RestaurantDishDetailScreen), findsOneWidget);
    });

    testWidgets('R10-02 exactly one request for the whole screen', (tester) async {
      _catalogOk();
      await pumpDetail(tester);

      // No second endpoint is borrowed, no per-field read, no silent retry.
      expect(apiRequestCount, 1);
    });

    testWidgets('R10-03 the URL carries no merchant id and no restaurant id', (tester) async {
      _catalogOk();
      await pumpDetail(tester);

      final url = apiRequests.single;
      expect(url, isNot(contains(kMerchantId)));
      expect(url, isNot(contains('/merchant/$kMerchantId')));
      expect(url, isNot(contains('restaurantId')));
      // Nothing in the query string either — the backend resolves the caller from the token.
      expect(url, isNot(contains('?')));
    });

    testWidgets('R10-04 the request authenticates with the merchant bearer token', (tester) async {
      _catalogOk();
      await pumpDetail(tester);

      expect(stubHeaders.first['authorization'], 'Bearer merchant-token');
    });

    testWidgets('R10-05 no service-role key or apikey is sent', (tester) async {
      _catalogOk();
      await pumpDetail(tester);

      for (final headers in stubHeaders) {
        expect(headers.containsKey('apikey'), isFalse);
        expect(headers.containsKey('authorization'), isTrue);
        expect(headers['authorization'], isNot(contains('service_role')));
        expect(headers['authorization']!, isNot(contains('eyJ'))); // a real JWT would be a leak
      }
      // And none of it is in the URL.
      expect(apiRequests.single, isNot(contains('service_role')));
    });

    testWidgets('R10-06 no write ever leaves this screen', (tester) async {
      _catalogOk();
      await pumpDetail(tester);

      // The probe found no menu write route at all, so a screen that claimed to save would be
      // sending a request the platform cannot answer.
      expect(apiRequests.every((r) => r.startsWith('GET ')), isTrue);
      expect(stubSaw('POST', '/menu'), isFalse);
      expect(stubSaw('PATCH', '/menu'), isFalse);
      expect(stubSaw('PUT', '/menu'), isFalse);
      expect(stubSaw('DELETE', '/menu'), isFalse);
      expect(stubSaw('POST', '/toggle'), isFalse);
      expect(stubSaw('POST', '/photo'), isFalse);
    });

    testWidgets('R10-07 name, description, category and price come from the row', (tester) async {
      _catalogOk(products: <Map<String, dynamic>>[
        _row(name: 'Stub Butter Naan', description: 'Clay oven flatbread.', category: 'Stub Bread', price: 60),
      ]);
      await pumpDetail(tester);

      expect(find.text('Stub Butter Naan'), findsOneWidget);
      expect(find.text('Clay oven flatbread.'), findsOneWidget);
      expect(find.text('Stub Bread'), findsOneWidget);
      expect(find.text('₹60'), findsOneWidget);
    });

    testWidgets('R10-08 the stored SKU and the stored updated_at are shown as the row holds them',
        (tester) async {
      const stored = '2026-09-14T17:56:52.280727+00:00';
      _catalogOk(products: <Map<String, dynamic>>[
        _row(sku: 'STUB-SKU-9', updatedAt: stored),
      ]);
      await pumpDetail(tester);

      expect(find.text('STUB-SKU-9'), findsOneWidget);
      // The stamp is asserted by round-tripping it back to an instant, not by matching a literal:
      // the screen renders the stored timestamptz in the device's own zone, so the digits on
      // screen depend on where the test runs. What must not vary is WHICH instant it depicts —
      // not "now", not a plausible date, but the column's value to the minute.
      final at = DateTime.parse(stored).toLocal();
      final stamp = tester
          .widgetList<Text>(find.byType(Text))
          .map((t) => t.data ?? '')
          .firstWhere((s) => RegExp(r'^\d{2}/\d{2}/\d{4} \d{2}:\d{2}$').hasMatch(s));
      final groups = RegExp(r'^(\d{2})/(\d{2})/(\d{4}) (\d{2}):(\d{2})$').firstMatch(stamp)!;
      final shown = DateTime(
        int.parse(groups.group(3)!), int.parse(groups.group(2)!), int.parse(groups.group(1)!),
        int.parse(groups.group(4)!), int.parse(groups.group(5)!),
      );
      expect(shown, DateTime(at.year, at.month, at.day, at.hour, at.minute));
    });

    testWidgets('R10-09 a refresh re-reads instead of re-drawing what it already has', (tester) async {
      _catalogOk();
      await pumpDetail(tester);
      expect(apiRequestCount, 1);

      await tester.tap(find.byKey(const ValueKey('r10-refresh')));
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }
      expect(apiRequestCount, 2);
    });

    testWidgets('R10-10 rapid refresh taps cannot stack reads', (tester) async {
      _catalogOk();
      await pumpDetail(tester);
      final before = apiRequestCount;

      // The action is disabled while a read is in flight, and the stub answers on a delay so the
      // window is observable rather than theoretical.
      stubDelay = const Duration(milliseconds: 400);
      final refresh = find.byKey(const ValueKey('r10-refresh'));
      await tester.tap(refresh);
      await tester.pump();
      await tester.tap(refresh, warnIfMissed: false);
      await tester.tap(refresh, warnIfMissed: false);
      stubDelay = Duration.zero;
      for (var i = 0; i < 14; i++) {
        await tester.pump(const Duration(milliseconds: 60));
      }

      expect(apiRequestCount, before + 1);
    });
  });

  group('a column the read did not return is drawn as absent', () {
    testWidgets('R10-11 an empty description says so rather than inventing one', (tester) async {
      _catalogOk(products: <Map<String, dynamic>>[_row(description: null)]);
      await pumpDetail(tester);

      expect(find.text('— Not available'), findsWidgets);
    });

    testWidgets('R10-12 a null price is never a zero or a plausible ₹ figure', (tester) async {
      _catalogOk(products: <Map<String, dynamic>>[_row(price: null, discountPrice: null)]);
      await pumpDetail(tester);

      expect(find.textContaining('₹'), findsNothing);
      expect(find.text('— Not available'), findsWidgets);
    });

    testWidgets('R10-13 a null category and name are not filled in', (tester) async {
      _catalogOk(products: <Map<String, dynamic>>[_row(name: null, category: null, sku: null)]);
      await pumpDetail(tester);

      expect(find.text('Menu'), findsNothing); // no default category
      expect(find.text('Untitled item'), findsNothing); // no default name
      expect(find.text('— Not available'), findsWidgets);
    });

    testWidgets('R10-14 nothing on this screen speaks of ratings, reviews or prep time',
        (tester) async {
      _catalogOk();
      await pumpDetail(tester);

      // `products` has no such columns (verified against the live table and migrations/004), so
      // any of these words would be an invention.
      for (final claim in ['rating', 'review', 'orders today', 'sales today', 'preparation',
          'prep time', '4.5', '★', 'Bestseller', 'Recommended']) {
        expect(find.textContaining(claim), findsNothing, reason: claim);
      }
    });

    testWidgets('R10-15 stock of -1 is "not tracked", never 0', (tester) async {
      _catalogOk(products: <Map<String, dynamic>>[_row(inStockQuantity: -1)]);
      await pumpDetail(tester);

      expect(find.textContaining('Not tracked for this dish'), findsOneWidget);
      expect(find.text('0'), findsNothing);
    });

    testWidgets('R10-16 a tracked stock shows the stored count', (tester) async {
      _catalogOk(products: <Map<String, dynamic>>[_row(inStockQuantity: 12)]);
      await pumpDetail(tester);

      expect(find.text('12'), findsOneWidget);
      expect(find.textContaining('Not tracked'), findsNothing);
    });

    testWidgets('R10-17 a stored discount price is shown, an absent one is not implied',
        (tester) async {
      _catalogOk(products: <Map<String, dynamic>>[_row(price: 100, discountPrice: 80)]);
      await pumpDetail(tester);

      expect(find.text('₹100'), findsOneWidget);
      expect(find.text('₹80'), findsOneWidget);
    });
  });

  group('availability is the row\'s state, and nothing more', () {
    testWidgets('R10-18 available true', (tester) async {
      _catalogOk(products: <Map<String, dynamic>>[_row(isAvailable: true)]);
      await pumpDetail(tester);

      expect(find.text('Available for orders'), findsOneWidget);
      expect(find.text('Not available for orders'), findsNothing);
    });

    testWidgets('R10-19 available false', (tester) async {
      _catalogOk(products: <Map<String, dynamic>>[_row(isAvailable: false)]);
      await pumpDetail(tester);

      expect(find.text('Not available for orders'), findsOneWidget);
    });

    testWidgets('R10-20 an absent availability column is not read as false', (tester) async {
      _catalogOk(products: <Map<String, dynamic>>[_row(isAvailable: null)]);
      await pumpDetail(tester);

      expect(find.text('Not stated by NABIN'), findsOneWidget);
      expect(find.text('Available for orders'), findsNothing);
      expect(find.text('Not available for orders'), findsNothing);
    });

    testWidgets('R10-21 there is no switch, so nothing looks togglable', (tester) async {
      _catalogOk(products: <Map<String, dynamic>>[_row(isAvailable: true)]);
      await pumpDetail(tester);

      expect(find.byType(Switch), findsNothing);
      expect(find.byType(Checkbox), findsNothing);
    });

    testWidgets('R10-22 the screen says availability cannot be changed here', (tester) async {
      _catalogOk();
      await pumpDetail(tester);

      expect(find.textContaining('cannot be switched'), findsOneWidget);
    });
  });

  group('no fake editing surface', () {
    testWidgets('R10-23 no field is presented as an input', (tester) async {
      _catalogOk();
      await pumpDetail(tester);

      expect(find.byType(TextField), findsNothing);
      expect(find.byType(TextFormField), findsNothing);
      expect(find.byType(DropdownButton), findsNothing);
    });

    testWidgets('R10-24 there is no Save button that would send nothing', (tester) async {
      _catalogOk();
      await pumpDetail(tester);

      // The word itself does appear once — inside the sentence that tells the merchant there is
      // no such button. What must not exist is a control carrying that label.
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('r10-editing-card')),
          matching: find.textContaining('Save'),
        ),
        findsOneWidget,
      );
      for (final label in ['Save', 'Save changes', 'Update', 'Save dish', 'Submit']) {
        expect(find.widgetWithText(ElevatedButton, label), findsNothing, reason: label);
        expect(find.widgetWithText(FilledButton, label), findsNothing, reason: label);
        expect(find.widgetWithText(OutlinedButton, label), findsNothing, reason: label);
        expect(find.widgetWithText(TextButton, label), findsNothing, reason: label);
      }
      expect(find.byIcon(Icons.save), findsNothing);
      expect(find.byIcon(Icons.save_rounded), findsNothing);
    });

    testWidgets('R10-25 the eight operations are named with their real state', (tester) async {
      _catalogOk();
      await pumpDetail(tester);

      expect(find.byKey(const ValueKey('r10-editing-card')), findsOneWidget);
      for (final field in ['Name', 'Description', 'Price', 'Category', 'Availability', 'Photo']) {
        expect(find.text(field), findsWidgets, reason: field);
      }
      expect(find.text('Add a dish'), findsOneWidget);
      expect(find.text('Remove a dish'), findsOneWidget);
      expect(find.text('View only'), findsNWidgets(6));
      expect(find.text('Not available in this app'), findsNWidgets(2));
    });

    testWidgets('R10-26 photos are stated to be unchangeable, not offered', (tester) async {
      _catalogOk();
      await pumpDetail(tester);

      expect(find.textContaining('Menu-item photos cannot be changed'), findsOneWidget);
      // No control that would walk as far as a broken upload.
      expect(find.textContaining('Change photo'), findsNothing);
      expect(find.textContaining('Upload'), findsNothing);
      expect(find.byIcon(Icons.photo_camera), findsNothing);
      expect(find.byIcon(Icons.photo_camera_rounded), findsNothing);
    });

    testWidgets('R10-27 no internal implementation detail leaks into merchant copy',
        (tester) async {
      _catalogOk();
      await pumpDetail(tester);

      final painted = tester.widgetList<Text>(find.byType(Text)).map((t) => t.data ?? '').join(' | ');
      for (final internal in ['rest_1', 'MENU_ITEM_NOT_FOUND', 'Cloudinary', 'undefined',
          'in_memory', 'in-memory', 'db.restaurants', 'ReferenceError', '504', 'GATEWAY_TIMEOUT',
          'Central Hub', 'Postgres', 'postgres', 'products', 'server.js']) {
        expect(painted, isNot(contains(internal)), reason: internal);
      }
    });
  });

  group('the photo column is rendered as it is stored', () {
    testWidgets('R10-28 no image_url means no photo, and no picture is fetched', (tester) async {
      _catalogOk(products: <Map<String, dynamic>>[_row(imageUrl: null)]);
      await pumpDetail(tester);

      expect(find.byKey(const ValueKey('r10-no-photo')), findsOneWidget);
      expect(find.text('No photo on NABIN'), findsOneWidget);
      expect(find.byKey(const ValueKey('r10-photo')), findsNothing);
      // A placeholder is not a request: only the catalogue read left the process.
      expect(apiRequestCount, 1);
    });

    testWidgets('R10-29 a stored image_url is the URL the image uses', (tester) async {
      const url = 'https://$kImageHost/dish/stub-one.jpg';
      _catalogOk(products: <Map<String, dynamic>>[_row(imageUrl: url)]);
      await pumpDetail(tester);

      final image = tester.widget<Image>(find.byKey(const ValueKey('r10-photo')));
      expect(image.image, isA<NetworkImage>());
      expect((image.image as NetworkImage).url, url);
      // The picture is not a read of the merchant's data, so the API count stays at one: the dish
      // detail borrows no second endpoint and makes no extra call for the row it already holds.
      expect(apiRequests.single, endsWith('/merchant/catalog'));
      expect(apiRequestCount, 1);

      // `flutter_test` answers every image request with its own mocked failure, so this is also
      // the case that matters most: a photo NABIN holds but this device could not load must not
      // be reported to the merchant as a dish with no photo at all.
      expect(find.byKey(const ValueKey('r10-no-photo')), findsNothing);
      expect(find.text('No photo on NABIN'), findsNothing);
      expect(find.byKey(const ValueKey('r10-photo-unloaded')), findsOneWidget);
      expect(find.text('The photo could not be loaded from NABIN'), findsOneWidget);
    });
  });

  group('a failure is a failure, never an empty menu', () {
    testWidgets('R10-30 a 500 read is not translated into "no dishes"', (tester) async {
      _catalogOk(respond: (method, url) {
        if (url.path.endsWith('/merchant/catalog')) {
          return (500, jsonEncode({'success': false, 'error': 'Store unavailable'}));
        }
        return (404, '{"success":false}');
      });
      await pumpDetail(tester);

      expect(find.byKey(const ValueKey('r10-failed')), findsOneWidget);
      expect(find.text('No dishes listed yet'), findsNothing);
      expect(find.textContaining('Store unavailable'), findsOneWidget);
    });

    testWidgets('R10-31 a 401 says the session closed', (tester) async {
      _catalogOk(respond: (method, url) {
        if (url.path.endsWith('/merchant/catalog')) {
          return (401, jsonEncode({'success': false, 'error': 'Invalid or expired token'}));
        }
        return (404, '{"success":false}');
      });
      await pumpDetail(tester);

      expect(find.text('Your session has closed'), findsOneWidget);
      expect(find.textContaining('Sign in again'), findsOneWidget);
      expect(find.text('No dishes listed yet'), findsNothing);
    });

    testWidgets('R10-32 a 403 is surfaced as a refusal', (tester) async {
      _catalogOk(respond: (method, url) {
        if (url.path.endsWith('/merchant/catalog')) {
          return (403, jsonEncode({'success': false, 'code': 'MERCHANT_MISMATCH'}));
        }
        return (404, '{"success":false}');
      });
      await pumpDetail(tester);

      expect(find.byKey(const ValueKey('r10-failed')), findsOneWidget);
      expect(find.textContaining('does not let this account read'), findsOneWidget);
    });

    testWidgets('R10-33 a malformed body is a transport failure, not an empty catalogue',
        (tester) async {
      _catalogOk(respond: (method, url) {
        if (url.path.endsWith('/merchant/catalog')) return (200, '<html>not json</html>');
        return (404, '{"success":false}');
      });
      await pumpDetail(tester);

      expect(find.byKey(const ValueKey('r10-failed')), findsOneWidget);
      expect(find.textContaining('No connection to NABIN'), findsOneWidget);
      expect(find.text('No dishes listed yet'), findsNothing);
    });

    testWidgets('R10-34 a degraded read is named, not shown as an empty menu', (tester) async {
      stubHandler = (method, url, body) {
        if (method == 'GET' && url.path.endsWith('/merchant/catalog')) {
          return (200, jsonEncode(<String, dynamic>{
            'success': true, 'merchantId': kMerchantId, 'count': 0, 'products': <dynamic>[],
            'degraded': true,
          }));
        }
        return (404, '{"success":false}');
      };
      await pumpDetail(tester);

      expect(find.byKey(const ValueKey('r10-unavailable')), findsOneWidget);
      expect(find.text('No dishes listed yet'), findsNothing);
    });

    testWidgets('R10-35 a genuinely empty catalogue says there are no dishes', (tester) async {
      _catalogOk(products: <Map<String, dynamic>>[]);
      await pumpDetail(tester);

      expect(find.byKey(const ValueKey('r10-empty')), findsOneWidget);
      expect(find.text('No dishes listed yet'), findsOneWidget);
    });

    testWidgets('R10-36 a dish id that is not in the caller\'s rows is not found', (tester) async {
      // This is the cross-merchant case: another store's dish never appears in a read scoped by
      // this token, so the only honest answer is that NABIN did not return it.
      _catalogOk();
      await pumpDetail(tester, dishId: 'someone-elses-dish');

      expect(find.byKey(const ValueKey('r10-not-found')), findsOneWidget);
      expect(find.text('This dish is not in your catalogue'), findsOneWidget);
      expect(find.text('Stub Dish One'), findsNothing);
    });

    testWidgets('R10-37 a retry re-reads and recovers', (tester) async {
      var failFirst = true;
      _catalogOk(respond: (method, url) {
        if (url.path.endsWith('/merchant/catalog')) {
          if (failFirst) {
            failFirst = false;
            return (503, jsonEncode({'success': false, 'error': 'Store unavailable'}));
          }
          return (200, jsonEncode(<String, dynamic>{
            'success': true, 'merchantId': kMerchantId, 'count': 1,
            'products': <Map<String, dynamic>>[_row()],
          }));
        }
        return (404, '{"success":false}');
      });
      await pumpDetail(tester);
      expect(find.textContaining('Store unavailable'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('r10-message-action')));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(find.text('Stub Dish One'), findsOneWidget);
      expect(apiRequestCount, 2);
    });
  });

  group('routing keeps the merchant gate', () {
    testWidgets('R10-38 a signed-in merchant reaches the dish detail from the menu row',
        (tester) async {
      _catalogOk();
      await pumpRouter(tester);

      await tester.tap(find.descendant(
        of: find.byType(NavigationBar),
        matching: find.text('Menu'),
      ));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      await tester.tap(find.byKey(const ValueKey('r06-menu-row-$kDishId')));
      await pumpFrames(tester);

      expect(find.byType(RestaurantDishDetailScreen), findsOneWidget);
      // The console route stays mounted underneath a pushed route, so the dish name is on screen
      // twice by design — once in the list row, once in the detail. Assert on the detail's own.
      expect(
        find.descendant(
          of: find.byType(RestaurantDishDetailScreen),
          matching: find.text('Stub Dish One'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('R10-39 the real router gates a dish deep link on the session', (tester) async {
      _catalogOk();
      SessionManager.instance.clearSession();

      // The shipped router, not a stand-in: `_restaurantPublicRoutes` is what makes a cold link
      // land on the sign-in gate instead of painting a 401 as "this dish does not exist".
      await tester.pumpWidget(MaterialApp.router(routerConfig: restaurantRouter));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }
      restaurantRouter.go('/menu/dish/$kDishId');
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(restaurantRouter.routerDelegate.currentConfiguration.uri.path, '/login');
      expect(find.byType(RestaurantDishDetailScreen), findsNothing);
      // The screen never got far enough to read anything.
      expect(apiRequestCount, 0);
    });

    testWidgets('R10-40 the same deep link opens the dish once a session exists', (tester) async {
      _catalogOk();
      await pumpRouter(tester);
      final before = apiRequestCount; // the console has already read what it shows

      restaurantRouter.go('/menu/dish/$kDishId');
      await pumpFrames(tester);

      expect(find.byType(RestaurantDishDetailScreen), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(RestaurantDishDetailScreen),
          matching: find.text('Stub Dish One'),
        ),
        findsOneWidget,
      );
      // Exactly one more read for the dish — the detail borrows no second endpoint.
      expect(apiRequestCount - before, 1);
    });

    testWidgets('R10-41 back from the dish returns to the console', (tester) async {
      _catalogOk();
      await pumpRouter(tester);

      await tester.tap(find.descendant(
        of: find.byType(NavigationBar),
        matching: find.text('Menu'),
      ));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }
      await tester.tap(find.byKey(const ValueKey('r06-menu-row-$kDishId')));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }
      expect(find.byType(RestaurantDishDetailScreen), findsOneWidget);

      // The pushed route animates out; settling the pump is what actually removes the screen.
      await tester.tap(find.byIcon(Icons.arrow_back));
      await pumpFrames(tester);

      expect(find.byType(RestaurantDishDetailScreen), findsNothing);
      expect(restaurantRouter.routerDelegate.currentConfiguration.matches.length, 1);
    });
  });

  group('the values on screen are the ones the backend sent', () {
    testWidgets('R10-42 no fabricated Stitch dish, place, price or person appears',
        (tester) async {
      _catalogOk();
      await pumpDetail(tester);

      final painted = tester
          .widgetList<Text>(find.byType(Text))
          .map((t) => t.data ?? '')
          .join(' | ');
      for (final invented in ['Aizawl', 'MZ-01', 'ORD-MZ-9941', 'Vanlalruati', 'Lalremruata',
          'Vawksa', 'Mizo', 'Central Hub', 'Delhi', 'Imphal', '₹420', '₹120', '₹230',
          'Sample dish', 'demo data', 'Sample restaurant', 'Mughlai', 'Biryani', '5.0',
          'Rice & Sides', 'Soups & Broths']) {
        expect(painted, isNot(contains(invented)), reason: invented);
      }
    });

    testWidgets('R10-43 a 390dp phone paints the whole dish without overflow', (tester) async {
      _catalogOk(products: <Map<String, dynamic>>[
        _row(
          name: 'Stub Dish With A Considerably Longer Name Than Any Real One',
          description: 'A stub description long enough that a single line would have to wrap, '
              'and it keeps going so the row has to be given room on a narrow phone.',
          category: 'Stub Category With A Long Label',
          price: 12345,
          discountPrice: 9999,
          sku: 'STUB-SKU-WITH-A-LONGER-CODE',
          updatedAt: '2026-09-14T17:56:52.280727+00:00',
        ),
      ]);
      // A phone-width frame at 1:1 pixels, so the logical width the layout gets really is 390 dp.
      await pumpDetail(tester, surface: const Size(390, 844), dpr: 1.0);

      expect(tester.takeException(), isNull);
      expect(find.byType(RestaurantDishDetailScreen), findsOneWidget);

      // The list builds lazily, so "the whole dish paints on a phone" has to be walked: a card is
      // only laid out while it is inside the viewport plus the cache extent, and one scroll step
      // at a time is what gives every card its turn at 390 dp.
      const cards = ['r10-photo-card', 'r10-availability-card', 'r10-specs-card', 'r10-editing-card'];
      final painted = <String>{};
      void record() {
        for (final card in cards) {
          if (find.byKey(ValueKey(card)).evaluate().isNotEmpty) painted.add(card);
        }
      }

      for (var step = 0; step < 8; step++) {
        record();
        await tester.drag(find.byType(ListView), const Offset(0, -260));
        await pumpFrames(tester, 6);
        expect(tester.takeException(), isNull, reason: 'scroll step $step');
      }
      record();
      expect(painted, containsAll(cards));

      // The bottom of the dish is the honest statement of what cannot be edited here.
      expect(find.byKey(const ValueKey('r10-editing-card')), findsOneWidget);
      expect(find.text('View only'), findsNWidgets(6));
      expect(find.text('Not available in this app'), findsNWidgets(2));
    });
  });
}
