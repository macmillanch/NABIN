import 'package:flutter/material.dart';
import '../../../../core/theme/restaurant_theme.dart';
import '../../../../core/network/nabin_api_service.dart';

class RestaurantMenuOperationsSheet {
  /// RM-027: Menu Categories Management Modal
  static void showCategoriesSheet(BuildContext context) {
    final categories = [
      {'name': 'Momos & Tibetan Delicacies', 'items': 14, 'station': 'Wok & Steam Station', 'isActive': true},
      {'name': 'Biryani & Pulao Bowls', 'items': 12, 'station': 'Main Curry & Rice', 'isActive': true},
      {'name': 'Tandoori Kebabs & Breads', 'items': 18, 'station': 'Grill & Tandoor Station', 'isActive': true},
      {'name': 'Claypot Curries & Gravies', 'items': 16, 'station': 'Main Curry Station', 'isActive': true},
      {'name': 'Artisanal Beverages & Lassi', 'items': 8, 'station': 'Cold Prep & Barista', 'isActive': false},
    ];

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return Container(
              constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.8),
              decoration: const BoxDecoration(
                color: RestaurantTheme.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
              ),
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: RestaurantTheme.border, borderRadius: BorderRadius.circular(2)))),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Row(
                        children: [
                          Icon(Icons.category, color: RestaurantTheme.primaryBlue, size: 22),
                          SizedBox(width: 8),
                          Text('Menu Categories (RM-027)', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                        ],
                      ),
                      IconButton(
                        icon: const Icon(Icons.add_circle, color: RestaurantTheme.primaryBlue),
                        onPressed: () {
                          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Add Category dialog.')));
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  const Text('Organize categories, reorder tabs, and assign preparation stations.', style: TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText)),
                  const Divider(height: 20),

                  Expanded(
                    child: ListView.separated(
                      itemCount: categories.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 10),
                      itemBuilder: (context, idx) {
                        final cat = categories[idx];
                        final isLive = cat['isActive'] == true;
                        return Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: RestaurantTheme.lightBg,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: RestaurantTheme.border),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.drag_indicator, color: RestaurantTheme.secondaryText, size: 20),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Expanded(
                                          child: Text(cat['name'] as String, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: RestaurantTheme.charcoal), overflow: TextOverflow.ellipsis),
                                        ),
                                        const SizedBox(width: 6),
                                        Text('${cat['items']} Items', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.primaryBlue)),
                                      ],
                                    ),
                                    const SizedBox(height: 2),
                                    Text('Station: ${cat['station']}', style: const TextStyle(fontSize: 11, color: RestaurantTheme.secondaryText)),
                                  ],
                                ),
                              ),
                              const SizedBox(width: 8),
                              Switch(
                                value: isLive,
                                activeColor: RestaurantTheme.statusReadyGreen,
                                onChanged: (val) {
                                  setSheetState(() => cat['isActive'] = val);
                                },
                              ),
                            ],
                          ),
                        );
                      },
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  /// RM-031: Dish Customization Management Modal (Portion Sizes & Add-on Groups)
  static void showCustomizationsSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return Container(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.8),
          decoration: const BoxDecoration(
            color: RestaurantTheme.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: RestaurantTheme.border, borderRadius: BorderRadius.circular(2)))),
              const SizedBox(height: 16),
              const Row(
                children: [
                  Icon(Icons.tune, color: RestaurantTheme.primaryBlue, size: 22),
                  SizedBox(width: 8),
                  Text('Customizations (RM-031)', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                ],
              ),
              const SizedBox(height: 4),
              const Text('Manage portion size tiers and modifier add-on groups.', style: TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText)),
              const Divider(height: 20),

              Expanded(
                child: ListView(
                  children: [
                    // Group 1: Portion Size
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: RestaurantTheme.lightBg,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: RestaurantTheme.border),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Expanded(
                                child: Text(
                                  '1. Portion Size (Required)',
                                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(color: RestaurantTheme.neonOrange.withAlpha(25), borderRadius: BorderRadius.circular(6)),
                                child: const Text('Single Choice', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: RestaurantTheme.neonOrange)),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          _buildOptionRow('Half (6 pcs)', '₹140', true),
                          const Divider(height: 14),
                          _buildOptionRow('Full (10 pcs) - Default', '₹220', true),
                          const Divider(height: 14),
                          _buildOptionRow('Jumbo (16 pcs)', '₹320', true),
                        ],
                      ),
                    ),
                    const SizedBox(height: 14),

                    // Group 2: Dips & Chutney Add-ons
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: RestaurantTheme.lightBg,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: RestaurantTheme.border),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Expanded(
                                child: Text(
                                  '2. Extra Chutney & Dips (Optional)',
                                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(color: RestaurantTheme.primaryBlue.withAlpha(20), borderRadius: BorderRadius.circular(6)),
                                child: const Text('Multi-Select', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: RestaurantTheme.primaryBlue)),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          _buildOptionRow('Fiery Timur Chili Dip', '₹30', true),
                          const Divider(height: 14),
                          _buildOptionRow('Sesame Tomato Paste', '₹25', true),
                          const Divider(height: 14),
                          _buildOptionRow('Extra Raita Portion', '₹40', false), // 86'd out
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  static Widget _buildOptionRow(String title, String price, bool inStock) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: RestaurantTheme.charcoal)),
            Text(price, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: RestaurantTheme.primaryBlue)),
          ],
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: inStock ? RestaurantTheme.statusReadyBg : RestaurantTheme.nonVegRed.withAlpha(20),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(inStock ? 'In Stock' : '86\'d Out', style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.bold, color: inStock ? RestaurantTheme.statusReadyGreen : RestaurantTheme.nonVegRed)),
        ),
      ],
    );
  }

  /// RM-032: Menu Availability & Scheduling Modal (Daypart Shifts)
  static void showMenuSchedulingSheet(BuildContext context) {
    final shifts = [
      {'name': 'Breakfast Express', 'time': '07:30 - 11:00 • 18 Items', 'status': 'Pre-load Active', 'isActive': false},
      {'name': 'Lunch Feast & Thalis', 'time': '11:30 - 16:00 • 42 Items', 'status': 'Ended (148 tickets served)', 'isActive': false},
      {'name': 'Dinner Line & Tandoor', 'time': '18:00 - 23:00 • 54 Items', 'status': 'LIVE NOW • Peak rush', 'isActive': true},
    ];

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return Container(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.75),
          decoration: const BoxDecoration(
            color: RestaurantTheme.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: RestaurantTheme.border, borderRadius: BorderRadius.circular(2)))),
              const SizedBox(height: 16),
              const Row(
                children: [
                  Icon(Icons.schedule, color: RestaurantTheme.primaryBlue, size: 22),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Menu Shifts & Scheduling (RM-032)',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              const Text('Automated meal dayparts switch active menu categories on schedule.', style: TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText)),
              const Divider(height: 20),

              Expanded(
                child: ListView.separated(
                  itemCount: shifts.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (context, idx) {
                    final shift = shifts[idx];
                    final isLive = shift['isActive'] == true;
                    return Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: isLive ? RestaurantTheme.primaryBlue.withAlpha(12) : RestaurantTheme.lightBg,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: isLive ? RestaurantTheme.primaryBlue : RestaurantTheme.border, width: isLive ? 1.5 : 1),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(shift['name'] as String, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: RestaurantTheme.charcoal)),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: isLive ? RestaurantTheme.statusReadyBg : RestaurantTheme.border,
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text(isLive ? 'LIVE' : 'Scheduled', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: isLive ? RestaurantTheme.statusReadyGreen : RestaurantTheme.secondaryText)),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(shift['time'] as String, style: const TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText)),
                          const SizedBox(height: 4),
                          Text(shift['status'] as String, style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: isLive ? RestaurantTheme.primaryBlue : RestaurantTheme.secondaryText)),
                        ],
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  /// RM-033: Bulk Menu Management Modal (Instant 86'd Staples, ±% Pricing)
  static void showBulkMenuSheet(BuildContext context, {required List<Map<String, dynamic>> dishes, VoidCallback? onRefreshed}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return Container(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.8),
          decoration: const BoxDecoration(
            color: RestaurantTheme.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: RestaurantTheme.border, borderRadius: BorderRadius.circular(2)))),
              const SizedBox(height: 16),
              const Row(
                children: [
                  Icon(Icons.bolt, color: RestaurantTheme.neonOrange, size: 24),
                  SizedBox(width: 8),
                  Text('Bulk Operations (RM-033)', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                ],
              ),
              const SizedBox(height: 4),
              const Text('Instant staple stockouts and mass price adjustments.', style: TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText)),
              const Divider(height: 20),

              // Emergency Freeze Staples
              const Text('INSTANT 86\'D EMERGENCY STAPLES', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.neonOrange, letterSpacing: 0.5)),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _buildEmergencyStapleButton(ctx, 'Out of Paneer', 'Auto-freezes 7 items', () async {
                    Navigator.pop(ctx);
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Paneer dishes 86\'d in bulk.')));
                  }),
                  _buildEmergencyStapleButton(ctx, 'Out of Biryani Rice', 'Auto-freezes 4 items', () async {
                    Navigator.pop(ctx);
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Rice items 86\'d in bulk.')));
                  }),
                  _buildEmergencyStapleButton(ctx, 'Tandoor Dough / LPG', 'Auto-freezes all Naans', () async {
                    Navigator.pop(ctx);
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Tandoor breads 86\'d in bulk.')));
                  }),
                ],
              ),
              const SizedBox(height: 20),

              // Bulk Price Adjust
              const Text('MASS PRICE ADJUSTMENT (±%)', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.secondaryText, letterSpacing: 0.5)),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 12)),
                      onPressed: () async {
                        Navigator.pop(ctx);
                        final ids = dishes.map((d) => d['id'] as String).toList();
                        await NabinApiService.bulkAdjustDishPricing(dishIds: ids, percentageChange: 10);
                        if (onRefreshed != null) onRefreshed();
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('All menu items adjusted by +10%.')));
                      },
                      child: const Text('+10% Holiday Markup'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 12)),
                      onPressed: () async {
                        Navigator.pop(ctx);
                        final ids = dishes.map((d) => d['id'] as String).toList();
                        await NabinApiService.bulkAdjustDishPricing(dishIds: ids, percentageChange: -10);
                        if (onRefreshed != null) onRefreshed();
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('All menu items discounted by -10%.')));
                      },
                      child: const Text('-10% Promo Discount'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  static Widget _buildEmergencyStapleButton(BuildContext context, String title, String subtitle, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: RestaurantTheme.lightBg,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: RestaurantTheme.neonOrange.withAlpha(60)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.bolt, color: RestaurantTheme.neonOrange, size: 16),
                const SizedBox(width: 4),
                Text(title, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold, color: RestaurantTheme.charcoal)),
              ],
            ),
            Text(subtitle, style: const TextStyle(fontSize: 10, color: RestaurantTheme.secondaryText)),
          ],
        ),
      ),
    );
  }
}
