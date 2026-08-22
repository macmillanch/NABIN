import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/restaurant_theme.dart';

class FoodOrderTrackingScreen extends StatefulWidget {
  final Map<String, dynamic>? orderData;

  const FoodOrderTrackingScreen({super.key, this.orderData});

  @override
  State<FoodOrderTrackingScreen> createState() => _FoodOrderTrackingScreenState();
}

class _FoodOrderTrackingScreenState extends State<FoodOrderTrackingScreen> {
  int _orderStage = 3; // Default at 3: PREPARING
  Timer? _stageTimer;

  final List<Map<String, dynamic>> _stages = const [
    {'title': 'ORDER PLACED', 'desc': 'Order transmitted to restaurant POS', 'icon': Icons.receipt_long_rounded},
    {'title': 'RESTAURANT CONFIRMING', 'desc': 'Kitchen desk reviewing order items', 'icon': Icons.sync_rounded},
    {'title': 'ORDER ACCEPTED', 'desc': 'Order accepted by head chef', 'icon': Icons.check_circle_outline_rounded},
    {'title': 'PREPARING', 'desc': 'Cooking fresh with safety standards', 'icon': Icons.soup_kitchen_rounded},
    {'title': 'READY', 'desc': 'Packed in thermal bag & sealed', 'icon': Icons.inventory_2_rounded},
    {'title': 'DRIVER ASSIGNED', 'desc': 'Deepak Kumar assigned for pickup', 'icon': Icons.person_pin_circle_rounded},
    {'title': 'PICKED UP', 'desc': 'Package collected from restaurant counter', 'icon': Icons.shopping_bag_rounded},
    {'title': 'OUT FOR DELIVERY', 'desc': 'Rider is on the way (1.2 km away)', 'icon': Icons.delivery_dining_rounded},
    {'title': 'DELIVERED', 'desc': 'Delivered warm to your doorstep', 'icon': Icons.home_rounded},
  ];

  @override
  void initState() {
    super.initState();
    // Simulate natural order progression every 15s if viewing demo
    _stageTimer = Timer.periodic(const Duration(seconds: 15), (t) {
      if (mounted && _orderStage < _stages.length - 1) {
        setState(() => _orderStage++);
      }
    });
  }

