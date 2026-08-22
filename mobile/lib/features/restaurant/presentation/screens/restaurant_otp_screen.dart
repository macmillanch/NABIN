import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/restaurant_theme.dart';

class RestaurantOtpScreen extends StatefulWidget {
  final String phoneNumber;
  const RestaurantOtpScreen({super.key, required this.phoneNumber});

  @override
  State<RestaurantOtpScreen> createState() => _RestaurantOtpScreenState();
}

class _RestaurantOtpScreenState extends State<RestaurantOtpScreen> {
  final TextEditingController _otpController = TextEditingController(text: '7729');
  bool _isLoading = false;

  void _verifyOtp() {
    setState(() => _isLoading = true);
    Future.delayed(const Duration(milliseconds: 500), () {
      if (mounted) {
        setState(() => _isLoading = false);
        context.go('/dashboard');
      }
    });
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
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: RestaurantTheme.statusReadyBg,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Text(
                      'Demo OTP: 7729',
                      style: TextStyle(
                        color: RestaurantTheme.statusReadyGreen,
                        fontWeight: FontWeight.bold,
                        fontSize: 12,
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: () {},
                    child: const Text(
                      'Resend Code',
                      style: TextStyle(
                        color: RestaurantTheme.primaryBlue,
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
