import 'package:flutter/material.dart';
import '../../../../core/theme/nabin_palette.dart';
import '../../../../core/theme/nabin_tokens.dart';

/// NABIN Grocery Express theme (10-Minute Quick Commerce — Fresh Green).
class GroceryTheme {
  static const Color masterBlue = NabinColor.brand;
  static const Color primaryGreen = NabinColor.groceryGreen;
  static const Color primaryGreenDark = NabinColor.successDark;
  static const Color primaryGreenLight = NabinColor.successTint;
  static const Color accentAmber = NabinColor.warning;
  static const Color accentRose = NabinColor.danger;

  static const Color bgOffWhite = NabinColor.canvas;
  static const Color surfaceWhite = NabinColor.surface;
  static const Color surfaceElevated = NabinColor.surfaceMuted;
  static const Color textDark = NabinColor.onSurface;
  static const Color textMuted = NabinColor.onSurfaceMuted;
  static const Color borderLight = NabinColor.divider;

  static ThemeData theme({NabinPalette? palette}) =>
      NabinTheme.light(role: NabinRole.groceryMerchant, palette: palette);
}
