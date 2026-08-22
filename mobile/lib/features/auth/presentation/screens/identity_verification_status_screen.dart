import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';

class IdentityVerificationStatusScreen extends StatefulWidget {
  final Map<String, dynamic>? initialData;

  const IdentityVerificationStatusScreen({
    super.key,
    this.initialData,
  });

  @override
  State<IdentityVerificationStatusScreen> createState() => _IdentityVerificationStatusScreenState();
}

class _IdentityVerificationStatusScreenState extends State<IdentityVerificationStatusScreen> {
  String _status = 'IDENTITY_VERIFICATION_PENDING'; // 'PENDING', 'UNDER_REVIEW', 'RESUBMISSION_REQUIRED', 'VERIFIED', 'REJECTED'
  String _userName = 'Rahul Sharma';
  String _aadhaarMasked = 'XXXX-XXXX-4892';
  String _voterMasked = 'DLH***201';
  String _resubmissionReason = '';

  @override
  void initState() {
    super.initState();
    if (widget.initialData != null) {
      _userName = widget.initialData!['userName'] as String? ?? _userName;
      _aadhaarMasked = widget.initialData!['aadhaarMasked'] as String? ?? _aadhaarMasked;
      _voterMasked = widget.initialData!['voterMasked'] as String? ?? _voterMasked;
      _status = widget.initialData!['status'] as String? ?? _status;
      _resubmissionReason = widget.initialData!['resubmissionReason'] as String? ?? '';
    }
  }

  void _simulateAdminApproval() {
    setState(() {
      _status = 'VERIFIED';
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Simulated Admin Approval: Account identity verified!'),
        backgroundColor: Color(0xFF2E7D32),
      ),
    );
  }

  void _simulateAdminResubmitRequest() {
    setState(() {
      _status = 'RESUBMISSION_REQUIRED';
      _resubmissionReason = 'Aadhaar document photo is slightly blurry. Please upload a clearer copy.';
    });
  }

