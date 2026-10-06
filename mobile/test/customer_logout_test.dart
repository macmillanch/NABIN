import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/features/profile/presentation/screens/profile_screen.dart';

import 'support/http_stub.dart';

// "Log Out of NABIN" popped a confirmation dialog, walked to '/' and stopped. It never
// called POST /api/auth/logout — the route exists and invalidates the token server-side —
// and never cleared SessionManager, so the bearer token stayed attached to every later
// request and the process went on believing it was authenticated.
//
// The navigation alone satisfied "the button does something", so both halves are asserted:
// the request leaving, and the local session being gone.

const Map<String, dynamic> _user = <String, dynamic>{
  'id': 'usr_real_42',
  'name': 'Lalthanmawli Vanminuwa',
  'phone': '+91 94360 11223',
};

void serve({bool logoutOk = true}) {
  stubHandler = (String method, Uri url, String _) {
    final String path = url.path;
    if (path.contains('/auth/me')) {
      return (
        200,
        jsonEncode(<String, dynamic>{
          'success': true,
          'role': 'CUSTOMER',
          'user': _user,
          'token': 'test-token',
        })
      );
    }
    if (path.contains('/customer/activity')) {
      return (
        200,
        jsonEncode(<String, dynamic>{'success': true, 'items': <dynamic>[]})
      );
    }
    if (path.contains('/auth/logout')) {
      if (!logoutOk) {
        return (500, jsonEncode(<String, dynamic>{'success': false, 'error': 'store unavailable'}));
      }
      return (200, jsonEncode(<String, dynamic>{'success': true, 'message': 'Logged out successfully.'}));
    }
    return (200, '{"success":true}');
  };
}

/// The screen navigates with `context.go`, so it needs a real router — and the router is
/// also how the test sees that it arrived anywhere at all.
GoRouter router() => GoRouter(
      initialLocation: '/profile',
      routes: <RouteBase>[
        GoRoute(
          path: '/',
          builder: (BuildContext _, __) => const Scaffold(body: Text('LANDING')),
        ),
        GoRoute(
          path: '/profile',
          builder: (BuildContext _, __) => const ProfileScreen(),
        ),
      ],
    );

Future<void> pumpProfile(WidgetTester tester) async {
  // A phone viewport: the trigger sits at the foot of a long list, and the 800x600 default
  // surface leaves it unbuilt, which reads as "the button doesn't exist".
  tester.view.physicalSize = const Size(390 * 3, 2000 * 3);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(MaterialApp.router(routerConfig: router()));
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

Future<void> openDialog(WidgetTester tester) async {
  final Finder trigger = find.text('Log Out of NABIN');
  await tester.dragUntilVisible(trigger, find.byType(ListView).first, const Offset(0, -400));
  await tester.pump();
  await tester.tap(trigger);
  await tester.pump();
  expect(
    find.text('Are you sure you want to log out of your NABIN account?'),
    findsOneWidget,
  );
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    serve();
    SessionManager.instance.saveSession(
      token: 'test-token',
      user: <String, dynamic>{'id': 'usr_real_42', 'name': 'Lalthanmawli Vanminuwa'},
    );
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
  });

  group('confirming', () {
    testWidgets('tells the backend the session is over', (tester) async {
      await pumpProfile(tester);
      expect(stubSaw('GET', '/auth/me'), isTrue);

      await openDialog(tester);
      await tester.tap(find.widgetWithText(ElevatedButton, 'Log Out'));
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(stubSaw('POST', '/auth/logout'), isTrue);
    });

    testWidgets('drops the local session, so nothing is authenticated any more', (tester) async {
      await pumpProfile(tester);

      await openDialog(tester);
      await tester.tap(find.widgetWithText(ElevatedButton, 'Log Out'));
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(stubSaw('POST', '/auth/logout'), isTrue);
      expect(SessionManager.instance.isAuthenticated, isFalse);
      expect(SessionManager.instance.token, isNull);
      expect(SessionManager.instance.currentUser, isNull);
    });

    testWidgets('and leaves the profile screen', (tester) async {
      await pumpProfile(tester);

      await openDialog(tester);
      await tester.tap(find.widgetWithText(ElevatedButton, 'Log Out'));
      // Past the route transition (~300ms), or the profile page is still mid-fade and its
      // name is legitimately still on screen.
      for (var i = 0; i < 20; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }

      expect(stubSaw('POST', '/auth/logout'), isTrue);
      expect(find.text('LANDING'), findsOneWidget);
      expect(find.text('Lalthanmawli Vanminuwa'), findsNothing);
    });

    testWidgets('a refused logout still ends the local session', (tester) async {
      // The token must not survive because the server was unreachable: an app that keeps
      // signing requests with a session it just told the user to close is the worse failure.
      serve(logoutOk: false);
      await pumpProfile(tester);

      await openDialog(tester);
      await tester.tap(find.widgetWithText(ElevatedButton, 'Log Out'));
      for (var i = 0; i < 8; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(stubSaw('POST', '/auth/logout'), isTrue);
      expect(SessionManager.instance.isAuthenticated, isFalse);
    });
  });

  group('cancelling', () {
    testWidgets('revokes nothing and logs nobody out', (tester) async {
      await pumpProfile(tester);

      await openDialog(tester);
      await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
      await tester.pump();

      expect(stubSaw('POST', '/auth/logout'), isFalse);
      expect(SessionManager.instance.isAuthenticated, isTrue);
      expect(find.text('Lalthanmawli Vanminuwa'), findsWidgets);
    });
  });
}
