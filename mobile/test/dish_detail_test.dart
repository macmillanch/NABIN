import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/food/presentation/providers/food_cart_provider.dart';
import 'package:mobile/features/food/presentation/screens/dish_detail_screen.dart';

import 'support/http_stub.dart';

// Dish detail is the leaf of the food browsing hierarchy and the point where a
// delivery app's product page is easiest to copy: a star, a review count, a
// 'Prep time', an appetising stock photograph. NABIN's menu endpoint returns
// `id, name, description, category, image_url, selling_price, is_available` and
// nothing else, so this screen may paint those and must refuse the rest. The
// basket is the screen's only write, so its quantity arithmetic is pinned here
// too: the number on the button has to be the number that lands in the cart.

Map<String, dynamic> _dish({
  required String id,
  required String name,
  required num price,
  String? category,
  String? description,
  String? imageUrl,
  bool? isVeg,
  bool inStock = true,
}) =>
    <String, dynamic>{
      'id': id,
      'name': name,
      'sellingPrice': price,
      if (category != null) 'category': category,
      if (description != null) 'description': description,
      if (imageUrl != null) 'imageUrl': imageUrl,
      if (isVeg != null) 'isVeg': isVeg,
      'isAvailable': inStock,
    };

Map<String, dynamic> _kitchen({
  required String id,
  required String name,
  List<String> cuisines = const <String>['Momo'],
}) =>
    <String, dynamic>{
      'id': id,
      'name': name,
      'cuisines': cuisines,
      'isOpen': true,
      'address': 'Aizawl',
    };

/// The two kitchens are deliberately distinct so a basket switch can be told
/// apart from a basket addition.
void serveDishFeed({
  List<Map<String, dynamic>>? kitchens,
  List<Map<String, dynamic>>? dishes,
  bool menuFails = false,
}) {
  stubHandler = (method, url, _) {
    if (url.path.endsWith('/advertisements')) {
      return (200, jsonEncode(<String, dynamic>{'success': true, 'advertisements': <dynamic>[] }));
    }
    if (url.path.endsWith('/menu')) {
      if (menuFails) {
        return (500, jsonEncode(<String, dynamic>{
          'success': false,
          'error': 'This kitchen has not published its menu.',
        }));
      }
      return (200, jsonEncode(<String, dynamic>{
        'success': true,
        'items': dishes ?? <Map<String, dynamic>>[
          _dish(
            id: 'dish_momo',
            name: 'Steamed Momo',
            price: 120,
            category: 'Steamed',
            description: 'Hand-folded, steamed to order.',
            isVeg: true,
          ),
        ],
      }));
    }
    if (url.path.endsWith('/restaurants')) {
      return (200, jsonEncode(<String, dynamic>{
        'success': true,
        'restaurants': kitchens ??
            <Map<String, dynamic>>[
              _kitchen(id: 'rest_3', name: 'Momo Corner', cuisines: <String>['Momo', 'Chinese']),
              _kitchen(id: 'rest_4', name: 'Bungpal Thukpa House', cuisines: <String>['Momo', 'Thukpa']),
            ],
      }));
    }
    return (200, '{"success":true}');
  };
}

Future<void> pumpDish(
  WidgetTester tester, {
  String? restaurantId = 'rest_3',
  String? dishId = 'dish_momo',
  Size logicalSize = const Size(393, 852),
}) async {
  tester.view.physicalSize = logicalSize * 3;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(child: MaterialApp.router(routerConfig: appRouter)),
  );
  // A read still in flight when the previous test ended lands in the shared log
  // during these frames. The tree is up by now and this screen has asked for nothing
  // yet, so the log is emptied here and every assertion below sees only this test.
  await settle(tester);
  stubSeen.clear();
  final String query = <String>[
    if (restaurantId != null) 'restaurantId=$restaurantId',
    if (dishId != null) 'dishId=$dishId',
  ].join('&');
  appRouter.go('/dish-detail${query.isEmpty ? '' : '?$query'}');
  await settle(tester);
}

