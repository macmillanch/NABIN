import 'package:flutter/material.dart';

import '../../../../core/theme/nabin_tokens.dart';
import '../../../../core/theme/restaurant_theme.dart';

/// The restaurants and menu-item payloads carry no image column, so every food
/// thumbnail is the initial-letter treatment on a deterministic NABIN token
/// gradient — no broken network images, no competitor artwork.
class FoodLetterTile extends StatelessWidget {
  const FoodLetterTile({
    super.key,
    required this.letter,
    required this.seed,
    this.size = 74,
    this.radius = 14,
    this.icon,
    this.imageUrl,
  });

  final String letter;
  final String seed;
  final double size;
  final double radius;
  final IconData? icon;

  /// Real artwork from the catalogue row. The letter tile stays underneath, so a
  /// dead URL never leaves an empty frame.
  final String? imageUrl;

  static const List<List<Color>> _gradients = <List<Color>>[
    <Color>[NabinColor.brand, NabinColor.brandHover],
    <Color>[RestaurantTheme.charcoal, NabinColor.brandBright],
    <Color>[NabinColor.foodOrange, NabinColor.warningDark],
    <Color>[NabinColor.onSurface, NabinColor.brand],
    <Color>[NabinColor.successDark, NabinColor.success],
  ];

  List<Color> get _stops {
    var hash = 0;
    for (final unit in seed.codeUnits) {
      hash = (hash * 31 + unit) & 0x7FFFFFFF;
    }
    return _gradients[hash % _gradients.length];
  }

  @override
  Widget build(BuildContext context) {
    final Widget tile = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: _stops,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(radius),
      ),
      child: icon == null
          ? Text(
              letter,
              style: TextStyle(
                color: NabinColor.onBrand,
                fontSize: size * 0.42,
                fontWeight: FontWeight.w900,
              ),
            )
          : Icon(icon, color: NabinColor.onBrand, size: size * 0.42),
    );

    if (imageUrl == null) return tile;
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: Stack(
        fit: StackFit.expand,
        children: <Widget>[
          tile,
          Image.network(
            imageUrl!,
            fit: BoxFit.cover,
            errorBuilder: (context, error, stackTrace) => const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }
}

/// Loading, error-with-retry and empty states for the food lists, so each list
/// in the feature speaks the same three-state language.
class FoodMessageCard extends StatelessWidget {
  const FoodMessageCard({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.actionLabel,
    this.onAction,
    this.padding = const EdgeInsets.symmetric(vertical: 40, horizontal: 18),
  });

  final IconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: RestaurantTheme.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: RestaurantTheme.border),
      ),
      child: Column(
        children: <Widget>[
          Icon(icon, size: 44, color: RestaurantTheme.neonOrange),
          const SizedBox(height: 10),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontWeight: FontWeight.w900,
              fontSize: 15,
              color: RestaurantTheme.charcoal,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText, height: 1.4),
          ),
          if (actionLabel != null && onAction != null) ...<Widget>[
            const SizedBox(height: 14),
            OutlinedButton.icon(
              onPressed: onAction,
              icon: const Icon(Icons.refresh_rounded, size: 18),
              label: Text(actionLabel!),
              style: OutlinedButton.styleFrom(
                foregroundColor: RestaurantTheme.neonOrangeDark,
                side: const BorderSide(color: RestaurantTheme.neonOrange),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Placeholder rows that hold the vertical rhythm of the real list.
class FoodListSkeleton extends StatelessWidget {
  const FoodListSkeleton({super.key, this.itemCount = 3, this.rowHeight = 102});

  final int itemCount;
  final double rowHeight;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: List<Widget>.generate(
        itemCount,
        (index) => Container(
          height: rowHeight,
          margin: const EdgeInsets.only(bottom: 14),
          decoration: BoxDecoration(
            color: RestaurantTheme.white,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: RestaurantTheme.border),
          ),
          child: Row(
            children: <Widget>[
              Container(
                width: rowHeight - 28,
                height: rowHeight - 28,
                margin: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: RestaurantTheme.borderLight,
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              const Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    _Bar(width: 150, color: RestaurantTheme.borderLight),
                    SizedBox(height: 8),
                    _Bar(width: 210, color: RestaurantTheme.borderLight),
                    SizedBox(height: 8),
                    _Bar(width: 90, color: RestaurantTheme.borderLight),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Bar extends StatelessWidget {
  const _Bar({required this.width, required this.color});

  final double width;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: 10,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(5),
      ),
    );
  }
}

/// Small pill used for the cuisine filters and the veg / non-veg menu filter.
class FoodFilterPill extends StatelessWidget {
  const FoodFilterPill({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    this.icon,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        margin: const EdgeInsets.only(right: 8),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? RestaurantTheme.neonOrange : RestaurantTheme.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: selected ? RestaurantTheme.neonOrange : RestaurantTheme.border),
          boxShadow: selected
              ? <BoxShadow>[
                  BoxShadow(
                    color: RestaurantTheme.neonOrange.withValues(alpha: 0.3),
                    blurRadius: 6,
                    offset: const Offset(0, 2),
                  ),
                ]
              : const <BoxShadow>[],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            if (icon != null) ...<Widget>[
              Icon(icon, size: 14, color: selected ? NabinColor.onBrand : RestaurantTheme.charcoal),
              const SizedBox(width: 5),
            ],
            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w800,
                color: selected ? NabinColor.onBrand : RestaurantTheme.charcoal,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Veg / non-veg marker. Restaurants declare this on the fixture catalogue only;
/// a PostgreSQL dish has no veg column, so an undeclared dish renders no marker
/// rather than guessing non-veg.
class FoodDietDot extends StatelessWidget {
  const FoodDietDot({super.key, required this.isVeg, this.size = 14});

  final bool? isVeg;
  final double size;

  @override
  Widget build(BuildContext context) {
    if (isVeg == null) return const SizedBox.shrink();
    final color = isVeg == true ? RestaurantTheme.vegGreen : RestaurantTheme.nonVegRed;
    return Container(
      width: size,
      height: size,
      padding: EdgeInsets.all(size * 0.18),
      decoration: BoxDecoration(
        color: RestaurantTheme.white,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: color, width: 1.4),
      ),
      child: Icon(Icons.fiber_manual_record, color: color, size: size * 0.4),
    );
  }
}
