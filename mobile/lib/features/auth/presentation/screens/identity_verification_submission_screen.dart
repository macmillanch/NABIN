import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';

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

class _IdentityVerificationSubmissionScreenState extends State<IdentityVerificationSubmissionScreen> {
  final _formKey = GlobalKey<FormState>();

  final TextEditingController _fullNameController = TextEditingController(text: 'Rahul Sharma');
  final TextEditingController _dobController = TextEditingController(text: '15/08/1994');
  final TextEditingController _addressController = TextEditingController(text: 'Flat 402, Civil Lines, North Delhi, 110054');
  final TextEditingController _aadhaarController = TextEditingController(text: '5482 9103 4892');
  final TextEditingController _voterIdController = TextEditingController(text: 'DLH1948201');

  bool _aadhaarUploaded = true;
  bool _voterIdUploaded = true;
  bool _consentChecked = true;
  bool _isSubmitting = false;

  void _submitApplication() {
    if (!_consentChecked) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please confirm your consent for manual identity verification.')),
      );
      return;
    }

    if (!_aadhaarUploaded || !_voterIdUploaded) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Both Aadhaar and Voter ID documents must be uploaded.')),
      );
      return;
    }

    setState(() => _isSubmitting = true);

    Future.delayed(const Duration(milliseconds: 900), () {
      if (mounted) {
        setState(() => _isSubmitting = false);
        context.go('/identity-verification-status', extra: {
          'userName': _fullNameController.text,
          'aadhaarMasked': 'XXXX-XXXX-${_aadhaarController.text.replaceAll(' ', '').substring(_aadhaarController.text.replaceAll(' ', '').length - 4)}',
          'voterMasked': '${_voterIdController.text.substring(0, 3)}***${_voterIdController.text.substring(_voterIdController.text.length - 3)}',
        });
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
          onPressed: () => context.canPop() ? context.pop() : context.go('/personalization'),
        ),
        title: const Text(
          'Identity Verification',
          style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: AppTheme.onSurface),
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
                // Header Info
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF8E1),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFFFE082)),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.verified_user_rounded, color: Color(0xFFF57F17), size: 28),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              widget.isResubmission ? 'Resubmission Requested' : 'Mandatory Manual Identity Verification',
                              style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: Color(0xFFE65100)),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              widget.isResubmission && widget.initialReason != null
                                  ? widget.initialReason!
                                  : 'To protect community safety, all NABIN accounts require manual verification of Aadhaar and Voter ID by our compliance team.',
                              style: const TextStyle(fontSize: 12, color: Color(0xFF5D4037), height: 1.3),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),

                const Text('1. Personal Details', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: AppTheme.onSurface)),
                const SizedBox(height: 12),

                // Name Field
                _buildInputField(
                  label: 'Full Legal Name (as per Govt ID)',
                  controller: _fullNameController,
                  icon: Icons.person_outline,
                ),
                const SizedBox(height: 12),

                // DOB Field
                _buildInputField(
                  label: 'Date of Birth (DD/MM/YYYY)',
                  controller: _dobController,
                  icon: Icons.cake_outlined,
                ),
                const SizedBox(height: 12),

                // Address Field
                _buildInputField(
                  label: 'Residential Address',
                  controller: _addressController,
                  icon: Icons.location_on_outlined,
                  maxLines: 2,
                ),
                const SizedBox(height: 28),

                const Text('2. Aadhaar Card Verification', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: AppTheme.onSurface)),
                const SizedBox(height: 12),

                _buildInputField(
                  label: '12-Digit Aadhaar Number',
                  controller: _aadhaarController,
                  icon: Icons.credit_card,
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 10),

                // Aadhaar Upload Box
                _buildDocUploadCard(
                  title: 'Aadhaar Card (Front & Back Photo)',
                  isUploaded: _aadhaarUploaded,
                  onTap: () => setState(() => _aadhaarUploaded = !_aadhaarUploaded),
                ),
                const SizedBox(height: 28),

                const Text('3. Voter ID / EPIC Verification', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: AppTheme.onSurface)),
                const SizedBox(height: 12),

                _buildInputField(
                  label: 'Voter ID (EPIC Number)',
                  controller: _voterIdController,
                  icon: Icons.how_to_vote_outlined,
                ),
                const SizedBox(height: 10),

                // Voter ID Upload Box
                _buildDocUploadCard(
                  title: 'Voter ID Card Photo',
                  isUploaded: _voterIdUploaded,
                  onTap: () => setState(() => _voterIdUploaded = !_voterIdUploaded),
                ),
                const SizedBox(height: 24),

                // Consent Checkbox
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Checkbox(
                      value: _consentChecked,
                      onChanged: (val) => setState(() => _consentChecked = val ?? false),
                      activeColor: AppTheme.primary,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
                    ),
                    const Expanded(
                      child: Text(
                        'I declare that the information provided is accurate and authentic. I consent to manual verification by NABIN compliance officers.',
                        style: TextStyle(fontSize: 11, color: AppTheme.onSurfaceVariant, height: 1.3),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),

                // Submit Button
                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: ElevatedButton(
                    onPressed: _isSubmitting ? null : _submitApplication,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.primary,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                      elevation: 2,
                    ),
                    child: _isSubmitting
                        ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
                        : Text(
                            widget.isResubmission ? 'Resubmit for Verification' : 'Submit for Admin Verification',
                            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: Colors.white),
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

  Widget _buildInputField({
    required String label,
    required TextEditingController controller,
    required IconData icon,
    TextInputType? keyboardType,
    int maxLines = 1,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.outlineVariant),
      ),
      child: TextField(
        controller: controller,
        keyboardType: keyboardType,
        maxLines: maxLines,
        style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.onSurface, fontSize: 14),
        decoration: InputDecoration(
          labelText: label,
          labelStyle: const TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 12),
          border: InputBorder.none,
          icon: Icon(icon, color: AppTheme.primary, size: 20),
        ),
      ),
    );
  }

  Widget _buildDocUploadCard({
    required String title,
    required bool isUploaded,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: isUploaded ? const Color(0xFFE8F5E9) : AppTheme.surfaceContainerLowest,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: isUploaded ? const Color(0xFF81C784) : AppTheme.outlineVariant),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: isUploaded ? const Color(0xFFC8E6C9) : const Color(0xFFF5F5F5),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(
                isUploaded ? Icons.check_circle : Icons.upload_file,
                color: isUploaded ? const Color(0xFF2E7D32) : AppTheme.onSurfaceVariant,
                size: 22,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.onSurface)),
                  Text(
                    isUploaded ? 'Document attached (Tap to change)' : 'Tap to upload high-resolution photo',
                    style: TextStyle(fontSize: 11, color: isUploaded ? const Color(0xFF2E7D32) : AppTheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
            Icon(
              isUploaded ? Icons.edit_outlined : Icons.add_photo_alternate_outlined,
              color: AppTheme.primary,
              size: 20,
            ),
          ],
        ),
      ),
    );
  }
}
