import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/restaurant_theme.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../widgets/restaurant_menu_operations_sheet.dart';

class RestaurantMenuOverviewScreen extends StatefulWidget {
  const RestaurantMenuOverviewScreen({super.key});

  @override
  State<RestaurantMenuOverviewScreen> createState() => _RestaurantMenuOverviewScreenState();
}

class _RestaurantMenuOverviewScreenState extends State<RestaurantMenuOverviewScreen> {
  bool _isLoading = false;
  String _selectedCategory = 'All';

  List<Map<String, dynamic>> _dishes = [
    {
      'id': 'dish_1',
      'name': 'Chicken Momo Special',
      'category': 'Momos & Tibetan Delicacies',
      'price': 220,
      'isVeg': false,
      'isAvailable': true,
      'isStar': true,
      'revenueShare': '32% of today\'s sales'
    },
    {
      'id': 'dish_2',
      'name': 'Paneer Tikka Kebab',
      'category': 'Tandoor & Starters',
      'price': 280,
      'isVeg': true,
      'isAvailable': true,
      'isStar': false,
      'revenueShare': '14% of today\'s sales'
    },
    {
      'id': 'dish_3',
      'name': 'Chicken Dum Biryani',
      'category': 'Biryani & Rice Bowls',
      'price': 340,
      'isVeg': false,
      'isAvailable': false, // 86'd out
      'isStar': true,
      'revenueShare': '24% of today\'s sales'
    },
    {
      'id': 'dish_4',
      'name': 'Garlic Butter Naan',
      'category': 'Tandoor & Breads',
      'price': 70,
      'isVeg': true,
      'isAvailable': true,
      'isStar': false,
      'revenueShare': '8% of today\'s sales'
    },
  ];

  @override
  void initState() {
    super.initState();
    _fetchCatalog();
  }

