import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/network/nabin_api_service.dart';
import 'package:mobile/core/network/session_manager.dart';
import '../providers/grocery_merchant_auth_provider.dart';
import '../theme/grocery_merchant_theme.dart';
import 'grocery_merchant_dashboard.dart';

/// OTP Verification Screen for NABIN Grocery Merchant App
class GroceryMerchantOtpScreen extends ConsumerStatefulWidget {
  final String phoneNumber;

  const GroceryMerchantOtpScreen({
    super.key,
    required this.phoneNumber,
  });

  @override
  ConsumerState<GroceryMerchantOtpScreen> createState() => _GroceryMerchantOtpScreenState();
}

class _GroceryMerchantOtpScreenState extends ConsumerState<GroceryMerchantOtpScreen> {
  final List<TextEditingController> _controllers =
      List.generate(6, (_) => TextEditingController());
  final List<FocusNode> _focusNodes = List.generate(6, (_) => FocusNode());

  int _resendCountdown = 30;
  Timer? _timer;
  bool _isLoading = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _startTimer();
  }

  void _startTimer() {
    setState(() => _resendCountdown = 30);
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_resendCountdown > 0) {
        setState(() => _resendCountdown--);
      } else {
        _timer?.cancel();
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    for (var controller in _controllers) {
      controller.dispose();
    }
    for (var node in _focusNodes) {
      node.dispose();
    }
    super.dispose();
  }

  String get _otpCode => _controllers.map((c) => c.text).join();

  Future<void> _verifyOtp() async {
    final otp = _otpCode;
    if (otp.length < 6) {
      setState(() => _errorMessage = 'Please enter all 6 digits');
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    final success = await ref
        .read(groceryMerchantAuthProvider.notifier)
        .verifyOtp(otp);

    setState(() => _isLoading = false);

    if (mounted) {
      if (success) {
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const GroceryMerchantDashboard()),
          (route) => false,
        );
      } else {
        final state = ref.read(groceryMerchantAuthProvider);
        setState(() {
          _errorMessage = state.errorMessage ?? 'Verification failed';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: GroceryMerchantTheme.bgOffWhite,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: GroceryMerchantTheme.textDark),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 12),
              const Text(
                'Verify Phone Number',
                style: TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w900,
                  color: GroceryMerchantTheme.textDark,
                ),
              ),
              const SizedBox(height: 8),
              RichText(
                text: TextSpan(
                  style: const TextStyle(
                    fontSize: 14,
                    color: GroceryMerchantTheme.textMuted,
                    height: 1.4,
                  ),
                  children: [
                    const TextSpan(text: 'Enter the 6-digit code sent to '),
                    TextSpan(
                      text: widget.phoneNumber,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        color: GroceryMerchantTheme.textDark,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 32),

              // 6 PIN Input Boxes
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: List.generate(6, (index) {
                  return SizedBox(
                    width: 48,
                    height: 56,
                    child: TextFormField(
                      controller: _controllers[index],
                      focusNode: _focusNodes[index],
                      keyboardType: TextInputType.number,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w900,
                        color: GroceryMerchantTheme.primaryGreenDark,
                      ),
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(1),
                      ],
                      decoration: InputDecoration(
                        contentPadding: EdgeInsets.zero,
                        filled: true,
                        fillColor: Colors.white,
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: BorderSide(
                            color: _controllers[index].text.isNotEmpty
                                ? GroceryMerchantTheme.primaryGreen
                                : GroceryMerchantTheme.borderLight,
                            width: 1.5,
                          ),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                          borderSide: const BorderSide(
                            color: GroceryMerchantTheme.primaryGreen,
                            width: 2.0,
                          ),
                        ),
                      ),
                      onChanged: (val) {
                        if (val.isNotEmpty && index < 5) {
                          _focusNodes[index + 1].requestFocus();
                        } else if (val.isEmpty && index > 0) {
                          _focusNodes[index - 1].requestFocus();
                        }
                        if (_otpCode.length == 6) {
                          _verifyOtp();
                        }
                      },
                    ),
                  );
                }),
              ),

              if (_errorMessage != null) ...[
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: GroceryMerchantTheme.accentRose.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.error_outline_rounded,
                          color: GroceryMerchantTheme.accentRose, size: 18),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _errorMessage!,
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: GroceryMerchantTheme.accentRose,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],

              const SizedBox(height: 32),

              // Verify Button
              ElevatedButton(
                onPressed: _isLoading ? null : _verifyOtp,
                style: ElevatedButton.styleFrom(
                  backgroundColor: GroceryMerchantTheme.primaryGreen,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
                child: _isLoading
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.5,
                          color: Colors.white,
                        ),
                      )
                    : const Text(
                        'Verify & Proceed',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
              ),

              const SizedBox(height: 24),

              // Resend Code & Timer
              Center(
                child: _resendCountdown > 0
                    ? Text(
                        'Resend code in 00:${_resendCountdown.toString().padLeft(2, '0')}s',
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: GroceryMerchantTheme.textMuted,
                        ),
                      )
                    : TextButton(
                        onPressed: () {
                          _startTimer();
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Verification OTP resent! Use 123456 for demo.'),
                              backgroundColor: GroceryMerchantTheme.primaryGreen,
                            ),
                          );
                        },
                        child: const Text(
                          'Resend OTP Code',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w800,
                            color: GroceryMerchantTheme.primaryGreen,
                          ),
                        ),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}