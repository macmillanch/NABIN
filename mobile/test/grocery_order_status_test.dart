import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/features/grocery/presentation/screens/grocery_order_status_screen.dart';

import 'support/http_stub.dart';

// Grocery checkout had nowhere to go after the write: the confirmation sheet sent the
// customer to `/activity`, which lists orders but shows none of them. The order row is
// the authority here — `GET /api/customer/orders/:id` returns the persisted `orders`
// row with its `order_lines`, and `orders.order_state` is the nine-value CHECK
// constraint in migration 018. The merchant's own status writes are what move it, so
// this screen re-reads rather than predicts.
//
// That read carries no store name, no rider, no vehicle, no phone, no position and no
// estimated arrival, so this screen prints none of those. Same rule as every other
// screen here: assert the request left before asserting content, because an error
// state also satisfies "the invented literal is gone".

const String _orderId = '7f2c9b44-0000-4000-8000-000000000044';
const String _orderPath = '/customer/orders/7f2c9b44';

Map<String, dynamic> _groceryOrder(
  String state, {
  String? previous = 'ACCEPTED',
  String number = 'ORD-GR-2026-0142',
  Object total = 290,
  String currency = 'INR',
  List<Map<String, dynamic>> lines = const <Map<String, dynamic>>[
    <String, dynamic>{
      'product_name_snapshot': 'Reli rice',
      'quantity': 2,
      'unit_snapshot': 'kg',
      'unit_price_snapshot': 160,
      'line_total': 290,
    },
  ],
  Map<String, dynamic> metadata = const <String, dynamic>{
    'deliveryAddress': 'Hrupthai Village, Aizawl',
    'deliveryInstructions': 'Leave at the gate',
  },
}) {
  return <String, dynamic>{
    'id': _orderId,
    'order_number': number,
    'service_type': 'GROCERY',
    'order_state': state,
    'previous_state': previous,
    'total_amount': total,
    'currency': currency,
    'created_at': '2026-10-05T04:12:00.000Z',
    'updated_at': '2026-10-05T04:20:00.000Z',
    'metadata': metadata,
    'lines': lines,
  };
}

/// Status code + body the order read answers with. `status: null` means the request
/// never completed, which the client reports as 0.
void serve({
  Map<String, dynamic>? order = const <String, dynamic>{},
  int status = 200,
  String? error,
}) {
  stubHandler = (method, url, _) {
    if (!url.path.contains('/customer/orders/')) {
      return (200, '{"success":true}');
    }
    if (status != 200) {
      return (status, jsonEncode(<String, dynamic>{
        'success': false,
        'error': error ?? 'No order with that number.',
      }));
    }
    if (order == null) {
      return (200, '{"success":true}');
    }
    return (200, jsonEncode(<String, dynamic>{'success': true, 'order': order}));
  };
}

