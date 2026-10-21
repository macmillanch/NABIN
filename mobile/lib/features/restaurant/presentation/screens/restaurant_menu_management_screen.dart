import 'package:flutter/material.dart';
import '../../../../core/theme/restaurant_theme.dart';

/// Data model for dish sizing variants
class DishVariantModel {
  DishVariantModel({
    required this.id,
    required this.name,
    required this.price,
    this.isAvailable = true,
  });

  final String id;
  String name;
  double price;
  bool isAvailable;

  Map<String, dynamic> toMap() => {
    'id': id,
    'name': name,
    'price': price,
    'isAvailable': isAvailable,
  };

  factory DishVariantModel.fromMap(Map<String, dynamic> map) => DishVariantModel(
    id: map['id']?.toString() ?? '',
    name: map['name']?.toString() ?? '',
    price: (map['price'] as num?)?.toDouble() ?? 0.0,
    isAvailable: map['isAvailable'] != false,
  );
}

/// Data model for dish add-on options
class DishAddOnOptionModel {
  DishAddOnOptionModel({
    required this.id,
    required this.name,
    required this.price,
    this.isAvailable = true,
  });

  final String id;
  String name;
  double price;
  bool isAvailable;

  Map<String, dynamic> toMap() => {
    'id': id,
    'name': name,
    'price': price,
    'isAvailable': isAvailable,
  };

  factory DishAddOnOptionModel.fromMap(Map<String, dynamic> map) => DishAddOnOptionModel(
    id: map['id']?.toString() ?? '',
    name: map['name']?.toString() ?? '',
    price: (map['price'] as num?)?.toDouble() ?? 0.0,
    isAvailable: map['isAvailable'] != false,
  );
}

/// Data model for dish add-on groups
class DishAddOnGroupModel {
  DishAddOnGroupModel({
    required this.id,
    required this.name,
    this.isRequired = false,
    this.selectionType = 'single',
    this.minSelect = 0,
    this.maxSelect = 1,
    List<DishAddOnOptionModel>? options,
  }) : options = options ?? [];

  final String id;
  String name;
  bool isRequired;
  String selectionType; // 'single' | 'multi'
  int minSelect;
  int maxSelect;
  List<DishAddOnOptionModel> options;

  Map<String, dynamic> toMap() => {
    'id': id,
    'name': name,
    'isRequired': isRequired,
    'selectionType': selectionType,
    'minSelect': minSelect,
    'maxSelect': maxSelect,
    'options': options.map((o) => o.toMap()).toList(),
  };

  factory DishAddOnGroupModel.fromMap(Map<String, dynamic> map) => DishAddOnGroupModel(
    id: map['id']?.toString() ?? '',
    name: map['name']?.toString() ?? '',
    isRequired: map['isRequired'] == true,
    selectionType: map['selectionType']?.toString() ?? 'single',
    minSelect: (map['minSelect'] as num?)?.toInt() ?? 0,
    maxSelect: (map['maxSelect'] as num?)?.toInt() ?? 1,
    options: (map['options'] as List?)
            ?.map((e) => DishAddOnOptionModel.fromMap(Map<String, dynamic>.from(e as Map)))
            .toList() ??
        [],
  );
}

/// Data model for complete restaurant dish
class RestaurantDishModel {
  RestaurantDishModel({
    required this.id,
    required this.name,
    this.shortDescription = '',
    this.description = '',
    required this.category,
    this.foodType = 'veg', // 'veg', 'non-veg', 'egg', 'vegan'
    required this.basePrice,
    required this.sellingPrice,
    this.mrp = 0,
    this.prepTime = 20,
    this.isAvailable = true,
    this.isFeatured = false,
    List<String>? photos,
    this.primaryPhotoIndex = 0,
    List<DishVariantModel>? variants,
    List<DishAddOnGroupModel>? addOnGroups,
  })  : photos = photos ?? [],
        variants = variants ?? [],
        addOnGroups = addOnGroups ?? [];

  final String id;
  String name;
  String shortDescription;
  String description;
  String category;
  String foodType;
  double basePrice;
  double sellingPrice;
  double mrp;
  int prepTime;
  bool isAvailable;
  bool isFeatured;
  List<String> photos;
  int primaryPhotoIndex;
  List<DishVariantModel> variants;
  List<DishAddOnGroupModel> addOnGroups;

  Map<String, dynamic> toMap() => {
    'id': id,
    'name': name,
    'shortDescription': shortDescription,
    'description': description,
    'category': category,
    'foodType': foodType,
    'basePrice': basePrice,
    'sellingPrice': sellingPrice,
    'mrp': mrp,
    'prepTime': prepTime,
    'isAvailable': isAvailable,
    'isFeatured': isFeatured,
    'photos': photos,
    'primaryPhotoIndex': primaryPhotoIndex,
    'variants': variants.map((v) => v.toMap()).toList(),
    'addOnGroups': addOnGroups.map((g) => g.toMap()).toList(),
  };

  factory RestaurantDishModel.fromMap(Map<String, dynamic> map) => RestaurantDishModel(
    id: map['id']?.toString() ?? '',
    name: map['name']?.toString() ?? '',
    shortDescription: map['shortDescription']?.toString() ?? '',
    description: map['description']?.toString() ?? '',
    category: map['category']?.toString() ?? 'Main Course',
    foodType: map['foodType']?.toString() ?? 'veg',
    basePrice: (map['basePrice'] as num?)?.toDouble() ?? 0.0,
    sellingPrice: (map['sellingPrice'] as num?)?.toDouble() ?? 0.0,
    mrp: (map['mrp'] as num?)?.toDouble() ?? 0.0,
    prepTime: (map['prepTime'] as num?)?.toInt() ?? 20,
    isAvailable: map['isAvailable'] != false,
    isFeatured: map['isFeatured'] == true,
    photos: (map['photos'] as List?)?.map((e) => e.toString()).toList() ?? [],
    primaryPhotoIndex: (map['primaryPhotoIndex'] as num?)?.toInt() ?? 0,
    variants: (map['variants'] as List?)
            ?.map((e) => DishVariantModel.fromMap(Map<String, dynamic>.from(e as Map)))
            .toList() ??
        [],
    addOnGroups: (map['addOnGroups'] as List?)
            ?.map((e) => DishAddOnGroupModel.fromMap(Map<String, dynamic>.from(e as Map)))
            .toList() ??
        [],
  );
}

/// Built-in curated sample food photos for local demo usage
final List<String> kSampleFoodPhotos = [
  'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=600&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=600&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=600&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=600&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=600&auto=format&fit=crop&q=80',
];

