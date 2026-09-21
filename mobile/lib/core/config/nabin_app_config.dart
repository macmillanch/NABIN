import 'package:flutter/material.dart';

/// Where a config snapshot came from. A cached copy is a different claim from a
/// live one, and the UI has to be able to say which it is painting.
enum NabinConfigSource {
  /// The server answered on this launch.
  remote,

  /// The server said `304 Not Modified`, so the stored copy is still current.
  cachedValidated,

  /// Read from on-device storage because the network or the server failed.
  cache,

  /// Nothing published and nothing stored: the app paints its built-in theme.
  bundled,
}

/// One service row of `sections.services`.
@immutable
class NabinServiceState {
  const NabinServiceState({
    required this.id,
    required this.status,
    this.name,
    this.resumeAt,
    this.broadcastNotice,
  });

  final String id;

  /// `ACTIVE`, `PAUSED`, `DEGRADED` or `EMERGENCY_STOP` — whatever the server
  /// says, never inferred from a local timer.
  final String status;
  final String? name;
  final DateTime? resumeAt;
  final String? broadcastNotice;

  bool get isOperational => status == 'ACTIVE';

  factory NabinServiceState.fromJson(Map<String, dynamic> json) => NabinServiceState(
        id: json['id'] is String ? json['id'] as String : '',
        status: json['status'] is String ? json['status'] as String : 'UNKNOWN',
        name: json['name'] is String ? json['name'] as String : null,
        resumeAt: NabinTime.parse(json['resumeAt']),
        broadcastNotice:
            json['broadcastNotice'] is String ? json['broadcastNotice'] as String : null,
      );
}

/// The `sections.advertisements` pointer. Campaign rows come from their own
/// endpoint; this only says where to ask and what the store can serve.
@immutable
class NabinAdSlotPointer {
  const NabinAdSlotPointer({
    required this.available,
    required this.endpoint,
    required this.placements,
  });

  final bool available;
  final String endpoint;
  final List<String> placements;
}

/// Parsed, validated `GET /api/app/config`.
///
/// Every field is optional by construction: a section the server did not send,
/// or a value that fails validation, falls back to the bundled default and is
/// named in [rejected] so a screen can say so instead of guessing. Nothing here
/// is executed — the feed is data, so a published value changes what the app
/// paints, never what it does.
@immutable
class NabinAppConfig {
  const NabinAppConfig({
    required this.source,
    required this.fetchedAt,
    required this.serverTime,
    this.configVersion,
    this.cacheSeconds = 30,
    this.stale = false,
    this.dataSource,
    this.theme = const <String, Color>{},
    this.services = const <String, NabinServiceState>{},
    this.platformStatus,
    this.features = const <String, bool>{},
    this.settings = const <String, dynamic>{},
    this.adSlots = const NabinAdSlotPointer(
      available: false,
      endpoint: '/api/advertisements',
      placements: <String>[],
    ),
    this.rejected = const <String>[],
  });

  final NabinConfigSource source;

  /// Local wall clock when this snapshot was read, used to age the server's
  /// instant forward without trusting the device's date being correct.
  final DateTime fetchedAt;
  final DateTime? serverTime;
  final String? configVersion;
  final int cacheSeconds;

  /// The server itself flagged its configuration as stale.
  final bool stale;
  final String? dataSource;

  /// Remote colours keyed by token name, already validated as `#RRGGBB`.
  final Map<String, Color> theme;
  final Map<String, NabinServiceState> services;

  /// `sections.services.summary.platformStatus`: `OPERATIONAL`,
  /// `PARTIALLY_DEGRADED` or `EMERGENCY_LOCKDOWN`, as the switchboard itself
  /// reports it.
  final String? platformStatus;
  final Map<String, bool> features;
  final Map<String, dynamic> settings;
  final NabinAdSlotPointer adSlots;

  /// Values dropped during validation, e.g. `theme.brand(#123)`.
  final List<String> rejected;

  bool get isLive => source == NabinConfigSource.remote;

  /// True only when the server published at least one usable colour token.
  bool get hasRemoteTheme => theme.isNotEmpty;

  /// The instant remote windows are measured against. Falls back to null rather
  /// than pretending a device clock is the server's.
  DateTime? get serverNowUtc {
    final reference = serverTime;
    if (reference == null) return null;
    return reference.add(DateTime.now().difference(fetchedAt));
  }

  /// How far the device clock sits from the server's, at the time of the
  /// response. Surfaced, not silently corrected.
  Duration? get clockSkew {
    final reference = serverTime;
    if (reference == null) return null;
    return fetchedAt.toUtc().difference(reference);
  }

  bool featureEnabled(String key, {bool fallback = true}) {
    final value = features[key];
    return value is bool ? value : fallback;
  }

  NabinServiceState? service(String id) => services[id];

  /// The whole platform is stopped.
  ///
  /// The switchboard reports a lockdown as every service paused plus
  /// `summary.platformStatus: EMERGENCY_LOCKDOWN`; a row that literally says
  /// `EMERGENCY_STOP` is honoured too, because the most severe published state
  /// wins over guessing which spelling an operator used.
  bool get emergencyStop =>
      platformStatus == 'EMERGENCY_LOCKDOWN' ||
      platformStatus == 'EMERGENCY_STOP' ||
      services.values.any((service) => service.status == 'EMERGENCY_STOP');

