import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/grocery_auth_provider.dart';
import '../theme/grocery_theme.dart';
import 'grocery_app_shell.dart';
import 'grocery_otp_screen.dart';

/// Phone Login Screen for NABIN Grocery App
class GroceryLoginScreen extends ConsumerStatefulWidget {
  const GroceryLoginScreen({super.key});

  @override
  ConsumerState<GroceryLoginScreen> createState() => _GroceryLoginScreenState();
}

class _GroceryLoginScreenState extends ConsumerState<GroceryLoginScreen> {
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
    final success = await ref.read(groceryAuthProvider.notifier).sendOtp(fullPhone);

    setState(() => _isLoading = false);

    if (mounted && success) {
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => GroceryOtpScreen(phoneNumber: fullPhone),
        ),
      );
    }
  }

  void _handleGuestExplore() {
    ref.read(groceryAuthProvider.notifier).continueAsGuest();
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const GroceryAppShell()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: GroceryTheme.bgOffWhite,
      body: SafeArea(
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header Visual Container
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(28),
                decoration: const BoxDecoration(
                  color: GroceryTheme.primaryGreenDark,
                  borderRadius: BorderRadius.only(
                    bottomLeft: Radius.circular(32),
                    bottomRight: Radius.circular(32),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.15),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.shopping_bag_outlined,
                            color: Colors.white,
                            size: 28,
                          ),
                        ),
                        const SizedBox(width: 12),
                        const Text(
                          'NABIN Grocery',
                          style: TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.w900,
                            color: Colors.white,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),
                    const Text(
                      'Groceries delivered in\n10 Minutes ⚡',
                      style: TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.w900,
                        color: Colors.white,
                        height: 1.2,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Fresh Mandi Vegetables, Dairy, Meats & Household Essentials',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        color: Colors.white.withValues(alpha: 0.8),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                ),
              ),

              // Form Section
              Padding(
                padding: const EdgeInsets.all(24),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Enter Mobile Number',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                          color: GroceryTheme.textDark,
                        ),
                      ),
                      const SizedBox(height: 6),
                      const Text(
                        'We will send a 6-digit verification code to log in',
                        style: TextStyle(
                          fontSize: 13,
                          color: GroceryTheme.textMuted,
                        ),
                      ),
                      const SizedBox(height: 20),

                      // Phone Input Field with +91 Country Badge
                      Container(
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: GroceryTheme.borderLight),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.03),
                              blurRadius: 10,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: Row(
                          children: [
                            // Country Code Chip
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
                              decoration: const BoxDecoration(
                                color: GroceryTheme.surfaceElevated,
                                borderRadius: BorderRadius.only(
                                  topLeft: Radius.circular(15),
                                  bottomLeft: Radius.circular(15),
                                ),
                              ),
                              child: const Row(
                                children: [
                                  Text(
                                    '🇮🇳 +91',
                                    style: TextStyle(
                                      fontSize: 15,
                                      fontWeight: FontWeight.w800,
                                      color: GroceryTheme.textDark,
                                    ),
                                  ),
                                  SizedBox(width: 4),
                                  Icon(
                                    Icons.arrow_drop_down_rounded,
                                    color: GroceryTheme.textMuted,
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 12),

                            // Phone TextField
                            Expanded(
                              child: TextFormField(
                                controller: _phoneController,
                                keyboardType: TextInputType.phone,
                                inputFormatters: [
                                  FilteringTextInputFormatter.digitsOnly,
                                  LengthLimitingTextInputFormatter(10),
                                ],
                                style: const TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: 1.0,
                                ),
                                decoration: const InputDecoration(
                                  hintText: 'Enter 10-digit number',
                                  hintStyle: TextStyle(
                                    color: GroceryTheme.textMuted,
                                    fontWeight: FontWeight.w400,
                                  ),
                                  border: InputBorder.none,
                                ),
                                validator: (val) {
                                  if (val == null || val.trim().length != 10) {
                                    return 'Please enter valid 10-digit phone number';
                                  }
                                  return null;
                                },
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 24),

                      // Continue Button
                      ElevatedButton(
                        onPressed: _isLoading ? null : _submitPhone,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: GroceryTheme.primaryGreen,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                          padding: const EdgeInsets.symmetric(vertical: 16),
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
                            : const Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Text(
                                    'Get Verification OTP',
                                    style: TextStyle(
                                      fontSize: 16,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  SizedBox(width: 8),
                                  Icon(Icons.arrow_forward_rounded, size: 20),
                                ],
                              ),
                      ),

                      const SizedBox(height: 20),

                      // Or Divider
                      const Row(
                        children: [
                          Expanded(child: Divider(color: GroceryTheme.borderLight)),
                          Padding(
                            padding: EdgeInsets.symmetric(horizontal: 12),
                            child: Text(
                              'OR',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: GroceryTheme.textMuted,
                              ),
                            ),
                          ),
                          Expanded(child: Divider(color: GroceryTheme.borderLight)),
                        ],
                      ),
                      const SizedBox(height: 20),

                      // Continue as Guest Button
                      OutlinedButton(
                        onPressed: _handleGuestExplore,
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(double.infinity, 50),
                          side: const BorderSide(color: GroceryTheme.primaryGreen),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                        ),
                        child: const Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.explore_outlined, color: GroceryTheme.primaryGreen, size: 20),
                            SizedBox(width: 8),
                            Text(
                              'Browse Store as Guest',
                              style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w800,
                                color: GroceryTheme.primaryGreen,
                              ),
                            ),
                          ],
                        ),
                      ),

                      const SizedBox(height: 32),

                      // Terms & Privacy
                      const Center(
                        child: Text(
                          'By continuing, you agree to NABIN\'s Terms of Service\nand Privacy Policy',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 11,
                            color: GroceryTheme.textMuted,
                            height: 1.4,
                          ),
                        ),
                      ),
                    ],
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
