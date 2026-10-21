import 'package:flutter/material.dart';
import '../theme/nabin_tokens.dart';

/// The official NABIN canonical logo widget.
///
/// Combines the brand owner's official half-logo mark asset (rounded squircle with "n")
/// with the canonical Neuron/Inter wordmark "NABIN" (#1A3BA2), ensuring:
/// 1. The exact official visual brand identity is painted across all apps.
/// 2. Text finders and accessibility screen readers discover 'NABIN'.
/// 3. Zero dependency on network/remote asset fetching.
class NabinBrandLogo extends StatelessWidget {
  const NabinBrandLogo({
    super.key,
    this.fontSize = 22,
    this.height,
    this.color,
    this.badge,
    this.badgeColor,
    this.badgeTextColor,
    this.isLight = false,
    this.showIcon = false,
  });

  /// Approximate font size for the wordmark text.
  final double fontSize;

  /// Optional height for the logo mark icon. Defaults to [fontSize * 1.15].
  final double? height;

  /// Explicit color override. Defaults to [NabinColor.brand] (#1A3BA2) or white if [isLight] is true.
  final Color? color;

  /// Optional contextual role badge (e.g. 'DRIVER', 'SUPER APP', 'RESTAURANT', 'GROCERY').
  final String? badge;

  /// Background color for the optional role badge.
  final Color? badgeColor;

  /// Text color for the optional role badge.
  final Color? badgeTextColor;

  /// Set to true when rendering on top of a dark surface or brand blue background.
  final bool isLight;

  /// Whether to show the official half-logo squircle mark beside the wordmark.
  final bool showIcon;

  @override
  Widget build(BuildContext context) {
    final effectiveHeight = height ?? (fontSize * 1.15).clamp(16.0, 48.0);
    final effectiveColor = color ?? (isLight ? Colors.white : NabinColor.brand);

    final markIcon = showIcon
        ? Padding(
            padding: const EdgeInsets.only(right: 6),
            child: Image.asset(
              'assets/branding/nabin_logo_half.png',
              height: effectiveHeight,
              fit: BoxFit.contain,
              errorBuilder: (_, __, ___) => const SizedBox.shrink(),
            ),
          )
        : const SizedBox.shrink();

    final wordmark = Text(
      'NABIN',
      semanticsLabel: 'NABIN',
      style: NabinWordmark.scale(
        fontSize: fontSize,
        color: effectiveColor,
        fallbackWeight: FontWeight.w900,
        letterSpacing: 1.2,
      ),
    );

    if (badge == null && !showIcon) {
      return wordmark;
    }

    if (badge == null) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          markIcon,
          wordmark,
        ],
      );
    }

    final effectiveBadgeBg = badgeColor ??
        (isLight
            ? Colors.white.withValues(alpha: 0.2)
            : NabinColor.brandTint);
    final effectiveBadgeText = badgeTextColor ??
        (isLight ? Colors.white : NabinColor.brand);

    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        if (showIcon) markIcon,
        wordmark,
        const SizedBox(width: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
          decoration: BoxDecoration(
            color: effectiveBadgeBg,
            borderRadius: BorderRadius.circular(4),
          ),
          child: Text(
            badge!.toUpperCase(),
            style: TextStyle(
              fontSize: (fontSize * 0.44).clamp(9.0, 12.0),
              fontWeight: FontWeight.w800,
              letterSpacing: 0.8,
              color: effectiveBadgeText,
            ),
          ),
        ),
      ],
    );
  }
}
