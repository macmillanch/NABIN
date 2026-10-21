import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/core/network/nabin_api_service.dart';
import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/core/router/restaurant_router.dart';

import 'support/http_stub.dart';

// -----------------------------------------------------------------------------
// R04 — Restaurant Merchant Dashboard, held to `GET /api/merchant/:restaurantId/dashboard`.
//
// The contract behind these tests was read from the route itself on 2026-10-09
// (`backend/src/server.js:4621-4660`), not from the old audit note. What it answers:
//
//   { success: true, restaurant: <merchant row>, activeOrdersCount: <number>,
//     todaySales: <number>, orders: [<order row>, …] }
//
// `activeOrdersCount` is `merchantOrders.filter(o => !['DELIVERED','REJECTED','CANCELLED']
// .includes(o.order_state)).length` (`server.js:4644`). `todaySales` is the sum of
// `Number(o.total_amount)` over the same rows with CANCELLED and REJECTED left out
// (`server.js:4645-4647`) — there is no date filter in it and no currency grouping, whatever
// the field is called. Both are computed from `getOrdersByMerchant(merchant.id)`
// (`server.js:4643`), which reads the latest 50 rows (`OrderRepository.js:449`).
//
// The route is guarded twice: `authenticateMerchant` (`server.js:953`) answers 401 with no token
// or an unknown one and 403 when the token is not a MERCHANT, and `requireMerchantTenant`
// (`server.js:1003`) answers 401/403 again when the caller has no tenant binding. A path
// `:restaurantId` that resolves to no merchant, or to somebody else's, is answered 403
// (`server.js:4634`, Decision A1). So the read is scoped server-side; the id in the URL is the
// session's own merchant, which the shell takes from `GET /api/merchant/services`
// (`server.js:4587`) and never from a field a partner can type into.
//
// And one limitation the UI cannot fix: `getOrdersByMerchant` returns `[]` when the store cannot
// be reached (`OrderRepository.js:450`, `:465`), so an outage arrives as `success: true` with
// `0`, `0` and `[]`. A zero from that is indistinguishable from a zero the platform computed, so
// the screen says whose zero it is showing rather than pretending to know (`_provenanceNote`).
//
// What this suite therefore refuses to allow: the three cards that used to sit in this slot —
// `TODAY'S REVENUE ₹3,450.00` with `+15% vs yesterday`, `TOTAL ORDERS 28` with `3 active in
// kitchen pipeline`, `AVG. PREP TIME 16 mins` with `Optimal kitchen efficiency` — none of which
// came from any read, and a payout balance of `₹18,420.50` that has no endpoint anywhere.
// -----------------------------------------------------------------------------

const String kMerchantId = 'mnr_stub_restaurant';
const String kServerMerchantId = 'mnr_from_services';
const String kOrderId = '0f0f0f0f-1111-2222-3333-444444444444';

/// The two figures, in the envelope shape the route actually returns.
///
/// `noCount` / `noSales` drop a key entirely, because the case that used to be indistinguishable
/// from a quiet day was a response that never carried the field. Passing `count: '12'` or
/// `sales: null` covers the shapes a JSON body can arrive in that this screen cannot read.
Map<String, dynamic> dashboardEnvelope({
  bool success = true,
  bool noCount = false,
  bool noSales = false,
  Object? count = 0,
  Object? sales = 0,
  List<Map<String, dynamic>> orders = const [],
  Object? restaurant = const {'id': kServerMerchantId, 'name': 'Stub Kitchen', 'cuisines': <String>[]},
  Map<String, dynamic>? extra,
}) {
  final body = <String, dynamic>{'success': success};
  if (restaurant is Map) {
    body['restaurant'] = Map<String, dynamic>.from(restaurant);
  } else {
    body['restaurant'] = restaurant;
  }
  if (!noCount) body['activeOrdersCount'] = count;
  if (!noSales) body['todaySales'] = sales;
  body['orders'] = orders;
  if (extra != null) body.addAll(extra);
  return body;
}

/// One order row in the columns the merchant orders read returns (`OrderRepository.js:449`).
Map<String, dynamic> orderRow({
  Object? id = kOrderId,
  Object? orderNumber = 'ORD-STUB-0001',
  Object? orderState = 'RECEIVED',
  Object? currency = 'INR',
  Object? totalAmount = 240,
  Object? customerName = 'Stub Customer',
  List<Map<String, dynamic>>? lines,
}) {
  return <String, dynamic>{
    'id': id,
    'order_number': orderNumber,
    'order_state': orderState,
    'service_type': 'FOOD',
    'created_at': '2026-10-08T09:12:00.000Z',
    'total_amount': totalAmount,
    'currency': currency,
    'metadata': <String, dynamic>{if (customerName != null) 'customerName': customerName},
    'lines': lines ??
        <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'line-stub-1',
            'product_name_snapshot': 'Stub Dish One',
            'quantity': 2,
            'unit_snapshot': null,
          },
        ],
  };
}

