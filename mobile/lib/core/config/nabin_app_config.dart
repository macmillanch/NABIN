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

/// The colour tokens a campaign is allowed to recolour.
///
/// This is the client half of the vocabulary the backend publishes as
/// `theme.knownTokens`. A token with no field on `NabinPalette` has nothing to
/// paint, so accepting one would only let a publication look effective while
/// it changed nothing.
const Set<String> nabinThemeTokens = <String>{
  'brand',
  'brandTint',
  'onBrand',
  'canvas',
  'surface',
  'surfaceMuted',
  'surfaceEmphasized',
  'onSurface',
  'onSurfaceMuted',
  'divider',
  'success',
  'warning',
  'danger',
  'foodAccent',
  'groceryAccent',
};

/// One creative from a campaign's asset rows, already narrowed server-side to
/// the banner-shaped kinds.
@immutable
class NabinCampaignCreative {
  const NabinCampaignCreative({
    required this.kind,
    required this.url,
    this.altText,
    this.locale,
    this.priority = 0,
  });

  /// `BANNER` or `PROMOTIONAL_IMAGE`.
  final String kind;

  /// Already validated as an `http` or `https` URL: this string goes straight
  /// into `Image.network`, so anything else is dropped rather than passed on.
  final String url;
  final String? altText;
  final String? locale;
  final int priority;
}

/// A service-specific discount the campaign points at.
///
/// The number here is for display only. Checkout validates the coupon against
/// the server's own `promotions` row, so a published value can never set a
/// price — it can only describe one.
@immutable
class NabinCampaignOffer {
  const NabinCampaignOffer({
    required this.serviceType,
    this.copy,
    this.couponCode,
    this.discountType,
    this.discountValue,
  });

  /// `RIDE`, `FOOD`, `GROCERY` or `PARCEL`.
  final String serviceType;
  final String? copy;
  final String? couponCode;

  /// `PERCENTAGE` or `FLAT`, as the coupon row spells it.
  final String? discountType;
  final num? discountValue;

  bool get hasCoupon => couponCode != null && couponCode!.isNotEmpty;

  /// The discount in the customer's words, or null when nothing usable was
  /// published — the app would rather say nothing than invent a number.
  String? get savingsText {
    final value = discountValue;
    if (value == null || value <= 0) return null;
    if (discountType == 'PERCENTAGE') return '${value % 1 == 0 ? value.toInt() : value}% OFF';
    if (discountType == 'FLAT') return '₹${value % 1 == 0 ? value.toInt() : value} OFF';
    return null;
  }
}

/// Copy the campaign wants the customer to read: an announcement, a popup, a
/// toast. No message here is triggered by a local timer or a local rule; the
/// campaign either published it or it did not.
@immutable
class NabinCampaignMessage {
  const NabinCampaignMessage({
    required this.kind,
    this.title,
    this.body,
    this.surface,
    this.triggerEvent,
    this.dismissible = true,
    this.showOnce = false,
    this.locale,
    this.priority = 0,
  });

  /// `ANNOUNCEMENT`, `POPUP`, `INLINE_BANNER` or `TOAST`.
  final String kind;
  final String? title;
  final String? body;

  /// Where the operator meant this for, e.g. `HOME` or `CHECKOUT`.
  final String? surface;
  final String? triggerEvent;
  final bool dismissible;
  final bool showOnce;
  final String? locale;
  final int priority;

  bool get hasText => (title?.trim().isNotEmpty ?? false) || (body?.trim().isNotEmpty ?? false);
}

/// A campaign's look: colour overrides plus its logo, wordmark and splash.
@immutable
class NabinCampaignTheme {
  const NabinCampaignTheme({
    this.palette = const <String, Color>{},
    this.logoUrl,
    this.wordmarkUrl,
    this.splashUrl,
  });

  final Map<String, Color> palette;
  final String? logoUrl;
  final String? wordmarkUrl;
  final String? splashUrl;

  bool get isEmpty =>
      palette.isEmpty && logoUrl == null && wordmarkUrl == null && splashUrl == null;
}

