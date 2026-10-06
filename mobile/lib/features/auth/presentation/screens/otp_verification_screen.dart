import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/config/nabin_build_env.dart';
import '../../../../core/widgets/nabin_button.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/network/session_manager.dart';

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

  Future<void> _verifyOtp() async {
    final enteredOtp = _controllers.map((c) => c.text).join().trim();
    if (enteredOtp.length < 4) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter the complete 4-digit OTP')),
      );
      return;
    }

    setState(() => _isLoading = true);
    try {
      final res = await NabinApiService.verifyOtp(
        phone: widget.phoneNumber,
        otp: enteredOtp,
        role: 'CUSTOMER',
        purpose: 'LOGIN',
      );
      if (!mounted) return;
      setState(() => _isLoading = false);

      if (res != null && res['success'] == true) {
        final token = res['token']?.toString();
        final user = res['user'] is Map
            ? Map<String, dynamic>.from(res['user'] as Map)
            : null;
        // A verified code is not a session. This used to mint its own credential
        // (`usr_session_<clock>`) and its own user id (`usr_cust_<phone>`) when the
        // response omitted either, and the app then walked on believing it was signed
        // in: every call that authenticates would come back refused, and the id the
        // wallet, bookings and identity application are keyed by was a string this
        // device invented. A success without a token is a broken contract, so it is
        // reported as one instead of being filled in.
        if (token == null || token.isEmpty || user == null || user['id'] == null) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                'NABIN verified the code but did not hand this device a session. '
                'Ask it for a new code and try again.',
              ),
            ),
          );
          return;
        }
        SessionManager.instance.saveSession(token: token, user: user);
        context.push('/personalization');
      } else {
        final errorMsg = res?['error'] as String? ?? 'Invalid verification code. Please try again.';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(errorMsg), backgroundColor: Colors.red.shade700),
        );
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _isLoading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Connection error: $e'), backgroundColor: Colors.red.shade700),
      );
    }
  }

  Future<void> _resendOtp() async {
    final res = await NabinApiService.sendOtp(
      phone: widget.phoneNumber,
      role: 'CUSTOMER',
      purpose: 'LOGIN',
    );
    if (!mounted) return;
    final bool sent = res != null && res['success'] == true;
    String message;
    if (!sent) {
      final Object? apiError = res == null ? null : res['error'];
      message = apiError as String? ??
          'The code could not be resent. Try again in a moment.';
    } else {
      final Object? testOtp =
          NabinBuildEnv.allowsDemoConvenience ? res['testOtp'] : null;
      message = testOtp == null
          ? 'A new verification code is on its way.'
          : 'A new verification code is on its way. Development code: $testOtp.';
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: sent ? AppTheme.primary : Colors.red.shade700,
      ),
    );
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
                              onPressed: _resendOtp,
                              icon: const Icon(Icons.replay_rounded, size: 16, color: AppTheme.primary),
                              label: const Text('Resend code', style: TextStyle(color: AppTheme.primary, fontWeight: FontWeight.bold, fontSize: 13)),
                            ),
                          ],
                        ),
                      ),
                      const Spacer(),
                      const SizedBox(height: 24),

                      NabinButton(
                        text: 'Verify & Proceed',
                        onPressed: _verifyOtp,
                        isLoading: _isLoading,
                        icon: Icons.arrow_forward,
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
