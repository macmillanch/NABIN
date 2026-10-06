import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/features/food/presentation/screens/food_order_tracking_screen.dart';

import 'support/http_stub.dart';

// The screen owned the order lifecycle: a Timer walked nine invented stage titles forward
// every 15 seconds and the card printed 'FD-88912', 'DELIVERY OTP: 4892', 'Deepak Kumar
// (TVS Auto DL 1RA 4892)', '★ 4.90 • 1.2 km away', 'ETA: 18 Mins' and '₹480'. It made no
// request at all.
//
// What actually moves a food order is the merchant's status write
// (POST /api/merchant/:restaurantId/orders/:orderId/status), which lands in
// `orders.order_state` — the nine-value CHECK constraint in migration 018. So this screen
// reads GET /api/customer/orders/:id and renders the stored state, and it re-reads rather
// than predicts. No customer route returns a rider, an OTP or an ETA for a food order, so
// those claims go and the gap gets named instead.
//
// Same rule as every other screen here: assert the request left before asserting content,
// because an error state also satisfies "the invented literal is gone".

void serve({
  Map<String, dynamic>? order = const <String, dynamic>{
    'id': '2f9c1c1a-0000-4000-8000-000000000001',
    'order_number': 'FOOD-2026-0001',
    'service_type': 'FOOD',
    'order_state': 'PREPARING',
    'previous_state': 'ACCEPTED',
    'total_amount': 412.5,
    'currency': 'INR',
    'created_at': '2026-10-04T09:12:00.000Z',
    'metadata': <String, dynamic>{
      'deliveryAddress': 'Lobby, VVK College Hostel, Aizawl',
    },
    'lines': <Map<String, dynamic>>[
      <String, dynamic>{
        'product_name_snapshot': 'Alur Pitha',
        'quantity': 2,
        'unit_snapshot': 'piece',
        'unit_price_snapshot': 40,
        'line_total': 80,
      },
      <String, dynamic>{
        'product_name_snapshot': 'Bai Chak-Ai with Chicken',
        'quantity': 1,
        'unit_snapshot': 'pack',
        'unit_price_snapshot': 332.5,
        'line_total': 332.5,
      },
    ],
  },
  bool orderOk = true,
}) {
  stubHandler = (method, url, _) {
    if (!url.path.contains('/customer/orders/')) {
      return (200, '{"success":true}');
    }
    if (!orderOk || order == null) {
      return (
        500,
        jsonEncode(<String, dynamic>{'success': false, 'error': 'order not found'})
      );
    }
    return (
      200,
      jsonEncode(<String, dynamic>{'success': true, 'order': order})
    );
  };
}

Map<String, dynamic> _orderIn(String state, {String previous = 'ACCEPTED'}) {
  return <String, dynamic>{
    'id': '2f9c1c1a-0000-4000-8000-000000000001',
    'order_number': 'FOOD-2026-0001',
    'order_state': state,
    'previous_state': previous,
    'total_amount': 412.5,
    'currency': 'INR',
    'created_at': '2026-10-04T09:12:00.000Z',
    'metadata': <String, dynamic>{'deliveryAddress': 'Lobby, VVK College Hostel, Aizawl'},
    'lines': <Map<String, dynamic>>[
      <String, dynamic>{
        'product_name_snapshot': 'Alur Pitha',
        'quantity': 2,
        'unit_snapshot': 'piece',
        'unit_price_snapshot': 40,
        'line_total': 80,
      },
    ],
  };
}

Future<void> pumpTracking(
  WidgetTester tester, {
  Map<String, dynamic>? orderData,
}) async {
  // A phone-width column, tall enough that the whole list builds: a ListView never
  // creates the widgets below its viewport, so an assertion about the lines card or the
  // delivery gap would read as a missing claim rather than an unscrolled one.
  tester.view.physicalSize = const Size(390 * 3, 2400 * 3);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    MaterialApp(
      home: FoodOrderTrackingScreen(orderData: orderData),
    ),
  );
  // No pumpAndSettle: the in-flight read paints a spinner.
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

