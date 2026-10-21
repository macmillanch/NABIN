import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/core/router/driver_router.dart';
import 'package:mobile/core/widgets/driver_button.dart';
import 'package:mobile/features/auth/presentation/screens/driver_login_screen.dart';
import 'package:mobile/features/support/presentation/screens/driver_support_screen.dart';
import 'package:mobile/features/support/presentation/screens/driver_support_new_ticket_screen.dart';
import 'package:mobile/features/support/presentation/screens/driver_support_ticket_screen.dart';

import 'support/http_stub.dart';

// D18 regression lock: the Driver support screens are bound to the three partner support routes
// (`POST /api/support/ticket`, `GET /api/support/user/:userId`,
// `POST /api/support/ticket/:id/message`) and to nothing else.
//
// The ticket rows and message bodies below are the harness's stand-ins for what the platform
// sends — synthetic handles (`TCK-TEST-…`), synthetic names ('Test Partner', 'Stub Agent'), no
// place, no phone, no email. The assertions are about the opposite case: a screen that renders a
// row, a status, a timestamp, a sender or a delivered reply the backend never confirmed.
//
// Every route and status code asserted here was measured against the real backend with two live
// DRIVER sessions on 2026-10-08, and is cited in the screen files.

const String kDriverId = 'drv_real_7';

Map<String, dynamic> _driverMessage({
  String text = 'The trip settled on my side but nothing reached my account.',
  String? timestamp = '2026-10-07T09:12:00.000Z',
}) {
  return <String, dynamic>{
    'senderRole': 'DRIVER',
    'senderName': 'Test Partner',
    'senderId': kDriverId,
    'text': text,
    'timestamp': timestamp,
    'attachments': <String>[],
  };
}

/// A message from the other side of the thread. `senderName` and `senderRole` are written by the
/// server from the session that sent them, so this app only ever repeats what came back.
Map<String, dynamic> _platformMessage({
  String text = 'We have the reference and are checking the settlement.',
  String role = 'ADMIN',
  String name = 'Stub Agent',
  String? timestamp = '2026-10-07T11:40:00.000Z',
}) {
  return <String, dynamic>{
    'senderRole': role,
    'senderName': name,
    'senderId': 'adm_stub_1',
    'text': text,
    'timestamp': timestamp,
    'attachments': <String>[],
  };
}

/// One row of `GET /api/support/user/:userId`, keyed as `mapRowToTicket` returns it.
Map<String, dynamic> _ticket({
  String ticketNumber = 'TCK-TEST-0001',
  String uuid = '00000000-0000-4000-8000-000000000001',
  String title = 'My last payout did not arrive',
  String description = 'The trip settled on my side but nothing reached my account.',
  String status = 'OPEN',
  String? category = 'DRIVER_SUPPORT',
  List<dynamic>? messages,
  String? createdAt = '2026-10-07T09:12:00.000Z',
  Object? resolutionNotes = '',
}) {
  return <String, dynamic>{
    'id': ticketNumber,
    'ticketNumber': ticketNumber,
    'uuid': uuid,
    'title': title,
    'subject': title,
    'description': description,
    'status': status,
    'category': category,
    'priority': 'NORMAL',
    'userId': kDriverId,
    'userRole': 'DRIVER',
    'userName': 'Test Partner',
    'messages': messages ?? <dynamic>[_driverMessage(), _platformMessage()],
    'resolutionNotes': resolutionNotes,
    'createdAt': createdAt,
    'updatedAt': createdAt,
    'resolvedAt': null,
  };
}

/// Paths only, so an assertion never passes on a query string it forgot to look at.
List<String> _paths([String? method]) => stubSeen
    .where((s) => method == null || s.startsWith('$method '))
    .map((s) => Uri.parse(s.substring(s.indexOf(' ') + 1)).path)
    .toList();

String? _bodyFor(String method, String pathFragment) =>
    stubBodyFor(method, pathFragment);

/// The last URL the stub served for that verb, parsed. `stubSeen` separates verb and URL with one
/// space, so the slice has to start after the verb *and* the space.
Uri _lastUrl(String method) =>
    Uri.parse(stubSeen.lastWhere((s) => s.startsWith('$method ')).substring(method.length + 1));

Map<String, dynamic> _json(String? raw) =>
    raw == null ? <String, dynamic>{} : jsonDecode(raw) as Map<String, dynamic>;

void _serveList(List<dynamic> rows) {
  stubHandler = (method, url, _) {
    if (method == 'GET' && url.path.contains('/support/user/')) {
      return (200, jsonEncode({'success': true, 'tickets': rows}));
    }
    return (200, '{"success":true}');
  };
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 20));
  }
}

