/// Typed views over the NABIN customer food discovery endpoints.
///
/// Every field below exists in the backend response of
/// `GET /api/restaurants`, `GET /api/restaurants/:id/menu` or
/// `GET /api/advertisements`. Nothing the API does not return is modelled here
/// — no review counts, distance, delivery fee, price-for-one, offer copy or
/// dish add-ons — so the food screens cannot render a value they were never
/// given.
///
/// A restaurant's own banner is `coverImageUrl` and its window is
/// `deliveryMinutes`, both nullable because migration 034 made them columns a
/// merchant may leave undeclared; a null renders the letter plate and no ETA
/// chip. `rating` is absent on purpose: see FoodRestaurant.
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

/// A whole number, or null for anything that is not one. `standard_delivery_minutes`
/// arrives as a JSON number; a `'28'` string is accepted because PostgREST can
/// hand back a numeric column as text, and a fraction or a word is refused rather
/// than rounded into a claim the merchant never made.
int? intOrNull(Object? value) {
  if (value is int) return value;
  if (value is num) return value.isFinite && value == value.truncate() ? value.toInt() : null;
  if (value is String) return int.tryParse(value.trim());
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

/// The one place a declared window gains its unit label. A null stays null so a
/// caller renders no ETA at all rather than a guess, and no screen adds "min"
/// on its own.
String? foodEtaLabel(int? minutes) => minutes == null ? null : '$minutes min';

/// A restaurant as projected by `projectRestaurantForCustomer` on the server.
///
/// The projection is exactly
/// `id, name, merchant_type, address, lat, lng, is_open, cuisines,
/// cover_image_url, standard_delivery_minutes` (migration 034 added the last
/// three), so this class models those and nothing else:
///
/// - **no `rating`** — `merchants.rating` was created as `NUMERIC(3,2) DEFAULT 4.80`
///   and the schema has no reviews, ratings or order-feedback table, so every
///   stored score was the column default rather than a measurement. 034 dropped
///   the default and the projection stopped selecting the column, so a star here
///   would have nothing to read. A real rating needs a real source.
/// - **no `deliveryTime` string** — an ETA is `standard_delivery_minutes`, a whole
///   number of minutes or null. Free-text '25-35 mins' cannot be compared or
///   displayed honestly, so the client formats the number it was given.
/// - **no `operationalStatus`** — the endpoint does not return it. Whether the
///   kitchen can take orders is `isOpen`, which is a real projected boolean.
class FoodRestaurant {
  const FoodRestaurant({
    required this.id,
    required this.name,
    this.cuisines = const <String>[],
    this.coverImageUrl,
    this.deliveryMinutes,
    this.isOpen = false,
    this.address,
  });

  final String id;
  final String name;
  final List<String> cuisines;

  /// The banner the merchant declared, or null — which renders the letter plate,
  /// never a stock picture.
  final String? coverImageUrl;

  /// The merchant's declared kitchen-to-door window in minutes, or null when the
  /// merchant has declared nothing.
  final int? deliveryMinutes;
  final bool isOpen;
  final String? address;

  String get firstLetter => _initialOf(name);

  String get cuisineLabel => cuisines.isEmpty ? '' : cuisines.join(', ');

  /// The declared window as a label, or null so callers render no chip at all
  /// rather than a guess.
  String? get etaLabel => foodEtaLabel(deliveryMinutes);

  factory FoodRestaurant.fromJson(Map<String, dynamic> json) => FoodRestaurant(
        id: stringOrNull(json['id']) ?? '',
        name: stringOrNull(json['name']) ?? 'Untitled restaurant',
        cuisines: stringList(json['cuisines']),
        coverImageUrl: stringOrNull(json['coverImageUrl']),
        deliveryMinutes: intOrNull(json['deliveryMinutes']),
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
