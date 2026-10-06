import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/grocery/presentation/screens/grocery_categories_screen.dart';
import 'package:mobile/features/grocery/presentation/screens/grocery_home_screen.dart';
import 'package:mobile/features/grocery/presentation/theme/grocery_theme.dart';

import 'support/http_stub.dart';

// The grocery browsing surfaces took the shape of a supermarket menu: aisles as
// artwork tiles on the home, then a two-pane browser with the aisle rail on the
// left and the aisle's products on the right, closed by a sticky basket bar.
//
// What is *not* on those screens matters as much. The reference apps promise
// "delivery in 10 minutes" and greet the shopper with a saved address; the
// platform has no SLA read and no address book, so neither claim is allowed to
// appear here. Every aisle name, count, emoji, price and MRP on them comes out
// of the same `GET /grocery/products` rows the rest of the app uses.

/// The brand signature blue. A selected aisle is page structure, so it wears
/// this and not the service green.
const Color _brand = Color(0xFF1A3BA2);

Map<String, dynamic> _row({
  required String id,
  required String name,
  required String category,
  required String emoji,
  required double price,
  required double mrp,
}) =>
    <String, dynamic>{
      'id': id,
      'name': name,
      'category': category,
      'emoji': emoji,
      'currentPrice': price,
      'mrp': mrp,
      'isAvailable': true,
      'stockQty': 30,
      'unit': 'kg',
      'packSize': '1kg',
      'merchantId': 'str_test_store',
      'merchantName': 'Test Store',
    };

/// Three aisles, five rows — enough for the derived names, counts and artwork
/// to be wrong if any of them were invented rather than read.
final List<Map<String, dynamic>> _catalogue = <Map<String, dynamic>>[
  _row(id: 'p1', name: 'Seaul Flattene rice', category: 'Staples', emoji: '🍚', price: 160, mrp: 180),
  _row(id: 'p2', name: 'Atta', category: 'Staples', emoji: '🌾', price: 248, mrp: 260),
  _row(id: 'p3', name: 'Eggs', category: 'Dairy', emoji: '🥚', price: 84, mrp: 90),
  _row(id: 'p4', name: 'Milk', category: 'Dairy', emoji: '🥛', price: 34, mrp: 34),
  _row(id: 'p5', name: 'Banana', category: 'Fruits', emoji: '🍌', price: 60, mrp: 80),
];

void serveGroceryCatalogue() {
  stubHandler = (method, url, _) {
    if (url.path.contains('/grocery/products')) {
      final String? category = url.queryParameters['category'];
      final List<Map<String, dynamic>> rows = category == null
          ? _catalogue
          : _catalogue.where((Map<String, dynamic> r) => r['category'] == category).toList();
      return (200, jsonEncode({'success': true, 'products': rows}));
    }
    return (200, '{"success":true}');
  };
}