/// The four reads the console makes on boot: services, orders, catalog, dashboard.
///
/// `dashboard` replaces the dashboard envelope whole — that envelope is the subject of this file.
/// `services` replaces the `/merchant/services` row, for the store-status and merchant-id cases.
/// `rawDashboard` answers the dashboard GET with a body string, for the non-JSON case.
void shellStub({
  Map<String, dynamic>? dashboard,
  Map<String, dynamic>? services,
  List<Map<String, dynamic>>? orders,
  String? rawDashboard,
  (int, String)? Function(String method, Uri url, String body)? respond,
}) {
  stubHandler = (method, url, body) {
    final over = respond?.call(method, url, body);
    if (over != null) return over;
    final path = url.path;
    if (method == 'GET' && path.endsWith('/merchant/services')) {
      return (200, jsonEncode(services ?? <String, dynamic>{
        'success': true,
        'merchantId': kServerMerchantId,
        'services': <String>['RESTAURANT'],
        'profile': <String, dynamic>{'name': 'Stub Kitchen'},
        'isOpen': true,
      }));
    }
    if (method == 'GET' && path.endsWith('/orders')) {
      final rows = orders ?? <Map<String, dynamic>>[orderRow()];
      return (200, jsonEncode(<String, dynamic>{
        'success': true,
        'count': rows.length,
        'orders': rows,
      }));
    }
    if (method == 'GET' && path.endsWith('/dashboard')) {
      if (rawDashboard != null) return (200, rawDashboard);
      return (200, jsonEncode(dashboard ?? dashboardEnvelope(
        count: 3,
        sales: 4230.75,
        orders: <Map<String, dynamic>>[orderRow()],
      )));
    }
    if (method == 'GET' && path.endsWith('/merchant/catalog')) {
      return (200, jsonEncode(<String, dynamic>{
        'success': true,
        'merchantId': kServerMerchantId,
        'count': 0,
        'products': <dynamic>[],
      }));
    }
    return (404, '{"success":false}');
  };
}

/// The dashboard GETs served so far, by URL.
List<String> dashboardRequests() =>
    stubSeen.where((s) => s.startsWith('GET ') && s.contains('/dashboard')).toList();

/// The painted text of the mounted tree, for the scans that read the whole screen at once.
String paintedText(WidgetTester tester) =>
    tester.widgetList<Text>(find.byType(Text)).map((t) => t.data ?? '').join(' | ');

