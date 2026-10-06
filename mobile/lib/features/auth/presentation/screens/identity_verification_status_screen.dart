import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/network/session_manager.dart';
import '../../../../core/theme/nabin_palette.dart';

class IdentityVerificationStatusScreen extends StatefulWidget {
  const IdentityVerificationStatusScreen({super.key});

  @override
  State<IdentityVerificationStatusScreen> createState() => _IdentityVerificationStatusScreenState();
}

class _IdentityVerificationStatusScreenState extends State<IdentityVerificationStatusScreen> {
  // Everything here used to be handed over by the screen before it, or seeded:
  // 'Rahul Sharma', 'XXXX-XXXX-4892', 'MZO***201', a pending status, plus two
  // buttons that flipped the state to VERIFIED or RESUBMISSION_REQUIRED locally and
  // said so in a snackbar. `GET /api/identity/status/:userId` returns the real
  // application row, so every field below is filled from that read or stays blank.
  String _status = '';
  String _userName = '';
  String _aadhaarMasked = '';
  String _voterMasked = '';
  String _aadhaarDocStatus = '';
  String _voterDocStatus = '';
  String _submissionDate = '';
  String _updatedAt = '';
  String _resubmissionReason = '';
  String _rejectionReason = '';
  bool _hasApplication = false;
  bool _loading = true;
  bool _failed = false;
  String _failure = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _failed = false;
      _failure = '';
    });

    final userId = SessionManager.instance.currentUser?['id']?.toString();
    // The route is scoped by id and 403s anyone who asks for another account, so the
    // id can only come from this device's own session.
    final res = (userId == null || userId.isEmpty)
        ? null
        : await NabinApiService.getIdentityStatus(userId);
    if (!mounted) return;

    if (res == null || res['success'] != true) {
      setState(() {
        _loading = false;
        _failed = true;
        _failure = res?['error']?.toString() ??
            'NABIN could not read your verification status.';
      });
      return;
    }

    final user = (res['user'] as Map?)?.cast<String, dynamic>() ??
        const <String, dynamic>{};
    final application = (res['application'] as Map?)?.cast<String, dynamic>();
    final status = (application?['status'] ??
            user['identityStatus'] ??
            'IDENTITY_VERIFICATION_PENDING')
        .toString();

    setState(() {
      _loading = false;
      _hasApplication = application != null;
      _status = status;
      _userName = user['name']?.toString() ?? '';
      _aadhaarMasked = application?['aadhaarNumberMasked']?.toString() ?? '';
      _voterMasked = application?['voterIdNumberMasked']?.toString() ?? '';
      _aadhaarDocStatus = application?['aadhaarDocStatus']?.toString() ?? '';
      _voterDocStatus = application?['voterIdDocStatus']?.toString() ?? '';
      _submissionDate = application?['submissionDate']?.toString() ?? '';
      _updatedAt = application?['updatedAt']?.toString() ?? '';
      _resubmissionReason = application?['resubmissionReason']?.toString() ?? '';
      _rejectionReason = application?['rejectionReason']?.toString() ?? '';
    });
  }

  String get _readableStatus => switch (_status) {
        'VERIFIED' => 'Verified',
        'REJECTED' => 'Rejected',
        'RESUBMISSION_REQUIRED' => 'Resubmission requested',
        'UNDER_REVIEW' => 'Under review',
        _ => 'Pending',
      };

  /// `aadhaarDocStatus` / `voterIdDocStatus` come back as the platform's own tokens. NABIN has no
  /// document upload path, so since task #154 the only one a live application carries is
  /// `NO_DOCUMENT` — paperwork that cannot be filed has exactly one status, and this screen used to
  /// offer a five-state lifecycle (`SUBMITTED`, `VERIFIED`, `Needs a new copy` …) for files nobody
  /// can send. An unexpected value is shown as it arrived rather than rounded into that lifecycle.
  String _readableDoc(String raw) => switch (raw) {
        '' => '—',
        'NO_DOCUMENT' => 'No document on file',
        _ => raw,
      };

  String _readableDate(String raw) {
    final parsed = DateTime.tryParse(raw);
    if (parsed == null) return raw.isEmpty ? '—' : raw;
    final local = parsed.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(local.day)}/${two(local.month)}/${local.year} '
        '${two(local.hour)}:${two(local.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    final p = NabinPalette.of(context);
    final isPending = _status == 'IDENTITY_VERIFICATION_PENDING' || _status == 'UNDER_REVIEW';
    final isVerified = _status == 'VERIFIED';
    final isResubmit = _status == 'RESUBMISSION_REQUIRED';
    final isRejected = _status == 'REJECTED';

    // One semantic accent drives every status affordance: verified → success,
    // rejected → danger, pending/resubmit → warning. The fill is that accent at
    // low alpha so the surface stays white-dominant rather than a solid block.
    // With no row on file there is no decision to colour, so the badge carries the
    // brand and says so — 'Verification Pending' used to be the title this screen
    // gave an account that had never applied.
    final noApplication = !_hasApplication;
    final accent = noApplication
        ? p.brand
        : (isVerified ? p.success : (isRejected ? p.danger : p.warning));
    final statusIcon = noApplication
        ? Icons.assignment_add
        : (isVerified
            ? Icons.check_circle_rounded
            : (isResubmit
                ? Icons.replay_rounded
                : (isRejected ? Icons.cancel_rounded : Icons.hourglass_top_rounded)));
    final statusTitle = noApplication
        ? 'No application yet'
        : (isVerified
            ? 'Identity Verified!'
            : (isResubmit
                ? 'Resubmission Requested'
                : (isRejected ? 'Application Rejected' : 'Verification Pending')));
    final statusSubtitle = noApplication
        ? 'No identity application is on file for this account yet.'
        : (isVerified
            ? 'NABIN has verified the identity on this account.'
            : (isResubmit
                ? (_resubmissionReason.isNotEmpty
                    ? _resubmissionReason
                    : 'An officer asked for a fresh application. Open the form below to send it again.')
                : (isRejected
                    ? (_rejectionReason.isNotEmpty
                        ? _rejectionReason
                        : 'An officer rejected this application.')
                    : 'Your application is with NABIN. This page updates when an officer reviews it.')));

    return Scaffold(
      backgroundColor: p.canvas,
      appBar: AppBar(
        backgroundColor: p.canvas,
        foregroundColor: p.onSurface,
        surfaceTintColor: Colors.transparent,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, size: 20),
          onPressed: () => context.go('/personalization'),
        ),
        title: Text(
          'Verification Status',
          style: TextStyle(fontWeight: FontWeight.w700, fontSize: 18, color: p.onSurface),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: _loading
            // A static line rather than a spinner: an animated indicator keeps every
            // widget test of this screen from ever settling.
            ? const Center(
                child: Padding(
                  padding: EdgeInsets.symmetric(horizontal: 32),
                  child: Text(
                    'Reading your verification status from NABIN…',
                    textAlign: TextAlign.center,
                  ),
                ),
              )
            : _failed
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 32),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.wifi_off_rounded, color: p.danger, size: 32),
                          const SizedBox(height: 12),
                          Text(
                            _failure,
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: p.onSurface,
                              height: 1.4,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Nothing on this page is a guess: it shows what NABIN answered, so it stays empty until the read works.',
                            textAlign: TextAlign.center,
                            style: TextStyle(fontSize: 11.5, color: p.onSurfaceMuted, height: 1.35),
                          ),
                          const SizedBox(height: 16),
                          OutlinedButton.icon(
                            onPressed: _load,
                            icon: const Icon(Icons.refresh_rounded, size: 18),
                            label: const Text('Try again'),
                          ),
                        ],
                      ),
                    ),
                  )
                : SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
          child: Column(
            children: [
              const SizedBox(height: 12),

              // Status badge — white canvas carries the accent, not a filled circle
              Center(
                child: Container(
                  width: 100,
                  height: 100,
                  decoration: BoxDecoration(
                    color: accent.withValues(alpha: 0.10),
                    shape: BoxShape.circle,
                    border: Border.all(color: accent.withValues(alpha: 0.35), width: 2),
                  ),
                  child: Icon(statusIcon, size: 48, color: accent),
                ),
              ),
              const SizedBox(height: 20),

              // Main Status Heading
              Text(
                statusTitle,
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  color: p.onSurface,
                  letterSpacing: -0.5,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),

              // Subtitle Banner
              Text(
                statusSubtitle,
                style: TextStyle(
                  color: (isResubmit || isRejected) ? accent : p.onSurfaceMuted,
                  fontSize: 13,
                  fontWeight: (isResubmit || isRejected) ? FontWeight.w600 : FontWeight.normal,
                  height: 1.4,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 32),

              // Submission Summary Card
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: p.surface,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: p.divider),
                  boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 4, offset: Offset(0, 2))],
                ),
                child: Column(
                  children: [
                    _buildSummaryRow(p, 'Application',
                        _hasApplication ? _readableStatus : 'Not submitted yet'),
                    if (_hasApplication) ...[
                      const Divider(height: 24),
                      _buildSummaryRow(
                          p, 'Applicant', _userName.isEmpty ? '—' : _userName),
                      const Divider(height: 24),
                      _buildSummaryRow(
                        p,
                        'Aadhaar',
                        _readableDoc(_aadhaarDocStatus),
                        valueSub: _aadhaarMasked.isEmpty ? null : _aadhaarMasked,
                      ),
                      const Divider(height: 24),
                      _buildSummaryRow(
                        p,
                        'Voter ID',
                        _readableDoc(_voterDocStatus),
                        valueSub: _voterMasked.isEmpty ? null : _voterMasked,
                      ),
                      const Divider(height: 24),
                      _buildSummaryRow(p, 'Submitted', _readableDate(_submissionDate)),
                      if (_updatedAt.isNotEmpty) ...[
                        const Divider(height: 24),
                        _buildSummaryRow(p, 'Last update', _readableDate(_updatedAt)),
                      ],
                    ],
                    // 'Review Authority: NABIN Manual Compliance' used to be a row on a
                    // screen that had read nothing. Who reviews is the platform's
                    // business and the officer's decision is what arrives here, so the
                    // status and the dates are what this card is allowed to state.
                  ],
                ),
              ),
              const SizedBox(height: 32),

              // Action Buttons
              if (isVerified)
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: () => context.go('/home'),
                    child: const FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'Proceed to Super-App',
                            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                          ),
                          SizedBox(width: 8),
                          Icon(Icons.arrow_forward_rounded, size: 20),
                        ],
                      ),
                    ),
                  ),
                )
              else if (isResubmit && _hasApplication)
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: () => context.go('/identity-verification-submit', extra: {
                      'isResubmission': true,
                      'reason': _resubmissionReason,
                    }),
                    // The screen this button opens states plainly that no document travels with the
                    // submission; a label promising "Documents" contradicted the form behind it.
                    child: const Text('Update & Resubmit Your Details', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                  ),
                )
              else if (isPending && _hasApplication) ...[
                // Two buttons used to sit here that "Simulated Approve" and "Simulated
                // Resubmit" by writing the status into this widget's own state and
                // saying so in a snackbar. Nothing on NABIN changed, and the next read
                // would have shown the application exactly as it was. An officer's
                // decision arrives through the platform, so the only honest affordance
                // while a submission is in review is to ask for the row again.
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: _load,
                    icon: const Icon(Icons.refresh_rounded, size: 18),
                    label: const Text('Check again'),
                  ),
                ),
              ],

              // With no application on file there is nothing pending, rejected or
              // verified, so the screen offers the one action that can create one.
              if (!_hasApplication) ...[
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: () => context.go('/identity-verification-submit'),
                    child: const Text(
                      'Start identity verification',
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSummaryRow(NabinPalette p, String label, String value, {String? valueSub}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(label, style: TextStyle(fontSize: 13, color: p.onSurfaceMuted, fontWeight: FontWeight.w600)),
        ),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(value, textAlign: TextAlign.end, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: p.onSurface)),
              if (valueSub != null)
                Text(valueSub, textAlign: TextAlign.end, style: TextStyle(fontSize: 11, fontFamily: 'monospace', color: p.brand, fontWeight: FontWeight.w700)),
            ],
          ),
        ),
      ],
    );
  }
}
