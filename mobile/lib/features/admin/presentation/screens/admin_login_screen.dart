import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/admin_auth_provider.dart';
import '../theme/admin_theme.dart';
import 'admin_otp_screen.dart';

class AdminLoginScreen extends ConsumerStatefulWidget {
  const AdminLoginScreen({super.key});

  @override
  ConsumerState<AdminLoginScreen> createState() => _AdminLoginScreenState();
}

class _AdminLoginScreenState extends ConsumerState<AdminLoginScreen> {
  final TextEditingController _phoneController = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _isLoading = false;

  @override
  void dispose() {
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _submitPhone() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isLoading = true);

    final fullPhone = '+91 ${_phoneController.text.trim()}';
    final success = await ref.read(adminAuthProvider.notifier).sendOtp(fullPhone);

    setState(() => _isLoading = false);

    if (mounted && success) {
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => AdminOtpScreen(phoneNumber: fullPhone),
        ),
      );
    } else if (mounted) {
      final error = ref.read(adminAuthProvider).errorMessage;
      if (error != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error), backgroundColor: AdminTheme.accentRose),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AdminTheme.bgOffWhite,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 40),
              const Icon(Icons.admin_panel_settings, size: 60, color: AdminTheme.primaryBlue),
              const SizedBox(height: 24),
              const Text(
                'Admin Access',
                style: TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.w900,
                  color: AdminTheme.textDark,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Enter authorized administrator credentials.',
                style: TextStyle(
                  fontSize: 14,
                  color: AdminTheme.textMuted,
                ),
              ),
              const SizedBox(height: 40),
              Form(
                key: _formKey,
                child: TextFormField(
                  controller: _phoneController,
                  keyboardType: TextInputType.phone,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(10),
                  ],
                  decoration: InputDecoration(
                    labelText: 'Phone Number',
                    prefixText: '+91 ',
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  validator: (val) {
                    if (val == null || val.length != 10) return 'Enter 10 digit number';
                    return null;
                  },
                ),
              ),
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: _isLoading ? null : _submitPhone,
                child: _isLoading 
                    ? const CircularProgressIndicator(color: Colors.white) 
                    : const Text('Login via OTP'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
