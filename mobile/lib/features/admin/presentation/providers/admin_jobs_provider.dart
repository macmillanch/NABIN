import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/nabin_api_service.dart';

final adminJobsProvider = StateNotifierProvider<AdminJobsNotifier, AsyncValue<List<dynamic>>>((ref) {
  return AdminJobsNotifier();
});

class AdminJobsNotifier extends StateNotifier<AsyncValue<List<dynamic>>> {
  AdminJobsNotifier() : super(const AsyncValue.loading()) {
    fetchJobs();
  }

  Future<void> fetchJobs() async {
    state = const AsyncValue.loading();
    try {
      final response = await NabinApiService.getAdminJobs();
      if (response != null && response['success'] == true) {
        state = AsyncValue.data(response['jobs'] ?? []);
      } else {
        state = AsyncValue.error(response?['error'] ?? 'Failed to fetch jobs', StackTrace.current);
      }
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }
}
