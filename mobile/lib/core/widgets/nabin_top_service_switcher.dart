import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

enum NabinServiceCategory {
  ride,
  food,
  grocery,
  parcel,
}

class NabinTopServiceSwitcher extends StatelessWidget {
  const NabinTopServiceSwitcher({
    super.key,
    required this.currentCategory,
    this.isDarkBackground = true,
    this.onCategoryChanged,
  });

  final NabinServiceCategory currentCategory;
  final bool isDarkBackground;
  final ValueChanged<NabinServiceCategory>? onCategoryChanged;

  void _handleTap(BuildContext context, NabinServiceCategory category) {
    if (category == currentCategory) return;
    if (onCategoryChanged != null) {
      onCategoryChanged!(category);
      return;
    }
    switch (category) {
      case NabinServiceCategory.ride:
        context.go('/home');
        break;
      case NabinServiceCategory.food:
        context.go('/food-home');
        break;
      case NabinServiceCategory.grocery:
        context.go('/grocery-home');
        break;
      case NabinServiceCategory.parcel:
        context.go('/parcel-booking');
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      physics: const BouncingScrollPhysics(),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          _buildItem(
            context,
            category: NabinServiceCategory.food,
            emoji: '🍔',
            label: 'Food',
            badge: null,
          ),
          const SizedBox(width: 8),
          _buildItem(
            context,
            category: NabinServiceCategory.grocery,
            emoji: '🛒',
            label: 'Instamart',
            badge: '13 Mins',
          ),
          const SizedBox(width: 8),
          _buildItem(
            context,
            category: NabinServiceCategory.ride,
            emoji: '🚕',
            label: 'Ride',
            badge: 'Fastest',
          ),
          const SizedBox(width: 8),
          _buildItem(
            context,
            category: NabinServiceCategory.parcel,
            emoji: '📦',
            label: 'Parcel',
            badge: 'Courier',
          ),
        ],
      ),
    );
  }

  Widget _buildItem(
    BuildContext context, {
    required NabinServiceCategory category,
    required String emoji,
    required String label,
    required String? badge,
  }) {
    final bool isSelected = category == currentCategory;

    if (isSelected) {
      return GestureDetector(
        onTap: () => _handleTap(context, category),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(22),
            boxShadow: <BoxShadow>[
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.16),
                blurRadius: 8,
                offset: const Offset(0, 3),
              ),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(emoji, style: const TextStyle(fontSize: 16)),
              const SizedBox(width: 6),
              Text(
                label,
                style: const TextStyle(
                  color: Color(0xFF1E1B4B),
                  fontWeight: FontWeight.w900,
                  fontSize: 13,
                  letterSpacing: -0.2,
                ),
              ),
            ],
          ),
        ),
      );
    }

    final Color itemBg = isDarkBackground
        ? const Color(0xFF381B59).withValues(alpha: 0.88)
        : Colors.black.withValues(alpha: 0.08);
    final Color textColor = isDarkBackground ? Colors.white : const Color(0xFF1E293B);

    return GestureDetector(
      onTap: () => _handleTap(context, category),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: itemBg,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(
            color: isDarkBackground
                ? Colors.white.withValues(alpha: 0.12)
                : Colors.black.withValues(alpha: 0.06),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(emoji, style: const TextStyle(fontSize: 14)),
            const SizedBox(width: 6),
            Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  label,
                  style: TextStyle(
                    color: textColor,
                    fontWeight: FontWeight.w800,
                    fontSize: 12,
                  ),
                ),
                if (badge != null) ...<Widget>[
                  const SizedBox(height: 2),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                    decoration: BoxDecoration(
                      color: const Color(0xFF2563EB),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      badge,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 8.5,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 0.3,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

