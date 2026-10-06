import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/core/router/restaurant_router.dart';

import 'support/http_stub.dart';

// -----------------------------------------------------------------------------
// #135 — the merchant's own discovery declaration.
//
// This is the Flutter side of Merchant UI -> PATCH /api/merchant/:id/profile ->
// the stored row -> reflected back. The screen must READ the merchant's stored
// metadata, SEND a validated PATCH, and update the form FROM THE SERVER'S ANSWER —
// never from what was typed, and never as a success the API did not grant.
// -----------------------------------------------------------------------------

const String kRestaurantId = 'mnr_rest_1';

/// The row as the dashboard route returns it (snake_case merchant columns).
Map<String, dynamic> _dashboardRow({
  List<dynamic>? cuisines,
  Object? coverImageUrl,
  Object? deliveryMinutes,
}) {
  return <String, dynamic>{
    'success': true,
    'restaurant': <String, dynamic>{
      'id': kRestaurantId,
      'name': 'Test Kitchen',
      'cuisines': cuisines ?? <dynamic>[],
      'cover_image_url': coverImageUrl,
      'standard_delivery_minutes': deliveryMinutes,
    },
  };
}

/// The row as the PATCH route returns it (camelCase, the database.js shape).
Map<String, dynamic> _patchResponse(Map<String, dynamic> restaurant) {
  return <String, dynamic>{'success': true, 'restaurant': restaurant};
}

/// Default: a fully wired restaurant merchant whose dashboard carries stored metadata.
void _defaultHandler({
  (int, String)? Function(String method, Uri url, String body)? override,
}) {
  stubHandler = (method, url, body) {
    if (override != null) {
      final handled = override(method, url, body);
      if (handled != null) return handled;
    }
    final path = url.path;
    if (method == 'GET' && path.endsWith('/merchant/services')) {
      return (200, jsonEncode({
        'success': true,
        'merchantId': kRestaurantId,
        'services': ['RESTAURANT'],
        'profile': {'name': 'Test Kitchen'},
        'isOpen': true,
      }));
    }
    if (method == 'GET' && path.endsWith('/orders')) {
      return (200, jsonEncode({'success': true, 'orders': <dynamic>[]}));
    }
    if (method == 'GET' && path.endsWith('/merchant/catalog')) {
      return (200, jsonEncode({'success': true, 'products': <dynamic>[]}));
    }
    if (method == 'GET' && path.endsWith('/dashboard')) {
      return (200, jsonEncode(_dashboardRow(
        cuisines: <dynamic>['North Indian', 'Mughlai'],
        coverImageUrl: 'https://cdn.example.com/banner.jpg',
        deliveryMinutes: 45,
      )));
    }
    if (method == 'PATCH' && path.endsWith('/profile')) {
      // Echo a plausible stored row unless the test overrode it.
      final sent = jsonDecode(body) as Map<String, dynamic>;
      return (200, jsonEncode(_patchResponse(<String, dynamic>{
        'id': kRestaurantId,
        'name': 'Test Kitchen',
        'cuisines': sent['cuisines'],
        'coverImageUrl': sent['coverImageUrl'],
        'standardDeliveryMinutes': sent['standardDeliveryMinutes'],
      })));
    }
    return (200, '{"success":true}');
  };
}

/// The console renders one named store; a cold start must be signed in or the
/// router redirects to /login. We are the merchant, so seed that session.
///
/// The Profile tab is a scroll column and the Save button sits low in it; at the
/// default 800x600 test surface the button center falls off-screen and `tap()`
/// misses it. A tall logical surface (500x1000) keeps the whole discovery card
/// painted so every assertion — including the reflected server value — is on screen.
Future<void> pumpMerchantShell(WidgetTester tester) async {
  tester.view.physicalSize = const Size(2400, 3000);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);
  SessionManager.instance.saveSession(
    token: 'merchant-token',
    user: <String, dynamic>{'id': kRestaurantId, 'restaurantId': kRestaurantId, 'name': 'Test Kitchen'},
  );
  await tester.pumpWidget(MaterialApp.router(routerConfig: restaurantRouter));
  // A loading spinner never settles, so drive the event loop with fixed pumps.
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

