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

  /// Brand chrome roles (Customer Grocery sub-flow). ADDITIVE: the constants
  /// above stay exactly as the Grocery Merchant app reads them.
  ///
  /// Structure (app-bar band, the one main action per view, selected aisle,
  /// soft section fills, active nav) is NABIN brand; the greens are demoted to
  /// service identity — artwork tints, stock and discount chips, price
  /// emphasis, row-level ADD controls.
  static const Color headerBand = NabinColor.brand;
  static const Color onHeader = NabinColor.onBrand;
  static const Color primaryAction = NabinColor.brand;
  static const Color onPrimaryAction = NabinColor.onBrand;
  static const Color secondaryAction = NabinColor.surface;
  static const Color onSecondaryAction = NabinColor.brand;
  static const Color chipSelected = NabinColor.brand;
  static const Color onChipSelected = NabinColor.onBrand;
  static const Color sectionFill = NabinColor.brandTint;
  static const Color serviceAccent = NabinColor.groceryGreen;

  static ThemeData theme({NabinPalette? palette}) =>
      NabinTheme.light(role: NabinRole.groceryMerchant, palette: palette);
}
