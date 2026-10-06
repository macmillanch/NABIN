import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/auth/presentation/screens/welcome_screen.dart';
import 'package:mobile/features/home/presentation/screens/customer_home_screen.dart';
import 'package:mobile/features/home/presentation/screens/customer_splash_screen.dart';

import 'support/http_stub.dart';

// The splash is a routing gate, and a gate must not lie about what it checked.
//
// The tempting version of this screen holds the frame for 1500ms for the look of
// loading, then walks on regardless of the session. This one reads
// `SessionManager.isAuthenticated` on the first frame and goes. So the tests here
// are about the decision and the honesty of the wait: signed out lands on welcome,
// signed in lands on home, the gate itself asks the network for nothing, and the
// frame it paints claims no ranking, no install count and no delivery promise.

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 14; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

Future<void> pumpSplash(
  WidgetTester tester, {
  Size logicalSize = const Size(393, 852),
}) async {
  tester.view.physicalSize = logicalSize * 3;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  appRouter.go('/splash');
  await tester.pumpWidget(
    ProviderScope(child: MaterialApp.router(routerConfig: appRouter)),
  );
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    SessionManager.instance.clearSession();
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
  });

  testWidgets('the gate routes on the next frame, not on a timer', (WidgetTester tester) async {
    await pumpSplash(tester);

    // The first frame is the splash, and what follows are zero-duration pumps: the
    // welcome route is in the tree within two of them. A splash that held the frame
    // for the look of loading (`Future.delayed`, a `Timer`) could not do that —
    // those only fire once the clock is advanced. The splash then leaves with its
    // route animation, which is the router's beat, not the gate's.
    expect(find.byType(CustomerSplashScreen), findsOneWidget);
    await tester.pump();
    await tester.pump();
    expect(find.byType(WelcomeScreen), findsOneWidget);
    await settle(tester);
    expect(find.byType(CustomerSplashScreen), findsNothing);
  });

  testWidgets('signed out it lands on welcome and asked the network for nothing',
      (WidgetTester tester) async {
    await pumpSplash(tester);
    stubSeen.clear();
    await settle(tester);

    expect(find.byType(WelcomeScreen), findsOneWidget);
    // The decision came from the session this process already holds. A request
    // here would mean the gate was pretending to verify.
    expect(stubSeen, isEmpty);
  });

  testWidgets('a saved session lands on the app home', (WidgetTester tester) async {
    SessionManager.instance.saveSession(
      token: 'test-token',
      user: <String, dynamic>{'id': 'usr_test', 'name': 'Lalthanmangi Ralte'},
    );
    await pumpSplash(tester);
    await settle(tester);

    expect(find.byType(CustomerSplashScreen), findsNothing);
    expect(find.byType(WelcomeScreen), findsNothing);
    expect(find.byType(CustomerHomeScreen), findsOneWidget);
  });

  testWidgets('the frame it paints is the wordmark and the four services',
      (WidgetTester tester) async {
    await pumpSplash(tester);

    expect(find.text('NABIN'), findsOneWidget);
    expect(find.text('Ride  •  Food  •  Grocery  •  Parcel'), findsOneWidget);
    // An indeterminate bar: the gate has no progress to report.
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    // Nothing to tap, and nothing to fill in — the splash is not a login screen.
    expect(find.byType(TextFormField), findsNothing);
    expect(find.byType(ElevatedButton), findsNothing);

    for (final String claim in <String>[
      'India',
      '#1',
      'Rated',
      '4.8',
      'downloads',
      'Downloaded',
      'million',
      'Delivery in',
      'minutes',
    ]) {
      expect(find.textContaining(claim), findsNothing, reason: '$claim is not a measured fact');
    }
  });

  testWidgets('the gate does not walk back into itself', (WidgetTester tester) async {
    await pumpSplash(tester);
    await settle(tester);
    expect(find.byType(WelcomeScreen), findsOneWidget);

    // The loop this screen exists to avoid: routing to a location that re-mounts
    // the splash, which routes again, forever. Another half-second of frames and
    // the gate is still gone.
    await settle(tester);
    expect(find.byType(CustomerSplashScreen), findsNothing);
    expect(find.byType(WelcomeScreen), findsOneWidget);
  });

  testWidgets('the gate holds at phone and tablet widths', (WidgetTester tester) async {
    for (final Size size in <Size>[const Size(393, 852), const Size(834, 1112)]) {
      SessionManager.instance.clearSession();
      await pumpSplash(tester, logicalSize: size);
      expect(find.text('NABIN'), findsOneWidget);
      expect(tester.takeException(), isNull, reason: 'overflow at ${size.width}px wide');
      await settle(tester);
    }
  });
}
