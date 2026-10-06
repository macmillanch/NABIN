import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/grocery/presentation/models/grocery_product.dart';
import 'package:mobile/features/grocery/presentation/widgets/grocery_product_tile.dart';

import 'support/http_stub.dart';

// 'Deals' at NABIN is a computation, not a campaign.
//
// The backend has no deals, promo, campaign or coupon read path for a customer,
// so this screen's only input is `GET /api/grocery/products` and a deal is a row
// whose `mrp` is above its `currentPrice` and that can still be ordered. The
// version this replaced printed a ticking 'FLASH SALE ENDS IN 03:57:30', three
// hard-coded promo codes, a fixed 'Up to 50% OFF on 200+ items' claim and four
// demo deal cards — none of which any endpoint could have answered for. So this
// file checks the arithmetic against the fixture rows, and checks that none of
// the invented copy came back.

Map<String, dynamic> _row({
  required String id,
  required String name,
  required double price,
  double? mrp,
  bool available = true,
  num stock = 30,
  String category = 'Staples',
  String emoji = '🛒',
}) =>
    <String, dynamic>{
      'id': id,
      'name': name,
      'category': category,
      'emoji': emoji,
      'currentPrice': price,
      if (mrp != null) 'mrp': mrp,
      'isAvailable': available,
      'stockQty': stock,
      'unit': 'kg',
      'packSize': '1kg',
      'merchantId': 'str_test_store',
      'merchantName': 'Test Store',
    };

/// Four genuine drops (₹20 + ₹20 + ₹6 + ₹12 saved, best 25%), one row at MRP,
/// one discounted row the store cannot supply, and one delisted row.
final List<Map<String, dynamic>> _catalogue = <Map<String, dynamic>>[
  _row(id: 'p1', name: 'Seaul Flattene rice', price: 160, mrp: 180, category: 'Staples', emoji: '🍚'),
  _row(id: 'p2', name: 'Atta', price: 248, mrp: 260, category: 'Staples', emoji: '🌾'),
  _row(id: 'p3', name: 'Eggs', price: 84, mrp: 90, category: 'Dairy', emoji: '🥚'),
  _row(id: 'p4', name: 'Milk', price: 34, mrp: 34, category: 'Dairy', emoji: '🥛'),
  _row(id: 'p5', name: 'Banana', price: 60, mrp: 80, category: 'Fruits', emoji: '🍌'),
  _row(id: 'p6', name: 'Tomato', price: 40, mrp: 40, category: 'Vegetables', emoji: '🍅', available: false, stock: 0),
  _row(id: 'p8', name: 'Chilli oil', price: 90, mrp: 120, category: 'Staples', emoji: '🌶️', stock: 0),
];

void serveGrocery({List<Map<String, dynamic>>? rows, bool fail = false}) {
  final List<Map<String, dynamic>> source = rows ?? _catalogue;
  stubHandler = (method, url, _) {
    if (url.path.contains('/grocery/products')) {
      if (fail) {
        return (500, '{"success":false,"error":"The grocery catalogue is offline."}');
      }
      return (200, jsonEncode({'success': true, 'products': source}));
    }
    return (200, '{"success":true}');
  };
}

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 14; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

Future<void> pumpDeals(
  WidgetTester tester, {
  String route = '/grocery-deals',
  Size logicalSize = const Size(393, 852),
}) async {
  tester.view.physicalSize = logicalSize * 3;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  appRouter.go('/');
  await tester.pumpWidget(
    ProviderScope(child: MaterialApp.router(routerConfig: appRouter)),
  );
  await settle(tester);
  stubSeen.clear();
  appRouter.go(route);
  await settle(tester);
}

