import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/grocery/presentation/providers/grocery_products_provider.dart';
import 'package:mobile/features/grocery/presentation/screens/grocery_products_screen.dart';
import 'package:mobile/features/grocery/presentation/widgets/grocery_product_tile.dart';

import 'support/http_stub.dart';

// The product list is the level between the aisles and the leaf: it shows the
// rows `GET /api/grocery/products` returns, and nothing else.
//
// A supermarket app can print a rating, a review count, a delivery ETA and a
// coupon banner on every card. NABIN's grocery payload has no field for any of
// them — `merchant_grocery_inventory` joined to `master_grocery_catalog` carries
// price, MRP, stock, size, brand, aisle, store and an emoji — so this file holds
// the screen to that list twice over: what must be on a card, and what must
// never be.

Map<String, dynamic> _row({
  required String id,
  required String name,
  required String category,
  required String emoji,
  required double price,
  required double mrp,
  bool available = true,
  num stock = 30,
  String? brand,
}) =>
    <String, dynamic>{
      'id': id,
      'name': name,
      'category': category,
      'emoji': emoji,
      'currentPrice': price,
      'mrp': mrp,
      'isAvailable': available,
      'stockQty': stock,
      'unit': 'kg',
      'packSize': '1kg',
      'merchantId': 'str_test_store',
      'merchantName': 'Test Store',
      if (brand != null) 'brand': brand,
    };

/// Four aisles, six rows: two discounted, one at MRP, one out of stock, one not
/// listed at all. Every derived number the screen prints can be checked against
/// these rows by hand.
final List<Map<String, dynamic>> _catalogue = <Map<String, dynamic>>[
  _row(id: 'p1', name: 'Seaul Flattene rice', category: 'Staples', emoji: '🍚', price: 160, mrp: 180, brand: 'Vanthral Mills'),
  _row(id: 'p2', name: 'Atta', category: 'Staples', emoji: '🌾', price: 248, mrp: 260),
  _row(id: 'p3', name: 'Eggs', category: 'Dairy', emoji: '🥚', price: 84, mrp: 90, stock: 4),
  _row(id: 'p4', name: 'Milk', category: 'Dairy', emoji: '🥛', price: 34, mrp: 34),
  _row(id: 'p5', name: 'Banana', category: 'Fruits', emoji: '🍌', price: 60, mrp: 80),
  _row(id: 'p6', name: 'Tomato', category: 'Vegetables', emoji: '🍅', price: 40, mrp: 40, available: false, stock: 0),
];

/// Serves the real endpoint contract: the stub filters, because the screen must
/// not. A row the response does not carry cannot appear in the list.
void serveGrocery({List<Map<String, dynamic>>? rows, bool fail = false}) {
  final List<Map<String, dynamic>> source = rows ?? _catalogue;
  stubHandler = (method, url, _) {
    if (url.path.contains('/grocery/products')) {
      if (fail) {
        return (500, '{"success":false,"error":"The grocery catalogue is offline."}');
      }
      final String? category = url.queryParameters['category'];
      final String? search = url.queryParameters['search'];
      final List<Map<String, dynamic>> out = source
          .where((Map<String, dynamic> r) => category == null || r['category'] == category)
          .where((Map<String, dynamic> r) => search == null ||
              (r['name'] as String).toLowerCase().contains(search.toLowerCase()))
          .toList();
      return (200, jsonEncode({'success': true, 'products': out}));
    }
    return (200, '{"success":true}');
  };
}

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 14; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

Future<void> pumpList(
  WidgetTester tester, {
  String route = '/grocery-products',
  Size logicalSize = const Size(393, 852),
}) async {
  tester.view.physicalSize = logicalSize * 3;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  // The router is a global, so it is still parked on the previous test's route.
  // Mounting the tree there would build that screen in this new scope and spend
  // its only load before the log is emptied — and `go` back to the same path
  // reuses the element, so `initState` never runs again and the route's own
  // category would be silently dropped. Park on welcome first, mount, then arrive.
  appRouter.go('/');
  await tester.pumpWidget(
    ProviderScope(child: MaterialApp.router(routerConfig: appRouter)),
  );
  await settle(tester);
  stubSeen.clear();
  appRouter.go(route);
  await settle(tester);
}

/// The aisles the screen offers, read from the same provider the chips use.
List<String> categoriesOf(WidgetTester tester) =>
    ProviderScope.containerOf(tester.element(find.byType(GroceryProductsScreen)))
        .read(groceryCategoriesProvider);

