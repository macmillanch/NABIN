import 'package:flutter/material.dart';
import '../theme/grocery_theme.dart';
import '../widgets/grocery_product_detail_modal.dart';

class GroceryCategoriesScreen extends StatefulWidget {
  final Function(String itemTitle)? onAddToCart;

  const GroceryCategoriesScreen({super.key, this.onAddToCart});

  @override
  State<GroceryCategoriesScreen> createState() => _GroceryCategoriesScreenState();
}

class _GroceryCategoriesScreenState extends State<GroceryCategoriesScreen> {
  int _selectedCategoryIndex = 0;
  String _searchQuery = '';

  final List<Map<String, dynamic>> _categories = const [
    {'name': '🥬 Veggies & Fruits', 'icon': Icons.eco_rounded, 'count': '42 items'},
    {'name': '🥛 Milk & Dairy', 'icon': Icons.local_drink_rounded, 'count': '28 items'},
    {'name': '🍿 Snacks & Chips', 'icon': Icons.fastfood_rounded, 'count': '64 items'},
    {'name': '🥤 Drinks & Juices', 'icon': Icons.local_bar_rounded, 'count': '35 items'},
    {'name': '🍞 Bakery & Eggs', 'icon': Icons.bakery_dining_rounded, 'count': '22 items'},
    {'name': '🧼 Cleaning & Care', 'icon': Icons.cleaning_services_rounded, 'count': '50 items'},
    {'name': '💄 Personal Care', 'icon': Icons.face_retouching_natural_rounded, 'count': '38 items'},
    {'name': '👶 Baby Care', 'icon': Icons.child_friendly_rounded, 'count': '18 items'},
  ];

  final List<Map<String, dynamic>> _products = const [
    {
      'id': 'cat_1',
      'name': 'Organic Bananas (Robusta)',
      'category': 0,
      'weight': '500g',
      'price': 35,
      'mrp': 50,
      'emoji': '🍌',
      'bgColor': Color(0xFFFEF9C3),
      'rating': '4.9 ★',
    },
    {
      'id': 'cat_2',
      'name': 'Vine Tomatoes',
      'category': 0,
      'weight': '500g',
      'price': 25,
      'mrp': 40,
      'emoji': '🍅',
      'bgColor': Color(0xFFFEE2E2),
      'rating': '4.8 ★',
    },
    {
      'id': 'cat_3',
      'name': 'Fresh Spinach (Palak)',
      'category': 0,
      'weight': '250g',
      'price': 20,
      'mrp': 30,
      'emoji': '🥬',
      'bgColor': Color(0xFFDCFCE7),
      'rating': '4.7 ★',
    },
    {
      'id': 'cat_4',
      'name': 'Amul Taaza Toned Milk',
      'category': 1,
      'weight': '1 L',
      'price': 56,
      'mrp': 60,
      'emoji': '🥛',
      'bgColor': Color(0xFFE0F2FE),
      'rating': '4.9 ★',
    },
    {
      'id': 'cat_5',
      'name': 'Amul Salted Butter Block',
      'category': 1,
      'weight': '100g',
      'price': 58,
      'mrp': 60,
      'emoji': '🧈',
      'bgColor': Color(0xFFFEF08A),
      'rating': '4.9 ★',
    },
    {
      'id': 'cat_6',
      'name': 'Lays Classic Salted Chips',
      'category': 2,
      'weight': '50g',
      'price': 20,
      'mrp': 20,
      'emoji': '🍿',
      'bgColor': Color(0xFFFEF3C7),
      'rating': '4.6 ★',
    },
    {
      'id': 'cat_7',
      'name': 'Cold Pressed Orange Juice',
      'category': 3,
      'weight': '300ml',
      'price': 85,
      'mrp': 110,
      'emoji': '🥤',
      'bgColor': Color(0xFFFFEDD5),
      'rating': '4.8 ★',
    },
    {
      'id': 'cat_8',
      'name': 'Brown Multigrain Bread',
      'category': 4,
      'weight': '400g',
      'price': 45,
      'mrp': 55,
      'emoji': '🍞',
      'bgColor': Color(0xFFFED7AA),
      'rating': '4.7 ★',
    },
  ];

  final Map<String, int> _itemCounts = {};

