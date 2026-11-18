import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/restaurant_theme.dart';
import '../../../../core/network/nabin_api_service.dart';

class RestaurantOnboardingStatusScreen extends StatefulWidget {
  const RestaurantOnboardingStatusScreen({super.key});

  @override
  State<RestaurantOnboardingStatusScreen> createState() => _RestaurantOnboardingStatusScreenState();
}

class _RestaurantOnboardingStatusScreenState extends State<RestaurantOnboardingStatusScreen> {
  bool _isLoading = true;
  String? _errorMessage;

  String _trackingToken = 'NAB-REG-2024-8841';
  String _headline = 'Application In Review';
  String _subtitle = 'Our compliance team is verifying legal tax and food safety credentials for rapid dispatch readiness.';
  String _estimatedApproval = 'Under 24 hours';
  int _completionPercentage = 75;
  String _validatedTiersText = '3/4 Validated';

  Map<String, dynamic>? _statusData;

  @override
  void initState() {
    super.initState();
    _fetchOnboardingStatus();
  }

  Future<void> _fetchOnboardingStatus() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    final res = await NabinApiService.getMerchantOnboardingStatus();

    if (!mounted) return;
    setState(() {
      _isLoading = false;
      if (res != null && res['success'] == true) {
        _statusData = res;
        _trackingToken = res['trackingToken'] ?? _trackingToken;
        _headline = res['headline'] ?? _headline;
        _subtitle = res['subtitle'] ?? _subtitle;
        _estimatedApproval = res['estimatedApproval'] ?? _estimatedApproval;
        _completionPercentage = res['completionPercentage'] ?? _completionPercentage;
        _validatedTiersText = res['validatedTiersText'] ?? _validatedTiersText;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: RestaurantTheme.bgSurface,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.canPop() ? context.pop() : context.go('/dashboard'),
        ),
        title: const Row(
          children: [
            Icon(Icons.restaurant, color: RestaurantTheme.primaryBlue, size: 22),
            SizedBox(width: 8),
            Text('NABIN', style: TextStyle(fontWeight: FontWeight.w900, color: RestaurantTheme.primaryBlue, letterSpacing: -0.5)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.help_outline),
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Connecting to Merchant Helpdesk...')));
            },
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _fetchOnboardingStatus,
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: SafeArea(
        child: _isLoading
            ? const Center(child: CircularProgressIndicator())
            : SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildHeroBanner(),
                    const SizedBox(height: 16),
                    _buildCompliancePipelineCard(),
                    const SizedBox(height: 20),
                    _buildFastTrackSetupSection(),
                    const SizedBox(height: 20),
                    _buildSupportConciergeCard(),
                    const SizedBox(height: 24),
                    _buildPrimaryBottomAction(),
                    const SizedBox(height: 12),
                  ],
                ),
              ),
      ),
    );
  }

  Widget _buildHeroBanner() {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: RestaurantTheme.surfaceCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: RestaurantTheme.outlineVariant),
        boxShadow: const [
          BoxShadow(color: Color(0x06000000), blurRadius: 10, offset: Offset(0, 4)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: RestaurantTheme.neonOrange.withAlpha(25),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.fiber_manual_record, size: 10, color: RestaurantTheme.neonOrange),
                    SizedBox(width: 6),
                    Text('Fast-Track Verification', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: RestaurantTheme.neonOrange, letterSpacing: 0.5)),
                  ],
                ),
              ),
              Text(
                _trackingToken,
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, fontFamily: 'monospace', color: RestaurantTheme.textMuted),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Text(
            _headline,
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: RestaurantTheme.textDark, letterSpacing: -0.5),
          ),
          const SizedBox(height: 6),
          Text(
            _subtitle,
            style: const TextStyle(fontSize: 13, color: RestaurantTheme.textMuted, height: 1.4),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              const Icon(Icons.schedule, size: 18, color: RestaurantTheme.neonOrange),
              const SizedBox(width: 6),
              RichText(
                text: TextSpan(
                  style: const TextStyle(fontSize: 12.5, color: RestaurantTheme.textDark),
                  children: [
                    const TextSpan(text: 'Estimated approval: '),
                    TextSpan(text: _estimatedApproval, style: const TextStyle(fontWeight: FontWeight.bold, color: RestaurantTheme.neonOrange)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('OVERALL COMPLETION', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.textMuted, letterSpacing: 0.5)),
              Text('$_completionPercentage%', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: RestaurantTheme.primaryBlue)),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: _completionPercentage / 100.0,
              minHeight: 6,
              backgroundColor: RestaurantTheme.borderLight,
              valueColor: const AlwaysStoppedAnimation<Color>(RestaurantTheme.primaryBlue),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCompliancePipelineCard() {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: RestaurantTheme.surfaceCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: RestaurantTheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Compliance Pipeline', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: RestaurantTheme.textDark)),
                  SizedBox(height: 2),
                  Text('4-tier verification protocol', style: TextStyle(fontSize: 11.5, color: RestaurantTheme.textMuted)),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: RestaurantTheme.statusReadyBg,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(_validatedTiersText, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: RestaurantTheme.statusReadyGreen)),
              ),
            ],
          ),
          const Divider(height: 24),

          // Stepper Item 1: Business Profile
          _buildPipelineStepItem(
            stepNumber: 1,
            title: 'Business Profile & Contact',
            status: 'Verified',
            description: 'Legal entity, owner credentials, and primary communication hub verified.',
            isDone: true,
            isCurrent: false,
          ),
          const SizedBox(height: 16),

          // Stepper Item 2: Geolocation
          _buildPipelineStepItem(
            stepNumber: 2,
            title: 'Store Geolocation & Pin',
            status: 'Verified',
            description: 'Kitchen entry coordinates, dispatch bay, and rider pickup beacon synchronized.',
            isDone: true,
            isCurrent: false,
          ),
          const SizedBox(height: 16),

          // Stepper Item 3: Food Safety & PAN
          _buildPipelineStepItem(
            stepNumber: 3,
            title: 'Food Safety & PAN Docs',
            status: 'In Review',
            description: 'FSSAI license scan and commercial PAN document matching in progress.',
            isDone: false,
            isCurrent: true,
            badgeWidget: Container(
              margin: const EdgeInsets.only(top: 6),
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: RestaurantTheme.bgSurface,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.badge, size: 14, color: RestaurantTheme.primaryBlue),
                  SizedBox(width: 6),
                  Text('Document Officer: Sarah K. (Compliance Desk)', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.textDark)),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Stepper Item 4: Bank Account Settlement
          _buildPipelineStepItem(
            stepNumber: 4,
            title: 'Bank Account Settlement',
            status: 'Verified',
            description: 'Direct settlement routing active. Automatic penny-drop test successful.',
            isDone: true,
            isCurrent: false,
            isLast: true,
          ),
        ],
      ),
    );
  }

  Widget _buildPipelineStepItem({
    required int stepNumber,
    required String title,
    required String status,
    required String description,
    required bool isDone,
    required bool isCurrent,
    bool isLast = false,
    Widget? badgeWidget,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Column(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: isDone
                    ? RestaurantTheme.statusReadyBg
                    : (isCurrent ? RestaurantTheme.primaryBlue.withAlpha(25) : RestaurantTheme.bgSurface),
                shape: BoxShape.circle,
                border: Border.all(
                  color: isDone
                      ? RestaurantTheme.statusReadyGreen
                      : (isCurrent ? RestaurantTheme.primaryBlue : RestaurantTheme.borderLight),
                  width: 1.5,
                ),
              ),
              child: Center(
                child: isDone
                    ? const Icon(Icons.check, size: 18, color: RestaurantTheme.statusReadyGreen)
                    : (isCurrent
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2, valueColor: AlwaysStoppedAnimation<Color>(RestaurantTheme.primaryBlue)),
                          )
                        : Text('$stepNumber', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: RestaurantTheme.textMuted))),
              ),
            ),
            if (!isLast)
              Container(
                width: 2,
                height: 36,
                color: isDone ? RestaurantTheme.statusReadyGreen.withAlpha(80) : RestaurantTheme.borderLight,
              ),
          ],
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: RestaurantTheme.textDark),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: isDone
                          ? RestaurantTheme.statusReadyBg
                          : (isCurrent ? RestaurantTheme.primaryBlue.withAlpha(25) : RestaurantTheme.bgSurface),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      status,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: isDone
                            ? RestaurantTheme.statusReadyGreen
                            : (isCurrent ? RestaurantTheme.primaryBlue : RestaurantTheme.textMuted),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 2),
              Text(description, style: const TextStyle(fontSize: 11.5, color: RestaurantTheme.textMuted, height: 1.3)),
              if (badgeWidget != null) badgeWidget,
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildFastTrackSetupSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Fast-Track Setup', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: RestaurantTheme.textDark)),
                SizedBox(height: 2),
                Text('Recommended actions while verification completes', style: TextStyle(fontSize: 11.5, color: RestaurantTheme.textMuted)),
              ],
            ),
            Icon(Icons.bolt, color: RestaurantTheme.neonOrange, size: 22),
          ],
        ),
        const SizedBox(height: 12),

        // Shortcut 1: Menu Setup
        _buildShortcutTile(
          icon: Icons.restaurant_menu,
          iconColor: RestaurantTheme.primaryBlue,
          title: 'Explore Sample Menu Setup',
          tag: 'High Impact',
          subtitle: 'Configure item modifiers, photos, and prep stations',
          onTap: () => context.go('/dashboard'),
        ),
        const SizedBox(height: 10),

        // Shortcut 2: Thermal Printer
        _buildShortcutTile(
          icon: Icons.print,
          iconColor: RestaurantTheme.neonOrange,
          title: 'Pair Thermal Receipt Printer',
          tag: null,
          subtitle: 'Test Bluetooth & LAN 80mm ESC/POS hardware',
          onTap: () {
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Thermal printer discovery available in Settings.')));
          },
        ),
        const SizedBox(height: 10),

        // Shortcut 3: Kitchen Staff Guide
        _buildShortcutTile(
          icon: Icons.description,
          iconColor: RestaurantTheme.primaryBlue,
          title: 'Kitchen Staff Training Guide',
          tag: null,
          subtitle: 'PDF manual for expediter and line-cook tablet workflow',
          onTap: () {
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Downloading Kitchen SOP manual...')));
          },
        ),
      ],
    );
  }

  Widget _buildShortcutTile({
    required IconData icon,
    required Color iconColor,
    required String title,
    required String? tag,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: RestaurantTheme.surfaceCard,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: RestaurantTheme.outlineVariant),
        ),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: iconColor.withAlpha(25),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: iconColor, size: 24),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(title, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.bold, color: RestaurantTheme.textDark), overflow: TextOverflow.ellipsis),
                      ),
                      if (tag != null) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: RestaurantTheme.neonOrange.withAlpha(25),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(tag, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: RestaurantTheme.neonOrange)),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(subtitle, style: const TextStyle(fontSize: 11.5, color: RestaurantTheme.textMuted), maxLines: 1, overflow: TextOverflow.ellipsis),
                ],
              ),
            ),
            const Icon(Icons.arrow_forward_ios, size: 14, color: RestaurantTheme.textMuted),
          ],
        ),
      ),
    );
  }

  Widget _buildSupportConciergeCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: RestaurantTheme.surfaceCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: RestaurantTheme.outlineVariant),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: RestaurantTheme.primaryBlue.withAlpha(25),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.support_agent, color: RestaurantTheme.primaryBlue, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Need faster review?', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: RestaurantTheme.textDark)),
                const SizedBox(height: 2),
                const Text(
                  'Have questions regarding your documentation? Chat live with your Merchant Onboarding Specialist.',
                  style: TextStyle(fontSize: 11.5, color: RestaurantTheme.textMuted, height: 1.35),
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: RestaurantTheme.primaryBlue,
                    side: const BorderSide(color: RestaurantTheme.primaryBlue),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  ),
                  icon: const Icon(Icons.chat, size: 16),
                  label: const Text('Start Live Chat (24/7)', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                  onPressed: () {
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Starting live compliance chat session...')));
                  },
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPrimaryBottomAction() {
    return Column(
      children: [
        SizedBox(
          width: double.infinity,
          height: 52,
          child: ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: RestaurantTheme.primaryContainer,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            ),
            icon: const Icon(Icons.space_dashboard, color: Colors.white, size: 20),
            label: const Text(
              'Go to Partner Dashboard Preview',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Colors.white),
            ),
            onPressed: () => context.go('/dashboard'),
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'Live order dispatching activates immediately upon FSSAI document clearance.',
          style: TextStyle(fontSize: 11, color: RestaurantTheme.textMuted),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }
}