/// Initial demo dishes seed
List<RestaurantDishModel> _createDefaultDishes() {
  return [
    RestaurantDishModel(
      id: 'dish-demo-1',
      name: 'Royal Mutton Dum Biryani',
      shortDescription: 'Slow-cooked aromatic Dum Biryani with tender mutton shanks',
      description: 'Slow cooked in traditional copper handi with long-grain aged basmati rice, tender succulent mutton pieces, aromatic whole spices, saffron milk, and fried golden onions. Served with spiced cucumber raita and salan.',
      category: 'Main Course',
      foodType: 'non-veg',
      basePrice: 380,
      sellingPrice: 340,
      mrp: 380,
      prepTime: 30,
      isAvailable: true,
      isFeatured: true,
      photos: [
        'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=600&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=600&auto=format&fit=crop&q=80',
      ],
      primaryPhotoIndex: 0,
      variants: [
        DishVariantModel(id: 'var-mb-1', name: 'Half (Serves 1, 1 Shank)', price: 340, isAvailable: true),
        DishVariantModel(id: 'var-mb-2', name: 'Full (Serves 2, 2 Shanks)', price: 580, isAvailable: true),
        DishVariantModel(id: 'var-mb-3', name: 'Family Handi (Serves 4)', price: 1050, isAvailable: true),
      ],
      addOnGroups: [
        DishAddOnGroupModel(
          id: 'grp-mb-1',
          name: 'Extra Gravy & Accompaniments',
          isRequired: false,
          selectionType: 'multi',
          minSelect: 0,
          maxSelect: 3,
          options: [
            DishAddOnOptionModel(id: 'opt-mb-1', name: 'Special Mirchi Ka Salan (150ml)', price: 40, isAvailable: true),
            DishAddOnOptionModel(id: 'opt-mb-2', name: 'Burani Spiced Garlic Raita', price: 35, isAvailable: true),
            DishAddOnOptionModel(id: 'opt-mb-3', name: 'Extra Boiled Egg (2 pcs)', price: 30, isAvailable: true),
          ],
        ),
      ],
    ),
    RestaurantDishModel(
      id: 'dish-demo-2',
      name: 'Paneer Butter Masala',
      shortDescription: 'Cottage cheese cubes simmered in rich creamy tomato cashew gravy',
      description: 'Fresh malai paneer simmered in a velvet tomato and cashew nut gravy, subtly flavoured with dried fenugreek leaves (kasuri methi) and freshly churned butter.',
      category: 'Main Course',
      foodType: 'veg',
      basePrice: 280,
      sellingPrice: 260,
      mrp: 290,
      prepTime: 20,
      isAvailable: true,
      isFeatured: false,
      photos: [
        'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=600&auto=format&fit=crop&q=80',
      ],
      primaryPhotoIndex: 0,
      variants: [
        DishVariantModel(id: 'var-pbm-1', name: 'Regular Portion (350ml)', price: 260, isAvailable: true),
        DishVariantModel(id: 'var-pbm-2', name: 'Large Portion (600ml)', price: 420, isAvailable: true),
      ],
      addOnGroups: [
        DishAddOnGroupModel(
          id: 'grp-pbm-1',
          name: 'Spice Level',
          isRequired: true,
          selectionType: 'single',
          minSelect: 1,
          maxSelect: 1,
          options: [
            DishAddOnOptionModel(id: 'opt-spc-1', name: 'Mild & Creamy', price: 0, isAvailable: true),
            DishAddOnOptionModel(id: 'opt-spc-2', name: 'Medium Spicy', price: 0, isAvailable: true),
            DishAddOnOptionModel(id: 'opt-spc-3', name: 'Desi Spicy (Hot)', price: 0, isAvailable: true),
          ],
        ),
      ],
    ),
  ];
}

/// Full Restaurant Menu Management Screen
class RestaurantMenuManagementScreen extends StatefulWidget {
  const RestaurantMenuManagementScreen({super.key});

  @override
  State<RestaurantMenuManagementScreen> createState() => _RestaurantMenuManagementScreenState();
}

class _RestaurantMenuManagementScreenState extends State<RestaurantMenuManagementScreen> {
  late List<RestaurantDishModel> _dishes;
  String _searchQuery = '';
  String _selectedCategory = 'All';
  String _availabilityFilter = 'All'; // 'All', 'Available', 'Sold Out'
  final List<String> _categories = ['All', 'Main Course', 'Starters', 'Biryani & Rice', 'Breads', 'Desserts', 'Beverages'];

  @override
  void initState() {
    super.initState();
    _dishes = _createDefaultDishes();
  }

  List<RestaurantDishModel> get _filteredDishes {
    return _dishes.where((dish) {
      if (_selectedCategory != 'All' && dish.category != _selectedCategory) {
        return false;
      }
      if (_availabilityFilter == 'Available' && !dish.isAvailable) {
        return false;
      }
      if (_availabilityFilter == 'Sold Out' && dish.isAvailable) {
        return false;
      }
      if (_searchQuery.trim().isNotEmpty) {
        final q = _searchQuery.toLowerCase();
        final matchesName = dish.name.toLowerCase().contains(q);
        final matchesDesc = dish.description.toLowerCase().contains(q);
        final matchesCat = dish.category.toLowerCase().contains(q);
        if (!matchesName && !matchesDesc && !matchesCat) return false;
      }
      return true;
    }).toList();
  }

