import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/network/nabin_api_service.dart';
enum GroceryAuthStatus {
  unauthenticated,
  authenticating,
  authenticated,
  guest,
}

class GroceryAuthState {
  final GroceryAuthStatus status;
  final String? phoneNumber;
  final String? userName;
  final String? userRole;
  final String? errorMessage;

  const GroceryAuthState({
    required this.status,
    this.phoneNumber,
    this.userName,
    this.userRole,
    this.errorMessage,
  });

  bool get isAuthenticated => status == GroceryAuthStatus.authenticated;
  bool get isGuest => status == GroceryAuthStatus.guest;

  GroceryAuthState copyWith({
    GroceryAuthStatus? status,
    String? phoneNumber,
    String? userName,
    String? userRole,
    String? errorMessage,
  }) {
    return GroceryAuthState(
      status: status ?? this.status,
      phoneNumber: phoneNumber ?? this.phoneNumber,
      userName: userName ?? this.userName,
      userRole: userRole ?? this.userRole,
      errorMessage: errorMessage,
    );
  }
}

class GroceryAuthNotifier extends StateNotifier<GroceryAuthState> {
  GroceryAuthNotifier()
      : super(const GroceryAuthState(status: GroceryAuthStatus.unauthenticated));

  /// Send OTP to user phone number
  Future<bool> sendOtp(String phone) async {
    state = state.copyWith(status: GroceryAuthStatus.authenticating);
    
    final result = await NabinApiService.sendOtp(
      phone: phone, 
      role: 'CUSTOMER',
      purpose: 'LOGIN'
    );

    if (result != null && result['success'] == true) {
      state = state.copyWith(
        status: GroceryAuthStatus.unauthenticated,
        phoneNumber: phone,
      );
      return true;
    } else {
      state = state.copyWith(
        status: GroceryAuthStatus.unauthenticated,
        errorMessage: result?['error'] ?? 'Failed to send OTP',
      );
      return false;
    }
  }

  /// Verify OTP code
  Future<bool> verifyOtp(String otp) async {
    state = state.copyWith(status: GroceryAuthStatus.authenticating);
    
    if (state.phoneNumber == null) {
      state = state.copyWith(
        status: GroceryAuthStatus.unauthenticated,
        errorMessage: 'Phone number missing',
      );
      return false;
    }

    final result = await NabinApiService.verifyOtp(
      phone: state.phoneNumber!, 
      otp: otp, 
      role: 'CUSTOMER'
    );
    
    if (result != null && result['success'] == true) {
      state = GroceryAuthState(
        status: GroceryAuthStatus.authenticated,
        phoneNumber: state.phoneNumber,
        userName: result['user']?['name'] ?? 'NABIN Customer',
        userRole: 'CUSTOMER',
      );
      return true;
    } else {
      state = state.copyWith(
        status: GroceryAuthStatus.unauthenticated,
        errorMessage: result?['error'] ?? 'Invalid OTP code',
      );
      return false;
    }
  }

  /// Continue as Guest user
  void continueAsGuest() {
    state = const GroceryAuthState(
      status: GroceryAuthStatus.guest,
      userName: 'Guest Explorer',
      userRole: 'GUEST',
    );
  }

  /// Logout / Reset Session
  void logout() {
    state = const GroceryAuthState(status: GroceryAuthStatus.unauthenticated);
  }
}

final groceryAuthProvider =
    StateNotifierProvider<GroceryAuthNotifier, GroceryAuthState>((ref) {
  return GroceryAuthNotifier();
});
