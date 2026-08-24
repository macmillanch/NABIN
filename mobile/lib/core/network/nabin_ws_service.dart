import 'dart:async';
import 'dart:convert';
import 'dart:io';

class NabinWsService {
  NabinWsService._();
  static final NabinWsService instance = NabinWsService._();

  WebSocket? _socket;
  bool _isConnected = false;
  String? _currentRole;
  String? _currentUserId;

  static const String localWsUrl = 'ws://localhost:4000';
  static const String androidWsUrl = 'ws://10.0.2.2:4000';
  static const String productionWssUrl = 'wss://nabin-beta-api.onrender.com';

  static String get effectiveWsUrl {
    try {
      if (Platform.isAndroid) return androidWsUrl;
    } catch (_) {}
    return localWsUrl;
  }

  final _incomingJobController = StreamController<Map<String, dynamic>>.broadcast();
  final _driverLocationController = StreamController<Map<String, dynamic>>.broadcast();
  final _tripUpdateController = StreamController<Map<String, dynamic>>.broadcast();
  final _merchantOrderController = StreamController<Map<String, dynamic>>.broadcast();

  Stream<Map<String, dynamic>> get onIncomingJob => _incomingJobController.stream;
  Stream<Map<String, dynamic>> get onDriverLocation => _driverLocationController.stream;
  Stream<Map<String, dynamic>> get onTripUpdate => _tripUpdateController.stream;
  Stream<Map<String, dynamic>> get onMerchantOrder => _merchantOrderController.stream;

  bool get isConnected => _isConnected;

  Future<void> connect({required String role, required String userId}) async {
    _currentRole = role;
    _currentUserId = userId;

    try {
      _socket?.close();
      _socket = await WebSocket.connect(effectiveWsUrl).timeout(const Duration(seconds: 5));
      _isConnected = true;

      // Register client role and identity with server
      _socket!.add(jsonEncode({
        'type': 'REGISTER',
        'role': role,
        'id': userId,
      }));

      _socket!.listen(
        (data) {
          _handleMessage(data);
        },
        onError: (err) {
          _isConnected = false;
        },
        onDone: () {
          _isConnected = false;
        },
      );
    } catch (e) {
      _isConnected = false;
    }
  }

  void _handleMessage(dynamic raw) {
    try {
      final msg = jsonDecode(raw.toString()) as Map<String, dynamic>;
      final type = msg['type'] as String?;

      switch (type) {
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
      }
    } catch (_) {}
  }

  void sendDriverLocation({
    required String driverId,
    required double latitude,
    required double longitude,
    required double bearing,
    String? activeJobId,
  }) {
    if (_socket != null && _isConnected) {
      _socket!.add(jsonEncode({
        'type': 'DRIVER_LOCATION_UPDATE',
        'driverId': driverId,
        'latitude': latitude,
        'longitude': longitude,
        'bearing': bearing,
        'activeJobId': activeJobId,
        'timestamp': DateTime.now().toIso8601String(),
      }));
    }
  }

  void disconnect() {
    _socket?.close();
    _socket = null;
    _isConnected = false;
  }
}