  static NabinAppConfig bundled() => NabinAppConfig(
        source: NabinConfigSource.bundled,
        fetchedAt: DateTime.now(),
        serverTime: null,
      );

  factory NabinAppConfig.fromJson(
    Map<String, dynamic> json, {
    required NabinConfigSource source,
    required DateTime fetchedAt,
  }) {
    final rejected = <String>[];
    final sections = _asMap(json['sections'], 'sections', rejected);

    return NabinAppConfig(
      source: source,
      fetchedAt: fetchedAt,
      serverTime: NabinTime.parse(json['serverTime']),
      configVersion: json['configVersion'] is String ? json['configVersion'] as String : null,
      cacheSeconds:
          json['cacheSeconds'] is num ? (json['cacheSeconds'] as num).round() : 30,
      stale: json['stale'] == true,
      dataSource: json['dataSource'] is String ? json['dataSource'] as String : null,
      theme: _parseTheme(sections['theme'], rejected),
      services: _parseServices(sections['services'], rejected),
      platformStatus: _platformStatus(sections['services']),
      features: _parseFeatures(sections['features'], rejected),
      settings: _asMap(sections['settings'], 'settings', rejected),
      adSlots: _parseAdSlots(sections['advertisements'], rejected),
      rejected: List<String>.unmodifiable(rejected),
    );
  }

  static Map<String, dynamic> _asMap(Object? value, String key, List<String> rejected) {
    if (value is Map) return Map<String, dynamic>.from(value);
    if (value != null) rejected.add(key);
    return const <String, dynamic>{};
  }

  static Map<String, Color> _parseTheme(Object? raw, List<String> rejected) {
    final section = _asMap(raw, 'sections.theme', rejected);
    final tokens = _asMap(section['tokens'], 'theme.tokens', rejected);
    final known = section['knownTokens'] is List
        ? (section['knownTokens'] as List).whereType<String>().toSet()
        : const <String>{};
    final out = <String, Color>{};
    tokens.forEach((key, value) {
      if (known.isNotEmpty && !known.contains(key)) {
        rejected.add('theme.$key(unknown token)');
        return;
      }
      final color = parseHexColor(value);
      if (color == null) {
        rejected.add('theme.$key($value)');
        return;
      }
      out[key] = color;
    });
    return Map<String, Color>.unmodifiable(out);
  }

  /// The switchboard's own rollup, read from the summary it publishes rather
  /// than inferred on the device from a count of paused rows.
  static String? _platformStatus(Object? raw) {
    final section = raw is Map ? raw['summary'] : null;
    if (section is Map && section['platformStatus'] is String) {
      return section['platformStatus'] as String;
    }
    return null;
  }

  static Map<String, NabinServiceState> _parseServices(Object? raw, List<String> rejected) {
    final section = _asMap(raw, 'sections.services', rejected);
    final rows = section['services'] is List ? section['services'] as List : const <dynamic>[];
    final out = <String, NabinServiceState>{};
    for (final row in rows.whereType<Map>()) {
      final service = NabinServiceState.fromJson(Map<String, dynamic>.from(row));
      if (service.id.isEmpty) {
        rejected.add('services.row(missing id)');
        continue;
      }
      out[service.id] = service;
    }
    return Map<String, NabinServiceState>.unmodifiable(out);
  }

  static Map<String, bool> _parseFeatures(Object? raw, List<String> rejected) {
    final section = _asMap(raw, 'sections.features', rejected);
    final flags = _asMap(section['features'], 'features.flags', rejected);
    final out = <String, bool>{};
    flags.forEach((key, value) {
      if (value is Map && value['enabled'] is bool) {
        out[key] = value['enabled'] as bool;
      } else {
        rejected.add('features.$key');
      }
    });
    return Map<String, bool>.unmodifiable(out);
  }

  static NabinAdSlotPointer _parseAdSlots(Object? raw, List<String> rejected) {
    final section = _asMap(raw, 'sections.advertisements', rejected);
    if (section.isEmpty) {
      return const NabinAdSlotPointer(
        available: false,
        endpoint: '/api/advertisements',
        placements: <String>[],
      );
    }
    return NabinAdSlotPointer(
      available: section['available'] == true,
      endpoint:
          section['endpoint'] is String ? section['endpoint'] as String : '/api/advertisements',
      placements: section['supportedPlacements'] is List
          ? List<String>.unmodifiable(
              (section['supportedPlacements'] as List).whereType<String>(),
            )
          : const <String>[],
    );
  }
}

/// `#RRGGBB` only. A wider grammar would let a published value arrive
/// expression-shaped, and this parser is the only thing between that string and
/// a widget.
Color? parseHexColor(Object? value) {
  if (value is! String) return null;
  final match = RegExp(r'^#([0-9a-fA-F]{6})$').firstMatch(value.trim());
  if (match == null) return null;
  final rgb = int.tryParse(match.group(1)!, radix: 16);
  if (rgb == null) return null;
  return Color(0xFF000000 | rgb);
}

class NabinTime {
  /// Remote instants only; returns null for anything malformed rather than
  /// falling back to the device clock.
  static DateTime? parse(Object? value) {
    if (value is! String) return null;
    final parsed = DateTime.tryParse(value);
    return parsed?.toUtc();
  }
}
