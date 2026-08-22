import 'dart:convert';
import 'dart:io';

class NabinApiService {
  static const String baseUrl = 'http://10.0.2.2:4000/api'; // Android Emulator loopback to Host PC
  static const String webBaseUrl = 'http://localhost:4000/api';

  static String get effectiveUrl => Platform.isAndroid ? baseUrl : webBaseUrl;

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

  /// Book Passenger Ride (Enforces Verified Identity & Server Authoritative Pricing)
  static Future<Map<String, dynamic>?> bookRide({
    required String customerId,
    required String vehicleType,
    required String pickupAddress,
    required String dropAddress,
    double? pickupLat,
    double? pickupLng,
    String? promoCode,
    String? bookingType,
    String? passengerCategory,
    Map<String, dynamic>? passengerInfo,
  }) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/customer/book-ride'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({
        'customerId': customerId,
        'vehicleType': vehicleType,
        'pickup': {'address': pickupAddress, 'lat': pickupLat, 'lng': pickupLng},
        'drop': {'address': dropAddress},
        'promoCode': promoCode,
        'bookingType': bookingType,
        'passengerCategory': passengerCategory,
        'passengerInfo': passengerInfo,
      })));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return {'success': false, 'error': e.toString()};
    }
  }

  /// Book Restaurant Food Order (Authoritative Menu Pricing & Dual-OTP)
  static Future<Map<String, dynamic>?> bookFood({
    required String customerId,
    required String restaurantId,
    required List<String> items,
    required String deliveryAddress,
    String? promoCode,
  }) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/customer/book-food'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({
        'customerId': customerId,
        'restaurantId': restaurantId,
        'items': items,
        'deliveryAddress': deliveryAddress,
        'promoCode': promoCode,
      })));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return {'success': false, 'error': e.toString()};
    }
  }

  /// Book Instant Parcel Courier (Dual-OTP Handover Security)
  static Future<Map<String, dynamic>?> bookParcel({
    required String customerId,
    required String senderAddress,
    required String recipientAddress,
    String? promoCode,
  }) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/customer/book-parcel'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({
        'customerId': customerId,
        'senderDetails': {'address': senderAddress},
        'recipientDetails': {'address': recipientAddress},
        'promoCode': promoCode,
      })));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return {'success': false, 'error': e.toString()};
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
  }) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/merchant/$restaurantId/orders/$orderId/status'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({'status': status})));
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
}

