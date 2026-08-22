import 'package:flutter_riverpod/flutter_riverpod.dart';

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
    await Future.delayed(const Duration(milliseconds: 800)); // Simulate API delay
    state = state.copyWith(
      status: GroceryAuthStatus.unauthenticated,
      phoneNumber: phone,
    );
    return true;
  }

  /// Verify 6-digit OTP code
  Future<bool> verifyOtp(String otp) async {
    state = state.copyWith(status: GroceryAuthStatus.authenticating);
    await Future.delayed(const Duration(milliseconds: 1000)); // Simulate verification
    
    // Accept 123456 or any 6-digit pin for demo/testing
    if (otp.length == 6) {
      state = GroceryAuthState(
        status: GroceryAuthStatus.authenticated,
        phoneNumber: state.phoneNumber ?? '+91 98765 43210',
        userName: 'NABIN Customer',
        userRole: 'CUSTOMER',
      );
      return true;
    } else {
      state = state.copyWith(
        status: GroceryAuthStatus.unauthenticated,
        errorMessage: 'Invalid OTP code. Enter 6 digits (e.g. 123456).',
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