/// One campaign from `sections.campaigns`.
///
/// The server resolves which campaigns are live against its own clock, so the
/// list arriving here is already ordered by priority. That ordering is preserved
/// rather than re-sorted: the first row a service matches is the one the switch
/// would have picked.
@immutable
class NabinCampaign {
  const NabinCampaign({
    required this.id,
    required this.code,
    required this.name,
    this.priority = 0,
    this.serviceTypes = const <String>[],
    this.startsAt,
    this.endsAt,
    this.theme = const NabinCampaignTheme(),
    this.creatives = const <NabinCampaignCreative>[],
    this.offers = const <NabinCampaignOffer>[],
    this.messages = const <NabinCampaignMessage>[],
  });

  final String id;

  /// The operator's stable handle, e.g. `XMAS-2026`.
  final String code;
  final String name;
  final int priority;

  /// Empty means the campaign is platform-wide.
  final List<String> serviceTypes;

  /// The schedule the server published. These are the same instants PostgreSQL
  /// compared when it resolved this row, kept so a cached snapshot can re-check
  /// them instead of serving a festival that has ended.
  final DateTime? startsAt;
  final DateTime? endsAt;
  final NabinCampaignTheme theme;
  final List<NabinCampaignCreative> creatives;
  final List<NabinCampaignOffer> offers;
  final List<NabinCampaignMessage> messages;

  bool get isPlatformWide => serviceTypes.isEmpty;

  bool targets(String? serviceType) =>
      serviceType == null || serviceTypes.isEmpty || serviceTypes.contains(serviceType);

  bool isLiveAt(DateTime? moment) {
    if (moment == null) return true;
    final start = startsAt;
    final end = endsAt;
    if (start != null && moment.isBefore(start)) return false;
    if (end != null && !moment.isBefore(end)) return false;
    return true;
  }

  NabinCampaignOffer? offerFor(String serviceType) {
    for (final offer in offers) {
      if (offer.serviceType == serviceType) return offer;
    }
    return null;
  }

  List<NabinCampaignMessage> messagesOf(String kind) =>
      messages.where((message) => message.kind == kind).toList(growable: false);

  factory NabinCampaign.fromJson(Map<String, dynamic> json, List<String> rejected) {
    final id = json['id'] is String ? json['id'] as String : '';
    final code = json['code'] is String ? json['code'] as String : '';
    final where = code.isEmpty ? 'campaigns.row' : 'campaign.$code';
    if (id.isEmpty) {
      rejected.add('$where(missing id)');
      return NabinCampaign(id: id, code: code, name: 'Campaign');
    }

    final themeRaw = json['theme'] is Map ? Map<String, dynamic>.from(json['theme'] as Map) : null;
    final palette = <String, Color>{};
    if (themeRaw != null) {
      final tokens = themeRaw['palette'];
      if (tokens is Map) {
        tokens.forEach((key, value) {
          final name = key is String ? key : '';
          if (!nabinThemeTokens.contains(name)) {
            rejected.add('$where.theme.$name(unknown token)');
            return;
          }
          final color = parseHexColor(value);
          if (color == null) {
            rejected.add('$where.theme.$name($value)');
            return;
          }
          palette[name] = color;
        });
      } else if (tokens != null) {
        rejected.add('$where.theme.palette');
      }
    }

    return NabinCampaign(
      id: id,
      code: code,
      name: json['name'] is String ? json['name'] as String : 'Campaign',
      priority: json['priority'] is num ? (json['priority'] as num).round() : 0,
      serviceTypes: json['serviceTypes'] is List
          ? List<String>.unmodifiable((json['serviceTypes'] as List).whereType<String>())
          : const <String>[],
      startsAt: NabinTime.parse(json['startsAt']),
      endsAt: NabinTime.parse(json['endsAt']),
      theme: NabinCampaignTheme(
        palette: Map<String, Color>.unmodifiable(palette),
        logoUrl: parseImageUrl(themeRaw?['logoUrl'], rejected, '$where.logoUrl'),
        wordmarkUrl: parseImageUrl(themeRaw?['wordmarkUrl'], rejected, '$where.wordmarkUrl'),
        splashUrl: parseImageUrl(themeRaw?['splashUrl'], rejected, '$where.splashUrl'),
      ),
      creatives: _campaignCreatives(json['banners'], rejected, where),
      offers: _campaignOffers(json['offers'], rejected, where),
      messages: _campaignMessages(json['messages'], rejected, where),
    );
  }

