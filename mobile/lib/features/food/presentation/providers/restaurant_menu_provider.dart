import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/network/nabin_api_service.dart';
import 'food_models.dart';

final restaurantMenuProvider = StateNotifierProvider.family<RestaurantMenuNotifier,
    AsyncValue<List<FoodMenuItem>>, String>(
  (ref, restaurantId) => RestaurantMenuNotifier(restaurantId),
);

/// `GET /api/restaurants/:id/menu` — one notifier instance per restaurant id,
/// so switching restaurants can never paint the previous restaurant's dishes and
/// a late response can never land on a screen that moved on.
class RestaurantMenuNotifier extends StateNotifier<AsyncValue<List<FoodMenuItem>>> {
  RestaurantMenuNotifier(this.restaurantId) : super(const AsyncValue<List<FoodMenuItem>>.loading()) {
    load();
  }

  final String restaurantId;

  Future<void> load() async {
    if (restaurantId.isEmpty) {
      state = AsyncValue.error('No restaurant selected yet.', StackTrace.current);
      return;
    }
    state = const AsyncValue<List<FoodMenuItem>>.loading();
    try {
      final response = await NabinApiService.getRestaurantMenu(restaurantId);
      if (!mounted) return;

      if (response == null || response['success'] != true) {
        state = AsyncValue.error(
          response?['error'] ?? 'This menu could not be loaded. Please try again.',
          StackTrace.current,
        );
        return;
      }

      // The menu payload is deliberately flat: there is no section column on the
      // server, so no category grouping is invented here.
      final raw = (response['items'] as List?) ?? const <dynamic>[];
      final items = raw
          .whereType<Map<dynamic, dynamic>>()
          .map((e) => FoodMenuItem.fromJson(Map<String, dynamic>.from(e)))
          .where((e) => e.id.isNotEmpty)
          .toList(growable: false);
      state = AsyncValue.data(items);
    } catch (error, stackTrace) {
      if (!mounted) return;
      state = AsyncValue.error(error, stackTrace);
    }
  }
}