Future<void> openProfileTab(WidgetTester tester) async {
  await tester.tap(
    find.descendant(
      of: find.byType(NavigationBar),
      matching: find.text('Profile'),
    ),
  );
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

/// The cover field is the one whose stored value / hint is the banner URL.
Finder coverField(WidgetTester tester) =>
    find.widgetWithText(TextField, 'https://cdn.example.com/banner.jpg');

Map<String, dynamic>? patchBody() {
  final raw = stubBodyFor('PATCH', '/profile');
  return raw == null ? null : jsonDecode(raw) as Map<String, dynamic>;
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
  });

  group('reads the merchant\'s own stored metadata (no fabrication)', () {
    testWidgets('the Profile editor is seeded from the dashboard row', (tester) async {
      _defaultHandler();
      await pumpMerchantShell(tester);
      await openProfileTab(tester);

      // Cuisines render as chips from the stored array...
      expect(find.text('North Indian'), findsOneWidget);
      expect(find.text('Mughlai'), findsOneWidget);
      // ...the cover and delivery fields carry the stored values...
      expect(find.text('https://cdn.example.com/banner.jpg'), findsOneWidget);
      expect(find.text('45'), findsOneWidget);
      // ...and the read went to the merchant's own dashboard, not a hard-coded store.
      expect(stubSaw('GET', '/merchant/$kRestaurantId/dashboard'), isTrue);
    });

    testWidgets('a merchant with no declared metadata shows empty fields, not a placeholder',
        (tester) async {
      _defaultHandler(override: (method, url, body) {
        if (method == 'GET' && url.path.endsWith('/dashboard')) {
          return (200, jsonEncode(_dashboardRow()));
        }
        return null;
      });
      await pumpMerchantShell(tester);
      await openProfileTab(tester);

      expect(find.textContaining('None declared yet'), findsOneWidget);
      // The hint text is present only because the field itself is empty.
      expect(find.textContaining('banner.jpg'), findsOneWidget); // hint
      expect(find.text('45'), findsNothing); // no invented delivery time
    });

    testWidgets('a refused read shows a retry state, not a silent empty form', (tester) async {
      _defaultHandler(override: (method, url, body) {
        if (method == 'GET' && url.path.endsWith('/dashboard')) {
          return (403, jsonEncode({'success': false, 'code': 'MERCHANT_MISMATCH'}));
        }
        return null;
      });
      await pumpMerchantShell(tester);
      await openProfileTab(tester);

      expect(find.textContaining('Could not load your declared details'), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
    });
  });

  group('save sends a validated PATCH to the merchant\'s own profile', () {
    testWidgets('the PATCH body carries all three fields, camelCase, to /:id/profile',
        (tester) async {
      _defaultHandler();
      await pumpMerchantShell(tester);
      await openProfileTab(tester);

      await tester.tap(find.text('Save discovery details'));
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(stubSaw('PATCH', '/merchant/$kRestaurantId/profile'), isTrue);
      expect(patchBody(), <String, dynamic>{
        'cuisines': ['North Indian', 'Mughlai'],
        'coverImageUrl': 'https://cdn.example.com/banner.jpg',
        'standardDeliveryMinutes': 45,
      });
    });

    testWidgets('existing cuisines are preserved on an unrelated edit', (tester) async {
      _defaultHandler();
      await pumpMerchantShell(tester);
      await openProfileTab(tester);

      // Change only the delivery time; the declared cuisines must ride along intact.
      final delivery = find.widgetWithText(TextField, '45');
      await tester.enterText(delivery, '30');
      await tester.tap(find.text('Save discovery details'));
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      final body = patchBody()!;
      expect(body['cuisines'], ['North Indian', 'Mughlai']);
      expect(body['standardDeliveryMinutes'], 30);
    });

    testWidgets('clearing the cover field sends null (the withdraw case)', (tester) async {
      _defaultHandler();
      await pumpMerchantShell(tester);
      await openProfileTab(tester);

      await tester.enterText(coverField(tester), '');
      await tester.tap(find.text('Save discovery details'));
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(patchBody()!['coverImageUrl'], isNull);
    });

    testWidgets('an invalid delivery time is refused before any request leaves',
        (tester) async {
      _defaultHandler();
      await pumpMerchantShell(tester);
      await openProfileTab(tester);

      await tester.enterText(find.widgetWithText(TextField, '45'), '190');
      await tester.tap(find.text('Save discovery details'));
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      // The domain range (5-180) refuses 190 locally...
      expect(find.textContaining('between'), findsOneWidget);
      // ...and no PATCH was ever attempted for a value we know the server rejects.
      expect(stubSaw('PATCH', '/profile'), isFalse);
    });

    testWidgets('an invalid cover URL is refused before any request leaves', (tester) async {
      _defaultHandler();
      await pumpMerchantShell(tester);
      await openProfileTab(tester);

      await tester.enterText(coverField(tester), 'ftp://bad');
      await tester.tap(find.text('Save discovery details'));
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(stubSaw('PATCH', '/profile'), isFalse);
      expect(find.textContaining('http://'), findsOneWidget);
    });
  });

  group('the form reflects the SERVER answer, not the typed value', () {
    testWidgets('a successful save repaints from the returned row', (tester) async {
      _defaultHandler(override: (method, url, body) {
        if (method == 'PATCH' && url.path.endsWith('/profile')) {
          // Server normalises the window to 40 and returns the camelCase stored row.
          return (200, jsonEncode(_patchResponse(<String, dynamic>{
            'id': kRestaurantId,
            'name': 'Test Kitchen',
            'cuisines': <dynamic>['North Indian', 'Mughlai'],
            'coverImageUrl': 'https://cdn.example.com/banner.jpg',
            'standardDeliveryMinutes': 40,
          })));
        }
        return null;
      });
      await pumpMerchantShell(tester);
      await openProfileTab(tester);

      await tester.enterText(find.widgetWithText(TextField, '45'), '30');
      await tester.tap(find.text('Save discovery details'));
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      // The screen shows 40 (what the server stored), NOT 30 (what was typed).
      expect(find.text('40'), findsOneWidget);
      expect(find.text('30'), findsNothing);
      expect(find.textContaining('Saved. Customers'), findsOneWidget);
    });

    testWidgets('a failed save says "Not saved" and does NOT mutate the form', (tester) async {
      _defaultHandler(override: (method, url, body) {
        if (method == 'PATCH' && url.path.endsWith('/profile')) {
          return (500, jsonEncode({'success': false, 'error': 'Store unavailable'}));
        }
        return null;
      });
      await pumpMerchantShell(tester);
      await openProfileTab(tester);

      await tester.enterText(find.widgetWithText(TextField, '45'), '30');
      await tester.tap(find.text('Save discovery details'));
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(find.textContaining('Not saved'), findsOneWidget);
      expect(find.textContaining('Saved. Customers'), findsNothing);
      // A refusal is not a save: no success snackbar, and the server's stored row
      // (delivery 45) was NOT silently applied to make the edit look persisted.
      expect(find.text('45'), findsNothing);
    });

    testWidgets('a cross-merchant 403 is surfaced as a failure, not a save', (tester) async {
      _defaultHandler(override: (method, url, body) {
        if (method == 'PATCH' && url.path.endsWith('/profile')) {
          return (403, jsonEncode({'success': false, 'code': 'MERCHANT_MISMATCH'}));
        }
        return null;
      });
      await pumpMerchantShell(tester);
      await openProfileTab(tester);

      await tester.tap(find.text('Save discovery details'));
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(find.textContaining('Not saved'), findsOneWidget);
    });
  });

  group('cuisine add/remove', () {
    testWidgets('adding a cuisine appends a chip and clears the input', (tester) async {
      _defaultHandler();
      await pumpMerchantShell(tester);
      await openProfileTab(tester);

      final cuisineInput = find.ancestor(
        of: find.text('Add a cuisine (e.g. Mughlai)'),
        matching: find.byType(TextField),
      );
      await tester.enterText(cuisineInput, 'Chinese');
      await tester.tap(find.byIcon(Icons.add_circle_outline));
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(find.text('Chinese'), findsOneWidget);
      expect(find.text('North Indian'), findsOneWidget);
    });

    testWidgets('a duplicate cuisine is refused with a message', (tester) async {
      _defaultHandler();
      await pumpMerchantShell(tester);
      await openProfileTab(tester);

      final cuisineInput = find.ancestor(
        of: find.text('Add a cuisine (e.g. Mughlai)'),
        matching: find.byType(TextField),
      );
      await tester.enterText(cuisineInput, 'mughlai');
      await tester.tap(find.byIcon(Icons.add_circle_outline));
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      // The duplicate never joins the list as a third chip.
      expect(find.text('Mughlai'), findsOneWidget);
      expect(find.textContaining('already declared'), findsOneWidget);
    });
  });
}
