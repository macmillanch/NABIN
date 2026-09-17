import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/network/nabin_api_service.dart';
import 'package:mobile/core/network/session_manager.dart';

enum AdminAuthStatus { unauthenticated, authenticating, authenticated }

class AdminAuthState {
  final AdminAuthStatus status;
  final String? phoneNumber;
  final String? userName;
  final String? errorMessage;

  const AdminAuthState({
    required this.status,
    this.phoneNumber,
    this.userName,
    this.errorMessage,
  });

  bool get isAuthenticated => status == AdminAuthStatus.authenticated;

  AdminAuthState copyWith({
    AdminAuthStatus? status,
    String? phoneNumber,
    String? userName,
    String? errorMessage,
  }) {
    return AdminAuthState(
      status: status ?? this.status,
      phoneNumber: phoneNumber ?? this.phoneNumber,
      userName: userName ?? this.userName,
      errorMessage: errorMessage,
    );
  }
}

class AdminAuthNotifier extends StateNotifier<AdminAuthState> {
  AdminAuthNotifier() : super(const AdminAuthState(status: AdminAuthStatus.unauthenticated));

  Future<bool> sendOtp(String phone) async {
    state = state.copyWith(status: AdminAuthStatus.authenticating, errorMessage: null);

    try {
      final result = await NabinApiService.sendOtp(
        phone: phone,
        role: 'ADMIN',
        purpose: 'LOGIN',
      );

      if (result != null && result['success'] == true) {
        state = state.copyWith(status: AdminAuthStatus.authenticating, phoneNumber: phone);
        return true;
      } else {
        state = state.copyWith(
          status: AdminAuthStatus.unauthenticated,
          errorMessage: result?['error'] ?? 'Failed to send OTP. You may not have Admin privileges.',
        );
        return false;
      }
    } catch (e) {
      state = state.copyWith(
        status: AdminAuthStatus.unauthenticated,
        errorMessage: 'Network error.',
      );
      return false;
    }
  }

  Future<bool> verifyOtp(String otp) async {
    state = state.copyWith(status: AdminAuthStatus.authenticating, errorMessage: null);

    try {
      final result = await NabinApiService.verifyOtp(
        phone: state.phoneNumber ?? '',
        otp: otp,
        role: 'ADMIN',
        purpose: 'LOGIN',
      );

      if (result != null && result['success'] == true && result['token'] != null) {
        SessionManager.instance.saveSession(
          token: result['token'],
          user: {
            'phone': state.phoneNumber,
            'name': result['userName'] ?? 'Admin',
            'role': 'ADMIN',
          },
        );

        state = AdminAuthState(
          status: AdminAuthStatus.authenticated,
          phoneNumber: state.phoneNumber,
          userName: result['userName'] ?? 'Admin',
        );
        return true;
      } else {
        state = state.copyWith(
          status: AdminAuthStatus.unauthenticated,
          errorMessage: result?['error'] ?? 'Invalid OTP code',
        );
        return false;
      }
    } catch (e) {
      state = state.copyWith(
        status: AdminAuthStatus.unauthenticated,
        errorMessage: 'OTP verification failed.',
      );
      return false;
    }
  }

  void logout() {
    SessionManager.instance.clearSession();
    state = const AdminAuthState(status: AdminAuthStatus.unauthenticated);
  }
}

final adminAuthProvider = StateNotifierProvider<AdminAuthNotifier, AdminAuthState>((ref) {
  return AdminAuthNotifier();
});
