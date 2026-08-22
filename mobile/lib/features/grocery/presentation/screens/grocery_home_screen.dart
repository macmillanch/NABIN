import 'dart:async';
import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../widgets/grocery_product_detail_modal.dart';

class GroceryHomeScreen extends StatefulWidget {
  const GroceryHomeScreen({super.key});

  @override
  State<GroceryHomeScreen> createState() => _GroceryHomeScreenState();
}

class _GroceryHomeScreenState extends State<GroceryHomeScreen> {
  int _selectedCategory = 0;
  String _searchQuery = '';
  int _currentBannerIndex = 0;
  late final PageController _bannerController;
  Timer? _bannerTimer;

  // Cart state: map of itemId -> quantity
  final Map<String, int> _cart = {};

  final List<String> _categories = [
    'All',
    '🥬 Veggies & Fruits',
    '🥛 Milk & Dairy',
    '🍿 Snacks & Chips',
    '🥤 Drinks & Juices',
    '🍞 Bakery & Eggs',
    '🧼 Cleaning & Care',
  ];

  final List<Map<String, dynamic>> _promoBanners = const [
    {
      'title': 'NABIN FRESH HARVEST',
      'subtitle': 'Flat 40% OFF on Farm Fresh Veggies & Fruits',
      'code': 'USE: NABINFRESH',
      'colors': [Color(0xFF22A447), Color(0xFF16A34A)],
      'icon': Icons.eco_rounded,
      'tag': '⚡ 10 MIN DELIVERY',
    },
    {
      'title': 'NABIN MORNING ESSENTIALS',
      'subtitle': 'Guaranteed 6 AM fresh milk, eggs & artisan bread',
      'code': 'FREE DELIVERY',
      'colors': [Color(0xFF3C4890), Color(0xFF28316B)],
      'icon': Icons.local_drink_rounded,
      'tag': 'DAILY FRESH',
    },
    {
      'title': 'NABIN PARTY SNACK FEST',
      'subtitle': 'Buy 2 Get 1 FREE on premium chips & chilled sodas',
      'code': 'USE: NABINSNACKS',
      'colors': [Color(0xFFFF9030), Color(0xFFEA580C)],
      'icon': Icons.fastfood_rounded,
      'tag': 'SUPER SAVER',
    },
  ];

