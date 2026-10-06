import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/features/food/presentation/screens/food_checkout_screen.dart';

import 'support/http_stub.dart';

// The bill used to be invented here: a ₹25 delivery fee, a ₹15 packaging fee and 5% GST
// added on top of the menu prices, none of which the platform computes for a food order
// (`POST /api/customer/book-food` totals the items and stores that). The coupon field
// matched nothing and the payment picker offered UPI IDs, cards and a wallet debit that
// no request implements. The address was a hard-coded flat.
//
// Three channels are real for this journey: `POST /api/promotions/apply` (the code's name
// and its discount), `POST /api/customer/book-food` (the order write, which redeems the
// code against the prices it re-reads from the store), and `GET /api/customer/orders/:id`
// on the tracking screen the write hands its id to.

const String _restaurantId = 'res_khamarlal_01';
const String _addressHint = 'House / flat, street or area, Aizawl';
const String _couponHint = 'Enter the code the platform issued';

/// The discount `/promotions/apply` reports, and whether it reports one at all.
num _serverDiscount = 50;
bool _couponApplies = true;

/// Set when the request should come back as something that is not a platform
/// answer at all — a gateway page, a truncated body. `applyPromoCoupon` folds any
/// transport or decode failure into `null`, so this is the state where the screen
/// has to say it could not check the code rather than that the code is invalid.
bool _couponReplyIsGarbage = false;
Map<String, dynamic>? _bookReply;

