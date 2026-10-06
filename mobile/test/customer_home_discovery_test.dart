import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/core/network/session_manager.dart';

import 'customer_home_config_test.dart' as home;
import 'support/http_stub.dart';

// Home's two discovery rails, its "Ongoing trip" banner and its Recent activity list
// were `const` literals: three restaurants and three grocery stores with ratings and
// ETAs no endpoint returns, three orders the signed-in customer never placed, and a
// banner asserting a live trip for a customer who has none. All four now read the
// endpoints the app already has — GET /restaurants, GET /grocery/products and
// GET /customer/activity — which is the same fix already landed for the bell.
//
// Every test asserts the request actually left before asserting on content: a rail in
// its error state also satisfies "the invented rows are gone", so without the saw-check
// a dead transport would pass for a wired-up screen.

const List<Map<String, dynamic>> allServicesActive = <Map<String, dynamic>>[
  <String, dynamic>{'id': 'rides', 'name': 'NABIN Mobility & Rides', 'status': 'ACTIVE'},
  <String, dynamic>{'id': 'food', 'name': 'NABIN Food', 'status': 'ACTIVE'},
  <String, dynamic>{'id': 'grocery', 'name': 'NABIN Grocery', 'status': 'ACTIVE'},
  <String, dynamic>{'id': 'parcel', 'name': 'NABIN Parcel', 'status': 'ACTIVE'},
];

/// The names hardcoded in Home before this change. Nothing here is a business fact.
const List<String> inventedPlaces = <String>[
  'Ritz Restaurant',
  'Zawlsaw Restaurant',
  'Bakhtawar Restaurant',
  'Mizoram Super Bazaar',
  'Dor-Sangna Fresh Mart',
  'Buota Daily Needs',
];

const List<String> inventedActivity = <String>[
  'Ride to Roosevelt Park',
  'Food from Ritz Restaurant',
  'Groceries from Super Bazaar',
];

/// A row in the shape `GET /api/restaurants` replies with: the projection is
/// id, name, cuisines, coverImageUrl, deliveryMinutes, isOpen and address. There
/// is no rating key to send, because the endpoint projects no rating column.
Map<String, dynamic> _restaurant({
  String id = 'rst_real_1',
  String name = 'Zothanangli Kitchen',
  Object? deliveryMinutes = 26,
  Object? coverImageUrl,
  Object? address = 'Serkawn, Aizawl',
  List<String> cuisines = const <String>['Mizo', 'North Indian'],
}) {
  return <String, dynamic>{
    'id': id,
    'name': name,
    'cuisines': cuisines,
    'deliveryMinutes': deliveryMinutes,
    'coverImageUrl': coverImageUrl,
    'address': address,
    'isOpen': true,
  };
}

Map<String, dynamic> _product({
  String id = 'prd_real_1',
  String name = 'Atta, 5 kg pack',
  String merchantName = 'Sangi-thei Stores',
  String category = 'Staples',
  Object? currentPrice = 248,
}) {
  return <String, dynamic>{
    'id': id,
    'name': name,
    'merchantName': merchantName,
    'category': category,
    'currentPrice': currentPrice,
    'mrp': currentPrice,
    'isAvailable': true,
    'stockQty': 40,
    'unit': 'kg',
  };
}

Map<String, dynamic> _activity({
  String id = 'ord_real_1',
  String service = 'RIDE',
  String title = 'Ride to Lamrei',
  Object? amount = 90,
  Object? placedAt = '2026-10-03T15:10:00.000Z',
  bool active = false,
  String status = 'COMPLETED',
}) {
  return <String, dynamic>{
    'id': id,
    'service': service,
    'title': title,
    'status': status,
    'amount': amount,
    'placedAt': placedAt,
    'active': active,
  };
}

/// Installs the per-endpoint responses. A feed left as `null` answers 200 with an
/// empty list, and `failFor` marks one feed dead so a test can prove the rail shows
/// its own error state rather than the invented rows.
void serve({
  List<Map<String, dynamic>>? restaurants,
  List<Map<String, dynamic>>? products,
  List<Map<String, dynamic>>? activity,
  String? failFor,
}) {
  stubHandler = (method, url, _) {
    final String path = url.path;
    if (failFor != null && path.contains(failFor)) {
      return (500, jsonEncode({'success': false, 'error': 'feed unavailable'}));
    }
    if (path.contains('/customer/activity')) {
      return (200, jsonEncode({
        'success': true,
        'items': activity ?? <Map<String, dynamic>>[],
        'dataSource': 'postgres',
      }));
    }
    if (path.contains('/restaurants')) {
      return (200, jsonEncode({
        'success': true,
        'restaurants': restaurants ?? <Map<String, dynamic>>[],
      }));
    }
    if (path.contains('/grocery/products')) {
      return (200, jsonEncode({
        'success': true,
        'products': products ?? <Map<String, dynamic>>[],
      }));
    }
    return (200, '{"success":true}');
  };
}

