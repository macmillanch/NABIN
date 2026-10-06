import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/features/grocery/presentation/models/grocery_product.dart';
import 'package:mobile/features/grocery/presentation/providers/grocery_cart_provider.dart';
import 'package:mobile/features/grocery/presentation/screens/grocery_checkout_screen.dart';

import 'support/http_stub.dart';

// The grocery journey had no terminal: the write succeeded and the screen just
// sat there. Its bill also carried an invented delivery fee and handling fee, the
// coupon field matched two hard-coded strings locally, the address was a
// pre-selected sample flat, and the payment picker offered a wallet debit no
// request performs.
//
// Two channels are real here: `POST /api/promotions/apply` (the code's name and
// discount) and `POST /api/grocery/checkout/validate` (the order write, which
// re-reads stock and prices at the store and returns the recorded order).

const String _addressHint = 'House / flat, street or area, Aizawl';
const String _couponHint = 'Enter coupon code';
const String _storeId = 'str_sakthi_nagar';

/// One store, 2 × ₹160 = ₹320 — the shape `GroceryCartItem.toLineJson()` writes.
List<Map<String, dynamic>> _lines() => <Map<String, dynamic>>[
      <String, dynamic>{
        'id': 'gro_sakthi_reli_01',
        'name': 'Reli rice',
        'price': 160.0,
        'quantity': 2,
        'unit': 'kg',
        'packSize': '1kg',
        'merchantId': _storeId,
        'emoji': '🍚',
        'bgColor': null,
      },
    ];

const GroceryProduct _product = GroceryProduct(
  id: 'gro_sakthi_reli_01',
  name: 'Reli rice',
  currentPrice: 160.0,
  mrp: 180.0,
  isAvailable: true,
  stockQty: 40,
  unit: 'kg',
  packSize: '1kg',
  merchantId: _storeId,
  emoji: '🍚',
);

num _serverDiscount = 30;
bool _couponApplies = true;
Map<String, dynamic>? _validateReply;

void serve() {
  _serverDiscount = 30;
  _couponApplies = true;
  _validateReply = <String, dynamic>{
    'success': true,
    'order': <String, dynamic>{
      'order_number': 'ORD-GR-2026-0142',
      'status': 'PENDING_ACCEPTANCE',
      'finalTotal': 290,
      'discount': 30,
      'appliedPromo': <String, dynamic>{'code': 'SUITECODE'},
      'items': <Map<String, dynamic>>[
        <String, dynamic>{
          'productName': 'Reli rice',
          'quantity': 2,
          'unit': 'kg',
          'finalItemAmount': 290,
        },
      ],
    },
  };
  stubHandler = (method, url, body) {
    if (url.path.contains('/promotions/apply')) {
      if (!_couponApplies) {
        return (
          400,
          jsonEncode(<String, dynamic>{
            'success': false,
            'error': 'That code is not running on grocery orders.',
          })
        );
      }
      return (
        200,
        jsonEncode(<String, dynamic>{
          'success': true,
          'code': 'SUITECODE',
          'name': 'Suite offer',
          'discount': _serverDiscount,
        })
      );
    }
    if (url.path.contains('/grocery/checkout/validate')) {
      return (200, jsonEncode(_validateReply!));
    }
    return (200, '{"success":true}');
  };
}