  static List<NabinCampaignCreative> _campaignCreatives(
    Object? raw,
    List<String> rejected,
    String where,
  ) {
    if (raw is! List) {
      if (raw != null) rejected.add('$where.banners');
      return const <NabinCampaignCreative>[];
    }
    final out = <NabinCampaignCreative>[];
    for (final row in raw.whereType<Map>()) {
      final json = Map<String, dynamic>.from(row);
      final url = parseImageUrl(json['url'], rejected, '$where.banner');
      if (url == null) continue;
      out.add(NabinCampaignCreative(
        kind: json['kind'] is String ? json['kind'] as String : 'BANNER',
        url: url,
        altText: json['altText'] is String ? json['altText'] as String : null,
        locale: json['locale'] is String ? json['locale'] as String : null,
        priority: json['priority'] is num ? (json['priority'] as num).round() : 0,
      ));
    }
    return List<NabinCampaignCreative>.unmodifiable(out);
  }

  static List<NabinCampaignOffer> _campaignOffers(
    Object? raw,
    List<String> rejected,
    String where,
  ) {
    if (raw is! List) {
      if (raw != null) rejected.add('$where.offers');
      return const <NabinCampaignOffer>[];
    }
    final out = <NabinCampaignOffer>[];
    for (final row in raw.whereType<Map>()) {
      final json = Map<String, dynamic>.from(row);
      if (json['serviceType'] is! String) {
        rejected.add('$where.offer(missing serviceType)');
        continue;
      }
      final value = json['discountValue'];
      out.add(NabinCampaignOffer(
        serviceType: json['serviceType'] as String,
        copy: json['copy'] is String ? json['copy'] as String : null,
        couponCode: json['couponCode'] is String ? json['couponCode'] as String : null,
        discountType: json['discountType'] is String ? json['discountType'] as String : null,
        discountValue: value is num && !value.isInfinite ? value : null,
      ));
    }
    return List<NabinCampaignOffer>.unmodifiable(out);
  }

  static List<NabinCampaignMessage> _campaignMessages(
    Object? raw,
    List<String> rejected,
    String where,
  ) {
    if (raw is! List) {
      if (raw != null) rejected.add('$where.messages');
      return const <NabinCampaignMessage>[];
    }
    final out = <NabinCampaignMessage>[];
    for (final row in raw.whereType<Map>()) {
      final json = Map<String, dynamic>.from(row);
      final message = NabinCampaignMessage(
        kind: json['kind'] is String ? json['kind'] as String : 'ANNOUNCEMENT',
        title: json['title'] is String ? json['title'] as String : null,
        body: json['body'] is String ? json['body'] as String : null,
        surface: json['surface'] is String ? json['surface'] as String : null,
        triggerEvent: json['triggerEvent'] is String ? json['triggerEvent'] as String : null,
        dismissible: json['dismissible'] != false,
        showOnce: json['showOnce'] == true,
        locale: json['locale'] is String ? json['locale'] as String : null,
        priority: json['priority'] is num ? (json['priority'] as num).round() : 0,
      );
      if (!message.hasText) {
        rejected.add('$where.message(empty)');
        continue;
      }
      out.add(message);
    }
    return List<NabinCampaignMessage>.unmodifiable(out);
  }
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
    this.campaigns = const <NabinCampaign>[],
    this.campaignsDegraded = false,
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

  /// Live campaigns in the order the server resolved them, highest priority
  /// first. An empty list is the honest answer to "nothing is running".
  final List<NabinCampaign> campaigns;