Future<void> pumpHome(WidgetTester tester) async {
  await home.pumpHome(tester, body: <String, dynamic>{
    'services': allServicesActive,
  });
  // Three independent reads start from initState; the tree needs frames to rebuild as
  // each lands. pumpAndSettle cannot be used — the rails paint a spinner while loading.
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    SessionManager.instance.saveSession(
      token: 'test-token',
      user: <String, dynamic>{'id': 'usr_real_42', 'name': 'Test Customer'},
    );
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
  });

  group('restaurant rail', () {
    testWidgets('renders the restaurants the backend returns', (tester) async {
      serve(restaurants: <Map<String, dynamic>>[
        _restaurant(name: 'Zothanangli Kitchen'),
        _restaurant(id: 'rst_real_2', name: 'Sailo Vintage Restaurant', deliveryMinutes: 40),
      ]);

      await pumpHome(tester);

      expect(stubSaw('GET', '/restaurants'), isTrue);
      expect(find.text('Zothanangli Kitchen'), findsWidgets);
      expect(find.text('Sailo Vintage Restaurant'), findsWidgets);
      // The declared windows, formatted from the integers the endpoint sent.
      expect(find.text('26 min'), findsWidgets);
      expect(find.text('40 min'), findsWidgets);
      // No star on any card: the endpoint has no rating to paint.
      expect(find.byIcon(Icons.star_rounded), findsNothing);
    });

    testWidgets('never shows the invented listings', (tester) async {
      serve(restaurants: <Map<String, dynamic>>[_restaurant()]);

      await pumpHome(tester);

      expect(stubSaw('GET', '/restaurants'), isTrue);
      for (final String name in inventedPlaces) {
        expect(find.text(name), findsNothing, reason: '$name was a const literal');
      }
    });

    testWidgets('renders no ETA the backend did not send', (tester) async {
      // The clock icon belongs to the place card alone in this screen, so counting
      // it is the direct test of "a null column paints nothing" rather than a
      // placeholder the customer would read as a real figure.
      serve(restaurants: <Map<String, dynamic>>[
        _restaurant(name: 'No Metrics Kitchen', deliveryMinutes: null),
      ]);

      await pumpHome(tester);

      expect(stubSaw('GET', '/restaurants'), isTrue);
      expect(find.text('No Metrics Kitchen'), findsWidgets);
      expect(find.byIcon(Icons.star_rounded), findsNothing);
      expect(find.byIcon(Icons.schedule_rounded), findsNothing);
    });

    testWidgets('a dead read offers Retry instead of the invented rail', (tester) async {
      serve(failFor: '/restaurants');

      await pumpHome(tester);

      expect(stubSaw('GET', '/restaurants'), isTrue);
      expect(find.textContaining('restaurants'), findsWidgets);
      expect(find.textContaining('Retry'), findsWidgets);
      expect(find.text('Ritz Restaurant'), findsNothing);
    });
  });

  group('grocery rail', () {
    testWidgets('names the stores the product rows actually came from', (tester) async {
      serve(products: <Map<String, dynamic>>[
        _product(merchantName: 'Sangi-thei Stores'),
        _product(id: 'prd_real_2', name: 'Aizawl honey, 500 g', merchantName: 'Khuaing Lane Mart'),
        _product(id: 'prd_real_3', name: 'Rice, 25 kg bag', merchantName: 'Sangi-thei Stores'),
      ]);

      await pumpHome(tester);

      expect(stubSaw('GET', '/grocery/products'), isTrue);
      expect(find.text('Sangi-thei Stores'), findsWidgets);
      expect(find.text('Khuaing Lane Mart'), findsWidgets);
      // One card per distinct merchant, not one per product row.
      expect(find.text('Sangi-thei Stores'), findsNWidgets(1));
    });

    testWidgets('asserts no rating, ETA or delivery claim a store never reported',
        (tester) async {
      serve(products: <Map<String, dynamic>>[_product()]);

      await pumpHome(tester);

      expect(stubSaw('GET', '/grocery/products'), isTrue);
      expect(find.byIcon(Icons.star_rounded), findsNothing);
      expect(find.byIcon(Icons.schedule_rounded), findsNothing);
      for (final String name in inventedPlaces) {
        expect(find.text(name), findsNothing);
      }
    });

    testWidgets('an empty catalogue says so instead of inventing stores', (tester) async {
      serve();

      await pumpHome(tester);

      expect(stubSaw('GET', '/grocery/products'), isTrue);
      expect(find.textContaining('Retry'), findsNothing);
      expect(find.textContaining('No grocery stores'), findsWidgets);
    });
  });

  group('recent activity', () {
    testWidgets('renders the signed-in customer\'s own orders', (tester) async {
      serve(activity: <Map<String, dynamic>>[
        _activity(title: 'Ride to Lamrei', amount: 90),
        _activity(
          id: 'ord_real_2',
          service: 'FOOD',
          title: 'Food from Zothanangli Kitchen',
          amount: 260.5,
        ),
      ]);

      await pumpHome(tester);

      expect(stubSaw('GET', '/customer/activity'), isTrue);
      expect(find.text('Ride to Lamrei'), findsWidgets);
      expect(find.textContaining('₹90.00'), findsWidgets);
      expect(find.textContaining('₹260.50'), findsWidgets);
      for (final String row in inventedActivity) {
        expect(find.text(row), findsNothing, reason: '$row was a const literal');
      }
    });

    testWidgets('shows at most the three most recent rows', (tester) async {
      serve(activity: <Map<String, dynamic>>[
        for (var i = 1; i <= 5; i++)
          _activity(id: 'ord_real_$i', title: 'Order $i label', amount: 100 + i),
      ]);

      await pumpHome(tester);

      expect(stubSaw('GET', '/customer/activity'), isTrue);
      expect(find.text('Order 1 label'), findsWidgets);
      expect(find.text('Order 3 label'), findsWidgets);
      expect(find.text('Order 4 label'), findsNothing);
      expect(find.text('Order 5 label'), findsNothing);
    });

    testWidgets('a missing timestamp is admitted, not guessed', (tester) async {
      serve(activity: <Map<String, dynamic>>[
        _activity(title: 'Parcel to Dawki Vann Bazaar', placedAt: null),
      ]);

      await pumpHome(tester);

      expect(stubSaw('GET', '/customer/activity'), isTrue);
      // The exact phrase is the screen's own copy; what this pins is that Home
      // admits the timestamp is missing instead of drawing a plausible one.
      expect(find.textContaining('Time unrecorded'), findsWidgets);
    });

    testWidgets('a dead read is an error, not an empty history', (tester) async {
      serve(failFor: '/customer/activity');

      await pumpHome(tester);

      expect(stubSaw('GET', '/customer/activity'), isTrue);
      expect(find.textContaining('activity'), findsWidgets);
      expect(find.textContaining('Retry'), findsWidgets);
      expect(find.text('Ride to Roosevelt Park'), findsNothing);
    });
  });

  group('ongoing trip banner', () {
    testWidgets('stays hidden when the customer has no active job', (tester) async {
      serve(activity: <Map<String, dynamic>>[
        _activity(title: 'Ride to Lamrei', active: false),
      ]);

      await pumpHome(tester);

      expect(stubSaw('GET', '/customer/activity'), isTrue);
      expect(find.textContaining('Ongoing trip'), findsNothing);
      expect(find.text('Ongoing trip: Roosevelt Park'), findsNothing);
    });

    testWidgets('names the real active job when there is one', (tester) async {
      serve(activity: <Map<String, dynamic>>[
        _activity(title: 'Ride to Aputoi', active: true, status: 'ONGOING'),
      ]);

      await pumpHome(tester);

      expect(stubSaw('GET', '/customer/activity'), isTrue);
      expect(find.textContaining('Aputoi'), findsWidgets);
      expect(find.text('Track'), findsWidgets);
    });
  });

  group('phone layout', () {
    testWidgets('long backend names survive 390 px without a paint failure',
        (tester) async {
      tester.view.physicalSize = const Size(390 * 3, 844 * 3);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      serve(
        restaurants: <Map<String, dynamic>>[
          _restaurant(
            name: 'Sakhua Sai and Traditional Mizo Thutleng Cooking Partnership',
            address: 'Near Breadmanchak, Aizawl, Mizoram 796001',
            cuisines: const <String>['Mizo', 'North Indian', 'Chinese', 'Biryani'],
          ),
        ],
        products: <Map<String, dynamic>>[
          _product(
            name: 'Unmilled Red Rice from Tuipui Valley, 25 kg sack',
            merchantName: 'Bethany CHZ Veng Community Super Store',
          ),
        ],
        activity: <Map<String, dynamic>>[
          _activity(
            title: 'Instamart order from Sangi-thei Stores with sixteen line items',
            amount: 4123.45,
          ),
        ],
      );

      await pumpHome(tester);

      expect(stubSaw('GET', '/restaurants'), isTrue);
      expect(stubSaw('GET', '/grocery/products'), isTrue);
      expect(stubSaw('GET', '/customer/activity'), isTrue);
      expect(tester.takeException(), isNull);
    });
  });
}
