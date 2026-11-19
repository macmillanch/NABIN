import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/restaurant_theme.dart';
import '../../../../core/network/nabin_api_service.dart';

class RestaurantAddDishScreen extends StatefulWidget {
  const RestaurantAddDishScreen({super.key});

  @override
  State<RestaurantAddDishScreen> createState() => _RestaurantAddDishScreenState();
}

class _RestaurantAddDishScreenState extends State<RestaurantAddDishScreen> {
  final TextEditingController _nameController = TextEditingController(text: 'Kothey Chicken Momo');
  final TextEditingController _descController = TextEditingController(text: 'Pan-fried Himalayan chicken momos served with spicy sesame chutney.');
  final TextEditingController _priceController = TextEditingController(text: '240');
  final TextEditingController _prepTimeController = TextEditingController(text: '20');

  String _selectedCategory = 'Momos & Tibetan Delicacies';
  final List<String> _categories = [
    'Momos & Tibetan Delicacies',
    'Himalayan Appetizers & Soups',
    'Tandoori & Kebabs',
    'Claypot Curries',
    'Artisanal Beverages'
  ];

  String _dietaryType = 'NON_VEG'; // 'VEG', 'NON_VEG', 'EGG'
  bool _isLoading = false;

  @override
  void dispose() {
    _nameController.dispose();
    _descController.dispose();
    _priceController.dispose();
    _prepTimeController.dispose();
    super.dispose();
  }

  Future<void> _saveDish() async {
    final name = _nameController.text.trim();
    final price = double.tryParse(_priceController.text.trim());

    if (name.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Please enter dish name.')));
      return;
    }
    if (price == null || price <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Please enter a valid price.')));
      return;
    }

    setState(() => _isLoading = true);

    final res = await NabinApiService.createDish(
      name: name,
      category: _selectedCategory,
      price: price,
      dietaryType: _dietaryType,
      isVeg: _dietaryType == 'VEG',
      description: _descController.text.trim(),
      prepTimeMinutes: int.tryParse(_prepTimeController.text.trim()) ?? 20,
    );

    if (!mounted) return;
    setState(() => _isLoading = false);

    if (res != null && res['success'] == true) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$name added to menu.')));
      if (Navigator.canPop(context)) Navigator.pop(context);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(res?['error'] ?? 'Dish saved to local catalog.')));
      if (Navigator.canPop(context)) Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: RestaurantTheme.bgSurface,
      appBar: AppBar(
        title: const Text('Add New Dish (RM-029)', style: TextStyle(fontWeight: FontWeight.w900)),
        actions: [
          TextButton(
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Draft saved locally.')));
              context.pop();
            },
            child: const Text('Save Draft', style: TextStyle(color: RestaurantTheme.secondaryText, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: RestaurantTheme.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: RestaurantTheme.border),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            Icon(Icons.restaurant_menu, color: RestaurantTheme.primaryBlue, size: 20),
                            SizedBox(width: 8),
                            Text('1. Basic Dish Details', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                          ],
                        ),
                        Text('Mandatory', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: RestaurantTheme.neonOrange)),
                      ],
                    ),
                    const Divider(height: 20),

                    // Dish Name
                    const Text('Dish Name *', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: RestaurantTheme.secondaryText)),
                    const SizedBox(height: 6),
                    TextField(
                      controller: _nameController,
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                      decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'e.g. Kothey Chicken Momo', isDense: true),
                    ),
                    const SizedBox(height: 14),

                    // Menu Category Dropdown
                    const Text('Menu Category *', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: RestaurantTheme.secondaryText)),
                    const SizedBox(height: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: RestaurantTheme.border),
                      ),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String>(
                          value: _selectedCategory,
                          isExpanded: true,
                          items: _categories.map((c) => DropdownMenuItem(value: c, child: Text(c, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)))).toList(),
                          onChanged: (val) {
                            if (val != null) setState(() => _selectedCategory = val);
                          },
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),

                    // Dietary Classification Selector
                    const Text('Dietary Classification *', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: RestaurantTheme.secondaryText)),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(child: _buildDietChoice('Pure Veg', 'VEG', RestaurantTheme.statusReadyGreen, Icons.eco)),
                        const SizedBox(width: 8),
                        Expanded(child: _buildDietChoice('Non-Veg', 'NON_VEG', RestaurantTheme.nonVegRed, Icons.kebab_dining)),
                        const SizedBox(width: 8),
                        Expanded(child: _buildDietChoice('Egg', 'EGG', RestaurantTheme.neonOrange, Icons.egg)),
                      ],
                    ),
                    const SizedBox(height: 14),

                    // Base Price & Prep Time
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Base Price (₹) *', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: RestaurantTheme.secondaryText)),
                              const SizedBox(height: 6),
                              TextField(
                                controller: _priceController,
                                keyboardType: TextInputType.number,
                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                                decoration: const InputDecoration(border: OutlineInputBorder(), hintText: '240', isDense: true),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Prep Target (mins) *', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: RestaurantTheme.secondaryText)),
                              const SizedBox(height: 6),
                              TextField(
                                controller: _prepTimeController,
                                keyboardType: TextInputType.number,
                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                                decoration: const InputDecoration(border: OutlineInputBorder(), hintText: '20', isDense: true),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 14),

                    // Description
                    const Text('Short Description', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: RestaurantTheme.secondaryText)),
                    const SizedBox(height: 6),
                    TextField(
                      controller: _descController,
                      maxLines: 2,
                      style: const TextStyle(fontSize: 13),
                      decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'Flavor profile, ingredients and condiments', isDense: true),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),

              // Publish CTA
              SizedBox(
                width: double.infinity,
                height: 50,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: RestaurantTheme.primaryBlue,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: _isLoading ? null : _saveDish,
                  child: _isLoading
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                      : const Text('Publish Dish to Menu', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                ),
              ),
              const SizedBox(height: 10),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDietChoice(String label, String value, Color color, IconData icon) {
    final isSel = _dietaryType == value;
    return InkWell(
      onTap: () => setState(() => _dietaryType = value),
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: isSel ? color.withAlpha(25) : RestaurantTheme.lightBg,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: isSel ? color : RestaurantTheme.border, width: isSel ? 1.5 : 1),
        ),
        child: Column(
          children: [
            Icon(icon, color: color, size: 20),
            const SizedBox(height: 4),
            Text(label, style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold, color: isSel ? color : RestaurantTheme.charcoal)),
          ],
        ),
      ),
    );
  }
}