  void _openAddDishSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _DishFormSheet(
        categories: _categories.where((c) => c != 'All').toList(),
        onSave: (newDish) {
          setState(() {
            _dishes.insert(0, newDish);
          });
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Dish "${newDish.name}" added to menu catalog.'),
              backgroundColor: RestaurantTheme.vegGreen,
            ),
          );
        },
      ),
    );
  }

  void _openEditDishSheet(RestaurantDishModel dish) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _DishFormSheet(
        initialDish: dish,
        categories: _categories.where((c) => c != 'All').toList(),
        onSave: (updatedDish) {
          setState(() {
            final idx = _dishes.indexWhere((d) => d.id == updatedDish.id);
            if (idx != -1) {
              _dishes[idx] = updatedDish;
            }
          });
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Updated "${updatedDish.name}".'),
              backgroundColor: RestaurantTheme.vegGreen,
            ),
          );
        },
      ),
    );
  }

  void _openCustomerPreview(RestaurantDishModel dish) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _CustomerDishPreviewSheet(dish: dish),
    );
  }

  void _deleteDish(RestaurantDishModel dish) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Dish?'),
        content: Text('Are you sure you want to delete "${dish.name}" from your restaurant menu? This action cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () {
              Navigator.pop(ctx);
              setState(() {
                _dishes.removeWhere((d) => d.id == dish.id);
              });
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Removed "${dish.name}" from menu.'),
                  backgroundColor: Colors.red,
                ),
              );
            },
            child: const Text('Delete', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filteredDishes;

    return Scaffold(
      backgroundColor: const Color(0xFFF8F9FA),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Restaurant Menu Studio',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
            ),
            Text(
              'Dishes, Variants, Add-ons & Live Preview',
              style: TextStyle(fontSize: 11, color: RestaurantTheme.secondaryText),
            ),
          ],
        ),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 12),
            child: ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: RestaurantTheme.neonOrange,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                elevation: 0,
              ),
              onPressed: _openAddDishSheet,
              icon: const Icon(Icons.add, size: 18),
              label: const Text('Add Dish', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          // Demo Banner
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: const Color(0xFFFFF7ED),
            child: const Row(
              children: [
                Icon(Icons.info_outline, size: 16, color: Color(0xFFC2410C)),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Interactive Demo State: Changes are preserved in session memory for live testing.',
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Color(0xFFC2410C)),
                  ),
                ),
              ],
            ),
          ),

          // Search & Filter Bar
          Container(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            color: Colors.white,
            child: Column(
              children: [
                TextField(
                  onChanged: (val) => setState(() => _searchQuery = val),
                  decoration: InputDecoration(
                    hintText: 'Search dishes by name, category, or ingredients...',
                    prefixIcon: const Icon(Icons.search, size: 20, color: RestaurantTheme.secondaryText),
                    filled: true,
                    fillColor: const Color(0xFFF1F5F9),
                    contentPadding: const EdgeInsets.symmetric(vertical: 10),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                // Category Pills
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: _categories.map((cat) {
                      final isSelected = _selectedCategory == cat;
                      return Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          label: Text(cat),
                          selected: isSelected,
                          selectedColor: RestaurantTheme.neonOrangeLight,
                          labelStyle: TextStyle(
                            fontSize: 12,
                            fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                            color: isSelected ? RestaurantTheme.neonOrangeDark : RestaurantTheme.charcoal,
                          ),
                          onSelected: (_) => setState(() => _selectedCategory = cat),
                        ),
                      );
                    }).toList(),
                  ),
                ),
                const SizedBox(height: 6),
                // Availability Filter Pills
                Row(
                  children: [
                    const Text('Status: ', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: RestaurantTheme.secondaryText)),
                    const SizedBox(width: 8),
                    ...['All', 'Available', 'Sold Out'].map((filter) {
                      final isSelected = _availabilityFilter == filter;
                      return Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: InkWell(
                          onTap: () => setState(() => _availabilityFilter = filter),
                          borderRadius: BorderRadius.circular(6),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(
                              color: isSelected ? RestaurantTheme.charcoal : const Color(0xFFF1F5F9),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              filter,
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                color: isSelected ? Colors.white : RestaurantTheme.secondaryText,
                              ),
                            ),
                          ),
                        ),
                      );
                    }),
                  ],
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: RestaurantTheme.border),

          // Dishes List
          Expanded(
            child: filtered.isEmpty
                ? Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.restaurant_menu, size: 48, color: RestaurantTheme.secondaryText),
                        const SizedBox(height: 12),
                        const Text(
                          'No dishes match your filter',
                          style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: RestaurantTheme.charcoal),
                        ),
                        const SizedBox(height: 6),
                        TextButton(
                          onPressed: () => setState(() {
                            _searchQuery = '';
                            _selectedCategory = 'All';
                            _availabilityFilter = 'All';
                          }),
                          child: const Text('Reset Filters', style: TextStyle(color: RestaurantTheme.neonOrange)),
                        ),
                      ],
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: filtered.length,
                    itemBuilder: (context, index) {
                      final dish = filtered[index];
                      return _buildDishCard(dish);
                    },
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildDishCard(RestaurantDishModel dish) {
    final photoUrl = dish.photos.isNotEmpty ? dish.photos[dish.primaryPhotoIndex] : null;

    Color foodTypeColor;
    String foodTypeLabel;
    switch (dish.foodType) {
      case 'veg':
        foodTypeColor = RestaurantTheme.vegGreen;
        foodTypeLabel = 'VEG';
        break;
      case 'vegan':
        foodTypeColor = const Color(0xFF10B981);
        foodTypeLabel = 'VEGAN';
        break;
      case 'egg':
        foodTypeColor = const Color(0xFFF59E0B);
        foodTypeLabel = 'EGG';
        break;
      default:
        foodTypeColor = const Color(0xFFEF4444);
        foodTypeLabel = 'NON-VEG';
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: dish.isAvailable ? RestaurantTheme.border : const Color(0xFFFECACA),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Card Header with Image and Details
          Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Dish Photo thumbnail
                ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: photoUrl != null
                      ? Image.network(
                          photoUrl,
                          width: 84,
                          height: 84,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => Container(
                            width: 84,
                            height: 84,
                            color: RestaurantTheme.lightBg,
                            child: const Icon(Icons.fastfood, color: RestaurantTheme.neonOrange, size: 32),
                          ),
                        )
                      : Container(
                          width: 84,
                          height: 84,
                          color: RestaurantTheme.lightBg,
                          child: const Icon(Icons.fastfood, color: RestaurantTheme.neonOrange, size: 32),
                        ),
                ),
                const SizedBox(width: 14),
                // Dish Info
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                            decoration: BoxDecoration(
                              border: Border.all(color: foodTypeColor, width: 1.5),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              foodTypeLabel,
                              style: TextStyle(fontSize: 8.5, fontWeight: FontWeight.w900, color: foodTypeColor),
                            ),
                          ),
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF1F5F9),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              dish.category,
                              style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: RestaurantTheme.secondaryText),
                            ),
                          ),
                          if (dish.isFeatured) ...[
                            const SizedBox(width: 6),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: const Color(0xFFFEF3C7),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: const Text(
                                '★ FEATURED',
                                style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: Color(0xFFD97706)),
                              ),
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        dish.name,
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        dish.shortDescription.isNotEmpty ? dish.shortDescription : dish.description,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 11.5, color: RestaurantTheme.secondaryText),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Text(
                            '₹${dish.sellingPrice.toStringAsFixed(0)}',
                            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: RestaurantTheme.neonOrangeDark),
                          ),
                          if (dish.mrp > dish.sellingPrice) ...[
                            const SizedBox(width: 6),
                            Text(
                              '₹${dish.mrp.toStringAsFixed(0)}',
                              style: const TextStyle(
                                fontSize: 12,
                                decoration: TextDecoration.lineThrough,
                                color: RestaurantTheme.secondaryText,
                              ),
                            ),
                          ],
                          const Spacer(),
                          const Icon(Icons.timer_outlined, size: 14, color: RestaurantTheme.secondaryText),
                          const SizedBox(width: 4),
                          Text('${dish.prepTime} min', style: const TextStyle(fontSize: 11.5, color: RestaurantTheme.secondaryText)),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Variants and Add-ons badges
          if (dish.variants.isNotEmpty || dish.addOnGroups.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: Wrap(
                spacing: 8,
                runSpacing: 4,
                children: [
                  if (dish.variants.isNotEmpty)
                    Chip(
                      backgroundColor: const Color(0xFFEFF6FF),
                      labelPadding: const EdgeInsets.symmetric(horizontal: 4),
                      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      label: Text(
                        '${dish.variants.length} Sizes/Variants',
                        style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Color(0xFF1D4ED8)),
                      ),
                    ),
                  if (dish.addOnGroups.isNotEmpty)
                    Chip(
                      backgroundColor: const Color(0xFFF5F3FF),
                      labelPadding: const EdgeInsets.symmetric(horizontal: 4),
                      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      label: Text(
                        '${dish.addOnGroups.length} Add-on Groups',
                        style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Color(0xFF6D28D9)),
                      ),
                    ),
                ],
              ),
            ),

          const Divider(height: 1, color: RestaurantTheme.border),

          // Action Toolbar
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Row(
              children: [
                // In Stock / Sold Out switch
                Row(
                  children: [
                    Switch(
                      value: dish.isAvailable,
                      activeColor: RestaurantTheme.vegGreen,
                      onChanged: (val) {
                        setState(() => dish.isAvailable = val);
                      },
                    ),
                    Text(
                      dish.isAvailable ? 'In Stock' : 'Sold Out',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: dish.isAvailable ? RestaurantTheme.vegGreen : Colors.red,
                      ),
                    ),
                  ],
                ),
                const Spacer(),
                // Customer Preview button
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    side: const BorderSide(color: RestaurantTheme.border),
                  ),
                  onPressed: () => _openCustomerPreview(dish),
                  icon: const Icon(Icons.remove_red_eye_outlined, size: 14, color: RestaurantTheme.charcoal),
                  label: const Text('Preview', style: TextStyle(fontSize: 12, color: RestaurantTheme.charcoal)),
                ),
                const SizedBox(width: 8),
                // Edit button
                IconButton(
                  icon: const Icon(Icons.edit_outlined, size: 18, color: RestaurantTheme.charcoal),
                  tooltip: 'Edit Dish',
                  onPressed: () => _openEditDishSheet(dish),
                ),
                // Delete button
                IconButton(
                  icon: const Icon(Icons.delete_outline, size: 18, color: Colors.red),
                  tooltip: 'Delete Dish',
                  onPressed: () => _deleteDish(dish),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Comprehensive Add / Edit Dish Bottom Sheet
class _DishFormSheet extends StatefulWidget {
  const _DishFormSheet({
    this.initialDish,
    required this.categories,
    required this.onSave,
  });

  final RestaurantDishModel? initialDish;
  final List<String> categories;
  final ValueChanged<RestaurantDishModel> onSave;

  @override
  State<_DishFormSheet> createState() => _DishFormSheetState();
}

class _DishFormSheetState extends State<_DishFormSheet> {
  late TextEditingController _nameCtrl;
  late TextEditingController _shortDescCtrl;
  late TextEditingController _descCtrl;
  late TextEditingController _basePriceCtrl;
  late TextEditingController _sellingPriceCtrl;
  late TextEditingController _mrpCtrl;
  late TextEditingController _prepTimeCtrl;

  late String _category;
  late String _foodType;
  late bool _isAvailable;
  late bool _isFeatured;
  late List<String> _photos;
  late int _primaryPhotoIndex;
  late List<DishVariantModel> _variants;
  late List<DishAddOnGroupModel> _addOnGroups;

  bool _isDirty = false;
  String? _validationError;

  @override
  void initState() {
    super.initState();
    final d = widget.initialDish;
    _nameCtrl = TextEditingController(text: d?.name ?? '');
    _shortDescCtrl = TextEditingController(text: d?.shortDescription ?? '');
    _descCtrl = TextEditingController(text: d?.description ?? '');
    _basePriceCtrl = TextEditingController(text: (d?.basePrice ?? 250).toStringAsFixed(0));
    _sellingPriceCtrl = TextEditingController(text: (d?.sellingPrice ?? 250).toStringAsFixed(0));
    _mrpCtrl = TextEditingController(text: (d?.mrp ?? 280).toStringAsFixed(0));
    _prepTimeCtrl = TextEditingController(text: (d?.prepTime ?? 20).toString());

    _category = d?.category ?? (widget.categories.isNotEmpty ? widget.categories.first : 'Main Course');
    _foodType = d?.foodType ?? 'veg';
    _isAvailable = d?.isAvailable ?? true;
    _isFeatured = d?.isFeatured ?? false;
    _photos = List.from(d?.photos ?? [kSampleFoodPhotos[0]]);
    _primaryPhotoIndex = d?.primaryPhotoIndex ?? 0;

    _variants = d != null
        ? d.variants.map((v) => DishVariantModel(id: v.id, name: v.name, price: v.price, isAvailable: v.isAvailable)).toList()
        : [
            DishVariantModel(id: 'var-1', name: 'Regular', price: 250, isAvailable: true),
            DishVariantModel(id: 'var-2', name: 'Large', price: 370, isAvailable: true),
          ];

    _addOnGroups = d != null
        ? d.addOnGroups
            .map((g) => DishAddOnGroupModel(
                  id: g.id,
                  name: g.name,
                  isRequired: g.isRequired,
                  selectionType: g.selectionType,
                  minSelect: g.minSelect,
                  maxSelect: g.maxSelect,
                  options: g.options
                      .map((o) => DishAddOnOptionModel(id: o.id, name: o.name, price: o.price, isAvailable: o.isAvailable))
                      .toList(),
                ))
            .toList()
        : [];
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _shortDescCtrl.dispose();
    _descCtrl.dispose();
    _basePriceCtrl.dispose();
    _sellingPriceCtrl.dispose();
    _mrpCtrl.dispose();
    _prepTimeCtrl.dispose();
    super.dispose();
  }

  void _addPhotoUrl() {
    final textCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Add Dish Photo URL'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Enter image URL or choose from curated local demo gallery:'),
            const SizedBox(height: 10),
            TextField(
              controller: textCtrl,
              decoration: const InputDecoration(
                hintText: 'https://...',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            const Text('Curated demo food photos:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              children: kSampleFoodPhotos.map((url) {
                return InkWell(
                  onTap: () {
                    textCtrl.text = url;
                  },
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: Image.network(
                      url,
                      width: 44,
                      height: 44,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => Container(color: const Color(0xFFF1F5F9), child: const Icon(Icons.fastfood, size: 20, color: RestaurantTheme.secondaryText)),
                    ),
                  ),
                );
              }).toList(),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () {
              final url = textCtrl.text.trim();
              if (url.isNotEmpty) {
                setState(() {
                  _photos.add(url);
                  _isDirty = true;
                });
                Navigator.pop(ctx);
              }
            },
            child: const Text('Add Photo'),
          ),
        ],
      ),
    );
  }

  void _saveDish() {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) {
      setState(() => _validationError = 'Please enter a dish name.');
      return;
    }
    final sellingPrice = double.tryParse(_sellingPriceCtrl.text);
    if (sellingPrice == null || sellingPrice <= 0) {
      setState(() => _validationError = 'Please enter a valid selling price greater than 0.');
      return;
    }
    final basePrice = double.tryParse(_basePriceCtrl.text) ?? sellingPrice;
    final mrp = double.tryParse(_mrpCtrl.text) ?? sellingPrice;
    final prepTime = int.tryParse(_prepTimeCtrl.text) ?? 20;

    final dish = RestaurantDishModel(
      id: widget.initialDish?.id ?? 'dish-${DateTime.now().millisecondsSinceEpoch}',
      name: name,
      shortDescription: _shortDescCtrl.text.trim(),
      description: _descCtrl.text.trim(),
      category: _category,
      foodType: _foodType,
      basePrice: basePrice,
      sellingPrice: sellingPrice,
      mrp: mrp,
      prepTime: prepTime,
      isAvailable: _isAvailable,
      isFeatured: _isFeatured,
      photos: _photos,
      primaryPhotoIndex: _primaryPhotoIndex < _photos.length ? _primaryPhotoIndex : 0,
      variants: _variants,
      addOnGroups: _addOnGroups,
    );

    widget.onSave(dish);
    Navigator.pop(context);
  }

  Future<bool> _onWillPop() async {
    if (!_isDirty) return true;
    final discard = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Discard Unsaved Changes?'),
        content: const Text('You have unsaved changes to this dish. Are you sure you want to close without saving?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep Editing')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Discard', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
    return discard ?? false;
  }

  @override
  Widget build(BuildContext context) {
    return WillPopScope(
      onWillPop: _onWillPop,
      child: Material(
        color: Colors.white,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.92,
          child: Column(
          children: [
            // Modal Handle & Header
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
              decoration: const BoxDecoration(
                border: Border(bottom: BorderSide(color: RestaurantTheme.border)),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    widget.initialDish == null ? 'Add New Dish' : 'Edit Dish',
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
                  ),
                  Row(
                    children: [
                      TextButton(
                        onPressed: () async {
                          final nav = Navigator.of(context);
                          if (await _onWillPop()) {
                            nav.pop();
                          }
                        },
                        child: const Text('Cancel', style: TextStyle(color: RestaurantTheme.secondaryText)),
                      ),
                      const SizedBox(width: 8),
                      ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: RestaurantTheme.neonOrange,
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        ),
                        onPressed: _saveDish,
                        child: const Text('Save Dish', style: TextStyle(fontWeight: FontWeight.bold)),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            if (_validationError != null)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                color: const Color(0xFFFEE2E2),
                child: Row(
                  children: [
                    const Icon(Icons.error_outline, size: 16, color: Colors.red),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(_validationError!, style: const TextStyle(fontSize: 12, color: Colors.red, fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
              ),

            // Scrollable Form Body
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // --- 1. Basic Details ---
                    const Text('1. BASIC DISH DETAILS', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: RestaurantTheme.secondaryText, letterSpacing: 0.5)),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _nameCtrl,
                      onChanged: (_) => _isDirty = true,
                      decoration: const InputDecoration(
                        labelText: 'Dish Name *',
                        hintText: 'e.g. Royal Mutton Dum Biryani',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _shortDescCtrl,
                      onChanged: (_) => _isDirty = true,
                      decoration: const InputDecoration(
                        labelText: 'Short Description',
                        hintText: 'Appears in menu cards (e.g. Tender lamb shanks with saffron rice)',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _descCtrl,
                      onChanged: (_) => _isDirty = true,
                      maxLines: 3,
                      decoration: const InputDecoration(
                        labelText: 'Full Description & Ingredients',
                        hintText: 'Detailed cooking style, key ingredients, serving accompaniments...',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Category & Dietary
                    Row(
                      children: [
                        Expanded(
                          child: DropdownButtonFormField<String>(
                            value: widget.categories.contains(_category) ? _category : widget.categories.first,
                            decoration: const InputDecoration(
                              labelText: 'Menu Category',
                              border: OutlineInputBorder(),
                            ),
                            items: widget.categories.map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
                            onChanged: (val) {
                              if (val != null) setState(() { _category = val; _isDirty = true; });
                            },
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: DropdownButtonFormField<String>(
                            value: _foodType,
                            decoration: const InputDecoration(
                              labelText: 'Dietary Type',
                              border: OutlineInputBorder(),
                            ),
                            items: const [
                              DropdownMenuItem(value: 'veg', child: Text('Vegetarian')),
                              DropdownMenuItem(value: 'non-veg', child: Text('Non-Vegetarian')),
                              DropdownMenuItem(value: 'egg', child: Text('Egg')),
                              DropdownMenuItem(value: 'vegan', child: Text('Vegan')),
                            ],
                            onChanged: (val) {
                              if (val != null) setState(() { _foodType = val; _isDirty = true; });
                            },
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),

                    // Pricing & Prep Time
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _sellingPriceCtrl,
                            keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            onChanged: (_) => _isDirty = true,
                            decoration: const InputDecoration(
                              labelText: 'Selling Price (₹) *',
                              prefixText: '₹',
                              border: OutlineInputBorder(),
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: TextField(
                            controller: _mrpCtrl,
                            keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            onChanged: (_) => _isDirty = true,
                            decoration: const InputDecoration(
                              labelText: 'MRP / Strike (₹)',
                              prefixText: '₹',
                              border: OutlineInputBorder(),
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: TextField(
                            controller: _prepTimeCtrl,
                            keyboardType: TextInputType.number,
                            onChanged: (_) => _isDirty = true,
                            decoration: const InputDecoration(
                              labelText: 'Prep Time (min)',
                              suffixText: 'm',
                              border: OutlineInputBorder(),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),

                    // Toggles (Available, Featured)
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: const Text('Available for Order', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                      value: _isAvailable,
                      activeColor: RestaurantTheme.vegGreen,
                      onChanged: (v) => setState(() { _isAvailable = v; _isDirty = true; }),
                    ),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: const Text('Feature on Menu', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                      value: _isFeatured,
                      activeColor: RestaurantTheme.neonOrange,
                      onChanged: (v) => setState(() { _isFeatured = v; _isDirty = true; }),
                    ),

                    const SizedBox(height: 24),
                    const Divider(),
                    const SizedBox(height: 16),

                    // --- 2. Dish Photos Management ---
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Expanded(
                          child: Text('2. DISH PHOTOS', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: RestaurantTheme.secondaryText, letterSpacing: 0.5)),
                        ),
                        TextButton.icon(
                          onPressed: _addPhotoUrl,
                          icon: const Icon(Icons.add_photo_alternate_outlined, size: 16, color: RestaurantTheme.neonOrange),
                          label: const Text('Add Photo', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: RestaurantTheme.neonOrange)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    if (_photos.isEmpty)
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF8FAFC),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: RestaurantTheme.border),
                        ),
                        child: const Row(
                          children: [
                            Icon(Icons.image_not_supported_outlined, color: RestaurantTheme.secondaryText),
                            SizedBox(width: 10),
                            Expanded(child: Text('No photos added yet. Tap "Add Photo" to add dishes imagery.', style: TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText))),
                          ],
                        ),
                      )
                    else
                      SizedBox(
                        height: 100,
                        child: ListView.builder(
                          scrollDirection: Axis.horizontal,
                          itemCount: _photos.length,
                          itemBuilder: (ctx, idx) {
                            final isPrimary = _primaryPhotoIndex == idx;
                            return Container(
                              margin: const EdgeInsets.only(right: 12),
                              width: 100,
                              height: 100,
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(
                                  color: isPrimary ? RestaurantTheme.neonOrange : RestaurantTheme.border,
                                  width: isPrimary ? 2 : 1,
                                ),
                              ),
                              child: Stack(
                                children: [
                                  ClipRRect(
                                    borderRadius: BorderRadius.circular(8),
                                    child: Image.network(
                                      _photos[idx],
                                      width: 100,
                                      height: 100,
                                      fit: BoxFit.cover,
                                      errorBuilder: (_, __, ___) => Container(color: const Color(0xFFF1F5F9), child: const Icon(Icons.fastfood, size: 30, color: RestaurantTheme.secondaryText)),
                                    ),
                                  ),
                                  if (isPrimary)
                                    Positioned(
                                      top: 4,
                                      left: 4,
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                                        decoration: BoxDecoration(color: RestaurantTheme.neonOrange, borderRadius: BorderRadius.circular(4)),
                                        child: const Text('Primary', style: TextStyle(fontSize: 8, color: Colors.white, fontWeight: FontWeight.bold)),
                                      ),
                                    ),
                                  Positioned(
                                    top: 2,
                                    right: 2,
                                    child: InkWell(
                                      onTap: () {
                                        setState(() {
                                          _photos.removeAt(idx);
                                          if (_primaryPhotoIndex >= _photos.length) _primaryPhotoIndex = 0;
                                          _isDirty = true;
                                        });
                                      },
                                      child: Container(
                                        padding: const EdgeInsets.all(2),
                                        decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                                        child: const Icon(Icons.close, size: 14, color: Colors.white),
                                      ),
                                    ),
                                  ),
                                  if (!isPrimary)
                                    Positioned(
                                      bottom: 4,
                                      left: 4,
                                      child: InkWell(
                                        onTap: () => setState(() { _primaryPhotoIndex = idx; _isDirty = true; }),
                                        child: Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                                          decoration: BoxDecoration(color: Colors.black87, borderRadius: BorderRadius.circular(4)),
                                          child: const Text('Set Primary', style: TextStyle(fontSize: 8, color: Colors.white)),
                                        ),
                                      ),
                                    ),
                                ],
                              ),
                            );
                          },
                        ),
                      ),

                    const SizedBox(height: 24),
                    const Divider(),
                    const SizedBox(height: 16),

                    // --- 3. Sizing Variants ---
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Expanded(
                          child: Text('3. SIZING VARIANTS', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: RestaurantTheme.secondaryText, letterSpacing: 0.5)),
                        ),
                        TextButton.icon(
                          onPressed: () {
                            setState(() {
                              _variants.add(DishVariantModel(
                                id: 'var-${DateTime.now().millisecondsSinceEpoch}',
                                name: 'New Size',
                                price: double.tryParse(_sellingPriceCtrl.text) ?? 250,
                                isAvailable: true,
                              ));
                              _isDirty = true;
                            });
                          },
                          icon: const Icon(Icons.add, size: 16, color: RestaurantTheme.neonOrange),
                          label: const Text('Add Size', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: RestaurantTheme.neonOrange)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    if (_variants.isEmpty)
                      const Text('Single portion dish without size variants.', style: TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText))
                    else
                      ..._variants.asMap().entries.map((entry) {
                        final idx = entry.key;
                        final variant = entry.value;
                        return Container(
                          margin: const EdgeInsets.only(bottom: 8),
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF8FAFC),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: RestaurantTheme.border),
                          ),
                          child: Row(
                            children: [
                              Expanded(
                                flex: 2,
                                child: TextFormField(
                                  initialValue: variant.name,
                                  decoration: const InputDecoration(labelText: 'Size Name', isDense: true),
                                  onChanged: (v) { variant.name = v; _isDirty = true; },
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                flex: 1,
                                child: TextFormField(
                                  initialValue: variant.price.toStringAsFixed(0),
                                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                  decoration: const InputDecoration(labelText: 'Price (₹)', prefixText: '₹', isDense: true),
                                  onChanged: (v) {
                                    variant.price = double.tryParse(v) ?? variant.price;
                                    _isDirty = true;
                                  },
                                ),
                              ),
                              IconButton(
                                icon: const Icon(Icons.delete_outline, size: 18, color: Colors.red),
                                onPressed: () => setState(() { _variants.removeAt(idx); _isDirty = true; }),
                              ),
                            ],
                          ),
                        );
                      }),

                    const SizedBox(height: 24),
                    const Divider(),
                    const SizedBox(height: 16),

                    // --- 4. Add-on Groups ---
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Expanded(
                          child: Text('4. ADD-ON GROUPS & CUSTOMIZATIONS', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: RestaurantTheme.secondaryText, letterSpacing: 0.5)),
                        ),
                        TextButton.icon(
                          onPressed: () {
                            setState(() {
                              _addOnGroups.add(DishAddOnGroupModel(
                                id: 'grp-${DateTime.now().millisecondsSinceEpoch}',
                                name: 'New Add-on Group',
                                isRequired: false,
                                selectionType: 'multi',
                                minSelect: 0,
                                maxSelect: 3,
                                options: [
                                  DishAddOnOptionModel(id: 'opt-1', name: 'Option 1', price: 30, isAvailable: true),
                                ],
                              ));
                              _isDirty = true;
                            });
                          },
                          icon: const Icon(Icons.add, size: 16, color: RestaurantTheme.neonOrange),
                          label: const Text('Add Group', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: RestaurantTheme.neonOrange)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    if (_addOnGroups.isEmpty)
                      const Text('No add-on groups configured.', style: TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText))
                    else
                      ..._addOnGroups.asMap().entries.map((gEntry) {
                        final gIdx = gEntry.key;
                        final group = gEntry.value;
                        return Container(
                          margin: const EdgeInsets.only(bottom: 14),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF8FAFC),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: RestaurantTheme.border),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: TextFormField(
                                      initialValue: group.name,
                                      decoration: const InputDecoration(labelText: 'Group Name', isDense: true),
                                      onChanged: (v) { group.name = v; _isDirty = true; },
                                    ),
                                  ),
                                  IconButton(
                                    icon: const Icon(Icons.delete_outline, color: Colors.red, size: 18),
                                    onPressed: () => setState(() { _addOnGroups.removeAt(gIdx); _isDirty = true; }),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  Checkbox(
                                    value: group.isRequired,
                                    onChanged: (v) => setState(() { group.isRequired = v ?? false; _isDirty = true; }),
                                  ),
                                  const Text('Required Group', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                                  const Spacer(),
                                  DropdownButton<String>(
                                    value: group.selectionType,
                                    items: const [
                                      DropdownMenuItem(value: 'single', child: Text('Single Choice', style: TextStyle(fontSize: 12))),
                                      DropdownMenuItem(value: 'multi', child: Text('Multiple Choices', style: TextStyle(fontSize: 12))),
                                    ],
                                    onChanged: (v) => setState(() { if (v != null) group.selectionType = v; _isDirty = true; }),
                                  ),
                                ],
                              ),
                              const Divider(),
                              const Text('Options in Group:', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.secondaryText)),
                              const SizedBox(height: 6),
                              ...group.options.asMap().entries.map((oEntry) {
                                final opt = oEntry.value;
                                return Padding(
                                  padding: const EdgeInsets.only(bottom: 6),
                                  child: Row(
                                    children: [
                                      Expanded(
                                        flex: 2,
                                        child: TextFormField(
                                          initialValue: opt.name,
                                          decoration: const InputDecoration(labelText: 'Option', isDense: true),
                                          onChanged: (v) { opt.name = v; _isDirty = true; },
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      Expanded(
                                        flex: 1,
                                        child: TextFormField(
                                          initialValue: opt.price.toStringAsFixed(0),
                                          decoration: const InputDecoration(labelText: '+ Price (₹)', prefixText: '₹', isDense: true),
                                          onChanged: (v) { opt.price = double.tryParse(v) ?? opt.price; _isDirty = true; },
                                        ),
                                      ),
                                    ],
                                  ),
                                );
                              }),
                              TextButton.icon(
                                onPressed: () {
                                  setState(() {
                                    group.options.add(DishAddOnOptionModel(
                                      id: 'opt-${DateTime.now().millisecondsSinceEpoch}',
                                      name: 'Extra item',
                                      price: 25,
                                    ));
                                    _isDirty = true;
                                  });
                                },
                                icon: const Icon(Icons.add, size: 14),
                                label: const Text('Add Option to Group', style: TextStyle(fontSize: 11)),
                              ),
                            ],
                          ),
                        );
                      }),
                  ],
                ),
              ),
            ),
          ],
        ),
        ),
      ),
    );
  }
}