Future<void> pumpStatus(
  WidgetTester tester, {
  Map<String, dynamic>? orderData,
  double width = 390,
  double height = 2600,
}) async {
  // A phone-width column, tall enough that the whole list builds: a ListView never
  // creates the widgets below its viewport, so an assertion about the items card or
  // the delivery gap would read as a missing claim rather than an unscrolled one.
  tester.view.physicalSize = Size(width * 3, height * 3);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(
    MaterialApp(home: GroceryOrderStatusScreen(orderData: orderData)),
  );
  // No pumpAndSettle: the in-flight read paints a spinner.
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

const Map<String, dynamic> _handedOrder = <String, dynamic>{
  'order_id': _orderId,
};

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    serve(order: _groceryOrder('RECEIVED'));
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
      await pumpStatus(tester, orderData: _handedOrder);

      expect(stubSaw('GET', _orderPath), isTrue);
    });

    testWidgets('waits on the read instead of painting a guessed order', (tester) async {
      serve(order: _groceryOrder('RECEIVED'));
      await tester.pumpWidget(
        const MaterialApp(home: GroceryOrderStatusScreen(orderData: _handedOrder)),
      );

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.text('Reli rice'), findsNothing);
    });

    testWidgets('paints the stage the row reports', (tester) async {
      serve(order: _groceryOrder('PACKING'));

      await pumpStatus(tester, orderData: _handedOrder);

      expect(stubSaw('GET', _orderPath), isTrue);
      // Once in the band's stage pill, once as the active step of the stage list.
      expect(find.text('Packing your items'), findsWidgets);
      expect(find.text('Step 4 of 7'), findsOneWidget);
      expect(find.textContaining('#ORD-GR-2026-0142'), findsOneWidget);
      expect(find.textContaining('Order placed'), findsOneWidget);
    });

    testWidgets('shows the order number it was given, not a minted one', (tester) async {
      serve(order: _groceryOrder('RECEIVED', number: 'ORD-00003248'));

      await pumpStatus(tester, orderData: _handedOrder);

      expect(find.textContaining('#ORD-00003248'), findsOneWidget);
      expect(find.textContaining('ORD-GR'), findsNothing);
    });

    testWidgets('a refused read asks for a retry instead of narrating a store',
        (tester) async {
      serve(status: 500, error: 'store unreachable');

      await pumpStatus(tester, orderData: _handedOrder);

      expect(stubSaw('GET', _orderPath), isTrue);
      expect(find.textContaining("couldn't load this grocery order"), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
      expect(find.textContaining('Packing your items'), findsNothing);
    });

    testWidgets('no order id means it says so rather than tracking a guess',
        (tester) async {
      await pumpStatus(tester);

      expect(stubSeen, isEmpty);
      expect(find.textContaining('No grocery order to show'), findsOneWidget);
    });
  });

  group('what a failed read actually says', () {
    testWidgets('401 says sign in, not "your order is late"', (tester) async {
      serve(status: 401, error: 'Unauthorized: Invalid or expired customer session token.');

      await pumpStatus(tester, orderData: _handedOrder);

      expect(stubSaw('GET', _orderPath), isTrue);
      expect(find.textContaining('Sign in'), findsOneWidget);
      expect(find.text('Step 1 of 7'), findsNothing);
    });

    testWidgets('403 says the order is somebody else\'s', (tester) async {
      serve(status: 403, error: "Forbidden: Cannot access another customer's order.");

      await pumpStatus(tester, orderData: _handedOrder);

      expect(stubSaw('GET', _orderPath), isTrue);
      expect(find.textContaining('different account'), findsOneWidget);
    });

    testWidgets('404 says the number was never minted', (tester) async {
      serve(status: 404, error: 'Order not found');

      await pumpStatus(tester, orderData: _handedOrder);

      expect(stubSaw('GET', _orderPath), isTrue);
      expect(find.textContaining('no grocery order with that number'), findsOneWidget);
    });

    testWidgets('a 200 with no order in it admits it', (tester) async {
      serve(order: null);

      await pumpStatus(tester, orderData: _handedOrder);

      expect(stubSaw('GET', _orderPath), isTrue);
      expect(find.textContaining('came back without an order'), findsOneWidget);
      expect(find.text('Delivered'), findsNothing);
    });
  });

  group('the seven forward stages of migration 018', () {
    const Map<String, String> stages = <String, String>{
      'RECEIVED': 'Order received',
      'ACCEPTED': 'Store accepted',
      'PREPARING': 'Picking your items',
      'PACKING': 'Packing your items',
      'READY_FOR_PICKUP': 'Ready for collection',
      'PICKED_UP': 'Left the store',
      'DELIVERED': 'Delivered',
    };
    const List<String> order = <String>[
      'RECEIVED', 'ACCEPTED', 'PREPARING', 'PACKING',
      'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERED',
    ];

    for (var i = 0; i < order.length; i++) {
      final String state = order[i];
      testWidgets('$state reads as step ${i + 1} of 7', (tester) async {
        serve(order: _groceryOrder(state, previous: i == 0 ? null : order[i - 1]));

        await pumpStatus(tester, orderData: _handedOrder);

        expect(stubSaw('GET', _orderPath), isTrue);
        expect(find.text(stages[state]!), findsWidgets);
        expect(find.text('Step ${i + 1} of 7'), findsOneWidget);
      });
    }

    testWidgets('the stage does not advance while nobody writes it', (tester) async {
      serve(order: _groceryOrder('PREPARING'));

      await pumpStatus(tester, orderData: _handedOrder);

      // Two minutes of wall clock: silent re-reads of the same row, and the row
      // still says PREPARING because no merchant wrote anything.
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(seconds: 15));
      }

      expect(find.text('Step 3 of 7'), findsOneWidget);
      expect(find.text('Left the store'), findsOneWidget,
          reason: 'only ever listed as a later stage, never reported as the current one');
      expect(
        stubSeen.where((s) => s.contains('/customer/orders/')).length,
        greaterThanOrEqualTo(2),
        reason: 'it should re-read rather than freeze',
      );
    });
  });

  group('terminal states', () {
    testWidgets('a decline names the store, and the state it stopped in', (tester) async {
      serve(order: _groceryOrder('REJECTED', previous: 'RECEIVED'));

      await pumpStatus(tester, orderData: _handedOrder);

      expect(stubSaw('GET', _orderPath), isTrue);
      expect(find.text('Declined by the store'), findsOneWidget);
      expect(find.textContaining('Stopped while it was: RECEIVED'), findsOneWidget);
      expect(find.textContaining('Closed'), findsOneWidget);
      // `is_valid_order_transition` gives REJECTED no outgoing edge, so "will not move
      // again" is a fact about the constraint, not a guess about this order.
      expect(find.textContaining('will not move again'), findsOneWidget);
      // No transition path writes a refund, and this read carries no payment state.
      expect(find.textContaining('refunded'), findsNothing);
      expect(find.textContaining('Nothing was charged'), findsNothing);
    });

    testWidgets('a cancel reports no money claim', (tester) async {
      serve(order: _groceryOrder('CANCELLED', previous: 'ACCEPTED'));

      await pumpStatus(tester, orderData: _handedOrder);

      expect(find.text('Cancelled'), findsWidgets);
      expect(find.textContaining('Stopped while it was: ACCEPTED'), findsOneWidget);
      expect(find.textContaining('refunded'), findsNothing);
    });

    testWidgets('polling stops once the row is terminal', (tester) async {
      serve(order: _groceryOrder('DELIVERED'));

      await pumpStatus(tester, orderData: _handedOrder);

      final int afterFirstRead =
          stubSeen.where((s) => s.contains('/customer/orders/')).length;
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(seconds: 15));
      }

      expect(
        stubSeen.where((s) => s.contains('/customer/orders/')).length,
        afterFirstRead,
        reason: 'a delivered order cannot move, so there is nothing left to poll for',
      );
    });

    testWidgets('leaving the screen stops the re-reads', (tester) async {
      serve(order: _groceryOrder('PREPARING'));

      await pumpStatus(tester, orderData: _handedOrder);
      final int whileOpen = stubSeen.where((s) => s.contains('/customer/orders/')).length;

      await tester.pumpWidget(const MaterialApp(home: SizedBox.shrink()));
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(seconds: 15));
      }

      expect(
        stubSeen.where((s) => s.contains('/customer/orders/')).length,
        whileOpen,
        reason: 'the timer belongs to the screen, not to the process',
      );
    });
  });

  group('an unrecognised state', () {
    testWidgets('reports nothing invented', (tester) async {
      serve(order: _groceryOrder('SOMETHING_NEW'));

      await pumpStatus(tester, orderData: _handedOrder);

      expect(stubSaw('GET', _orderPath), isTrue);
      expect(find.text('No stage reported'), findsNWidgets(2));
      expect(find.textContaining('does not carry a stage this app recognises'), findsOneWidget);
      expect(find.textContaining('Step '), findsNothing,
          reason: 'a stage this app does not know has no position in the list');
      expect(find.textContaining('will not move again'), findsNothing);
    });

    testWidgets('an empty state string is handled the same way', (tester) async {
      serve(order: _groceryOrder('', previous: null));

      await pumpStatus(tester, orderData: _handedOrder);

      expect(find.text('No stage reported'), findsNWidgets(2));
      expect(find.textContaining('Step '), findsNothing);
    });
  });

  group('stored money, lines and metadata', () {
    testWidgets('renders the lines from the snapshot columns', (tester) async {
      serve(order: _groceryOrder('PACKING', lines: const <Map<String, dynamic>>[
        <String, dynamic>{
          'product_name_snapshot': 'Reli rice',
          'quantity': 2,
          'unit_snapshot': 'kg',
          'unit_price_snapshot': 160,
          'line_total': 320,
        },
        <String, dynamic>{
          'product_name_snapshot': 'Thalhaw fish',
          'quantity': 0.5,
          'unit_snapshot': 'kg',
          'unit_price_snapshot': 340,
          'line_total': 170,
        },
      ]));

      await pumpStatus(tester, orderData: _handedOrder);

      expect(stubSaw('GET', _orderPath), isTrue);
      expect(find.text('Reli rice'), findsOneWidget);
      expect(find.text('2 kg • ₹160 each'), findsOneWidget);
      expect(find.text('Thalhaw fish'), findsOneWidget);
      expect(find.text('0.5 kg • ₹340 each'), findsOneWidget);
      expect(find.text('₹320'), findsWidgets);
      expect(find.text('₹170'), findsOneWidget);
    });

    testWidgets('shows the stored total, not the basket arithmetic', (tester) async {
      serve(order: _groceryOrder('PACKING', total: 290.5));

      await pumpStatus(tester, orderData: _handedOrder);

      expect(find.text('₹290.50'), findsOneWidget);
      expect(find.text('₹320'), findsNothing);
    });

    testWidgets('a non-rupee currency is printed as stored', (tester) async {
      serve(order: _groceryOrder('PACKING', total: 290, currency: 'USD'));

      await pumpStatus(tester, orderData: _handedOrder);

      expect(find.textContaining('USD 290'), findsWidgets);
      // The default fixture's one line totals 290, so both the line and the order
      // print it — the point is that neither prints a rupee sign the row doesn't use.
      expect(find.textContaining('₹'), findsNothing);
    });

    testWidgets('shows the address and note the order row carries', (tester) async {
      await pumpStatus(tester, orderData: _handedOrder);

      expect(stubSaw('GET', _orderPath), isTrue);
      expect(find.text('Hrupthai Village, Aizawl'), findsOneWidget);
      expect(find.text('Leave at the gate'), findsOneWidget);
    });

    testWidgets('a metadata coupon is printed from the row', (tester) async {
      serve(order: _groceryOrder('PACKING', metadata: <String, dynamic>{
        'deliveryAddress': 'Hrupthai Village, Aizawl',
        'coupon': <String, dynamic>{'code': 'SUITECODE', 'discount': 30},
      }));

      await pumpStatus(tester, orderData: _handedOrder);

      expect(find.text('SUITECODE'), findsOneWidget);
      expect(find.text('-₹30'), findsOneWidget);
    });

    testWidgets('an order with no lines admits it', (tester) async {
      serve(order: _groceryOrder('RECEIVED', lines: const <Map<String, dynamic>>[],
          metadata: const <String, dynamic>{}));

      await pumpStatus(tester, orderData: _handedOrder);

      expect(stubSaw('GET', _orderPath), isTrue);
      expect(find.textContaining('No order lines are in this read'), findsOneWidget);
      expect(find.text('Step 1 of 7'), findsOneWidget);
      // The address was absent from metadata, so nothing is drawn for it.
      expect(find.textContaining('Hrupthai'), findsNothing);
    });
  });

  group('what the read does not carry', () {
    testWidgets('no rider, no OTP, no ETA, no distance, no rating', (tester) async {
      await pumpStatus(tester, orderData: _handedOrder);

      expect(stubSaw('GET', _orderPath), isTrue);
      for (final String claim in <String>[
        'ETA',
        'Arriving in',
        'minutes away',
        'Out for delivery in',
        'Rider:',
        'Driver:',
        'OTP',
        '★',
        'km away',
        'Deepak Kumar',
        '+91 98765',
      ]) {
        expect(find.textContaining(claim), findsNothing, reason: '$claim has no source');
      }
    });

    testWidgets('the gap is stated instead of filled', (tester) async {
      await pumpStatus(tester, orderData: _handedOrder);

      expect(find.text('Store, rider and arrival time'), findsOneWidget);
      expect(
        find.textContaining('no store name, rider, vehicle, phone number, live position'),
        findsOneWidget,
      );
    });

    testWidgets('no restaurant vocabulary anywhere', (tester) async {
      await pumpStatus(tester, orderData: _handedOrder);

      expect(stubSaw('GET', _orderPath), isTrue);
      for (final String word in <String>[
        'restaurant',
        'Restaurant',
        'chef',
        'Chef',
        'kitchen',
        'Kitchen',
        'cooked',
        'Cooking',
        'dish',
        'Dish',
      ]) {
        for (final Text t in tester.widgetList<Text>(find.byType(Text))) {
          expect(t.data ?? '', isNot(contains(word)),
              reason: '"$word" is food vocabulary; this is a grocery order');
        }
      }
    });

    testWidgets('the stage list is labelled as written by the store', (tester) async {
      await pumpStatus(tester, orderData: _handedOrder);

      expect(find.text('Order stages'), findsOneWidget);
      expect(find.textContaining('not simulated here'), findsOneWidget);
    });
  });

  group('a food order on the grocery screen', () {
    testWidgets('says it is not a grocery order', (tester) async {
      serve(order: _groceryOrder('PREPARING')..['service_type'] = 'FOOD');

      await pumpStatus(tester, orderData: _handedOrder);

      expect(stubSaw('GET', _orderPath), isTrue);
      expect(find.textContaining('not a grocery order'), findsOneWidget);
      expect(find.textContaining('Picking your items'), findsNothing);
    });
  });

  group('wide layout', () {
    testWidgets('834 px keeps the same real content, in a centred column', (tester) async {
      await pumpStatus(tester, orderData: _handedOrder, width: 834, height: 1400);

      expect(stubSaw('GET', _orderPath), isTrue);
      expect(find.text('Reli rice'), findsOneWidget);
      // The fixture's single line totals the same 290 the order does, so the money
      // appears as both a line and a total — present at 834 px is the point.
      expect(find.text('₹290'), findsWidgets);
      expect(find.text('Step 1 of 7'), findsOneWidget);
      // The reading column stays bounded instead of stretching a card across 834 px.
      final double widestText = tester
          .widgetList<Text>(find.byType(Text))
          .map((t) => tester.getRect(find.byWidget(t)).width)
          .fold<double>(0, (a, b) => a > b ? a : b);
      expect(widestText, lessThan(800));
    });
  });
}
