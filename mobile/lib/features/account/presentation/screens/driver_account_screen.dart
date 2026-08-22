import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/driver_theme.dart';
import '../../../../core/widgets/driver_card.dart';

class DriverAccountScreen extends StatelessWidget {
  const DriverAccountScreen({super.key});

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
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Driver Profile Header Card
              DriverCard(
                padding: const EdgeInsets.all(20),
                borderRadius: 24,
                child: Row(
                  children: [
                    const CircleAvatar(
                      radius: 30,
                      backgroundColor: DriverTheme.primaryBlue,
                      child: Text('RK', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 20, color: Colors.white)),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Rajesh Kumar', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: DriverTheme.textDark)),
                          const SizedBox(height: 2),
                          const Text('+91 98765 43210', style: TextStyle(color: DriverTheme.textMuted, fontSize: 13)),
                          const SizedBox(height: 6),
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: DriverTheme.onlineGreen.withValues(alpha: 0.15),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: const Row(
                                  children: [
                                    Icon(Icons.verified, color: DriverTheme.onlineGreen, size: 14),
                                    SizedBox(width: 4),
                                    Text('KYC Verified', style: TextStyle(color: DriverTheme.onlineGreen, fontWeight: FontWeight.bold, fontSize: 11)),
                                  ],
                                ),
                              ),
                              const SizedBox(width: 8),
                              const Text('⭐ 4.9 Rating', style: TextStyle(color: DriverTheme.roadGold, fontWeight: FontWeight.bold, fontSize: 12)),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              const Text('Vehicle & Service Management', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: DriverTheme.textDark)),
              const SizedBox(height: 10),

              _buildNavOption(
                icon: Icons.electric_rickshaw,
                title: 'Active Vehicle Profile',
                subtitle: 'Bajaj Auto 3W • DL 1RA 4892 (Change Vehicle)',
                color: DriverTheme.primaryBlue,
                onTap: () => context.push('/kyc-registration'),
              ),
              _buildNavOption(
                icon: Icons.checklist_rtl,
                title: 'Service Preferences',
                subtitle: 'Passenger Rides, Parcels & Food delivery active',
                color: DriverTheme.onlineGreen,
                onTap: () => context.go('/home'),
              ),
              _buildNavOption(
                icon: Icons.description,
                title: 'Driver Documents & KYC',
                subtitle: 'Driving Licence, RC, Commercial Insurance verified',
                color: DriverTheme.roadGold,
                onTap: () => context.push('/kyc-registration'),
              ),
              _buildNavOption(
                icon: Icons.account_balance,
                title: 'Payout Bank & UPI',
                subtitle: 'rajesh.driver@okhdfcbank (Instant Settled)',
                color: DriverTheme.primaryBlue,
                onTap: () => context.push('/earnings'),
              ),
              const SizedBox(height: 24),

              const Text('Safety & Support', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: DriverTheme.textDark)),
              const SizedBox(height: 10),

              _buildNavOption(
                icon: Icons.shield,
                title: 'Emergency 24/7 Safety SOS',
                subtitle: 'Direct telemetry line to Police & Safety desk',
                color: DriverTheme.alertRed,
                onTap: () {},
              ),
              _buildNavOption(
                icon: Icons.help_outline,
                title: 'Driver Help & Incident Support',
                subtitle: '24/7 dedicated partner helpline',
                color: DriverTheme.primaryBlue,
                onTap: () {},
              ),
              _buildNavOption(
                icon: Icons.logout,
                title: 'Logout Driver Account',
                subtitle: 'Sign out of this device',
                color: DriverTheme.alertRed,
                onTap: () => context.go('/login'),
              ),
              const SizedBox(height: 40),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildNavOption({
    required IconData icon,
    required String title,
    required String subtitle,
    required Color color,
    required VoidCallback onTap,
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
            const Icon(Icons.arrow_forward_ios, color: Color(0xFFCBD5E1), size: 14),
          ],
        ),
      ),
    );
  }
}
