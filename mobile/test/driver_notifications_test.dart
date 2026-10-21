import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/features/notifications/presentation/screens/driver_notifications_screen.dart';
import 'package:mobile/features/notifications/presentation/screens/driver_notification_preferences_screen.dart';

import 'support/http_stub.dart';

// D19 regression lock: the Driver inbox and its preferences screen are bound to the five
// `GET/PUT /api/notifications*` routes and to nothing else.
//
// The feed rows and the preference labels below are the harness's stand-ins for what the
// platform sends; the assertions are about the opposite case — a screen that renders a row, a
// count, a saved flag or a read state the backend never confirmed.

Map<String, dynamic> _row({
  String id = 'ntf_drv_1',
  String title = 'Your payout for this week has been settled',
  String body = 'The settlement has been sent to your registered destination.',
  bool isRead = false,
  String notificationType = 'PAYOUT_SETTLED',
}) {
  return <String, dynamic>{
    'id': id,
    'title': title,
    'body': body,
    'isRead': isRead,
    'notificationType': notificationType,
    'createdAt': '2026-10-08T09:12:00.000Z',
  };
}

/// All thirteen flags the `notification_preferences` row actually holds.
Map<String, bool> _prefsRow({Map<String, bool> override = const {}}) {
  return <String, bool>{
    'ridesEnabled': true,
    'driverUpdatesEnabled': true,
    'parcelEnabled': true,
    'foodEnabled': true,
    'groceryEnabled': true,
    'paymentsEnabled': true,
    'promotionsEnabled': true,
    'supportEnabled': true,
    'systemEnabled': true,
    'pushEnabled': true,
    'inAppEnabled': true,
    'smsEnabled': true,
    'emailEnabled': true,
  }..addAll(override);
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 20));
  }
}

