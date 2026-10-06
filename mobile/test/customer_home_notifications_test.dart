import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/core/network/session_manager.dart';

import 'customer_home_config_test.dart' as home;
import 'support/http_stub.dart';

// The Home bell used to open a sheet whose two rows were `const Text` literals
// asserting live trip and food-preparation state, over a read path the app
// already has (GET /api/notifications, keyed to the bearer token). These tests
// pin the sheet to that endpoint.

Map<String, dynamic> _notification({
  String id = 'ntf_real_1',
  String title = 'Your order has reached the pickup point',
  String body = 'NABIN Food is moving your order along.',
  bool isRead = false,
}) {
  return <String, dynamic>{
    'id': id,
    'title': title,
    'body': body,
    'isRead': isRead,
    'createdAt': '2026-10-04T09:12:00.000Z',
  };
}

/// Pumps Home, taps the bell, and lets the sheet's read settle.
Future<void> openBell(WidgetTester tester, {Object? server}) async {
  await home.pumpHome(tester, body: <String, dynamic>{
    'services': <Map<String, dynamic>>[
      {'id': 'rides', 'name': 'NABIN Mobility & Rides', 'status': 'ACTIVE'},
    ],
  });
  await tester.tap(find.byIcon(Icons.notifications_outlined));
  await _settle(tester);
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 20));
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

  group('the bell reads the notifications endpoint', () {
    testWidgets('renders the server\'s own rows', (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/notifications')) {
          return (200, jsonEncode({
            'success': true,
            'notifications': <Map<String, dynamic>>[
              _notification(),
              _notification(
                id: 'ntf_real_2',
                title: 'Parcel delivered to the doorstep',
              ),
            ],
            'total': 2,
          }));
        }
        return (200, '{"success":true}');
      };

      await openBell(tester);

      // A sheet in an error state would also satisfy "the fabricated copy is
      // gone", so prove the request actually left first.
      expect(stubSaw('GET', '/notifications'), isTrue);
      expect(find.text('Your order has reached the pickup point'),
          findsOneWidget);
      expect(find.text('Parcel delivered to the doorstep'), findsOneWidget);
    });

    testWidgets('never shows the invented live-state rows', (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/notifications')) {
          return (200, jsonEncode({
            'success': true,
            'notifications': <Map<String, dynamic>>[_notification()],
            'total': 1,
          }));
        }
        return (200, '{"success":true}');
      };

      await openBell(tester);

      expect(stubSaw('GET', '/notifications'), isTrue);
      expect(find.text('Trip update: your driver is on the way'), findsNothing);
      expect(
          find.text('Your food order is being prepared'), findsNothing);
      // Screen-wide now that Home's own rails read real endpoints: 'Ritz
      // Restaurant' used to be painted by a const nearby-places card and a const
      // activity row as well, and both are gone.
    });

    testWidgets('an empty feed says so instead of inventing rows',
        (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/notifications')) {
          return (200, jsonEncode({
            'success': true,
            'notifications': <Map<String, dynamic>>[],
            'total': 0,
          }));
        }
        return (200, '{"success":true}');
      };

      await openBell(tester);

      expect(stubSaw('GET', '/notifications'), isTrue);
      expect(find.textContaining('No notifications'), findsOneWidget);
    });

    testWidgets('a dead feed is an error, not a silent empty',
        (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/notifications')) {
          return (500, '{"success":false,"error":"boom"}');
        }
        return (200, '{"success":true}');
      };

      await openBell(tester);

      expect(stubSaw('GET', '/notifications'), isTrue);
      expect(find.textContaining('Retry'), findsOneWidget);
      expect(find.textContaining('No notifications'), findsNothing);
    });

    testWidgets('a long server title survives a phone width',
        (tester) async {
      // 390 CSS px is the width the app actually ships at, and a ListTile whose
      // subtitle is a Column is a standing RenderFlex overflow once the server's
      // own copy is long. Pixel goldens are blocked here by google_fonts, so the
      // assertion is that nothing throws while painting.
      tester.view.physicalSize = const Size(390 * 3, 844 * 3);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/notifications')) {
          return (200, jsonEncode({
            'success': true,
            'notifications': <Map<String, dynamic>>[
              _notification(
                title: 'Your grocery order #NGB-2026-10-04-0071 has been '
                    'handed over to the delivery partner at the dark store in '
                    'Chhinga, Aizawl and is on the way to Kamalanagar',
                body: 'The partner is carrying temperature-sensitive items, so '
                    'please be present to receive them and check the seal.',
              ),
            ],
            'total': 1,
          }));
        }
        return (200, '{"success":true}');
      };

      await openBell(tester);

      expect(stubSaw('GET', '/notifications'), isTrue);
      expect(tester.takeException(), isNull);
    });
  });
}
