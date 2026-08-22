import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/driver_theme.dart';
import '../../../../core/widgets/driver_button.dart';
import '../../../../core/widgets/driver_card.dart';

class DriverOtpScreen extends StatefulWidget {
  final String phoneNumber;
  const DriverOtpScreen({super.key, required this.phoneNumber});

  @override
  State<DriverOtpScreen> createState() => _DriverOtpScreenState();
}

class _DriverOtpScreenState extends State<DriverOtpScreen> {
  final TextEditingController _otpController = TextEditingController(text: '7729');
  bool _isLoading = false;

  void _verifyOtp() {
    setState(() => _isLoading = true);
    Future.delayed(const Duration(milliseconds: 600), () {
      if (mounted) {
        setState(() => _isLoading = false);
        context.go('/home');
      }
    });
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
                  const Text('Demo code: 7729', style: TextStyle(color: DriverTheme.onlineGreen, fontWeight: FontWeight.bold, fontSize: 12)),
                  TextButton(
                    onPressed: () {},
                    child: const Text('Resend Code (30s)', style: TextStyle(color: DriverTheme.textMuted, fontSize: 12)),
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
