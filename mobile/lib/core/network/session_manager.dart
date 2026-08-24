import 'dart:convert';
import 'nabin_api_service.dart';

class SessionManager {
  SessionManager._();
  static final SessionManager instance = SessionManager._();

  String? _token;
  Map<String, dynamic>? _currentUser;
  bool _isAuthenticated = false;

  bool get isAuthenticated => _isAuthenticated && _token != null;
  String? get token => _token;
  Map<String, dynamic>? get currentUser => _currentUser;

  void saveSession({required String token, required Map<String, dynamic> user}) {
    _token = token;
    _currentUser = user;
    _isAuthenticated = true;
    NabinApiService.setAuthToken(token);
  }

  void clearSession() {
    _token = null;
    _currentUser = null;
    _isAuthenticated = false;
    NabinApiService.setAuthToken(null);
  }

  Future<bool> validateExistingSession() async {
    if (_token == null || _token!.isEmpty) return false;
    try {
      final profile = await NabinApiService.getProfile();
      if (profile != null && profile['success'] == true && profile['user'] != null) {
        _currentUser = profile['user'] as Map<String, dynamic>;
        _isAuthenticated = true;
        return true;
      }
    } catch (_) {}
    clearSession();
    return false;
  }
}