void serve() {
  _serverDiscount = 50;
  _couponApplies = true;
  _couponReplyIsGarbage = false;
  _bookReply = <String, dynamic>{
    'success': true,
    'job': <String, dynamic>{'id': 'ORD-FOOD-2026-0113'},
  };
  stubHandler = (method, url, body) {
    if (url.path.contains('/promotions/apply')) {
      if (_couponReplyIsGarbage) return (502, '<html>Bad gateway</html>');
      if (!_couponApplies) {
        return (
          400,
          jsonEncode(<String, dynamic>{
            'success': false,
            'error': 'That code is not running on food orders.',
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
    if (url.path.contains('/customer/book-food')) {
      return (200, jsonEncode(_bookReply!));
    }
    return (200, '{"success":true}');
  };
}

Map<String, dynamic> _cart({List<Map<String, dynamic>>? items, Object? deliveryMinutes = 35}) =>
    <String, dynamic>{
      'restaurantId': _restaurantId,
      'restaurantName': 'Khamarlal Kitchen, Aizawl',
      // `standard_delivery_minutes` as the integer the menu page forwarded, not a
      // '35-45 min' string this app invented.
      'deliveryMinutes': deliveryMinutes,
      'items': items ??
          <Map<String, dynamic>>[
            <String, dynamic>{
              'id': 'dish_wifi_01',
              'name': 'Wai-e with rice',
              'price': 180,
              'quantity': 2,
            },
          ],
    };

Future<void> pumpCheckout(
  WidgetTester tester, {
  Map<String, dynamic>? cartData,
}) async {
  // Tall viewport so the bill and the payment card are both built — a ListView
  // below the fold never creates its children.
  tester.view.physicalSize = const Size(390 * 3, 2600 * 3);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final router = GoRouter(
    initialLocation: '/checkout',
    routes: <RouteBase>[
      GoRoute(
        path: '/checkout',
        builder: (context, state) =>
            FoodCheckoutScreen(cartData: cartData ?? _cart()),
      ),
      GoRoute(
        path: '/food-tracking',
        builder: (context, state) => const Text('TRACKING SCREEN'),
      ),
    ],
  );
  await tester.pumpWidget(MaterialApp.router(routerConfig: router));
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

/// The input whose decoration carries [hint] — hint text only paints while the
/// field is empty, which is exactly when it has to be found.
Finder fieldByHint(String hint) =>
    find.ancestor(of: find.text(hint), matching: find.byType(TextField));

Future<void> typeAddress(WidgetTester tester,
    {String value = 'Chanmari, Aizawl • Near Hospital Gate'}) async {
  await tester.enterText(fieldByHint(_addressHint), value);
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

Future<void> applyCoupon(WidgetTester tester, {String code = 'suitecode'}) async {
  await tester.enterText(fieldByHint(_couponHint), code);
  await tester.tap(find.text('Apply'));
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

Future<void> placeOrder(WidgetTester tester) async {
  await tester.tap(find.textContaining('Place Order'));
  for (var i = 0; i < 14; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

Map<String, dynamic> bookedBody() {
  final raw = stubBodyFor('POST', '/customer/book-food');
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
    testWidgets('carries no fee this app made up', (tester) async {
      await pumpCheckout(tester);

      expect(find.text('Delivery fee'), findsNothing);
      expect(find.text('Packaging charge'), findsNothing);
      expect(find.textContaining('GST'), findsNothing);
      expect(find.text('Item total (menu prices)'), findsOneWidget);
      expect(find.text('Estimated to pay'), findsOneWidget);
    });

    testWidgets('states the basket at menu price', (tester) async {
      await pumpCheckout(tester);

      // 2 × ₹180 from the menu rows the restaurant serves.
      expect(find.text('₹360'), findsWidgets);
    });

    testWidgets('says the restaurant sets its own charges', (tester) async {
      await pumpCheckout(tester);

      expect(
        find.textContaining('The restaurant re-reads every dish price'),
        findsOneWidget,
      );
    });

    testWidgets('reports only the window the restaurant declared', (tester) async {
      await pumpCheckout(tester);
      // Formatted from the integer the menu page forwarded; no range invented here.
      expect(
        find.text('Delivery time shown at the restaurant: 35 min'),
        findsOneWidget,
      );

      await pumpCheckout(tester, cartData: _cart(deliveryMinutes: null));
      // A restaurant that declared no window leaves the checkout saying the
      // restaurant confirms it, rather than a guessed figure.
      expect(
        find.text('Delivery time is confirmed by the restaurant'),
        findsOneWidget,
      );
    });

    testWidgets('builds nothing when the basket is empty', (tester) async {
      await pumpCheckout(
        tester,
        cartData: _cart(items: <Map<String, dynamic>>[]),
      );

      expect(find.textContaining('Your basket is empty'), findsOneWidget);
      expect(find.textContaining('Add dishes to your basket'), findsOneWidget);
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
      expect(body['service'], 'FOOD');
      expect(body['orderAmount'], 360.0);
    });

    testWidgets('paints the server\'s own saving into the bill',
        (tester) async {
      await pumpCheckout(tester);
      await typeAddress(tester);
      await applyCoupon(tester);

      expect(find.textContaining('SUITECODE'), findsWidgets);
      expect(find.text('-₹50'), findsOneWidget);
      // ₹360 at menu price minus the ₹50 the platform reported.
      expect(find.text('Place Order • ₹310'), findsOneWidget);
    });

    testWidgets('prints the refusal the platform gave', (tester) async {
      _couponApplies = false;
      await pumpCheckout(tester);
      await applyCoupon(tester);

      expect(stubSaw('POST', '/promotions/apply'), isTrue);
      expect(find.text('That code is not running on food orders.'),
          findsOneWidget);
      // Nothing subtracted from the bill.
      expect(find.text('Place Order • ₹360'), findsNothing);
    });

    testWidgets('says it could not check the code when the reply is not an answer',
        (tester) async {
      _couponReplyIsGarbage = true;
      await pumpCheckout(tester);
      await typeAddress(tester);
      await applyCoupon(tester);

      // The request really left, so the message below is about the platform being
      // unreadable — not a verdict the screen reached without asking.
      expect(stubSaw('POST', '/promotions/apply'), isTrue);
      expect(find.text('That code could not be checked right now. Try again.'),
          findsOneWidget);
      // Neither outcome is claimed: no applied chip, and nothing subtracted.
      expect(find.textContaining('applied by the platform'), findsNothing);
      expect(find.text('-₹50'), findsNothing);
      expect(find.text('Place Order • ₹360'), findsOneWidget);
    });

    testWidgets('is undone when the chip is removed', (tester) async {
      await pumpCheckout(tester);
      await typeAddress(tester);
      await applyCoupon(tester);
      await tester.tap(find.byIcon(Icons.close_rounded));
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(find.text('-₹50'), findsNothing);
      expect(find.textContaining('Place Order • ₹360'), findsOneWidget);
    });
  });

  group('the address', () {
    testWidgets('starts empty and blocks the order', (tester) async {
      await pumpCheckout(tester);

      expect(find.textContaining('Type the delivery address first'),
          findsOneWidget);
      expect(find.textContaining('Kamalanagar'), findsNothing);
      expect(find.textContaining('Delhi'), findsNothing);
    });

    testWidgets('is the typed value once typed', (tester) async {
      await pumpCheckout(tester);
      await typeAddress(tester, value: 'Tuiklani, Aizawl • House 12');
      await placeOrder(tester);

      expect(stubSaw('POST', '/customer/book-food'), isTrue);
      expect(bookedBody()['deliveryAddress'], 'Tuiklani, Aizawl • House 12');
    });

    testWidgets('says why it has to be typed', (tester) async {
      await pumpCheckout(tester);

      expect(
        find.textContaining('Saved addresses are not available for food yet'),
        findsOneWidget,
      );
    });
  });

  group('the order write', () {
    testWidgets('sends the code and none of the screen\'s own money',
        (tester) async {
      await pumpCheckout(tester);
      await typeAddress(tester);
      await applyCoupon(tester);
      await placeOrder(tester);

      expect(stubSaw('POST', '/customer/book-food'), isTrue);
      final body = bookedBody();
      expect(body['couponCode'], 'SUITECODE');
      expect(body.containsKey('discount'), isFalse);
      expect(body.containsKey('grandTotal'), isFalse);
      expect(body.containsKey('itemTotal'), isFalse);
      expect(body.containsKey('paymentMethod'), isFalse);
      expect(body['restaurantId'], _restaurantId);
      expect(body['customerId'], 'usr_real_42');
    });

    testWidgets('sends no code when none was applied', (tester) async {
      await pumpCheckout(tester);
      await typeAddress(tester);
      await placeOrder(tester);

      expect(stubSaw('POST', '/customer/book-food'), isTrue);
      expect(bookedBody().containsKey('couponCode'), isFalse);
    });

    testWidgets('hands only the order id to the tracking screen',
        (tester) async {
      await pumpCheckout(tester);
      await typeAddress(tester);
      await placeOrder(tester);

      expect(find.text('TRACKING SCREEN'), findsOneWidget);
    });

    testWidgets('keeps the screen when the platform refuses', (tester) async {
      _bookReply = <String, dynamic>{
        'success': false,
        'error': 'The restaurant is not accepting orders right now.',
      };
      await pumpCheckout(tester);
      await typeAddress(tester);
      await placeOrder(tester);

      expect(stubSaw('POST', '/customer/book-food'), isTrue);
      expect(find.text('TRACKING SCREEN'), findsNothing);
      expect(
        find.text('The restaurant is not accepting orders right now.'),
        findsOneWidget,
      );
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
    });

    testWidgets('states how the order is actually settled', (tester) async {
      await pumpCheckout(tester);

      expect(
        find.textContaining('The restaurant collects the payment when it delivers'),
        findsOneWidget,
      );
    });
  });
}
