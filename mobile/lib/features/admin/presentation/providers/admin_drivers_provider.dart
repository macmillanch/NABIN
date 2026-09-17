import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/nabin_api_service.dart';

final adminDriversProvider = StateNotifierProvider<AdminDriversNotifier, AsyncValue<List<dynamic>>>((ref) {
  return AdminDriversNotifier();
});

class AdminDriversNotifier extends StateNotifier<AsyncValue<List<dynamic>>> {
  AdminDriversNotifier() : super(const AsyncValue.loading()) {
    fetchDrivers();
  }

  Future<void> fetchDrivers() async {
    state = const AsyncValue.loading();
    try {
      final response = await NabinApiService.getAdminDrivers();
      if (response != null && response['success'] == true) {
        state = AsyncValue.data(response['drivers'] ?? []);
      } else {
        state = AsyncValue.error(response?['error'] ?? 'Failed to fetch drivers', StackTrace.current);
      }
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  Future<bool> updateDriverStatus(String driverId, String status) async {
    try {
      final response = await NabinApiService.updateDriverStatus(driverId, status);
      if (response != null && response['success'] == true) {
        // Refresh the list
        await fetchDrivers();
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }
}