  /// The campaign store could not be read, which is a different claim from no
  /// campaign being live.
  final bool campaignsDegraded;
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

  /// True when something outside this build is choosing the app's colours —
  /// either a published theme token or a live campaign's palette.
  bool get hasRemoteTheme => effectiveTheme.isNotEmpty;

  /// The campaigns still inside their published window, in the server's own
  /// priority order.
  ///
  /// A cached snapshot can outlive the festival it describes, so the window is
  /// re-checked here against the server's clock. When there is no server clock to
  /// measure against, the publication stands: the server resolved this list
  /// against its own clock moments before sending it.
  List<NabinCampaign> get liveCampaigns {
    final now = serverNowUtc;
    return campaigns.where((campaign) => campaign.isLiveAt(now)).toList(growable: false);
  }

  /// The campaign a service is running under, or null.
  NabinCampaign? campaignFor(String? serviceType) {
    for (final campaign in liveCampaigns) {
      if (campaign.targets(serviceType)) return campaign;
    }
    return null;
  }

  /// The campaign whose colours are painting the app: the first live one that
  /// actually published a usable token.
  ///
  /// A campaign aimed at one service can still set the platform's look, because
  /// that is what an operator means by a festival theme; its *offers* stay
  /// gated to the services it targets.
  NabinCampaign? get themeCampaign {
    for (final campaign in liveCampaigns) {
      if (campaign.theme.palette.isNotEmpty) return campaign;
    }
    return null;
  }

  /// The published theme with the winning campaign's palette applied over it.
  Map<String, Color> get effectiveTheme {
    final override = themeCampaign?.theme.palette;
    if (override == null || override.isEmpty) return theme;
    return <String, Color>{...theme, ...override};
  }

  /// The name a screen shows when it says where the current colours came from.
  String? get themeCampaignName {
    final campaign = themeCampaign;
    if (campaign == null || campaign.theme.palette.isEmpty) return null;
    return campaign.name;
  }

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
    final campaignSection = sections['campaigns'];

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
      campaigns: _parseCampaigns(campaignSection, rejected),
      campaignsDegraded:
          campaignSection is Map && campaignSection['degraded'] == true,
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

  /// The campaign rows, in the priority order the server resolved them in.
  ///
  /// The section is optional by design: a deployment without campaign tables
  /// publishes `degraded` with an empty list, and the app keeps its bundled look
  /// instead of failing to start.
  static List<NabinCampaign> _parseCampaigns(Object? raw, List<String> rejected) {
    final section = _asMap(raw, 'sections.campaigns', rejected);
    final rows = section['campaigns'] is List ? section['campaigns'] as List : const <dynamic>[];
    final out = <NabinCampaign>[];
    for (final row in rows.whereType<Map>()) {
      final campaign = NabinCampaign.fromJson(Map<String, dynamic>.from(row), rejected);
      if (campaign.id.isEmpty) continue;
      out.add(campaign);
    }
    return List<NabinCampaign>.unmodifiable(out);
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

/// An `http` or `https` image address, or null.
///
/// The same grammar the campaign tables enforce. This is the only thing between
/// a published string and `Image.network`, so a `file://`, `javascript:` or
/// relative path is dropped and named in [rejected] rather than fetched.
String? parseImageUrl(Object? value, List<String> rejected, String where) {
  if (value is! String) {
    if (value != null) rejected.add('$where(not a string)');
    return null;
  }
  final trimmed = value.trim();
  if (trimmed.isEmpty || trimmed.length > 2048 || trimmed.contains(RegExp(r'\s'))) {
    rejected.add('$where(malformed)');
    return null;
  }
  final uri = Uri.tryParse(trimmed);
  if (uri == null) {
    rejected.add('$where(unparseable)');
    return null;
  }
  if (uri.scheme != 'http' && uri.scheme != 'https') {
    rejected.add('$where(${uri.scheme.isEmpty ? 'no scheme' : uri.scheme})');
    return null;
  }
  if (uri.host.isEmpty) {
    rejected.add('$where(no host)');
    return null;
  }
  return trimmed;
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