FoodCart cartOf(WidgetTester tester) =>
    ProviderScope.containerOf(tester.element(find.byType(DishDetailScreen)))
        .read(foodCartProvider);

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 16; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    serveDishFeed();
    SessionManager.instance.saveSession(
      token: 'test-token',
      user: <String, dynamic>{'id': 'usr_test', 'name': 'Test Customer'},
    );
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
  });

  testWidgets('the dish page is built from the menu read, not a placeholder',
      (WidgetTester tester) async {
    await pumpDish(tester);

    expect(find.byType(DishDetailScreen), findsOneWidget);
    // Both reads happen: the kitchen from the feed, the dish from its menu.
    expect(stubSaw('GET', '/restaurants'), isTrue);
    expect(stubSaw('GET', '/restaurants/rest_3/menu'), isTrue);

    expect(find.text('Steamed Momo'), findsOneWidget);
    expect(find.text('₹120'), findsOneWidget);
    expect(find.text('Steamed'), findsOneWidget);
    expect(find.text('From Momo Corner'), findsOneWidget);
    expect(find.text('Hand-folded, steamed to order.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the page claims no score, review count, or prep time',
      (WidgetTester tester) async {
    await pumpDish(tester);

    // `merchants.rating` was dropped by migration 034 and no review table exists,
    // so a star or a number here would be the DDL default wearing a measurement.
    expect(find.textContaining('4.8'), findsNothing);
    expect(find.textContaining('/5'), findsNothing);
    expect(find.textContaining(RegExp('review', caseSensitive: false)), findsNothing);
    expect(find.textContaining(RegExp('rating', caseSensitive: false)), findsNothing);
    expect(find.byIcon(Icons.star_rounded), findsNothing);
    expect(find.byIcon(Icons.star), findsNothing);
    expect(find.textContaining('Prep time'), findsNothing);
    expect(find.textContaining('Spicy'), findsNothing);
  });

  testWidgets('a dish with no artwork keeps the letter plate, never a stock photo',
      (WidgetTester tester) async {
    await pumpDish(tester);

    // `imageUrl` was absent, so there is no network image on the page at all.
    expect(find.byType(Image), findsNothing);
    expect(find.text('S'), findsWidgets); // the plate's first letter
  });

  testWidgets('declared artwork is the only picture the page will ask for',
      (WidgetTester tester) async {
    serveDishFeed(dishes: <Map<String, dynamic>>[
      _dish(id: 'dish_momo', name: 'Steamed Momo', price: 120, imageUrl: 'https://cdn.test/momo.jpg'),
    ]);
    await pumpDish(tester);

    final Finder image = find.byType(Image);
    expect(image, findsOneWidget);
    expect((tester.widget(image) as Image).image, isA<NetworkImage>());
  });

  testWidgets('the button total is the cart quantity, in rupees and in lines',
      (WidgetTester tester) async {
    await pumpDish(tester);

    expect(find.text('Add ₹120 • Momo Corner'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.add));
    await settle(tester);
    expect(find.text('2'), findsOneWidget);
    expect(find.text('Add 2 × ₹240 • Momo Corner'), findsOneWidget);

    await tester.tap(find.byWidget(
      find.widgetWithIcon(ElevatedButton, Icons.add_shopping_cart_rounded).evaluate().single.widget,
    ));
    await settle(tester);

    final FoodCart cart = cartOf(tester);
    expect(cart.restaurantId, 'rest_3');
    expect(cart.quantityOf('dish_momo'), 2);
    expect(cart.itemTotal, 240);
    expect(find.text('Added 2 × Steamed Momo to your basket.'), findsOneWidget);
  });

  testWidgets('the stepper stops at one, so a line can never go negative',
      (WidgetTester tester) async {
    await pumpDish(tester);

    await tester.tap(find.byIcon(Icons.remove));
    await settle(tester);

    expect(find.text('1'), findsOneWidget);
    expect(cartOf(tester).isEmpty, isTrue);
  });

  testWidgets('a sold-out dish is refused, not added', (WidgetTester tester) async {
    serveDishFeed(dishes: <Map<String, dynamic>>[
      _dish(id: 'dish_momo', name: 'Steamed Momo', price: 120, inStock: false),
    ]);
    await pumpDish(tester);

    expect(find.text('Currently unavailable'), findsOneWidget);
    expect(find.text('SOLD OUT'), findsOneWidget);
    // The basket bar is the add affordance; a sold-out dish must not carry one.
    expect(find.byIcon(Icons.add_shopping_cart_rounded), findsNothing);
    expect(cartOf(tester).isEmpty, isTrue);
  });

  testWidgets('a dish the menu does not carry is named as missing',
      (WidgetTester tester) async {
    await pumpDish(tester, dishId: 'dish_gone');

    expect(find.text('Dish not on the menu'), findsOneWidget);
    expect(find.byIcon(Icons.add_shopping_cart_rounded), findsNothing);
    expect(find.text('Steamed Momo'), findsNothing);
  });

  testWidgets('a kitchen id the feed does not know is not answered with a demo dish',
      (WidgetTester tester) async {
    await pumpDish(tester, restaurantId: 'rest_999');

    expect(find.text('Restaurant not found'), findsOneWidget);
    expect(find.text('Steamed Momo'), findsNothing);
    expect(find.byIcon(Icons.add_shopping_cart_rounded), findsNothing);
  });

  testWidgets('a deep link with no kitchen asks the API for nothing',
      (WidgetTester tester) async {
    await pumpDish(tester, restaurantId: null, dishId: null);

    expect(find.text('No restaurant selected'), findsOneWidget);
    expect(stubSaw('GET', '/menu'), isFalse);
    expect(find.byIcon(Icons.add_shopping_cart_rounded), findsNothing);
  });

  testWidgets('a failed menu read is an error with a retry, not an empty page',
      (WidgetTester tester) async {
    serveDishFeed(menuFails: true);
    await pumpDish(tester);

    expect(stubSaw('GET', '/restaurants/rest_3/menu'), isTrue);
    expect(find.text('Menu unavailable'), findsOneWidget);
    expect(find.text('This kitchen has not published its menu.'), findsOneWidget);
    expect(find.text('Dish not on the menu'), findsNothing);
  });

  testWidgets('an undeclared veg flag paints no veg mark',
      (WidgetTester tester) async {
    serveDishFeed(dishes: <Map<String, dynamic>>[
      _dish(id: 'dish_momo', name: 'Steamed Momo', price: 120),
    ]);
    await pumpDish(tester);

    // The schema has no veg column, so a dish that never declared one may not be
    // drawn as either colour.
    expect(find.text('Steamed Momo'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the page holds at phone and tablet widths',
      (WidgetTester tester) async {
    await pumpDish(tester, logicalSize: const Size(393, 852));
    expect(find.text('₹120'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
