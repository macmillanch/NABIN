import 'dart:async';
import 'package:flutter/material.dart';
import '../theme/grocery_theme.dart';

class GroceryDealsScreen extends StatefulWidget {
  final Function(String itemTitle)? onAddToCart;

  const GroceryDealsScreen({super.key, this.onAddToCart});

  @override
  State<GroceryDealsScreen> createState() => _GroceryDealsScreenState();
}

class _GroceryDealsScreenState extends State<GroceryDealsScreen> {
  late Timer _timer;
  int _secondsLeft = 14250; // 3 hrs 57 mins countdown

  final List<Map<String, dynamic>> _coupons = const [
    {
      'code': 'M3FRESH',
      'title': 'Flat 40% OFF on Fruits & Vegetables',
      'minOrder': 'Min Order ₹199',
      'colors': [Color(0xFF047857), Color(0xFF10B981)],
      'icon': Icons.eco_rounded,
    },
    {
      'code': 'M3SUPER50',
      'title': 'Flat ₹50 Instant Cashback via UPI',
      'minOrder': 'Min Order ₹299',
      'colors': [Color(0xFF0052CC), Color(0xFF0747A6)],
      'icon': Icons.account_balance_wallet_rounded,
    },
    {
      'code': 'M3SNACKS',
      'title': 'BUY 2 GET 1 FREE on Snacks & Beverages',
      'minOrder': 'Min Order ₹149',
      'colors': [Color(0xFFFF6D00), Color(0xFFEA580C)],
      'icon': Icons.fastfood_rounded,
    },
  ];

  final List<Map<String, dynamic>> _flashDeals = const [
    {
      'id': 'deal_1',
      'name': 'Farm Fresh Avocado (Imported)',
      'weight': '1 pc (approx 200g)',
      'price': 79,
      'mrp': 149,
      'discount': '47% OFF',
      'emoji': '🥑',
      'bgColor': Color(0xFFDCFCE7),
    },
    {
      'id': 'deal_2',
      'name': 'Exotic Blueberries Pack',
      'weight': '125g Punnet',
      'price': 129,
      'mrp': 225,
      'discount': '42% OFF',
      'emoji': '🫐',
      'bgColor': Color(0xFFE0F2FE),
    },
    {
      'id': 'deal_3',
      'name': 'Premium Greek Yogurt (Mango)',
      'weight': '85g Cup',
      'price': 35,
      'mrp': 50,
      'discount': '30% OFF',
      'emoji': '🍧',
      'bgColor': Color(0xFFFEF9C3),
    },
    {
      'id': 'deal_4',
      'name': 'Organic Cold Pressed Coconut Water',
      'weight': '200ml Bottle',
      'price': 45,
      'mrp': 70,
      'discount': '35% OFF',
      'emoji': '🥥',
      'bgColor': Color(0xFFFFF7ED),
    },
  ];

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) return;
      setState(() {
        if (_secondsLeft > 0) _secondsLeft--;
      });
    });
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  String _formatTimer(int totalSeconds) {
    final hours = (totalSeconds ~/ 3600).toString().padLeft(2, '0');
    final minutes = ((totalSeconds % 3600) ~/ 60).toString().padLeft(2, '0');
    final seconds = (totalSeconds % 60).toString().padLeft(2, '0');
    return '$hours:$minutes:$seconds';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: GroceryTheme.bgOffWhite,
      appBar: AppBar(
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Super Saver Deals', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: GroceryTheme.textDark)),
            Text('⚡ Lightning Deals & Promo Coupons', style: TextStyle(fontSize: 11, color: GroceryTheme.textMuted)),
          ],
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Flash Timer Card Header
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFFF43F5E), Color(0xFFE11D48)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(22),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFFF43F5E).withValues(alpha: 0.3),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.25),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: const Text('🔥 FLASH SALE ENDS IN', style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w900, color: Colors.white)),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          _formatTimer(_secondsLeft),
                          style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: 2),
                        ),
                        const SizedBox(height: 4),
                        const Text('Up to 50% OFF on 200+ Grocery items!', style: TextStyle(color: Colors.white70, fontSize: 12)),
                      ],
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.2),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.bolt_rounded, size: 40, color: Colors.amberAccent),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 20),

            // Active Coupons Header
            const Text('Active Promo Coupons', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: GroceryTheme.textDark)),
            const SizedBox(height: 10),

            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: _coupons.map((c) {
                  final colors = c['colors'] as List<Color>;
                  return Container(
                    width: 240,
                    margin: const EdgeInsets.only(right: 12),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(colors: colors),
                      borderRadius: BorderRadius.circular(18),
                      boxShadow: [
                        BoxShadow(color: colors[0].withValues(alpha: 0.25), blurRadius: 8, offset: const Offset(0, 3)),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(
                                c['code'] as String,
                                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: colors[0]),
                              ),
                            ),
                            Icon(c['icon'] as IconData, color: Colors.white, size: 20),
                          ],
                        ),
                        const SizedBox(height: 10),
                        Text(c['title'] as String, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: Colors.white)),
                        const SizedBox(height: 4),
                        Text(c['minOrder'] as String, style: const TextStyle(fontSize: 10.5, color: Colors.white70)),
                      ],
                    ),
                  );
                }).toList(),
              ),
            ),

            const SizedBox(height: 22),

            // Daily Price Drop Grid Header
            const Text('Daily Price Drop Deals', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: GroceryTheme.textDark)),
            const SizedBox(height: 12),

            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                childAspectRatio: 0.75,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
              ),
              itemCount: _flashDeals.length,
              itemBuilder: (ctx, idx) {
                final d = _flashDeals[idx];
                return Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: GroceryTheme.borderLight),
                    boxShadow: [
                      BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 8, offset: const Offset(0, 3)),
                    ],
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Emoji & Discount Tag
                      Stack(
                        children: [
                          Container(
                            height: 85,
                            width: double.infinity,
                            decoration: BoxDecoration(
                              color: d['bgColor'] as Color,
                              borderRadius: BorderRadius.circular(14),
                            ),
                            child: Center(
                              child: Text(d['emoji'] as String, style: const TextStyle(fontSize: 44)),
                            ),
                          ),
                          Positioned(
                            top: 6,
                            left: 6,
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: GroceryTheme.accentRose,
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                d['discount'] as String,
                                style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w900, color: Colors.white),
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),

                      Text(
                        d['name'] as String,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: GroceryTheme.textDark),
                      ),
                      Text(d['weight'] as String, style: const TextStyle(fontSize: 11, color: GroceryTheme.textMuted)),
                      const Spacer(),

                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('₹${d['price']}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: GroceryTheme.textDark)),
                              Text('MRP ₹${d['mrp']}', style: const TextStyle(fontSize: 10, color: GroceryTheme.textMuted, decoration: TextDecoration.lineThrough)),
                            ],
                          ),
                          ElevatedButton(
                            onPressed: () {
                              widget.onAddToCart?.call(d['name'] as String);
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text('Added ${d['name']} to Grocery Cart!'), backgroundColor: GroceryTheme.primaryGreenDark),
                              );
                            },
                            style: ElevatedButton.styleFrom(
                              backgroundColor: GroceryTheme.primaryGreenDark,
                              foregroundColor: Colors.white,
                              minimumSize: const Size(54, 32),
                              padding: const EdgeInsets.symmetric(horizontal: 10),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            ),
                            child: const Text('ADD', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w900)),
                          ),
                        ],
                      ),
                    ],
                  ),
                );
              },
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}