  @override
  Widget build(BuildContext context) {
    final isPending = _status == 'IDENTITY_VERIFICATION_PENDING' || _status == 'UNDER_REVIEW';
    final isVerified = _status == 'VERIFIED';
    final isResubmit = _status == 'RESUBMISSION_REQUIRED';
    final isRejected = _status == 'REJECTED';

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, color: AppTheme.onSurface, size: 20),
          onPressed: () => context.go('/personalization'),
        ),
        title: const Text(
          'Verification Status',
          style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: AppTheme.onSurface),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
          child: Column(
            children: [
              const SizedBox(height: 12),

              // Animated Status Icon
              Center(
                child: Container(
                  width: 100,
                  height: 100,
                  decoration: BoxDecoration(
                    color: isVerified
                        ? const Color(0xFFE8F5E9)
                        : (isResubmit
                            ? const Color(0xFFFFF3E0)
                            : (isRejected ? const Color(0xFFFFEBEE) : const Color(0xFFFFF8E1))),
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: isVerified
                          ? const Color(0xFF4CAF50)
                          : (isResubmit
                              ? const Color(0xFFFF9800)
                              : (isRejected ? const Color(0xFFF44336) : const Color(0xFFFFC107))),
                      width: 2.5,
                    ),
                  ),
                  child: Icon(
                    isVerified
                        ? Icons.check_circle_rounded
                        : (isResubmit
                            ? Icons.replay_rounded
                            : (isRejected ? Icons.cancel_rounded : Icons.hourglass_top_rounded)),
                    size: 48,
                    color: isVerified
                        ? const Color(0xFF2E7D32)
                        : (isResubmit
                            ? const Color(0xFFE65100)
                            : (isRejected ? const Color(0xFFC62828) : const Color(0xFFF57F17))),
                  ),
                ),
              ),
              const SizedBox(height: 20),

              // Main Status Heading
              Text(
                isVerified
                    ? 'Identity Verified!'
                    : (isResubmit
                        ? 'Resubmission Requested'
                        : (isRejected ? 'Application Rejected' : 'Verification Pending')),
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w900,
                  color: AppTheme.onSurface,
                  letterSpacing: -0.5,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),

              // Subtitle Banner
              Text(
                isVerified
                    ? 'Your Aadhaar and Voter ID have been verified by NABIN compliance. Full super-app features are now active.'
                    : (isResubmit
                        ? _resubmissionReason.isNotEmpty
                            ? _resubmissionReason
                            : 'Our admin team requested updated documents. Please review instructions and resubmit.'
                        : (isRejected
                            ? 'Your identity application did not meet compliance requirements.'
                            : 'Verification pending — our admin team will review your documents.')),
                style: TextStyle(
                  color: isResubmit ? const Color(0xFFE65100) : AppTheme.onSurfaceVariant,
                  fontSize: 13,
                  fontWeight: isResubmit ? FontWeight.bold : FontWeight.normal,
                  height: 1.4,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 32),

              // Submission Summary Card
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceContainerLowest,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: AppTheme.outlineVariant),
                  boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 4, offset: Offset(0, 2))],
                ),
                child: Column(
                  children: [
                    _buildSummaryRow('Applicant', _userName),
                    const Divider(height: 24, color: AppTheme.outlineVariant),
                    _buildSummaryRow('Aadhaar Status', isVerified ? 'Verified' : 'Submitted (Under Review)', valueSub: _aadhaarMasked),
                    const Divider(height: 24, color: AppTheme.outlineVariant),
                    _buildSummaryRow('Voter ID Status', isVerified ? 'Verified' : 'Submitted (Under Review)', valueSub: _voterMasked),
                    const Divider(height: 24, color: AppTheme.outlineVariant),
                    _buildSummaryRow('Review Authority', 'NABIN Manual Compliance'),
                  ],
                ),
              ),
              const SizedBox(height: 32),

              // Action Buttons
              if (isVerified)
                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: ElevatedButton(
                    onPressed: () => context.go('/home'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF2E7D32),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                      elevation: 2,
                    ),
                    child: const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text('Proceed to Super-App', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: Colors.white)),
                        SizedBox(width: 8),
                        Icon(Icons.arrow_forward_rounded, color: Colors.white),
                      ],
                    ),
                  ),
                )
              else if (isResubmit)
                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: ElevatedButton(
                    onPressed: () => context.go('/identity-verification-submit', extra: {
                      'isResubmission': true,
                      'reason': _resubmissionReason,
                    }),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFFE65100),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                      elevation: 2,
                    ),
                    child: const Text('Update & Resubmit Documents', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: Colors.white)),
                  ),
                )
              else if (isPending) ...[
                // Developer / Simulation Quick Triggers for interactive test
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF5F5F5),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFE0E0E0)),
                  ),
                  child: Column(
                    children: [
                      const Text(
                        'Simulator Controls (QA Testing)',
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF757575)),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton(
                              onPressed: _simulateAdminApproval,
                              style: OutlinedButton.styleFrom(
                                side: const BorderSide(color: Color(0xFF2E7D32)),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                              ),
                              child: const Text('Simulate Approve', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF2E7D32))),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: OutlinedButton(
                              onPressed: _simulateAdminResubmitRequest,
                              style: OutlinedButton.styleFrom(
                                side: const BorderSide(color: Color(0xFFE65100)),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                              ),
                              child: const Text('Simulate Resubmit', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFFE65100))),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSummaryRow(String label, String value, {String? valueSub}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontSize: 13, color: AppTheme.onSurfaceVariant, fontWeight: FontWeight.w600)),
        Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppTheme.onSurface)),
            if (valueSub != null)
              Text(valueSub, style: const TextStyle(fontSize: 11, fontFeatures: [], fontFamily: 'monospace', color: AppTheme.primary, fontWeight: FontWeight.bold)),
          ],
        ),
      ],
    );
  }
}
