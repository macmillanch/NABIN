import 'package:flutter/material.dart';
import '../theme/grocery_theme.dart';

class GroceryAccountScreen extends StatelessWidget {
  const GroceryAccountScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: GroceryTheme.bgOffWhite,
      appBar: AppBar(
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Account & Express Orders', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: GroceryTheme.textDark)),
            Text('⚡ M3 Standalone Grocery Profile', style: TextStyle(fontSize: 11, color: GroceryTheme.textMuted)),
          ],
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // User Header Card
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: GroceryTheme.borderLight),
                boxShadow: [
                  BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 8, offset: const Offset(0, 3)),
                ],
              ),
              child: Row(
                children: [
                  Container(
                    width: 54,
                    height: 54,
                    decoration: const BoxDecoration(
                      color: GroceryTheme.primaryGreenLight,
                      shape: BoxShape.circle,
                    ),
                    child: const Center(
                      child: Text('RS', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: GroceryTheme.primaryGreenDark)),
                    ),
                  ),
                  const SizedBox(width: 14),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text('Rahul Sharma', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: GroceryTheme.textDark)),
                            SizedBox(width: 6),
                            Icon(Icons.verified_rounded, color: GroceryTheme.primaryGreenDark, size: 16),
                          ],
                        ),
                        SizedBox(height: 2),
                        Text('+91 98765 43210 • rahul.sharma@example.com', style: TextStyle(fontSize: 11.5, color: GroceryTheme.textMuted)),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 14),

            // Wallet & Quick Cash Pill
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [GroceryTheme.primaryGreenDark, GroceryTheme.primaryGreen],
                ),
                borderRadius: BorderRadius.circular(18),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.account_balance_wallet_rounded, color: Colors.white, size: 22),
                      SizedBox(width: 10),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('M3 GROCERY WALLET', style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w900, color: Colors.white70)),
                          Text('₹450.00', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: Colors.white)),
                        ],
                      ),
                    ],
                  ),
                  ElevatedButton(
                    onPressed: () {
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Added ₹500 to Grocery Wallet!')));
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.white,
                      foregroundColor: GroceryTheme.primaryGreenDark,
                      minimumSize: const Size(80, 34),
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    child: const Text('+ Add Cash', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 11.5)),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 20),

            // Recent 10-Minute Orders
            const Text('Recent Express Orders', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: GroceryTheme.textDark)),
            const SizedBox(height: 10),

            _buildOrderCard(
              orderId: 'M3-882910',
              date: 'Today, 10:14 AM',
              items: 'Bananas (500g), Amul Milk (1L), Vine Tomatoes (500g)',
              amount: '₹141',
              status: 'Delivered in 8 mins',
              statusColor: GroceryTheme.primaryGreenDark,
              onReorder: () {
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Re-ordered items to cart!')));
              },
            ),
            const SizedBox(height: 10),
            _buildOrderCard(
              orderId: 'M3-881942',
              date: 'Yesterday, 07:45 PM',
              items: 'Lays Chips (2x), Cold Pressed Orange Juice (1x)',
              amount: '₹125',
              status: 'Delivered in 9 mins',
              statusColor: GroceryTheme.primaryGreenDark,
              onReorder: () {
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Re-ordered items to cart!')));
              },
            ),

            const SizedBox(height: 20),

            // Account Settings Menu
            const Text('Preferences & Support', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: GroceryTheme.textDark)),
            const SizedBox(height: 10),

            _buildTile(Icons.location_on_outlined, 'Saved Delivery Addresses', 'Civil Lines, Connaught Place', () {}),
            _buildTile(Icons.payment_rounded, 'Saved Payment Methods', 'UPI, HDFC Visa Card **** 8888', () {}),
            _buildTile(Icons.support_agent_rounded, '24/7 M3 Express Support', 'Chat with live support agent', () {
              showModalBottomSheet(
                context: context,
                shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
                builder: (ctx) => Padding(
                  padding: const EdgeInsets.all(22),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Row(
                        children: [
                          Icon(Icons.headset_mic_rounded, color: GroceryTheme.primaryGreenDark, size: 24),
                          SizedBox(width: 8),
                          Text('M3 Grocery Live Support', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
                        ],
                      ),
                      const SizedBox(height: 12),
                      const Text('Our 10-Minute Express support team is active 24/7 to resolve missing items or delivery queries instantly.', style: TextStyle(fontSize: 13, color: GroceryTheme.textMuted, height: 1.4)),
                      const SizedBox(height: 20),
                      ElevatedButton(
                        onPressed: () => Navigator.pop(ctx),
                        style: ElevatedButton.styleFrom(backgroundColor: GroceryTheme.primaryGreenDark),
                        child: const Text('Start Live Chat'),
                      ),
                    ],
                  ),
                ),
              );
            }),
            _buildTile(Icons.info_outline_rounded, 'About M3 Grocery Express', 'Version 2.4.0 • Standalone Quick Commerce App', () {}),

            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _buildOrderCard({
    required String orderId,
    required String date,
    required String items,
    required String amount,
    required String status,
    required Color statusColor,
    required VoidCallback onReorder,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: GroceryTheme.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(orderId, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13.5, color: GroceryTheme.textDark)),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(status, style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w900, color: statusColor)),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(date, style: const TextStyle(fontSize: 11, color: GroceryTheme.textMuted)),
          const SizedBox(height: 6),
          Text(items, style: const TextStyle(fontSize: 12, color: GroceryTheme.textDark), maxLines: 2, overflow: TextOverflow.ellipsis),
          const Divider(height: 18),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Amount: $amount', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13.5, color: GroceryTheme.textDark)),
              OutlinedButton(
                onPressed: onReorder,
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  minimumSize: const Size(60, 30),
                  side: const BorderSide(color: GroceryTheme.primaryGreenDark),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                child: const Text('Reorder', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: GroceryTheme.primaryGreenDark)),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildTile(IconData icon, String title, String subtitle, VoidCallback onTap) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: const BorderSide(color: GroceryTheme.borderLight),
        ),
        tileColor: Colors.white,
        leading: Icon(icon, color: GroceryTheme.primaryGreenDark, size: 22),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: GroceryTheme.textDark)),
        subtitle: Text(subtitle, style: const TextStyle(fontSize: 11, color: GroceryTheme.textMuted)),
        trailing: const Icon(Icons.arrow_forward_ios_rounded, size: 14, color: GroceryTheme.textMuted),
      ),
    );
  }
}
