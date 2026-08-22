import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/restaurant_theme.dart';

class RestaurantMenuScreen extends StatefulWidget {
  const RestaurantMenuScreen({super.key});

  @override
  State<RestaurantMenuScreen> createState() => _RestaurantMenuScreenState();
}

class _RestaurantMenuScreenState extends State<RestaurantMenuScreen> {
  final Map<int, int> _itemCounts = {0: 1, 1: 1, 2: 0};
  int _selectedCategoryIndex = 0;
  bool _isFavorite = false;
  String _menuSearchQuery = '';

  final List<String> _menuCategories = [
    'Recommended',
    'Starters',
    'Main Course',
    'Rice',
    'Noodles',
    'Breads',
    'Snacks',
    'Desserts',
    'Drinks',
  ];

  final List<Map<String, dynamic>> _menu = const [
    {
      'name': 'Special Dum Biryani (Chicken)',
      'desc': 'Slow-cooked fragrant basmati rice with marinated chicken & royal saffron spices.',
      'price': 220,
      'isVeg': false,
      'category': 'Rice',
      'rating': '4.9 (420)',
      'imageUrl': 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=600&q=80',
      'addOns': ['Extra Raita (₹30)', 'Boiled Egg (₹20)', 'Extra Gravy (₹40)'],
    },
    {
      'name': 'Paneer Tikka Butter Masala',
      'desc': 'Charcoal grilled cottage cheese simmered in velvety makhani gravy.',
      'price': 180,
      'isVeg': true,
      'category': 'Main Course',
      'rating': '4.8 (310)',
      'imageUrl': 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=600&q=80',
      'addOns': ['Extra Butter (₹20)', 'Cheese Grating (₹35)'],
    },
    {
      'name': 'Garlic Butter Naan (2 Pcs)',
      'desc': 'Crisp tandoori bread brushed with fresh garlic & golden butter.',
      'price': 40,
      'isVeg': true,
      'category': 'Breads',
      'rating': '4.9 (650)',
      'imageUrl': 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=600&q=80',
      'addOns': ['Extra Garlic Butter (₹15)'],
    },
    {
      'name': 'Tandoori Malai Chaap Tikka',
      'desc': 'Smoky soya chaap infused with cardamom cream and mint dip.',
      'price': 160,
      'isVeg': true,
      'category': 'Starters',
      'rating': '4.7 (190)',
      'imageUrl': 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=600&q=80',
      'addOns': ['Mint Chutney Tub (₹20)', 'Rumali Roti (₹25)'],
    },
    {
      'name': 'Hot Gulab Jamun with Rabri',
      'desc': 'Melt-in-mouth milk dumplings served warm with rich thickened rabri.',
      'price': 90,
      'isVeg': true,
      'category': 'Desserts',
      'rating': '4.9 (510)',
      'imageUrl': 'https://images.unsplash.com/photo-1541781774459-bb2af2f05b55?w=600&q=80',
      'addOns': ['Extra Rabri (₹40)'],
    },
    {
      'name': 'Hakka Noodles & Crispy Veg',
      'desc': 'Wok-tossed thin noodles with crunchy seasonal greens and mild garlic pepper.',
      'price': 140,
      'isVeg': true,
      'category': 'Noodles',
      'rating': '4.7 (280)',
      'imageUrl': 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=600&q=80',
      'addOns': ['Schezwan Dip (₹25)', 'Extra Veggies (₹30)'],
    },
    {
      'name': 'Royal Mango Cardamom Lassi',
      'desc': 'Chilled thick curd blended with Alphonso mango pulp and saffron.',
      'price': 75,
      'isVeg': true,
      'category': 'Drinks',
      'rating': '4.9 (340)',
      'imageUrl': 'https://images.unsplash.com/photo-1553787499-6f9133860278?w=600&q=80',
      'addOns': ['Dry Fruit Topping (₹20)'],
    },
  ];

  int get _totalItems => _itemCounts.values.fold(0, (sum, count) => sum + count);

  int get _cartTotal {
    int sum = 0;
    for (int i = 0; i < _menu.length; i++) {
      final count = _itemCounts[i] ?? 0;
      final price = _menu[i]['price'] as int;
      sum += (count * price);
    }
    return sum;
  }

