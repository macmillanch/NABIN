import 'package:flutter/material.dart';
import '../theme/grocery_theme.dart';
import 'grocery_product.dart';

/// One row of `GET /api/advertisements?slot=GROCERY_HERO_CAROUSEL`.
///
/// Sponsored inventory is rendered as sponsored inventory: the tile always
/// carries a sponsor label, and only fields the endpoint really returns
/// (`title`, `tagline`, `brand`, `sponsorBadge`, `imageUrl`, `accentColor`,
/// `ctaText`, `ctaLink`, `targetCategory`, `priority`) reach the screen. The
/// `bgGradient` value is a Tailwind class name, not a colour, so it is ignored
/// and the tile paints from `accentColor` instead.
class GroceryAdvertisement {
  const GroceryAdvertisement({
    required this.id,
    required this.title,
    this.tagline,
    this.brand,
    this.sponsorBadge,
    this.imageUrl,
    this.accentColor,
    this.ctaText,
    this.ctaLink,
    this.targetCategory,
    this.priority = 0,
  });

  factory GroceryAdvertisement.fromApi(Map<String, dynamic> json) {
    return GroceryAdvertisement(
      id: json['id']?.toString() ?? '',
      title: nonEmpty(json['title']) ?? 'Sponsored',
      tagline: nonEmpty(json['tagline']),
      brand: nonEmpty(json['brand']),
      sponsorBadge: nonEmpty(json['sponsorBadge']),
      imageUrl: nonEmpty(json['imageUrl']),
      accentColor: colorFromHex(json['accentColor']),
      ctaText: nonEmpty(json['ctaText']),
      ctaLink: nonEmpty(json['ctaLink']),
      targetCategory: nonEmpty(json['targetCategory']),
      priority: toAmount(json['priority']).round(),
    );
  }

  final String id;
  final String title;
  final String? tagline;
  final String? brand;
  final String? sponsorBadge;
  final String? imageUrl;
  final Color? accentColor;
  final String? ctaText;
  final String? ctaLink;
  final String? targetCategory;
  final int priority;

  Color get accent => accentColor ?? GroceryTheme.primaryGreenDark;

  String get sponsorLabel {
    final String? badge = sponsorBadge ?? brand;
    if (badge == null) return 'Sponsored';
    return 'Sponsored • ${titleCase(badge)}';
  }

  bool get hasImage => imageUrl != null;

  /// `targetCategory` is matched against the product `category` values with the
  /// same case-insensitive substring rule the backend list filter uses, and a
  /// campaign aimed at every aisle is simply "no filter".
  String? categoryFilterIn(List<String> categories) {
    final String? wanted = targetCategory;
    if (wanted == null) return null;
    final String needle = wanted.toLowerCase();
    if (needle == 'all' || needle.isEmpty) return null;
    for (final String category in categories) {
      if (category.toLowerCase().contains(needle) ||
          needle.contains(category.toLowerCase())) {
        return category;
      }
    }
    return null;
  }

  /// A tap may only act on something the app can actually do: filter the grid.
  /// External `ctaLink` URLs are not navigable from here (no in-app route owns
  /// them), so those tiles stay non-interactive instead of faking a click.
  bool get isInteractiveInApp => ctaLink == null || !ctaLink!.startsWith('http');

  static String titleCase(String input) {
    return input
        .split(RegExp(r'\s+'))
        .map((word) => word.isEmpty
            ? word
            : word[0].toUpperCase() + word.substring(1).toLowerCase())
        .join(' ');
  }
}