  @override
  void dispose() {
    _stageTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final orderId = widget.orderData?['orderId'] as String? ?? 'FD-88912';
    final deliveryOtp = widget.orderData?['deliveryOtp'] as String? ?? '4892';
    final restaurantName = widget.orderData?['restaurantName'] as String? ?? 'Dilli Darbar Mughlai Kitchen';
    final grandTotal = widget.orderData?['grandTotal'] as String? ?? '₹480';
    final driverName = widget.orderData?['driverName'] as String? ?? 'Deepak Kumar (TVS Auto DL 1RA 4892)';
    final deliveryAddress = widget.orderData?['deliveryAddress'] as String? ?? 'Flat 402, Civil Lines, Delhi';
    final items = widget.orderData?['items'] as List<dynamic>? ?? [];

    final currentStageInfo = _stages[_orderStage];

    return Scaffold(
      backgroundColor: RestaurantTheme.lightBg,
      appBar: AppBar(
        backgroundColor: RestaurantTheme.charcoal,
        elevation: 0,
        title: Text('Order #$orderId', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: Colors.white)),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white, size: 18),
          onPressed: () => context.go('/home'),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.support_agent_rounded, color: RestaurantTheme.neonOrange),
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Connecting to 24/7 NABIN Food Support...')),
              );
            },
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Order Success Hero Banner
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: RestaurantTheme.charcoal,
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: [
                    BoxShadow(color: RestaurantTheme.charcoal.withValues(alpha: 0.3), blurRadius: 14, offset: const Offset(0, 6)),
                  ],
                ),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: RestaurantTheme.neonOrange,
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            currentStageInfo['title'] as String,
                            style: const TextStyle(color: Colors.white, fontSize: 10.5, fontWeight: FontWeight.w900, letterSpacing: 0.5),
                          ),
                        ),
                        const Text('ETA: 18 Mins', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 13)),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(
                      currentStageInfo['desc'] as String,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Delivering to: $deliveryAddress',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                    ),
                    const SizedBox(height: 14),

                    // Delivery OTP Badge
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: RestaurantTheme.neonOrange.withValues(alpha: 0.5)),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.pin_rounded, color: RestaurantTheme.neonOrange, size: 18),
                          const SizedBox(width: 8),
                          Text(
                            'DELIVERY OTP: $deliveryOtp',
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 14, letterSpacing: 1.5),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 14),

              // 9-Stage Timeline Tracker Card
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: RestaurantTheme.white,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: RestaurantTheme.border),
                  boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 6)],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Order Timeline (9 Steps)', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: RestaurantTheme.charcoal)),
                        Text('Step ${_orderStage + 1} of 9', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: RestaurantTheme.secondaryText)),
                      ],
                    ),
                    const SizedBox(height: 14),
                    ...List.generate(_stages.length, (idx) {
                      final stage = _stages[idx];
                      return _buildTimelineStep(
                        idx,
                        stage['title'] as String,
                        stage['desc'] as String,
                        stage['icon'] as IconData,
                        isLast: idx == _stages.length - 1,
                      );
                    }),
                  ],
                ),
              ),

              const SizedBox(height: 14),

              // Driver Card
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: RestaurantTheme.white,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: RestaurantTheme.border),
                  boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 6)],
                ),
                child: Row(
                  children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        color: RestaurantTheme.neonOrange.withValues(alpha: 0.15),
                        shape: BoxShape.circle,
                      ),
                      child: const Center(
                        child: Icon(Icons.two_wheeler_rounded, color: RestaurantTheme.neonOrange, size: 24),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(driverName, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: RestaurantTheme.charcoal)),
                          const SizedBox(height: 2),
                          const Row(
                            children: [
                              Text('★ 4.90', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11, color: Color(0xFFD97706))),
                              SizedBox(width: 6),
                              Text('• 1.2 km away', style: TextStyle(fontSize: 11, color: RestaurantTheme.secondaryText)),
                            ],
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.phone_rounded, color: RestaurantTheme.vegGreen, size: 22),
                      onPressed: () {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Calling delivery partner Deepak Kumar (+91 98765 43210)...')),
                        );
                      },
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 14),

              // Order Items Summary
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: RestaurantTheme.white,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: RestaurantTheme.border),
                  boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 6)],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(restaurantName, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13.5, color: RestaurantTheme.charcoal)),
                        Text(grandTotal, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: RestaurantTheme.charcoal)),
                      ],
                    ),
                    const SizedBox(height: 8),
                    const Divider(height: 1, color: RestaurantTheme.border),
                    const SizedBox(height: 8),
                    if (items.isEmpty)
                      const Text('Special Dum Biryani × 1, Paneer Tikka × 1, Garlic Naan × 2', style: TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText))
                    else
                      ...items.map((it) {
                        final name = it['name'] ?? 'Dish';
                        final qty = it['qty'] ?? 1;
                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 2),
                          child: Text('• $name × $qty', style: const TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText)),
                        );
                      }),
                  ],
                ),
              ),

              const SizedBox(height: 20),

              // Return Home Button
              OutlinedButton(
                onPressed: () => context.go('/home'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(double.infinity, 48),
                  side: const BorderSide(color: RestaurantTheme.charcoal),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.home_rounded, color: RestaurantTheme.charcoal, size: 18),
                    SizedBox(width: 8),
                    Text('Back to NABIN Super App', style: TextStyle(fontWeight: FontWeight.bold, color: RestaurantTheme.charcoal)),
                  ],
                ),
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTimelineStep(int stepIndex, String title, String subtitle, IconData icon, {bool isLast = false}) {
    final isDone = _orderStage >= stepIndex;
    final isCurrent = _orderStage == stepIndex;

    Color badgeColor;
    Color iconColor;
    if (isCurrent) {
      badgeColor = RestaurantTheme.neonOrange;
      iconColor = Colors.white;
    } else if (isDone) {
      badgeColor = RestaurantTheme.vegGreen;
      iconColor = Colors.white;
    } else {
      badgeColor = RestaurantTheme.lightBg;
      iconColor = RestaurantTheme.secondaryText;
    }

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Column(
          children: [
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                color: badgeColor,
                shape: BoxShape.circle,
                border: Border.all(color: isDone ? Colors.transparent : RestaurantTheme.border),
              ),
              child: Icon(
                isDone && !isCurrent ? Icons.check_rounded : icon,
                color: iconColor,
                size: 14,
              ),
            ),
            if (!isLast)
              Container(
                width: 2,
                height: 22,
                color: isDone ? RestaurantTheme.vegGreen : RestaurantTheme.border,
              ),
          ],
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: TextStyle(
                  fontWeight: isCurrent ? FontWeight.w900 : (isDone ? FontWeight.bold : FontWeight.normal),
                  fontSize: 12,
                  color: isCurrent ? RestaurantTheme.neonOrange : (isDone ? RestaurantTheme.charcoal : RestaurantTheme.secondaryText),
                ),
              ),
              Text(
                subtitle,
                style: TextStyle(fontSize: 10.5, color: isCurrent ? RestaurantTheme.charcoal : RestaurantTheme.secondaryText),
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ],
    );
  }
}
