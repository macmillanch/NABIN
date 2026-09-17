import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/nabin_text_field.dart';
import '../../../../core/widgets/nabin_button.dart';

import '../../../../core/network/nabin_api_service.dart';

class PhoneEntryScreen extends StatefulWidget {
  const PhoneEntryScreen({super.key});

  @override
  State<PhoneEntryScreen> createState() => _PhoneEntryScreenState();
}

class _PhoneEntryScreenState extends State<PhoneEntryScreen> {
  final TextEditingController _phoneController = TextEditingController(text: '9876543210');
  bool _isLoading = false;

  Future<void> _submit() async {
    final phone = _phoneController.text.trim();
    if (phone.length < 10) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a valid 10-digit mobile number')),
      );
      return;
    }
    setState(() => _isLoading = true);
    try {
      final res = await NabinApiService.sendOtp(
        phone: phone,
        role: 'CUSTOMER',
        purpose: 'LOGIN',
      );
      if (!mounted) return;
      setState(() => _isLoading = false);

      if (res != null && res['success'] == true) {
        context.push('/otp-verification', extra: phone);
      } else {
        final errorMsg = res?['error'] as String? ?? 'Failed to send OTP. Please check backend connection.';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(errorMsg), backgroundColor: Colors.red.shade700),
        );
        // In local development or fallback, permit progression with warning
        context.push('/otp-verification', extra: phone);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _isLoading = false);
      context.push('/otp-verification', extra: phone);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, color: AppTheme.onSurface, size: 20),
          onPressed: () => context.canPop() ? context.pop() : context.go('/'),
        ),
        title: const Text('NABIN', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 20, color: AppTheme.primary, letterSpacing: 0.5)),
        centerTitle: true,
      ),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            return SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: constraints.maxHeight - 32),
                child: IntrinsicHeight(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SizedBox(height: 12),
                      // Floating Icon
                      Container(
                        width: 64,
                        height: 64,
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [AppTheme.primary.withValues(alpha: 0.15), AppTheme.primaryContainer.withValues(alpha: 0.08)],
                          ),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.phone_android_rounded, color: AppTheme.primary, size: 32),
                      ),
                      const SizedBox(height: 24),

                      const Text(
                        'Welcome to Nabin',
                        style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: AppTheme.onSurface, letterSpacing: -0.5),
                      ),
                      const SizedBox(height: 6),
                      const Text(
                        'Enter your 10-digit mobile number for instant verification & access.',
                        style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 14, height: 1.4),
                      ),
                      const SizedBox(height: 28),

                      // Phone Input Field
                      NabinTextField(
                        label: 'MOBILE NUMBER',
                        hintText: '98765 43210',
                        controller: _phoneController,
                        keyboardType: TextInputType.phone,
                        prefix: Container(
                          margin: const EdgeInsets.only(right: 12),
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                          decoration: BoxDecoration(
                            color: AppTheme.surfaceContainerLow,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: AppTheme.outlineVariant.withValues(alpha: 0.5)),
                          ),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text('🇮🇳 +91', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: AppTheme.onSurface)),
                              SizedBox(width: 4),
                              Icon(Icons.expand_more, size: 16, color: AppTheme.onSurfaceVariant),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),

                      // Quick Fill Pill
                      Row(
                        children: [
                          const Text('Demo Numbers: ', style: TextStyle(fontSize: 12, color: AppTheme.onSurfaceVariant, fontWeight: FontWeight.w600)),
                          GestureDetector(
                            onTap: () => setState(() => _phoneController.text = '9876543210'),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                color: AppTheme.primary.withValues(alpha: 0.08),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: const Text('9876543210', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.primary)),
                            ),
                          ),
                        ],
                      ),

                      const Spacer(),
                      const SizedBox(height: 24),

                      // Continue Action Button
                      NabinButton(
                        text: 'Continue',
                        onPressed: _submit,
                        isLoading: _isLoading,
                        icon: Icons.arrow_forward,
                        isFullWidth: true,
                      ),
                      const SizedBox(height: 12),
                      const Center(
                        child: Text(
                          'Secured with 256-bit encryption & instant OTP verification',
                          style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 11),
                          textAlign: TextAlign.center,
                        ),
                      ),
                      const SizedBox(height: 8),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
