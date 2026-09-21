import 'package:flutter/material.dart';
import 'nabin_tokens.dart';

/// NABIN Driver App theme — dark-first cockpit for in-vehicle use.
///
/// Tokens come from [NabinColor]/[NabinTheme]; this class only keeps the names
/// the driver screens already reference.
class DriverTheme {
  // Brand & Accent Colors
  static const Color primaryBlue = NabinColor.driverAccent;
  static const Color primaryBlueLight = Color(0xFFB4C5FF);  // Surface Tint / Accent Light
  static const Color primaryBlueDark = Color(0xFF003EA8);   // Deep Anchor
  static const Color accentCyan = NabinColor.telemetryCyan;

  // Status Colors
  static const Color onlineGreen = NabinColor.success;
  static const Color onlineGreenDark = Color(0xFF064E3B);   // Dark Emerald Container
  static const Color offlineGrey = Color(0xFF434655);       // Offline / Outline Variant
  static const Color alertRed = NabinColor.dangerBright;
  static const Color warningAmber = NabinColor.warning;
  static const Color rewardGold = NabinColor.gold;

  // Dark Cockpit Surfaces & Text
  static const Color bgObsidian = NabinColor.canvasDark;
  static const Color surfaceContainer = NabinColor.surfaceDark;
  static const Color surfaceCard = NabinColor.surfaceDarkElevated;
  static const Color surfaceElevated = NabinColor.surfaceDarkActive;
  static const Color textPrimary = NabinColor.onDarkSurface;
  static const Color textMuted = NabinColor.onDarkSurfaceMuted;
  static const Color borderGlass = NabinColor.dividerDark;

  // Light Cockpit & Day Mode Accents
  static const Color bgLight = NabinColor.canvas;
  static const Color borderLight = NabinColor.divider;
  static const Color textDark = NabinColor.onSurface;
  static const Color roadGold = NabinColor.warningDark;

  // Service Badge Accents
  static const Color rideBadge = NabinColor.driverAccent;
  static const Color parcelBadge = NabinColor.warning;
  static const Color foodBadge = NabinColor.success;

  static ThemeData get darkTheme => NabinTheme.dark(role: NabinRole.driver);

  static ThemeData get lightTheme => darkTheme; // Default to dark-first cockpit
}

