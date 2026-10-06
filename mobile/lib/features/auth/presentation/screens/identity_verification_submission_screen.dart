import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/network/session_manager.dart';
import '../../../../core/theme/nabin_palette.dart';

class IdentityVerificationSubmissionScreen extends StatefulWidget {
  final bool isResubmission;
  final String? initialReason;

  const IdentityVerificationSubmissionScreen({
    super.key,
    this.isResubmission = false,
    this.initialReason,
  });

  @override
  State<IdentityVerificationSubmissionScreen> createState() => _IdentityVerificationSubmissionScreenState();
}

class _IdentityVerificationSubmissionScreenState
    extends State<IdentityVerificationSubmissionScreen> {
  final _formKey = GlobalKey<FormState>();

  // These five fields used to open already filled in with someone's identity:
  // 'Rahul Sharma', 15/08/1994, 'Flat 402, Tuikual, Aizawl, Mizoram, 796001', a
  // 12-digit Aadhaar and an EPIC number — and both document tiles and the consent
  // box started as `true`. A customer who touched nothing could press Submit and the
  // app would claim to have declared that other person's details accurate. They are
  // empty now, and the only value this screen supplies for free is the name the
  // account itself carries.
  final TextEditingController _fullNameController = TextEditingController();
  final TextEditingController _dobController = TextEditingController();
  final TextEditingController _addressController = TextEditingController();
  final TextEditingController _aadhaarController = TextEditingController();
  final TextEditingController _voterIdController = TextEditingController();

  bool _consentChecked = false;
  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    final name = SessionManager.instance.currentUser?['name']?.toString().trim();
    if (name != null && name.isNotEmpty) _fullNameController.text = name;
  }

  @override
  void dispose() {
    _fullNameController.dispose();
    _dobController.dispose();
    _addressController.dispose();
    _aadhaarController.dispose();
    _voterIdController.dispose();
    super.dispose();
  }

  void _notice(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), duration: const Duration(seconds: 3)),
    );
  }

  String? _validateName(String? value) {
    final text = value?.trim() ?? '';
    if (text.isEmpty) return 'Enter your full name as it appears on the card.';
    if (text.length < 3) return 'That name looks too short to be the one on the card.';
    return null;
  }

  String? _validateAddress(String? value) {
    final text = value?.trim() ?? '';
    if (text.isEmpty) return 'Enter the address NABIN should record.';
    return null;
  }

  String? _validateDob(String? value) {
    final text = value?.trim() ?? '';
    if (text.isEmpty) return null; // Optional: the route stores what it is given.
    if (!RegExp(r'^\d{2}/\d{2}/\d{4}$').hasMatch(text)) return 'Use DD/MM/YYYY.';
    return null;
  }

  /// `POST /api/identity/submit` rejects anything whose digits are not at least
  /// twelve long, so the screen asks for that before the round trip, not after.
  String? _validateAadhaar(String? value) {
    final digits = (value ?? '').replaceAll(RegExp(r'\D'), '');
    if (digits.length != 12) return 'Aadhaar is 12 digits.';
    return null;
  }

  String? _validateVoterId(String? value) {
    final text = value?.trim().toUpperCase() ?? '';
    if (text.length < 5) return 'The EPIC number on the card is at least 5 characters.';
    return null;
  }

  Future<void> _submitApplication() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    if (!_consentChecked) {
      _notice('Tick the declaration before sending this to NABIN.');
      return;
    }

    final user = SessionManager.instance.currentUser;
    final userId = user?['id']?.toString();
    if (userId == null || userId.isEmpty) {
      // The route binds the application to the bearer token and 403s any other id,
      // so with no session there is nothing honest to send.
      _notice('Sign in again before sending your details.');
      return;
    }

    setState(() => _isSubmitting = true);
    final res = await NabinApiService.submitIdentity(
      userId: userId,
      name: _fullNameController.text.trim(),
      phone: user?['phone']?.toString() ?? '',
      aadhaarNumber: _aadhaarController.text.replaceAll(RegExp(r'\D'), ''),
      voterIdNumber: _voterIdController.text.trim().toUpperCase(),
      email: user?['email']?.toString(),
      dob: _dobController.text.trim().isEmpty ? null : _dobController.text.trim(),
      address: _addressController.text.trim(),
      isResubmission: widget.isResubmission,
    );
    if (!mounted) return;
    setState(() => _isSubmitting = false);

    if (res == null || res['success'] != true) {
      // The platform's reason, and no success the customer did not get.
      _notice(res?['error']?.toString() ??
          'NABIN could not record your application. Try again.');
      return;
    }

    // No masks are computed here any more: the application row is the server's, and
    // the status screen reads `aadhaarNumberMasked` and `voterIdNumberMasked` back
    // from `GET /api/identity/status/:userId`.
    context.go('/identity-verification-status');
  }

  @override
  Widget build(BuildContext context) {
    final p = NabinPalette.of(context);
    return Scaffold(
      backgroundColor: p.canvas,
      appBar: AppBar(
        backgroundColor: p.canvas,
        foregroundColor: p.onSurface,
        surfaceTintColor: Colors.transparent,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, size: 20),
          onPressed: () => context.canPop() ? context.pop() : context.go('/personalization'),
        ),
        title: Text(
          'Identity Verification',
          style: TextStyle(fontWeight: FontWeight.w700, fontSize: 18, color: p.onSurface),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Header Info — warning tint carries the notice, surface stays light
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: p.warning.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: p.warning.withValues(alpha: 0.30)),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(Icons.verified_user_rounded, color: p.warning, size: 28),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              widget.isResubmission ? 'Resubmission Requested' : 'Mandatory Manual Identity Verification',
                              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: p.onSurface),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              widget.isResubmission && widget.initialReason != null
                                  ? widget.initialReason!
                                  : 'To protect community safety, all NABIN accounts require manual verification of Aadhaar and Voter ID by NABIN.',
                              style: TextStyle(fontSize: 12, color: p.onSurfaceMuted, height: 1.3),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),

                Text('1. Personal Details', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: p.onSurface)),
                const SizedBox(height: 12),

                // Name Field
                _buildInputField(
                  p,
                  label: 'Full Legal Name (as per Govt ID)',
                  controller: _fullNameController,
                  icon: Icons.person_outline,
                  validator: _validateName,
                ),
                const SizedBox(height: 12),

                // DOB Field
                _buildInputField(
                  p,
                  label: 'Date of Birth (DD/MM/YYYY)',
                  controller: _dobController,
                  icon: Icons.cake_outlined,
                  validator: _validateDob,
                ),
                const SizedBox(height: 12),

                // Address Field
                _buildInputField(
                  p,
                  label: 'Residential Address',
                  controller: _addressController,
                  icon: Icons.location_on_outlined,
                  maxLines: 2,
                  validator: _validateAddress,
                ),
                const SizedBox(height: 28),

                Text('2. Aadhaar Card Verification', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: p.onSurface)),
                const SizedBox(height: 12),

                _buildInputField(
                  p,
                  label: '12-Digit Aadhaar Number',
                  controller: _aadhaarController,
                  icon: Icons.credit_card,
                  keyboardType: TextInputType.number,
                  inputFormatters: <TextInputFormatter>[FilteringTextInputFormatter.digitsOnly],
                  maxLength: 12,
                  validator: _validateAadhaar,
                ),
                const SizedBox(height: 10),

                _buildSubmissionNote(
                  p,
                  'This form sends the number you typed. NABIN has no way to attach a photo of the card from this app, so no document travels with it.',
                ),
                const SizedBox(height: 28),

                Text('3. Voter ID / EPIC Verification', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: p.onSurface)),
                const SizedBox(height: 12),

                _buildInputField(
                  p,
                  label: 'Voter ID (EPIC Number)',
                  controller: _voterIdController,
                  icon: Icons.how_to_vote_outlined,
                  validator: _validateVoterId,
                ),
                const SizedBox(height: 10),

                _buildSubmissionNote(
                  p,
                  'NABIN records the application for an officer to review. Enter the number exactly as it is printed on your card.',
                ),
                const SizedBox(height: 24),

                // Consent Checkbox
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Checkbox(
                      value: _consentChecked,
                      onChanged: (val) => setState(() => _consentChecked = val ?? false),
                      activeColor: p.brand,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
                    ),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Text(
                          'I declare that the information provided is accurate and authentic. I consent to manual verification by NABIN compliance officers.',
                          style: TextStyle(fontSize: 11, color: p.onSurfaceMuted, height: 1.3),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),

                // Submit Button — theme-driven brand primary CTA
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: _isSubmitting ? null : _submitApplication,
                    child: _isSubmitting
                        ? SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(
                              color: Theme.of(context).colorScheme.onPrimary,
                              strokeWidth: 2.5,
                            ),
                          )
                        : Text(
                            widget.isResubmission ? 'Resubmit for Verification' : 'Submit for Admin Verification',
                            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                          ),
                  ),
                ),
                const SizedBox(height: 20),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildInputField(
    NabinPalette p, {
    required String label,
    required TextEditingController controller,
    required IconData icon,
    TextInputType? keyboardType,
    int maxLines = 1,
    String? Function(String?)? validator,
    List<TextInputFormatter>? inputFormatters,
    int? maxLength,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: p.divider),
      ),
      child: TextFormField(
        controller: controller,
        keyboardType: keyboardType,
        maxLines: maxLines,
        validator: validator,
        inputFormatters: inputFormatters,
        maxLength: maxLength,
        style: TextStyle(fontWeight: FontWeight.w600, color: p.onSurface, fontSize: 14),
        decoration: InputDecoration(
          labelText: label,
          labelStyle: TextStyle(color: p.onSurfaceMuted, fontSize: 12),
          border: InputBorder.none,
          icon: Icon(icon, color: p.brand, size: 20),
        ),
      ),
    );
  }

  /// What this app can and cannot send. There is no camera or gallery picker in it,
  /// so the two upload tiles that used to sit here — starting pre-ticked 'Document
  /// attached' and flipping to that state on a tap — claimed a photo of a card that
  /// was never read from the device.
  Widget _buildSubmissionNote(NabinPalette p, String text) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: p.surfaceMuted,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: p.divider),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline_rounded, color: p.onSurfaceMuted, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              text,
              style: TextStyle(fontSize: 11.5, color: p.onSurfaceMuted, height: 1.35),
            ),
          ),
        ],
      ),
    );
  }
}
