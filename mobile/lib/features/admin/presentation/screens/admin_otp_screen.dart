import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/admin_auth_provider.dart';
import '../theme/admin_theme.dart';

class AdminOtpScreen extends ConsumerStatefulWidget {
  final String phoneNumber;
  const AdminOtpScreen({super.key, required this.phoneNumber});

  @override
  ConsumerState<AdminOtpScreen> createState() => _AdminOtpScreenState();
}

class _AdminOtpScreenState extends ConsumerState<AdminOtpScreen> {
  final TextEditingController _otpController = TextEditingController();
  bool _isLoading = false;

  @override
  void dispose() {
    _otpController.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    final otp = _otpController.text.trim();
    if (otp.length < 6) return;

    setState(() => _isLoading = true);
    final success = await ref.read(adminAuthProvider.notifier).verifyOtp(otp);
    setState(() => _isLoading = false);

    if (mounted) {
      if (success) {
        context.go('/dashboard');
      } else {
        final error = ref.read(adminAuthProvider).errorMessage;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error ?? 'Verification failed'), backgroundColor: AdminTheme.accentRose),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AdminTheme.bgOffWhite,
      appBar: AppBar(
        title: const Text('Verify OTP'),
        backgroundColor: Colors.transparent,
        elevation: 0,
        foregroundColor: AdminTheme.textDark,
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Sent to ${widget.phoneNumber}',
                style: const TextStyle(fontSize: 16, color: AdminTheme.textMuted),
              ),
              const SizedBox(height: 24),
              TextField(
                controller: _otpController,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: InputDecoration(
                  labelText: '6-digit OTP',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                ),
                onChanged: (v) {
                  if (v.length == 6) _verify();
                },
              ),
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: _isLoading ? null : _verify,
                child: _isLoading ? const CircularProgressIndicator(color: Colors.white) : const Text('Verify & Login'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
