import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'driver_theme.dart';

/// NABIN MASTER PLATFORM DESIGN SYSTEM
/// Master Brand Identity: Navy Blue #3C4890
/// Shared: Background #F8FAFC, White #FFFFFF, Primary Text #111827, Secondary Text #64748B, Border #E2E8F0
class AppTheme {
  // Master Palette
  static const Color background = Color(0xFFF8FAFC);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color surfaceContainer = Color(0xFFF1F5F9);
  static const Color surfaceContainerHigh = Color(0xFFE2E8F0);
  static const Color surfaceContainerHighest = Color(0xFFCBD5E1);
  static const Color surfaceContainerLow = Color(0xFFF8FAFC);
  static const Color surfaceContainerLowest = Color(0xFFFFFFFF);

  // Primary Master Brand
  static const Color primary = Color(0xFF3C4890);             // NABIN Master Blue #3C4890
  static const Color primaryContainer = Color(0xFF3C4890);    // Master Brand CTA
  static const Color primaryFixed = Color(0xFFE0E5FF);
  static const Color onPrimary = Color(0xFFFFFFFF);

  // Service Accents
  static const Color tertiary = Color(0xFFFF9030);           // Food Neon Orange #FF9030
  static const Color tertiaryContainer = Color(0xFFFF9030);  // Food Accent
  static const Color tertiaryFixed = Color(0xFFFFF4EC);
  static const Color groceryGreen = Color(0xFF22A447);       // Grocery Fresh Green #22A447

  // Text & Outlines
  static const Color onSurface = Color(0xFF111827);           // Primary Text #111827
  static const Color onSurfaceVariant = Color(0xFF64748B);    // Secondary Text #64748B
  static const Color outline = Color(0xFFE2E8F0);             // Border #E2E8F0
  static const Color outlineVariant = Color(0xFFE2E8F0);

  // Status Colors
  static const Color success = Color(0xFF22A447);
  static const Color warning = Color(0xFFF59E0B);
  static const Color error = Color(0xFFDC2626);

  // Backward-compatible Tokens for Components
  static const Color backgroundDark = Color(0xFF111827);
  static const Color surfaceCard = Color(0xFFFFFFFF);
  static const Color glassBorder = Color(0xFFE2E8F0);
  static const Color primaryNavy = Color(0xFF3C4890);
  static const Color primaryNavyDim = Color(0xFF2A346C);
  static const Color textPrimary = Color(0xFF111827);
  static const Color textSecondary = Color(0xFF64748B);
  static const Color customerAccent = Color(0xFF3C4890);
  static const Color customerSecondary = Color(0xFF22A447);
  static const Color driverAccent = Color(0xFFFF9030);
  static const Color driverOnlineGreen = Color(0xFF22A447);
  static const Color restaurantAccent = Color(0xFFFF9030);
  static const Color restaurantReady = Color(0xFFF59E0B);
  static const Color adminAccent = Color(0xFF3C4890);
  static const Color adminCyan = Color(0xFF0284C7);

  // Service Specific Chips
  static const Color serviceRide = Color(0xFF0052CC);        // Mobility Accent
  static const Color serviceRide2W = Color(0xFF0052CC);
  static const Color serviceRide3W = Color(0xFFF59E0B);
  static const Color serviceRide4W = Color(0xFF0052CC);
  static const Color serviceParcel = Color(0xFF00897B);      // Parcel & Logistics Accent
  static const Color serviceFood = Color(0xFFFF9030);        // Food & Dining Accent
  static const Color serviceGrocery = Color(0xFF22A447);     // Grocery Express Accent
  static const Color fintechAccent = Color(0xFFF59E0B);      // Fintech & Gold Accent

  static ThemeData get customerTheme => ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    scaffoldBackgroundColor: background,
    colorScheme: const ColorScheme.light(
      primary: primary,
      primaryContainer: primaryContainer,
      surface: surface,
      onSurface: onSurface,
      onPrimary: onPrimary,
    ),
    textTheme: GoogleFonts.interTextTheme(
      const TextTheme(
        displayLarge: TextStyle(fontSize: 32, fontWeight: FontWeight.w900, color: onSurface, letterSpacing: -0.5),
        headlineLarge: TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: onSurface, letterSpacing: -0.3),
        headlineMedium: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: onSurface),
        titleLarge: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: onSurface),
        titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: onSurface),
        bodyLarge: TextStyle(fontSize: 16, fontWeight: FontWeight.normal, color: onSurface),
        bodyMedium: TextStyle(fontSize: 14, fontWeight: FontWeight.normal, color: onSurfaceVariant),
        labelLarge: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: onSurface, letterSpacing: 0.2),
        labelSmall: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: onSurfaceVariant, letterSpacing: 0.5),
      ),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: surface,
      elevation: 0,
      iconTheme: IconThemeData(color: onSurface),
      titleTextStyle: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: primary),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: primaryContainer,
        foregroundColor: onPrimary,
        elevation: 2,
        minimumSize: const Size(double.infinity, 54),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
      ),
    ),
  );

  static ThemeData get driverTheme => DriverTheme.darkTheme;
  static ThemeData get restaurantTheme => customerTheme;
}