/// A card's own text. Scoped because the search box holds the same word.
Finder _onCard(WidgetTester tester, String text) => find.descendant(
      of: find.byType(GroceryProductTile),
      matching: find.text(text),
    );

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    serveGrocery();
  });

  tearDown(() {
    HttpOverrides.global = null;
  });

  testWidgets('the list is read before the header quotes a count', (WidgetTester tester) async {
    await pumpList(tester);
    expect(stubSaw('GET', '/grocery/products'), isTrue);
    expect(find.text('All products'), findsOneWidget);
    // Six rows came back, so six is the number printed. Not a page size, not a
    // catalogue total the endpoint never sent.
    expect(find.text('6 items from NABIN merchants'), findsOneWidget);
    expect(find.text('Seaul Flattene rice'), findsOneWidget);
    expect(find.text('Atta'), findsOneWidget);
    expect(find.text('Eggs'), findsOneWidget);
  });

  testWidgets('a card carries price, MRP and size from its own row, and nothing else',
      (WidgetTester tester) async {
    await pumpList(tester);
    await tester.enterText(find.byType(TextField), 'Banana');
    await tester.pump(const Duration(milliseconds: 350));
    await settle(tester);

    // Scoped to the card: the search box is holding the same word.
    expect(_onCard(tester, 'Banana'), findsOneWidget);
    expect(_onCard(tester, '₹60'), findsOneWidget);
    expect(_onCard(tester, '₹80'), findsOneWidget);
    expect(_onCard(tester, '1kg • kg'), findsOneWidget);
    expect(_onCard(tester, '25% OFF'), findsOneWidget);

    // The rest of a supermarket card. The grocery payload has no field behind
    // any of them, so none of them may be drawn.
    expect(find.byIcon(Icons.star_rounded), findsNothing);
    expect(find.byIcon(Icons.star), findsNothing);
    expect(find.textContaining('4.8'), findsNothing);
    expect(find.textContaining('/5'), findsNothing);
    expect(find.textContaining(RegExp('rating|review', caseSensitive: false)), findsNothing);
    expect(find.textContaining('Delivery in'), findsNothing);
    expect(find.textContaining('minutes'), findsNothing);
    expect(find.textContaining(RegExp('coupon', caseSensitive: false)), findsNothing);
  });

  testWidgets('the aisles offered are exactly the aisles the rows declare',
      (WidgetTester tester) async {
    await pumpList(tester);
    // Derived from the `category` of the returned rows, sorted — not a static
    // aisle list from a demo app.
    expect(categoriesOf(tester), <String>['Dairy', 'Fruits', 'Staples', 'Vegetables']);
    expect(find.text('All'), findsOneWidget);
    for (final String aisle in <String>['Dairy', 'Fruits', 'Staples']) {
      expect(find.text(aisle), findsOneWidget);
    }
    // An aisle the store never declared.
    expect(find.text('Snacks'), findsNothing);
    expect(find.text('Instant'), findsNothing);
  });

  testWidgets('choosing an aisle filters through the endpoint, not in memory',
      (WidgetTester tester) async {
    await pumpList(tester);
    stubSeen.clear();
    await tester.tap(find.text('Staples'));
    await settle(tester);

    expect(stubSaw('GET', 'category=Staples'), isTrue);
    // Chip plus the header title that names the active filter.
    expect(find.text('Staples'), findsNWidgets(2));
    expect(find.text('2 items from NABIN merchants'), findsOneWidget);
    // The other aisles' rows are gone because the response dropped them.
    expect(find.text('Eggs'), findsNothing);
    expect(find.text('Banana'), findsNothing);
  });

  testWidgets('a route category reaches the endpoint as the same param',
      (WidgetTester tester) async {
    await pumpList(tester, route: '/grocery-products?category=Vegetables');

    expect(stubSaw('GET', 'category=Vegetables'), isTrue);
    expect(find.text('Vegetables'), findsWidgets);
    expect(find.text('1 item from NABIN merchants'), findsOneWidget);
    expect(find.text('Tomato'), findsOneWidget);
    expect(find.text('Milk'), findsNothing);
    // A row the store does not list for order says so on the control instead of
    // offering an ADD that would fail later.
    expect(find.text('Not listed'), findsOneWidget);
    expect(find.text('ADD'), findsNothing);
  });

  testWidgets('search runs on the live catalogue and clearing it ends the query',
      (WidgetTester tester) async {
    await pumpList(tester);
    stubSeen.clear();

    await tester.enterText(find.byType(TextField), 'Banana');
    await tester.pump(const Duration(milliseconds: 350));
    await settle(tester);
    expect(stubSaw('GET', 'search=Banana'), isTrue);
    expect(find.text('1 item from NABIN merchants'), findsOneWidget);
    expect(find.text('Atta'), findsNothing);

    await tester.tap(find.byIcon(Icons.close_rounded));
    // Only what left after the clear counts — the `search=Banana` request above
    // is in the same log.
    stubSeen.clear();
    await settle(tester);
    final List<String> afterClear =
        stubSeen.where((String s) => s.contains('/grocery/products')).toList();
    expect(afterClear, isNotEmpty);
    expect(afterClear.any((String s) => s.contains('search=')), isFalse);
    expect(find.text('6 items from NABIN merchants'), findsOneWidget);
  });

  testWidgets('sorting re-orders the rows already returned and asks for nothing new',
      (WidgetTester tester) async {
    await pumpList(tester);
    final int mark = stubSeen.length;

    await tester.tap(find.byIcon(Icons.sort_rounded));
    // The menu slides in on its own animation; tapping before it lands hits the
    // overlay behind the item instead of the item.
    await tester.pumpAndSettle();
    await tester.tap(find.text('Price: low to high'));
    await settle(tester);

    // Honest about its own scope: the backend exposes no sort.
    expect(find.text('Sorted by Price: low to high (these results only)'), findsOneWidget);
    expect(stubSeen.length, mark);
    expect(find.text('6 items from NABIN merchants'), findsOneWidget);
    expect(
        tester.getTopLeft(find.text('Milk')).dy,
        lessThan(tester.getTopLeft(find.text('Eggs')).dy));
  });

  testWidgets('an empty answer is a different sentence from a failed one',
      (WidgetTester tester) async {
    await pumpList(tester);
    await tester.enterText(find.byType(TextField), 'Ziro');
    await tester.pump(const Duration(milliseconds: 350));
    await settle(tester);

    expect(stubSaw('GET', 'search=Ziro'), isTrue);
    expect(find.text('No products match “Ziro”'), findsOneWidget);
    expect(
        find.text('The search runs against the live NABIN catalogue, so try a shorter word or clear the filter.'),
        findsOneWidget);
    expect(find.text('These items could not be loaded'), findsNothing);
  });

  testWidgets('a failed read is an error with a retry, not an empty aisle',
      (WidgetTester tester) async {
    serveGrocery(fail: true);
    await pumpList(tester);

    expect(stubSaw('GET', '/grocery/products'), isTrue);
    expect(find.text('These items could not be loaded'), findsOneWidget);
    expect(find.text('The grocery catalogue is offline.'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    expect(find.text('Nothing listed here right now'), findsNothing);
    expect(find.text('0 items from NABIN merchants'), findsNothing);
  });

  testWidgets('ADD charges the row\'s live price into the basket bar',
      (WidgetTester tester) async {
    await pumpList(tester);
    await tester.enterText(find.byType(TextField), 'Banana');
    await tester.pump(const Duration(milliseconds: 350));
    await settle(tester);

    expect(find.text('VIEW BASKET'), findsNothing);
    await tester.tap(find.text('ADD'));
    await settle(tester);

    expect(find.textContaining('1 item in basket'), findsOneWidget);
    expect(find.text('VIEW BASKET'), findsOneWidget);
    // The bar's subtotal is the row's own currentPrice — no fee, no estimate.
    expect(find.text('₹60'), findsWidgets);
  });

  testWidgets('the list holds at phone and tablet widths', (WidgetTester tester) async {
    for (final Size size in <Size>[const Size(393, 852), const Size(834, 1112)]) {
      await pumpList(tester, logicalSize: size);
      expect(find.byType(GroceryProductsScreen), findsOneWidget);
      expect(find.text('6 items from NABIN merchants'), findsOneWidget);
      // The last row is off the fold at phone width; the page has to build it
      // without the tile overflowing.
      expect(find.text('Tomato'), findsOneWidget);
      expect(tester.takeException(), isNull, reason: 'overflow at ${size.width}px wide');
    }
  });
}
