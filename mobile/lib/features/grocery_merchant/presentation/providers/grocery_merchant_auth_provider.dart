import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/network/nabin_api_service.dart';
import 'package:mobile/core/network/session_manager.dart';

/// Enum for Grocery Merchant Authentication Status
enum GroceryMerchantAuthStatus {
  unauthenticated,
  authenticating,
  authenticated,
  guest,
}

/// State for Grocery Merchant Authentication
class GroceryMerchantAuthState {
  final GroceryMerchantAuthStatus status;
  final String? phoneNumber;
  final String? userName;
  final String? userRole;
  final String? errorMessage;

  const GroceryMerchantAuthState({
    required this.status,
    this.phoneNumber,
    this.userName,
    this.userRole,
    this.errorMessage,
  });

  bool get isAuthenticated => status == GroceryMerchantAuthStatus.authenticated;
  bool get isGuest => status == GroceryMerchantAuthStatus.guest;

  GroceryMerchantAuthState copyWith({
    GroceryMerchantAuthStatus? status,
    String? phoneNumber,
    String? userName,
    String? userRole,
    String? errorMessage,
  }) {
    return GroceryMerchantAuthState(
      status: status ?? this.status,
      phoneNumber: phoneNumber ?? this.phoneNumber,
      userName: userName ?? this.userName,
      userRole: userRole ?? this.userRole,
      errorMessage: errorMessage,
    );
  }
}

/// Notifier for Grocery Merchant Authentication
class GroceryMerchantAuthNotifier extends StateNotifier<GroceryMerchantAuthState> {
  GroceryMerchantAuthNotifier()
      : super(const GroceryMerchantAuthState(
          status: GroceryMerchantAuthStatus.unauthenticated,
        ));

  /// Send OTP to user phone number with MERCHANT role
  Future<bool> sendOtp(String phone) async {
    state = state.copyWith(
      status: GroceryMerchantAuthStatus.authenticating,
      errorMessage: null,
    );

    try {
      final result = await NabinApiService.sendOtp(
        phone: phone,
        role: 'MERCHANT',
        purpose: 'LOGIN',
      );

      if (result != null && result['success'] == true) {
        state = state.copyWith(
          status: GroceryMerchantAuthStatus.authenticating,
          phoneNumber: phone,
        );
        return true;
      } else {
        state = state.copyWith(
          status: GroceryMerchantAuthStatus.unauthenticated,
          errorMessage: result?['error'] ?? 'Failed to send OTP',
        );
        return false;
      }
    } catch (e) {
      state = state.copyWith(
        status: GroceryMerchantAuthStatus.unauthenticated,
        errorMessage: 'Failed to send OTP. Please try again.',
      );
      return false;
    }
  }

  /// Verify 6-digit OTP code with MERCHANT role
  Future<bool> verifyOtp(String otp) async {
    state = state.copyWith(
      status: GroceryMerchantAuthStatus.authenticating,
      errorMessage: null,
    );

    try {
      final result = await NabinApiService.verifyOtp(
        phone: state.phoneNumber ?? '',
        otp: otp,
        role: 'MERCHANT',
        purpose: 'LOGIN',
      );

      if (result != null && result['success'] == true && result['token'] != null) {
        // Save session
        SessionManager.instance.saveSession(
          token: result['token'] as String,
          user: {
            'phone': state.phoneNumber ?? '',
            'name': result['userName'] ?? 'Merchant',
            'role': 'MERCHANT',
          },
        );

        state = GroceryMerchantAuthState(
          status: GroceryMerchantAuthStatus.authenticated,
          phoneNumber: state.phoneNumber,
          userName: result['userName'] ?? 'Merchant',
          userRole: 'MERCHANT',
        );
        return true;
      } else {
        state = state.copyWith(
          status: GroceryMerchantAuthStatus.unauthenticated,
          errorMessage: result?['error'] ?? 'Invalid OTP code',
        );
        return false;
      }
    } catch (e) {
      state = state.copyWith(
        status: GroceryMerchantAuthStatus.unauthenticated,
        errorMessage: 'OTP verification failed. Please try again.',
      );
      return false;
    }
  }

  /// Continue as Guest user
  void continueAsGuest() {
    state = const GroceryMerchantAuthState(
      status: GroceryMerchantAuthStatus.guest,
      userName: 'Guest Merchant',
      userRole: 'GUEST',
    );
  }

  /// Logout / Reset Session
  void logout() {
    SessionManager.instance.clearSession();
    state = const GroceryMerchantAuthState(
      status: GroceryMerchantAuthStatus.unauthenticated,
    );
  }
}

/// Provider for Grocery Merchant Authentication
final groceryMerchantAuthProvider =
    StateNotifierProvider<GroceryMerchantAuthNotifier, GroceryMerchantAuthState>((ref) {
  return GroceryMerchantAuthNotifier();
});