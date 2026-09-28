import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/network/session_manager.dart';
import '../../../../core/theme/driver_theme.dart';
import '../../../../core/widgets/driver_card.dart';

/// The partner's own account, read from the platform.
///
/// Every line of this screen used to be typed into the source: a name, a phone number that
/// belongs to no driver (`+91 98765 43210`), an unconditional "KYC Verified" badge, a rating,
/// a driving-licence plate, and a payout address (`rajesh.driver@okhdfcbank`) that exists in
/// no table. Two of the rows had `onTap: () {}` — an emergency SOS line and a support helpline
/// that did nothing at all. And "Logout" navigated to the login screen without ending the
/// session, so the bearer token stayed live in memory and in the platform.
class DriverAccountScreen extends StatefulWidget {
  const DriverAccountScreen({super.key});

  @override
  State<DriverAccountScreen> createState() => _DriverAccountScreenState();
}

class _Account {
  const _Account({
    required this.name,
    required this.phone,
    required this.kycStatus,
    required this.operationalStatus,
    required this.isOnline,
    required this.rating,
    required this.vehicleLabel,
    required this.walletBalance,
    required this.payoutDestination,
    required this.payoutVerified,
    required this.tripsToday,
    required this.earnedToday,
  });

  final String name;
  final String? phone;
  final String? kycStatus;
  final String? operationalStatus;
  final bool isOnline;
  final double? rating;
  final String vehicleLabel;
  final double? walletBalance;
  final String? payoutDestination;
  final bool payoutVerified;
  final int tripsToday;
  final double? earnedToday;
}

enum _AccountState { loading, ready, failed }

