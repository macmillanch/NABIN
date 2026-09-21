import 'package:flutter/material.dart';
import '../theme/nabin_palette.dart';

enum NabinStatusType { success, warning, error, info, neutral }

class NabinStatusChip extends StatelessWidget {
  final String label;
  final NabinStatusType type;
  final IconData? icon;

  const NabinStatusChip({
    super.key,
    required this.label,
    this.type = NabinStatusType.neutral,
    this.icon,
  });

  Color _colorFor(NabinPalette palette) {
    switch (type) {
      case NabinStatusType.success:
        return palette.success;
      case NabinStatusType.warning:
        return palette.warning;
      case NabinStatusType.error:
        return palette.danger;
      case NabinStatusType.info:
        return palette.brand;
      case NabinStatusType.neutral:
        return palette.onSurfaceMuted;
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = _colorFor(NabinPalette.of(context));
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(100),
        border: Border.all(color: color.withValues(alpha: 0.2)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 14, color: color),
            const SizedBox(width: 4),
          ],
          Text(
            label.toUpperCase(),
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: color,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.5,
                ),
          ),
        ],
      ),
    );
  }
}