  final List<Map<String, dynamic>> _products = const [
    {
      'id': 'm3_1',
      'name': 'Fresh Organic Bananas',
      'category': 'Veggies & Fruits',
      'weight': '500g (4-6 pcs)',
      'price': 35,
      'mrp': 50,
      'rating': '4.9 ★',
      'isOrganic': true,
      'imageUrl': 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=400&q=80',
      'emoji': '🍌',
      'imageColor': Color(0xFFFEF9C3),
    },
    {
      'id': 'm3_2',
      'name': 'Vine-Ripened Farm Tomatoes',
      'category': 'Veggies & Fruits',
      'weight': '500g',
      'price': 25,
      'mrp': 40,
      'rating': '4.8 ★',
      'isOrganic': true,
      'imageUrl': 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=400&q=80',
      'emoji': '🍅',
      'imageColor': Color(0xFFFEE2E2),
    },
    {
      'id': 'm3_3',
      'name': 'Amul Taaza Fresh Toned Milk',
      'category': 'Milk & Dairy',
      'weight': '1000 ml (1L Pouch)',
      'price': 56,
      'mrp': 60,
      'rating': '4.9 ★',
      'isOrganic': false,
      'imageUrl': 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=400&q=80',
      'emoji': '🥛',
      'imageColor': Color(0xFFE0F2FE),
    },
    {
      'id': 'm3_4',
      'name': 'Fresh Malai Paneer Block',
      'category': 'Milk & Dairy',
      'weight': '200g Fresh Pack',
      'price': 85,
      'mrp': 105,
      'rating': '4.9 ★',
      'isOrganic': true,
      'imageUrl': 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=400&q=80',
      'emoji': '🧀',
      'imageColor': Color(0xFFF1F5F9),
    },
    {
      'id': 'm3_5',
      'name': 'Farm Fresh Country Eggs',
      'category': 'Bakery & Eggs',
      'weight': '6 pcs Tray',
      'price': 48,
      'mrp': 60,
      'rating': '4.8 ★',
      'isOrganic': true,
      'imageUrl': 'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=400&q=80',
      'emoji': '🥚',
      'imageColor': Color(0xFFFEF3C7),
    },
    {
      'id': 'm3_6',
      'name': 'Lay\'s Classic Salted Potato Chips',
      'category': 'Snacks & Chips',
      'weight': '90g Party Pack',
      'price': 30,
      'mrp': 30,
      'rating': '4.9 ★',
      'isOrganic': false,
      'imageUrl': 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=400&q=80',
      'emoji': '🥔',
      'imageColor': Color(0xFFFFEDD5),
    },
    {
      'id': 'm3_7',
      'name': 'Coca-Cola Chilled Refreshment',
      'category': 'Drinks & Juices',
      'weight': '300 ml Can',
      'price': 40,
      'mrp': 45,
      'rating': '4.7 ★',
      'isOrganic': false,
      'imageUrl': 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=400&q=80',
      'emoji': '🥤',
      'imageColor': Color(0xFFFFE4E6),
    },
    {
      'id': 'm3_8',
      'name': '100% Whole Wheat Artisan Bread',
      'category': 'Bakery & Eggs',
      'weight': '400g Sliced Pack',
      'price': 45,
      'mrp': 55,
      'rating': '4.8 ★',
      'isOrganic': true,
      'imageUrl': 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400&q=80',
      'emoji': '🍞',
      'imageColor': Color(0xFFF5EBE0),
    },
    {
      'id': 'm3_9',
      'name': 'Royal Gala Crisp Red Apples',
      'category': 'Veggies & Fruits',
      'weight': '4 pcs Pack (approx 600g)',
      'price': 110,
      'mrp': 140,
      'rating': '4.9 ★',
      'isOrganic': true,
      'imageUrl': 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=400&q=80',
      'emoji': '🍎',
      'imageColor': Color(0xFFFEE2E2),
    },
    {
      'id': 'm3_10',
      'name': 'Tropicana 100% Real Orange Juice',
      'category': 'Drinks & Juices',
      'weight': '1000 ml Tetra Pack',
      'price': 115,
      'mrp': 135,
      'rating': '4.8 ★',
      'isOrganic': false,
      'imageUrl': 'https://images.unsplash.com/photo-1613478223719-2ab802602423?w=400&q=80',
      'emoji': '🍊',
      'imageColor': Color(0xFFFFEDD5),
    },
    {
      'id': 'm3_11',
      'name': 'Dettol Original Germ Protection Wash',
      'category': 'Cleaning & Care',
      'weight': '250 ml Pump Bottle',
      'price': 89,
      'mrp': 99,
      'rating': '4.9 ★',
      'isOrganic': false,
      'imageUrl': 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80',
      'emoji': '🧴',
      'imageColor': Color(0xFFDCFCE7),
    },
    {
      'id': 'm3_12',
      'name': 'Cadbury Dairy Milk Silk Chocolate',
      'category': 'Snacks & Chips',
      'weight': '150g Bar',
      'price': 165,
      'mrp': 180,
      'rating': '5.0 ★',
      'isOrganic': false,
      'imageUrl': 'https://images.unsplash.com/photo-1548907040-4baa42d10919?w=400&q=80',
      'emoji': '🍫',
      'imageColor': Color(0xFFF3E8FF),
    },
  ];

