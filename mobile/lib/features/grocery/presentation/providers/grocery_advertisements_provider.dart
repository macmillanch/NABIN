import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../models/grocery_advertisement.dart';

/// Slot name the advertisements endpoint serves. Promotional tiles are only ever
/// rendered when this returns rows, so an empty or failed campaign feed leaves no
/// reserved whitespace on the browsing screens.
const String groceryHeroCarouselSlot = 'GROCERY_HERO_CAROUSEL';

class GroceryAdvertisementsNotifier
    extends StateNotifier<AsyncValue<List<GroceryAdvertisement>>> {
  GroceryAdvertisementsNotifier({required this.slot, this.service})
      : super(const AsyncValue.loading()) {
    load();
  }

  final String slot;
  final String? service;

  int _requestToken = 0;

  Future<void> load() async {
    final int token = ++_requestToken;
    state = const AsyncValue<List<GroceryAdvertisement>>.loading().copyWithPrevious(state);
    try {
      final Map<String, dynamic>? response =
          await NabinApiService.getAdvertisements(slot: slot, service: service);
      if (!mounted || token != _requestToken) return;
      if (response?['success'] == true) {
        state = AsyncValue.data(parseAdvertisements(response?['advertisements']));
      } else {
        state = AsyncValue.error(
          (response?['error'] ?? 'No sponsored campaigns available.').toString(),
          StackTrace.current,
        );
      }
    } catch (error, stackTrace) {
      if (!mounted || token != _requestToken) return;
      state = AsyncValue.error(error, stackTrace);
    }
  }
}

List<GroceryAdvertisement> parseAdvertisements(Object? raw) {
  if (raw is! List) return const <GroceryAdvertisement>[];
  return raw
      .whereType<Map>()
      .map((Map row) => GroceryAdvertisement.fromApi(row.cast<String, dynamic>()))
      .where((GroceryAdvertisement ad) => ad.id.isNotEmpty || ad.title.isNotEmpty)
      .toList();
}

final groceryCarouselAdsProvider = StateNotifierProvider<GroceryAdvertisementsNotifier,
    AsyncValue<List<GroceryAdvertisement>>>(
  (ref) => GroceryAdvertisementsNotifier(
    slot: groceryHeroCarouselSlot,
    service: 'GROCERY',
  ),
);
