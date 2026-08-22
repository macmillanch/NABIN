import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/restaurant_theme.dart';

class FoodHomeScreen extends StatefulWidget {
  const FoodHomeScreen({super.key});

  @override
  State<FoodHomeScreen> createState() => _FoodHomeScreenState();
}

class _FoodHomeScreenState extends State<FoodHomeScreen> {
  int _selectedCategory = 0;
  String _searchQuery = '';
  int _currentBannerIndex = 0;
  late final PageController _bannerController;
  Timer? _bannerTimer;

  final List<String> _categories = [
    'All',
    '🍳 Breakfast',
    '🍛 Indian',
    '🥡 Chinese',
    '🍟 Fast Food',
    '🍕 Pizza',
    '🍔 Burgers',
    '🍲 Biryani',
    '🥟 Snacks',
    '🍰 Desserts',
    '🥤 Beverages',
    '🥦 Vegetarian',
    '🍗 Non-Vegetarian',
  ];

  final List<Map<String, dynamic>> _promoBanners = const [
    {
      'title': 'CRAVING BIRYANI & KEBABS?',
      'subtitle': '50% OFF up to ₹120 on top royal kitchen spots',
      'code': 'NABINFOOD50',
      'colors': [RestaurantTheme.charcoal, Color(0xFF1F2937)],
      'accent': RestaurantTheme.neonOrange,
      'icon': Icons.local_fire_department_rounded,
    },
    {
      'title': 'FREE DELIVERY WEEKEND',
      'subtitle': 'Zero delivery fee on all restaurant orders above ₹199',
      'code': 'AUTO APPLIED',
      'colors': [RestaurantTheme.masterBlue, Color(0xFF1B40A6)],
      'accent': Color(0xFF93C5FD),
      'icon': Icons.delivery_dining_rounded,
    },
    {
      'title': 'GOURMET BURGER FEAST',
      'subtitle': 'Flat ₹80 Cashback with UPI Instant Pay',
      'code': 'BURGER80',
      'colors': [RestaurantTheme.neonOrange, RestaurantTheme.neonOrangeDark],
      'accent': Colors.white,
      'icon': Icons.lunch_dining_rounded,
    },
  ];

