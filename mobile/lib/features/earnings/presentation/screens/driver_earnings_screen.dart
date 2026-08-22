import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/driver_theme.dart';
import '../../../../core/widgets/driver_button.dart';
import '../../../../core/widgets/driver_card.dart';

class DriverEarningsScreen extends StatefulWidget {
  const DriverEarningsScreen({super.key});

  @override
  State<DriverEarningsScreen> createState() => _DriverEarningsScreenState();
}

class _DriverEarningsScreenState extends State<DriverEarningsScreen> {
  int _periodIndex = 0; // 0: Daily, 1: Weekly, 2: Monthly

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DriverTheme.bgLight,
      appBar: AppBar(
        title: const Text('Earnings & Settlements'),
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
              // Period Selector Tabs (Daily / Weekly / Monthly)
              Container(
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(
                  color: const Color(0xFFE2E8F0),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Row(
                  children: [
                    _buildPeriodBtn(0, 'Daily'),
                    _buildPeriodBtn(1, 'Weekly'),
                    _buildPeriodBtn(2, 'Monthly'),
                  ],
                ),
              ),
              const SizedBox(height: 18),

              // Main Balance Statement Card
              DriverCard(
                backgroundColor: DriverTheme.primaryBlue,
                borderColor: DriverTheme.primaryBlueDark,
                padding: const EdgeInsets.all(22),
                borderRadius: 24,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('WITHDRAWABLE BALANCE', style: TextStyle(color: DriverTheme.accentCyan, fontSize: 11, fontWeight: FontWeight.w900, letterSpacing: 1.0)),
                    const SizedBox(height: 6),
                    Text(
                      _periodIndex == 0 ? '₹1,420.00' : (_periodIndex == 1 ? '₹9,850.00' : '₹38,400.00'),
                      style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w900, color: Colors.white),
                    ),
                    const SizedBox(height: 4),
                    const Text('Direct Payout via UPI to rajesh.driver@okhdfcbank', style: TextStyle(color: Colors.white70, fontSize: 12)),
                    const SizedBox(height: 18),
                    DriverButton(
                      text: 'Instant Payout to Bank (₹0 Fee)',
                      color: DriverTheme.onlineGreen,
                      textColor: Colors.black,
                      height: 48,
                      onPressed: () {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Instant Payout initiated! Bank settlement in 10 seconds.'), backgroundColor: DriverTheme.onlineGreen),
                        );
                      },
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),

              // Income vs Cash vs Commission Breakdown
              const Text('Settlement Breakdown', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: DriverTheme.textDark)),
              const SizedBox(height: 10),
              const DriverCard(
                padding: EdgeInsets.all(16),
                child: Column(
                  children: [
                    _BreakdownRow(title: 'Gross Customer Fares', value: '₹1,620.00', isPositive: true),
                    Divider(color: DriverTheme.borderLight, height: 20),
                    _BreakdownRow(title: 'NABIN Platform Fee (10%)', value: '-₹162.00', isPositive: false),
                    Divider(color: DriverTheme.borderLight, height: 20),
                    _BreakdownRow(title: 'Cash Collected from Passengers', value: '-₹38.00', isPositive: false),
                    Divider(color: DriverTheme.borderLight, height: 20),
                    _BreakdownRow(title: 'Net Driver Wallet Payout', value: '₹1,420.00', isTotal: true),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              // Trip History Ledger
              const Text('Completed Jobs History', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: DriverTheme.textDark)),
              const SizedBox(height: 10),

              _buildHistoryItem('Passenger 3W Auto Ride', 'Civil Lines ➔ Connaught Place', '₹85.00', '11:45 AM', DriverTheme.rideBadge, Icons.person_pin_circle),
              _buildHistoryItem('Instant Parcel Delivery', 'Kamla Nagar ➔ Karol Bagh (Dual OTP)', '₹60.00', '10:15 AM', DriverTheme.parcelBadge, Icons.inventory_2),
              _buildHistoryItem('Restaurant Food Delivery', 'Dilli Darbar ➔ North Campus Hostel', '₹55.00', '09:00 AM', DriverTheme.foodBadge, Icons.restaurant),
              const SizedBox(height: 40),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPeriodBtn(int index, String label) {
    final isSelected = _periodIndex == index;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _periodIndex = index),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: isSelected ? Colors.white : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
            boxShadow: isSelected ? const [BoxShadow(color: Colors.black12, blurRadius: 4)] : null,
          ),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                fontWeight: FontWeight.w800,
                fontSize: 13,
                color: isSelected ? DriverTheme.primaryBlue : DriverTheme.textMuted,
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHistoryItem(String title, String subtitle, String fare, String time, Color badgeColor, IconData icon) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      child: DriverCard(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: badgeColor.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: badgeColor, size: 22),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: DriverTheme.textDark)),
                  const SizedBox(height: 2),
                  Text(subtitle, style: const TextStyle(color: DriverTheme.textMuted, fontSize: 11)),
                  const SizedBox(height: 2),
                  Text(time, style: const TextStyle(color: DriverTheme.textMuted, fontSize: 10)),
                ],
              ),
            ),
            Text(fare, style: const TextStyle(fontWeight: FontWeight.w900, color: DriverTheme.onlineGreen, fontSize: 16)),
          ],
        ),
      ),
    );
  }
}

class _BreakdownRow extends StatelessWidget {
  final String title;
  final String value;
  final bool isPositive;
  final bool isTotal;

  const _BreakdownRow({
    required this.title,
    required this.value,
    this.isPositive = true,
    this.isTotal = false,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          title,
          style: TextStyle(
            fontSize: isTotal ? 14 : 13,
            fontWeight: isTotal ? FontWeight.w900 : FontWeight.w600,
            color: isTotal ? DriverTheme.textDark : DriverTheme.textMuted,
          ),
        ),
        Text(
          value,
          style: TextStyle(
            fontSize: isTotal ? 16 : 13,
            fontWeight: isTotal ? FontWeight.w900 : FontWeight.bold,
            color: isTotal
                ? DriverTheme.onlineGreen
                : (isPositive ? DriverTheme.textDark : DriverTheme.alertRed),
          ),
        ),
      ],
    );
  }
}
