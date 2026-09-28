import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/driver_theme.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/network/session_manager.dart';
import '../../../../core/widgets/driver_button.dart';
import '../../../../core/widgets/driver_card.dart';

class DriverOtpScreen extends StatefulWidget {
  final String phoneNumber;
  const DriverOtpScreen({super.key, required this.phoneNumber});

  @override
  State<DriverOtpScreen> createState() => _DriverOtpScreenState();
}

class _DriverOtpScreenState extends State<DriverOtpScreen> {
  // Deliberately empty. A code printed into the field is not this partner's code, and a
  // screen that navigates on from here without the platform accepting anything has logged
  // nobody in.
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

  Future<void> _verifyOtp() async {
    final entered = _otpController.text.trim();
    if (entered.length < 4) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter the complete 4-digit OTP')),
      );
      return;
    }

    setState(() => _isLoading = true);
    Map<String, dynamic>? res;
    try {
      res = await NabinApiService.verifyOtp(
        phone: widget.phoneNumber,
        otp: entered,
        role: 'DRIVER',
        purpose: 'LOGIN',
      );
    } catch (e) {
      res = null;
    }
    if (!mounted) return;
    setState(() => _isLoading = false);

    // A session exists only if the platform issued a token for it. `success` without a
    // token is not a login the app is allowed to pretend happened, so it is reported as the
    // failure it is instead of routing on into the console.
    final token = res?['token'] as String?;
    if (res != null && res['success'] == true && token != null && token.isNotEmpty) {
      SessionManager.instance.saveSession(
        token: token,
        // Whatever the platform says this partner is. An empty map means "not told", which
        // downstream surfaces must handle by asking the server rather than assuming an id.
        user: res['user'] is Map
            ? Map<String, dynamic>.from(res['user'] as Map)
            : <String, dynamic>{},
      );
      context.go('/home');
    } else {
      final errorMsg = res?['error'] as String? ??
          (res == null
              ? 'Could not reach NABIN. Check your connection and try again.'
              : 'Invalid verification code. Please try again.');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(errorMsg), backgroundColor: Colors.red.shade700),
      );
    }
  }

  Future<void> _resendOtp() async {
    if (_resendSecondsLeft > 0 || _isResending) return;
    setState(() => _isResending = true);
    Map<String, dynamic>? res;
    try {
      res = await NabinApiService.sendOtp(
        phone: widget.phoneNumber,
        role: 'DRIVER',
        purpose: 'LOGIN',
      );
    } catch (e) {
      res = null;
    }
    if (!mounted) return;
    setState(() => _isResending = false);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          res != null && res['success'] == true
              ? 'A new code has been sent to +91 ${widget.phoneNumber}'
              : res?['error'] as String? ?? 'Could not send a new code right now.',
        ),
        backgroundColor: res != null && res['success'] == true
            ? DriverTheme.primaryBlue
            : Colors.red.shade700,
      ),
    );
    if (res != null && res['success'] == true) _startResendCooldown();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DriverTheme.bgLight,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
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
                'Enter Driver OTP',
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: DriverTheme.textDark),
              ),
              const SizedBox(height: 8),
              Text(
                'Enter 4-digit code sent to +91 ${widget.phoneNumber}',
                style: const TextStyle(color: DriverTheme.textMuted, fontSize: 14),
              ),
              const SizedBox(height: 32),

              DriverCard(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                child: TextField(
                  controller: _otpController,
                  keyboardType: TextInputType.number,
                  textAlign: TextAlign.center,
                  maxLength: 4,
                  style: const TextStyle(
                    fontSize: 32,
                    fontWeight: FontWeight.w900,
                    color: DriverTheme.primaryBlue,
                    letterSpacing: 16,
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
                  // No code is ever shown here. The previous "Demo code: 7729" label was a
                  // development convenience baked into the shipping screen, and it advertised
                  // a number that works only when the platform is configured to accept a fixed
                  // challenge — which production is not.
                  const Expanded(
                    child: Text('Enter the 4-digit code sent to your registered number.',
                        style: TextStyle(color: DriverTheme.textMuted, fontSize: 12)),
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
                              color: _resendSecondsLeft > 0 ? DriverTheme.textMuted : DriverTheme.primaryBlue,
                              fontSize: 12,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                  ),
                ],
              ),
              const Spacer(),

              DriverButton(
                text: 'Verify & Enter Driver Console',
                isLoading: _isLoading,
                onPressed: _verifyOtp,
              ),
              const SizedBox(height: 12),
            ],
          ),
        ),
      ),
    );
  }
}
