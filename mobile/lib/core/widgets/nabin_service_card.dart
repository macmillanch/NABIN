import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import 'nabin_card.dart';

class NabinServiceCard extends StatelessWidget {
  final String title;
  final String subtitle;
  final IconData icon;
  final Color primaryColor;
  final String? tagText;
  final Color? tagColor;
  final bool isEnabled;
  final VoidCallback onTap;
  final bool isHero;

  const NabinServiceCard({
    super.key,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.primaryColor,
    required this.onTap,
    this.tagText,
    this.tagColor,
    this.isEnabled = true,
    this.isHero = false,
  });

  @override
  Widget build(BuildContext context) {
    if (isHero) {
      return _buildHeroCard();
    }
    return _buildStandardCard();
  }

  Widget _buildHeroCard() {
    return GestureDetector(
      onTap: isEnabled ? onTap : null,
      child: Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: isEnabled ? primaryColor : AppTheme.surfaceContainerHigh,
          borderRadius: BorderRadius.circular(22),
          boxShadow: isEnabled
              ? [
                  BoxShadow(
                      color: primaryColor.withValues(alpha: 0.28),
                      blurRadius: 14,
                      offset: const Offset(0, 5)),
                ]
              : null,
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (tagText != null)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: isEnabled ? Colors.white.withValues(alpha: 0.2) : Colors.black12,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        tagText!,
                        style: TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.w900,
                            color: isEnabled ? Colors.white : Colors.black54,
                            letterSpacing: 0.5),
                      ),
                    ),
                  const SizedBox(height: 10),
                  Text(
                    title,
                    style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w900,
                        color: isEnabled ? Colors.white : Colors.black54),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: TextStyle(
                        fontSize: 11.5,
                        color: isEnabled ? Colors.white.withValues(alpha: 0.9) : Colors.black45,
                        height: 1.3),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: isEnabled ? Colors.white : Colors.grey.shade300,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Row(
                          children: [
                            Text(
                              isEnabled ? 'Book Now' : 'Unavailable',
                              style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w900,
                                  color: isEnabled ? primaryColor : Colors.black45),
                            ),
                            const SizedBox(width: 4),
                            Icon(
                              isEnabled ? Icons.arrow_forward_rounded : Icons.block,
                              size: 14,
                              color: isEnabled ? primaryColor : Colors.black45,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Container(
              width: 76,
              height: 76,
              decoration: BoxDecoration(
                color: isEnabled ? Colors.white.withValues(alpha: 0.15) : Colors.black12,
                shape: BoxShape.circle,
              ),
              child: Center(
                child: Icon(
                  icon,
                  color: isEnabled ? Colors.white : Colors.black45,
                  size: 44,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStandardCard() {
    return GestureDetector(
      onTap: isEnabled ? onTap : null,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: isEnabled ? Colors.white : AppTheme.surfaceContainerHigh,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: isEnabled ? (tagColor ?? AppTheme.outline) : AppTheme.outline),
          boxShadow: isEnabled
              ? [
                  BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 8, offset: const Offset(0, 3)),
                ]
              : null,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: isEnabled ? primaryColor : Colors.grey,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(icon, color: Colors.white, size: 20),
                ),
                if (tagText != null)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: isEnabled ? (tagColor ?? primaryColor).withValues(alpha: 0.1) : Colors.black12,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      tagText!,
                      style: TextStyle(
                          fontSize: 8.5,
                          fontWeight: FontWeight.w900,
                          color: isEnabled ? (tagColor ?? primaryColor) : Colors.black54),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              title,
              style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w900,
                  color: isEnabled ? AppTheme.onSurface : Colors.black54),
            ),
            const SizedBox(height: 2),
            Text(
              subtitle,
              style: TextStyle(
                  fontSize: 11,
                  color: isEnabled ? AppTheme.onSurfaceVariant : Colors.black45,
                  height: 1.25),
            ),
            if (!isEnabled) ...[
              const SizedBox(height: 8),
              const Text('Temporarily offline', style: TextStyle(fontSize: 10, color: Colors.red, fontWeight: FontWeight.bold)),
            ]
          ],
        ),
      ),
    );
  }
}
