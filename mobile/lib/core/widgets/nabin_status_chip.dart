import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

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

  Color get _color {
    switch (type) {
      case NabinStatusType.success:
        return AppTheme.success;
      case NabinStatusType.warning:
        return AppTheme.warning;
      case NabinStatusType.error:
        return AppTheme.error;
      case NabinStatusType.info:
        return AppTheme.primary;
      case NabinStatusType.neutral:
        return AppTheme.onSurfaceVariant;
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = _color;
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
