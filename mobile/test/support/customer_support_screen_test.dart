import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/features/support/presentation/screens/customer_support_screen.dart';

// -----------------------------------------------------------------------------
// Minimal dart:io HttpClient fake. The screen calls NabinApiService, which builds
// a raw HttpClient, so HttpOverrides is the only seam that tests the shipped code
// path (no refactor away from dart:io).
//
// For a NEW test, import `http_stub.dart` from this directory instead of copying
// this block — it carries the same two fixes and the reasons for them.
// -----------------------------------------------------------------------------

typedef _Handler = (int status, String body) Function(String method, Uri url, String body);

_Handler _handler = (_, __, ___) => (200, '{"success":true,"tickets":[]}');
final List<String> _seen = <String>[];

class _StubHeaders implements HttpHeaders {
  final Map<String, String> setHeaders = <String, String>{};

  // NabinApiService._attachAuthHeader calls headers.set(...). Leaving it to
  // noSuchMethod would delegate to Object and throw, so every request would die
  // before it was sent and the screen would land on its error state — the tests
  // would then pass on a transport failure instead of the response they claim.
  @override
  void set(String name, Object value, {bool preserveHeaderCase = false}) {
    setHeaders[name] = value.toString();
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _StubResponse extends Stream<List<int>> implements HttpClientResponse {
  _StubResponse(this._status, this._bytes);
  final int _status;
  final List<int> _bytes;

  @override
  int get statusCode => _status;

  @override
  StreamSubscription<List<int>> listen(
    void Function(List<int> event)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) {
    return Stream<List<int>>.value(_bytes).listen(
      onData,
      onError: onError,
      onDone: onDone,
      cancelOnError: cancelOnError,
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _StubRequest implements HttpClientRequest {
  _StubRequest(this._method, this._url);
  final String _method;
  final Uri _url;
  final List<int> _body = [];
  final _StubHeaders _headers = _StubHeaders();

  @override
  HttpHeaders get headers => _headers;

  @override
  void add(List<int> data) => _body.addAll(data);

  @override
  Future<HttpClientResponse> close() async {
    _seen.add('$_method ${_url.toString()}');
    final (status, body) = _handler(_method, _url, utf8.decode(_body));
    return _StubResponse(status, utf8.encode(body));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _StubClient implements HttpClient {
  @override
  Future<HttpClientRequest> getUrl(Uri url) async => _StubRequest('GET', url);

  @override
  Future<HttpClientRequest> postUrl(Uri url) async => _StubRequest('POST', url);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _StubHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) => _StubClient();
}

// -----------------------------------------------------------------------------

String _json(Object body) => jsonEncode(body);

Map<String, dynamic> _ticket({
  String id = 'TKT-REAL-1',
  String subject = 'Driver took a longer route',
  String status = 'OPEN',
}) {
  return <String, dynamic>{
    'id': id,
    'ticket_number': id,
    'subject': subject,
    'status': status,
    'category': 'RIDE_DISPUTE',
    'createdAt': '2026-10-01T09:00:00.000Z',
    'messages': <dynamic>[],
  };
}

bool _sawGet(String fragment) =>
    _seen.any((s) => s.startsWith('GET') && s.contains(fragment));

// The fake response is an in-memory stream; its data + done events land across
// several microtask/event-loop turns, so a fixed set of short pumps is used
// instead of pumpAndSettle (the loading state is an infinite spinner that never
// settles).
Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 20));
  }
}

Future<void> pumpSupport(WidgetTester tester) async {
  await tester.pumpWidget(const MaterialApp(home: CustomerSupportScreen()));
  await _settle(tester);
}

void main() {
  setUp(() {
    HttpOverrides.global = _StubHttpOverrides();
    _seen.clear();
    SessionManager.instance.saveSession(
      token: 'test-token',
      user: <String, dynamic>{'id': 'usr_real_42', 'name': 'Test Customer'},
    );
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
    _handler = (_, __, ___) => (200, '{"success":true,"tickets":[]}');
  });

  group('ticket list is read from the endpoint, not fabricated', () {
    testWidgets('renders real server tickets by their real fields', (tester) async {
      _handler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/support/user/')) {
          return (200, _json({'success': true, 'tickets': [_ticket()]}));
        }
        return (200, '{"success":true}');
      };

      await pumpSupport(tester);

      expect(find.text('TKT-REAL-1'), findsOneWidget);
      expect(find.text('Driver took a longer route'), findsOneWidget);
      // SC1: the fabricated mock literal must be gone for good.
      expect(find.text('TKT-9821'), findsNothing);
      expect(find.text('Fare calculation adjustment'), findsNothing);
      // SC5: the request path carries the signed-in id, not a hardcoded usr_2.
      expect(_sawGet('/support/user/usr_real_42'), isTrue);
    });

    testWidgets('a successful-but-empty result shows the empty state', (tester) async {
      _handler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/support/user/')) {
          return (200, _json({'success': true, 'tickets': <dynamic>[]}));
        }
        return (200, '{"success":true}');
      };

      await pumpSupport(tester);

      expect(find.textContaining('No support tickets'), findsOneWidget);
      expect(find.text('TKT-9821'), findsNothing);
    });

    testWidgets('a load failure shows a Retry state, not silent empty', (tester) async {
      _handler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/support/user/')) {
          return (500, _json({'success': false, 'error': 'boom'}));
        }
        return (200, '{"success":true}');
      };

      await pumpSupport(tester);

      expect(find.textContaining('Retry'), findsOneWidget);
      expect(find.text('TKT-9821'), findsNothing);
    });
  });

  group('submit honors real success vs failure', () {
    testWidgets('a failed submit does NOT claim success or insert a row', (tester) async {
      _handler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/support/user/')) {
          return (200, _json({'success': true, 'tickets': <dynamic>[]}));
        }
        if (method == 'POST' && url.path.contains('/support/ticket')) {
          return (500, _json({'success': false, 'error': 'Ticket service unavailable'}));
        }
        return (200, '{"success":true}');
      };

      await pumpSupport(tester);

      await tester.enterText(find.byType(TextField).at(0), 'My subject');
      await tester.enterText(find.byType(TextField).at(1), 'My description');
      await tester.tap(find.widgetWithText(ElevatedButton, 'Submit Ticket'));
      await _settle(tester);

      // SC2: failure surfaces as failure.
      expect(find.textContaining('unavailable'), findsOneWidget);
      expect(find.textContaining('raised successfully'), findsNothing);
    });

    testWidgets('a successful submit appends the real returned ticket', (tester) async {
      _handler = (method, url, _) {
        if (method == 'GET' && url.path.contains('/support/user/')) {
          return (200, _json({'success': true, 'tickets': <dynamic>[]}));
        }
        if (method == 'POST' && url.path.contains('/support/ticket')) {
          return (200, _json({
            'success': true,
            'ticket': _ticket(id: 'TKT-NEW-7', subject: 'My subject', status: 'OPEN'),
          }));
        }
        return (200, '{"success":true}');
      };

      await pumpSupport(tester);

      await tester.enterText(find.byType(TextField).at(0), 'My subject');
      await tester.enterText(find.byType(TextField).at(1), 'My description');
      await tester.tap(find.widgetWithText(ElevatedButton, 'Submit Ticket'));
      await _settle(tester);

      expect(find.text('TKT-NEW-7'), findsOneWidget);
    });
  });
}