/// Runs the fake clock far enough for a deliberately delayed stub response to land, so no
/// timer is left pending when the test ends.
Future<void> _drain(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Widget _host(Widget child) => MaterialApp(home: child);

/// The thirteen rows do not fit one viewport, so a tap has to bring the switch on screen
/// first — `find` alone would hit-test the clip instead of the switch.
Future<void> _flip(WidgetTester tester, String key) async {
  final switchFinder = find.byKey(ValueKey('driver-notification-pref-switch-$key'));
  await tester.ensureVisible(switchFinder);
  await tester.pump();
  await tester.tap(switchFinder);
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    SessionManager.instance.saveSession(
      token: 'test-driver-token',
      user: <String, dynamic>{'id': 'drv_real_7', 'name': 'Test Partner', 'role': 'DRIVER'},
    );
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
  });

  group('the driver feed reads GET /api/notifications', () {
    testWidgets('renders the server\'s own rows and nothing else', (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/notifications')) {
          return (200, jsonEncode({
            'success': true,
            'notifications': <Map<String, dynamic>>[
              _row(),
              _row(
                id: 'ntf_drv_2',
                title: 'A new ride request is open near you',
                notificationType: 'RIDE_REQUEST',
              ),
            ],
            'total': 2,
            'unreadCount': 2,
          }));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(_host(const DriverNotificationsScreen()));
      await _settle(tester);

      // An error state would also satisfy "no invented rows", so prove the read left.
      expect(stubSaw('GET', '/notifications'), isTrue);
      expect(find.text('Your payout for this week has been settled'), findsOneWidget);
      expect(find.text('A new ride request is open near you'), findsOneWidget);
      // No row the backend did not send, and no count this screen made up.
      expect(find.text('No notifications yet'), findsNothing);
    });

    testWidgets('no id travels with the read', (tester) async {
      stubHandler = (method, url, _) => (200, jsonEncode({
            'success': true,
            'notifications': <Map<String, dynamic>>[],
            'total': 0,
            'unreadCount': 0,
          }));

      await tester.pumpWidget(_host(const DriverNotificationsScreen()));
      await _settle(tester);

      // Identity is the bearer token's; a client-supplied driver id would be a second,
      // client-controlled authorisation path.
      final path = stubSeen.firstWhere((s) => s.startsWith('GET '));
      expect(path, isNot(contains('drv_real_7')));
      expect(Uri.parse(path.substring(4)).queryParameters.containsKey('userId'), isFalse);
    });

    testWidgets('an empty feed is not an error, and offers nothing to act on',
        (tester) async {
      stubHandler = (method, url, _) => (200, jsonEncode({
            'success': true,
            'notifications': <Map<String, dynamic>>[],
            'total': 0,
            'unreadCount': 0,
          }));

      await tester.pumpWidget(_host(const DriverNotificationsScreen()));
      await _settle(tester);

      expect(stubSaw('GET', '/notifications'), isTrue);
      expect(find.text('No notifications yet'), findsOneWidget);
      // Nothing unread, so no "mark all as read" affordance.
      expect(find.byIcon(Icons.done_all_rounded), findsNothing);
      expect(find.text('Mark read'), findsNothing);
      expect(find.textContaining('Could not load'), findsNothing);
    });

    testWidgets('a refused feed is an error with the server\'s own words',
        (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/notifications')) {
          return (500, jsonEncode({
            'success': false,
            'error': 'Notification feed is unavailable right now.',
          }));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(_host(const DriverNotificationsScreen()));
      await _settle(tester);

      expect(stubSaw('GET', '/notifications'), isTrue);
      expect(find.text('Notification feed is unavailable right now.'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
      // The failure is never drawn as an inbox that happens to be empty.
      expect(find.text('No notifications yet'), findsNothing);
    });

    testWidgets('a missing timestamp renders as absent', (tester) async {
      stubHandler = (method, url, _) => (200, jsonEncode({
            'success': true,
            'notifications': <Map<String, dynamic>>[
              _row()..remove('createdAt'),
            ],
            'total': 1,
            'unreadCount': 1,
          }));

      await tester.pumpWidget(_host(const DriverNotificationsScreen()));
      await _settle(tester);

      expect(find.text('— Not available'), findsOneWidget);
    });
  });

  group('marking one read is a write the backend confirms', () {
    /// A feed whose row flips to read only once the PUT has arrived, so a screen that lied
    /// about the read would be caught by the following GET.
    void serveMutableFeed({bool refusePut = false}) {
      final read = <String>{};
      stubHandler = (method, url, _) {
        if (method == 'PUT' && url.path.endsWith('/read')) {
          if (refusePut) {
            return (404, jsonEncode({
              'success': false,
              'error': 'Notification not found or access denied.',
            }));
          }
          read.add(url.pathSegments[url.pathSegments.length - 2]);
          return (200, jsonEncode({
            'success': true,
            'notification': _row(id: url.pathSegments[url.pathSegments.length - 2], isRead: true),
          }));
        }
        if (method == 'GET' && url.path.contains('/notifications')) {
          final rows = <Map<String, dynamic>>[
            _row(),
            _row(id: 'ntf_drv_2', title: 'A new ride request is open near you'),
          ].map((r) => {...r, 'isRead': read.contains(r['id'])}).toList();
          final unread = rows.where((r) => r['isRead'] == false).length;
          return (200, jsonEncode({
            'success': true,
            'notifications': rows,
            'total': rows.length,
            'unreadCount': unread,
          }));
        }
        return (200, '{"success":true}');
      };
    }

    testWidgets('the PUT names the row and the feed is re-read after it', (tester) async {
      serveMutableFeed();
      await tester.pumpWidget(_host(const DriverNotificationsScreen()));
      await _settle(tester);

      await tester.tap(find.byKey(const ValueKey('driver-notification-mark-read-ntf_drv_1')));
      await _settle(tester);

      expect(stubSaw('PUT', '/notifications/ntf_drv_1/read'), isTrue);
      // Confirmed by a second read, not by editing the row here.
      expect(stubSeen.where((s) => s.startsWith('GET ')).length, 2);
      expect(
          find.byKey(const ValueKey('driver-notification-mark-read-ntf_drv_1')), findsNothing);
      expect(find.byKey(const ValueKey('driver-notification-ntf_drv_1')), findsOneWidget);
    });

    testWidgets('a refused PUT leaves the row visibly unread', (tester) async {
      serveMutableFeed(refusePut: true);
      await tester.pumpWidget(_host(const DriverNotificationsScreen()));
      await _settle(tester);

      await tester.tap(find.byKey(const ValueKey('driver-notification-mark-read-ntf_drv_1')));
      await _settle(tester);

      expect(stubSaw('PUT', '/notifications/ntf_drv_1/read'), isTrue);
      expect(find.text('Notification not found or access denied.'), findsOneWidget);
      expect(find.byKey(const ValueKey('driver-notification-mark-read-ntf_drv_1')),
          findsOneWidget);
      // Only the one refused write: no re-read is claimed as a success.
      expect(stubSeen.where((s) => s.startsWith('GET ')).length, 1);
    });

    testWidgets('a rapid second tap cannot put two writes on the wire', (tester) async {
      serveMutableFeed();
      await tester.pumpWidget(_host(const DriverNotificationsScreen()));
      await _settle(tester);
      // The delay goes in only once the first read has landed, so the rows exist to tap.
      stubDelay = const Duration(milliseconds: 200);

      final button = find.byKey(const ValueKey('driver-notification-mark-read-ntf_drv_1'));
      await tester.tap(button);
      await tester.pump();
      // The in-flight row answers with a spinner, so the second tap lands on nothing tappable.
      await tester.tap(find.byKey(const ValueKey('driver-notification-mark-read-ntf_drv_2')));
      await tester.pump();
      expect(stubSeen.where((s) => s.startsWith('PUT ')), hasLength(1));

      await _drain(tester);
      // The one write that was allowed through did land.
      expect(
          find.byKey(const ValueKey('driver-notification-mark-read-ntf_drv_1')), findsNothing);
    });
  });

  group('marking all read', () {
    testWidgets('reports the platform\'s own updatedCount', (tester) async {
      var putCount = 0;
      stubHandler = (method, url, _) {
        if (method == 'PUT' && url.path.endsWith('/read-all')) {
          putCount++;
          return (200, jsonEncode({'success': true, 'updatedCount': 3}));
        }
        if (method == 'GET' && url.path.contains('/notifications')) {
          return (200, jsonEncode({
            'success': true,
            'notifications': <Map<String, dynamic>>[_row()],
            'total': 1,
            'unreadCount': putCount == 0 ? 3 : 0,
          }));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(_host(const DriverNotificationsScreen()));
      await _settle(tester);

      await tester.tap(find.byIcon(Icons.done_all_rounded));
      await _settle(tester);

      expect(stubSaw('PUT', '/notifications/read-all'), isTrue);
      expect(find.text('Marked 3 notifications as read.'), findsOneWidget);
      expect(find.byIcon(Icons.done_all_rounded), findsNothing);
    });

    testWidgets('a failed mark-all says so and keeps the unread state', (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'PUT' && url.path.endsWith('/read-all')) {
          return (500, jsonEncode({'success': false, 'error': 'Bulk update failed.'}));
        }
        if (method == 'GET' && url.path.contains('/notifications')) {
          return (200, jsonEncode({
            'success': true,
            'notifications': <Map<String, dynamic>>[_row()],
            'total': 1,
            'unreadCount': 1,
          }));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(_host(const DriverNotificationsScreen()));
      await _settle(tester);

      await tester.tap(find.byIcon(Icons.done_all_rounded));
      await _settle(tester);

      expect(find.text('Bulk update failed.'), findsOneWidget);
      expect(find.byIcon(Icons.done_all_rounded), findsOneWidget);
      // No re-read after a refused write, so nothing on screen claims the bulk change happened.
      expect(stubSeen.where((s) => s.startsWith('GET ')), hasLength(1));
    });
  });

  group('preferences read and write the persisted row', () {
    testWidgets('all thirteen stored flags come from the server read', (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.endsWith('/notifications/preferences')) {
          return (200, jsonEncode({
            'success': true,
            'preferences': _prefsRow(override: {'pushEnabled': false, 'smsEnabled': false}),
          }));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(_host(const DriverNotificationPreferencesScreen()));
      await _settle(tester);

      expect(stubSaw('GET', '/notifications/preferences'), isTrue);
      final switches = find.byType(Switch);
      expect(switches, findsNWidgets(13));

      Map<String, bool> onScreen(WidgetTester t) {
        final out = <String, bool>{};
        for (final finder in <String, Finder>{
          'pushEnabled': find.byKey(const ValueKey('driver-notification-pref-switch-pushEnabled')),
          'smsEnabled': find.byKey(const ValueKey('driver-notification-pref-switch-smsEnabled')),
          'ridesEnabled':
              find.byKey(const ValueKey('driver-notification-pref-switch-ridesEnabled')),
        }.entries) {
          out[finder.key] = t.widget<Switch>(finder.value).value;
        }
        return out;
      }

      final shown = onScreen(tester);
      expect(shown['pushEnabled'], isFalse, reason: 'the row says off; the screen must too');
      expect(shown['smsEnabled'], isFalse);
      expect(shown['ridesEnabled'], isTrue);
    });

    testWidgets('a toggle sends only that camelCase key and adopts the server row',
        (tester) async {
      var stored = _prefsRow();
      stubHandler = (method, url, body) {
        if (method == 'GET' && url.path.endsWith('/notifications/preferences')) {
          return (200, jsonEncode({'success': true, 'preferences': stored}));
        }
        if (method == 'PUT' && url.path.endsWith('/notifications/preferences')) {
          final patch = jsonDecode(body) as Map<String, dynamic>;
          // The backend drops anything outside its allowlist, so a wrong key here would
          // silently store nothing while the screen still showed the tapped value.
          expect(patch.keys, hasLength(1));
          stored = {...stored, ...patch.cast<String, bool>()};
          return (200, jsonEncode({'success': true, 'preferences': stored}));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(_host(const DriverNotificationPreferencesScreen()));
      await _settle(tester);

      final promotions =
          find.byKey(const ValueKey('driver-notification-pref-switch-promotionsEnabled'));
      await tester.ensureVisible(promotions);
      await tester.tap(promotions);
      await _settle(tester);

      expect(stubSaw('PUT', '/notifications/preferences'), isTrue);
      expect(jsonDecode(stubBodyFor('PUT', '/notifications/preferences')!),
          <String, dynamic>{'promotionsEnabled': false});
      expect(tester.widget<Switch>(promotions).value, isFalse);
      expect(find.textContaining('was not saved'), findsNothing);
    });

    testWidgets('a refused write rolls the switch back and says so', (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.endsWith('/notifications/preferences')) {
          return (200, jsonEncode({'success': true, 'preferences': _prefsRow()}));
        }
        if (method == 'PUT' && url.path.endsWith('/notifications/preferences')) {
          return (401, jsonEncode({
            'success': false,
            'error': 'Unauthorized: Authentication token required.',
          }));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(_host(const DriverNotificationPreferencesScreen()));
      await _settle(tester);

      await _flip(tester, 'emailEnabled');
      await _settle(tester);

      expect(
          tester
              .widget<Switch>(
                  find.byKey(const ValueKey('driver-notification-pref-switch-emailEnabled')))
              .value,
          isTrue,
          reason: 'a switch left off after a refused PUT claims a save that never happened');
      expect(find.text('Unauthorized: Authentication token required.'), findsOneWidget);
    });

    testWidgets('a partial preference row is not drawn as thirteen switches',
        (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.endsWith('/notifications/preferences')) {
          final partial = _prefsRow()..remove('emailEnabled');
          return (200, jsonEncode({'success': true, 'preferences': partial}));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(_host(const DriverNotificationPreferencesScreen()));
      await _settle(tester);

      expect(find.byType(Switch), findsNothing);
      expect(find.textContaining('did not carry every preference'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('one write is in flight at a time', (tester) async {
      var stored = _prefsRow();
      stubHandler = (method, url, body) {
        final patch = method == 'PUT'
            ? (jsonDecode(body) as Map<String, dynamic>).cast<String, bool>()
            : const <String, bool>{};
        stored = {...stored, ...patch};
        return (200, jsonEncode({'success': true, 'preferences': stored}));
      };

      await tester.pumpWidget(_host(const DriverNotificationPreferencesScreen()));
      await _settle(tester);
      // Delayed only once the read has landed, so there are switches to tap.
      stubDelay = const Duration(milliseconds: 200);

      await _flip(tester, 'ridesEnabled');
      await tester.pump();
      // Every switch is dead while the first PUT is unanswered.
      await _flip(tester, 'foodEnabled');
      await tester.pump();
      expect(stubSeen.where((s) => s.startsWith('PUT ')), hasLength(1));

      await _drain(tester);
      expect(stubSeen.where((s) => s.startsWith('PUT ')), hasLength(1));
      expect(
          tester
              .widget<Switch>(
                  find.byKey(const ValueKey('driver-notification-pref-switch-ridesEnabled')))
              .value,
          isFalse,
          reason: 'the write that was allowed through should be the state on screen');
      expect(
          tester
              .widget<Switch>(
                  find.byKey(const ValueKey('driver-notification-pref-switch-foodEnabled')))
              .value,
          isTrue,
          reason: 'the tap that was refused must not look like it changed anything');
    });

    testWidgets('the unenforced flags say they are stored but not read', (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.endsWith('/notifications/preferences')) {
          return (200, jsonEncode({'success': true, 'preferences': _prefsRow()}));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(_host(const DriverNotificationPreferencesScreen()));
      await _settle(tester);

      // Seven of the thirteen are consulted by PushNotificationService; six are not, and a
      // row that implied otherwise would be a fabricated capability.
      expect(find.textContaining('no delivery path reads it yet'), findsNWidgets(4));
      expect(find.textContaining('delivered whatever this says'), findsOneWidget);
      expect(find.textContaining('this inbox is shown whatever this says'), findsOneWidget);
    });
  });
}