  void _openCustomizationModal(int idx) {
    final dish = _menu[idx];
    final isVeg = dish['isVeg'] as bool;
    final addOns = dish['addOns'] as List<String>;
    final selectedAddOns = <String>{};

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Container(
          decoration: const BoxDecoration(
            color: RestaurantTheme.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          padding: const EdgeInsets.all(20),
          child: SafeArea(
            top: false,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(16),
                    child: Image.network(
                      dish['imageUrl'] as String,
                      width: 88,
                      height: 88,
                      fit: BoxFit.cover,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(2.5),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(4),
                                border: Border.all(color: isVeg ? RestaurantTheme.vegGreen : RestaurantTheme.nonVegRed, width: 1.5),
                              ),
                              child: Icon(
                                Icons.fiber_manual_record,
                                color: isVeg ? RestaurantTheme.vegGreen : RestaurantTheme.nonVegRed,
                                size: 8,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                dish['name'] as String,
                                style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: RestaurantTheme.charcoal),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text('₹${dish['price']}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: RestaurantTheme.neonOrange)),
                        const SizedBox(height: 4),
                        Text(dish['desc'] as String, style: const TextStyle(color: RestaurantTheme.secondaryText, fontSize: 11)),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              const Divider(color: RestaurantTheme.border),
              const SizedBox(height: 8),
              const Text('Choice of Add-ons', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: RestaurantTheme.charcoal)),
              const SizedBox(height: 8),
              ...addOns.map((addOn) {
                final isChecked = selectedAddOns.contains(addOn);
                return CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  activeColor: RestaurantTheme.neonOrange,
                  title: Text(addOn, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: RestaurantTheme.charcoal)),
                  value: isChecked,
                  onChanged: (val) {
                    setModalState(() {
                      if (val == true) {
                        selectedAddOns.add(addOn);
                      } else {
                        selectedAddOns.remove(addOn);
                      }
                    });
                  },
                );
              }),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () {
                  setState(() => _itemCounts[idx] = (_itemCounts[idx] ?? 0) + 1);
                  Navigator.pop(ctx);
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: RestaurantTheme.neonOrange,
                  foregroundColor: Colors.white,
                  minimumSize: const Size(double.infinity, 48),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                child: const Text('Add to Cart', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14)),
              ),
            ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _proceedToCheckout() {
    final List<Map<String, dynamic>> cartItems = [];
    for (int i = 0; i < _menu.length; i++) {
      final count = _itemCounts[i] ?? 0;
      if (count > 0) {
        cartItems.add({
          'name': _menu[i]['name'],
          'qty': count,
          'price': _menu[i]['price'],
          'isVeg': _menu[i]['isVeg'],
        });
      }
    }

    context.push('/food-checkout', extra: {
      'restaurantName': 'Dilli Darbar Mughlai Kitchen',
      'items': cartItems,
      'cartTotal': _cartTotal,
    });
  }

  @override
  Widget build(BuildContext context) {
    final selectedCategoryName = _menuCategories[_selectedCategoryIndex];
    final filteredDishes = _menu.where((d) {
      final matchesCategory = _selectedCategoryIndex == 0 || d['category'] == selectedCategoryName;
      if (!matchesCategory) return false;
      if (_menuSearchQuery.trim().isEmpty) return true;
      final q = _menuSearchQuery.toLowerCase().trim();
      return (d['name'] as String).toLowerCase().contains(q) || (d['desc'] as String).toLowerCase().contains(q);
    }).toList();

    return Scaffold(
      backgroundColor: RestaurantTheme.lightBg,
      body: SafeArea(
        child: Stack(
          children: [
            SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 120),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Top Hero Cover & Actions
                  Stack(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(20),
                        child: Image.network(
                          'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=80',
                          height: 160,
                          width: double.infinity,
                          fit: BoxFit.cover,
                        ),
                      ),
                      Positioned(
                        top: 12,
                        left: 12,
                        child: GestureDetector(
                          onTap: () => context.canPop() ? context.pop() : context.go('/food-home'),
                          child: Container(
                            padding: const EdgeInsets.all(8),
                            decoration: const BoxDecoration(
                              color: Colors.white,
                              shape: BoxShape.circle,
                              boxShadow: [BoxShadow(color: Colors.black26, blurRadius: 6)],
                            ),
                            child: const Icon(Icons.arrow_back_ios_new_rounded, size: 16, color: RestaurantTheme.charcoal),
                          ),
                        ),
                      ),
                      Positioned(
                        top: 12,
                        right: 12,
                        child: GestureDetector(
                          onTap: () => setState(() => _isFavorite = !_isFavorite),
                          child: Container(
                            padding: const EdgeInsets.all(8),
                            decoration: const BoxDecoration(
                              color: Colors.white,
                              shape: BoxShape.circle,
                              boxShadow: [BoxShadow(color: Colors.black26, blurRadius: 6)],
                            ),
                            child: Icon(
                              _isFavorite ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                              size: 18,
                              color: _isFavorite ? Colors.red : RestaurantTheme.charcoal,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),

                  // Restaurant Info Card
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: RestaurantTheme.white,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: RestaurantTheme.border),
                      boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 8)],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('Dilli Darbar Mughlai Kitchen', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: RestaurantTheme.charcoal)),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                              decoration: BoxDecoration(
                                color: RestaurantTheme.vegGreen.withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: const Text('● OPEN', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: RestaurantTheme.vegGreen)),
                            ),
                          ],
                        ),
                        const SizedBox(height: 3),
                        const Text('Biryani, Kebabs, Mughlai, North Indian • Civil Lines Hub', style: TextStyle(color: RestaurantTheme.secondaryText, fontSize: 12)),
                        const SizedBox(height: 10),
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
                              decoration: BoxDecoration(
                                color: RestaurantTheme.vegGreen.withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: const Row(
                                children: [
                                  Icon(Icons.star_rounded, size: 12, color: RestaurantTheme.vegGreen),
                                  SizedBox(width: 2),
                                  Text('4.8 (1.2k+)', style: TextStyle(color: RestaurantTheme.vegGreen, fontWeight: FontWeight.bold, fontSize: 11)),
                                ],
                              ),
                            ),
                            const SizedBox(width: 8),
                            const Text('• 25 mins ETA', style: TextStyle(color: RestaurantTheme.secondaryText, fontSize: 11, fontWeight: FontWeight.w600)),
                            const SizedBox(width: 6),
                            const Text('• Free Delivery', style: TextStyle(color: RestaurantTheme.charcoal, fontSize: 11, fontWeight: FontWeight.bold)),
                            const SizedBox(width: 6),
                            const Text('• Min ₹149', style: TextStyle(color: RestaurantTheme.secondaryText, fontSize: 11)),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Menu Search Bar
                  Container(
                    height: 46,
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    decoration: BoxDecoration(
                      color: RestaurantTheme.white,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: RestaurantTheme.border),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.search_rounded, color: RestaurantTheme.neonOrange, size: 20),
                        const SizedBox(width: 8),
                        Expanded(
                          child: TextField(
                            onChanged: (val) => setState(() => _menuSearchQuery = val),
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: RestaurantTheme.charcoal),
                            decoration: const InputDecoration(
                              hintText: 'Search dishes inside this menu...',
                              hintStyle: TextStyle(color: RestaurantTheme.secondaryText, fontSize: 12),
                              border: InputBorder.none,
                              isDense: true,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),

                  // Menu Category Horizontal Tabs
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: List.generate(_menuCategories.length, (idx) {
                        final isSelected = _selectedCategoryIndex == idx;
                        return GestureDetector(
                          onTap: () => setState(() => _selectedCategoryIndex = idx),
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 200),
                            margin: const EdgeInsets.only(right: 8),
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
                            decoration: BoxDecoration(
                              color: isSelected ? RestaurantTheme.neonOrange : RestaurantTheme.white,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: isSelected ? RestaurantTheme.neonOrange : RestaurantTheme.border),
                            ),
                            child: Text(
                              _menuCategories[idx],
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w800,
                                color: isSelected ? Colors.white : RestaurantTheme.charcoal,
                              ),
                            ),
                          ),
                        );
                      }),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Menu Items Section Title
                  Text(
                    _selectedCategoryIndex == 0 ? 'Chef’s Recommended Dishes' : _menuCategories[_selectedCategoryIndex],
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
                  ),
                  const SizedBox(height: 10),

                  // Food Item Cards
                  ...List.generate(filteredDishes.length, (idx) {
                    final dish = filteredDishes[idx];
                    final originalIndex = _menu.indexOf(dish);
                    final isVeg = dish['isVeg'] as bool;
                    final count = _itemCounts[originalIndex] ?? 0;
                    final imgUrl = dish['imageUrl'] as String;

                    return GestureDetector(
                      onTap: () => _openCustomizationModal(originalIndex),
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 12),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: RestaurantTheme.white,
                          borderRadius: BorderRadius.circular(18),
                          border: Border.all(color: RestaurantTheme.border),
                          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.02), blurRadius: 6, offset: const Offset(0, 2))],
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Dish Image with Veg Indicator
                            Stack(
                              children: [
                                ClipRRect(
                                  borderRadius: BorderRadius.circular(14),
                                  child: Image.network(
                                    imgUrl,
                                    width: 82,
                                    height: 82,
                                    fit: BoxFit.cover,
                                    errorBuilder: (_, __, ___) => Container(
                                      width: 82,
                                      height: 82,
                                      color: RestaurantTheme.lightBg,
                                      child: const Icon(Icons.fastfood_rounded, color: RestaurantTheme.neonOrange),
                                    ),
                                  ),
                                ),
                                Positioned(
                                  top: 5,
                                  left: 5,
                                  child: Container(
                                    padding: const EdgeInsets.all(2.5),
                                    decoration: BoxDecoration(
                                      color: Colors.white,
                                      borderRadius: BorderRadius.circular(4),
                                      border: Border.all(color: isVeg ? RestaurantTheme.vegGreen : RestaurantTheme.nonVegRed, width: 1.5),
                                    ),
                                    child: Icon(
                                      Icons.fiber_manual_record,
                                      color: isVeg ? RestaurantTheme.vegGreen : RestaurantTheme.nonVegRed,
                                      size: 8,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(width: 12),

                            // Dish Details
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(dish['name'] as String, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: RestaurantTheme.charcoal)),
                                  const SizedBox(height: 2),
                                  Row(
                                    children: [
                                      Text('₹${dish['price']}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: RestaurantTheme.charcoal)),
                                      const SizedBox(width: 6),
                                      Text('★ ${dish['rating']}', style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Color(0xFFD97706))),
                                    ],
                                  ),
                                  const SizedBox(height: 4),
                                  Text(dish['desc'] as String, style: const TextStyle(color: RestaurantTheme.secondaryText, fontSize: 11, height: 1.2), maxLines: 2, overflow: TextOverflow.ellipsis),
                                ],
                              ),
                            ),
                            const SizedBox(width: 8),

                            // Add / Quantity Stepper
                            count == 0
                                ? ElevatedButton(
                                    onPressed: () => setState(() => _itemCounts[originalIndex] = 1),
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: RestaurantTheme.neonOrangeLight,
                                      foregroundColor: RestaurantTheme.neonOrangeDark,
                                      elevation: 0,
                                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                                      minimumSize: const Size(64, 32),
                                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: const BorderSide(color: RestaurantTheme.neonOrange)),
                                    ),
                                    child: const Text('+ ADD', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 11.5)),
                                  )
                                : Container(
                                    decoration: BoxDecoration(
                                      color: RestaurantTheme.neonOrange,
                                      borderRadius: BorderRadius.circular(10),
                                    ),
                                    child: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        IconButton(
                                          icon: const Icon(Icons.remove, size: 14, color: Colors.white),
                                          padding: EdgeInsets.zero,
                                          constraints: const BoxConstraints(minWidth: 26, minHeight: 28),
                                          onPressed: () => setState(() => _itemCounts[originalIndex] = count - 1),
                                        ),
                                        Text('$count', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 12)),
                                        IconButton(
                                          icon: const Icon(Icons.add, size: 14, color: Colors.white),
                                          padding: EdgeInsets.zero,
                                          constraints: const BoxConstraints(minWidth: 26, minHeight: 28),
                                          onPressed: () => setState(() => _itemCounts[originalIndex] = count + 1),
                                        ),
                                      ],
                                    ),
                                  ),
                          ],
                        ),
                      ),
                    );
                  }),
                ],
              ),
            ),

            // Floating Sticky Cart Bar
            if (_totalItems > 0)
              Positioned(
                left: 16,
                right: 16,
                bottom: 16,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  decoration: BoxDecoration(
                    color: RestaurantTheme.charcoal,
                    borderRadius: BorderRadius.circular(18),
                    boxShadow: [
                      BoxShadow(color: RestaurantTheme.charcoal.withValues(alpha: 0.35), blurRadius: 16, offset: const Offset(0, 6)),
                    ],
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text('$_totalItems ITEMS IN BASKET', style: const TextStyle(color: RestaurantTheme.neonOrange, fontSize: 9.5, fontWeight: FontWeight.w900, letterSpacing: 0.5)),
                          Text('₹$_cartTotal', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: Colors.white)),
                        ],
                      ),
                      ElevatedButton(
                        onPressed: _proceedToCheckout,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: RestaurantTheme.neonOrange,
                          foregroundColor: Colors.white,
                          minimumSize: const Size(140, 42),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          elevation: 0,
                        ),
                        child: const Row(
                          children: [
                            Text('Proceed to Checkout', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 12)),
                            SizedBox(width: 4),
                            Icon(Icons.arrow_forward_rounded, size: 14),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