/// Boots the real merchant console on its Dashboard tab at phone width (390x1000 logical).
///
/// Two things changed about the width. The KDS harness had to boot wide (2400dp) because three
/// Dashboard rows only overflowed under Ahem — the Store Status caption, the bento metrics and
/// the queue header — and then narrow once the Dashboard was out of the tree. R04 touched all
/// three rows for its own reasons (the caption, the two cards and the header), and this file's
/// subject is the Dashboard, so the tab has to survive 390dp on its own. It does: the caption and
/// the header are `Flexible`, and each card puts its text column in an `Expanded`. That is asserted
/// here rather than assumed, and it is why no test in this file has to dodge a frame.
///
/// `restaurantRouter` is a singleton whose location survives between tests, so the route is parked
/// at `/dashboard` before the first frame. A spinner never settles, so the clock is driven with
/// fixed pumps instead of `pumpAndSettle`.
Future<void> pumpDashboardTab(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1170, 3000);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);
  SessionManager.instance.saveSession(
    token: 'merchant-token',
    user: <String, dynamic>{
      'id': kMerchantId,
      'restaurantId': kMerchantId,
      'name': 'Stub Kitchen',
    },
  );
  restaurantRouter.go('/dashboard');
  await tester.pumpWidget(MaterialApp.router(routerConfig: restaurantRouter));
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
  // Every Dashboard row is measured at the width the brief names. An overflow here is this task's
  // defect, not a pre-existing one it inherits.
  expect(tester.takeException(), isNull,
      reason: 'the Dashboard tab overflowed at 390dp');
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

  group('the two figures the dashboard route computes', () {
    testWidgets('DASH-01 activeOrdersCount is painted from the response, not counted here',
        (tester) async {
      shellStub(dashboard: dashboardEnvelope(count: 7, sales: 0));
      await pumpDashboardTab(tester);

      expect(find.text('7'), findsOneWidget);
      expect(dashboardRequests(), hasLength(1));
      expect(dashboardRequests().single, contains('/merchant/$kServerMerchantId/dashboard'));
    });

    testWidgets('DASH-02 todaySales is painted from the response, with the currency its rows state',
        (tester) async {
      shellStub(dashboard: dashboardEnvelope(
        count: 0,
        sales: 4230.75,
        orders: <Map<String, dynamic>>[orderRow(currency: 'INR')],
      ));
      await pumpDashboardTab(tester);

      // The literal, so the wiring and the format are both pinned.
      expect(find.text('INR 4,230.75'), findsOneWidget);
      expect(paintedText(tester), contains('Every summed order states INR.'));
    });

    testWidgets('DASH-03 the rupee symbol is not assumed when no summed row states one',
        (tester) async {
      shellStub(dashboard: dashboardEnvelope(
        count: 0,
        sales: 4230.75,
        orders: <Map<String, dynamic>>[orderRow(currency: null)],
      ));
      await pumpDashboardTab(tester);

      // `orders.currency` is a VARCHAR with an INR default, not a constraint
      // (`001_central_schema.sql:202`), so a row that states nothing states nothing.
      expect(find.text('4,230.75'), findsOneWidget);
      expect(paintedText(tester), contains('No order in this read states a currency.'));
      expect(paintedText(tester).contains('₹'), isFalse);
    });

    testWidgets('DASH-04 a total summed across conflicting currency codes claims no currency',
        (tester) async {
      shellStub(dashboard: dashboardEnvelope(
        count: 0,
        sales: 1000,
        orders: <Map<String, dynamic>>[
          orderRow(id: 'row-a', currency: 'INR'),
          orderRow(id: 'row-b', currency: 'USD'),
        ],
      ));
      await pumpDashboardTab(tester);

      expect(find.text('1,000.00'), findsOneWidget);
      expect(paintedText(tester),
          contains('These orders state 2 different currency codes, so the total has none.'));
    });

    testWidgets('DASH-05 CANCELLED and REJECTED rows do not lend a currency to the total',
        (tester) async {
      // The route leaves those two out of the sum (`server.js:4646`), so a code carried on an
      // excluded row cannot honestly describe a total that does not include that row.
      shellStub(dashboard: dashboardEnvelope(
        count: 0,
        sales: 500,
        orders: <Map<String, dynamic>>[
          orderRow(id: 'row-a', orderState: 'DELIVERED', currency: 'INR'),
          orderRow(id: 'row-b', orderState: 'CANCELLED', currency: 'USD'),
        ],
      ));
      await pumpDashboardTab(tester);

      expect(find.text('INR 500.00'), findsOneWidget);
      expect(paintedText(tester), contains('Every summed order states INR.'));
    });
  });

  group('what the response did not say', () {
    testWidgets('DASH-06 a metric the response never carried paints no number', (tester) async {
      shellStub(dashboard: dashboardEnvelope(noCount: true, noSales: true));
      await pumpDashboardTab(tester);

      expect(find.text('Not stated by NABIN'), findsNWidgets(2));
      // A fabricated zero is the specific failure this guards: 0 is a number a merchant reads as
      // "a day with no sales", which is a claim about the platform.
      expect(paintedText(tester).contains('₹0'), isFalse);
      expect(find.text('0'), findsNothing);
    });

    testWidgets('DASH-07 an explicit zero is painted as the zero the platform answered with',
        (tester) async {
      shellStub(dashboard: dashboardEnvelope(
        count: 0,
        sales: 0,
        orders: <Map<String, dynamic>>[orderRow(orderState: 'DELIVERED', currency: 'INR')],
      ));
      await pumpDashboardTab(tester);

      expect(find.text('Not stated by NABIN'), findsNothing);
      expect(find.text('0'), findsOneWidget);
      expect(find.text('INR 0.00'), findsOneWidget);
    });

    testWidgets('DASH-08 a value that is not a number is not read as one', (tester) async {
      shellStub(dashboard: dashboardEnvelope(count: '12', sales: '4,230.75'));
      await pumpDashboardTab(tester);

      // '12' would otherwise become a figure this screen made up out of a string.
      expect(find.text('12'), findsNothing);
      expect(find.text('4,230.75'), findsNothing);
      expect(find.text('Not stated by NABIN'), findsNWidgets(2));
      expect(tester.takeException(), isNull);
    });

    testWidgets('DASH-09 the removed figures are gone rather than replaced', (tester) async {
      shellStub();
      await pumpDashboardTab(tester);

      final painted = paintedText(tester);
      // Each of these was typed into the source; none is a field the route returns.
      for (final fabricated in <String>[
        '18,420.50', // the payout balance, and there is no payout endpoint
        '3,450.00', // today's revenue
        '+15%', // growth versus yesterday
        'AVG. PREP TIME', // no column, no route, no calculation anywhere
        'TOTAL ORDERS', // not a field of this response
        'Optimal kitchen efficiency',
        '3 active in kitchen pipeline',
      ]) {
        expect(painted.contains(fabricated), isFalse, reason: '$fabricated is still painted');
      }
      expect(painted.contains('₹'), isFalse);
    });

    testWidgets('DASH-10 only the two supported metrics are painted', (tester) async {
      shellStub();
      await pumpDashboardTab(tester);

      expect(find.text('ORDERS NOT FINISHED'), findsOneWidget);
      expect(find.text('SALES TOTAL'), findsOneWidget);
      final painted = paintedText(tester);
      for (final unsupported in <String>[
        'RATING', 'REVIEWS', 'CONVERSION', 'PAYOUT', 'SETTLEMENT', 'BALANCE', 'PREP TIME',
      ]) {
        expect(painted.contains(unsupported), isFalse, reason: '$unsupported has no field behind it');
      }
    });
  });

  group('a read that did not answer', () {
    testWidgets('DASH-11 a server error is a failure card, not an empty Dashboard',
        (tester) async {
      shellStub(respond: (method, url, body) {
        if (method == 'GET' && url.path.endsWith('/dashboard')) {
          return (500, jsonEncode(<String, dynamic>{
            'success': false,
            'error': 'Internal server error',
            'requestId': 'req-stub-1',
          }));
        }
        return null;
      });
      await pumpDashboardTab(tester);

      expect(find.text('NABIN could not give this store\'s figures, so none are shown.'),
          findsOneWidget);
      expect(paintedText(tester), contains('Internal server error'));
      expect(find.text('ORDERS NOT FINISHED'), findsNothing);
      expect(find.text('SALES TOTAL'), findsNothing);
      expect(find.text('0'), findsNothing);
      expect(find.text('Not stated by NABIN'), findsNothing);
    });

    testWidgets('DASH-12 an expired session keeps the platform\'s refusal instead of a blank day',
        (tester) async {
      shellStub(respond: (method, url, body) {
        if (method == 'GET' && url.path.endsWith('/dashboard')) {
          return (401, jsonEncode(<String, dynamic>{
            'success': false,
            'error': 'Invalid or expired token',
          }));
        }
        return null;
      });
      await pumpDashboardTab(tester);

      expect(find.text('NABIN could not give this store\'s figures, so none are shown.'),
          findsOneWidget);
      expect(paintedText(tester), contains('Invalid or expired token'));
      expect(find.text('SALES TOTAL'), findsNothing);
    });

    testWidgets('DASH-13 another merchant\'s id is refused as the 403 the route raises',
        (tester) async {
      // Decision A1 (`server.js:4628-4641`): a path id that resolves to nobody, or to somebody
      // else, is an authorization failure. The shell never sends one it did not read from the
      // services row, and a refusal here must still be a refusal on screen.
      shellStub(respond: (method, url, body) {
        if (method == 'GET' && url.path.endsWith('/dashboard')) {
          return (403, jsonEncode(<String, dynamic>{
            'success': false,
            'error': 'Forbidden: Cannot access another merchant\'s restaurant dashboard.',
          }));
        }
        return null;
      });
      await pumpDashboardTab(tester);

      expect(paintedText(tester), contains('Cannot access another merchant'));
      expect(find.text('Not stated by NABIN'), findsNothing);
      expect(find.text('0'), findsNothing);
    });

    testWidgets('DASH-14 a body that is not JSON fails the read without crashing the tab',
        (tester) async {
      shellStub(rawDashboard: '<html>502 Bad Gateway</html>');
      await pumpDashboardTab(tester);

      // `_getJson` folds the decode failure into `success: false` with the exception's words, so
      // the screen has something honest to show and nothing that throws at the merchant.
      expect(find.text('NABIN could not give this store\'s figures, so none are shown.'),
          findsOneWidget);
      expect(find.text('SALES TOTAL'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('DASH-15 a success envelope whose orders key is not a list still paints no guess',
        (tester) async {
      shellStub(dashboard: <String, dynamic>{
        'success': true,
        'restaurant': <String, dynamic>{'id': kServerMerchantId},
        'activeOrdersCount': 2,
        'todaySales': 150,
        'orders': 'not a list',
      });
      await pumpDashboardTab(tester);

      expect(find.text('2'), findsOneWidget);
      // The count survives; the currency, which is read off the rows, does not invent one.
      expect(find.text('150.00'), findsOneWidget);
      expect(paintedText(tester), contains('No order in this read states a currency.'));
      expect(tester.takeException(), isNull);
    });

    testWidgets('DASH-16 the outage shape the repository produces is named, not hidden',
        (tester) async {
      // `getOrdersByMerchant` swallows a store error into `[]` (`OrderRepository.js:450`, `:465`),
      // so this envelope — success with two zeros — is what an unreachable database looks like to
      // this screen. The UI cannot tell it from a genuinely quiet day and must not imply it can.
      shellStub(dashboard: dashboardEnvelope(count: 0, sales: 0));
      await pumpDashboardTab(tester);

      final painted = paintedText(tester);
      expect(painted, contains('not a live feed'));
      expect(painted, contains('NABIN also answers 0 for both when its own order read cannot run'));
      expect(painted.contains('Live'), isFalse);
    });
  });

  group('asking the platform again', () {
    testWidgets('DASH-17 Refresh re-reads the real endpoint and shows the new figures',
        (tester) async {
      var count = 3;
      shellStub(dashboard: null, respond: (method, url, body) {
        if (method == 'GET' && url.path.endsWith('/dashboard')) {
          return (200, jsonEncode(dashboardEnvelope(count: count, sales: 0)));
        }
        return null;
      });
      await pumpDashboardTab(tester);
      expect(find.text('3'), findsOneWidget);

      count = 11;
      await tester.tap(find.text('Refresh'));
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(dashboardRequests(), hasLength(2));
      expect(dashboardRequests().last, contains('/merchant/$kServerMerchantId/dashboard'));
      expect(find.text('11'), findsOneWidget);
      expect(find.text('3'), findsNothing);
    });

    testWidgets('DASH-18 a refresh in flight cannot turn into a second read', (tester) async {
      shellStub();
      await pumpDashboardTab(tester);
      expect(dashboardRequests(), hasLength(1));

      // The fake waits, so the window between "the read left" and "the answer landed" is real.
      stubDelay = const Duration(seconds: 30);
      await tester.tap(find.text('Refresh'));
      await tester.pump();
      // Zero-duration pumps flush microtasks without advancing the clock, so the read is still
      // in flight for the whole of this assertion.
      await tester.pump();

      expect(dashboardRequests(), hasLength(2));
      // The card is replaced by its own spinner while the read runs, so there is no control left
      // to tap again; and `_loadMerchantDashboard` returns early while `_dashboardInFlight`, so a
      // second call from anywhere else would not reach the network either.
      expect(find.text('Refresh'), findsNothing);
      expect(find.text('ORDERS NOT FINISHED'), findsNothing);
      expect(tester.takeException(), isNull);

      // Let the read land: still exactly two GETs, and the figures are back.
      await tester.pump(const Duration(seconds: 31));
      for (var i = 0; i < 4; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }
      expect(dashboardRequests(), hasLength(2));
      expect(find.text('ORDERS NOT FINISHED'), findsOneWidget);
      expect(find.text('Refresh'), findsOneWidget);
    });

    testWidgets('DASH-19 boot reads the dashboard once, not once per consumer', (tester) async {
      shellStub();
      await pumpDashboardTab(tester);

      // The Profile tab seeds itself from this same response (`server.js:4649`), so the old
      // second call to the identical route is gone.
      expect(dashboardRequests(), hasLength(1));
      expect(stubSeen.where((s) => s.contains('/merchant/services')).toList(), hasLength(1));
    });

    testWidgets('DASH-20 the read carries the session bearer and no privileged key',
        (tester) async {
      shellStub();
      await pumpDashboardTab(tester);

      final index = stubSeen.indexWhere((s) => s.contains('/dashboard'));
      expect(index, isNonNegative);
      final headers = stubHeaders[index];
      expect(headers['authorization'], 'Bearer merchant-token');
      final all = headers.values.join(' ');
      expect(all.contains('service_role'), isFalse);
      expect(all.contains('service-role'), isFalse);
      expect(headers.containsKey('apikey'), isFalse);
    });

    testWidgets('DASH-21 the store the read names comes from the platform, not from here',
        (tester) async {
      // The session carries `kMerchantId`; the services row answers `kServerMerchantId`. The
      // request must go to the id the platform gave back — that is the one `requireMerchantTenant`
      // and the 403 at `server.js:4634` can actually check.
      shellStub();
      await pumpDashboardTab(tester);

      expect(dashboardRequests().single, contains('/merchant/$kServerMerchantId/dashboard'));
      expect(dashboardRequests().single, isNot(contains(kMerchantId)));
    });

    testWidgets('DASH-22 a session with no store identity asks nothing and fails honestly',
        (tester) async {
      shellStub(services: <String, dynamic>{
        'success': true,
        'services': <String>['RESTAURANT'],
        'profile': <String, dynamic>{'name': 'Stub Kitchen'},
        'isOpen': true,
      });
      // No merchantId from the platform and none in the session: there is no store to ask about.
      SessionManager.instance.saveSession(
        token: 'merchant-token',
        user: <String, dynamic>{'id': '', 'name': 'Stub Kitchen'},
      );
      tester.view.physicalSize = const Size(1170, 3000);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.reset);
      restaurantRouter.go('/dashboard');
      await tester.pumpWidget(MaterialApp.router(routerConfig: restaurantRouter));
      for (var i = 0; i < 20; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(dashboardRequests(), isEmpty);
      expect(find.text('NABIN could not give this store\'s figures, so none are shown.'),
          findsOneWidget);
      expect(find.text('SALES TOTAL'), findsNothing);
    });
  });

  group('the rest of the Dashboard tab', () {
    testWidgets('DASH-23 a store state the platform did not answer is not guessed',
        (tester) async {
      shellStub(services: <String, dynamic>{
        'success': true,
        'merchantId': kServerMerchantId,
        'services': <String>['RESTAURANT'],
        'profile': <String, dynamic>{'name': 'Stub Kitchen'},
        'isOpen': null,
      });
      await pumpDashboardTab(tester);

      expect(find.text('UNKNOWN'), findsOneWidget);
      expect(paintedText(tester), contains('Status not readable from NABIN right now'));
      // `is_open` is a BOOLEAN (`001_central_schema.sql:81`): two states, and the third choice
      // this row used to offer was a state NABIN cannot store.
      expect(find.text('PAUSED'), findsNothing);
      expect(find.text('Temporarily paused'), findsNothing);
    });

    testWidgets('DASH-24 the queue says which of its four conditions it is in', (tester) async {
      shellStub(orders: <Map<String, dynamic>>[]);
      await pumpDashboardTab(tester);

      expect(paintedText(tester), contains('No orders waiting in the kitchen from NABIN.'));
      // A locally re-counted badge would be a second answer to a question the platform gives.
      expect(paintedText(tester).contains('ACTIVE'), isFalse);
      expect(find.text('Kitchen Queue'), findsOneWidget);
    });

    testWidgets('DASH-25 a failed orders read does not become an empty order book',
        (tester) async {
      shellStub(respond: (method, url, body) {
        if (method == 'GET' && url.path.endsWith('/orders')) {
          return (500, jsonEncode(<String, dynamic>{'success': false, 'error': 'boom'}));
        }
        return null;
      });
      await pumpDashboardTab(tester);

      expect(paintedText(tester),
          contains('NABIN could not be reached, so this queue is not a statement about your orders'));
      expect(paintedText(tester).contains('No orders waiting'), isFalse);
    });

    testWidgets('DASH-26 recent rows paint only what the read returned, and nothing for the rest',
        (tester) async {
      shellStub(orders: <Map<String, dynamic>>[
        orderRow(orderNumber: 'ORD-STUB-777', customerName: null),
      ]);
      await pumpDashboardTab(tester);

      expect(find.text('ORD-STUB-777'), findsOneWidget);
      // The name the checkout snapshot did not carry is not filled in with a polite guest, and the
      // driver line and handover code this card used to print are columns this read cannot answer.
      expect(find.text('— Not available'), findsOneWidget);
      final painted = paintedText(tester);
      for (final invented in <String>['David K', '#1043', 'OTP', 'Priya', 'Rahul', 'Driver:']) {
        expect(painted.contains(invented), isFalse, reason: '$invented is still painted');
      }
    });
  });
}
