import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/core/theme/restaurant_theme.dart';
import 'package:mobile/features/food/presentation/screens/food_home_screen.dart';
import 'package:mobile/features/food/presentation/screens/restaurant_menu_screen.dart';
import 'package:mobile/features/food/presentation/widgets/food_shared_widgets.dart';

import 'support/http_stub.dart';

// The food discovery surfaces took the shape of a delivery app's menu: a search
// field, a sponsored rail, a circular cuisine picker, then restaurant cards with
// a band, an ETA chip, a name and the cuisines under it.
//
// The shape was adopted; the parts of the reference this platform cannot
// substantiate were not. It greets the shopper with a saved address, counts
// "888 restaurants around you", stamps cards "Promoted", prices them "₹250 for
// one", offers a bookmark and puts a `[4.1★]` pill on every card — while
// `GET /api/restaurants` projects no address book, no location filter, no
// promoted flag, no price-for-one, no favourites route and no rating any customer
// gave. Those render nowhere here. The rating pill's slot is empty rather than
// filled with `merchants.rating`, a column whose every value was the `4.80`
// default because the schema has no reviews table.
//
// Everything painted comes from the fields the endpoint actually returns: id,
// name, cuisines, coverImageUrl, deliveryMinutes (the integer behind
// `standard_delivery_minutes`), isOpen and address.

/// The brand signature blue. A selected cuisine is page structure, so it wears
/// this and not the service orange.
const Color _brand = Color(0xFF1A3BA2);

Map<String, dynamic> _restaurant({
  required String id,
  required String name,
  required List<String> cuisines,
  String? coverImageUrl,
  int? deliveryMinutes,
  bool isOpen = true,
  String? address,
}) =>
    <String, dynamic>{
      'id': id,
      'name': name,
      'cuisines': cuisines,
      'coverImageUrl': coverImageUrl,
      'deliveryMinutes': deliveryMinutes,
      'isOpen': isOpen,
      'address': address,
    };

/// Three kitchens, five cuisines between them, and deliberate holes: one card
/// with no declared banner, one with no window, one with no address. A screen
/// that filled those in would be caught by the assertions below.
final List<Map<String, dynamic>> _kitchens = <Map<String, dynamic>>[
  _restaurant(
    id: 'rest_1',
    name: 'Zirkhal Biryani House',
    cuisines: <String>['Biryani', 'North Indian'],
    coverImageUrl: 'https://images.example.test/zirkhal-biryani.jpg',
    deliveryMinutes: 35,
    address: 'Zarkham, Aizawl',
  ),
  _restaurant(
    id: 'rest_2',
    name: 'Pizza Point',
    cuisines: <String>['Pizza'],
    isOpen: false,
  ),
  _restaurant(
    id: 'rest_3',
    name: 'Momo Corner',
    cuisines: <String>['Momo', 'Chinese'],
    deliveryMinutes: 25,
    address: 'Bungpal, Aizawl',
  ),
];

void serveFoodFeed() {
  stubHandler = (method, url, _) {
    if (url.path.endsWith('/advertisements')) {
      // The sponsored slot is empty, so the carousel must collapse to nothing
      // rather than hold a frame.
      return (200, jsonEncode(<String, dynamic>{'success': true, 'advertisements': <dynamic>[] }));
    }
    if (url.path.endsWith('/restaurants')) {
      final String? cuisine = url.queryParameters['cuisine'];
      final String? search = url.queryParameters['search'];
      final bool openOnly = url.queryParameters['openNow'] == 'true';
      final rows = _kitchens.where((Map<String, dynamic> r) {
        if (openOnly && r['isOpen'] != true) return false;
        if (cuisine != null) {
          final List<String> list = (r['cuisines'] as List).cast<String>();
          if (!list.any((c) => c.toLowerCase() == cuisine.toLowerCase())) return false;
        }
        if (search != null) {
          if (!(r['name'] as String).toLowerCase().contains(search.toLowerCase())) return false;
        }
        return true;
      }).toList();
      return (200, jsonEncode(<String, dynamic>{'success': true, 'count': rows.length, 'restaurants': rows}));
    }
    if (url.path.endsWith('/menu')) {
      return (200, jsonEncode(<String, dynamic>{
        'success': true,
        'items': <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'dish_1',
            'name': 'Chicken Biryani',
            'category': 'Rice',
            'sellingPrice': 260,
            'isAvailable': true,
          },
        ],
      }));
    }
    return (200, '{"success":true}');
  };
}

