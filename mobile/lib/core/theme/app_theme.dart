import 'package:flutter/material.dart';
import 'driver_theme.dart';
import 'nabin_palette.dart';
import 'nabin_tokens.dart';

/// NABIN Customer theme facade.
///
/// Colour/typography values are no longer declared here — they come from
/// [NabinColor], [NabinType] and [NabinTheme] so all role apps stay identical.
/// These members remain as the names the existing screens already use.
class AppTheme {
  static const Color background = NabinColor.canvas;
  static const Color surface = NabinColor.surface;
  static const Color surfaceContainer = NabinColor.surfaceMuted;
  static const Color surfaceContainerHigh = NabinColor.surfaceEmphasized;
  static const Color surfaceContainerHighest = Color(0xFFCBD5E1);
  static const Color surfaceContainerLow = NabinColor.canvas;
  static const Color surfaceContainerLowest = NabinColor.surface;

  static const Color primary = NabinColor.brand;
  static const Color primaryContainer = NabinColor.brand;
  static const Color primaryFixed = NabinColor.brandTint;
  static const Color onPrimary = NabinColor.onBrand;

  static const Color tertiary = NabinColor.foodOrange;
  static const Color tertiaryContainer = NabinColor.foodOrange;
  static const Color tertiaryFixed = NabinColor.warningTint;
  static const Color groceryGreen = NabinColor.groceryGreen;

  static const Color onSurface = NabinColor.onSurface;
  static const Color onSurfaceVariant = NabinColor.onSurfaceMuted;
  static const Color outline = NabinColor.divider;
  static const Color outlineVariant = NabinColor.divider;

  static const Color success = NabinColor.success;
  static const Color warning = NabinColor.warning;
  static const Color error = NabinColor.danger;

  static const Color backgroundDark = NabinColor.onSurface;
  static const Color surfaceCard = NabinColor.surface;
  static const Color glassBorder = NabinColor.divider;
  static const Color primaryNavy = NabinColor.brand;
  static const Color primaryNavyDim = NabinColor.brandHover;
  static const Color textPrimary = NabinColor.onSurface;
  static const Color textSecondary = NabinColor.onSurfaceMuted;
  static const Color customerAccent = NabinColor.brand;
  static const Color customerSecondary = NabinColor.groceryGreen;
  static const Color driverAccent = NabinColor.foodOrange;
  static const Color driverOnlineGreen = NabinColor.success;
  static const Color restaurantAccent = NabinColor.foodOrange;
  static const Color restaurantReady = NabinColor.warning;
  static const Color adminAccent = NabinColor.adminAccent;
  static const Color adminCyan = NabinColor.info;

  static const Color serviceRide = NabinColor.rideBlue;
  static const Color serviceRide2W = NabinColor.rideBlue;
  static const Color serviceRide3W = NabinColor.warning;
  static const Color serviceRide4W = NabinColor.rideBlue;
  static const Color serviceParcel = NabinColor.parcelTeal;
  static const Color serviceFood = NabinColor.foodOrange;
  static const Color serviceGrocery = NabinColor.groceryGreen;
  static const Color fintechAccent = NabinColor.warning;

  static ThemeData customerTheme({NabinPalette? palette}) =>
      NabinTheme.light(role: NabinRole.customer, palette: palette);
  static ThemeData driverTheme({NabinPalette? palette}) =>
      DriverTheme.darkTheme(palette: palette);
  static ThemeData restaurantTheme({NabinPalette? palette}) =>
      NabinTheme.light(role: NabinRole.restaurantMerchant, palette: palette);
  static ThemeData groceryTheme({NabinPalette? palette}) =>
      NabinTheme.light(role: NabinRole.groceryMerchant, palette: palette);
  static ThemeData adminTheme({NabinPalette? palette}) =>
      NabinTheme.light(role: NabinRole.admin, palette: palette);
}