  @override
  Widget build(BuildContext context) {
    final filteredProducts = _products.where((p) {
      final matchesCategory = p['category'] == _selectedCategoryIndex;
      final matchesSearch = _searchQuery.isEmpty ||
          (p['name'] as String).toLowerCase().contains(_searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    }).toList();

    return Scaffold(
      backgroundColor: GroceryTheme.bgOffWhite,
      appBar: AppBar(
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Categories & Aisles', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: GroceryTheme.textDark)),
            Text('⚡ 10-Minute Instant Quick Commerce', style: TextStyle(fontSize: 11, color: GroceryTheme.textMuted)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.tune_rounded, color: GroceryTheme.primaryGreenDark),
            onPressed: () {},
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Column(
        children: [
          // Search Input
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            color: Colors.white,
            child: TextField(
              onChanged: (val) => setState(() => _searchQuery = val),
              decoration: InputDecoration(
                hintText: 'Search within categories...',
                hintStyle: const TextStyle(color: GroceryTheme.textMuted, fontSize: 13),
                prefixIcon: const Icon(Icons.search_rounded, color: GroceryTheme.primaryGreenDark, size: 20),
                filled: true,
                fillColor: GroceryTheme.surfaceElevated,
                contentPadding: const EdgeInsets.symmetric(vertical: 10),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          const Divider(height: 1, color: GroceryTheme.borderLight),

          // Sidebar + Grid Content
          Expanded(
            child: Row(
              children: [
                // Category Sidebar (Left)
                Container(
                  width: 110,
                  color: Colors.white,
                  child: ListView.builder(
                    itemCount: _categories.length,
                    itemBuilder: (ctx, idx) {
                      final isSelected = _selectedCategoryIndex == idx;
                      final cat = _categories[idx];
                      return InkWell(
                        onTap: () => setState(() => _selectedCategoryIndex = idx),
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 200),
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 14),
                          decoration: BoxDecoration(
                            color: isSelected ? GroceryTheme.primaryGreenLight : Colors.white,
                            border: Border(
                              left: BorderSide(
                                color: isSelected ? GroceryTheme.primaryGreenDark : Colors.transparent,
                                width: 4,
                              ),
                            ),
                          ),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                cat['icon'] as IconData,
                                color: isSelected ? GroceryTheme.primaryGreenDark : GroceryTheme.textMuted,
                                size: 22,
                              ),
                              const SizedBox(height: 6),
                              Text(
                                (cat['name'] as String).replaceAll(RegExp(r'^[^\s]+\s'), ''),
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: isSelected ? FontWeight.w900 : FontWeight.w600,
                                  color: isSelected ? GroceryTheme.primaryGreenDark : GroceryTheme.textDark,
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),

                const VerticalDivider(width: 1, color: GroceryTheme.borderLight),

                // Products Grid (Right)
                Expanded(
                  child: filteredProducts.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.shopping_bag_outlined, size: 48, color: GroceryTheme.textMuted),
                              const SizedBox(height: 10),
                              Text(
                                'No items in ${_categories[_selectedCategoryIndex]['name']}',
                                style: const TextStyle(fontWeight: FontWeight.bold, color: GroceryTheme.textMuted, fontSize: 13),
                              ),
                            ],
                          ),
                        )
                      : GridView.builder(
                          padding: const EdgeInsets.all(12),
                          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: 2,
                            childAspectRatio: 0.72,
                            crossAxisSpacing: 10,
                            mainAxisSpacing: 10,
                          ),
                          itemCount: filteredProducts.length,
                          itemBuilder: (ctx, idx) {
                            final prod = filteredProducts[idx];
                            final id = prod['id'] as String;
                            final count = _itemCounts[id] ?? 0;

                            return Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(color: GroceryTheme.borderLight),
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.black.withValues(alpha: 0.03),
                                    blurRadius: 6,
                                    offset: const Offset(0, 2),
                                  ),
                                ],
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  // Product Emoji Header (Tap to open image popup modal)
                                  Expanded(
                                    child: GestureDetector(
                                      onTap: () {
                                        GroceryProductDetailModal.show(
                                          context: context,
                                          product: prod,
                                          initialQuantity: count,
                                          onQuantityChanged: (newQty) {
                                            setState(() {
                                              _itemCounts[id] = newQty;
                                            });
                                          },
                                        );
                                      },
                                      child: Container(
                                        decoration: BoxDecoration(
                                          color: prod['bgColor'] as Color,
                                          borderRadius: BorderRadius.circular(12),
                                        ),
                                        child: Center(
                                          child: Text(
                                            prod['emoji'] as String,
                                            style: const TextStyle(fontSize: 42),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(height: 8),

                                  Text(
                                    prod['name'] as String,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12.5, color: GroceryTheme.textDark),
                                  ),
                                  Text(
                                    prod['weight'] as String,
                                    style: const TextStyle(fontSize: 10.5, color: GroceryTheme.textMuted),
                                  ),
                                  const SizedBox(height: 6),

                                  // Pricing & Add button
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            '₹${prod['price']}',
                                            style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: GroceryTheme.textDark),
                                          ),
                                          Text(
                                            'MRP ₹${prod['mrp']}',
                                            style: const TextStyle(fontSize: 9.5, color: GroceryTheme.textMuted, decoration: TextDecoration.lineThrough),
                                          ),
                                        ],
                                      ),
                                      count == 0
                                          ? InkWell(
                                              onTap: () {
                                                setState(() => _itemCounts[id] = 1);
                                                widget.onAddToCart?.call(prod['name'] as String);
                                              },
                                              borderRadius: BorderRadius.circular(10),
                                              child: Container(
                                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                                decoration: BoxDecoration(
                                                  color: GroceryTheme.primaryGreenLight,
                                                  borderRadius: BorderRadius.circular(10),
                                                  border: Border.all(color: GroceryTheme.primaryGreenDark.withValues(alpha: 0.3)),
                                                ),
                                                child: const Text(
                                                  'ADD',
                                                  style: TextStyle(fontWeight: FontWeight.w900, fontSize: 11, color: GroceryTheme.primaryGreenDark),
                                                ),
                                              ),
                                            )
                                          : Container(
                                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                              decoration: BoxDecoration(
                                                color: GroceryTheme.primaryGreenDark,
                                                borderRadius: BorderRadius.circular(10),
                                              ),
                                              child: Row(
                                                children: [
                                                  InkWell(
                                                    onTap: () => setState(() => _itemCounts[id] = count - 1),
                                                    child: const Icon(Icons.remove, size: 14, color: Colors.white),
                                                  ),
                                                  Padding(
                                                    padding: const EdgeInsets.symmetric(horizontal: 6),
                                                    child: Text(
                                                      '$count',
                                                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12),
                                                    ),
                                                  ),
                                                  InkWell(
                                                    onTap: () => setState(() => _itemCounts[id] = count + 1),
                                                    child: const Icon(Icons.add, size: 14, color: Colors.white),
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
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