const Map<String, dynamic> _handedOrder = <String, dynamic>{
  'orderId': '2f9c1c1a-0000-4000-8000-000000000001',
  'restaurantName': 'Highway Family Restaurant',
};

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    serve();
    SessionManager.instance.saveSession(
      token: 'test-token',
      user: <String, dynamic>{'id': 'usr_real_42', 'name': 'Lalthanmawli Vanminuwa'},
    );
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
  });

  group('the read', () {
    testWidgets('asks the backend for the order it was handed', (tester) async {
      await pumpTracking(tester, orderData: _handedOrder);

      expect(stubSaw('GET', '/customer/orders/2f9c1c1a'), isTrue);
    });

    testWidgets('paints the stage the row reports', (tester) async {
      await pumpTracking(tester, orderData: _handedOrder);

      expect(stubSaw('GET', '/customer/orders/2f9c1c1a'), isTrue);
      // Once in the band's stage pill, once as the active step of the stage list.
      expect(find.text('Being cooked'), findsWidgets);
      expect(find.text('Step 3 of 7'), findsOneWidget);
      expect(find.textContaining('#FOOD-2026-0001'), findsOneWidget);
      expect(find.textContaining('Order placed at'), findsOneWidget);
    });

    testWidgets('a refused read asks for a retry instead of narrating a kitchen',
        (tester) async {
      serve(orderOk: false);

      await pumpTracking(tester, orderData: _handedOrder);

      expect(stubSaw('GET', '/customer/orders/2f9c1c1a'), isTrue);
      expect(find.textContaining("couldn't load this order"), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
      expect(find.textContaining('Cooking fresh with safety standards'), findsNothing);
    });

    testWidgets('no order id means it says so rather than tracking a guess',
        (tester) async {
      await pumpTracking(tester);

      expect(stubSeen, isEmpty);
      expect(find.textContaining('No order to track'), findsOneWidget);
    });
  });

  group('invented lifecycle and riders', () {
    testWidgets('none of the fabricated order claims survive', (tester) async {
      await pumpTracking(tester, orderData: _handedOrder);

      expect(stubSaw('GET', '/customer/orders/2f9c1c1a'), isTrue);
      for (final String claim in <String>[
        'FD-88912',
        'DELIVERY OTP',
        '4892',
        'Deepak Kumar',
        'TVS Auto DL 1RA',
        '+91 98765 43210',
        '★ 4.90',
        '1.2 km away',
        'ETA: 18 Mins',
        'Flat 402, Kamalanagar, Aizawl',
        'RESTAURANT CONFIRMING',
        'DRIVER ASSIGNED',
        'OUT FOR DELIVERY',
        'Delivering to:',
      ]) {
        expect(find.textContaining(claim), findsNothing, reason: '$claim was invented');
      }
    });

    testWidgets('the stage does not advance while nobody writes it', (tester) async {
      await pumpTracking(tester, orderData: _handedOrder);

      // Two minutes of wall clock: eight silent re-reads of the same row.
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(seconds: 15));
      }

      expect(find.text('Step 3 of 7'), findsOneWidget);
      // The band's pill and the active step both still name the same stage.
      expect(find.text('Being cooked'), findsNWidgets(2));
      expect(find.text('Collected'), findsOneWidget,
          reason: 'only ever listed as a later stage, never reported as the current one');
      expect(
        stubSeen.where((s) => s.contains('/customer/orders/')).length,
        greaterThanOrEqualTo(2),
        reason: 'it should re-read rather than freeze',
      );
    });

    testWidgets('the delivery gap is stated instead of filled', (tester) async {
      await pumpTracking(tester, orderData: _handedOrder);

      expect(stubSaw('GET', '/customer/orders/2f9c1c1a'), isTrue);
      expect(find.text('Rider and arrival time'), findsOneWidget);
      expect(
        find.textContaining('no rider name, vehicle, phone number, live position'),
        findsOneWidget,
      );
    });

    testWidgets('the timeline is labelled as written by the platform', (tester) async {
      await pumpTracking(tester, orderData: _handedOrder);

      expect(find.text('Order stages'), findsOneWidget);
      expect(find.textContaining('not simulated here'), findsOneWidget);
    });
  });

  group('stored money and lines', () {
    testWidgets('renders the order lines from the snapshot columns', (tester) async {
      await pumpTracking(tester, orderData: _handedOrder);

      expect(stubSaw('GET', '/customer/orders/2f9c1c1a'), isTrue);
      expect(find.text('Alur Pitha'), findsOneWidget);
      expect(find.text('2 piece • ₹40 each'), findsOneWidget);
      expect(find.text('₹80'), findsWidgets);
      expect(find.text('Bai Chak-Ai with Chicken'), findsOneWidget);
      expect(find.text('1 pack • ₹332.50 each'), findsOneWidget);
    });

    testWidgets('shows the stored total, not the cart arithmetic', (tester) async {
      await pumpTracking(tester, orderData: _handedOrder);

      expect(stubSaw('GET', '/customer/orders/2f9c1c1a'), isTrue);
      expect(find.text('₹412.50'), findsOneWidget);
      expect(find.text('₹480'), findsNothing);
    });

    testWidgets('shows the address the order row carries', (tester) async {
      await pumpTracking(tester, orderData: _handedOrder);

      expect(find.text('Lobby, VVK College Hostel, Aizawl'), findsOneWidget);
    });

    testWidgets('an order with no lines admits it', (tester) async {
      serve(order: <String, dynamic>{
        'id': '2f9c1c1a-0000-4000-8000-000000000001',
        'order_number': 'FOOD-2026-0002',
        'order_state': 'RECEIVED',
        'total_amount': 0,
        'currency': 'INR',
        'created_at': '2026-10-04T09:12:00.000Z',
        'metadata': <String, dynamic>{},
        'lines': <Map<String, dynamic>>[],
      });

      await pumpTracking(tester, orderData: _handedOrder);

      expect(stubSaw('GET', '/customer/orders/2f9c1c1a'), isTrue);
      expect(find.textContaining('order lines are not in this read'), findsOneWidget);
      expect(find.text('Step 1 of 7'), findsOneWidget);
    });
  });

  group('terminal states', () {
    testWidgets('a decline names the state it stopped in', (tester) async {
      serve(order: _orderIn('REJECTED'));

      await pumpTracking(tester, orderData: _handedOrder);

      expect(stubSaw('GET', '/customer/orders/2f9c1c1a'), isTrue);
      expect(find.text('Declined by the restaurant'), findsOneWidget);
      expect(find.textContaining('Stopped while it was: ACCEPTED'), findsOneWidget);
      expect(find.textContaining('Closed'), findsOneWidget);
      // A decline says nothing about money. No order transition writes a refund
      // (migration 018 only moves `order_state`), so the screen may not promise one.
      expect(find.textContaining('Nothing was charged'), findsNothing);
      expect(find.textContaining('refunded'), findsNothing);
    });

    testWidgets('an unrecognised state reports nothing invented', (tester) async {
      serve(order: _orderIn('SOMETHING_NEW'));

      await pumpTracking(tester, orderData: _handedOrder);

      expect(stubSaw('GET', '/customer/orders/2f9c1c1a'), isTrue);
      expect(find.text('No stage reported'), findsNWidgets(2));
      expect(find.textContaining('does not carry a stage this app recognises'), findsOneWidget);
      expect(find.textContaining('Step'), findsNothing);
    });

    testWidgets('a delivered order reads as delivered', (tester) async {
      serve(order: _orderIn('DELIVERED'));

      await pumpTracking(tester, orderData: _handedOrder);

      expect(stubSaw('GET', '/customer/orders/2f9c1c1a'), isTrue);
      expect(find.text('Step 7 of 7'), findsOneWidget);
      expect(find.text('Delivered'), findsWidgets);
    });
  });
}
