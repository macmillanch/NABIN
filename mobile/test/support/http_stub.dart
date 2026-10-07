import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// A `dart:io` [HttpClient] fake for widget tests that exercise the shipped
/// `NabinApiService` code path.
///
/// Two members here are load-bearing and were both wrong once:
/// - [HttpHeaders.set] must be implemented, not left to `noSuchMethod`.
///   `NabinApiService._attachAuthHeader` calls it, `Object.noSuchMethod` throws,
///   the API method's own `catch` turns that into a non-success map, and the
///   screen silently lands on its error state without a request ever leaving.
///   Tests then read as green off the broken transport. See
///   `customer_support_screen_test.dart`.
/// - There is no `addAll` on `HttpClientRequest`, so this fake declares only the
///   members `NabinApiService` actually touches.

typedef StubHandler = (int status, String body) Function(
    String method, Uri url, String body);

/// Handler the fake consults for every request. Set it per test.
StubHandler stubHandler = (_, __, ___) => (200, '{"success":true}');

/// How long the fake waits before it answers. Non-zero only where a test has to observe
/// the window between "the write left" and "the answer landed" — a saving spinner is
/// invisible at zero delay, because the whole request resolves inside the pump that
/// started it. `tester.pump()` does not advance a timer, so a pending delay keeps the
/// in-flight state on screen for the assertion.
Duration stubDelay = Duration.zero;

/// Every request the fake served, as "METHOD url". Assert on this: a screen that
/// renders an error state proves nothing until the request is seen here.
final List<String> stubSeen = <String>[];

/// The body each served request carried, in the same order as [stubSeen]. A screen
/// that says it saved something has to be held to what it actually sent.
final List<String> stubBodies = <String>[];

bool stubSaw(String method, String pathFragment) => stubSeen.any(
    (s) => s.startsWith('$method ') && s.contains(pathFragment));

/// The body of the first request matching METHOD + path fragment, or null.
String? stubBodyFor(String method, String pathFragment) {
  for (var i = 0; i < stubSeen.length; i++) {
    if (stubSeen[i].startsWith('$method ') && stubSeen[i].contains(pathFragment)) {
      return stubBodies[i];
    }
  }
  return null;
}

void stubReset() {
  stubSeen.clear();
  stubBodies.clear();
  stubHandler = (_, __, ___) => (200, '{"success":true}');
  stubDelay = Duration.zero;
}

class StubHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) => _StubClient();
}

class _StubHeaders implements HttpHeaders {
  final Map<String, String> values = <String, String>{};

  @override
  void set(String name, Object value, {bool preserveHeaderCase = false}) {
    values[name] = value.toString();
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
  final List<int> _body = <int>[];
  final _StubHeaders _headers = _StubHeaders();

  @override
  HttpHeaders get headers => _headers;

  @override
  void add(List<int> data) => _body.addAll(data);

  @override
  Future<HttpClientResponse> close() async {
    final String body = utf8.decode(_body);
    stubSeen.add('$_method ${_url.toString()}');
    stubBodies.add(body);
    if (stubDelay > Duration.zero) await Future<void>.delayed(stubDelay);
    final (status, responseBody) = stubHandler(_method, _url, body);
    return _StubResponse(status, utf8.encode(responseBody));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _StubClient implements HttpClient {
  @override
  Future<HttpClientRequest> getUrl(Uri url) async => _StubRequest('GET', url);

  @override
  Future<HttpClientRequest> postUrl(Uri url) async =>
      _StubRequest('POST', url);

  /// `NabinApiService._putJson` goes through `openUrl` rather than a verb helper, and
  /// `noSuchMethod` on this fake throws — which the API method's own `catch` folds into a
  /// null result, so a PUT-only screen would read as a clean failure without a request
  /// ever leaving.
  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) async =>
      _StubRequest(method, url);

  /// Same trap for `NabinApiService._deleteJson`: an unimplemented `deleteUrl` throws
  /// into that `catch`, the repository reports "NABIN did not remove it", and the test
  /// passes while no DELETE ever left the process.
  @override
  Future<HttpClientRequest> deleteUrl(Uri url) async => _StubRequest('DELETE', url);

  /// A screen that renders a map disposes it when the test ends, and `flutter_map`'s
  /// tile provider closes its `package:http` `IOClient` on the way out, which calls
  /// `close(force: true)` here. Left to `noSuchMethod` that throws during teardown, so
  /// every test that painted a map fails on the fake's own gap rather than on the
  /// screen. The fake holds no socket, so answering the call is all it needs to do.
  @override
  void close({bool force = false}) {}

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