  final List<Map<String, dynamic>> _restaurants = const [
    {
      'name': 'Dilli Darbar Mughlai Kitchen',
      'cuisine': 'Biryani, Mughlai, Kebabs, North Indian',
      'category': 'Biryani',
      'rating': '4.8',
      'reviewCount': '1.2k+',
      'time': '25-30 mins',
      'deliveryFee': 'FREE',
      'distance': '1.8 km',
      'offer': '50% OFF UPTO ₹100',
      'isOpen': true,
      'popularDishes': ['Chicken Dum Biryani', 'Mutton Galouti Kebab', 'Butter Naan'],
      'imageUrl': 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=600&q=80',
      'isVeg': false,
    },
    {
      'name': 'Pizzeria Woodfired Oven',
      'cuisine': 'Pizza, Italian, Garlic Bread, Pastas',
      'category': 'Pizza',
      'rating': '4.7',
      'reviewCount': '950+',
      'time': '20-25 mins',
      'deliveryFee': '₹25',
      'distance': '1.5 km',
      'offer': 'BUY 1 GET 1 FREE',
      'isOpen': true,
      'popularDishes': ['Paneer Tikka Pizza', 'Cheesy Garlic Bread', 'Tiramisu'],
      'imageUrl': 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&q=80',
      'isVeg': true,
    },
    {
      'name': 'Royal Burger House & Grills',
      'cuisine': 'Burgers, Fast Food, Fries, Shakes',
      'category': 'Burgers',
      'rating': '4.8',
      'reviewCount': '1.5k+',
      'time': '15-20 mins',
      'deliveryFee': 'FREE',
      'distance': '1.1 km',
      'offer': 'FLAT ₹75 OFF',
      'isOpen': true,
      'popularDishes': ['Double Truffle Burger', 'Crispy Peri Fries', 'Belgian Shake'],
      'imageUrl': 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&q=80',
      'isVeg': false,
    },
    {
      'name': 'Punjabi Rasoi Pure Veg',
      'cuisine': 'North Indian, Thali, Breads, Sweets',
      'category': 'Indian',
      'rating': '4.7',
      'reviewCount': '850+',
      'time': '20-25 mins',
      'deliveryFee': 'FREE',
      'distance': '1.2 km',
      'offer': 'FLAT ₹50 CASHBACK',
      'isOpen': true,
      'popularDishes': ['Dal Makhani Thali', 'Paneer Butter Masala', 'Lassi'],
      'imageUrl': 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=600&q=80',
      'isVeg': true,
    },
    {
      'name': 'The Wok House Dragon Asian',
      'cuisine': 'Chinese, Dimsums, Noodles, Thai Curry',
      'category': 'Chinese',
      'rating': '4.6',
      'reviewCount': '600+',
      'time': '30-35 mins',
      'deliveryFee': '₹30',
      'distance': '2.4 km',
      'offer': '20% OFF ON NOODLES',
      'isOpen': true,
      'popularDishes': ['Hakka Noodles', 'Steamed Chicken Momos', 'Green Thai Curry'],
      'imageUrl': 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=600&q=80',
      'isVeg': false,
    },
    {
      'name': 'Early Bird Breakfast & Cafe',
      'cuisine': 'Breakfast, Coffee, Pancakes, Omelettes',
      'category': 'Breakfast',
      'rating': '4.9',
      'reviewCount': '410+',
      'time': '15-20 mins',
      'deliveryFee': 'FREE',
      'distance': '0.9 km',
      'offer': 'FREE COFFEE ON ₹249',
      'isOpen': true,
      'popularDishes': ['English Breakfast Platter', 'Fluffy Blueberry Pancakes', 'Cappuccino'],
      'imageUrl': 'https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?w=600&q=80',
      'isVeg': false,
    },
    {
      'name': 'Sweet Tooth Waffles & Desserts',
      'cuisine': 'Desserts, Cakes, Waffles, Beverages',
      'category': 'Desserts',
      'rating': '4.8',
      'reviewCount': '780+',
      'time': '15-22 mins',
      'deliveryFee': 'FREE',
      'distance': '1.1 km',
      'offer': 'FLAT ₹50 OFF',
      'isOpen': false,
      'popularDishes': ['Belgian Chocolate Waffle', 'Nutella Shake', 'Red Velvet Slice'],
      'imageUrl': 'https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?w=600&q=80',
      'isVeg': true,
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

  @override
  Widget build(BuildContext context) {
    final selectedCategoryName = _categories[_selectedCategory].replaceAll(RegExp(r'^[^\s]+\s*'), '');

    final filtered = _restaurants.where((r) {
      // Category filter check
      final cat = r['category'].toString().toLowerCase();
      final matchesCategory = _selectedCategory == 0 ||
          cat == selectedCategoryName.toLowerCase() ||
          r['cuisine'].toString().toLowerCase().contains(selectedCategoryName.toLowerCase());

      if (!matchesCategory) return false;

      // Search query check
      if (_searchQuery.trim().isEmpty) return true;
      final query = _searchQuery.toLowerCase().trim();
      final name = r['name'].toString().toLowerCase();
      final cuisine = r['cuisine'].toString().toLowerCase();
      final dishes = (r['popularDishes'] as List<String>).join(' ').toLowerCase();

      return name.contains(query) || cuisine.contains(query) || dishes.contains(query);
    }).toList();

    return Scaffold(
      backgroundColor: RestaurantTheme.lightBg,
      appBar: AppBar(
        backgroundColor: RestaurantTheme.charcoal,
        elevation: 0,
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: RestaurantTheme.neonOrange.withValues(alpha: 0.2),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.restaurant_rounded, color: RestaurantTheme.neonOrange, size: 20),
            ),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Text('NABIN', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: Colors.white)),
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
                      decoration: BoxDecoration(
                        color: RestaurantTheme.neonOrange,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: const Text('FOOD', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: 0.5)),
                    ),
                  ],
                ),
                const Text('Delivering to Home • 20 mins', style: TextStyle(fontSize: 11, color: Color(0xFF94A3B8), fontWeight: FontWeight.w500)),
              ],
            ),
          ],
        ),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white, size: 18),
          onPressed: () => context.canPop() ? context.pop() : context.go('/home'),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Search Input
              Container(
                height: 52,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                decoration: BoxDecoration(
                  color: RestaurantTheme.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: RestaurantTheme.border),
                  boxShadow: [
                    BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 8, offset: const Offset(0, 2)),
                  ],
                ),
                child: Row(
                  children: [
                    const Icon(Icons.search_rounded, color: RestaurantTheme.neonOrange, size: 22),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        onChanged: (val) => setState(() => _searchQuery = val),
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: RestaurantTheme.charcoal),
                        decoration: const InputDecoration(
                          hintText: 'Search restaurants, biryani, pizza or dishes...',
                          hintStyle: TextStyle(color: RestaurantTheme.secondaryText, fontSize: 13, fontWeight: FontWeight.normal),
                          border: InputBorder.none,
                          isDense: true,
                        ),
                      ),
                    ),
                    if (_searchQuery.isNotEmpty)
                      GestureDetector(
                        onTap: () => setState(() => _searchQuery = ''),
                        child: const Icon(Icons.close_rounded, size: 18, color: RestaurantTheme.secondaryText),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // Promotional Banner Carousel
              SizedBox(
                height: 124,
                child: PageView.builder(
                  controller: _bannerController,
                  onPageChanged: (idx) => setState(() => _currentBannerIndex = idx),
                  itemCount: _promoBanners.length,
                  itemBuilder: (context, idx) {
                    final banner = _promoBanners[idx];
                    final colors = banner['colors'] as List<Color>;
                    final accent = banner['accent'] as Color;
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
                                    color: Colors.white.withValues(alpha: 0.2),
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: Text(
                                    banner['code'] as String,
                                    style: TextStyle(color: accent, fontSize: 10, fontWeight: FontWeight.w900, letterSpacing: 0.5),
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  banner['title'] as String,
                                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 15),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  banner['subtitle'] as String,
                                  style: TextStyle(color: Colors.white.withValues(alpha: 0.85), fontSize: 11, fontWeight: FontWeight.w500),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),
                          Icon(banner['icon'] as IconData, size: 48, color: Colors.white.withValues(alpha: 0.9)),
                        ],
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(height: 8),

              // Banner Indicator Dots
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
                      color: isSelected ? RestaurantTheme.neonOrange : RestaurantTheme.border,
                      borderRadius: BorderRadius.circular(3),
                    ),
                  );
                }),
              ),
              const SizedBox(height: 16),

              // Categories Horizontal Scroll
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
                          color: isSelected ? RestaurantTheme.neonOrange : RestaurantTheme.white,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: isSelected ? RestaurantTheme.neonOrange : RestaurantTheme.border),
                          boxShadow: isSelected
                              ? [BoxShadow(color: RestaurantTheme.neonOrange.withValues(alpha: 0.3), blurRadius: 6, offset: const Offset(0, 2))]
                              : const [],
                        ),
                        child: Text(
                          _categories[idx],
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
              const SizedBox(height: 20),

              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    _selectedCategory == 0 ? 'Top Nearby Restaurants' : '${_categories[_selectedCategory]} Spots',
                    style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
                  ),
                  Text(
                    '${filtered.length} places',
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: RestaurantTheme.secondaryText),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              if (filtered.isEmpty)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 40),
                  child: Column(
                    children: [
                      Icon(Icons.search_off_rounded, size: 48, color: RestaurantTheme.secondaryText.withValues(alpha: 0.5)),
                      const SizedBox(height: 10),
                      const Text(
                        'No restaurants found',
                        style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: RestaurantTheme.charcoal),
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        'Try searching for another dish or cuisine',
                        style: TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText),
                      ),
                    ],
                  ),
                )
              else
                ...filtered.map((rest) {
                  final dishes = rest['popularDishes'] as List<String>;
                  final isOpen = rest['isOpen'] as bool;
                  final imgUrl = rest['imageUrl'] as String;

                  return GestureDetector(
                    onTap: () => context.push('/restaurant-menu'),
                    child: Container(
                      margin: const EdgeInsets.only(bottom: 14),
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: RestaurantTheme.white,
                        borderRadius: BorderRadius.circular(18),
                        border: Border.all(color: RestaurantTheme.border),
                        boxShadow: [
                          BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 8, offset: const Offset(0, 2)),
                        ],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              ClipRRect(
                                borderRadius: BorderRadius.circular(14),
                                child: Image.network(
                                  imgUrl,
                                  width: 74,
                                  height: 74,
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, __, ___) => Container(
                                    width: 74,
                                    height: 74,
                                    color: RestaurantTheme.lightBg,
                                    child: const Icon(Icons.restaurant, color: RestaurantTheme.neonOrange),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Expanded(
                                          child: Text(
                                            rest['name'] as String,
                                            style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: RestaurantTheme.charcoal),
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                        ),
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                          decoration: BoxDecoration(
                                            color: isOpen ? RestaurantTheme.vegGreen.withValues(alpha: 0.12) : const Color(0xFFF1F5F9),
                                            borderRadius: BorderRadius.circular(6),
                                          ),
                                          child: Text(
                                            isOpen ? '● OPEN' : 'CLOSED',
                                            style: TextStyle(
                                              fontSize: 9,
                                              fontWeight: FontWeight.w900,
                                              color: isOpen ? RestaurantTheme.vegGreen : RestaurantTheme.secondaryText,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      rest['cuisine'] as String,
                                      style: const TextStyle(color: RestaurantTheme.secondaryText, fontSize: 12),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                    const SizedBox(height: 6),
                                    Row(
                                      children: [
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                          decoration: BoxDecoration(
                                            color: RestaurantTheme.vegGreen.withValues(alpha: 0.12),
                                            borderRadius: BorderRadius.circular(6),
                                          ),
                                          child: Row(
                                            children: [
                                              const Icon(Icons.star_rounded, size: 12, color: RestaurantTheme.vegGreen),
                                              const SizedBox(width: 2),
                                              Text(
                                                '${rest['rating']} (${rest['reviewCount']})',
                                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 11, color: RestaurantTheme.vegGreen),
                                              ),
                                            ],
                                          ),
                                        ),
                                        const SizedBox(width: 8),
                                        Text('• ${rest['time']}', style: const TextStyle(color: RestaurantTheme.secondaryText, fontSize: 11, fontWeight: FontWeight.w600)),
                                        const SizedBox(width: 6),
                                        Text('• ${rest['distance']}', style: const TextStyle(color: RestaurantTheme.secondaryText, fontSize: 11)),
                                        const SizedBox(width: 6),
                                        Text('• ${rest['deliveryFee']}', style: const TextStyle(color: RestaurantTheme.charcoal, fontSize: 11, fontWeight: FontWeight.w700)),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          // Popular dishes chips
                          SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: Row(
                              children: dishes.map((dish) {
                                return Container(
                                  margin: const EdgeInsets.only(right: 6),
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: RestaurantTheme.lightBg,
                                    borderRadius: BorderRadius.circular(6),
                                    border: Border.all(color: RestaurantTheme.border),
                                  ),
                                  child: Text(
                                    '🍲 $dish',
                                    style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: RestaurantTheme.charcoal),
                                  ),
                                );
                              }).toList(),
                            ),
                          ),
                          const SizedBox(height: 10),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                                decoration: BoxDecoration(
                                  color: RestaurantTheme.neonOrangeLight,
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(color: RestaurantTheme.neonOrange.withValues(alpha: 0.3)),
                                ),
                                child: Text(
                                  rest['offer'] as String,
                                  style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: RestaurantTheme.neonOrangeDark),
                                ),
                              ),
                              const Row(
                                children: [
                                  Text('View Menu', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: RestaurantTheme.neonOrange)),
                                  SizedBox(width: 2),
                                  Icon(Icons.chevron_right_rounded, size: 16, color: RestaurantTheme.neonOrange),
                                ],
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  );
                }),
              const SizedBox(height: 30),
            ],
          ),
        ),
      ),
    );
  }
}

