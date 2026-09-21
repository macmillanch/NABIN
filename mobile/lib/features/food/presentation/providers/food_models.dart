/// Typed views over the NABIN customer food discovery endpoints.
///
/// Every field below exists in the backend response of
/// `GET /api/restaurants`, `GET /api/restaurants/:id/menu` or
/// `GET /api/advertisements`. Nothing the API does not return is modelled here
/// — no review counts, distance, delivery fee, price-for-two, offer copy, menu
/// sections, dish images or dish add-ons — so the food screens cannot render a
/// value they were never given.
library;

String? stringOrNull(Object? value) {
  if (value == null) return null;
  final text = value.toString().trim();
  return text.isEmpty ? null : text;
}

double? doubleOrNull(Object? value) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value.trim());
  return null;
}

bool isTrue(Object? value) => value == true || (value is String && value.toLowerCase() == 'true');

List<String> stringList(Object? value) {
  if (value is List) {
    return value.map((e) => e.toString().trim()).where((e) => e.isNotEmpty).toList();
  }
  if (value is String) {
    return value.split(',').map((e) => e.trim()).where((e) => e.isNotEmpty).toList();
  }
  return const <String>[];
}

String _initialOf(String value) {
  final trimmed = value.trim();
  return trimmed.isEmpty ? '?' : trimmed.substring(0, 1).toUpperCase();
}

/// Renders `220` as `220` and `220.5` as `220.50` without a stray `.0`.
String foodPrice(num value) {
  if (value == value.roundToDouble()) return value.toInt().toString();
  return value.toStringAsFixed(2);
}

/// A restaurant as projected by `projectRestaurantForCustomer` on the server.
class FoodRestaurant {
  const FoodRestaurant({
    required this.id,
    required this.name,
    this.cuisines = const <String>[],
    this.rating,
    this.deliveryTime,
    this.operationalStatus,
    this.isOpen = false,
    this.address,
  });

  final String id;
  final String name;
  final List<String> cuisines;
  final double? rating;
  final String? deliveryTime;
  final String? operationalStatus;
  final bool isOpen;
  final String? address;

  String get firstLetter => _initialOf(name);

  /// `operationalStatus` is a real column; anything other than APPROVED means
  /// the kitchen cannot take orders yet.
  bool get isApproved => operationalStatus == null || operationalStatus == 'APPROVED';

  String get cuisineLabel => cuisines.isEmpty ? '' : cuisines.join(', ');

  factory FoodRestaurant.fromJson(Map<String, dynamic> json) => FoodRestaurant(
        id: stringOrNull(json['id']) ?? '',
        name: stringOrNull(json['name']) ?? 'Untitled restaurant',
        cuisines: stringList(json['cuisines']),
        rating: doubleOrNull(json['rating']),
        deliveryTime: stringOrNull(json['deliveryTime']),
        operationalStatus: stringOrNull(json['operationalStatus']),
        isOpen: isTrue(json['isOpen']),
        address: stringOrNull(json['address']),
      );
}

/// One menu row from `GET /api/restaurants/:id/menu`, backed by the `products`
/// table. `category` is the menu section; the backend also returns a `categories`
/// array for the restaurant. Dishes carry no rating, review count or add-on
/// list. `isVeg` is nullable because the schema has no veg column, so an
/// undeclared dish must not be drawn as a non-veg one.
class FoodMenuItem {
  const FoodMenuItem({
    required this.id,
    required this.name,
    required this.price,
    this.description,
    this.category,
    this.imageUrl,
    this.isVeg,
    this.inStock = true,
  });

  final String id;
  final String name;
  final num price;
  final String? description;
  final String? category;
  final String? imageUrl;

  /// `null` when the restaurant has not declared it.
  final bool? isVeg;
  final bool inStock;

  String get firstLetter => _initialOf(name);

  factory FoodMenuItem.fromJson(Map<String, dynamic> json) => FoodMenuItem(
        id: stringOrNull(json['id']) ?? '',
        name: stringOrNull(json['name']) ?? 'Unnamed dish',
        price: doubleOrNull(json['sellingPrice']) ?? doubleOrNull(json['price']) ?? 0,
        description: stringOrNull(json['description']),
        category: stringOrNull(json['category']),
        imageUrl: stringOrNull(json['imageUrl']),
        isVeg: json['isVeg'] == null ? null : isTrue(json['isVeg']),
        inStock: json['isAvailable'] == null
            ? (json['inStock'] == null ? true : isTrue(json['inStock']))
            : isTrue(json['isAvailable']),
      );
}

/// A sponsored placement from `GET /api/advertisements?slot=FOOD_HOME_BANNER`.
class FoodAdvertisement {
  const FoodAdvertisement({
    required this.title,
    this.tagline,
    this.brand,
    this.sponsorBadge,
    this.imageUrl,
    this.accentColor,
    this.ctaText,
    this.ctaLink,
    this.targetCategory,
    this.priority,
  });

  final String title;
  final String? tagline;
  final String? brand;
  final String? sponsorBadge;
  final String? imageUrl;
  final String? accentColor;
  final String? ctaText;
  final String? ctaLink;
  final String? targetCategory;
  final int? priority;

  String get sponsorLabel => sponsorBadge ?? 'Sponsored';

  factory FoodAdvertisement.fromJson(Map<String, dynamic> json) => FoodAdvertisement(
        title: stringOrNull(json['title']) ?? 'Sponsored campaign',
        tagline: stringOrNull(json['tagline']),
        brand: stringOrNull(json['brand']),
        sponsorBadge: stringOrNull(json['sponsorBadge']),
        imageUrl: stringOrNull(json['imageUrl']),
        accentColor: stringOrNull(json['accentColor']),
        ctaText: stringOrNull(json['ctaText']),
        ctaLink: stringOrNull(json['ctaLink']),
        targetCategory: stringOrNull(json['targetCategory']),
        priority: doubleOrNull(json['priority'])?.round(),
      );
}

/// Result of one restaurant-list query plus the cuisine vocabulary derived
/// from the unfiltered feed (there is no cuisine endpoint to ask).
class FoodRestaurantFeed {
  const FoodRestaurantFeed({
    this.restaurants = const <FoodRestaurant>[],
    this.cuisines = const <String>[],
  });

  final List<FoodRestaurant> restaurants;
  final List<String> cuisines;

  FoodRestaurant? byId(String id) {
    for (final restaurant in restaurants) {
      if (restaurant.id == id) return restaurant;
    }
    return null;
  }
}
