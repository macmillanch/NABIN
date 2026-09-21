import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../network/nabin_api_service.dart';
import 'nabin_app_config.dart';

/// One conditional `GET /api/app/config`.
class NabinConfigResponse {
  const NabinConfigResponse({required this.status, this.etag, this.body});

  final int status;
  final String? etag;
  final Map<String, dynamic>? body;
}

/// Swappable so a test can drive the 200/304/error paths without a server.
typedef NabinConfigFetcher = Future<NabinConfigResponse> Function(String? etag);

/// Where the last-good configuration is kept between launches.
abstract class NabinConfigStore {
  Future<Map<String, dynamic>?> read();

  Future<void> write(Map<String, dynamic> payload);
}

/// On-device storage. A platform channel that is not registered — every widget
/// test, and any desktop target without plugin support — degrades to process
/// lifetime rather than throwing, because the cold-start fallback is a
/// correctness feature, not a nice-to-have.
class PreferencesNabinConfigStore implements NabinConfigStore {
  const PreferencesNabinConfigStore(this.key);

  final String key;

  Future<SharedPreferences?> _prefsOrNull() async {
    try {
      // The plugin holds its own singleton, so a cached copy here would only
      // add a mutable field to a class that is otherwise const-constructible.
      return await SharedPreferences.getInstance();
    } on MissingPluginException {
      return null;
    } on Exception {
      return null;
    }
  }

  @override
  Future<Map<String, dynamic>?> read() async {
    final prefs = await _prefsOrNull();
    if (prefs == null) return null;
    final raw = prefs.getString(key);
    if (raw == null) return null;
    try {
      final decoded = jsonDecode(raw);
      return decoded is Map ? Map<String, dynamic>.from(decoded) : null;
    } on FormatException {
      return null;
    }
  }

  @override
  Future<void> write(Map<String, dynamic> payload) async {
    final prefs = await _prefsOrNull();
    if (prefs == null) return;
    await prefs.setString(key, jsonEncode(payload));
  }
}

/// In-memory store, used by tests and as the fallback above.
class MemoryNabinConfigStore implements NabinConfigStore {
  Map<String, dynamic>? _payload;

  @override
  Future<Map<String, dynamic>?> read() async => _payload;

  @override
  Future<void> write(Map<String, dynamic> payload) async => _payload = payload;
}

/// Reads the server-driven configuration and never lets a failure become a blank
/// screen: live answer, then validated cache, then cache, then bundled defaults.
///
/// The `ETag`/`If-None-Match` pair is what makes a 30-second cache cheap on a
/// phone: an unchanged configuration costs one header, not a re-parse.
class NabinConfigRepository {
  NabinConfigRepository({
    NabinConfigStore? store,
    NabinConfigFetcher? fetch,
    this.allowStaleCache = true,
  })  : store = store ?? const PreferencesNabinConfigStore(defaultCacheKey),
        fetch = fetch ?? _httpFetch;

  static const String defaultCacheKey = 'nabin.app.config.v1';

  final NabinConfigStore store;
  final NabinConfigFetcher fetch;

  /// A cache older than its own `cacheSeconds` is still better than nothing when
  /// the server is unreachable, but it must be labelled.
  final bool allowStaleCache;

  NabinAppConfig? _current;
  String? _etag;
  DateTime? _storedAt;
  Future<NabinAppConfig>? _inFlight;

  NabinAppConfig? get current => _current;

  Future<NabinAppConfig> load({bool refresh = false}) {
    final inFlight = _inFlight;
    if (inFlight != null && !refresh) return inFlight;

    final next = _load(refresh: refresh);
    _inFlight = next;
    return next.whenComplete(() => _inFlight = null);
  }

