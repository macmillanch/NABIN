import 'dart:convert';
import 'dart:io';

import '../config/nabin_build_env.dart';

class NabinApiService {
  static const String _configuredBaseUrl = String.fromEnvironment('NABIN_API_URL');
  static const String baseUrl = 'http://10.0.2.2:4000/api'; // Android Emulator loopback to Host PC
  static const String webBaseUrl = 'http://localhost:4000/api';

  static String get effectiveUrl {
    if (_configuredBaseUrl.isNotEmpty) {
      NabinBuildEnv.validate(_configuredBaseUrl, variable: 'NABIN_API_URL');
      return _configuredBaseUrl;
    }
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

  /// Change the signed-in customer's own name and/or email.
  ///
  /// This is the only write a customer has to their own `users` row, and it carries no
  /// account id: `PATCH /api/customer/profile` acts on whoever the bearer token resolves
  /// to, so there is no way to aim it at somebody else. `patch` is expected to contain
  /// only `name` and `email`; nothing else is sent, because the backend ignores unknown
  /// keys and the screen must not look like it tried to move a wallet balance.
  ///
  /// Like the merchant profile editor, this returns the parsed body even on a non-200 with
  /// the `statusCode` attached, because a refusal has to stay a refusal on this side:
  /// `success:false` plus `code`/`error` is what lets the screen say "the platform did not
  /// save this" instead of painting a saved state that was never written. On success the
  /// `profile` object is the server's stored row — trimmed, case-folded and persisted — so
  /// the caller updates its own state from THAT and not from what it typed.
  static Future<Map<String, dynamic>?> updateCustomerProfile(Map<String, dynamic> patch) async {
    try {
      final client = HttpClient();
      final request = await client.openUrl(
        'PATCH',
        Uri.parse('$effectiveUrl/customer/profile'),
      );
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode(patch)));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      if (body.isEmpty) return {'success': false, 'statusCode': response.statusCode};
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) {
        return {...decoded, 'statusCode': response.statusCode};
      }
      return {'success': false, 'statusCode': response.statusCode};
    } catch (e) {
      return {'success': false, 'error': e.toString()};
    }
  }

  /// The customer's real history across Ride, Food, Instamart and Parcel.
  ///
  /// Returns null when the read could not be completed, which the caller must render as
  /// "could not load, retry" rather than "no activity" — the backend answers an unreadable
  /// store with a 503 precisely so those two stay distinguishable on this side.
  static Future<Map<String, dynamic>?> getCustomerActivity() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/customer/activity'));
      _attachAuthHeader(request);
      final response = await request.close();
      if (response.statusCode != 200) return null;
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  /// One food/Instamart order, by uuid or order number, with its `order_lines`.
  ///
  /// The backend resolves either spelling of the id and refuses a row that belongs to
  /// another customer, so this is the read a tracking screen polls: it is the stored
  /// `order_state`, not a client-side guess about what the kitchen is doing.
  static Future<Map<String, dynamic>?> getCustomerOrder(String orderId) async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(
        Uri.parse('$effectiveUrl/customer/orders/${Uri.encodeComponent(orderId)}'),
      );
      _attachAuthHeader(request);
      final response = await request.close();
      if (response.statusCode != 200) return null;
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  /// The same read as [getCustomerOrder], with the HTTP status kept.
  ///
  /// [getCustomerOrder] folds every non-200 into `null`, which is enough for a screen
  /// that says "unavailable" but not for one that has to tell a customer they are
  /// signed out, looking at another account's order, or at a number that was never
  /// minted. The endpoint is not re-implemented here — one URL, one auth header.
  static Future<CustomerOrderRead> readCustomerOrder(String orderId) async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(
        Uri.parse('$effectiveUrl/customer/orders/${Uri.encodeComponent(orderId)}'),
      );
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      final Object? decoded = body.isEmpty ? null : jsonDecode(body);
      return CustomerOrderRead(
        status: response.statusCode,
        body: decoded is Map ? Map<String, dynamic>.from(decoded) : null,
      );
    } catch (_) {
      return const CustomerOrderRead(status: 0);
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

  /// The caller's own support tickets, read from the live endpoint.
  ///
  /// Identity is carried by the bearer token; the path parameter must be the
  /// signed-in user's own id or the server returns 403. A transport failure and a
  /// server `success:false` are both returned as a non-success map (never a bare
  /// null) so the screen can tell "no tickets yet" apart from "couldn't load them".
  static Future<Map<String, dynamic>> getSupportTickets({
    required String userId,
  }) async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(
        Uri.parse('$effectiveUrl/support/user/$userId'),
      );
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      final decoded = body.isEmpty ? null : jsonDecode(body);
      if (response.statusCode == 200 && decoded is Map<String, dynamic>) {
        return decoded;
      }
      if (decoded is Map<String, dynamic>) {
        return {...decoded, 'statusCode': response.statusCode};
      }
      return {'success': false, 'statusCode': response.statusCode};
    } catch (e) {
      return {'success': false, 'error': e.toString()};
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

  /// `driverId` is deliberately not defaulted. A hard-coded partner id in the client is a
  /// fabricated identity: whichever driver happened to be signed in would have asked the
  /// platform to assign the job to somebody else. Omit it and the backend takes the
  /// identity from the bearer token, which is the only trustworthy source.
  static Future<Map<String, dynamic>?> acceptJob(String jobId, {String? driverId}) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/driver/accept-job'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({
        'jobId': jobId,
        if (driverId != null) 'driverId': driverId,
      })));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  /// Authoritative OTP Verification (START, PICKUP, DELIVERY)
  static Future<bool> verifyTripOtp(String jobId, String otp, {String otpType = 'START'}) async {
    final res = await submitTripOtp(jobId: jobId, otp: otp, otpType: otpType);
    return res != null && res['success'] == true && res['verified'] == true;
  }

  /// The same verification, returning the platform's answer rather than only a boolean.
  ///
  /// A partner whose code was refused needs to know whether it was wrong, expired, already
  /// used, or whether the trip simply is not at the stage that accepts a code — a bool
  /// forces the UI to guess, and guessing about a money-moving transition is how a driver
  /// ends up believing a trip started when it did not.
  static Future<Map<String, dynamic>?> submitTripOtp({
    required String jobId,
    required String otp,
    String otpType = 'START',
  }) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/driver/verify-otp'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({'jobId': jobId, 'otp': otp, 'otpType': otpType})));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      if (body.isEmpty) return {'success': false, 'statusCode': response.statusCode};
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) return {...decoded, 'statusCode': response.statusCode};
      return {'success': false, 'statusCode': response.statusCode};
    } catch (e) {
      return null;
    }
  }

  /// The signed-in driver's own earnings, wallet and settlement readiness.
  ///
  /// Identity travels in the bearer token only — there is no id for this screen to pass, so
  /// there is nothing for it to get wrong. A non-200 response is returned parsed when the
  /// body allows it, because the driver app must tell "the store did not answer" (503) apart
  /// from "you have no trips" (200 with empty windows) and must not paint a failure as zero
  /// earnings. Returns null only when there is genuinely no usable answer.
  static Future<Map<String, dynamic>?> getMyEarnings() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/driver/earnings'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      if (response.statusCode == 200) {
        return jsonDecode(body) as Map<String, dynamic>;
      }
      final decoded = body.isEmpty ? null : jsonDecode(body);
      if (decoded is Map<String, dynamic>) return decoded;
      return {'success': false, 'statusCode': response.statusCode};
    } catch (e) {
      return null;
    }
  }

  /// Withdraw the wallet balance to the driver's verified UPI address.
  ///
  /// Only the requested amount is sent. The balance, the destination, the KYC gate and the
  /// destination cooling window are all decided server-side, so the client can neither move
  /// money it has not earned nor redirect it to an unverified address; the rejection `code`
  /// comes back here so the screen can explain the refusal instead of guessing.
  static Future<Map<String, dynamic>?> requestDriverPayout({required num amount}) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/driver/payout'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({'amount': amount})));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      if (body.isEmpty) return {'success': false, 'statusCode': response.statusCode};
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) {
        return {...decoded, 'statusCode': response.statusCode};
      }
      return {'success': false, 'statusCode': response.statusCode};
    } catch (e) {
      return null;
    }
  }

  /// The signed-in partner's console: who they are, whether the platform currently has them
  /// online, the trip they are standing on, and the offers actually in front of them.
  ///
  /// One call, because the screen used to answer all four questions from Dart variables and
  /// literal text. Availability in particular is *server* state now — `drivers.is_online` is
  /// a column that survives a restart, where the old `_isOnline` boolean did not, so a
  /// partner could be shown ONLINE while dispatch could not see them at all.
  ///
  /// Returns the parsed body even on a non-200 so the caller can tell a ledger outage
  /// (503) from an empty list, and null only when there is no usable answer at all.
  static Future<Map<String, dynamic>?> getDriverHome() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/driver/home'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      if (body.isEmpty) return {'success': false, 'statusCode': response.statusCode};
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) return {...decoded, 'statusCode': response.statusCode};
      return {'success': false, 'statusCode': response.statusCode};
    } catch (e) {
      return null;
    }
  }

  /// Ask the platform to mark this partner available or unavailable.
  ///
  /// The value returned is the platform's answer, not the value requested: if the write
  /// could not be persisted the call reports the failure, and the screen must render that
  /// rather than the state it hoped for.
  static Future<Map<String, dynamic>?> setDriverAvailability({required bool isOnline}) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/driver/status'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({'isOnline': isOnline})));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      if (body.isEmpty) return {'success': false, 'statusCode': response.statusCode};
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) return {...decoded, 'statusCode': response.statusCode};
      return {'success': false, 'statusCode': response.statusCode};
    } catch (e) {
      return null;
    }
  }

  /// Accept one dispatch offer.
  ///
  /// [idempotencyKey] makes a retry (a double tap, a dropped connection that came back) the
  /// same request instead of a second claim on the job. The backend answers a lost race with
  /// a conflict, so the caller must handle `success: false` with a code and refresh — two
  /// partners cannot both have the trip.
  static Future<Map<String, dynamic>?> acceptDriverOffer({
    required String offerId,
    String? idempotencyKey,
  }) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/driver/offers/$offerId/accept'));
      request.headers.set('content-type', 'application/json');
      if (idempotencyKey != null && idempotencyKey.isNotEmpty) {
        request.headers.set('idempotency-key', idempotencyKey);
      }
      _attachAuthHeader(request);
      // No driverId in the body: identity is the bearer token's, and a client-supplied one
      // is only ever an excuse for a mismatch.
      request.add(utf8.encode(jsonEncode({})));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      if (body.isEmpty) return {'success': false, 'statusCode': response.statusCode};
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) return {...decoded, 'statusCode': response.statusCode};
      return {'success': false, 'statusCode': response.statusCode};
    } catch (e) {
      return null;
    }
  }

  /// Decline one dispatch offer, with an optional reason the platform stores.
  static Future<Map<String, dynamic>?> rejectDriverOffer({
    required String offerId,
    String? reason,
  }) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/driver/offers/$offerId/reject'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({if (reason != null) 'reason': reason})));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      if (body.isEmpty) return {'success': false, 'statusCode': response.statusCode};
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) return {...decoded, 'statusCode': response.statusCode};
      return {'success': false, 'statusCode': response.statusCode};
    } catch (e) {
      return null;
    }
  }

  /// Announce arrival at the pickup / drop point. The server moves the job through its own
  /// state machine and refuses a transition that is out of order.
  static Future<Map<String, dynamic>?> driverArrived({required String jobId}) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/driver/arrived'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({'jobId': jobId})));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      if (body.isEmpty) return {'success': false, 'statusCode': response.statusCode};
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) return {...decoded, 'statusCode': response.statusCode};
      return {'success': false, 'statusCode': response.statusCode};
    } catch (e) {
      return null;
    }
  }

  /// POSTed twin of the WebSocket telemetry frame, for when the socket is down.
  ///
  /// Same validator on the server, so a fix this socket would reject cannot be posted
  /// through this door instead. Coordinates are never stored as "last known" on the device —
  /// the platform is the record of where the partner was.
  static Future<Map<String, dynamic>?> postDriverLocation({
    required double lat,
    required double lng,
    double? heading,
    double? speed,
    double? accuracy,
    String? jobId,
  }) async {
    try {
      final client = HttpClient();
      final request = await client.postUrl(Uri.parse('$effectiveUrl/driver/location'));
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode({
        'lat': lat,
        'lng': lng,
        'timestamp': DateTime.now().toUtc().toIso8601String(),
        if (heading != null) 'heading': heading,
        if (speed != null) 'speed': speed,
        if (accuracy != null) 'accuracy': accuracy,
        if (jobId != null) 'jobId': jobId,
      })));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      if (body.isEmpty) return {'success': false, 'statusCode': response.statusCode};
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) return {...decoded, 'statusCode': response.statusCode};
      return {'success': false, 'statusCode': response.statusCode};
    } catch (e) {
      return null;
    }
  }

  /// Legacy: earnings for an explicitly named partner.
  ///
  /// The driver app should call [getMyEarnings] instead. This stays only for tools that hold
  /// another driver's id legitimately; the backend refuses a mismatch against the token.
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

  /// The signed-in restaurant's own discovery metadata, read back so the Profile
  /// editor opens on what is actually stored rather than an empty form.
  ///
  /// There is no dedicated merchant-profile GET; the dashboard route is the existing
  /// authenticated read of the merchant's own row (it `select('*)`s `merchants`), so its
  /// `restaurant` object carries `cuisines`, `cover_image_url` and
  /// `standard_delivery_minutes`. No id is trusted from the caller beyond the path — the
  /// backend 403s when the path id is not the bearer token's own merchant.
  static Future<Map<String, dynamic>?> getMerchantRestaurantProfile(String restaurantId) =>
      _getJson('/merchant/${Uri.encodeComponent(restaurantId)}/dashboard');

  /// Declare this restaurant's own cuisines, cover image and standard delivery window.
  ///
  /// This is the merchant's WRITE to `PATCH /api/merchant/:restaurantId/profile`. It
  /// returns the parsed body even on a non-200, plus the `statusCode`, because a refusal
  /// has to stay a refusal here: `success:false` with a `code`/`error` is what lets the
  /// screen say "the platform did not save this" instead of painting a saved state that
  /// was never written. The `restaurant` object on success is the server's stored row, so
  /// the caller updates its state from THAT, not from the value it sent.
  static Future<Map<String, dynamic>?> updateMerchantRestaurantProfile({
    required String restaurantId,
    required Map<String, dynamic> patch,
  }) async {
    try {
      final client = HttpClient();
      final request = await client.openUrl(
        'PATCH',
        Uri.parse('$effectiveUrl/merchant/${Uri.encodeComponent(restaurantId)}/profile'),
      );
      request.headers.set('content-type', 'application/json');
      _attachAuthHeader(request);
      request.add(utf8.encode(jsonEncode(patch)));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      if (body.isEmpty) return {'success': false, 'statusCode': response.statusCode};
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) {
        return {...decoded, 'statusCode': response.statusCode};
      }
      return {'success': false, 'statusCode': response.statusCode};
    } catch (e) {
      return {'success': false, 'error': e.toString()};
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

  /// One job (a ride or a parcel) as the tracking route reports it.
  ///
  /// `GET /api/tracking/:jobId` is the only customer-reachable read that carries a driver's
  /// name and phone, alongside the stored `status`, the pickup/drop pair and the driver's
  /// last reported location. Polling it means the screen paints the row's stage rather
  /// than a client-side guess about where the trip has got to.
  static Future<Map<String, dynamic>?> getJobTracking(String jobId) async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(
        Uri.parse('$effectiveUrl/tracking/${Uri.encodeComponent(jobId)}'),
      );
      _attachAuthHeader(request);
      final response = await request.close();
      if (response.statusCode != 200) return null;
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  /// Cancels a ride through the only customer write the platform has for a job.
  ///
  /// `POST /api/rides/:id/cancel` runs `cancel_ride_atomic` (migration 016), which settles
  /// the money in the same transaction and returns the real `cancellationFee`,
  /// `refundAmount` and `refundStatus`. A caller must paint those returned figures — the
  /// fee is not something the client is allowed to predict.
  static Future<Map<String, dynamic>?> cancelRide({
    required String jobId,
    String? reason,
    bool isDelayedOverride = false,
  }) async {
    return _postJson('/rides/${Uri.encodeComponent(jobId)}/cancel', {
      if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
      'isDelayedOverride': isDelayedOverride,
    });
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

  /// The signed-in merchant's own profile and authorized services.
  ///
  /// One authenticated read, no id in the request: the backend decides who this merchant is
  /// and which services they hold. The Restaurant console used to answer "which store am I?"
  /// with a constant typed into the widget — a name, an FSSAI number and a "Verified Partner"
  /// claim belonging to a business that does not exist — and every store that signed in was
  /// shown that same identity.
  ///
  /// Returns the parsed body even on a non-200 so a caller can tell a refusal or an outage
  /// (503) apart from a merchant that genuinely has no services configured.
  static Future<Map<String, dynamic>?> getMerchantServices() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/merchant/services'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      if (response.statusCode == 200) return jsonDecode(body) as Map<String, dynamic>;
      final decoded = body.isEmpty ? null : jsonDecode(body);
      if (decoded is Map<String, dynamic>) return decoded;
      return {'success': false, 'statusCode': response.statusCode};
    } catch (e) {
      return null;
    }
  }

  /// The caller's own catalogue — for a restaurant these rows ARE the menu items.
  ///
  /// `products` is a shared table that both services draw from, scoped by `merchant_id` to
  /// the authenticated merchant server-side, so this is the real menu read and not a grocery
  /// endpoint being borrowed. No client-side merchant id is sent.
  static Future<Map<String, dynamic>?> getMerchantCatalog() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('$effectiveUrl/merchant/catalog'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      if (response.statusCode == 200) return jsonDecode(body) as Map<String, dynamic>;
      final decoded = body.isEmpty ? null : jsonDecode(body);
      if (decoded is Map<String, dynamic>) return decoded;
      return {'success': false, 'statusCode': response.statusCode};
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

  /// Removes one of the signed-in store's own listings. The backend refuses when
  /// orders already reference the product, so callers must show the returned
  /// `error` instead of assuming success.
  static Future<Map<String, dynamic>?> deleteMerchantInventoryItem(String masterProductId) async {
    try {
      final client = HttpClient();
      final request = await client.deleteUrl(Uri.parse(
          '$effectiveUrl/merchant/inventory/${Uri.encodeComponent(masterProductId)}'));
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  // =========================================================================
  // 7b. NOTIFICATIONS — the backend keys the feed to the bearer token's own
  // identity, so a merchant session reads its store's notifications with no id
  // passed in.
  // =========================================================================

  static Future<Map<String, dynamic>?> getNotifications({
    int limit = 20,
    int offset = 0,
    bool unreadOnly = false,
  }) async {
    try {
      final uri = Uri.parse('$effectiveUrl/notifications').replace(queryParameters: {
        'limit': '$limit',
        'offset': '$offset',
        if (unreadOnly) 'unreadOnly': 'true',
      });
      final client = HttpClient();
      final request = await client.getUrl(uri);
      _attachAuthHeader(request);
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  static Future<Map<String, dynamic>?> markNotificationAsRead(String notificationId) async {
    return _putJson('/notifications/${Uri.encodeComponent(notificationId)}/read', {});
  }

  static Future<Map<String, dynamic>?> markAllNotificationsAsRead() async {
    return _putJson('/notifications/read-all', {});
  }

  /// What a customer is told about, and through which channel, is a row the backend
  /// owns (`GET /api/notifications/preferences`). The Profile tile rendered three
  /// invented lines instead of asking for it.
  static Future<Map<String, dynamic>?> getNotificationPreferences() async {
    return _getJson('/notifications/preferences');
  }

  /// Keys are the camelCase names the read returns; the backend snake-cases them and
  /// drops anything outside its allowlist, so a wrong key is silently ignored rather
  /// than written.
  static Future<Map<String, dynamic>?> updateNotificationPreferences(
    Map<String, dynamic> changes,
  ) async {
    return _putJson('/notifications/preferences', changes);
  }

  // =========================================================================
  // 7c. SAVED SCHOOLS AND SAVED CHILDREN — `GET/POST/PUT/DELETE /api/schools`
  // and `/api/children` are authenticated CRUD owned by the backend, which
  // resolves the owner from the bearer token and rejects a child that names a
  // school the caller does not own. Nothing here needs an id passed in.
  // =========================================================================

  static Future<Map<String, dynamic>?> getSavedSchools() async {
    return _getJson('/schools');
  }

  static Future<Map<String, dynamic>?> createSavedSchool(
    Map<String, dynamic> payload,
  ) async {
    return _postJson('/schools', payload);
  }

  static Future<Map<String, dynamic>?> updateSavedSchool(
    String schoolId,
    Map<String, dynamic> payload,
  ) async {
    return _putJson('/schools/${Uri.encodeComponent(schoolId)}', payload);
  }

  static Future<Map<String, dynamic>?> deleteSavedSchool(String schoolId) async {
    return _deleteJson('/schools/${Uri.encodeComponent(schoolId)}');
  }

  static Future<Map<String, dynamic>?> getSavedChildren() async {
    return _getJson('/children');
  }

  static Future<Map<String, dynamic>?> createSavedChild(
    Map<String, dynamic> payload,
  ) async {
    return _postJson('/children', payload);
  }

  static Future<Map<String, dynamic>?> updateSavedChild(
    String childId,
    Map<String, dynamic> payload,
  ) async {
    return _putJson('/children/${Uri.encodeComponent(childId)}', payload);
  }

  static Future<Map<String, dynamic>?> deleteSavedChild(String childId) async {
    return _deleteJson('/children/${Uri.encodeComponent(childId)}');
  }

  static Future<Map<String, dynamic>?> _putJson(String path, Map<String, dynamic> payload) async {
    try {
      final client = HttpClient();
      final request = await client.openUrl('PUT', Uri.parse('$effectiveUrl$path'));
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

  static Future<Map<String, dynamic>?> _deleteJson(String path) async {
    try {
      final client = HttpClient();
      final request = await client.deleteUrl(Uri.parse('$effectiveUrl$path'));
      _attachAuthHeader(request);
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

/// One `GET /api/customer/orders/:id` answer, with the status code kept.
///
/// `status` is 0 when the request never completed, so a caller can tell an outage from
/// a refusal instead of folding four different facts into one `null`.
class CustomerOrderRead {
  const CustomerOrderRead({required this.status, this.body});

  final int status;
  final Map<String, dynamic>? body;

  bool get ok =>
      status == 200 && body != null && body!['success'] == true && body!['order'] is Map;

  Map<String, dynamic>? get order =>
      ok ? Map<String, dynamic>.from(body!['order'] as Map) : null;

  String get error => (body?['error'] ?? '').toString();
}
