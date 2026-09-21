import 'dart:convert';
import 'dart:io';

class NabinApiService {
  static const String _configuredBaseUrl = String.fromEnvironment('NABIN_API_URL');
  static const String baseUrl = 'http://10.0.2.2:4000/api'; // Android Emulator loopback to Host PC
  static const String webBaseUrl = 'http://localhost:4000/api';

  static String get effectiveUrl {
    if (_configuredBaseUrl.isNotEmpty) return _configuredBaseUrl;
    if (const bool.fromEnvironment('dart.vm.product')) {
      throw StateError('NABIN_API_URL must be provided for release builds.');
    }
    return Platform.isAndroid ? baseUrl : webBaseUrl;
  }

  static String? _authToken;

  static void setAuthToken(String? token) {
    _authToken = token;
  }

  static String? get authToken => _authToken;

  static void _attachAuthHeader(HttpClientRequest request) {
    if (_authToken != null && _authToken!.isNotEmpty) {
      request.headers.set('authorization', 'Bearer $_authToken');
    }
  }

  // =========================================================================
  // 1. AUTHENTICATION & OTP APIS
  // =========================================================================

  /// Request 4-digit / 6-digit OTP dispatched to mobile number
  static Future<Map<String, dynamic>?> sendOtp({
    required String phone,
    String role = 'CUSTOMER',
    String purpose = 'LOGIN',
  }) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/auth/send-otp'));
      request.headers.set('content-type', 'application/json');
      request.add(utf8.encode(jsonEncode({
        'phone': phone,
        'role': role,
        'purpose': purpose,
      })));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return {'success': false, 'error': e.toString()};
    }
  }

  /// Verify OTP code and retrieve authoritative session token
  static Future<Map<String, dynamic>?> verifyOtp({
    required String phone,
    required String otp,
    String role = 'CUSTOMER',
    String purpose = 'LOGIN',
  }) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/auth/verify-otp'));
      request.headers.set('content-type', 'application/json');
      request.add(utf8.encode(jsonEncode({
        'phone': phone,
        'otp': otp,
        'role': role,
        'purpose': purpose,
      })));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      final data = jsonDecode(body) as Map<String, dynamic>;
      if (data['success'] == true && data['token'] != null) {
        setAuthToken(data['token'] as String);
      }
      return data;
    } catch (e) {
      return {'success': false, 'error': e.toString()};
    }
  }

  static Future<Map<String, dynamic>?> getPlatformFeatures() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/features'));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  /// Get Current Authenticated Profile
  static Future<Map<String, dynamic>?> getProfile() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/auth/me'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  /// Logout and Invalidate Session
  static Future<bool> logout() async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/auth/logout'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({'token': _authToken})));
      await request.close();
      setAuthToken(null);
      return true;
    } catch (e) {
      setAuthToken(null);
      return false;
    }
  }

  // =========================================================================
  // 2. CUSTOMER RIDE, FOOD & PARCEL APIS
  // =========================================================================

  /// Centralized Fare Estimate Calculation (Spatial Surge & Geofencing)
  static Future<Map<String, dynamic>?> calculateFareEstimate({
    required String serviceType,
    required double distanceKm,
    int durationMins = 12,
    double? pickupLat,
    double? pickupLng,
    String? promoCode,
    String? zoneId,
  }) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/pricing/estimate'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({
        'serviceType': serviceType,
        'distanceKm': distanceKm,
        'durationMins': durationMins,
        'pickupLat': pickupLat,
        'pickupLng': pickupLng,
        'promoCode': promoCode,
        'zoneId': zoneId,
      })));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      final data = jsonDecode(body) as Map<String, dynamic>;
      if (data['success'] == true) {
        return data['estimate'] as Map<String, dynamic>?;
      }
      return null;
    } catch (e) {
      return null;
    }
  }



  // =========================================================================
  // 3. GROCERY & DYNAMIC PRICING APIS
  // =========================================================================

  /// Server-Side Cart Price Revalidation
  static Future<Map<String, dynamic>?> revalidateCart(List<Map<String, dynamic>> cartItems) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/grocery/cart/revalidate'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({'cartItems': cartItems})));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  /// Authoritative Checkout Validation
  static Future<Map<String, dynamic>?> validateGroceryCheckout(Map<String, dynamic> payload) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/grocery/checkout/validate'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode(payload)));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  // =========================================================================
  // 4. IDENTITY VERIFICATION & SUPPORT DISPUTES
  // =========================================================================

  /// Get Identity Verification Status
  static Future<Map<String, dynamic>?> getIdentityStatus(String userId) async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/identity/status/$userId'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  /// Submit Identity Documents (Aadhaar + Voter ID) for Manual Admin Review
  static Future<Map<String, dynamic>?> submitIdentity({
    required String userId,
    required String name,
    required String phone,
    required String aadhaarNumber,
    required String voterIdNumber,
    String? email,
    String? dob,
    String? address,
    bool isResubmission = false,
  }) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/identity/submit'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({
        'userId': userId,
        'name': name,
        'phone': phone,
        'email': email,
        'dob': dob,
        'address': address,
        'aadhaarNumber': aadhaarNumber,
        'voterIdNumber': voterIdNumber,
        'isResubmission': isResubmission,
      })));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  /// Apply Server-Side Promo Coupon
  static Future<Map<String, dynamic>?> applyPromoCoupon({
    required String code,
    required double orderAmount,
    required String service,
  }) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/promotions/apply'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({
        'code': code,
        'orderAmount': orderAmount,
        'service': service,
      })));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  /// Submit Dispute / Support Ticket
  static Future<Map<String, dynamic>?> submitSupportTicket({
    required String category,
    required String userId,
    required String title,
    required String description,
    String? jobId,
  }) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/support/ticket'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({
        'category': category,
        'userId': userId,
        'title': title,
        'description': description,
        'jobId': jobId,
      })));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  // =========================================================================
  // 5. DRIVER FLEET APIS
  // =========================================================================

  static Future<Map<String, dynamic>?> toggleDriverOnline({
    required String driverId,
    required bool isOnline,
  }) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/driver/$driverId/toggle-online'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({'isOnline': isOnline})));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> acceptJob(String jobId, {String driverId = 'drv_1'}) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/driver/accept-job'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({'jobId': jobId, 'driverId': driverId})));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  /// Authoritative OTP Verification (START, PICKUP, DELIVERY)
  static Future<bool> verifyTripOtp(String jobId, String otp, {String otpType = 'START'}) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/driver/verify-otp'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({'jobId': jobId, 'otp': otp, 'otpType': otpType})));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      final data = jsonDecode(body) as Map<String, dynamic>;
      return data['success'] == true && data['verified'] == true;
    } catch (e) {
      return false;
    }
  }

  static Future<Map<String, dynamic>?> getDriverEarnings(String driverId) async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/driver/$driverId/earnings'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  // =========================================================================
  // 6. RESTAURANT / MERCHANT APIS
  // =========================================================================

  static Future<Map<String, dynamic>?> getMerchantOrders(String restaurantId) async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/merchant/$restaurantId/orders'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> updateMerchantOrderStatus({
    required String restaurantId,
    required String orderId,
    required String status,
    String? reason,
  }) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/merchant/$restaurantId/orders/$orderId/status'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      
      final payload = {'status': status};
      if (reason != null) {
        payload['reason'] = reason;
      }
      
      request.add(utf8.encode(jsonEncode(payload)));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> toggleMenuItem({
    required String restaurantId,
    required String itemId,
    required bool inStock,
  }) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/merchant/$restaurantId/menu/$itemId/toggle'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({'inStock': inStock})));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  // =========================================================================
  // 7. CUSTOMER BOOKINGS
  // =========================================================================

  static Future<Map<String, dynamic>?> bookRide(Map<String, dynamic> payload) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/customer/book-ride'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode(payload)));
      
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> bookFood(Map<String, dynamic> payload) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/customer/book-food'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode(payload)));
      
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> bookParcel(Map<String, dynamic> payload) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/customer/book-parcel'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode(payload)));
      
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  // =========================================================================
  // 8. MERCHANT INVENTORY APIS
  // =========================================================================

  // The backend resolves the merchant from the bearer token, so no id is sent.
  static Future<Map<String, dynamic>?> getMerchantInventory() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/merchant/inventory'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> updateMerchantInventoryItem(Map<String, dynamic> payload) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/merchant/inventory'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode(payload)));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  // =========================================================================
  // 8. ADMIN OPERATIONS APIS
  // =========================================================================

  static Future<Map<String, dynamic>?> getAdminProfile() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/me'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminServicesStatus() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/services/status'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> pauseAdminService(Map<String, dynamic> payload) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/admin/services/pause'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode(payload)));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> resumeAdminService(Map<String, dynamic> payload) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/admin/services/resume'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode(payload)));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminAuditLogs() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/audit-logs'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminSupportTickets() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/support'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> resolveAdminSupportTicket(String ticketId) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/admin/support/$ticketId/resolve'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({'status': 'RESOLVED'})));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminFinanceMetrics() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/finance/metrics'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminFinanceLedger() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/finance/ledger'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminIdentityVerifications() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/identity-verifications'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminFeatures() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/features'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> updateAdminFeature(String key, Map<String, dynamic> payload) async {
    try {
      final client = HttpClient();
      final request = await client.putUrl(Uri.parse('$effectiveUrl/admin/features/$key'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode(payload)));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminFleetLocations() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/v1/fleet/locations'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminNotifications() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/notifications/broadcast'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> broadcastAdminNotification(Map<String, dynamic> payload) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/admin/notifications/broadcast'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode(payload)));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminAccounts() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/accounts'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminDrivers() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/drivers'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminOrders() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/orders'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminRestaurants() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/restaurants'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminUsers() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/users'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminPromotions() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/promotions'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminAdvertisements() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/advertisements'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminGeofences() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/geofences'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminSurgeZones() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/surgezones'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminPricing() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/pricing'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminMasterCatalog() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/master-catalog'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> getAdminGroceryPriceAlerts() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/grocery/price-alerts'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  // =========================================================================
  // 12. ADMIN MANAGEMENT APIS
  // =========================================================================

  static Future<Map<String, dynamic>?> getAdminMetrics() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/metrics'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return {'success': false, 'error': e.toString()};
    }
  }

  static Future<Map<String, dynamic>?> updateDriverStatus(String driverId, String status) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/admin/drivers/$driverId/status'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({'status': status})));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return {'success': false, 'error': e.toString()};
    }
  }

  static Future<Map<String, dynamic>?> updateRestaurantStatus(String restaurantId, String status) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/admin/restaurants/$restaurantId/status'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({'status': status})));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return {'success': false, 'error': e.toString()};
    }
  }

  static Future<Map<String, dynamic>?> getAdminJobs() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/admin/jobs'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return {'success': false, 'error': e.toString()};
    }
  }

  // =========================================================================
  // 9. CUSTOMER DISCOVERY, SPONSORED SLOTS & GROCERY FULFILMENT APIS
  // =========================================================================

  static Future<Map<String, dynamic>?> _getJson(String pathAndQuery) async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl$pathAndQuery'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return {'success': false, 'error': e.toString()};
    }
  }

  static Future<Map<String, dynamic>?> _postJson(String path, Map<String, dynamic> payload) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl$path'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode(payload)));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return {'success': false, 'error': e.toString()};
    }
  }

  static String _query(Map<String, String?> params) {
    final pairs = params.entries
        .where((entry) => entry.value != null && entry.value!.isNotEmpty)
        .map((entry) =>
            '${Uri.encodeQueryComponent(entry.key)}=${Uri.encodeQueryComponent(entry.value!)}');
    return pairs.isEmpty ? '' : '?${pairs.join('&')}';
  }

  static Future<Map<String, dynamic>?> getGroceryProducts({
    String? category,
    String? search,
    String? merchantId,
  }) =>
      _getJson('/grocery/products${_query({
            'category': category,
            'search': search,
            'merchantId': merchantId
          })}');

  static Future<Map<String, dynamic>?> getRestaurants({
    String? search,
    String? cuisine,
    bool openNow = false,
  }) =>
      _getJson('/restaurants${_query({
            'search': search,
            'cuisine': cuisine,
            'openNow': openNow ? 'true' : null
          })}');

  static Future<Map<String, dynamic>?> getRestaurantMenu(String restaurantId) =>
      _getJson('/restaurants/${Uri.encodeComponent(restaurantId)}/menu');

  /// PostgreSQL-backed KPIs for the signed-in store: `restaurant`,
  /// `activeOrdersCount`, `todaySales` and `orders`. The id must be the session
  /// merchant's own id; the route 403s on someone else's.
  static Future<Map<String, dynamic>?> getMerchantDashboard(String merchantId) =>
      _getJson('/merchant/${Uri.encodeComponent(merchantId)}/dashboard');

  static Future<Map<String, dynamic>?> getAdvertisements({String? slot, String? service}) =>
      _getJson('/advertisements${_query({'slot': slot, 'service': service})}');

  /// Records the merchant's own grocery price list plus the master catalogue rows
  /// the store has not stocked yet.
  static Future<Map<String, dynamic>?> getMerchantMasterCatalog() =>
      _getJson('/merchant/master-catalog');

  static Future<Map<String, dynamic>?> submitGroceryPackedWeight({
    required String orderId,
    required String itemId,
    required double packedWeight,
  }) =>
      _postJson('/grocery/orders/${Uri.encodeComponent(orderId)}/packed-weight', {
        'itemId': itemId,
        'packedWeight': packedWeight
      });
}