class _DriverAccountScreenState extends State<DriverAccountScreen> {
  _AccountState _state = _AccountState.loading;
  _Account? _account;
  String? _failureMessage;
  bool _isSigningOut = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _state = _AccountState.loading);
    // Two reads, both authoritative: the console carries who this partner is and what the
    // platform currently has them set to; the ledger carries what they have earned and where
    // a payout is allowed to go.
    final results = await Future.wait([
      NabinApiService.getDriverHome(),
      NabinApiService.getMyEarnings(),
    ]);
    if (!mounted) return;

    final home = results[0];
    if (home == null || home['success'] != true) {
      setState(() {
        _state = _AccountState.failed;
        _account = null;
        _failureMessage = home == null
            ? 'No connection to NABIN. Nothing about your account has changed.'
            : (home['error'] as String?) ?? 'Could not load your account.';
      });
      return;
    }

    final driver = (home['driver'] as Map?) ?? const {};
    final earnings = results[1];
    final payout = (earnings?['payout'] as Map?) ?? const {};
    final day = ((earnings?['windows'] as Map?)?['last24h'] as Map?);

    setState(() {
      _account = _Account(
        name: (driver['name'] as String?) ?? 'NABIN Partner',
        phone: driver['phone'] as String?,
        kycStatus: driver['kycStatus'] as String?,
        operationalStatus: driver['operationalStatus'] as String?,
        isOnline: driver['isOnline'] == true,
        rating: (driver['rating'] as num?)?.toDouble(),
        vehicleLabel: [
          driver['vehicleType'],
          driver['vehicleNumber'],
        ].whereType<String>().where((s) => s.isNotEmpty).join(' • '),
        walletBalance: (driver['walletBalance'] as num?)?.toDouble(),
        payoutDestination: payout['destination'] as String?,
        payoutVerified: payout['destinationVerified'] == true,
        tripsToday: (day?['trips'] as num?)?.toInt() ?? 0,
        earnedToday: (day?['netEarnings'] as num?)?.toDouble(),
      );
      _state = _AccountState.ready;
      _failureMessage = null;
    });
  }

  /// Ends the session on the platform and on this device.
  ///
  /// The row used to be `context.go('/login')` with the token still in memory and still
  /// valid server-side, so the next screen could keep acting as the partner who "signed out".
  Future<void> _signOut() async {
    if (_isSigningOut) return;
    setState(() => _isSigningOut = true);
    await NabinApiService.logout(); // revokes the session server-side
    SessionManager.instance.clearSession();
    if (!mounted) return;
    setState(() => _isSigningOut = false);
    context.go('/login');
  }

  Future<void> _raiseHelpTicket() async {
    final controller = TextEditingController();
    final submitted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Report an issue'),
        content: TextField(
          controller: controller,
          maxLines: 4,
          decoration: const InputDecoration(hintText: 'What happened?'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Send')),
        ],
      ),
    );
    final description = controller.text.trim();
    if (submitted != true || description.isEmpty) return;

    final res = await NabinApiService.submitSupportTicket(
      category: 'DRIVER_SUPPORT',
      // The signed-in partner's own id, as the platform gave it. Ownership of the ticket is
      // decided server-side from the bearer token; this only mirrors it.
      userId: (SessionManager.instance.currentUser?['id'] as String?) ?? '',
      title: 'Driver partner support',
      description: description,
    );
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(res != null && res['success'] == true
            ? 'Helpdesk ticket opened. NABIN will reply in the app.'
            : res?['error'] as String? ?? 'Could not open a ticket just now.'),
        backgroundColor: res != null && res['success'] == true
            ? DriverTheme.primaryBlue
            : Colors.red.shade700,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DriverTheme.bgLight,
      appBar: AppBar(
        title: const Text('Driver Account & Settings'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/home'),
        ),
        actions: [
          IconButton(
            onPressed: _state == _AccountState.loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: SafeArea(
        child: switch (_state) {
          _AccountState.loading => const Center(child: CircularProgressIndicator()),
          _AccountState.failed => _buildFailed(),
          _AccountState.ready => _buildAccount(),
        },
      ),
    );
  }

  Widget _buildFailed() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.cloud_off_rounded, size: 54, color: DriverTheme.textMuted),
            const SizedBox(height: 14),
            const Text('Could not load your account',
                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: DriverTheme.textDark)),
            const SizedBox(height: 6),
            Text(_failureMessage ?? '',
                textAlign: TextAlign.center,
                style: const TextStyle(color: DriverTheme.textMuted, fontSize: 13)),
            const SizedBox(height: 18),
            ElevatedButton.icon(
              onPressed: _load,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Retry'),
              style: ElevatedButton.styleFrom(
                backgroundColor: DriverTheme.primaryBlue,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String get _initials {
    final parts = (_account?.name ?? '').trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.characters.take(2).toString().toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  Widget _buildAccount() {
    final a = _account;
    if (a == null) return const SizedBox.shrink();
    final verified = (a.kycStatus ?? '').toUpperCase() == 'VERIFIED';

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          DriverCard(
            padding: const EdgeInsets.all(20),
            borderRadius: 24,
            child: Row(
              children: [
                CircleAvatar(
                  radius: 30,
                  backgroundColor: DriverTheme.primaryBlue,
                  child: Text(_initials,
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20, color: Colors.white)),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(a.name,
                          style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: DriverTheme.textDark)),
                      const SizedBox(height: 2),
                      // The number the platform holds for this partner — which used to be a
                      // different, invented one.
                      Text(a.phone ?? 'Phone number unavailable',
                          style: const TextStyle(color: DriverTheme.textMuted, fontSize: 13)),
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 8,
                        runSpacing: 6,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: (verified ? DriverTheme.onlineGreen : DriverTheme.warningAmber)
                                  .withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  verified ? Icons.verified : Icons.pending_outlined,
                                  color: verified ? DriverTheme.onlineGreen : DriverTheme.roadGold,
                                  size: 14,
                                ),
                                const SizedBox(width: 4),
                                // Never a bare "KYC Verified": the badge used to be unconditional.
                                Text(
                                  a.kycStatus == null ? 'KYC unknown' : 'KYC ${a.kycStatus}',
                                  style: TextStyle(
                                    color: verified ? DriverTheme.onlineGreen : DriverTheme.roadGold,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 11,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          if (a.rating != null)
                            Text('⭐ ${a.rating!.toStringAsFixed(1)} rating',
                                style: const TextStyle(
                                    color: DriverTheme.roadGold, fontWeight: FontWeight.bold, fontSize: 12)),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          const Text('Working State',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: DriverTheme.textDark)),
          const SizedBox(height: 10),
          _buildInfoRow(
            icon: a.isOnline ? Icons.public : Icons.location_off,
            title: 'Availability',
            subtitle: a.isOnline
                ? 'Online on the platform${a.operationalStatus == null ? '' : ' · ${a.operationalStatus}'}'
                : 'Offline — NABIN is not offering you trips',
            color: a.isOnline ? DriverTheme.onlineGreen : DriverTheme.offlineGrey,
          ),
          _buildInfoRow(
            icon: Icons.electric_rickshaw,
            title: 'Vehicle on file',
            subtitle: a.vehicleLabel.isEmpty ? 'No vehicle recorded yet' : a.vehicleLabel,
            color: DriverTheme.primaryBlue,
            onTap: () => context.push('/kyc-registration'),
          ),
          const SizedBox(height: 24),

          const Text('Money',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: DriverTheme.textDark)),
          const SizedBox(height: 10),
          _buildInfoRow(
            icon: Icons.account_balance_wallet,
            title: 'Wallet balance',
            subtitle: a.walletBalance == null
                ? 'Balance unavailable'
                : '₹${a.walletBalance!.toStringAsFixed(2)} · ${a.tripsToday} trips in the last 24 hours',
            color: DriverTheme.onlineGreen,
            onTap: () => context.push('/earnings'),
          ),
          _buildInfoRow(
            icon: Icons.payments_outlined,
            title: 'Payout destination',
            // The verified address the platform holds, or the reason there isn't one. The
            // screen used to print a UPI id that exists in no table.
            subtitle: a.payoutDestination == null
                ? 'No verified payout address yet'
                : '${a.payoutDestination}${a.payoutVerified ? ' (verified)' : ''}',
            color: DriverTheme.primaryBlue,
            onTap: () => context.push('/earnings'),
          ),
          const SizedBox(height: 24),

          const Text('Safety & Support',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: DriverTheme.textDark)),
          const SizedBox(height: 10),
          _buildInfoRow(
            icon: Icons.help_outline,
            title: 'Driver Help & Incident Support',
            subtitle: 'Opens a ticket with the NABIN partner helpdesk',
            color: DriverTheme.primaryBlue,
            onTap: _raiseHelpTicket,
          ),
          // The "Emergency 24/7 Safety SOS" row used to be a button wired to nothing at all.
          // An SOS that silently does nothing is worse than no button, so it stays off this
          // screen until there is a real dispatch behind it (see TASKS.md).
          _buildInfoRow(
            icon: Icons.logout,
            title: 'Logout Driver Account',
            subtitle: 'Ends this session on NABIN and on this device',
            color: DriverTheme.alertRed,
            onTap: _isSigningOut ? null : _signOut,
          ),
          const SizedBox(height: 40),
        ],
      ),
    );
  }

  Widget _buildInfoRow({
    required IconData icon,
    required String title,
    required String subtitle,
    required Color color,
    VoidCallback? onTap,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      child: DriverCard(
        onTap: onTap,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: color, size: 22),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: DriverTheme.textDark)),
                  const SizedBox(height: 2),
                  Text(subtitle, style: const TextStyle(color: DriverTheme.textMuted, fontSize: 12)),
                ],
              ),
            ),
            if (onTap != null) const Icon(Icons.arrow_forward_ios, color: Color(0xFFCBD5E1), size: 14),
          ],
        ),
      ),
    );
  }
}
