import 'package:flutter/material.dart';
import '../theme/grocery_theme.dart';

/// One row of `GET /api/grocery/products`.
///
/// Backed by `merchant_grocery_inventory` joined to `master_grocery_catalog`, so
/// `id` is the inventory row the checkout resolves. There is **no** rating,
/// review count, delivery ETA, `discount_percent`, veg flag or coupon on a
/// grocery product, and no maximum retail price — those stay out of this model
/// so no screen can render a value the backend never sent. `imageUrl` is
/// nullable because most catalogue rows still have no artwork.
class GroceryProduct {
  const GroceryProduct({
    required this.id,
    required this.name,
    required this.currentPrice,
    required this.mrp,
    required this.isAvailable,
    required this.stockQty,
    this.brand,
    this.category,
    this.unit,
    this.packSize,
    this.previousPrice,
    this.priceStatus,
    this.pricingType,
    this.unitPricingType,
    this.lastPriceUpdate,
    this.merchantId,
    this.merchantName,
    this.imageUrl,
    this.emoji = '🛒',
    this.tileColor,
  });

  factory GroceryProduct.fromApi(Map<String, dynamic> json) {
    final double currentPrice = toAmount(json['currentPrice']);
    final double mrp = toAmount(json['mrp'], fallback: currentPrice);

    return GroceryProduct(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? 'Grocery item',
      currentPrice: currentPrice,
      mrp: mrp,
      isAvailable: json['isAvailable'] == true,
      stockQty: toAmount(json['stockQty']),
      brand: nonEmpty(json['brand']),
      category: nonEmpty(json['category']),
      unit: nonEmpty(json['unit']),
      packSize: nonEmpty(json['packSize']),
      previousPrice: json['previousPrice'] == null
          ? null
          : toAmount(json['previousPrice']),
      priceStatus: nonEmpty(json['priceStatus']),
      pricingType: nonEmpty(json['pricingType']),
      unitPricingType: nonEmpty(json['unitPricingType']),
      lastPriceUpdate: toDateTime(json['lastPriceUpdate']),
      merchantId: nonEmpty(json['merchantId']),
      merchantName: nonEmpty(json['merchantName']),
      imageUrl: nonEmpty(json['imageUrl']),
      emoji: nonEmpty(json['emoji']) ?? '🛒',
      tileColor: colorFromHex(json['imageColor']),
    );
  }

  final String id;
  final String name;

  /// Live selling price. It moves while the app is open, so it is re-read from
  /// this row at add-to-cart time instead of being captured anywhere else.
  final double currentPrice;
  final double mrp;

  /// The only listing signal the backend exposes.
  final bool isAvailable;

  /// The only stock signal the backend exposes.
  final double stockQty;

  final String? brand;
  final String? category;
  final String? unit;
  final String? packSize;
  final double? previousPrice;
  final String? priceStatus;
  final String? pricingType;
  final String? unitPricingType;
  final DateTime? lastPriceUpdate;
  final String? merchantId;
  final String? merchantName;

  /// Real product artwork when the store has uploaded it. `null` means the
  /// catalogue row has no usable image, so the emoji tile is shown instead.
  final String? imageUrl;

  /// Product artwork is an emoji plus a server-supplied pastel tile colour;
  /// `imageColor` is the only colour the payload carries.
  final String emoji;
  final Color? tileColor;

  Color get artworkBackground => tileColor ?? GroceryTheme.primaryGreenLight;

  /// Computed locally because the payload has no discount percentage.
  /// A missing or non-positive `mrp`, or one below the live price, is `0`.
  int get discountPercent {
    if (mrp <= 0 || mrp <= currentPrice) return 0;
    return (((mrp - currentPrice) / mrp) * 100).round();
  }

  double get savings => mrp > currentPrice ? mrp - currentPrice : 0;

  bool get hasDiscount => savings > 0;

  /// `packSize` and `unit` are the real size fields; there is no `weight`.
  String get sizeLabel {
    final List<String> parts = <String>[
      if (packSize != null) packSize!,
      if (unit != null && unit != packSize) unit!,
    ];
    return parts.join(' • ');
  }

  bool get isWeightBased =>
      pricingType == 'WEIGHT_BASED_PRICE' || unitPricingType == 'PER_WEIGHT';

  String get stockLabel {
    if (!isAvailable) return 'Not listed right now';
    if (stockQty <= 0) return 'Out of stock';
    if (stockQty <= 5) return 'Only ${trimAmount(stockQty)} left';
    return '';
  }

  bool get canAddToCart => isAvailable && stockQty > 0;

  String get priceLabel => formatRupees(currentPrice);

  String get mrpLabel => formatRupees(mrp);

  /// Real merchandising line: brand and store both come from the product row.
  String get sourceLabel {
    final List<String> parts = <String>[
      if (brand != null) brand!,
      if (merchantName != null) merchantName!,
    ];
    return parts.join(' • ');
  }

  String get priceUpdatedLabel {
    final DateTime? at = lastPriceUpdate;
    if (at == null) return '';
    return 'Price updated ${relativeTime(at)}';
  }

  static String trimAmount(double value) =>
      value == value.roundToDouble() ? value.toStringAsFixed(0) : value.toStringAsFixed(2);
}

/// Rupees label: whole amounts drop the decimals, paise keep two.
String formatRupees(double amount) => '₹${GroceryProduct.trimAmount(amount)}';

String? nonEmpty(Object? value) {
  final String? text = value?.toString().trim();
  if (text == null || text.isEmpty || text == 'null') return null;
  return text;
}

double toAmount(Object? value, {double fallback = 0}) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value.trim()) ?? fallback;
  return fallback;
}

DateTime? toDateTime(Object? value) {
  final String? text = value?.toString();
  if (text == null) return null;
  return DateTime.tryParse(text)?.toLocal();
}

/// `imageColor` / `accentColor` arrive as `#RRGGBB` strings from the API.
Color? colorFromHex(Object? value) {
  String hex = value?.toString().trim() ?? '';
  if (hex.isEmpty) return null;
  if (hex.startsWith('#')) hex = hex.substring(1);
  if (hex.length == 6) hex = 'FF$hex';
  if (hex.length != 8) return null;
  final int? packed = int.tryParse(hex, radix: 16);
  return packed == null ? null : Color(packed);
}

String relativeTime(DateTime moment) {
  final Duration diff = DateTime.now().difference(moment);
  if (diff.isNegative) return 'just now';
  if (diff.inMinutes < 1) return 'just now';
  if (diff.inHours < 1) return '${diff.inMinutes} min ago';
  if (diff.inDays < 1) return '${diff.inHours} h ago';
  if (diff.inDays < 30) return '${diff.inDays} d ago';
  return '${moment.day}/${moment.month}/${moment.year}';
}
