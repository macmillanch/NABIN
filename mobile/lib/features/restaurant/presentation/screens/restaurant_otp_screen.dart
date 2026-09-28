import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/restaurant_theme.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/network/session_manager.dart';

class RestaurantOtpScreen extends StatefulWidget {
  final String phoneNumber;
  const RestaurantOtpScreen({super.key, required this.phoneNumber});

  @override
  State<RestaurantOtpScreen> createState() => _RestaurantOtpScreenState();
}

class _RestaurantOtpScreenState extends State<RestaurantOtpScreen> {
  final TextEditingController _otpController = TextEditingController();
  bool _isLoading = false;
  bool _isResending = false;
  int _resendSecondsLeft = 0;
  Timer? _resendTimer;

  @override
  void initState() {
    super.initState();
    _startResendCooldown();
  }

  void _startResendCooldown() {
    _resendTimer?.cancel();
    setState(() => _resendSecondsLeft = 30);
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      setState(() {
        _resendSecondsLeft -= 1;
        if (_resendSecondsLeft <= 0) timer.cancel();
      });
    });
  }

  @override
  void dispose() {
    _resendTimer?.cancel();
    _otpController.dispose();
    super.dispose();
  }

  /// A real resend. The control used to be `onPressed: () {}` — a button that looked
  /// available to a merchant whose code had expired and did nothing at all.
  Future<void> _resendOtp() async {
    if (_resendSecondsLeft > 0 || _isResending) return;
    setState(() => _isResending = true);
    Map<String, dynamic>? res;
    try {
      res = await NabinApiService.sendOtp(
        phone: widget.phoneNumber,
        role: 'MERCHANT',
        purpose: 'LOGIN',
      );
    } catch (e) {
      res = null;
    }
    if (!mounted) return;
    setState(() => _isResending = false);
    final sent = res != null && res['success'] == true;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(sent
            ? 'A new code has been sent to +91 ${widget.phoneNumber}'
            : res?['error'] as String? ?? 'Could not send a new code right now.'),
        backgroundColor: sent ? RestaurantTheme.primaryBlue : Colors.red.shade700,
      ),
    );
    if (sent) _startResendCooldown();
  }

  Future<void> _verifyOtp() async {
    final otp = _otpController.text;
    if (otp.length < 4) return;
    
    setState(() => _isLoading = true);
    
    final res = await NabinApiService.verifyOtp(phone: widget.phoneNumber, otp: otp, role: 'MERCHANT', purpose: 'LOGIN');
    
    if (!mounted) return;
    setState(() => _isLoading = false);
    
    if (res != null && res['success'] == true && res['token'] != null) {
      SessionManager.instance.saveSession(
        token: res['token'] as String,
        user: res['user'] as Map<String, dynamic>,
      );
      context.go('/dashboard');
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(res?['error'] ?? 'Invalid OTP'),
          backgroundColor: RestaurantTheme.nonVegRed,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: RestaurantTheme.bgSurface,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: RestaurantTheme.textDark),
          onPressed: () => context.pop(),
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Verify Merchant OTP',
                style: TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.w900,
                  color: RestaurantTheme.textDark,
                  letterSpacing: -0.5,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Enter the 4-digit code sent to +91 ${widget.phoneNumber}',
                style: const TextStyle(color: RestaurantTheme.textMuted, fontSize: 14),
              ),
              const SizedBox(height: 32),

              Container(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                decoration: BoxDecoration(
                  color: RestaurantTheme.surfaceCard,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: RestaurantTheme.primaryContainer, width: 1.5),
                  boxShadow: [
                    BoxShadow(
                      color: RestaurantTheme.primaryContainer.withValues(alpha: 0.1),
                      blurRadius: 16,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: TextField(
                  controller: _otpController,
                  keyboardType: TextInputType.number,
                  textAlign: TextAlign.center,
                  maxLength: 4,
                  style: const TextStyle(
                    fontSize: 32,
                    fontWeight: FontWeight.w900,
                    color: RestaurantTheme.primaryBlue,
                    letterSpacing: 20,
                  ),
                  decoration: const InputDecoration(
                    hintText: '••••',
                    border: InputBorder.none,
                    counterText: '',
                  ),
                ),
              ),
              const SizedBox(height: 16),

              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  // No code is ever shown here. "Demo OTP: 7729" was a development
                  // affordance printed into the merchant-facing UI, and the fixed code it
                  // advertises is accepted only where the platform is configured to accept a
                  // challenge nobody was sent — which production is not.
                  const Expanded(
                    child: Text(
                      'Enter the 4-digit code sent to this store\'s registered number.',
                      style: TextStyle(color: RestaurantTheme.textMuted, fontSize: 12),
                    ),
                  ),
                  TextButton(
                    onPressed: _resendSecondsLeft > 0 || _isResending ? null : _resendOtp,
                    child: _isResending
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(
                            _resendSecondsLeft > 0
                                ? 'Resend Code (${_resendSecondsLeft}s)'
                                : 'Resend Code',
                            style: TextStyle(
                              color: _resendSecondsLeft > 0
                                  ? RestaurantTheme.textMuted
                                  : RestaurantTheme.primaryBlue,
                              fontWeight: FontWeight.bold,
                              fontSize: 12,
                            ),
                    ),
                  ),
                ],
              ),
              const Spacer(),

              SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: RestaurantTheme.primaryContainer,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  icon: _isLoading
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                        )
                      : const Icon(Icons.login, color: Colors.white),
                  label: Text(
                    _isLoading ? 'Verifying...' : 'Verify & Enter Kitchen Dashboard',
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Colors.white),
                  ),
                  onPressed: _isLoading ? null : _verifyOtp,
                ),
              ),
              const SizedBox(height: 12),
            ],
          ),
        ),
      ),
    );
  }
}
