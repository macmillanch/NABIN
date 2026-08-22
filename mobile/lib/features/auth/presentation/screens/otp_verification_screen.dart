import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';

class OtpVerificationScreen extends StatefulWidget {
  final String phoneNumber;
  const OtpVerificationScreen({super.key, required this.phoneNumber});

  @override
  State<OtpVerificationScreen> createState() => _OtpVerificationScreenState();
}

class _OtpVerificationScreenState extends State<OtpVerificationScreen> {
  final List<TextEditingController> _controllers = List.generate(4, (_) => TextEditingController());
  final List<FocusNode> _focusNodes = List.generate(4, (_) => FocusNode());
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    // Default demo OTP 7729
    _controllers[0].text = '7';
    _controllers[1].text = '7';
    _controllers[2].text = '2';
    _controllers[3].text = '9';
  }

  @override
  void dispose() {
    for (final c in _controllers) {
      c.dispose();
    }
    for (final f in _focusNodes) {
      f.dispose();
    }
    super.dispose();
  }

  void _verifyOtp() {
    setState(() => _isLoading = true);
    Future.delayed(const Duration(milliseconds: 600), () {
      if (mounted) {
        setState(() => _isLoading = false);
        context.push('/personalization');
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, color: AppTheme.onSurface, size: 20),
          onPressed: () => context.canPop() ? context.pop() : context.go('/phone-entry'),
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
                      Container(
                        width: 64,
                        height: 64,
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [AppTheme.primary.withValues(alpha: 0.15), AppTheme.primaryContainer.withValues(alpha: 0.08)],
                          ),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.mark_email_read_outlined, color: AppTheme.primary, size: 32),
                      ),
                      const SizedBox(height: 24),
                      const Text(
                        "Verify it's you",
                        style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: AppTheme.onSurface, letterSpacing: -0.5),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        "We've sent a 4-digit code to +91 ${widget.phoneNumber}",
                        style: const TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 14),
                      ),
                      const SizedBox(height: 32),

                      // 4 Discrete Square OTP Boxes with Blue Highlight
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: List.generate(4, (index) {
                          return Container(
                            width: 68,
                            height: 68,
                            decoration: BoxDecoration(
                              color: AppTheme.surfaceContainerLowest,
                              borderRadius: BorderRadius.circular(18),
                              border: Border.all(color: AppTheme.primary, width: 2),
                              boxShadow: [
                                BoxShadow(
                                  color: AppTheme.primary.withValues(alpha: 0.12),
                                  blurRadius: 10,
                                  offset: const Offset(0, 4),
                                ),
                              ],
                            ),
                            child: Center(
                              child: TextField(
                                controller: _controllers[index],
                                focusNode: _focusNodes[index],
                                keyboardType: TextInputType.number,
                                textAlign: TextAlign.center,
                                maxLength: 1,
                                style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w900, color: AppTheme.primary),
                                decoration: const InputDecoration(
                                  hintText: '•',
                                  border: InputBorder.none,
                                  counterText: '',
                                  isDense: true,
                                ),
                                onChanged: (val) {
                                  if (val.isNotEmpty && index < 3) {
                                    _focusNodes[index + 1].requestFocus();
                                  }
                                },
                              ),
                            ),
                          );
                        }),
                      ),
                      const SizedBox(height: 24),

                      Center(
                        child: Column(
                          children: [
                            const Text("Didn't receive the code?", style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 13)),
                            const SizedBox(height: 4),
                            TextButton.icon(
                              onPressed: () {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(content: Text('New demo OTP sent: 7729')),
                                );
                              },
                              icon: const Icon(Icons.replay_rounded, size: 16, color: AppTheme.primary),
                              label: const Text('Resend Demo OTP (7729)', style: TextStyle(color: AppTheme.primary, fontWeight: FontWeight.bold, fontSize: 13)),
                            ),
                          ],
                        ),
                      ),
                      const Spacer(),
                      const SizedBox(height: 24),

                      ElevatedButton(
                        onPressed: _isLoading ? null : _verifyOtp,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppTheme.primaryContainer,
                          foregroundColor: Colors.white,
                          minimumSize: const Size(double.infinity, 56),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                          elevation: 2,
                          shadowColor: AppTheme.primary.withValues(alpha: 0.35),
                        ),
                        child: _isLoading
                            ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
                            : const Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Text('Verify & Proceed', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                                  SizedBox(width: 8),
                                  Icon(Icons.arrow_forward, size: 18),
                                ],
                              ),
                      ),
                      const SizedBox(height: 16),
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