  @override
  void initState() {
    super.initState();
    _bannerController = PageController();
    _bannerTimer = Timer.periodic(const Duration(seconds: 4), (timer) {
      if (_bannerController.hasClients) {
        final nextPage = (_currentBannerIndex + 1) % _promoBanners.length;
        _bannerController.animateToPage(
          nextPage,
          duration: const Duration(milliseconds: 350),
          curve: Curves.easeInOut,
        );
      }
    });
  }

  @override
  void dispose() {
    _bannerTimer?.cancel();
    _bannerController.dispose();
    super.dispose();
  }

  int get _totalCartItems => _cart.values.fold(0, (sum, count) => sum + count);

  int get _totalCartPrice {
    int sum = 0;
    _cart.forEach((id, qty) {
      final product = _products.firstWhere((p) => p['id'] == id, orElse: () => _products[0]);
      sum += (product['price'] as int) * qty;
    });
    return sum;
  }

  void _showCartSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: const Color(0xFF10B981),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Text('M3', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: Colors.white)),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'Your Grocery Cart ($_totalCartItems)',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppTheme.onSurface),
                      ),
                    ],
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: const Color(0xFFD1FAE5),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.bolt_rounded, size: 14, color: Color(0xFF047857)),
                        Text('10 MINS', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: Color(0xFF047857))),
                      ],
                    ),
                  ),
                ],
              ),
              const Divider(height: 24),

              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 220),
                child: ListView(
                  shrinkWrap: true,
                  children: _cart.entries.map((e) {
                    final item = _products.firstWhere((p) => p['id'] == e.key);
                    final subtotal = (item['price'] as int) * e.value;
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Row(
                            children: [
                              Text(item['emoji'] as String, style: const TextStyle(fontSize: 18)),
                              const SizedBox(width: 8),
                              Text(
                                '${e.value}x ${item['name']}',
                                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                              ),
                            ],
                          ),
                          Text('₹$subtotal', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: AppTheme.onSurface)),
                        ],
                      ),
                    );
                  }).toList(),
                ),
              ),
              const Divider(height: 24),

              const Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('M3 Superfast Delivery Fee', style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 13)),
                  Text('FREE', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: Color(0xFF10B981))),
                ],
              ),
              const SizedBox(height: 6),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Total Bill Amount', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: AppTheme.onSurface)),
                  Text('₹$_totalCartPrice', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 20, color: Color(0xFF10B981))),
                ],
              ),
              const SizedBox(height: 20),

              SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF10B981),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                  onPressed: () {
                    Navigator.pop(ctx);
                    setState(() => _cart.clear());
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('🎉 M3 Grocery Order Confirmed! Delivering in 10 minutes.'),
                        backgroundColor: Color(0xFF10B981),
                      ),
                    );
                  },
                  child: const Text('Place 10-Min M3 Order', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final selectedCategoryName = _categories[_selectedCategory].replaceAll(RegExp(r'^[^\s]+\s*'), '');

    final filtered = _products.where((p) {
      final matchesCat = _selectedCategory == 0 ||
          p['category'].toString().toLowerCase().contains(selectedCategoryName.toLowerCase());

      if (!matchesCat) return false;

      if (_searchQuery.trim().isEmpty) return true;
      final query = _searchQuery.toLowerCase().trim();
      return p['name'].toString().toLowerCase().contains(query) || p['category'].toString().toLowerCase().contains(query);
    }).toList();

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Color(0xFF0F172A), size: 18),
          onPressed: () {
            if (Navigator.of(context).canPop()) {
              Navigator.of(context).pop();
            }
          },
        ),
        title: Row(
          children: [
            // NABIN Brand Logo Badge
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF22A447), Color(0xFF16A34A)],
                ),
                borderRadius: BorderRadius.circular(9),
                boxShadow: [
                  BoxShadow(color: const Color(0xFF22A447).withValues(alpha: 0.35), blurRadius: 6, offset: const Offset(0, 2)),
                ],
              ),
              child: const Text(
                'NABIN',
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 13, letterSpacing: 0.5),
              ),
            ),
            const SizedBox(width: 10),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text('Grocery Express', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: Color(0xFF0F172A))),
                      SizedBox(width: 6),
                      Text('⚡ 10 MINS', style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w900, color: Color(0xFF22A447))),
                    ],
                  ),
                  Text('Delivering to Civil Lines, Delhi', style: TextStyle(fontSize: 10.5, color: Color(0xFF64748B), fontWeight: FontWeight.normal)),
                ],
              ),
            ),
          ],
        ),
      ),
      body: SafeArea(
        child: Stack(
          children: [
            SingleChildScrollView(
              padding: const EdgeInsets.only(left: 18, right: 18, top: 12, bottom: 90),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Search Input
                  Container(
                    height: 50,
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                      boxShadow: [
                        BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 6, offset: const Offset(0, 2)),
                      ],
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.search_rounded, color: Color(0xFF10B981), size: 22),
                        const SizedBox(width: 10),
                        Expanded(
                          child: TextField(
                            onChanged: (val) => setState(() => _searchQuery = val),
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Color(0xFF0F172A)),
                            decoration: const InputDecoration(
                              hintText: 'Search fresh veggies, milk, fruits, snacks, drinks...',
                              hintStyle: TextStyle(color: Color(0xFF94A3B8), fontSize: 13, fontWeight: FontWeight.normal),
                              border: InputBorder.none,
                              isDense: true,
                            ),
                          ),
                        ),
                        if (_searchQuery.isNotEmpty)
                          GestureDetector(
                            onTap: () => setState(() => _searchQuery = ''),
                            child: const Icon(Icons.close_rounded, size: 18, color: Color(0xFF94A3B8)),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),

                  // Promotional Carousel
                  SizedBox(
                    height: 125,
                    child: PageView.builder(
                      controller: _bannerController,
                      onPageChanged: (idx) => setState(() => _currentBannerIndex = idx),
                      itemCount: _promoBanners.length,
                      itemBuilder: (context, idx) {
                        final banner = _promoBanners[idx];
                        final colors = banner['colors'] as List<Color>;
                        return Container(
                          margin: const EdgeInsets.only(right: 6),
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            gradient: LinearGradient(colors: colors, begin: Alignment.topLeft, end: Alignment.bottomRight),
                            borderRadius: BorderRadius.circular(20),
                            boxShadow: [
                              BoxShadow(color: colors[0].withValues(alpha: 0.35), blurRadius: 10, offset: const Offset(0, 4)),
                            ],
                          ),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                      decoration: BoxDecoration(
                                        color: Colors.white.withValues(alpha: 0.25),
                                        borderRadius: BorderRadius.circular(6),
                                      ),
                                      child: Text(
                                        banner['tag'] as String,
                                        style: const TextStyle(color: Colors.white, fontSize: 9.5, fontWeight: FontWeight.w900, letterSpacing: 0.5),
                                      ),
                                    ),
                                    const SizedBox(height: 6),
                                    Text(
                                      banner['title'] as String,
                                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 16),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      banner['subtitle'] as String,
                                      style: TextStyle(color: Colors.white.withValues(alpha: 0.9), fontSize: 11, fontWeight: FontWeight.w500),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ],
                                ),
                              ),
                              Icon(banner['icon'] as IconData, size: 48, color: Colors.white.withValues(alpha: 0.85)),
                            ],
                          ),
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: 8),

                  // Indicator Dots
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(_promoBanners.length, (idx) {
                      final isSelected = _currentBannerIndex == idx;
                      return AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        margin: const EdgeInsets.symmetric(horizontal: 3),
                        width: isSelected ? 18 : 6,
                        height: 6,
                        decoration: BoxDecoration(
                          color: isSelected ? const Color(0xFF10B981) : const Color(0xFFCBD5E1),
                          borderRadius: BorderRadius.circular(3),
                        ),
                      );
                    }),
                  ),
                  const SizedBox(height: 16),

                  // Category Filter Pills
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: List.generate(_categories.length, (idx) {
                        final isSelected = _selectedCategory == idx;
                        return GestureDetector(
                          onTap: () => setState(() => _selectedCategory = idx),
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 200),
                            margin: const EdgeInsets.only(right: 8),
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                            decoration: BoxDecoration(
                              color: isSelected ? const Color(0xFF10B981) : Colors.white,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: isSelected ? const Color(0xFF10B981) : const Color(0xFFE2E8F0)),
                              boxShadow: isSelected
                                  ? [BoxShadow(color: const Color(0xFF10B981).withValues(alpha: 0.3), blurRadius: 6, offset: const Offset(0, 2))]
                                  : const [],
                            ),
                            child: Text(
                              _categories[idx],
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w800,
                                color: isSelected ? Colors.white : const Color(0xFF0F172A),
                              ),
                            ),
                          ),
                        );
                      }),
                    ),
                  ),
                  const SizedBox(height: 18),

                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        _selectedCategory == 0 ? '⚡ M3 10-Min Essentials' : _categories[_selectedCategory],
                        style: const TextStyle(fontSize: 16.5, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
                      ),
                      Text(
                        '${filtered.length} items',
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFF64748B)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),

                  // Grid of Products (2 columns)
                  GridView.builder(
                    physics: const NeverScrollableScrollPhysics(),
                    shrinkWrap: true,
                    itemCount: filtered.length,
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      childAspectRatio: 0.68,
                      crossAxisSpacing: 12,
                      mainAxisSpacing: 12,
                    ),
                    itemBuilder: (context, index) {
                      final item = filtered[index];
                      final id = item['id'] as String;
                      final qty = _cart[id] ?? 0;
                      final price = item['price'] as int;
                      final mrp = item['mrp'] as int;
                      final discountPercent = (((mrp - price) / mrp) * 100).round();
                      final imageUrl = item['imageUrl'] as String;
                      final emoji = item['emoji'] as String;
                      final imageColor = item['imageColor'] as Color;

                      return Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(18),
                          border: Border.all(color: const Color(0xFFE2E8F0)),
                          boxShadow: [
                            BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 8, offset: const Offset(0, 2)),
                          ],
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Product Image Container with Image.network + Fallback
                            Expanded(
                              child: Stack(
                                children: [
                                  GestureDetector(
                                    onTap: () {
                                      GroceryProductDetailModal.show(
                                        context: context,
                                        product: item,
                                        initialQuantity: qty,
                                        onQuantityChanged: (newQty) {
                                          setState(() {
                                            if (newQty <= 0) {
                                              _cart.remove(id);
                                            } else {
                                              _cart[id] = newQty;
                                            }
                                          });
                                        },
                                      );
                                    },
                                    child: ClipRRect(
                                      borderRadius: BorderRadius.circular(14),
                                      child: Container(
                                        width: double.infinity,
                                        color: imageColor,
                                        child: Image.network(
                                          imageUrl,
                                          fit: BoxFit.cover,
                                          width: double.infinity,
                                          loadingBuilder: (context, child, loadingProgress) {
                                            if (loadingProgress == null) return child;
                                            return Center(
                                              child: Text(emoji, style: const TextStyle(fontSize: 38)),
                                            );
                                          },
                                          errorBuilder: (context, error, stackTrace) {
                                            return Center(
                                              child: Text(emoji, style: const TextStyle(fontSize: 42)),
                                            );
                                          },
                                        ),
                                      ),
                                    ),
                                  ),
                                  if (discountPercent > 0)
                                    Positioned(
                                      top: 6,
                                      left: 6,
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: const Color(0xFF10B981),
                                          borderRadius: BorderRadius.circular(6),
                                        ),
                                        child: Text(
                                          '$discountPercent% OFF',
                                          style: const TextStyle(fontSize: 8.5, fontWeight: FontWeight.w900, color: Colors.white),
                                        ),
                                      ),
                                    ),
                                  Positioned(
                                    bottom: 6,
                                    right: 6,
                                    child: Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                                      decoration: BoxDecoration(
                                        color: Colors.black.withValues(alpha: 0.65),
                                        borderRadius: BorderRadius.circular(6),
                                      ),
                                      child: Text(
                                        item['rating'] as String,
                                        style: const TextStyle(fontSize: 8.5, fontWeight: FontWeight.bold, color: Colors.white),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              item['weight'] as String,
                              style: const TextStyle(fontSize: 10, color: Color(0xFF64748B), fontWeight: FontWeight.w600),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              item['name'] as String,
                              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                            const SizedBox(height: 8),

                            // Price & Add / Stepper Row
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text('₹$price', style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w900, color: Color(0xFF0F172A))),
                                    if (mrp > price)
                                      Text(
                                        '₹$mrp',
                                        style: const TextStyle(fontSize: 10, color: Color(0xFF94A3B8), decoration: TextDecoration.lineThrough),
                                      ),
                                  ],
                                ),
                                qty == 0
                                    ? ElevatedButton(
                                        onPressed: () => setState(() => _cart[id] = 1),
                                        style: ElevatedButton.styleFrom(
                                          backgroundColor: const Color(0xFF10B981),
                                          foregroundColor: Colors.white,
                                          minimumSize: const Size(60, 32),
                                          padding: const EdgeInsets.symmetric(horizontal: 10),
                                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                          elevation: 0,
                                        ),
                                        child: const Text('ADD', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w900)),
                                      )
                                    : Container(
                                        height: 32,
                                        decoration: BoxDecoration(
                                          color: const Color(0xFF10B981),
                                          borderRadius: BorderRadius.circular(10),
                                        ),
                                        child: Row(
                                          children: [
                                            IconButton(
                                              padding: EdgeInsets.zero,
                                              constraints: const BoxConstraints(minWidth: 24, minHeight: 32),
                                              icon: const Icon(Icons.remove, size: 14, color: Colors.white),
                                              onPressed: () {
                                                setState(() {
                                                  if (qty == 1) {
                                                    _cart.remove(id);
                                                  } else {
                                                    _cart[id] = qty - 1;
                                                  }
                                                });
                                              },
                                            ),
                                            Text(
                                              '$qty',
                                              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: Colors.white),
                                            ),
                                            IconButton(
                                              padding: EdgeInsets.zero,
                                              constraints: const BoxConstraints(minWidth: 24, minHeight: 32),
                                              icon: const Icon(Icons.add, size: 14, color: Colors.white),
                                              onPressed: () {
                                                setState(() {
                                                  _cart[id] = qty + 1;
                                                });
                                              },
                                            ),
                                          ],
                                        ),
                                      ),
                              ],
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ],
              ),
            ),

            // Bottom Floating Cart Bar
            if (_totalCartItems > 0)
              Positioned(
                left: 18,
                right: 18,
                bottom: 14,
                child: GestureDetector(
                  onTap: _showCartSheet,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFF10B981), Color(0xFF047857)],
                      ),
                      borderRadius: BorderRadius.circular(18),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFF10B981).withValues(alpha: 0.45),
                          blurRadius: 16,
                          offset: const Offset(0, 6),
                        ),
                      ],
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              '$_totalCartItems ITEMS IN M3 CART',
                              style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: Colors.white70, letterSpacing: 0.8),
                            ),
                            Text(
                              '₹$_totalCartPrice',
                              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: Colors.white),
                            ),
                          ],
                        ),
                        Row(
                          children: [
                            const Text(
                              'VIEW CART',
                              style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 13),
                            ),
                            const SizedBox(width: 6),
                            Container(
                              padding: const EdgeInsets.all(6),
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.25),
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.arrow_forward_rounded, color: Colors.white, size: 16),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
