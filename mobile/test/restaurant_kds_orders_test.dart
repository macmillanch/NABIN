import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';

import 'package:mobile/core/network/nabin_api_service.dart';
import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/core/router/restaurant_router.dart';

import 'support/http_stub.dart';

// -----------------------------------------------------------------------------
// Restaurant Merchant shell — the Orders (KDS) ticket, held to what the orders
// read actually returns.
//
// The contract behind these tests was measured on 2026-10-08 with a read-only
// probe against the local development backend (`backend/merchant_orders_shape_probe.js`),
// which signed in as a MERCHANT and fetched `GET /api/merchant/:id/orders` for
// both merchants that have orders. Every row answered with these keys:
//
//   id, order_number, checkout_id, job_id, customer_id, merchant_id, service_type,
//   order_state, previous_state, merchant_timeout_at, timeout_reason, total_amount,
//   currency, items_snapshot, metadata, created_at, updated_at, order_lines, lines
//
// and none of these, which the card used to read anyway:
//
//   status  items  time  customer  type  driver  pickupOtp
//
// `driver` and `pickupOtp` appeared on 0 of the rows for either merchant.
// `pickup_otp` is a column of `jobs` (`backend/migrations/001_central_schema.sql:160`),
// not of `orders`, so this read cannot answer it at all. `order_state` is defined over
// nine values (`018_order_state_lines_and_checkout_linkage.sql:20-25`), and `READY` and
// `COMPLETED` are not among them, so the two taps that sent those were answered with 400
// by the KDS route (`server.js:4720`).
//
// And there is no printing. `mobile/pubspec.yaml` has no print-capable dependency, the
// backend has no KOT, ticket or printer route, and nothing in this app has ever opened a
// socket to a printer. The button that said `KOT Ticket printed for Order #…` printed
// nothing.
//
// So this suite guards four things: a ticket that paints only read columns, no claim of
// a printed ticket, a write path that only ever asks for a state the platform accepts,
// and controls that do what their label says.
// -----------------------------------------------------------------------------

const String kMerchantId = 'mnr_stub_restaurant';
const String kOrderId = '0f0f0f0f-1111-2222-3333-444444444444';
const String kMissing = '— Not available';

/// One `orders` row, in the shape `OrderRepository.js:449` selects it.
///
/// A column a test wants empty is passed as `null`, because NULL is what the real read
/// returns for it. The fabrication this suite exists to catch lived in the card's fallbacks,
/// not in the transport.
Map<String, dynamic> _order({
  Object? id = kOrderId,
  Object? orderNumber = 'ORD-STUB-0001',
  Object? orderState = 'RECEIVED',
  Object? serviceType = 'FOOD',
  Object? createdAt = '2026-10-08T09:12:00.000Z',
  Object? customerName = 'Stub Customer',
  Object? totalAmount = 240,
  List<Map<String, dynamic>>? lines,
  Map<String, dynamic>? extra,
}) {
  return <String, dynamic>{
    'id': id,
    'order_number': orderNumber,
    'order_state': orderState,
    'service_type': serviceType,
    'created_at': createdAt,
    'total_amount': totalAmount,
    'currency': 'INR',
    'metadata': <String, dynamic>{if (customerName != null) 'customerName': customerName},
    'lines': lines ?? <Map<String, dynamic>>[_line()],
    ...?extra,
  };
}

/// One `order_lines` row — the snapshot the platform took at checkout.
Map<String, dynamic> _line({
  Object? name = 'Stub Dish One',
  Object? quantity = 2,
  Object? unit,
  Map<String, dynamic>? extra,
}) {
  return <String, dynamic>{
    'id': 'line-stub-1',
    'product_name_snapshot': name,
    'quantity': quantity,
    'unit_snapshot': unit,
    ...?extra,
  };
}

