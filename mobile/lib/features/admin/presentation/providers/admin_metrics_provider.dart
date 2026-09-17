import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/nabin_api_service.dart';

final adminMetricsProvider = StateNotifierProvider<AdminMetricsNotifier, AsyncValue<Map<String, dynamic>?>>((ref) {
  return AdminMetricsNotifier();
});

class AdminMetricsNotifier extends StateNotifier<AsyncValue<Map<String, dynamic>?>> {
  AdminMetricsNotifier() : super(const AsyncValue.loading()) {
    fetchMetrics();
  }

  Future<void> fetchMetrics() async {
    state = const AsyncValue.loading();
    try {
      final response = await NabinApiService.getAdminMetrics();
      if (response != null && response['success'] == true) {
        state = AsyncValue.data(response['metrics']);
      } else {
        state = AsyncValue.error(response?['error'] ?? 'Failed to fetch metrics', StackTrace.current);
      }
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }
}
