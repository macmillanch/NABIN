import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/food/presentation/screens/food_category_screen.dart';
import 'package:mobile/features/food/presentation/screens/food_home_screen.dart';

import 'support/http_stub.dart';

// "Browse by cuisine" is the first step of the food browsing hierarchy
// (cuisine → restaurant list → menu → dish → basket), and it is the step where a
// delivery app's taxonomy is easiest to copy. NABIN has no cuisine endpoint and no
// cuisine table: `GET /api/restaurants` returns each kitchen's own `cuisines` list,
// so this screen may show only the words restaurants actually declare, and the count
// under each one may only be the restaurants that declared it. A tile for "South
// Indian" would be an invention even though every real food app has one.
//
// The fixture below declares five cuisines across four kitchens, with `Momo` shared
// by two of them so a plural count is exercised, and deliberately does not declare
// "South Indian", "Desserts" or "Rolls" — the three tiles this screen must not paint.

Map<String, dynamic> _kitchen({
  required String id,
  required String name,
  required List<String> cuisines,
  int? deliveryMinutes,
  bool isOpen = true,
}) =>
    <String, dynamic>{
      'id': id,
      'name': name,
      'cuisines': cuisines,
      'deliveryMinutes': deliveryMinutes,
      'isOpen': isOpen,
      'address': 'Aizawl',
    };

final List<Map<String, dynamic>> _kitchens = <Map<String, dynamic>>[
  _kitchen(id: 'rest_1', name: 'Zirkhal Biryani House', cuisines: <String>['Biryani', 'North Indian'], deliveryMinutes: 35),
  _kitchen(id: 'rest_2', name: 'Pizza Point', cuisines: <String>['Pizza'], deliveryMinutes: 30),
  _kitchen(id: 'rest_3', name: 'Momo Corner', cuisines: <String>['Momo', 'Chinese'], deliveryMinutes: 25),
  _kitchen(id: 'rest_4', name: 'Bungpal Thukpa House', cuisines: <String>['Momo', 'Thukpa'], deliveryMinutes: 40),
];

void serveCuisineFeed({List<Map<String, dynamic>>? kitchens, bool fail = false}) {
  stubHandler = (method, url, _) {
    if (fail) {
      return (500, jsonEncode(<String, dynamic>{
        'success': false,
        'error': 'Restaurant feed is offline for maintenance.',
      }));
    }
    if (url.path.endsWith('/advertisements')) {
      return (200, jsonEncode(<String, dynamic>{'success': true, 'advertisements': <dynamic>[] }));
    }
    if (url.path.endsWith('/restaurants')) {
      final List<Map<String, dynamic>> rows = kitchens ?? _kitchens;
      final String? cuisine = url.queryParameters['cuisine'];
      final List<Map<String, dynamic>> filtered = cuisine == null
          ? rows
          : rows
              .where((Map<String, dynamic> r) => (r['cuisines'] as List)
                  .cast<String>()
                  .any((String c) => c.toLowerCase() == cuisine.toLowerCase()))
              .toList();
      return (200, jsonEncode(<String, dynamic>{
        'success': true,
        'count': filtered.length,
        'restaurants': filtered,
      }));
    }
    return (200, '{"success":true}');
  };
}

Future<void> pumpCategories(WidgetTester tester, {Size? logicalSize}) async {
  final Size size = logicalSize ?? const Size(393, 852);
  tester.view.physicalSize = size * 3;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(child: MaterialApp.router(routerConfig: appRouter)),
  );
  appRouter.go('/food-categories');
  await settle(tester);
}

/// The tile of one cuisine. The grid paints each cuisine word exactly once, so the
/// word names the tile unambiguously and the count line inside it is the pairing.
Finder _cuisineTile(String cuisine) => find.ancestor(
      of: find.text(cuisine),
      matching: find.byType(GestureDetector),
    );

Finder _countLine(String cuisine, String label) => find.descendant(
      of: _cuisineTile(cuisine),
      matching: find.text(label),
    );

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 16; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    serveCuisineFeed();
    SessionManager.instance.saveSession(
      token: 'test-token',
      user: <String, dynamic>{'id': 'usr_test', 'name': 'Test Customer'},
    );
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
  });

  testWidgets('the grid asks the restaurant feed before it paints anything',
      (WidgetTester tester) async {
    await pumpCategories(tester);

    expect(find.byType(FoodCategoryScreen), findsOneWidget);
    // An empty state can look identical to a correct one, so the request is
    // asserted first.
    expect(stubSaw('GET', '/restaurants'), isTrue);

    for (final String cuisine in <String>['Biryani', 'North Indian', 'Pizza', 'Momo', 'Chinese', 'Thukpa']) {
      expect(find.text(cuisine), findsOneWidget, reason: '$cuisine is declared by a kitchen');
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('no tile is invented for a cuisine no kitchen declares',
      (WidgetTester tester) async {
    await pumpCategories(tester);

    for (final String absent in <String>['South Indian', 'Desserts', 'Rolls', 'Fast Food']) {
      expect(find.text(absent), findsNothing, reason: 'no fixture kitchen declares $absent');
    }
  });

  testWidgets('each tile counts only the kitchens that declare it',
      (WidgetTester tester) async {
    await pumpCategories(tester);

    // Momo is declared twice, so it is the one plural in the fixture. The pairing is
    // what is asserted: right counts under the wrong tiles is still a lie.
    expect(_countLine('Momo', '2 restaurants'), findsOneWidget);
    for (final String single in <String>[
      'Biryani',
      'North Indian',
      'Pizza',
      'Chinese',
      'Thukpa'
    ]) {
      expect(_countLine(single, '1 restaurant'), findsOneWidget,
          reason: '$single is declared by exactly one kitchen');
      expect(_countLine(single, '2 restaurants'), findsNothing);
    }
  });

  testWidgets('an empty feed says there is nothing to browse',
      (WidgetTester tester) async {
    serveCuisineFeed(kitchens: <Map<String, dynamic>>[]);
    await pumpCategories(tester);

    expect(stubSaw('GET', '/restaurants'), isTrue);
    expect(find.text('No cuisines yet'), findsOneWidget);
    // No tiles, and no cuisine word anywhere on the screen.
    expect(find.text('Biryani'), findsNothing);
  });

  testWidgets('a failed feed is an error with a retry, not an empty wheel',
      (WidgetTester tester) async {
    serveCuisineFeed(fail: true);
    await pumpCategories(tester);

    expect(find.text('Cuisines unavailable'), findsOneWidget);
    expect(find.text('Restaurant feed is offline for maintenance.'), findsOneWidget);
    expect(find.text('No cuisines yet'), findsNothing);
  });

  testWidgets('choosing a cuisine filters the list by that cuisine',
      (WidgetTester tester) async {
    await pumpCategories(tester);

    await tester.tap(find.text('Momo'));
    await settle(tester);

    expect(find.byType(FoodHomeScreen), findsOneWidget);
    expect(stubSaw('GET', 'cuisine=Momo'), isTrue);
    expect(find.text('Momo Corner'), findsOneWidget);
    expect(find.text('Bungpal Thukpa House'), findsOneWidget);
    expect(find.text('Zirkhal Biryani House'), findsNothing);
  });

  testWidgets('the grid holds at phone and tablet widths',
      (WidgetTester tester) async {
    await pumpCategories(tester, logicalSize: const Size(393, 852));
    expect(find.text('Biryani'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await pumpCategories(tester, logicalSize: const Size(834, 1112));
    expect(find.text('Momo'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