/// The answers the console reads on boot, plus the order list under test.
///
/// `orders` replaces the rows; `ordersEnvelope` replaces the whole envelope, for the cases
/// where the envelope is the point (a refusal). `respond` overrides any single route.
void _shellOk({
  List<Map<String, dynamic>>? orders,
  Map<String, dynamic>? ordersEnvelope,
  (int, String)? Function(String method, Uri url, String body)? respond,
}) {
  (int, String) handler(String method, Uri url, String body) {
    final over = respond?.call(method, url, body);
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
      final rows = orders ?? <Map<String, dynamic>>[_order()];
      return (200, jsonEncode(ordersEnvelope ?? <String, dynamic>{
        'success': true,
        'count': rows.length,
        'orders': rows,
      }));
    }
    if (method == 'GET' && path.endsWith('/dashboard')) {
      return (200, jsonEncode(<String, dynamic>{
        'success': true,
        'restaurant': <String, dynamic>{'id': kMerchantId, 'name': 'Stub Kitchen'},
        'cuisines': <String>[],
        'activeOrdersCount': 0,
        'todaySales': 0,
        'orders': <dynamic>[],
      }));
    }
    if (method == 'GET' && path.endsWith('/merchant/catalog')) {
      return (200, jsonEncode(<String, dynamic>{
        'success': true,
        'merchantId': kMerchantId,
        'count': 0,
        'products': <dynamic>[],
      }));
    }
    if (method == 'POST' && path.endsWith('/status')) {
      // The route answers with the state the order is in now, plus the transition id.
      final asked = (jsonDecode(body) as Map)['status'];
      return (200, jsonEncode(<String, dynamic>{
        'success': true,
        'duplicate': false,
        'transitionId': 'tr-stub-1',
        'order_state': asked,
        'status': asked,
        'newState': asked,
      }));
    }
    return (404, '{"success":false}');
  }
  stubHandler = handler;
}

/// The painted text of the mounted tree, for the scans that read the whole screen at once.
String paintedText(WidgetTester tester) =>
    tester.widgetList<Text>(find.byType(Text)).map((t) => t.data ?? '').join(' | ');

/// How wide [text] would be on one unconstrained line in [style], measured the same way the
/// renderer measures it. Used to tell a label that fits from a label that was clipped.
///
/// `ui.TextDirection` is spelled out because `package:intl` — which the screen uses for the
/// timestamp format, so this file imports it too — exports its own `TextDirection`.
double _naturalWidth(String text, TextStyle style) {
  final TextPainter painter = TextPainter(
    text: TextSpan(text: text, style: style),
    textDirection: ui.TextDirection.ltr,
  )..layout();
  final double width = painter.width;
  painter.dispose();
  return width;
}

/// Requests to the API only.
List<String> get apiRequests => stubSeen.where((s) => s.contains('/api/')).toList();

/// Writes of any verb, anywhere in the run.
List<String> get writeRequests => stubSeen.where((s) => !s.startsWith('GET ')).toList();

/// Pumps the real merchant console at phone width (390 logical) with a signed-in RESTAURANT
/// merchant and opens its Orders (KDS) tab.
///
/// The two widths are deliberate. Every widget test renders with Ahem, which draws one square
/// per `fontSize` instead of a glyph, so long labels measure roughly 2x their real width; the
/// Dashboard tab the shell opens on has three pre-existing rows (`restaurant_main_shell.dart`
/// Store Status, the bento metrics, the Live Kitchen Queue header) that only overflow under
/// that font and are not what this file audits. Booting wide clears them, and the Orders tab is
/// switched to and then measured at 390x1000 logical (`physicalSize` 1170x3000 at ratio 3.0) —
/// the width §12 of the brief names, and the width the store switcher used to overflow at. The
/// KDS list is a `ListView`, so the surface is kept tall enough that a test's own rows stay on
/// screen rather than being evicted below the fold.
///
/// `restaurantRouter` is a singleton whose location survives between tests, so the route is
/// parked at `/dashboard` before the first frame. A loading spinner never settles, so the clock
/// is driven with fixed pumps rather than `pumpAndSettle`.
Future<void> pumpOrdersTab(WidgetTester tester) async {
  tester.view.physicalSize = const Size(2400, 3000);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);
  SessionManager.instance.saveSession(
    token: 'merchant-token',
    user: <String, dynamic>{'id': kMerchantId, 'restaurantId': kMerchantId, 'name': 'Stub Kitchen'},
  );
  restaurantRouter.go('/dashboard');
  await tester.pumpWidget(MaterialApp.router(routerConfig: restaurantRouter));
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
  await tester.tap(find.descendant(
    of: find.byType(NavigationBar),
    matching: find.text('Orders (KDS)'),
  ));
  // Narrow only once the Dashboard tab is out of the tree, so no frame paints it at phone width.
  tester.view.physicalSize = const Size(1170, 3000);
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
  // Anything raised by now is a real defect in a frame this suite is looking at.
  expect(tester.takeException(), isNull, reason: 'a pre-existing overflow leaked into the KDS harness');
}

/// The KDS list, so finders do not pick up the dashboard's copies of the same card.
final Finder ordersList = find.byKey(const Key('r-shell-orders-list'));

