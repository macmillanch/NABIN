import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  double _balance = 450.00;

  void _showTopUpDialog() {
    final amounts = [100, 250, 500, 1000];
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      backgroundColor: AppTheme.surfaceContainerLowest,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Top Up Wallet', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: AppTheme.onSurface)),
                IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
              ],
            ),
            const SizedBox(height: 12),
            const Text('Select amount to instantly add via UPI / NetBanking:', style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 13)),
            const SizedBox(height: 16),
            Wrap(
              spacing: 12,
              children: amounts.map((amt) {
                return ElevatedButton(
                  onPressed: () {
                    setState(() => _balance += amt);
                    Navigator.pop(ctx);
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('₹$amt added successfully to your NABIN Wallet!')),
                    );
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.surfaceContainerLow,
                    foregroundColor: AppTheme.primary,
                    side: const BorderSide(color: AppTheme.primaryFixed),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: Text('+ ₹$amt', style: const TextStyle(fontWeight: FontWeight.w800)),
                );
              }).toList(),
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }

  void _showReceiptModal(String title, String time, String amount, String refId) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      backgroundColor: AppTheme.surfaceContainerLowest,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Transaction Receipt', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: AppTheme.onSurface)),
                IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
              ],
            ),
            const Divider(),
            const SizedBox(height: 8),
            Text(title, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: AppTheme.onSurface)),
            const SizedBox(height: 4),
            Text('Timestamp: $time', style: const TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 12)),
            Text('Reference ID: $refId', style: const TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 12)),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Amount Settled:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: AppTheme.onSurface)),
                Text(amount, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: AppTheme.primary)),
              ],
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primaryContainer,
                foregroundColor: Colors.white,
                minimumSize: const Size(double.infinity, 48),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: const Text('Done', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Text('NABIN Wallet & Pay'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppTheme.onSurface),
          onPressed: () => context.canPop() ? context.pop() : context.go('/home'),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Blue Balance Card
              Container(
                padding: const EdgeInsets.all(22),
                decoration: BoxDecoration(
                  color: AppTheme.primary,
                  borderRadius: BorderRadius.circular(24),
                  boxShadow: const [
                    BoxShadow(color: Colors.black26, blurRadius: 16, offset: Offset(0, 6)),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('TOTAL WALLET BALANCE', style: TextStyle(color: AppTheme.primaryFixed, fontSize: 11, fontWeight: FontWeight.w900, letterSpacing: 1.0)),
                    const SizedBox(height: 6),
                    Text('₹${_balance.toStringAsFixed(2)}', style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w900, color: Colors.white)),
                    const SizedBox(height: 16),
                    ElevatedButton.icon(
                      onPressed: _showTopUpDialog,
                      icon: const Icon(Icons.add, size: 18),
                      label: const Text('+ Top Up Balance'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.white,
                        foregroundColor: AppTheme.primary,
                        minimumSize: const Size(double.infinity, 44),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              const Text('Saved Payment Methods', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: AppTheme.onSurface)),
              const SizedBox(height: 12),

              _buildPaymentTile(
                'HDFC Bank Debit Card (Visa **** 8888)',
                'Primary payment method • Auto-Debit',
                Icons.credit_card,
                () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('HDFC Card set as active payment method'))),
              ),
              _buildPaymentTile(
                'UPI ID (rahul@okhdfcbank)',
                'Instant 1-Tap UPI Autopay',
                Icons.account_balance,
                () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('UPI Autopay active'))),
              ),
              const SizedBox(height: 24),

              const Text('Recent Ledger Statements', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: AppTheme.onSurface)),
              const SizedBox(height: 12),

              _buildTxnItem('Auto Ride (Civil Lines ➔ CP)', 'Today, 11:45 AM', '-₹85.00', false, 'TXN-998812'),
              _buildTxnItem('Wallet Top-Up via UPI', 'Yesterday, 04:30 PM', '+₹500.00', true, 'TXN-884719'),
              _buildTxnItem('Food Delivery (Dilli Darbar)', '12 Aug, 08:15 PM', '-₹390.00', false, 'TXN-773821'),
              const SizedBox(height: 40),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPaymentTile(String title, String subtitle, IconData icon, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppTheme.surfaceContainerLowest,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppTheme.outlineVariant),
          boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 4, offset: Offset(0, 2))],
        ),
        child: Row(
          children: [
            Icon(icon, color: AppTheme.primary, size: 22),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.onSurface)),
                  Text(subtitle, style: const TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 11)),
                ],
              ),
            ),
            const Icon(Icons.check_circle, color: Color(0xFF00C853), size: 20),
          ],
        ),
      ),
    );
  }

  Widget _buildTxnItem(String title, String time, String amount, bool isCredit, String refId) {
    return InkWell(
      onTap: () => _showReceiptModal(title, time, amount, refId),
      borderRadius: BorderRadius.circular(14),
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppTheme.surfaceContainerLowest,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppTheme.outlineVariant),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.onSurface)),
                  const SizedBox(height: 2),
                  Text(time, style: const TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 11)),
                ],
              ),
            ),
            Text(
              amount,
              style: TextStyle(
                fontWeight: FontWeight.w900,
                fontSize: 15,
                color: isCredit ? const Color(0xFF00C853) : AppTheme.onSurface,
              ),
            ),
            const SizedBox(width: 6),
            const Icon(Icons.chevron_right, size: 18, color: AppTheme.outlineVariant),
          ],
        ),
      ),
    );
  }
}