/// The rows in the order the grid lays them out.
List<String> tileNames(WidgetTester tester) => tester
    .widgetList<GroceryProductTile>(find.byType(GroceryProductTile))
    .map((GroceryProductTile tile) => tile.product.name)
    .toList();

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    serveGrocery();
  });

  tearDown(() {
    HttpOverrides.global = null;
  });

  testWidgets('the drops come from the catalogue read and no deals endpoint',
      (WidgetTester tester) async {
    await pumpDeals(tester);

    expect(stubSaw('GET', '/grocery/products'), isTrue);
    // There is nothing to call: the backend serves no deals, promo or campaign route.
    expect(
      stubSeen.where((String s) =>
          s.contains('deal') || s.contains('promo') || s.contains('campaign') || s.contains('coupon')),
      isEmpty,
    );
    expect(find.text('Daily price drops'), findsOneWidget);
    expect(find.text('Listed price below MRP right now'), findsOneWidget);
  });

  testWidgets('the header quotes the deepest drop and the total of these rows',
      (WidgetTester tester) async {
    await pumpDeals(tester);

    // Banana 60/80 is the deepest: (80-60)/80 = 25%.
    expect(find.text('Up to 25% below MRP'), findsOneWidget);
    // Four orderable drops, savings 20 + 20 + 6 + 12.
    expect(
      find.text('4 listed items — buying all of them once would save ₹58 against MRP.'),
      findsOneWidget,
    );
    expect(find.textContaining('Up to 50% OFF on 200+ items'), findsNothing);
  });

  testWidgets('only listed rows below MRP are deals, and they sort deepest first',
      (WidgetTester tester) async {
    await pumpDeals(tester);

    expect(
      tileNames(tester),
      <String>['Banana', 'Seaul Flattene rice', 'Eggs', 'Atta'],
      reason: 'discountPercent desc, then savings desc — computed, not server-ordered',
    );
    // At MRP, delisted, and discounted-but-zero-stock are all not deals.
    expect(find.text('Milk'), findsNothing);
    expect(find.text('Tomato'), findsNothing);
    expect(find.text('Chilli oil'), findsNothing);
  });

  testWidgets('a deal card carries its own row and nothing more',
      (WidgetTester tester) async {
    await pumpDeals(tester);

    final Finder banana = find.ancestor(
      of: find.text('Banana'),
      matching: find.byType(GroceryProductTile),
    );
    expect(find.descendant(of: banana, matching: find.text('₹60')), findsOneWidget);
    expect(find.descendant(of: banana, matching: find.text('₹80')), findsOneWidget);
    expect(find.descendant(of: banana, matching: find.text('25% OFF')), findsOneWidget);
    // The store line is real: merchantName rides on the row.
    expect(find.descendant(of: banana, matching: find.text('Test Store')), findsOneWidget);
    // And nothing the payload lacks.
    expect(find.textContaining('4.8'), findsNothing);
    expect(find.textContaining('/5'), findsNothing);
    expect(find.textContaining('Delivery in'), findsNothing);
    expect(find.textContaining('ratings'), findsNothing);
  });

  testWidgets('the invented sale is gone: no countdown, no promo codes, no demo cards',
      (WidgetTester tester) async {
    await pumpDeals(tester);

    for (final String ghost in <String>[
      'FLASH SALE',
      'ENDS IN',
      '03:57',
      'M3FRESH',
      'M3SUPER50',
      'M3SNACKS',
      'Avocado',
      'Blueberry',
      'Coupon code',
      'Minimum order',
    ]) {
      expect(find.textContaining(ghost), findsNothing, reason: '$ghost was never backed by data');
    }
    // Nothing is counting down, so no time-shaped string may appear.
    expect(find.textContaining(RegExp(r'\d{2}:\d{2}:\d{2}')), findsNothing);
  });

  testWidgets('a catalogue with no drops says so instead of showing a sale',
      (WidgetTester tester) async {
    serveGrocery(rows: <Map<String, dynamic>>[
      _row(id: 'p4', name: 'Milk', price: 34, mrp: 34, category: 'Dairy', emoji: '🥛'),
      _row(id: 'p6', name: 'Tomato', price: 40, category: 'Vegetables', emoji: '🍅', available: false, stock: 0),
    ]);
    await pumpDeals(tester);

    expect(stubSaw('GET', '/grocery/products'), isTrue);
    expect(find.text('Nothing is discounted right now'), findsOneWidget);
    expect(
      find.text('No listed product has a selling price below its list price right now.'),
      findsOneWidget,
    );
    // No drops, so no 'Up to 0%' claim and no ₹0 total.
    expect(find.textContaining('Up to'), findsNothing);
    expect(find.textContaining('buying all of them'), findsNothing);
  });

  testWidgets('a failed read is an error with a retry, not an empty sale',
      (WidgetTester tester) async {
    serveGrocery(fail: true);
    await pumpDeals(tester);

    expect(find.text('These items could not be loaded'), findsOneWidget);
    expect(find.text('The grocery catalogue is offline.'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    expect(find.text('Nothing is discounted right now'), findsNothing);
    // The branch this screen carries for a null catalogue value is unreachable —
    // loading paints a skeleton and an error paints the sentence above. Pinning
    // its absence keeps the dead copy from ever becoming a live claim.
    expect(find.text('The catalogue could not be read'), findsNothing);
  });

  testWidgets('ADD charges the row at its live price and says which cart',
      (WidgetTester tester) async {
    await pumpDeals(tester);
    await tester.tap(find.text('ADD').first);
    await settle(tester);

    expect(find.text('1 item in basket'), findsOneWidget);
    expect(find.text('VIEW BASKET'), findsOneWidget);
    // The route this screen is reachable at owns the wording, and it is not the
    // shell's 'Grocery Cart' — two different names for one basket.
    expect(find.text('Added "Banana" to Cart!'), findsOneWidget);
    final GroceryProduct added = tester
        .widgetList<GroceryProductTile>(find.byType(GroceryProductTile))
        .firstWhere((GroceryProductTile t) => t.product.name == 'Banana')
        .product;
    expect(added.currentPrice, 60);
  });

  testWidgets('the grid holds at phone and tablet widths', (WidgetTester tester) async {
    for (final Size size in <Size>[const Size(393, 852), const Size(834, 1112)]) {
      await pumpDeals(tester, logicalSize: size);
      expect(find.text('Daily price drops'), findsOneWidget);
      expect(tileNames(tester), hasLength(4));
      expect(find.text('Chilli oil'), findsNothing);
      expect(tester.takeException(), isNull, reason: 'overflow at ${size.width}px wide');
    }
  });
}