Finder inList(Finder child) => find.descendant(of: ordersList, matching: child);

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

  group('the ticket paints only columns the orders read returns', () {
    testWidgets('KDS-01 the order number the platform minted, not the row uuid', (tester) async {
      _shellOk();
      await pumpOrdersTab(tester);

      expect(inList(find.text('ORD-STUB-0001')), findsOneWidget);
      expect(paintedText(tester).contains(kOrderId), isFalse);
    });

    testWidgets('KDS-02 the row\'s own created_at, in the merchant\'s timezone', (tester) async {
      _shellOk();
      await pumpOrdersTab(tester);

      // Same formatter the screen uses, so this asserts the wiring (created_at → the header)
      // and not the glyphs.
      final expected = DateFormat('d MMM, h:mm a')
          .format(DateTime.parse('2026-10-08T09:12:00.000Z').toLocal());
      expect(inList(find.text(expected)), findsOneWidget);
    });

    testWidgets('KDS-03 a row with no created_at paints no time at all', (tester) async {
      _shellOk(orders: <Map<String, dynamic>>[_order(createdAt: null)]);
      await pumpOrdersTab(tester);

      expect(find.text('null'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('KDS-04 the checkout snapshot name, when the order carries one', (tester) async {
      _shellOk(orders: <Map<String, dynamic>>[_order(customerName: 'Zothanliani')]);
      await pumpOrdersTab(tester);

      expect(inList(find.text('Zothanliani')), findsOneWidget);
    });

    testWidgets('KDS-05 a nameless order is not renamed "Guest"', (tester) async {
      _shellOk(orders: <Map<String, dynamic>>[_order(customerName: null)]);
      await pumpOrdersTab(tester);

      expect(find.text('Guest'), findsNothing);
      expect(inList(find.text(kMissing)), findsOneWidget);
    });

    testWidgets('KDS-06 the lines come from product_name_snapshot and quantity', (tester) async {
      _shellOk(orders: <Map<String, dynamic>>[
        _order(lines: <Map<String, dynamic>>[
          _line(name: 'Vosa Bai', quantity: 3),
          _line(name: 'Bumchoh', quantity: 1),
        ]),
      ]);
      await pumpOrdersTab(tester);

      expect(inList(find.text('3x Vosa Bai')), findsOneWidget);
      expect(inList(find.text('1x Bumchoh')), findsOneWidget);
    });

    testWidgets('KDS-07 a line with no name is blank, not "Untitled item"', (tester) async {
      _shellOk(orders: <Map<String, dynamic>>[
        _order(lines: <Map<String, dynamic>>[_line(name: null, quantity: 2)]),
      ]);
      await pumpOrdersTab(tester);

      expect(find.text('Untitled item'), findsNothing);
      expect(inList(find.text('2x $kMissing')), findsOneWidget);
    });

    testWidgets('KDS-08 a line with no quantity states no count', (tester) async {
      _shellOk(orders: <Map<String, dynamic>>[
        _order(lines: <Map<String, dynamic>>[_line(name: 'Farkhan', quantity: null)]),
      ]);
      await pumpOrdersTab(tester);

      expect(inList(find.text('Farkhan')), findsOneWidget);
      expect(inList(find.textContaining('null')), findsNothing);
    });

    testWidgets('KDS-09 no order money is claimed when the ticket shows none', (tester) async {
      _shellOk(orders: <Map<String, dynamic>>[_order(totalAmount: null)]);
      await pumpOrdersTab(tester);

      expect(paintedText(tester).contains('₹0'), isFalse);
    });
  });

  group('order_state is the only status this screen may speak', () {
    testWidgets('KDS-10 a real state is labelled as the platform named it', (tester) async {
      _shellOk(orders: <Map<String, dynamic>>[_order(orderState: 'READY_FOR_PICKUP')]);
      await pumpOrdersTab(tester);

      expect(inList(find.text('READY FOR PICKUP')), findsOneWidget);
    });

    testWidgets('KDS-11 a row with no state says so instead of "PREPARING"', (tester) async {
      _shellOk(orders: <Map<String, dynamic>>[_order(orderState: null)]);
      await pumpOrdersTab(tester);

      expect(inList(find.text('PREPARING')), findsNothing);
      expect(inList(find.text('STATE NOT STATED')), findsOneWidget);
    });

    testWidgets('KDS-12 the old vocabulary is gone from the ticket', (tester) async {
      _shellOk(orders: <Map<String, dynamic>>[
        _order(orderState: 'RECEIVED'),
        _order(id: '0f0f0f0f-1111-2222-3333-555555555555', orderNumber: 'ORD-STUB-0002', orderState: 'DELIVERED'),
      ]);
      await pumpOrdersTab(tester);

      // `NEW` and `COMPLETED` were never values of order_state; `READY` was the card's own
      // shortening of READY_FOR_PICKUP.
      expect(inList(find.text('NEW ORDER')), findsNothing);
      expect(inList(find.text('COMPLETED')), findsNothing);
      expect(paintedText(tester).contains('Handover to Rider'), isFalse);
    });
  });

  group('no printing exists, so no printing is claimed', () {
    testWidgets('KDS-13 there is no Print KOT action on a ticket', (tester) async {
      _shellOk();
      await pumpOrdersTab(tester);

      expect(find.text('Print KOT'), findsNothing);
      expect(find.byType(OutlinedButton), findsNothing);
    });

    testWidgets('KDS-14 nothing on screen claims a ticket was printed', (tester) async {
      _shellOk();
      await pumpOrdersTab(tester);
      final painted = paintedText(tester).toLowerCase();

      expect(painted.contains('kot'), isFalse);
      expect(painted.contains('printed'), isFalse);
      expect(painted.contains('printing'), isFalse);
    });

    testWidgets('KDS-15 the whole run sends no print or KOT request', (tester) async {
      _shellOk();
      await pumpOrdersTab(tester);
      await tester.tap(inList(find.text('Accept order')));
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(apiRequests.where((r) => r.toLowerCase().contains('print')), isEmpty);
      expect(apiRequests.where((r) => r.toLowerCase().contains('kot')), isEmpty);
      expect(writeRequests, <String>[
        'POST http://localhost:4000/api/merchant/$kMerchantId/orders/$kOrderId/status',
      ]);
    });
  });

  group('a driver assignment and a handover OTP are not this read\'s to answer', () {
    testWidgets('KDS-16 keys no row carries are never painted, even if one arrives', (tester) async {
      // Adversarial on purpose: a payload that DOES carry `driver` and `pickupOtp` — the values
      // a customer might be told over the phone — must still produce neither on this ticket.
      _shellOk(orders: <Map<String, dynamic>>[
        _order(extra: <String, dynamic>{
          'driver': 'Vanlalruata Ralte',
          'driverPhone': '9876543210',
          'pickupOtp': '1234',
          'status': 'NEW',
          'time': '18:32',
          'customer': 'Lalremruata',
          'type': 'DELIVERY',
          'items': <Map<String, dynamic>>[
            <String, dynamic>{'name': 'Invented Dish', 'qty': 9, 'done': false},
          ],
        }),
      ]);
      await pumpOrdersTab(tester);
      final painted = paintedText(tester);

      expect(painted.contains('Vanlalruata'), isFalse);
      expect(painted.contains('9876543210'), isFalse);
      expect(painted.contains('1234'), isFalse);
      expect(painted.contains('OTP'), isFalse);
      expect(painted.contains('Lalremruata'), isFalse);
      expect(painted.contains('Invented Dish'), isFalse);
      expect(painted.contains('9x'), isFalse);
      // The real columns still win: the row's own number and snapshot name are on screen.
      expect(painted.contains('ORD-STUB-0001'), isTrue);
      expect(painted.contains('Stub Dish One'), isTrue);
    });

    testWidgets('KDS-17 no OTP badge, and no invented code standing in for one', (tester) async {
      _shellOk();
      await pumpOrdersTab(tester);
      final painted = paintedText(tester);

      expect(painted.contains('OTP'), isFalse);
      expect(painted.contains('1234'), isFalse);
      expect(painted.contains('0000'), isFalse);
    });

    testWidgets('KDS-18 no invented driver state and no bare "null" line', (tester) async {
      _shellOk();
      await pumpOrdersTab(tester);
      final painted = paintedText(tester);

      expect(painted.contains('Driver assigned'), isFalse);
      expect(painted.contains('No driver assigned'), isFalse);
      expect(painted.contains('Assigned'), isFalse);
      expect(painted.contains('null'), isFalse);
    });

    testWidgets('KDS-19 a real rider-side value on the row is still not a kitchen claim',
        (tester) async {
      // `job_id` is a real column of `orders`. It names a job; it says nothing about who is
      // driving it, so nothing here reads a person out of it.
      _shellOk(orders: <Map<String, dynamic>>[
        _order(extra: <String, dynamic>{'job_id': 'job-stub-77'}),
      ]);
      await pumpOrdersTab(tester);

      expect(paintedText(tester).contains('job-stub-77'), isFalse);
      expect(paintedText(tester).contains('Rider'), isFalse);
    });
  });

  group('the write path only asks for states the platform accepts', () {
    testWidgets('KDS-20 a RECEIVED ticket sends ACCEPTED, and only that', (tester) async {
      _shellOk(orders: <Map<String, dynamic>>[_order(orderState: 'RECEIVED')]);
      await pumpOrdersTab(tester);

      await tester.tap(inList(find.text('Accept order')));
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      final body = stubBodyFor('POST', '/status');
      expect(jsonDecode(body!)['status'], 'ACCEPTED');
      expect(inList(find.text('ACCEPTED')), findsOneWidget);
    });

    testWidgets('KDS-21 PREPARING advances to READY_FOR_PICKUP, never to READY', (tester) async {
      _shellOk(orders: <Map<String, dynamic>>[_order(orderState: 'PREPARING')]);
      await pumpOrdersTab(tester);

      await tester.tap(inList(find.text('Mark ready for pickup')));
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(jsonDecode(stubBodyFor('POST', '/status')!)['status'], 'READY_FOR_PICKUP');
    });

    testWidgets('KDS-22 an order the kitchen has finished offers no advance', (tester) async {
      _shellOk(orders: <Map<String, dynamic>>[
        _order(orderState: 'READY_FOR_PICKUP'),
        _order(id: '0f0f0f0f-1111-2222-3333-666666666666', orderNumber: 'ORD-STUB-0003', orderState: 'DELIVERED'),
        _order(id: '0f0f0f0f-1111-2222-3333-777777777777', orderNumber: 'ORD-STUB-0004', orderState: 'CANCELLED'),
      ]);
      await pumpOrdersTab(tester);

      expect(inList(find.byType(ElevatedButton)), findsNothing);
      expect(writeRequests, isEmpty);
    });

    testWidgets('KDS-23 a refusal leaves the ticket where it was and says why', (tester) async {
      _shellOk(
        orders: <Map<String, dynamic>>[_order(orderState: 'ACCEPTED')],
        respond: (method, url, body) =>
            url.path.endsWith('/status')
                ? (400, jsonEncode(<String, dynamic>{
                    'success': false,
                    'code': 'INVALID_TRANSITION',
                    'error': 'Order is not in a state to move there.',
                  }))
                : null,
      );
      await pumpOrdersTab(tester);

      await tester.tap(inList(find.text('Start cooking')));
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(inList(find.text('ACCEPTED')), findsOneWidget);
      expect(inList(find.text('PREPARING')), findsNothing);
      expect(paintedText(tester).contains('Order is not in a state to move there.'), isTrue);
    });

    testWidgets('KDS-24 no answer at all is reported as no answer, not as success', (tester) async {
      _shellOk(
        orders: <Map<String, dynamic>>[_order(orderState: 'ACCEPTED')],
        respond: (method, url, body) => url.path.endsWith('/status') ? (504, '<html>gateway</html>') : null,
      );
      await pumpOrdersTab(tester);

      await tester.tap(inList(find.text('Start cooking')));
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      // A non-JSON body decodes to nothing usable, which the app folds into "no answer" — the
      // ticket must not move, and must not claim it did.
      expect(inList(find.text('ACCEPTED')), findsOneWidget);
      expect(paintedText(tester).contains('not been updated'), isTrue);
    });

    testWidgets('KDS-25 a double tap in flight sends one POST', (tester) async {
      stubDelay = const Duration(milliseconds: 600);
      _shellOk(orders: <Map<String, dynamic>>[_order(orderState: 'RECEIVED')]);
      await pumpOrdersTab(tester);

      final button = inList(find.text('Accept order'));
      await tester.tap(button);
      await tester.tap(button);
      await tester.tap(button);
      stubDelay = Duration.zero;
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }

      expect(writeRequests.length, 1);
      expect(inList(find.text('ACCEPTED')), findsOneWidget);
    });

    testWidgets('KDS-26 the order id the write carries is the row\'s own id', (tester) async {
      _shellOk(orders: <Map<String, dynamic>>[_order(orderState: 'RECEIVED')]);
      await pumpOrdersTab(tester);

      await tester.tap(inList(find.text('Accept order')));
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(writeRequests.single.endsWith('/orders/$kOrderId/status'), isTrue);
      expect(stubHeaders.last['authorization'], 'Bearer merchant-token');
    });
  });

  group('the controls above the list do what they say', () {
    testWidgets('KDS-27 Completed History shows only finished orders', (tester) async {
      _shellOk(orders: <Map<String, dynamic>>[
        _order(orderState: 'RECEIVED'),
        _order(id: '0f0f0f0f-1111-2222-3333-888888888888', orderNumber: 'ORD-STUB-FINISHED', orderState: 'DELIVERED'),
      ]);
      await pumpOrdersTab(tester);

      await tester.tap(find.text('Completed History'));
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(find.text('ORD-STUB-FINISHED'), findsOneWidget);
      expect(find.text('ORD-STUB-0001'), findsNothing);
    });

    testWidgets('KDS-28 Active Queue shows the orders still running', (tester) async {
      _shellOk(orders: <Map<String, dynamic>>[
        _order(orderState: 'RECEIVED'),
        _order(id: '0f0f0f0f-1111-2222-3333-888888888888', orderNumber: 'ORD-STUB-FINISHED', orderState: 'CANCELLED'),
      ]);
      await pumpOrdersTab(tester);

      await tester.tap(find.text('Completed History'));
      for (var i = 0; i < 4; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }
      await tester.tap(find.text('Active Queue'));
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(find.text('ORD-STUB-0001'), findsOneWidget);
      expect(find.text('ORD-STUB-FINISHED'), findsNothing);
    });

    testWidgets('KDS-29 a failed read is not reported as an empty order book', (tester) async {
      _shellOk(
        ordersEnvelope: <String, dynamic>{
          'success': false,
          'code': 'STORE_UNREACHABLE',
          'error': 'Store unreachable',
        },
      );
      await pumpOrdersTab(tester);
      final painted = paintedText(tester);

      expect(painted.contains('NABIN could not be reached'), isTrue);
      expect(painted.contains('No orders waiting in the kitchen'), isFalse);
    });

    testWidgets('KDS-30 a ready read with nothing in it says which of the two it was',
        (tester) async {
      _shellOk(orders: <Map<String, dynamic>>[]);
      await pumpOrdersTab(tester);

      expect(paintedText(tester).contains('No orders waiting in the kitchen from NABIN.'), isTrue);
    });
  });

  group('the store switcher fits a phone and still refuses what was not granted', () {
    testWidgets('KDS-31 both rows render at 390dp with no overflow', (tester) async {
      _shellOk();
      await pumpOrdersTab(tester);

      expect(find.text('Restaurant KDS'), findsWidgets);
      expect(find.text('Grocery DarkStore'), findsWidgets);

      // The pump above already painted at 390 logical px, so an overflowing RenderFlex would
      // surface as a non-null exception here. That alone is not enough: a row can sit inside
      // its box by luck. The measurement below is the proof the constraint is doing the work —
      // each label is painted no wider than the same text laid out with nothing to give way
      // into, and no wider than the half of the bar it is allowed to occupy. Unellipsised,
      // 'Grocery DarkStore' alone is wider than its half at this width, which is exactly how
      // the row overflowed before.
      expect(tester.takeException(), isNull);
      final List<double> slots = <double>[];
      for (final String label in <String>['Restaurant KDS', 'Grocery DarkStore']) {
        final double natural = _naturalWidth(
          label,
          const TextStyle(fontSize: 12, fontWeight: FontWeight.w900),
        );
        final double painted = tester.getSize(find.text(label)).width;
        final double slot = tester.getSize(
          find.ancestor(of: find.text(label), matching: find.byType(GestureDetector)),
        ).width;
        slots.add(slot);

        // Inside the half of the bar it is allowed to occupy…
        expect(painted, lessThanOrEqualTo(slot), reason: '$label escapes its switcher slot');
        // …and, for both labels at this width, actually clipped rather than luckily narrow:
        // each painted width is below the natural width of the same text on one line.
        expect(painted, lessThan(natural), reason: '$label is not constrained');
      }
      // The two halves together cannot exceed the bar, which is 390 logical px less its 16 px
      // margins and the 4 px between the halves.
      expect(slots.reduce((double a, double b) => a + b) + 4, lessThanOrEqualTo(390 - 32));
    });

    testWidgets('KDS-32 tapping a service this merchant was not granted is still refused',
        (tester) async {
      _shellOk();
      await pumpOrdersTab(tester);
      stubSeen.clear();

      await tester.tap(find.text('Grocery DarkStore'));
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(paintedText(tester).contains('not authorized for Instamart on NABIN'), isTrue);
      expect(apiRequests, isEmpty);
    });
  });
}