  Future<NabinAppConfig> _load({required bool refresh}) async {
    await _restoreOnce();

    final age = _ageOfCurrent();
    if (!refresh && _current != null && age != null && age < Duration(seconds: _ttl())) {
      return _current!;
    }

    NabinConfigResponse? response;
    Object? failure;
    try {
      response = await fetch(_etag);
    } catch (error) {
      failure = error;
    }

    if (response != null && response.status == 200 && response.body != null) {
      final config = NabinAppConfig.fromJson(response.body!, source: NabinConfigSource.remote, fetchedAt: DateTime.now());
      await _remember(response.etag, response.body!);
      _current = config;
      return config;
    }

    if (response != null && response.status == 304 && _current != null) {
      // The server confirmed our copy; re-stamp it so the next TTL window is
      // measured from this answer, not from the original download.
      _current = NabinAppConfig.fromJson(
        _storedBody ?? const <String, dynamic>{},
        source: NabinConfigSource.cachedValidated,
        fetchedAt: DateTime.now(),
      );
      _storedAt = DateTime.now();
      return _current!;
    }

    if (_current != null) {
      // No live answer. A cache older than its own `cacheSeconds` still beats a
      // blank screen, but it stays labelled `cache` so nothing downstream can
      // claim the device is showing what the server currently publishes.
      return _current!;
    }

    // Nothing usable: say why, loudly enough to reach a log, then let the caller
    // paint the built-in theme rather than failing to start.
    throw NabinConfigUnavailableException(failure ?? 'status ${response?.status ?? 'unknown'}');
  }

  Map<String, dynamic>? _storedBody;
  Future<void>? _restoring;

  Future<void> _restoreOnce() async {
    if (_current != null || _storedAt != null) return;
    final restoring = _restoring;
    if (restoring != null) {
      await restoring;
      return;
    }
    final task = () async {
      final payload = await store.read();
      if (payload == null) return;
      final body = payload['body'];
      final storedAt = NabinTime.parse(payload['fetchedAt']);
      if (body is! Map || storedAt == null) return;
      _storedBody = Map<String, dynamic>.from(body);
      _etag = payload['etag'] is String ? payload['etag'] as String : null;
      _storedAt = storedAt;
      _current = NabinAppConfig.fromJson(
        _storedBody!,
        source: NabinConfigSource.cache,
        fetchedAt: storedAt,
      );
    }();
    _restoring = task;
    await task;
  }

  Future<void> _remember(String? etag, Map<String, dynamic> body) async {
    _storedAt = DateTime.now();
    _storedBody = body;
    if (etag != null) _etag = etag;
    try {
      await store.write(<String, dynamic>{
        'etag': _etag,
        'fetchedAt': _storedAt!.toIso8601String(),
        'body': body,
      });
    } on Exception {
      // A device that cannot persist still has this session's answer.
    }
  }

  Duration? _ageOfCurrent() {
    final stored = _storedAt;
    if (stored == null || _current == null) return null;
    return DateTime.now().difference(stored);
  }

  int _ttl() => (_current?.cacheSeconds ?? 30).clamp(1, 3600);

  static Future<NabinConfigResponse> _httpFetch(String? etag) async {
    final uri = Uri.parse('${NabinApiService.effectiveUrl}/app/config');
    try {
      final client = HttpClient();
      client.connectionTimeout = const Duration(seconds: 8);
      final request = await client.getUrl(uri);
      request.headers.set('accept', 'application/json');
      if (etag != null) request.headers.set('if-none-match', etag);
      final response = await request.close();
      final header = response.headers.value(HttpHeaders.etagHeader);
      if (response.statusCode == 304) {
        client.close(force: true);
        return NabinConfigResponse(status: 304, etag: header ?? etag);
      }
      final body = await response.transform(utf8.decoder).join();
      client.close(force: true);
      if (response.statusCode != 200) {
        return NabinConfigResponse(status: response.statusCode, etag: header);
      }
      final decoded = jsonDecode(body);
      if (decoded is! Map) return NabinConfigResponse(status: 502, etag: header);
      return NabinConfigResponse(
        status: 200,
        etag: header,
        body: Map<String, dynamic>.from(decoded),
      );
    } on SocketException {
      return const NabinConfigResponse(status: 0);
    } on TimeoutException {
      return const NabinConfigResponse(status: 0);
    } on FormatException {
      return const NabinConfigResponse(status: 502);
    }
  }
}

/// Raised when there is no live answer and no stored answer to fall back to.
class NabinConfigUnavailableException implements Exception {
  const NabinConfigUnavailableException(this.reason);

  final Object reason;

  @override
  String toString() => 'Configuration unavailable ($reason). Using built-in defaults.';
}
