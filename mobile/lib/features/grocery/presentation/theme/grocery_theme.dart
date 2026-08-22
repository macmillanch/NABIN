import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// NABIN Grocery Express Dedicated Theme (10-Minute Instant Quick-Commerce)
class GroceryTheme {
  // Brand Palette
  static const Color masterBlue = Color(0xFF3C4890);         // Master Brand Blue
  static const Color primaryGreen = Color(0xFF22A447);       // Fresh Green Accent
  static const Color primaryGreenDark = Color(0xFF1B8238);   // Forest Green
  static const Color primaryGreenLight = Color(0xFFE8F5E9);  // Soft Mint Tint
  static const Color accentAmber = Color(0xFFF59E0B);        // Flash Deal Amber
  static const Color accentRose = Color(0xFFDC2626);         // Discount Tag Red

  // Surfaces & Backgrounds
  static const Color bgOffWhite = Color(0xFFF8FAFC);         // Screen Background
  static const Color surfaceWhite = Colors.white;            // Card Surface
  static const Color surfaceElevated = Color(0xFFF1F5F9);     // Subtle Container
  static const Color textDark = Color(0xFF111827);           // Charcoal Title
  static const Color textMuted = Color(0xFF64748B);          // Slate Subtitle
  static const Color borderLight = Color(0xFFE2E8F0);        // Card Stroke

  static ThemeData get theme => ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    scaffoldBackgroundColor: bgOffWhite,
    primaryColor: primaryGreen,
    colorScheme: const ColorScheme.light(
      primary: primaryGreen,
      secondary: primaryGreenDark,
      surface: surfaceWhite,
      error: accentRose,
      onPrimary: Colors.white,
      onSurface: textDark,
    ),
    textTheme: GoogleFonts.interTextTheme(
      const TextTheme(
        headlineLarge: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: textDark),
        headlineMedium: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: textDark),
        titleLarge: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: textDark),
        titleMedium: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: textDark),
        bodyLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: textDark),
        bodyMedium: TextStyle(fontSize: 13, fontWeight: FontWeight.normal, color: textMuted),
        labelLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: Colors.white),
      ),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: surfaceWhite,
      elevation: 0,
      iconTheme: IconThemeData(color: textDark),
      titleTextStyle: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: textDark),
      centerTitle: false,
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: primaryGreen,
        foregroundColor: Colors.white,
        elevation: 0,
        minimumSize: const Size(double.infinity, 50),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
      ),
    ),
  );
}
