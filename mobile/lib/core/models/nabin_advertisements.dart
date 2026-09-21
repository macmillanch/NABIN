import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../network/nabin_api_service.dart';

/// One published campaign row, as the durable store can actually describe it.
///
/// `advertisements` has no priority, brand, tagline, creative or bid-rate column,
/// so this model has no fields for them either: an app that asked for those
/// would render nothing but defaults and look like a working campaign system.
@immutable
class NabinAdvertisement {
  const NabinAdvertisement({
    required this.id,
    required this.title,
    required this.placement,
    this.imageUrl,
    this.targetUrl,
    this.startsAt,
    this.endsAt,
  });

  final String id;
  final String title;
  final String placement;
  final String? imageUrl;
  final String? targetUrl;
  final DateTime? startsAt;
  final DateTime? endsAt;

  /// The campaign is inside its own schedule at [moment].
  ///
  /// The server already filters to ACTIVE rows, but a cached copy of the feed can
  /// outlive a campaign, so the window is re-checked against the server's clock
  /// rather than the device's — a phone with the wrong date must not extend or
  /// cut a campaign.
  bool isActiveAt(DateTime? moment) {
    if (moment == null) return true;
    final start = startsAt;
    final end = endsAt;
    if (start != null && moment.isBefore(start)) return false;
    if (end != null && moment.isAfter(end)) return false;
    return true;
  }

  factory NabinAdvertisement.fromJson(Map<String, dynamic> json) => NabinAdvertisement(
        id: _string(json['id']) ?? '',
        title: _string(json['title']) ?? 'NABIN',
        placement: _string(json['placement']) ?? _string(json['slot']) ?? '',
        imageUrl: _string(json['imageUrl']),
        targetUrl: _string(json['targetUrl']) ?? _string(json['ctaLink']),
        startsAt: _date(json['startDate']),
        endsAt: _date(json['endDate']),
      );
}

/// What came back for one placement, with the honesty flags the endpoint carries.
@immutable
class NabinAdvertisementFeed {
  const NabinAdvertisementFeed({
    required this.placement,
    this.items = const <NabinAdvertisement>[],
    this.dataSource,
    this.degraded = false,
  });

  final String placement;
  final List<NabinAdvertisement> items;

  /// `postgres` or `fixture`: the app can say whether these are stored campaigns.
  final String? dataSource;

  /// The store could not be read, so this is a degraded answer, not an empty one.
  final bool degraded;

  /// Campaigns live right now, per the caller's copy of the server clock.
  List<NabinAdvertisement> activeAt(DateTime? moment) =>
      items.where((ad) => ad.isActiveAt(moment)).toList(growable: false);
}

/// The placement enum the frozen schema knows. A slot name outside this list is a
/// client-side alias, which the server resolves and reports back.
const String kHomeBannerPlacement = 'HOME_BANNER';

/// Banners are fetched per placement, so the customer home and any other surface
/// ask for their own slot without sharing a cache key that could mislabel one.
final nabinAdvertisementsProvider =
    FutureProvider.autoDispose.family<NabinAdvertisementFeed, String>((ref, placement) async {
  final response = await NabinApiService.getAdvertisements(slot: placement);
  if (response == null || response['success'] != true) {
    throw NabinAdvertisementsUnavailable(
      _string(response?['error']) ?? 'The banner feed did not answer.',
    );
  }
  final rows = (response['advertisements'] as List?) ?? const <dynamic>[];
  return NabinAdvertisementFeed(
    placement: _string(response['placement']) ?? placement,
    items: rows
        .whereType<Map>()
        .map((row) => NabinAdvertisement.fromJson(Map<String, dynamic>.from(row)))
        .toList(growable: false),
    dataSource: _string(response['dataSource']),
    degraded: response['degraded'] == true,
  );
});

class NabinAdvertisementsUnavailable implements Exception {
  const NabinAdvertisementsUnavailable(this.message);

  final String message;

  @override
  String toString() => 'NabinAdvertisementsUnavailable: $message';
}

String? _string(Object? value) {
  if (value is String && value.trim().isNotEmpty) return value.trim();
  return null;
}

DateTime? _date(Object? value) {
  if (value is! String) return null;
  return DateTime.tryParse(value)?.toUtc();
}