Future<void> pumpGroceryHome(WidgetTester tester, {Size? logicalSize}) async {
  final Size size = logicalSize ?? const Size(393, 852);
  tester.view.physicalSize = size * 3;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(child: MaterialApp.router(routerConfig: appRouter)),
  );
  appRouter.go('/grocery-home');
  // The catalogue read lands asynchronously and the rail rebuilds as it does, so
  // the tree needs frames rather than pumpAndSettle — the grids paint spinners.
  for (var i = 0; i < 14; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

/// The left-edge colour of a rail entry, which is what marks it selected.
Color _railBorderLeft(WidgetTester tester, String aisle) {
  final Finder finder = find.widgetWithText(AnimatedContainer, aisle);
  expect(finder, findsOneWidget, reason: '$aisle should have one rail entry');
  final AnimatedContainer entry = tester.widget<AnimatedContainer>(finder);
  final BoxDecoration decoration = entry.decoration! as BoxDecoration;
  return (decoration.border! as Border).left.color;
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    serveGroceryCatalogue();
    SessionManager.instance.saveSession(
      token: 'test-token',
      user: <String, dynamic>{'id': 'usr_test', 'name': 'Test Customer'},
    );
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
  });

  testWidgets('home shows the aisles as an artwork grid, with no delivery promise',
      (WidgetTester tester) async {
    await pumpGroceryHome(tester);
    expect(find.byType(GroceryHomeScreen), findsOneWidget);
    expect(stubSaw('GET', '/grocery/products'), isTrue);

    expect(find.text('Shop by category'), findsOneWidget);
    expect(find.text('Browse the menu'), findsOneWidget);
    // Aisle names are derived and sorted, so all three appear as tiles.
    for (final String aisle in <String>['Dairy', 'Fruits', 'Staples']) {
      expect(find.text(aisle), findsWidgets);
    }
    // A tile's artwork is one of that aisle's own rows.
    expect(find.text('🍚'), findsWidgets);

    // Fabrication guard: neither a delivery SLA nor an address greeting exists
    // as a read, so neither may be painted.
    expect(find.textContaining('Delivery in'), findsNothing);
    expect(find.textContaining('minutes'), findsNothing);
  });

  testWidgets('an aisle tile deep-links the two-pane menu onto that aisle',
      (WidgetTester tester) async {
    await pumpGroceryHome(tester);
    await tester.tap(find.text('Fruits').first);
    for (var i = 0; i < 14; i++) {
      await tester.pump(const Duration(milliseconds: 40));
    }

    expect(find.byType(GroceryCategoriesScreen), findsOneWidget);
    // The pane filters through the endpoint's real `category` param, not in memory.
    expect(stubSaw('GET', 'category=Fruits'), isTrue);
    // The selected aisle names both the rail entry and the pane heading.
    expect(find.text('Fruits'), findsNWidgets(2));
    expect(_railBorderLeft(tester, 'Fruits'), _brand);
    expect(_railBorderLeft(tester, 'Fruits'), isNot(GroceryTheme.primaryGreenDark));
    // The unselected clear-entry carries no edge at all.
    expect(_railBorderLeft(tester, 'All aisles'), Colors.transparent);

    // Right pane: the aisle's own rows with size, discount, price and ADD.
    expect(find.text('Banana'), findsOneWidget);
    expect(find.text('1 shown'), findsOneWidget);
    expect(find.text('25% OFF'), findsOneWidget);
    expect(find.text('ADD'), findsOneWidget);
  });

  testWidgets('the sticky basket bar reports the real subtotal',
      (WidgetTester tester) async {
    await pumpGroceryHome(tester);
    await tester.tap(find.text('Fruits').first);
    for (var i = 0; i < 14; i++) {
      await tester.pump(const Duration(milliseconds: 40));
    }
    expect(find.text('VIEW BASKET'), findsNothing);

    await tester.tap(find.text('ADD'));
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 40));
    }
    expect(find.text('VIEW BASKET'), findsOneWidget);
    expect(find.textContaining('1 item in basket'), findsOneWidget);
    // ₹60 is the row's own currentPrice; no fee or estimate is added to it.
    expect(find.text('₹60'), findsWidgets);
  });

  testWidgets('"All aisles" clears the aisle filter', (WidgetTester tester) async {
    await pumpGroceryHome(tester);
    await tester.tap(find.text('Fruits').first);
    for (var i = 0; i < 14; i++) {
      await tester.pump(const Duration(milliseconds: 40));
    }
    await tester.tap(find.text('All aisles'));
    for (var i = 0; i < 14; i++) {
      await tester.pump(const Duration(milliseconds: 40));
    }

    // Rail entry plus the heading that confirms the pane is unfiltered again.
    expect(find.text('All aisles'), findsNWidgets(2));
    expect(find.text('Everything listed'), findsOneWidget);
    expect(_railBorderLeft(tester, 'All aisles'), _brand);
    expect(find.text('Seaul Flattene rice'), findsOneWidget);
    expect(find.text('Milk'), findsOneWidget);
  });

  testWidgets('a tablet width keeps the aisle grid and both panes',
      (WidgetTester tester) async {
    await pumpGroceryHome(tester, logicalSize: const Size(834, 1112));
    expect(find.byType(GroceryHomeScreen), findsOneWidget);
    expect(find.text('Shop by category'), findsOneWidget);

    await tester.tap(find.text('Browse the menu'));
    for (var i = 0; i < 14; i++) {
      await tester.pump(const Duration(milliseconds: 40));
    }
    expect(find.byType(GroceryCategoriesScreen), findsOneWidget);
    expect(find.text('All aisles'), findsWidgets);
    expect(find.text('Everything listed'), findsOneWidget);
  });
}
