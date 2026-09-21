import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'session_manager.dart';
import 'nabin_api_service.dart';

class NabinWsService {
  NabinWsService._();
  static final NabinWsService instance = NabinWsService._();

  WebSocket? _socket;
  bool _isConnected = false;
  String? _currentRole;
  String? _currentUserId;

  String? get currentRole => _currentRole;
  String? get currentUserId => _currentUserId;

  static const String _configuredWsUrl = String.fromEnvironment('NABIN_WS_URL');
  static const String localWsUrl = 'ws://localhost:4000';
  static const String androidWsUrl = 'ws://10.0.2.2:4000';

  static String get effectiveWsUrl {
    if (_configuredWsUrl.isNotEmpty) return _configuredWsUrl;
    if (const bool.fromEnvironment('dart.vm.product')) {
      throw StateError('NABIN_WS_URL must be provided for release builds.');
    }
    try {
      if (Platform.isAndroid) return androidWsUrl;
    } catch (_) {}
    return localWsUrl;
  }

  final _incomingJobController = StreamController<Map<String, dynamic>>.broadcast();
  final _driverLocationController = StreamController<Map<String, dynamic>>.broadcast();
  final _tripUpdateController = StreamController<Map<String, dynamic>>.broadcast();
  final _merchantOrderController = StreamController<Map<String, dynamic>>.broadcast();
  final _notificationController = StreamController<Map<String, dynamic>>.broadcast();
  final _authErrorController = StreamController<Map<String, dynamic>>.broadcast();
  final _authenticatedController = StreamController<Map<String, dynamic>>.broadcast();

  Stream<Map<String, dynamic>> get onIncomingJob => _incomingJobController.stream;
  Stream<Map<String, dynamic>> get onDriverLocation => _driverLocationController.stream;
  Stream<Map<String, dynamic>> get onTripUpdate => _tripUpdateController.stream;
  Stream<Map<String, dynamic>> get onMerchantOrder => _merchantOrderController.stream;
  Stream<Map<String, dynamic>> get onNotification => _notificationController.stream;
  Stream<Map<String, dynamic>> get onAuthError => _authErrorController.stream;
  Stream<Map<String, dynamic>> get onAuthenticated => _authenticatedController.stream;

  bool _isAuthenticated = false;
  bool get isConnected => _isConnected;
  bool get isAuthenticated => _isAuthenticated;

  Future<void> connect({required String role, required String userId, String? token}) async {
    _currentRole = role;
    _currentUserId = userId;

    try {
      if (Platform.environment.containsKey('FLUTTER_TEST')) return;
    } catch (_) {}

    try {
      _socket?.close();
      _isAuthenticated = false;
      final effectiveToken = token ?? SessionManager.instance.token ?? NabinApiService.authToken;
      _socket = await WebSocket.connect(effectiveWsUrl).timeout(const Duration(seconds: 5));
      _isConnected = true;

      // Register client role and identity with server with authentication token
      final registrationPayload = <String, dynamic>{
        'type': 'REGISTER',
        'role': role,
        'id': userId,
      };
      if (effectiveToken != null && effectiveToken.isNotEmpty) {
        registrationPayload['token'] = effectiveToken;
      }
      _socket!.add(jsonEncode(registrationPayload));

      _socket!.listen(
        (data) {
          _handleMessage(data);
        },
        onError: (err) {
          _isConnected = false;
          _isAuthenticated = false;
        },
        onDone: () {
          _isConnected = false;
          _isAuthenticated = false;
        },
      );
    } catch (e) {
      _isConnected = false;
      _isAuthenticated = false;
    }
  }

  void _handleMessage(dynamic raw) {
    try {
      final msg = jsonDecode(raw.toString()) as Map<String, dynamic>;
      final type = msg['type'] as String?;

      switch (type) {
        case 'AUTHENTICATED':
          _isAuthenticated = true;
          _authenticatedController.add(msg);
          break;
        case 'AUTH_ERROR':
          _isAuthenticated = false;
          _authErrorController.add(msg);
          break;
        case 'NEW_RIDE_REQUEST':
        case 'JOB_DISPATCH_OFFER':
        case 'JOB_ASSIGNED':
          _incomingJobController.add(msg);
          break;
        case 'DRIVER_LOCATION_STREAM':
        case 'DRIVER_LOCATION_UPDATE':
          _driverLocationController.add(msg);
          break;
        case 'TRIP_STARTED':
        case 'TRIP_COMPLETED':
        case 'STAGE_UPDATE':
          _tripUpdateController.add(msg);
          break;
        case 'NEW_FOOD_ORDER':
        case 'FOOD_ORDER_UPDATE':
          _merchantOrderController.add(msg);
          break;
        case 'NOTIFICATION':
          // A persisted in-app notification pushed to whoever it is addressed to —
          // for a MERCHANT socket that is the store's own `merchants.id`.
          _notificationController.add(msg);
          break;
      }
    } catch (_) {}
  }

  void sendDriverLocation({
    required String driverId,
    required double latitude,
    required double longitude,
    required double bearing,
    double speed = 0.0,
    String? activeJobId,
  }) {
    if (_socket != null && _isConnected && _isAuthenticated) {
      _socket!.add(jsonEncode({
        'type': 'DRIVER_LOCATION_UPDATE',
        'driverId': driverId,
        'location': {
          'lat': latitude,
          'lng': longitude,
        },
        'heading': bearing,
        'speed': speed,
        'activeJobId': activeJobId,
        'timestamp': DateTime.now().toIso8601String(),
      }));
    }
  }

  void disconnect() {
    _socket?.close();
    _socket = null;
    _isConnected = false;
    _isAuthenticated = false;
  }
}
