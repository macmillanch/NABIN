import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/driver_theme.dart';
import '../../../../core/widgets/driver_button.dart';
import '../../../../core/widgets/driver_card.dart';

class DriverLoginScreen extends StatefulWidget {
  const DriverLoginScreen({super.key});

  @override
  State<DriverLoginScreen> createState() => _DriverLoginScreenState();
}

class _DriverLoginScreenState extends State<DriverLoginScreen> {
  final TextEditingController _phoneController = TextEditingController(text: '9876543210');
  bool _isLoading = false;

  void _submitPhone() {
    if (_phoneController.text.length < 10) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter valid 10-digit mobile number')),
      );
      return;
    }
    setState(() => _isLoading = true);
    Future.delayed(const Duration(milliseconds: 500), () {
      if (mounted) {
        setState(() => _isLoading = false);
        context.push('/otp', extra: _phoneController.text);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DriverTheme.bgLight,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 20),
              // Blue NABIN Driver Brand Header
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: const BoxDecoration(
                      color: DriverTheme.primaryBlue,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.local_taxi, color: Colors.white, size: 22),
                  ),
                  const SizedBox(width: 12),
                  const Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('NABIN', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: DriverTheme.primaryBlue, letterSpacing: 1.0)),
                      Text('DRIVER PARTNER', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: DriverTheme.textMuted, letterSpacing: 0.8)),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 36),

              const Text(
                'Partner Login',
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: DriverTheme.textDark),
              ),
              const SizedBox(height: 8),
              const Text(
                'Enter registered mobile number for Bike, Auto or Cab driver accounts.',
                style: TextStyle(color: DriverTheme.textMuted, fontSize: 14, height: 1.4),
              ),
              const SizedBox(height: 28),

              DriverCard(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Row(
                  children: [
                    const Text('+91', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: DriverTheme.primaryBlue)),
                    const SizedBox(width: 12),
                    const SizedBox(height: 28, child: VerticalDivider(color: DriverTheme.borderLight, thickness: 1.5)),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        controller: _phoneController,
                        keyboardType: TextInputType.phone,
                        maxLength: 10,
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: DriverTheme.textDark),
                        decoration: const InputDecoration(
                          hintText: 'Enter 10-digit mobile',
                          border: InputBorder.none,
                          counterText: '',
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('New driver partner?', style: TextStyle(color: DriverTheme.textMuted, fontSize: 13)),
                  TextButton(
                    onPressed: () => context.push('/kyc-registration'),
                    style: TextButton.styleFrom(foregroundColor: DriverTheme.primaryBlue),
                    child: const Text('Register Vehicle (KYC)', style: TextStyle(fontWeight: FontWeight.w800)),
                  ),
                ],
              ),
              const Spacer(),

              DriverButton(
                text: 'Send Verification Code (OTP)',
                icon: Icons.sms_outlined,
                isLoading: _isLoading,
                onPressed: _submitPhone,
              ),
              const SizedBox(height: 12),
            ],
          ),
        ),
      ),
    );
  }
}
