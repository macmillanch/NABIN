import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/grocery/presentation/screens/grocery_product_detail_screen.dart';

import 'support/http_stub.dart';

// The leaf of the grocery hierarchy, and the screen most tempting to pad.
//
// A product page in the wild carries a star rating, a review count, a delivery
// ETA, an 'About this item' blurb, a gallery and a coupon strip. NABIN has no
// source for any of them: the only grocery read is
// `GET /api/grocery/products` (merchant_grocery_inventory joined to
// master_grocery_catalog) and there is no single-product endpoint at all, so this
// screen resolves its row by id out of that list. Everything it prints must be a
// field of that row; an id the list does not carry is a refusal, not a placeholder.

Map<String, dynamic> _row({
  required String id,
  required String name,
  required double price,
  double? mrp,
  bool available = true,
  num stock = 30,
  String? category,
  String? brand,
  String? unit,
  String? packSize,
  num? previousPrice,
  String? priceStatus,
  String? unitPricingType,
}) =>
    <String, dynamic>{
      'id': id,
      'name': name,
      'currentPrice': price,
      if (mrp != null) 'mrp': mrp,
      'isAvailable': available,
      'stockQty': stock,
      'emoji': '🍌',
      if (category != null) 'category': category,
      if (brand != null) 'brand': brand,
      if (unit != null) 'unit': unit,
      if (packSize != null) 'packSize': packSize,
      if (previousPrice != null) 'previousPrice': previousPrice,
      if (priceStatus != null) 'priceStatus': priceStatus,
      if (unitPricingType != null) 'unitPricingType': unitPricingType,
      'merchantId': 'str_test_store',
      'merchantName': 'Test Store',
    };

