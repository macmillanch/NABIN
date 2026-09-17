import 'package:flutter/material.dart';

/// NABIN Grocery Merchant Dedicated Theme (Clean Black & Green)
class GroceryMerchantTheme {
  // Brand Palette
  static const Color masterBlue = Color(0xFF3C4890);
  static const Color primaryGreen = Color(0xFF22A447);
  static const Color primaryGreenDark = Color(0xFF1B8238);
  static const Color primaryGreenLight = Color(0xFFE8F5E9);
  static const Color accentAmber = Color(0xFFF59E0B);
  static const Color accentRose = Color(0xFFDC2626);

  // Surfaces & Backgrounds
  static const Color bgOffWhite = Color(0xFFF8FAFC);
  static const Color surfaceWhite = Colors.white;
  static const Color surfaceElevated = Color(0xFFF1F5F9);
  static const Color textDark = Color(0xFF111827);
  static const Color textMuted = Color(0xFF64748B);
  static const Color borderLight = Color(0xFFE2E8F0);

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
    textTheme: const TextTheme(
      headlineLarge: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: textDark),
      headlineMedium: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: textDark),
      titleLarge: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: textDark),
      titleMedium: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: textDark),
      bodyLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: textDark),
      bodyMedium: TextStyle(fontSize: 13, fontWeight: FontWeight.normal, color: textMuted),
      labelLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: Colors.white),
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