/// Interactive Customer Preview Sheet (calculates totals, enforces required groups)
class _CustomerDishPreviewSheet extends StatefulWidget {
  const _CustomerDishPreviewSheet({required this.dish});

  final RestaurantDishModel dish;

  @override
  State<_CustomerDishPreviewSheet> createState() => _CustomerDishPreviewSheetState();
}

class _CustomerDishPreviewSheetState extends State<_CustomerDishPreviewSheet> {
  late DishVariantModel? _selectedVariant;
  final Set<String> _selectedOptionIds = {};
  int _quantity = 1;

  @override
  void initState() {
    super.initState();
    _selectedVariant = widget.dish.variants.isNotEmpty ? widget.dish.variants.first : null;
    // Auto-select defaults for required single-choice groups
    for (final group in widget.dish.addOnGroups) {
      if (group.isRequired && group.selectionType == 'single' && group.options.isNotEmpty) {
        _selectedOptionIds.add(group.options.first.id);
      }
    }
  }

  double get _unitPrice {
    double base = _selectedVariant != null ? _selectedVariant!.price : widget.dish.sellingPrice;
    for (final group in widget.dish.addOnGroups) {
      for (final opt in group.options) {
        if (_selectedOptionIds.contains(opt.id)) {
          base += opt.price;
        }
      }
    }
    return base;
  }

