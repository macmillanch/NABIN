import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/network/nabin_api_service.dart';
import 'food_models.dart';

/// The slot the banner carousel asks for. Admin-owned campaigns are the only
/// source of tiles; when the slot is empty the carousel renders nothing at all.
const String kFoodHomeBannerSlot = 'FOOD_HOME_BANNER';

final foodAdvertisementsProvider =
    StateNotifierProvider<FoodAdvertisementsNotifier, AsyncValue<List<FoodAdvertisement>>>(
  (ref) => FoodAdvertisementsNotifier(slot: kFoodHomeBannerSlot),
);

class FoodAdvertisementsNotifier extends StateNotifier<AsyncValue<List<FoodAdvertisement>>> {
  FoodAdvertisementsNotifier({required this.slot}) : super(const AsyncValue<List<FoodAdvertisement>>.loading()) {
    load();
  }

  final String slot;
  int _requestSeq = 0;

  Future<void> load() async {
    final request = ++_requestSeq;
    state = const AsyncValue<List<FoodAdvertisement>>.loading();
    try {
      final response = await NabinApiService.getAdvertisements(slot: slot);
      if (!mounted || request != _requestSeq) return;

      if (response == null || response['success'] != true) {
        state = AsyncValue.error(response?['error'] ?? 'Sponsored banners failed to load.', StackTrace.current);
        return;
      }

      final raw = (response['advertisements'] as List?) ?? const <dynamic>[];
      final ads = raw
          .whereType<Map<dynamic, dynamic>>()
          .map((e) => FoodAdvertisement.fromJson(Map<String, dynamic>.from(e)))
          .toList(growable: false);
      state = AsyncValue.data(ads);
    } catch (error, stackTrace) {
      if (!mounted || request != _requestSeq) return;
      state = AsyncValue.error(error, stackTrace);
    }
  }
}