  Future<void> _fetchCatalog() async {
    setState(() => _isLoading = true);
    final res = await NabinApiService.getMerchantCatalog();
    if (!mounted) return;
    setState(() {
      _isLoading = false;
      if (res != null && res['products'] is List && (res['products'] as List).isNotEmpty) {
        _dishes = List<Map<String, dynamic>>.from(res['products'] as List);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final activeDishes = _dishes.where((d) => d['isAvailable'] == true).length;
    final outOfStockCount = _dishes.where((d) => d['isAvailable'] == false).length;

    return Scaffold(
      backgroundColor: RestaurantTheme.bgSurface,
      appBar: AppBar(
        title: const Text('Menu Overview (RM-026)', style: TextStyle(fontWeight: FontWeight.w900)),
        actions: [
          IconButton(
            icon: const Icon(Icons.bolt, color: RestaurantTheme.neonOrange),
            tooltip: 'Bulk Operations (RM-033)',
            onPressed: () => RestaurantMenuOperationsSheet.showBulkMenuSheet(context, dishes: _dishes, onRefreshed: _fetchCatalog),
          ),
          IconButton(
            icon: const Icon(Icons.schedule),
            tooltip: 'Availability & Shifts (RM-032)',
            onPressed: () => RestaurantMenuOperationsSheet.showMenuSchedulingSheet(context),
          ),
          IconButton(
            icon: const Icon(Icons.category_outlined),
            tooltip: 'Categories (RM-027)',
            onPressed: () => RestaurantMenuOperationsSheet.showCategoriesSheet(context),
          ),
          IconButton(icon: const Icon(Icons.refresh), onPressed: _fetchCatalog),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 4 Metrics Cards
              Row(
                children: [
                  Expanded(child: _buildMetricCard('Active Dishes', '$activeDishes', '91.7% Live', RestaurantTheme.statusReadyGreen, Icons.restaurant)),
                  const SizedBox(width: 8),
                  Expanded(child: _buildMetricCard('Live Categories', '5', 'All Visible', RestaurantTheme.primaryBlue, Icons.category)),
                  const SizedBox(width: 8),
                  Expanded(child: _buildMetricCard('86\'d Out', '$outOfStockCount', 'Restock Alert', RestaurantTheme.neonOrange, Icons.remove_shopping_cart)),
                ],
              ),
              const SizedBox(height: 16),

              // Menu Health & Analytics Bento Card
              _buildAnalyticsBentoCard(),
              const SizedBox(height: 16),

              // Quick Action Bar
              Row(
                children: [
                  Expanded(
                    child: ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: RestaurantTheme.primaryBlue,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      icon: const Icon(Icons.add_circle_outline, size: 18),
                      label: const Text('Add Dish (RM-029)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                      onPressed: () => context.push('/menu/add'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    icon: const Icon(Icons.tune, size: 18),
                    label: const Text('Customizations (RM-031)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                    onPressed: () => RestaurantMenuOperationsSheet.showCustomizationsSheet(context),
                  ),
                ],
              ),
              const SizedBox(height: 20),

              // Catalog List Header & Category Selector
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Dishes Catalog (RM-028)', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                  Text('${_dishes.length} Items Total', style: const TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText, fontWeight: FontWeight.bold)),
                ],
              ),
              const SizedBox(height: 10),

              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: ['All', 'Momos & Tibetan Delicacies', 'Biryani & Rice Bowls', 'Tandoor & Curries', 'Beverages'].map((cat) {
                    final isSel = _selectedCategory == cat;
                    return Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: ChoiceChip(
                        label: Text(cat),
                        selected: isSel,
                        selectedColor: RestaurantTheme.primaryBlue,
                        labelStyle: TextStyle(color: isSel ? Colors.white : RestaurantTheme.charcoal, fontWeight: FontWeight.bold, fontSize: 11.5),
                        onSelected: (val) => setState(() => _selectedCategory = cat),
                      ),
                    );
                  }).toList(),
                ),
              ),
              const SizedBox(height: 12),

              // Dishes List
              ..._dishes.map((dish) => _buildDishCard(dish)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMetricCard(String label, String value, String subtitle, Color color, IconData icon) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: RestaurantTheme.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: RestaurantTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: color)),
              Icon(icon, size: 18, color: color),
            ],
          ),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.secondaryText)),
          Text(subtitle, style: TextStyle(fontSize: 9.5, color: color, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }

  Widget _buildAnalyticsBentoCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: RestaurantTheme.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: RestaurantTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.insights, color: RestaurantTheme.primaryBlue, size: 18),
                  SizedBox(width: 8),
                  Text('Menu Health & Analytics', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(color: RestaurantTheme.primaryBlue.withAlpha(20), borderRadius: BorderRadius.circular(10)),
                child: const Text('Today\'s Shift', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: RestaurantTheme.primaryBlue)),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Star Item Highlight
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: RestaurantTheme.lightBg,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(color: RestaurantTheme.neonOrange.withAlpha(20), borderRadius: BorderRadius.circular(8)),
                  child: const Icon(Icons.star, color: RestaurantTheme.neonOrange, size: 24),
                ),
                const SizedBox(width: 10),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text('Chicken Momo Special', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: RestaurantTheme.charcoal)),
                          SizedBox(width: 6),
                          Text('Star Item', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: RestaurantTheme.statusReadyGreen)),
                        ],
                      ),
                      Text('Generates 32% of today\'s gross sales', style: TextStyle(fontSize: 11, color: RestaurantTheme.secondaryText)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // Category Volume Sparkline
          const Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Category Sales Volume', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.secondaryText)),
              Text('₹2,840.00 Total', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: RestaurantTheme.charcoal)),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: Row(
              children: [
                Expanded(flex: 42, child: Container(height: 6, color: RestaurantTheme.primaryBlue)),
                Expanded(flex: 28, child: Container(height: 6, color: RestaurantTheme.neonOrange)),
                Expanded(flex: 18, child: Container(height: 6, color: RestaurantTheme.statusReadyGreen)),
                Expanded(flex: 12, child: Container(height: 6, color: RestaurantTheme.border)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDishCard(Map<String, dynamic> dish) {
    final isAvail = dish['isAvailable'] == true;
    final isVeg = dish['isVeg'] == true;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: RestaurantTheme.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: RestaurantTheme.border),
      ),
      child: Row(
        children: [
          Container(
            width: 50,
            height: 50,
            decoration: BoxDecoration(
              color: RestaurantTheme.lightBg,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Center(
              child: Icon(
                isVeg ? Icons.eco : Icons.kebab_dining,
                color: isVeg ? RestaurantTheme.statusReadyGreen : RestaurantTheme.nonVegRed,
                size: 24,
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
                        dish['name'] ?? 'Dish Name',
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: RestaurantTheme.charcoal),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Text('₹${dish['price'] ?? 200}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: RestaurantTheme.primaryBlue)),
                  ],
                ),
                const SizedBox(height: 2),
                Text(dish['category'] ?? 'Category', style: const TextStyle(fontSize: 11, color: RestaurantTheme.secondaryText)),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: isAvail ? RestaurantTheme.statusReadyBg : RestaurantTheme.nonVegRed.withAlpha(20),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        isAvail ? 'In Stock' : '86\'d Out',
                        style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: isAvail ? RestaurantTheme.statusReadyGreen : RestaurantTheme.nonVegRed),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(isVeg ? 'Pure Veg' : 'Non-Veg', style: const TextStyle(fontSize: 10, color: RestaurantTheme.secondaryText)),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Switch(
            value: isAvail,
            activeColor: RestaurantTheme.statusReadyGreen,
            onChanged: (val) async {
              setState(() => dish['isAvailable'] = val);
              await NabinApiService.bulkUpdateDishAvailability(
                dishIds: [dish['id'] as String],
                isAvailable: val,
              );
            },
          ),
        ],
      ),
    );
  }
}
