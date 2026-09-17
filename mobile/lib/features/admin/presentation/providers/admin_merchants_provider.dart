import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/nabin_api_service.dart';

final adminMerchantsProvider = StateNotifierProvider<AdminMerchantsNotifier, AsyncValue<List<dynamic>>>((ref) {
  return AdminMerchantsNotifier();
});

class AdminMerchantsNotifier extends StateNotifier<AsyncValue<List<dynamic>>> {
  AdminMerchantsNotifier() : super(const AsyncValue.loading()) {
    fetchMerchants();
  }

  Future<void> fetchMerchants() async {
    state = const AsyncValue.loading();
    try {
      final response = await NabinApiService.getAdminRestaurants();
      if (response != null && response['success'] == true) {
        state = AsyncValue.data(response['restaurants'] ?? []);
      } else {
        state = AsyncValue.error(response?['error'] ?? 'Failed to fetch merchants', StackTrace.current);
      }
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  Future<bool> updateMerchantStatus(String restaurantId, String status) async {
    try {
      final response = await NabinApiService.updateRestaurantStatus(restaurantId, status);
      if (response != null && response['success'] == true) {
        // Refresh the list
        await fetchMerchants();
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }
}