Future<void> pumpCheckout(
  WidgetTester tester, {
  ProviderContainer? container,
  List<Map<String, dynamic>>? cartItems,
  int subtotal = 320,
  int deliveryFee = 0,
  int handlingFee = 0,
}) async {
  // Tall enough that the bottom sheet, the bill and the payment card all build.
  tester.view.physicalSize = const Size(390 * 3, 2200 * 3);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final router = GoRouter(
    initialLocation: '/grocery-checkout',
    routes: <RouteBase>[
      GoRoute(
        path: '/grocery-checkout',
        builder: (context, state) => GroceryCheckoutScreen(
          cartItems: cartItems ?? _lines(),
          subtotal: subtotal,
          deliveryFee: deliveryFee,
          handlingFee: handlingFee,
        ),
      ),
      GoRoute(
        path: '/activity',
        builder: (context, state) => const Text('ACTIVITY SCREEN'),
      ),
      GoRoute(
        path: '/grocery-home',
        builder: (context, state) => const Text('GROCERY HOME'),
      ),
    ],
  );

  final Widget app = MaterialApp.router(routerConfig: router);
  await tester.pumpWidget(container == null
      ? ProviderScope(child: app)
      : UncontrolledProviderScope(container: container, child: app));
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

/// The input whose decoration carries [hint] — hint text only paints while the
/// field is empty, which is exactly when it has to be found.
Finder fieldByHint(String hint) =>
    find.ancestor(of: find.text(hint), matching: find.byType(TextField));

Future<void> typeAddress(WidgetTester tester,
    {String value = 'Tuiklani, Aizawl • House 12'}) async {
  await tester.enterText(fieldByHint(_addressHint), value);
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

Future<void> flushSnackBars(WidgetTester tester) async {
  // A toast runs a four-second dismissal timer, and while it is painted it sits
  // over the bottom sheet and swallows the tap meant for the Place order button.
  await tester.pump(const Duration(seconds: 6));
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

Future<void> applyCoupon(WidgetTester tester, {String code = 'suitecode'}) async {
  await tester.enterText(fieldByHint(_couponHint), code);
  await tester.tap(find.text('Apply'));
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
  await flushSnackBars(tester);
}

Future<void> placeOrder(WidgetTester tester) async {
  await tester.tap(find.text('Place order'));
  for (var i = 0; i < 14; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

Map<String, dynamic> checkoutBody() {
  final raw = stubBodyFor('POST', '/grocery/checkout/validate');
  return raw == null
      ? <String, dynamic>{}
      : Map<String, dynamic>.from(jsonDecode(raw) as Map);
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    serve();
    SessionManager.instance.saveSession(
      token: 'test-token',
      user: <String, dynamic>{
        'id': 'usr_real_42',
        'name': 'Lalthanmawli Vanminuwa',
        'phone': '+919862012345',
      },
    );
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
  });

  group('the bill', () {
    testWidgets('adds no fee this app made up', (tester) async {
      await pumpCheckout(tester);

      expect(find.text('Delivery fee'), findsNothing);
      expect(find.text('Handling fee'), findsNothing);
      expect(find.textContaining('GST'), findsNothing);
      expect(find.text('Items subtotal'), findsOneWidget);
    });

    testWidgets('renders a fee only when a caller supplied one', (tester) async {
      await pumpCheckout(tester, deliveryFee: 25, handlingFee: 10);

      expect(find.text('Delivery fee'), findsOneWidget);
      expect(find.text('Handling fee'), findsOneWidget);
      expect(
        find.descendant(
          of: find.ancestor(
              of: find.text('Estimated to pay'), matching: find.byType(Row)),
          matching: find.text('₹355'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('says the store sets its own charges', (tester) async {
      await pumpCheckout(tester);

      expect(find.textContaining('The store re-reads every price'),
          findsOneWidget);
      expect(find.textContaining('it takes no payment'), findsOneWidget);
    });
  });

  group('the tip', () {
    testWidgets('is chosen, never pre-selected', (tester) async {
      await pumpCheckout(tester);

      expect(find.text('No tip'), findsOneWidget);
      expect(find.textContaining('The order record has no tip field'),
          findsOneWidget);
    });

    testWidgets('stays out of the payable it quotes', (tester) async {
      await pumpCheckout(tester);
      await tester.tap(find.text('₹30'));
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(find.text('Tip for the partner (not on the order)'), findsOneWidget);
      expect(
        find.descendant(
          of: find.ancestor(
              of: find.text('Estimated to pay'), matching: find.byType(Row)),
          matching: find.text('₹320'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.ancestor(
              of: find.text('ESTIMATED TOTAL'), matching: find.byType(Column)),
          matching: find.text('₹320'),
        ),
        findsOneWidget,
      );
    });
  });

  group('the coupon', () {
    testWidgets('is checked by the platform, not by this screen',
        (tester) async {
      await pumpCheckout(tester);
      await applyCoupon(tester);

      expect(stubSaw('POST', '/promotions/apply'), isTrue);
      final body =
          jsonDecode(stubBodyFor('POST', '/promotions/apply') ?? '{}')
              as Map<String, dynamic>;
      expect(body['code'], 'SUITECODE');
      expect(body['service'], 'GROCERY');
      expect(body['orderAmount'], 320.0);
    });

    testWidgets('paints the server\'s own saving into the bill',
        (tester) async {
      await pumpCheckout(tester);
      await applyCoupon(tester);

      expect(find.textContaining('Coupon "SUITECODE" Applied!'), findsOneWidget);
      expect(find.text('Saved ₹30 on this order'), findsOneWidget);
      expect(find.text('Coupon savings'), findsOneWidget);
      expect(
        find.descendant(
          of: find.ancestor(
              of: find.text('ESTIMATED TOTAL'), matching: find.byType(Column)),
          matching: find.text('₹290'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('prints the refusal the platform gave', (tester) async {
      _couponApplies = false;
      await pumpCheckout(tester);
      await applyCoupon(tester);

      expect(find.text('That code is not running on grocery orders.'),
          findsOneWidget);
      expect(find.text('Coupon savings'), findsNothing);
    });
  });

  group('the address', () {
    testWidgets('starts empty and blocks the write', (tester) async {
      await pumpCheckout(tester);

      final button = tester.widget<ElevatedButton>(
          find.widgetWithText(ElevatedButton, 'Type the address first'));
      expect(button.onPressed, isNull);
      expect(find.textContaining('Saved addresses are not available for grocery'),
          findsOneWidget);
      expect(find.textContaining('Kamalanagar'), findsNothing);
      expect(find.textContaining('Delhi'), findsNothing);
      expect(find.textContaining('Default Address'), findsNothing);
    });

    testWidgets('is the typed value once typed', (tester) async {
      await pumpCheckout(tester);
      await typeAddress(tester, value: 'Chanmari, Aizawl • Near Hospital Gate');
      await placeOrder(tester);

      expect(stubSaw('POST', '/grocery/checkout/validate'), isTrue);
      expect(checkoutBody()['deliveryAddress'],
          'Chanmari, Aizawl • Near Hospital Gate');
    });
  });

  group('the order write', () {
    testWidgets('sends the code and none of the screen\'s own money',
        (tester) async {
      await pumpCheckout(tester);
      await typeAddress(tester);
      await applyCoupon(tester);
      await placeOrder(tester);

      expect(stubSaw('POST', '/grocery/checkout/validate'), isTrue);
      final body = checkoutBody();
      expect(body['merchantId'], _storeId);
      expect(body['couponCode'], 'SUITECODE');
      expect(body['paymentMethod'], 'CASH');
      expect(body.containsKey('discount'), isFalse);
      expect(body.containsKey('finalTotal'), isFalse);
      expect(body.containsKey('tip'), isFalse);
      expect(body.containsKey('subtotal'), isFalse);
      expect(body['customerId'], isNull);
      final line = (body['cartItems'] as List).first as Map<String, dynamic>;
      expect(line['productId'], 'gro_sakthi_reli_01');
      expect(line['unitPrice'], 160.0);
      expect(line['quantity'], 2);
    });

    testWidgets('refuses a basket that spans two stores', (tester) async {
      await pumpCheckout(
        tester,
        cartItems: <Map<String, dynamic>>[
          ..._lines(),
          <String, dynamic>{
            'id': 'gro_other_store_02',
            'name': 'Aizawl honey',
            'price': 220.0,
            'quantity': 1,
            'unit': 'jar',
            'packSize': '500g',
            'merchantId': 'str_another_store',
            'emoji': '🍯',
            'bgColor': null,
          },
        ],
        subtotal: 540,
      );
      await typeAddress(tester);
      await placeOrder(tester);

      expect(stubSaw('POST', '/grocery/checkout/validate'), isFalse);
      expect(find.textContaining('more than one store'), findsOneWidget);
      await flushSnackBars(tester);
    });

    testWidgets('clears the basket so lines cannot be placed twice',
        (tester) async {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      container
          .read(groceryCartProvider.notifier)
          .add(_product, quantity: 2);
      expect(container.read(groceryCartProvider).isEmpty, isFalse);

      await pumpCheckout(
        tester,
        container: container,
        cartItems: container.read(groceryCartProvider).checkoutLines,
        subtotal: container.read(groceryCartProvider).subtotalRupees,
      );
      await typeAddress(tester);
      await placeOrder(tester);

      expect(container.read(groceryCartProvider).isEmpty, isTrue);
    });
  });

  group('the confirmation terminal', () {
    testWidgets('prints the order the platform wrote back', (tester) async {
      await pumpCheckout(tester);
      await typeAddress(tester);
      await placeOrder(tester);

      expect(find.text('Order ORD-GR-2026-0142 is with the store'),
          findsOneWidget);
      expect(find.text('Recorded stage: PENDING_ACCEPTANCE'), findsOneWidget);
      expect(find.text('Lines the store recorded'), findsOneWidget);
      expect(find.text('Total on the order'), findsOneWidget);
      expect(find.text('Coupon SUITECODE'), findsOneWidget);
      expect(find.text('-₹30'), findsOneWidget);
    });

    testWidgets('claims no confirmation the store has not given',
        (tester) async {
      await pumpCheckout(tester);
      await typeAddress(tester);
      await placeOrder(tester);

      expect(find.textContaining('Order Confirmed!'), findsNothing);
      expect(find.textContaining('arriving in'), findsNothing);
      expect(find.textContaining('The store confirms the final amount'),
          findsOneWidget);
      expect(find.textContaining('Nothing was paid here'), findsOneWidget);
    });

    testWidgets('leaves to somewhere that reads the order back', (tester) async {
      await pumpCheckout(tester);
      await typeAddress(tester);
      await placeOrder(tester);

      await tester.tap(find.text('View in Activity'));
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }
      expect(find.text('ACTIVITY SCREEN'), findsOneWidget);
    });

    testWidgets('says so when the record came back without a stage',
        (tester) async {
      _validateReply = <String, dynamic>{
        'success': true,
        'order': <String, dynamic>{'finalTotal': 320},
      };
      await pumpCheckout(tester);
      await typeAddress(tester);
      await placeOrder(tester);

      expect(find.text('The store has your order'), findsOneWidget);
      expect(find.text('The record came back without a stage.'), findsOneWidget);
      expect(find.text('Lines the store recorded'), findsNothing);
    });
  });

  group('payment', () {
    testWidgets('offers no instrument this app cannot charge', (tester) async {
      await pumpCheckout(tester);

      expect(find.text('NABIN Wallet'), findsNothing);
      expect(find.text('Google Pay'), findsNothing);
      expect(find.text('PayZapp'), findsNothing);
      expect(find.text('Cash on Delivery'), findsNothing);
      expect(find.byType(Radio<String>), findsNothing);
      expect(find.textContaining('NABIN takes no payment in this app yet'),
          findsOneWidget);
    });
  });
}
