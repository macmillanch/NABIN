import 'package:flutter/material.dart';
import '../../../core/theme/nabin_tokens.dart';

/// NABIN Restaurant & Food service theme (Neon Orange on neutral surfaces).
///
/// Values are sourced from the canonical token layer; this class keeps the
/// names the restaurant and food screens already reference.
class RestaurantTheme {
  static const Color masterBlue = NabinColor.brand;

  static const Color neonOrange = NabinColor.foodOrange;
  static const Color neonOrangeLight = NabinColor.warningTint;
  static const Color neonOrangeDark = Color(0xFFE07315);

  static const Color charcoal = NabinColor.onSurface;
  static const Color charcoalSurface = Color(0xFF1F2937);
  static const Color charcoalDark = Color(0xFF0B0F17);

  static const Color white = NabinColor.surface;
  static const Color lightBg = NabinColor.canvas;
  static const Color secondaryText = NabinColor.onSurfaceMuted;
  static const Color border = NabinColor.divider;
  static const Color borderLight = NabinColor.surfaceMuted;

  static const Color vegGreen = NabinColor.success;
  static const Color nonVegRed = NabinColor.danger;
  static const Color warning = NabinColor.warning;
  static const Color success = NabinColor.success;
  static const Color error = NabinColor.danger;

  static const Color primaryBlue = masterBlue;
  static const Color primaryContainer = neonOrange;
  static const Color textDark = charcoal;
  static const Color textMuted = secondaryText;
  static const Color bgSurface = lightBg;
  static const Color surfaceCard = white;
  static const Color surfaceContainer = lightBg;
  static const Color outlineVariant = border;
  static const Color statusReadyGreen = success;
  static const Color statusReadyBg = NabinColor.successTint;
  static const Color statusPrepAmber = warning;
  static const Color statusAlertRed = error;

  static TextStyle get orderNumberStyle => NabinType.numeric(fontSize: 28);
  static TextStyle get orderNumberLarge => NabinType.numeric(fontSize: 36, weight: FontWeight.w900);

  static ThemeData get lightTheme => NabinTheme.light(role: NabinRole.restaurantMerchant);
}
