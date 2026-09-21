import 'package:flutter/material.dart';
import '../theme/nabin_palette.dart';

class NabinCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry margin;
  final VoidCallback? onTap;
  final Color? color;
  final double borderRadius;
  final bool hasShadow;

  const NabinCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16.0),
    this.margin = const EdgeInsets.symmetric(vertical: 8.0),
    this.onTap,
    this.color,
    this.borderRadius = 16.0,
    this.hasShadow = true,
  });

  @override
  Widget build(BuildContext context) {
    final NabinPalette palette = NabinPalette.of(context);
    Widget cardContent = Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: color ?? palette.surface,
        borderRadius: BorderRadius.circular(borderRadius),
        border: Border.all(color: palette.divider.withValues(alpha: 0.5)),
        boxShadow: hasShadow
            ? [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.04),
                  blurRadius: 10,
                  offset: const Offset(0, 2),
                ),
              ]
            : null,
      ),
      child: child,
    );

    if (onTap != null) {
      return Padding(
        padding: margin,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(borderRadius),
            onTap: onTap,
            child: cardContent,
          ),
        ),
      );
    }

    return Padding(
      padding: margin,
      child: cardContent,
    );
  }
}