  double get _totalPrice => _unitPrice * _quantity;

  bool get _isValidConfig {
    for (final group in widget.dish.addOnGroups) {
      if (group.isRequired) {
        final selectedInGroup = group.options.where((o) => _selectedOptionIds.contains(o.id)).length;
        if (selectedInGroup < group.minSelect || selectedInGroup == 0) {
          return false;
        }
      }
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final dish = widget.dish;
    final photoUrl = dish.photos.isNotEmpty ? dish.photos[dish.primaryPhotoIndex] : null;

    return Container(
      height: MediaQuery.of(context).size.height * 0.90,
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        children: [
          // Header Bar
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: const BoxDecoration(
              color: Color(0xFF1E293B),
              borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Row(
                  children: [
                    Icon(Icons.remove_red_eye, color: Color(0xFF38BDF8), size: 18),
                    SizedBox(width: 8),
                    Text('Customer-Facing Preview', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
                  ],
                ),
                IconButton(
                  icon: const Icon(Icons.close, color: Colors.white, size: 20),
                  onPressed: () => Navigator.pop(context),
                ),
              ],
            ),
          ),

          // Scrollable Preview Body
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Hero Photo
                  if (photoUrl != null)
                    Image.network(
                      photoUrl,
                      width: double.infinity,
                      height: 220,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => Container(
                        height: 180,
                        color: RestaurantTheme.lightBg,
                        child: const Center(child: Icon(Icons.fastfood, size: 48, color: RestaurantTheme.neonOrange)),
                      ),
                    ),

                  Padding(
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Name and Prep time
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Text(
                                dish.name,
                                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
                              ),
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(color: const Color(0xFFF1F5F9), borderRadius: BorderRadius.circular(6)),
                              child: Row(
                                children: [
                                  const Icon(Icons.timer_outlined, size: 14, color: RestaurantTheme.secondaryText),
                                  const SizedBox(width: 4),
                                  Text('${dish.prepTime} min', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.secondaryText)),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Text(
                          dish.description.isNotEmpty ? dish.description : dish.shortDescription,
                          style: const TextStyle(fontSize: 13, color: RestaurantTheme.secondaryText, height: 1.4),
                        ),
                        const SizedBox(height: 16),
                        const Divider(),

                        // Variant selection
                        if (dish.variants.isNotEmpty) ...[
                          const SizedBox(height: 10),
                          const Text('CHOOSE PORTION / SIZE', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: RestaurantTheme.secondaryText, letterSpacing: 0.5)),
                          const SizedBox(height: 8),
                          ...dish.variants.map((v) {
                            final isSelected = _selectedVariant?.id == v.id;
                            return InkWell(
                              onTap: () => setState(() => _selectedVariant = v),
                              child: Container(
                                margin: const EdgeInsets.only(bottom: 8),
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: isSelected ? const Color(0xFFEFF6FF) : Colors.white,
                                  borderRadius: BorderRadius.circular(10),
                                  border: Border.all(color: isSelected ? const Color(0xFF2563EB) : RestaurantTheme.border, width: isSelected ? 1.5 : 1),
                                ),
                                child: Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Row(
                                      children: [
                                        Icon(
                                          isSelected ? Icons.radio_button_checked : Icons.radio_button_off,
                                          size: 18,
                                          color: isSelected ? const Color(0xFF2563EB) : RestaurantTheme.secondaryText,
                                        ),
                                        const SizedBox(width: 10),
                                        Text(v.name, style: TextStyle(fontWeight: isSelected ? FontWeight.bold : FontWeight.normal, fontSize: 13.5)),
                                      ],
                                    ),
                                    Text('₹${v.price.toStringAsFixed(0)}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13.5)),
                                  ],
                                ),
                              ),
                            );
                          }),
                        ],

                        // Add-on groups
                        ...dish.addOnGroups.map((group) {
                          return Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const SizedBox(height: 16),
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    group.name.toUpperCase(),
                                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: RestaurantTheme.secondaryText, letterSpacing: 0.5),
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: group.isRequired ? const Color(0xFFFEE2E2) : const Color(0xFFF1F5F9),
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                    child: Text(
                                      group.isRequired ? 'REQUIRED' : 'OPTIONAL',
                                      style: TextStyle(
                                        fontSize: 9,
                                        fontWeight: FontWeight.bold,
                                        color: group.isRequired ? Colors.red : RestaurantTheme.secondaryText,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              ...group.options.map((opt) {
                                final isSelected = _selectedOptionIds.contains(opt.id);
                                return InkWell(
                                  onTap: () {
                                    setState(() {
                                      if (group.selectionType == 'single') {
                                        for (final o in group.options) {
                                          _selectedOptionIds.remove(o.id);
                                        }
                                        _selectedOptionIds.add(opt.id);
                                      } else {
                                        if (isSelected) {
                                          _selectedOptionIds.remove(opt.id);
                                        } else {
                                          _selectedOptionIds.add(opt.id);
                                        }
                                      }
                                    });
                                  },
                                  child: Container(
                                    margin: const EdgeInsets.only(bottom: 6),
                                    padding: const EdgeInsets.all(10),
                                    decoration: BoxDecoration(
                                      color: isSelected ? const Color(0xFFF5F3FF) : Colors.white,
                                      borderRadius: BorderRadius.circular(8),
                                      border: Border.all(color: isSelected ? const Color(0xFF7C3AED) : RestaurantTheme.border),
                                    ),
                                    child: Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        Row(
                                          children: [
                                            Icon(
                                              group.selectionType == 'single'
                                                  ? (isSelected ? Icons.radio_button_checked : Icons.radio_button_off)
                                                  : (isSelected ? Icons.check_box : Icons.check_box_outline_blank),
                                              size: 18,
                                              color: isSelected ? const Color(0xFF7C3AED) : RestaurantTheme.secondaryText,
                                            ),
                                            const SizedBox(width: 8),
                                            Text(opt.name, style: const TextStyle(fontSize: 13)),
                                          ],
                                        ),
                                        Text('+₹${opt.price.toStringAsFixed(0)}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                                      ],
                                    ),
                                  ),
                                );
                              }),
                            ],
                          );
                        }),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Bottom Bar with Live Total and Add to Cart Simulator
          Container(
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(
              color: Colors.white,
              border: Border(top: BorderSide(color: RestaurantTheme.border)),
            ),
            child: Row(
              children: [
                // Quantity adjuster
                Container(
                  decoration: BoxDecoration(
                    border: Border.all(color: RestaurantTheme.border),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      IconButton(
                        icon: const Icon(Icons.remove, size: 16),
                        onPressed: _quantity > 1 ? () => setState(() => _quantity--) : null,
                      ),
                      Text('$_quantity', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                      IconButton(
                        icon: const Icon(Icons.add, size: 16),
                        onPressed: () => setState(() => _quantity++),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 14),
                // Total and Add Button
                Expanded(
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _isValidConfig ? RestaurantTheme.neonOrange : Colors.grey,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      elevation: 0,
                    ),
                    onPressed: _isValidConfig
                        ? () {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text('Preview Verified: $_quantity x ${dish.name} totaling ₹${_totalPrice.toStringAsFixed(0)}'),
                                backgroundColor: RestaurantTheme.vegGreen,
                              ),
                            );
                          }
                        : null,
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(_isValidConfig ? 'Item Valid' : 'Select Required Options', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                        Text('₹${_totalPrice.toStringAsFixed(0)}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
                      ],
                    ),
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
