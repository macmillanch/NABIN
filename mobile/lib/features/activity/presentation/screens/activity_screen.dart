import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';

class ActivityScreen extends StatefulWidget {
  const ActivityScreen({super.key});

  @override
  State<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityScreenState extends State<ActivityScreen> {
  int _selectedFilter = 0; // 0: All, 1: Rides, 2: Food, 3: Parcels

  final List<Map<String, dynamic>> _activities = const [
    {
      'title': 'Auto Ride to Connaught Place',
      'date': 'Today, 11:45 AM',
      'status': 'Completed',
      'statusColor': Color(0xFF00C853),
      'price': '₹85.00',
      'icon': Icons.electric_rickshaw_rounded,
      'color': AppTheme.serviceRide,
      'category': 1,
      'refId': 'TRIP-884910',
    },
    {
      'title': 'Dilli Darbar Mughlai (2 items)',
      'date': 'Yesterday, 08:30 PM',
      'status': 'Delivered',
      'statusColor': Color(0xFFFF6D00),
      'price': '₹390.00',
      'icon': Icons.restaurant_rounded,
      'color': AppTheme.tertiaryContainer,
      'category': 2,
      'refId': 'FOOD-294711',
    },
    {
      'title': 'Instant Parcel to Karol Bagh',
      'date': '12 Aug, 03:15 PM',
      'status': 'Dual-OTP Verified',
      'statusColor': Color(0xFF00897B),
      'price': '₹60.00',
      'icon': Icons.inventory_2_rounded,
      'color': AppTheme.serviceParcel,
      'category': 3,
      'refId': 'PKG-110293',
    },
  ];

  @override
  Widget build(BuildContext context) {
    final filtered = _activities.where((a) {
      if (_selectedFilter == 0) return true;
      return a['category'] == _selectedFilter;
    }).toList();

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Text('Activity & Trip History'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: AppTheme.onSurface, size: 20),
          onPressed: () => context.canPop() ? context.pop() : context.go('/home'),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Filter Chips
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    _buildFilterChip(0, 'All History'),
                    _buildFilterChip(1, 'Rides'),
                    _buildFilterChip(2, 'Food'),
                    _buildFilterChip(3, 'Parcels'),
                  ],
                ),
              ),
              const SizedBox(height: 18),

              ...filtered.map((item) {
                final statusColor = item['statusColor'] as Color;
                return InkWell(
                  onTap: () => _showActivityDetails(item),
                  borderRadius: BorderRadius.circular(20),
                  child: Container(
                    margin: const EdgeInsets.only(bottom: 12),
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: AppTheme.surfaceContainerLowest,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: AppTheme.outlineVariant.withValues(alpha: 0.6)),
                      boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 6, offset: Offset(0, 2))],
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: (item['color'] as Color).withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Icon(item['icon'] as IconData, color: item['color'] as Color, size: 24),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(item['title'] as String, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: AppTheme.onSurface)),
                              const SizedBox(height: 4),
                              Row(
                                children: [
                                  Text(item['date'] as String, style: const TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 11)),
                                  const SizedBox(width: 6),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: statusColor.withValues(alpha: 0.12),
                                      borderRadius: BorderRadius.circular(6),
                                    ),
                                    child: Text(
                                      item['status'] as String,
                                      style: TextStyle(fontSize: 9, fontWeight: FontWeight.w900, color: statusColor),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                        Text(item['price'] as String, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: AppTheme.onSurface)),
                        const SizedBox(width: 6),
                        const Icon(Icons.arrow_forward_ios_rounded, size: 14, color: AppTheme.outlineVariant),
                      ],
                    ),
                  ),
                );
              }),
              const SizedBox(height: 40),
            ],
          ),
        ),
      ),
    );
  }

  void _showActivityDetails(Map<String, dynamic> item) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
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
                Text(item['title'] as String, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: AppTheme.onSurface)),
                IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => Navigator.pop(ctx)),
              ],
            ),
            const Divider(),
            const SizedBox(height: 8),
            Text('Timestamp: ${item['date']}', style: const TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 13)),
            const SizedBox(height: 4),
            Text('Order Reference: ${item['refId']}', style: const TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 13)),
            const SizedBox(height: 4),
            const Text('Payment Mode: NABIN Wallet (Instant Settlement)', style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 13)),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Amount Settled:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: AppTheme.onSurface)),
                Text(item['price'] as String, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 20, color: AppTheme.primary)),
              ],
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primaryContainer,
                foregroundColor: Colors.white,
                minimumSize: const Size(double.infinity, 50),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              child: const Text('Close Receipt', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFilterChip(int index, String label) {
    final isSelected = _selectedFilter == index;
    return GestureDetector(
      onTap: () => setState(() => _selectedFilter = index),
      child: Container(
        margin: const EdgeInsets.only(right: 8),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected ? AppTheme.primary : AppTheme.surfaceContainerLowest,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: isSelected ? AppTheme.primary : AppTheme.outlineVariant.withValues(alpha: 0.6)),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w800,
            color: isSelected ? Colors.white : AppTheme.onSurfaceVariant,
          ),
        ),
      ),
    );
  }
}