/// Runs the fake clock far enough for a deliberately delayed stub response to land, so no timer
/// is left pending when the test ends. A confirmed reply also scrolls the thread, and that
/// animation needs the same room.
Future<void> _drain(WidgetTester tester) async {
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Widget _host(Widget child) => MaterialApp(home: child);

/// A surface tall enough that every row or bubble a test asserts on is actually painted: a
/// `ListView` child that never entered the viewport is not in the tree, and `find` would then fail
/// for the wrong reason.
void _tall(WidgetTester tester) {
  tester.view.physicalSize = const Size(800 * 3, 2400 * 3);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

/// The real Driver route table, entered at `location` before the first frame, so the screens are
/// tested behind the routes a partner actually reaches them through.
Future<void> _pumpRouter(WidgetTester tester, String location) async {
  driverRouter.go(location);
  await tester.pumpWidget(MaterialApp.router(routerConfig: driverRouter));
  await _settle(tester);
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    SessionManager.instance.saveSession(
      token: 'test-driver-token',
      user: <String, dynamic>{'id': kDriverId, 'name': 'Test Partner', 'role': 'DRIVER'},
    );
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
  });

  group('the ticket list reads GET /api/support/user/:userId', () {
    testWidgets('renders the platform\'s own rows and nothing else', (tester) async {
      _tall(tester);
      _serveList([
        _ticket(),
        _ticket(
          ticketNumber: 'TCK-TEST-0002',
          uuid: '00000000-0000-4000-8000-000000000002',
          title: 'A job was cancelled after I reached the pickup point',
          status: 'IN_PROGRESS',
        ),
      ]);

      await tester.pumpWidget(_host(const DriverSupportScreen()));
      await _settle(tester);

      // An error state would also satisfy "no invented rows", so prove the read left.
      expect(stubSaw('GET', '/support/user/'), isTrue);
      expect(find.text('My last payout did not arrive'), findsOneWidget);
      expect(find.text('A job was cancelled after I reached the pickup point'), findsOneWidget);
      expect(find.byKey(const ValueKey('driver-support-ticket-TCK-TEST-0001')), findsOneWidget);
      expect(find.byKey(const ValueKey('driver-support-ticket-TCK-TEST-0002')), findsOneWidget);
      // The references are the platform's, not a number this screen counted.
      expect(find.text('TCK-TEST-0001'), findsOneWidget);
      expect(find.text('TCK-TEST-0002'), findsOneWidget);
      expect(find.text('No tickets yet'), findsNothing);
    });

    testWidgets('the only identity in the read is the signed-in session\'s own id',
        (tester) async {
      _serveList(const []);

      await tester.pumpWidget(_host(const DriverSupportScreen()));
      await _settle(tester);

      expect(_paths('GET'), <String>['/api/support/user/$kDriverId']);
      // `server.js:2017` refuses any other id with a 403, so this is the one spelling that works
      // and it comes from the session, never from a field, a link or a stored driver id.
      expect(_lastUrl('GET').queryParameters.isEmpty, isTrue);
      // Nothing else that identifies a partner goes on the wire.
      expect(stubBodies.every((b) => b.isEmpty), isTrue);
    });

    testWidgets('an empty list is not an error', (tester) async {
      _serveList(const []);

      await tester.pumpWidget(_host(const DriverSupportScreen()));
      await _settle(tester);

      expect(stubSaw('GET', '/support/user/'), isTrue);
      expect(find.text('No tickets yet'), findsOneWidget);
      expect(find.textContaining('Could not load'), findsNothing);
      expect(find.byKey(const ValueKey('driver-support-empty-new-ticket')), findsOneWidget);
    });

    testWidgets('a refused read is an error, never an empty mailbox', (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/support/user/')) {
          return (500, jsonEncode({
            'success': false,
            'error': 'Support tickets are unavailable right now.',
          }));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(_host(const DriverSupportScreen()));
      await _settle(tester);

      expect(find.text('Could not load your tickets'), findsOneWidget);
      expect(find.text('Support tickets are unavailable right now.'), findsOneWidget);
      expect(find.byKey(const ValueKey('driver-support-retry')), findsOneWidget);
      expect(find.text('No tickets yet'), findsNothing);
    });

    testWidgets('a 200 that carries nothing usable is still not an empty list',
        (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/support/user/')) return (200, '');
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(_host(const DriverSupportScreen()));
      await _settle(tester);

      expect(find.text('Could not load your tickets'), findsOneWidget);
      expect(find.textContaining('No connection to NABIN'), findsOneWidget);
      expect(find.text('No tickets yet'), findsNothing);
    });

    testWidgets('a closed session is reported as a closed session', (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/support/user/')) {
          return (401, jsonEncode({
            'success': false,
            'error': 'Unauthorized: Invalid or expired session token.',
          }));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(_host(const DriverSupportScreen()));
      await _settle(tester);

      expect(find.text('Your session with NABIN has closed. Sign in again to read your tickets.'),
          findsOneWidget);
      expect(find.text('No tickets yet'), findsNothing);
    });

    testWidgets('a 403 says a partner reads only their own tickets', (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/support/user/')) {
          return (403, jsonEncode({
            'success': false,
            'error': 'Access denied: You can only view your own support tickets.',
          }));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(_host(const DriverSupportScreen()));
      await _settle(tester);

      expect(find.text('NABIN refused this read: a partner may only open their own tickets.'),
          findsOneWidget);
      expect(find.text('No tickets yet'), findsNothing);
    });

    testWidgets('a session that names no partner reads nothing', (tester) async {
      SessionManager.instance.saveSession(
        token: 'test-driver-token',
        user: <String, dynamic>{'name': 'Test Partner', 'role': 'DRIVER'},
      );

      await tester.pumpWidget(_host(const DriverSupportScreen()));
      await _settle(tester);

      // No id to put in the path means the read is not attempted with a guess in it.
      expect(_paths('GET'), isEmpty);
      expect(find.textContaining('does not know which partner this session belongs to'),
          findsOneWidget);
      expect(find.text('No tickets yet'), findsNothing);
    });

    testWidgets('a retry after a failure shows the rows that arrived', (tester) async {
      var failing = true;
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/support/user/')) {
          if (failing) return (500, '{"success":false}');
          return (200, jsonEncode({'success': true, 'tickets': [_ticket()]}));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(_host(const DriverSupportScreen()));
      await _settle(tester);
      expect(find.text('Could not load your tickets'), findsOneWidget);

      failing = false;
      await tester.tap(find.byKey(const ValueKey('driver-support-retry')));
      await _settle(tester);

      expect(_paths('GET'), hasLength(2));
      expect(find.text('My last payout did not arrive'), findsOneWidget);
    });

    testWidgets('a refresh that fails keeps the rows already on screen', (tester) async {
      var failing = false;
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/support/user/')) {
          if (failing) return (500, '{"success":false,"error":"Support tickets are down."}');
          return (200, jsonEncode({'success': true, 'tickets': [_ticket()]}));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(_host(const DriverSupportScreen()));
      await _settle(tester);
      failing = true;

      // The pull-to-refresh path is the silent one: a failed reload reports itself without
      // pretending the partner's tickets disappeared.
      await tester.drag(find.byKey(const ValueKey('driver-support-ticket-TCK-TEST-0001')),
          const Offset(0, 320));
      await _drain(tester);

      expect(_paths('GET'), hasLength(2));
      expect(find.text('My last payout did not arrive'), findsOneWidget);
      expect(find.text('Support tickets are down.'), findsOneWidget);
      expect(find.text('Could not load your tickets'), findsNothing);
    });

    testWidgets('statuses are shown exactly as the platform sent them', (tester) async {
      _tall(tester);
      _serveList([
        _ticket(status: 'RESOLVED'),
        _ticket(
          ticketNumber: 'TCK-TEST-0009',
          uuid: '00000000-0000-4000-8000-000000000009',
          title: 'A status this app has never seen',
          status: 'AWAITING_REVIEW',
        ),
        _ticket(
          ticketNumber: 'TCK-TEST-0010',
          uuid: '00000000-0000-4000-8000-000000000010',
          title: 'A row that sent no status at all',
          status: '',
        ),
      ]);

      await tester.pumpWidget(_host(const DriverSupportScreen()));
      await _settle(tester);

      expect(find.byKey(const ValueKey('driver-support-status-RESOLVED')), findsOneWidget);
      expect(find.text('RESOLVED'), findsOneWidget);
      // An unrecognised value is displayed, not mapped onto the nearest known one.
      expect(find.byKey(const ValueKey('driver-support-status-AWAITING_REVIEW')), findsOneWidget);
      expect(find.text('AWAITING_REVIEW'), findsOneWidget);
      expect(find.text('STATUS NOT SENT'), findsOneWidget);
      // The four words a nicer UI would have substituted.
      expect(find.text('Pending'), findsNothing);
      expect(find.text('Escalated'), findsNothing);
      expect(find.text('Open'), findsNothing);
    });

    testWidgets('a row missing its number or date renders the absence', (tester) async {
      final bare = _ticket()
        ..remove('ticketNumber')
        ..remove('createdAt')
        ..remove('category');
      // `mapRowToTicket` sets `id` to `ticket_number || id`, so with no number the handle the
      // screen has to work from is the uuid.
      bare['id'] = bare['uuid'];

      _serveList([bare]);
      await tester.pumpWidget(_host(const DriverSupportScreen()));
      await _settle(tester);

      expect(find.text('No ticket number on this row'), findsOneWidget);
      expect(find.text('Date not recorded'), findsOneWidget);
    });
  });

  group('raising a ticket writes POST /api/support/ticket', () {
    // Every test in this group paints the form on a tall surface: `enterText` focuses the
    // description field, the ListView scrolls its caret into view, and the send button below it
    // leaves a 600px viewport — a tap on a widget that is not on screen is a tap that never
    // reaches `_submit`, which would show up as "no POST" rather than as a broken screen.
    testWidgets('the form refuses a blank subject and description before the wire',
        (tester) async {
      _tall(tester);
      await tester.pumpWidget(_host(const DriverSupportNewTicketScreen()));
      await _settle(tester);

      await tester.tap(find.byKey(const ValueKey('driver-support-submit')));
      await _settle(tester);

      expect(find.text('NABIN requires a subject. Enter one.'), findsOneWidget);
      expect(find.text('NABIN requires a description. Enter one.'), findsOneWidget);
      // The backend 400s on both fields; nothing is sent to find that out.
      expect(_paths('POST'), isEmpty);
    });

    testWidgets('the POST carries exactly the fields the route reads, and no identity',
        (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'POST' && url.path.endsWith('/support/ticket')) {
          return (400, jsonEncode({'success': false, 'error': 'Harness stops after the request.'}));
        }
        return (200, '{"success":true}');
      };

      _tall(tester);
      await tester.pumpWidget(_host(const DriverSupportNewTicketScreen()));
      await _settle(tester);
      await tester.enterText(find.byKey(const ValueKey('driver-support-title')),
          'My last payout did not arrive');
      await tester.enterText(find.byKey(const ValueKey('driver-support-description')),
          'The trip settled on my side but nothing reached my account.');
      await tester.tap(find.byKey(const ValueKey('driver-support-submit')));
      await _settle(tester);

      expect(_paths('POST'), <String>['/api/support/ticket']);
      final body = _json(_bodyFor('POST', '/support/ticket'));
      expect(body.keys.toSet(), <String>{'category', 'title', 'description'});
      expect(body['category'], 'DRIVER_SUPPORT');
      expect(body['title'], 'My last payout did not arrive');
      // A body `userId` would imply a control the route does not have: the owner comes from the
      // bearer token, measured 2026-10-08.
      expect(body.containsKey('userId'), isFalse);
      expect(body.containsKey('driverId'), isFalse);
      expect(body.containsKey('status'), isFalse);
      expect(_lastUrl('POST').queryParameters.isEmpty, isTrue);
    });

    testWidgets('a created ticket opens on the row the platform returned', (tester) async {
      final created = _ticket(
        ticketNumber: 'TCK-TEST-0777',
        uuid: '00000000-0000-4000-8000-000000000777',
        title: 'The app froze mid-checkout at a pickup',
        status: 'OPEN',
        messages: [_driverMessage(text: 'The app froze mid-checkout at a pickup.')],
      );
      stubHandler = (method, url, _) {
        if (method == 'POST' && url.path.endsWith('/support/ticket')) {
          return (200, jsonEncode({'success': true, 'ticket': created}));
        }
        if (method == 'GET' && url.path.contains('/support/user/')) {
          return (200, jsonEncode({'success': true, 'tickets': [created]}));
        }
        return (200, '{"success":true}');
      };

      _tall(tester);
      await _pumpRouter(tester, '/support/new');
      await tester.enterText(find.byKey(const ValueKey('driver-support-title')),
          'The app froze mid-checkout at a pickup');
      await tester.enterText(find.byKey(const ValueKey('driver-support-description')),
          'It stopped responding while the pickup was being confirmed.');
      await tester.tap(find.byKey(const ValueKey('driver-support-submit')));
      await _settle(tester);

      // The thread opens on the server's own reference, and the only read available to a partner
      // is their own list — no ticket-by-id route was invented to make the link work.
      expect(find.text('Support Ticket'), findsOneWidget);
      expect(find.byKey(const ValueKey('driver-support-ticket-header')), findsOneWidget);
      expect(find.text('TCK-TEST-0777'), findsOneWidget);
      expect(_paths('GET').every((p) => !p.contains('/support/ticket/')), isTrue);
      expect(_paths('GET'), contains('/api/support/user/$kDriverId'));
    });

    testWidgets('a refusal keeps what was typed and claims no success', (tester) async {
      _tall(tester);
      stubHandler = (method, url, _) {
        if (method == 'POST' && url.path.endsWith('/support/ticket')) {
          return (400, '{"success":false}');
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(_host(const DriverSupportNewTicketScreen()));
      await _settle(tester);
      await tester.enterText(find.byKey(const ValueKey('driver-support-title')),
          'My last payout did not arrive');
      await tester.enterText(find.byKey(const ValueKey('driver-support-description')),
          'The trip settled on my side but nothing reached my account.');
      await tester.tap(find.byKey(const ValueKey('driver-support-submit')));
      await _settle(tester);

      // A 400 on this route happens before the row is written, so "nothing was created" is the
      // route's behaviour, not this screen's assumption.
      expect(find.byKey(const ValueKey('driver-support-create-failure')), findsOneWidget);
      expect(find.text('NABIN refused this ticket. Nothing was created.'), findsOneWidget);
      expect(find.text('Support Ticket'), findsNothing);
      expect(tester.widget<TextFormField>(
              find.byKey(const ValueKey('driver-support-title')))
          .controller!
          .text,
          'My last payout did not arrive');
      expect(_paths('GET'), isEmpty);
    });

    testWidgets('the route\'s own refusal words are shown as it sent them', (tester) async {
      _tall(tester);
      stubHandler = (method, url, _) {
        if (method == 'POST' && url.path.endsWith('/support/ticket')) {
          // Measured live on 2026-10-08: this is verbatim what `POST /api/support/ticket`
          // answers a subject past `varchar(200)` with, before the app's own cap gets in.
          return (400, jsonEncode({
            'success': false,
            'error': 'value too long for type character varying(200)',
          }));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(_host(const DriverSupportNewTicketScreen()));
      await _settle(tester);
      await tester.enterText(find.byKey(const ValueKey('driver-support-title')),
          'My last payout did not arrive');
      await tester.enterText(find.byKey(const ValueKey('driver-support-description')),
          'The trip settled on my side but nothing reached my account.');
      await tester.tap(find.byKey(const ValueKey('driver-support-submit')));
      await _settle(tester);

      expect(
          find.textContaining(
              'NABIN refused this ticket: value too long for type character varying(200)'),
          findsOneWidget);
      expect(_paths('POST'), hasLength(1));
    });

    testWidgets('the field caps are the column and thread limits, not this screen\'s taste',
        (tester) async {
      _tall(tester);
      await tester.pumpWidget(_host(const DriverSupportNewTicketScreen()));
      await _settle(tester);

      // `support_tickets.subject` is varchar(200) and the message route refuses past 4000, so
      // the cap is the backend's. What is tested is the behaviour, not a config value: text past
      // the limit is refused by the field instead of reaching a 400 the partner cannot act on.
      final title = find.byKey(const ValueKey('driver-support-title'));
      final description = find.byKey(const ValueKey('driver-support-description'));
      await tester.enterText(title, 'x' * 260);
      await tester.enterText(description, 'y' * 4200);
      await _settle(tester);

      expect(tester.widget<TextFormField>(title).controller!.text.length, 200);
      expect(tester.widget<TextFormField>(description).controller!.text.length, 4000);

      // The form's own validators are stricter than the route's 400s, so the backend's
      // "Missing required field: description" is unreachable from here by design.
      await tester.enterText(description, '');
      await tester.tap(find.byKey(const ValueKey('driver-support-submit')));
      await _settle(tester);
      expect(find.text('NABIN requires a description. Enter one.'), findsOneWidget);
      expect(_paths('POST'), isEmpty);
    });

    testWidgets('a create that never gets an answer is not retried blind', (tester) async {
      _tall(tester);
      stubHandler = (method, url, _) {
        if (method == 'POST' && url.path.endsWith('/support/ticket')) {
          throw const SocketException('harness: no answer from NABIN');
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(_host(const DriverSupportNewTicketScreen()));
      await _settle(tester);
      await tester.enterText(find.byKey(const ValueKey('driver-support-title')),
          'My last payout did not arrive');
      await tester.enterText(find.byKey(const ValueKey('driver-support-description')),
          'The trip settled on my side but nothing reached my account.');
      await tester.tap(find.byKey(const ValueKey('driver-support-submit')));
      await _settle(tester);

      // Whether the row exists is not knowable from a socket failure, so the screen says look,
      // not send again — and this route has no idempotency key to collapse a duplicate.
      expect(find.textContaining('NABIN did not answer'), findsOneWidget);
      expect(find.textContaining('do not send it again'), findsOneWidget);
      expect(_paths('POST'), hasLength(1));
    });

    testWidgets('a 5xx create warns before any second send', (tester) async {
      _tall(tester);
      stubHandler = (method, url, _) {
        if (method == 'POST' && url.path.endsWith('/support/ticket')) {
          return (503, jsonEncode({'success': false}));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(_host(const DriverSupportNewTicketScreen()));
      await _settle(tester);
      await tester.enterText(find.byKey(const ValueKey('driver-support-title')),
          'My last payout did not arrive');
      await tester.enterText(find.byKey(const ValueKey('driver-support-description')),
          'The trip settled on my side but nothing reached my account.');
      await tester.tap(find.byKey(const ValueKey('driver-support-submit')));
      await _settle(tester);

      expect(find.textContaining('NABIN could not complete the request (HTTP 503)'),
          findsOneWidget);
      expect(find.textContaining('refresh the list before sending this one again'), findsOneWidget);
    });

    testWidgets('a rapid second tap cannot put two tickets on the wire', (tester) async {
      _tall(tester);
      stubHandler = (method, url, _) {
        if (method == 'POST' && url.path.endsWith('/support/ticket')) {
          return (400, jsonEncode({'success': false, 'error': 'Harness refusal.'}));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(_host(const DriverSupportNewTicketScreen()));
      await _settle(tester);
      await tester.enterText(find.byKey(const ValueKey('driver-support-title')),
          'My last payout did not arrive');
      await tester.enterText(find.byKey(const ValueKey('driver-support-description')),
          'The trip settled on my side but nothing reached my account.');

      stubDelay = const Duration(milliseconds: 200);
      final submit = find.byKey(const ValueKey('driver-support-submit'));
      await tester.tap(submit);
      await tester.pump();
      // The button is disabled and both fields are locked while the write is in flight.
      expect(tester.widget<DriverButton>(submit).isLoading, isTrue);
      await tester.tap(submit);
      await tester.pump();
      await tester.tap(submit);
      expect(_paths('POST'), hasLength(1));

      await _drain(tester);
      expect(_paths('POST'), hasLength(1));
      expect(tester.widget<DriverButton>(submit).isLoading, isFalse);
    });
  });

  group('one ticket\'s thread reads its own list and replies to the route', () {
    testWidgets('the thread paints the messages the platform sent', (tester) async {
      _tall(tester);
      _serveList([
        _ticket(messages: [
          _driverMessage(),
          _platformMessage(text: 'We have the reference and are checking the settlement.'),
        ]),
      ]);

      await tester.pumpWidget(
          _host(const DriverSupportTicketScreen(ticketRef: 'TCK-TEST-0001')));
      await _settle(tester);

      expect(find.byKey(const ValueKey('driver-support-thread')), findsOneWidget);
      expect(find.text('My last payout did not arrive'), findsOneWidget);
      expect(find.text('The trip settled on my side but nothing reached my account.'),
          findsOneWidget);
      expect(find.text('We have the reference and are checking the settlement.'), findsOneWidget);
      // Both sides are labelled from the server's own attribution.
      expect(find.text('Test Partner · DRIVER'), findsOneWidget);
      expect(find.text('Stub Agent · ADMIN'), findsOneWidget);
      // The read is the partner's list; no detail route exists to invent.
      expect(_paths('GET'), <String>['/api/support/user/$kDriverId']);
    });

    testWidgets('a reply posts exactly text to the message route', (tester) async {
      final updated = _ticket(messages: [
        _driverMessage(),
        _platformMessage(),
        _driverMessage(text: 'Still waiting on the settlement.'),
      ]);
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/support/user/')) {
          return (200, jsonEncode({'success': true, 'tickets': [_ticket()]}));
        }
        if (method == 'POST' && url.path.endsWith('/message')) {
          return (200, jsonEncode({'success': true, 'ticket': updated, 'message': updated['messages']!.last}));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(
          _host(const DriverSupportTicketScreen(ticketRef: 'TCK-TEST-0001')));
      await _settle(tester);
      await tester.enterText(find.byKey(const ValueKey('driver-support-reply-field')),
          'Still waiting on the settlement.');
      await tester.tap(find.byKey(const ValueKey('driver-support-send')));
      await _drain(tester);

      expect(_paths('POST'), <String>['/api/support/ticket/TCK-TEST-0001/message']);
      final body = _json(_bodyFor('POST', '/message'));
      expect(body.keys.toSet(), <String>{'text'});
      expect(body['text'], 'Still waiting on the settlement.');
      // The sender is written by the server from the session; a body claiming another one is
      // stored as the real one, so nothing like that is sent.
      expect(body.containsKey('senderRole'), isFalse);
      expect(body.containsKey('senderName'), isFalse);
      expect(body.containsKey('userId'), isFalse);
    });

    testWidgets('a confirmed reply is painted from the platform\'s answer, not assumed',
        (tester) async {
      final updated = _ticket(messages: [
        _driverMessage(),
        _platformMessage(),
        _driverMessage(text: 'Still waiting on the settlement.'),
      ]);
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/support/user/')) {
          return (200, jsonEncode({'success': true, 'tickets': [_ticket()]}));
        }
        if (method == 'POST' && url.path.endsWith('/message')) {
          return (200, jsonEncode({'success': true, 'ticket': updated}));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(
          _host(const DriverSupportTicketScreen(ticketRef: 'TCK-TEST-0001')));
      await _settle(tester);
      await tester.enterText(find.byKey(const ValueKey('driver-support-reply-field')),
          'Still waiting on the settlement.');
      await tester.tap(find.byKey(const ValueKey('driver-support-send')));
      await _drain(tester);

      expect(find.text('Still waiting on the settlement.'), findsOneWidget);
      // The row the write returned is the thread: no second read is claimed as the confirmation.
      expect(_paths('GET'), hasLength(1));
      expect(tester.widget<TextField>(
        find.byKey(const ValueKey('driver-support-reply-field'))).controller!.text, isEmpty);
    });

    testWidgets('a refused reply keeps what was typed and adds nothing', (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/support/user/')) {
          return (200, jsonEncode({'success': true, 'tickets': [_ticket()]}));
        }
        if (method == 'POST' && url.path.endsWith('/message')) {
          return (500, jsonEncode({'success': false}));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(
          _host(const DriverSupportTicketScreen(ticketRef: 'TCK-TEST-0001')));
      await _settle(tester);
      await tester.enterText(find.byKey(const ValueKey('driver-support-reply-field')),
          'Still waiting on the settlement.');
      await tester.tap(find.byKey(const ValueKey('driver-support-send')));
      await _settle(tester);

      expect(find.byKey(const ValueKey('driver-support-reply-failure')), findsOneWidget);
      expect(find.text('NABIN refused the reply (HTTP 500). Nothing was added to the thread.'),
          findsOneWidget);
      expect(tester.widget<TextField>(
        find.byKey(const ValueKey('driver-support-reply-field'))).controller!.text,
          'Still waiting on the settlement.');
      // Scoped to the thread: the composer itself still holds the text, which is the point of
      // the assertion above, and `find.text` would otherwise match its EditableText too.
      expect(
          find.descendant(
            of: find.byKey(const ValueKey('driver-support-thread')),
            matching: find.text('Still waiting on the settlement.'),
          ),
          findsNothing);
    });

    testWidgets('the server\'s own refusal words are kept when it 400s', (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/support/user/')) {
          return (200, jsonEncode({'success': true, 'tickets': [_ticket()]}));
        }
        if (method == 'POST' && url.path.endsWith('/message')) {
          return (400, jsonEncode({
            'success': false,
            'error': 'Message text exceeds maximum length of 4000 characters',
          }));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(
          _host(const DriverSupportTicketScreen(ticketRef: 'TCK-TEST-0001')));
      await _settle(tester);
      await tester.enterText(find.byKey(const ValueKey('driver-support-reply-field')),
          'Still waiting on the settlement.');
      await tester.tap(find.byKey(const ValueKey('driver-support-send')));
      await _settle(tester);

      expect(find.text('NABIN refused the reply: Message text exceeds maximum length of 4000 characters'),
          findsOneWidget);
    });

    testWidgets('a reply with no answer at all is not sent a second time', (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/support/user/')) {
          return (200, jsonEncode({'success': true, 'tickets': [_ticket()]}));
        }
        if (method == 'POST' && url.path.endsWith('/message')) {
          throw const SocketException('harness: no answer from NABIN');
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(
          _host(const DriverSupportTicketScreen(ticketRef: 'TCK-TEST-0001')));
      await _settle(tester);
      await tester.enterText(find.byKey(const ValueKey('driver-support-reply-field')),
          'Still waiting on the settlement.');
      await tester.tap(find.byKey(const ValueKey('driver-support-send')));
      await _settle(tester);

      expect(find.textContaining('No answer from NABIN'), findsOneWidget);
      expect(find.textContaining('refresh the thread before sending it again'), findsOneWidget);
      expect(_paths('POST'), hasLength(1));
      expect(tester.widget<TextField>(
        find.byKey(const ValueKey('driver-support-reply-field'))).controller!.text,
          'Still waiting on the settlement.');
    });

    testWidgets('a second tap cannot put two replies on the wire', (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/support/user/')) {
          return (200, jsonEncode({'success': true, 'tickets': [_ticket()]}));
        }
        if (method == 'POST' && url.path.endsWith('/message')) {
          return (400, jsonEncode({'success': false, 'error': 'Harness refusal.'}));
        }
        return (200, '{"success":true}');
      };

      await tester.pumpWidget(
          _host(const DriverSupportTicketScreen(ticketRef: 'TCK-TEST-0001')));
      await _settle(tester);
      await tester.enterText(find.byKey(const ValueKey('driver-support-reply-field')),
          'Still waiting on the settlement.');

      stubDelay = const Duration(milliseconds: 200);
      final send = find.byKey(const ValueKey('driver-support-send'));
      await tester.tap(send);
      await tester.pump();
      await tester.tap(send);
      await tester.pump();
      await tester.tap(send);
      expect(_paths('POST'), hasLength(1));

      await _drain(tester);
      expect(_paths('POST'), hasLength(1));
    });

    testWidgets('an empty reply is refused locally', (tester) async {
      _serveList([_ticket()]);
      await tester.pumpWidget(
          _host(const DriverSupportTicketScreen(ticketRef: 'TCK-TEST-0001')));
      await _settle(tester);

      await tester.tap(find.byKey(const ValueKey('driver-support-send')));
      await _settle(tester);

      expect(find.text('Write something before sending — an empty message is refused.'),
          findsOneWidget);
      expect(_paths('POST'), isEmpty);
    });

    testWidgets('a ticket that is not in the partner\'s list is absent, not empty',
        (tester) async {
      _serveList([
        _ticket(ticketNumber: 'TCK-TEST-0500',
            uuid: '00000000-0000-4000-8000-000000000500',
            title: 'A different ticket of mine'),
      ]);

      await tester.pumpWidget(
          _host(const DriverSupportTicketScreen(ticketRef: 'TCK-TEST-0001')));
      await _settle(tester);

      expect(find.text('That ticket is not in your list'), findsOneWidget);
      expect(find.textContaining('TCK-TEST-0001'), findsOneWidget);
      // No composer on a thread the platform does not have for this partner.
      expect(find.byKey(const ValueKey('driver-support-send')), findsNothing);
      expect(find.byKey(const ValueKey('driver-support-ticket-back-to-list')), findsOneWidget);
    });

    testWidgets('a thread with no messages says so rather than drawing bubbles',
        (tester) async {
      _serveList([_ticket(messages: [])]);
      await tester.pumpWidget(
          _host(const DriverSupportTicketScreen(ticketRef: 'TCK-TEST-0001')));
      await _settle(tester);

      expect(find.text('NABIN sent this ticket with no messages on it.'), findsOneWidget);
    });

    testWidgets('an unreadable message entry does not take the thread down', (tester) async {
      _tall(tester);
      _serveList([
        _ticket(messages: [
          'a bare string where an object was expected',
          42,
          _driverMessage(),
          {'text': '  '},
        ]),
      ]);

      await tester.pumpWidget(
          _host(const DriverSupportTicketScreen(ticketRef: 'TCK-TEST-0001')));
      await _settle(tester);

      expect(find.text('The trip settled on my side but nothing reached my account.'),
          findsOneWidget);
      expect(find.text('NABIN sent this entry in the thread without any text this app could read.'),
          findsNWidgets(3));
      expect(tester.takeException(), isNull);
    });

    testWidgets('a message with no timestamp is not given one', (tester) async {
      _serveList([_ticket(messages: [_driverMessage(timestamp: null)])]);
      await tester.pumpWidget(
          _host(const DriverSupportTicketScreen(ticketRef: 'TCK-TEST-0001')));
      await _settle(tester);

      expect(find.text('No timestamp on this message'), findsOneWidget);
    });

    testWidgets('resolution notes are labelled as the platform\'s words', (tester) async {
      _tall(tester);
      _serveList([
        _ticket(
          status: 'RESOLVED',
          resolutionNotes: 'The settlement was re-run and reached the registered destination.',
        ),
      ]);

      await tester.pumpWidget(
          _host(const DriverSupportTicketScreen(ticketRef: 'TCK-TEST-0001')));
      await _settle(tester);

      expect(find.byKey(const ValueKey('driver-support-resolution')), findsOneWidget);
      expect(find.text('Resolution notes from NABIN'), findsOneWidget);
      expect(find.text('The settlement was re-run and reached the registered destination.'),
          findsOneWidget);
      expect(find.byKey(const ValueKey('driver-support-status-RESOLVED')), findsOneWidget);
    });
  });

  group('the entry point, the chrome and what is never claimed', () {
    testWidgets('Driver Account opens the D18 ticket list', (tester) async {
      stubHandler = (method, url, _) {
        if (url.path.endsWith('/driver/home')) {
          return (200, jsonEncode({
            'success': true,
            'driver': <String, dynamic>{'name': 'Test Partner', 'isOnline': false},
          }));
        }
        if (url.path.endsWith('/driver/earnings')) {
          return (200, jsonEncode({'success': true}));
        }
        if (method == 'GET' && url.path.contains('/support/user/')) {
          return (200, jsonEncode({'success': true, 'tickets': [_ticket()]}));
        }
        return (200, '{"success":true}');
      };

      await _pumpRouter(tester, '/account');
      final row = find.text('Driver Help & Incident Support');
      expect(row, findsOneWidget);
      await tester.ensureVisible(row);
      await tester.pump();
      await tester.tap(row);
      await _settle(tester);

      expect(find.text('Driver Support'), findsOneWidget);
      expect(stubSaw('GET', '/support/user/'), isTrue);
      expect(find.text('My last payout did not arrive'), findsOneWidget);
    });

    testWidgets('the D18 routes are reachable and none is public', (tester) async {
      stubHandler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/support/user/')) {
          return (200, jsonEncode({'success': true, 'tickets': [_ticket()]}));
        }
        return (200, '{"success":true}');
      };

      // A cold deep link to a support route goes through the sign-in gate, because none of the
      // three is in `_driverPublicRoutes`.
      SessionManager.instance.clearSession();
      driverRouter.go('/support');
      await tester.pumpWidget(MaterialApp.router(routerConfig: driverRouter));
      await _settle(tester);

      expect(find.byType(DriverLoginScreen), findsOneWidget);
      expect(_paths('GET'), isEmpty);
    });

    testWidgets('nothing is claimed the backend does not provide', (tester) async {
      _serveList([_ticket()]);
      await tester.pumpWidget(_host(const DriverSupportScreen()));
      await _settle(tester);
      for (final forbidden in [
        'Support Team', 'Partner Operations', 'Admin Desk', 'Agent online',
        'Average response', 'Response time', 'SLA', 'Escalated', 'Reopen ticket',
        'Call', 'WhatsApp', 'Priority',
      ]) {
        expect(find.textContaining(forbidden, findRichText: true), findsNothing,
            reason: '"$forbidden" is not something these three routes support');
      }

      await tester.pumpWidget(_host(const DriverSupportNewTicketScreen()));
      await _settle(tester);
      for (final forbidden in [
        'Support Team', 'Partner Operations', 'Agent online', 'Average response',
        'SLA', 'Within', 'Reopen ticket', 'Critical',
      ]) {
        expect(find.textContaining(forbidden, findRichText: true), findsNothing,
            reason: '"$forbidden" is not something these three routes support');
      }
      // A closed `DropdownButton` paints only the selected value, so the menu is opened before
      // the four offered categories are checked — the config is not taken on trust.
      expect(find.text('Partner support'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('driver-support-category')));
      await tester.pumpAndSettle();
      expect(find.text('General question'), findsOneWidget);
      expect(find.text('Lost item'), findsOneWidget);
      expect(find.text('Safety incident report'), findsOneWidget);
      // The open menu is a route above the form, so the selected label is painted twice: once in
      // the button, once in the list. That is what proves the menu is actually up.
      expect(find.text('Partner support'), findsNWidgets(2));
      // Nothing that implies a refund or dispute workflow the routes do not have.
      expect(find.text('Billing dispute'), findsNothing);
      expect(find.text('Refund claim'), findsNothing);
      // Picking an item closes the route, so no animation timer is pending at teardown.
      await tester.tap(find.text('Lost item'));
      await tester.pumpAndSettle();
      expect(find.text('Lost item'), findsOneWidget);

      await tester.pumpWidget(
          _host(const DriverSupportTicketScreen(ticketRef: 'TCK-TEST-0001')));
      await _settle(tester);
      for (final forbidden in [
        'Support Team', 'Partner Operations', 'Agent online', 'SLA', 'Escalated', 'Reopen',
      ]) {
        expect(find.textContaining(forbidden, findRichText: true), findsNothing,
            reason: '"$forbidden" is not something these three routes support');
      }
      // No language toggle, and no ticket count either.
      expect(find.text('MZ'), findsNothing);
      expect(find.text('EN'), findsNothing);
      expect(find.textContaining('tickets outstanding'), findsNothing);
    });

    testWidgets('the three screens paint at 390px without an exception', (tester) async {
      tester.view.physicalSize = const Size(390 * 3, 844 * 3);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      _serveList([
        _ticket(),
        _ticket(
          ticketNumber: 'TCK-TEST-0003',
          uuid: '00000000-0000-4000-8000-000000000003',
          title: 'A very long subject line that has to wrap instead of pushing this row off the '
              'screen at a narrow phone width',
          status: 'IN_PROGRESS',
        ),
      ]);

      await tester.pumpWidget(_host(const DriverSupportScreen()));
      await _settle(tester);
      expect(tester.takeException(), isNull);

      await tester.pumpWidget(_host(const DriverSupportNewTicketScreen()));
      await _settle(tester);
      expect(tester.takeException(), isNull);

      await tester.pumpWidget(
          _host(const DriverSupportTicketScreen(ticketRef: 'TCK-TEST-0001')));
      await _settle(tester);
      expect(find.byKey(const ValueKey('driver-support-ticket-header')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