final List<Map<String, dynamic>> _catalogue = <Map<String, dynamic>>[
  _row(id: 'p5', name: 'Banana', price: 60, mrp: 80, category: 'Fruits', unit: 'kg', packSize: '1kg'),
  _row(
    id: 'p1',
    name: 'Seaul Flattene rice',
    price: 160,
    mrp: 180,
    category: 'Staples',
    brand: 'Vanthral Mills',
    unit: 'kg',
    packSize: '5kg',
    previousPrice: 175,
    priceStatus: 'FROZEN',
    unitPricingType: 'PER_WEIGHT',
  ),
  _row(id: 'p4', name: 'Milk', price: 34, mrp: 34, category: 'Dairy', unit: 'L', packSize: '500ml'),
  _row(id: 'p6', name: 'Tomato', price: 40, mrp: 40, category: 'Vegetables', available: false, stock: 0, unit: 'kg', packSize: '1kg'),
  _row(id: 'p7', name: 'Honey', price: 320, mrp: 400, category: 'Staples', stock: 0, unit: 'jar', packSize: '500g'),
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

Future<void> pumpDetail(
  WidgetTester tester, {
  String route = '/grocery-product-detail?productId=p5',
  Size logicalSize = const Size(393, 852),
}) async {
  tester.view.physicalSize = logicalSize * 3;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  // Same reason as the list file: the router is a global, so mounting the tree
  // builds the route the previous test left it on, and `go` to an identical path
  // reuses the element instead of re-running initState with the new query.
  appRouter.go('/');
  await tester.pumpWidget(
    ProviderScope(child: MaterialApp.router(routerConfig: appRouter)),
  );
  await settle(tester);
  stubSeen.clear();
  appRouter.go(route);
  await settle(tester);
}

/// Text the sheet prints that the payload cannot support, if it ever grows.
void expectNoInventedProductPage(WidgetTester tester) {
  expect(find.byIcon(Icons.star_rounded), findsNothing);
  expect(find.byIcon(Icons.star_half_rounded), findsNothing);
  expect(find.textContaining('/5'), findsNothing);
  expect(find.textContaining('4.8'), findsNothing);
  expect(find.textContaining('ratings'), findsNothing);
  expect(find.textContaining('Reviews'), findsNothing);
  expect(find.textContaining('Delivery in'), findsNothing);
  expect(find.textContaining('coupon'), findsNothing);
  expect(find.textContaining('Coupon'), findsNothing);
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    serveGrocery();
  });

  tearDown(() {
    HttpOverrides.global = null;
    stubReset();
  });

  testWidgets('the row comes from the catalogue read, not a per-product endpoint',
      (WidgetTester tester) async {
    await pumpDetail(tester);

    expect(stubSaw('GET', '/grocery/products'), isTrue);
    // Nothing to ask for: no route under /grocery/product/ exists on the backend.
    expect(
      stubSeen.where((String s) => s.contains('/grocery/product/')),
      isEmpty,
      reason: 'a detail endpoint does not exist, so no request may name one',
    );
    expect(find.text('Product details'), findsOneWidget);
    expect(find.text('Banana'), findsOneWidget);
  });

  testWidgets('the sheet shows only the fields its own row carries',
      (WidgetTester tester) async {
    await pumpDetail(tester);

    expect(find.text('What the store lists'), findsOneWidget);
    expect(find.text('₹60'), findsOneWidget);
    expect(find.text('MRP ₹80'), findsOneWidget);
    expect(find.text('You save ₹20 against MRP'), findsOneWidget);
    // 25% is arithmetic on the row's own two prices, not a server field.
    expect(find.text('25% OFF'), findsOneWidget);
    expect(find.text('1kg • kg'), findsOneWidget);
    expect(find.text('Sold by'), findsOneWidget);
    expect(find.text('Test Store'), findsOneWidget);
    expect(find.text('Aisle'), findsOneWidget);
    expect(find.text('Fruits'), findsOneWidget);
    expect(find.text('Sold per'), findsOneWidget);
    expect(find.text('Pack size'), findsOneWidget);
    expect(find.text('Listed • 30 in stock'), findsOneWidget);
    expectNoInventedProductPage(tester);
  });

  testWidgets('a field the row omits is a missing line, not a default',
      (WidgetTester tester) async {
    // Banana has no brand, no previous price and no platform price hold.
    await pumpDetail(tester);

    expect(find.text('Brand'), findsNothing);
    expect(find.text('Price movement'), findsNothing);
    expect(find.text('Price frozen by platform'), findsNothing);
    expect(find.text('Priced by packed weight'), findsNothing);
    // Milk's prices are equal, so no saving is claimed against its MRP.
    await pumpDetail(tester, route: '/grocery-product-detail?productId=p4');
    expect(find.text('₹34'), findsOneWidget);
    expect(find.text('MRP ₹34'), findsNothing);
    expect(find.textContaining('You save'), findsNothing);
    expect(find.text('0% OFF'), findsNothing);
  });

  testWidgets('a row that carries brand, movement and pricing type says so',
      (WidgetTester tester) async {
    await pumpDetail(tester, route: '/grocery-product-detail?productId=p1');

    expect(find.text('Brand'), findsOneWidget);
    expect(find.text('Vanthral Mills'), findsOneWidget);
    expect(find.text('Price frozen by platform'), findsOneWidget);
    expect(find.text('Priced by packed weight'), findsOneWidget);
    expect(find.text('5kg • kg'), findsOneWidget);
    // The last fact sits under the fold at phone height, so it has to be
    // scrolled to rather than waved at with a taller-than-a-phone viewport.
    await tester.scrollUntilVisible(find.text('Price movement'), 80,
        scrollable: find.byType(Scrollable).first);
    expect(find.text('Price movement'), findsOneWidget);
    expect(find.text('₹175 → ₹160'), findsOneWidget);
  });

  testWidgets('an id the catalogue does not carry is refused, not filled in',
      (WidgetTester tester) async {
    await pumpDetail(tester, route: '/grocery-product-detail?productId=p999');

    expect(stubSaw('GET', '/grocery/products'), isTrue);
    expect(find.text('Product no longer listed'), findsOneWidget);
    expect(
      find.text('No NABIN grocery merchant lists this product right now, so its details cannot be shown.'),
      findsOneWidget,
    );
    expect(find.text('Browse groceries'), findsOneWidget);
    expect(find.text('Banana'), findsNothing);
    // No product, so nothing to buy.
    expect(find.text('ADD'), findsNothing);
    expectNoInventedProductPage(tester);
  });

  testWidgets('an unknown id is a different sentence from a failed read',
      (WidgetTester tester) async {
    serveGrocery(fail: true);
    await pumpDetail(tester);

    expect(find.text('This product could not be loaded'), findsOneWidget);
    expect(find.text('The grocery catalogue is offline.'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    expect(find.text('Product no longer listed'), findsNothing);
    expect(find.text('No product selected'), findsNothing);
  });

  testWidgets('a sheet opened with no id asks for one', (WidgetTester tester) async {
    await pumpDetail(tester, route: '/grocery-product-detail');

    expect(find.text('No product selected'), findsOneWidget);
    expect(
      find.text('Open a product from the grocery aisles to see its details.'),
      findsOneWidget,
    );
    expect(find.text('Back to grocery'), findsOneWidget);
    expect(find.text('Banana'), findsNothing);
  });

  testWidgets('a row that cannot be ordered offers no way to order it',
      (WidgetTester tester) async {
    // Delisted: isAvailable false.
    await pumpDetail(tester, route: '/grocery-product-detail?productId=p6');
    expect(find.text('Not listed right now'), findsOneWidget);
    expect(find.text('Not available for order'), findsOneWidget);
    expect(find.text('ADD'), findsNothing);
    expect(find.text('View basket'), findsNothing);

    // Listed but at zero stock: the copy must not be the same fact.
    await pumpDetail(tester, route: '/grocery-product-detail?productId=p7');
    expect(find.text('Out of stock'), findsOneWidget);
    expect(find.text('Not listed right now'), findsNothing);
    expect(find.text('ADD'), findsNothing);
    // Its discount is still arithmetic on its own prices.
    expect(find.text('20% OFF'), findsOneWidget);
  });

  testWidgets('the sheet holds at phone and tablet widths', (WidgetTester tester) async {
    for (final Size size in <Size>[const Size(393, 852), const Size(834, 1112)]) {
      await pumpDetail(tester, logicalSize: size);
      expect(find.byType(GroceryProductDetailScreen), findsOneWidget);
      expect(find.text('₹60'), findsOneWidget);
      expect(find.text('What the store lists'), findsOneWidget);
      // A row that is not this product's never leaks into the sheet.
      expect(find.text('Seaul Flattene rice'), findsNothing);
      expect(tester.takeException(), isNull, reason: 'overflow at ${size.width}px wide');
    }
  });
}