Future<void> pumpFoodHome(WidgetTester tester, {Size? logicalSize}) async {
  final Size size = logicalSize ?? const Size(393, 852);
  tester.view.physicalSize = size * 3;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(child: MaterialApp.router(routerConfig: appRouter)),
  );
  appRouter.go('/food-home');
  // The feed and the debounce both land asynchronously, so the tree needs frames
  // rather than pumpAndSettle — the lists paint spinners.
  for (var i = 0; i < 14; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

/// The vertical position of a card's title, which is how a one-up phone list is
/// told apart from a two-up tablet grid.
double _cardTop(WidgetTester tester, String name) =>
    tester.getTopLeft(find.text(name)).dy;

/// A cuisine's label inside the wheel. The same word also paints on a card's
/// cuisine line, so the wheel's own 10.5px label style is what identifies it.
Finder _wheelLabel(String cuisine) => find.byWidgetPredicate(
      (Widget w) => w is Text && w.data == cuisine && w.style?.fontSize == 10.5,
    );

/// The label colour of a cuisine in the wheel, which is what marks it selected.
Color _cuisineLabelColor(WidgetTester tester, String cuisine) {
  final Finder finder = _wheelLabel(cuisine);
  expect(finder, findsOneWidget, reason: '$cuisine should be painted once in the wheel');
  return tester.widget<Text>(finder).style!.color!;
}

/// The band tile of one card, found by the seed the card hands it — the
/// restaurant id, which no cuisine-wheel tile carries.
Finder _cardTile(String restaurantId) => find.byWidgetPredicate(
      (Widget w) => w is FoodLetterTile && w.seed == restaurantId,
    );

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 14; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    serveFoodFeed();
    SessionManager.instance.saveSession(
      token: 'test-token',
      user: <String, dynamic>{'id': 'usr_test', 'name': 'Test Customer'},
    );
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
  });

  testWidgets('the wheel offers only the cuisines the kitchens declare', (WidgetTester tester) async {
    await pumpFoodHome(tester);
    expect(find.byType(FoodHomeScreen), findsOneWidget);
    expect(stubSaw('GET', '/restaurants'), isTrue);

    expect(find.text('Eat what makes you happy'), findsOneWidget);
    // Derived from the unfiltered feed and sorted, so all five appear and in that
    // order — nothing here is a cuisine name typed into this file.
    for (final String cuisine in <String>['Biryani', 'Chinese', 'Momo', 'North Indian', 'Pizza']) {
      expect(_wheelLabel(cuisine), findsOneWidget);
    }
    expect(find.text('Browse all'), findsOneWidget);

    // Fabrication guard: the reference's address greeting, invented total,
    // promoted stamp, per-person price, safety badges and tab labels.
    expect(find.textContaining('for one'), findsNothing);
    expect(find.text('Promoted'), findsNothing);
    expect(find.textContaining('restaurants around you'), findsNothing);
    expect(find.text('MAX Safety'), findsNothing);
    expect(find.text('PRO'), findsNothing);
    expect(find.text('Delivering to Home'), findsNothing);
    // The count that is painted is the number of rows actually returned.
    expect(find.text('3 places'), findsOneWidget);
  });

  testWidgets('a cuisine tap filters through the endpoint, not in memory', (WidgetTester tester) async {
    await pumpFoodHome(tester);
    expect(_cuisineLabelColor(tester, 'Momo'), RestaurantTheme.charcoal);

    await tester.tap(_wheelLabel('Momo'));
    await settle(tester);

    expect(stubSaw('GET', 'cuisine=Momo'), isTrue);
    // Selected cuisine is brand structure, not the service orange.
    expect(_cuisineLabelColor(tester, 'Momo'), _brand);
    expect(_cuisineLabelColor(tester, 'Momo'), isNot(RestaurantTheme.serviceAccent));
    expect(find.text('Momo spots'), findsOneWidget);
    expect(find.text('1 place'), findsOneWidget);

    await tester.tap(find.text('All cuisines'));
    await settle(tester);

    expect(_cuisineLabelColor(tester, 'Momo'), RestaurantTheme.charcoal);
    expect(find.text('All restaurants'), findsOneWidget);
    expect(find.text('3 places'), findsOneWidget);
  });

  testWidgets('a card paints only the fields that restaurant has', (WidgetTester tester) async {
    // A tall viewport, not a tall phone: the list builds lazily, so every one of
    // the three cards has to be in the tree for the per-field assertions to mean
    // anything. The axis under test stays the 393 px width.
    await pumpFoodHome(tester, logicalSize: const Size(393, 1400));

    // No star anywhere: the reference's rating pill has no source behind it, so
    // even the kitchens whose fixture rows once carried 4.1 and 3.6 paint none.
    expect(find.byIcon(Icons.star_rounded), findsNothing);
    expect(find.text('4.1'), findsNothing);
    expect(find.text('3.6'), findsNothing);
    expect(find.text('4.8'), findsNothing);
    // The headline sorted that default, so it names the list instead.
    expect(find.text('Top rated restaurants'), findsNothing);

    // One chip per declared window, formatted from the integer the endpoint sent.
    // The card with no declared window has no chip, and no placeholder minute
    // figure stands in for it.
    expect(find.text('35 min'), findsOneWidget);
    expect(find.text('25 min'), findsOneWidget);
    expect(
      find.byWidgetPredicate((Widget w) => w is Text && (w.data?.endsWith(' min') ?? false)),
      findsNWidgets(2),
    );
    // OPEN / CLOSED is the real `isOpen` flag: two open, one closed.
    expect(find.text('● OPEN'), findsNWidgets(2));
    expect(find.text('● CLOSED'), findsOneWidget);
    // Address is a real column; the card without one paints no invented street.
    expect(find.text('Zarkham, Aizawl'), findsOneWidget);
    expect(find.text('Bungpal, Aizawl'), findsOneWidget);

    // A declared banner reaches the band as a network image; an undeclared one
    // renders the letter plate alone rather than a stock picture.
    expect(tester.widget<FoodLetterTile>(_cardTile('rest_1')).imageUrl,
        'https://images.example.test/zirkhal-biryani.jpg');
    expect(
      find.descendant(of: _cardTile('rest_1'), matching: find.byType(Image)),
      findsOneWidget,
    );
    expect(tester.widget<FoodLetterTile>(_cardTile('rest_2')).imageUrl, isNull);
    expect(
      find.descendant(of: _cardTile('rest_2'), matching: find.byType(Image)),
      findsNothing,
    );

    // On a phone the cards stack one per row.
    expect(_cardTop(tester, 'Pizza Point'),
        greaterThan(_cardTop(tester, 'Zirkhal Biryani House')));

    // The card still opens that restaurant's own menu.
    await tester.tap(find.text('Zirkhal Biryani House'));
    await settle(tester);
    expect(find.byType(RestaurantMenuScreen), findsOneWidget);
    expect(stubSaw('GET', '/restaurants/rest_1/menu'), isTrue);
    expect(find.text('Chicken Biryani'), findsOneWidget);
    // The page formats the window the card was handed — the same integer, not a
    // second algorithm and not a range invented for the checkout screen — and it
    // still paints no star.
    expect(find.text('• Delivery in 35 min'), findsOneWidget);
    expect(find.byIcon(Icons.star_rounded), findsNothing);
  });

  testWidgets('search asks the endpoint for results', (WidgetTester tester) async {
    await pumpFoodHome(tester);

    await tester.enterText(find.widgetWithText(TextField, 'Search restaurants or cuisines...'), 'momo');
    for (var i = 0; i < 12; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }

    expect(stubSaw('GET', 'search=momo'), isTrue);
    expect(find.text('Results for "momo"'), findsOneWidget);
    expect(find.text('Momo Corner'), findsOneWidget);
    expect(find.text('Pizza Point'), findsNothing);
  });

  testWidgets('a tablet width keeps the wheel and the cards', (WidgetTester tester) async {
    await pumpFoodHome(tester, logicalSize: const Size(834, 1112));
    expect(find.byType(FoodHomeScreen), findsOneWidget);
    expect(find.text('Eat what makes you happy'), findsOneWidget);
    expect(find.text('North Indian'), findsOneWidget);
    expect(find.text('Zirkhal Biryani House'), findsOneWidget);
    expect(find.text('Momo Corner'), findsOneWidget);
    // Two cards share a row once the width allows it, instead of one band
    // stretched across the whole tablet.
    expect(_cardTop(tester, 'Zirkhal Biryani House'), _cardTop(tester, 'Pizza Point'));
  });
}
