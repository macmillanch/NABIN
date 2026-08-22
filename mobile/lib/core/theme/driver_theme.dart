import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// NABIN Driver App Dedicated Theme (Stitch Nabin Driver System)
/// High-contrast, dark-first cockpit aesthetic with Royal Blue accents, designed for road safety & mission-critical clarity.
class DriverTheme {
  // Brand & Accent Colors
  static const Color primaryBlue = Color(0xFF2563EB);       // Royal Blue
  static const Color primaryBlueLight = Color(0xFFB4C5FF);  // Surface Tint / Accent Light
  static const Color primaryBlueDark = Color(0xFF003EA8);   // Deep Anchor
  static const Color accentCyan = Color(0xFF06B6D4);        // Telemetry Cyan
  
  // Status Colors
  static const Color onlineGreen = Color(0xFF10B981);       // Active Online / Success Emerald
  static const Color onlineGreenDark = Color(0xFF064E3B);   // Dark Emerald Container
  static const Color offlineGrey = Color(0xFF434655);       // Offline / Outline Variant
  static const Color alertRed = Color(0xFFEF4444);          // Decline / SOS / Critical Alert
  static const Color warningAmber = Color(0xFFF59E0B);      // Warning / Job countdown timer
  static const Color rewardGold = Color(0xFFFBBF24);        // Platinum Tier Accent

  // Dark Cockpit Surfaces & Text (Nabin Driver System DESIGN.md)
  static const Color bgObsidian = Color(0xFF0B0F14);        // Level 0: Global Background
  static const Color surfaceContainer = Color(0xFF111827);  // Level 1: Containers
  static const Color surfaceCard = Color(0xFF17202B);       // Level 2: Glass Cards & Modals
  static const Color surfaceElevated = Color(0xFF1E293B);   // Level 3: Active Pop-overs
  static const Color textPrimary = Color(0xFFF8FAFC);       // Pure High-Contrast Text
  static const Color textMuted = Color(0xFF94A3B8);         // Slate Secondary Text
  static const Color borderGlass = Color(0x1AFFFFFF);       // 10% Opacity Glass Stroke

  // Light Cockpit & Day Mode Accents
  static const Color bgLight = Color(0xFFF8FAFC);           // Day Mode Background
  static const Color borderLight = Color(0xFFE2E8F0);       // Day Mode Stroke
  static const Color textDark = Color(0xFF0F172A);          // Day Mode High Contrast Text
  static const Color roadGold = Color(0xFFD97706);          // High Visibility Amber Gold

  // Service Badge Accents
  static const Color rideBadge = Color(0xFF2563EB);         // Passenger Rides (2W/3W/4W)
  static const Color parcelBadge = Color(0xFFF59E0B);       // Instant Parcel Courier
  static const Color foodBadge = Color(0xFF10B981);         // Restaurant Food Delivery

  static ThemeData get darkTheme => ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: bgObsidian,
    colorScheme: const ColorScheme.dark(
      primary: primaryBlue,
      secondary: onlineGreen,
      surface: surfaceCard,
      error: alertRed,
      onPrimary: Colors.white,
      onSurface: textPrimary,
    ),
    textTheme: GoogleFonts.interTextTheme(
      const TextTheme(
        displayLarge: TextStyle(fontSize: 32, fontWeight: FontWeight.w900, color: textPrimary, letterSpacing: -0.5),
        headlineLarge: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: textPrimary, letterSpacing: -0.3),
        headlineMedium: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: textPrimary),
        titleLarge: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: textPrimary),
        titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: textPrimary),
        bodyLarge: TextStyle(fontSize: 16, fontWeight: FontWeight.normal, color: textPrimary),
        bodyMedium: TextStyle(fontSize: 14, fontWeight: FontWeight.normal, color: textMuted),
        labelLarge: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: textPrimary, letterSpacing: 0.2),
        labelSmall: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: textMuted, letterSpacing: 0.5),
      ),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: surfaceContainer,
      elevation: 0,
      iconTheme: IconThemeData(color: textPrimary),
      titleTextStyle: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: textPrimary),
      centerTitle: false,
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: primaryBlue,
        foregroundColor: Colors.white,
        elevation: 4,
        minimumSize: const Size(double.infinity, 54),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
      ),
    ),
  );

  static ThemeData get lightTheme => darkTheme; // Default to dark-first cockpit
}
