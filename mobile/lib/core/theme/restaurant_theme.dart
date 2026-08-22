import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// NABIN RESTAURANT & FOOD SERVICE DESIGN SYSTEM
/// Master Brand: NABIN Navy Blue #3C4890
/// Restaurant Palette: Neon Orange #FF9030 + Charcoal #111827 + White #FFFFFF + Light Gray #F8FAFC
class RestaurantTheme {
  // Master Platform Brand
  static const Color masterBlue = Color(0xFF3C4890);

  // Restaurant Primary Accent (Actions, Add buttons, active progress, offers)
  static const Color neonOrange = Color(0xFFFF9030);
  static const Color neonOrangeLight = Color(0xFFFFF4EC);
  static const Color neonOrangeDark = Color(0xFFE07315);

  // Structural & Typography Colors (Headers, Navigation, Dark cards, Primary text)
  static const Color charcoal = Color(0xFF111827);
  static const Color charcoalSurface = Color(0xFF1F2937);
  static const Color charcoalDark = Color(0xFF0B0F17);

  // Content & Background Surfaces
  static const Color white = Color(0xFFFFFFFF);
  static const Color lightBg = Color(0xFFF8FAFC);
  static const Color secondaryText = Color(0xFF64748B);
  static const Color border = Color(0xFFE5E7EB);
  static const Color borderLight = Color(0xFFF1F5F9);

  // Dietary & Status Indicators
  static const Color vegGreen = Color(0xFF22A447);
  static const Color nonVegRed = Color(0xFFDC2626);
  static const Color warning = Color(0xFFF59E0B);
  static const Color success = Color(0xFF22A447);
  static const Color error = Color(0xFFDC2626);

  // Legacy mappings for backwards compatibility
  static const Color primaryBlue = masterBlue;
  static const Color primaryContainer = neonOrange;
  static const Color textDark = charcoal;
  static const Color textMuted = secondaryText;
  static const Color bgSurface = lightBg;
  static const Color surfaceCard = white;
  static const Color surfaceContainer = lightBg;
  static const Color outlineVariant = border;
  static const Color statusReadyGreen = success;
  static const Color statusReadyBg = Color(0xFFE8F5E9);
  static const Color statusPrepAmber = warning;
  static const Color statusAlertRed = error;

  // Typography Styles
  static TextStyle get orderNumberStyle => GoogleFonts.inter(
    fontSize: 28,
    fontWeight: FontWeight.w800,
    color: charcoal,
    letterSpacing: -0.5,
  );

  static TextStyle get orderNumberLarge => GoogleFonts.inter(
    fontSize: 36,
    fontWeight: FontWeight.w900,
    color: charcoal,
    letterSpacing: -1.0,
  );

  static ThemeData get lightTheme => ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    scaffoldBackgroundColor: lightBg,
    colorScheme: const ColorScheme.light(
      primary: neonOrange,
      secondary: charcoal,
      surface: white,
      error: error,
      onPrimary: white,
      onSecondary: white,
      onSurface: charcoal,
    ),
    textTheme: GoogleFonts.interTextTheme(
      const TextTheme(
        displayLarge: TextStyle(fontSize: 32, fontWeight: FontWeight.w800, color: charcoal, letterSpacing: -0.5),
        headlineLarge: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: charcoal),
        headlineMedium: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: charcoal),
        titleLarge: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: charcoal),
        titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: charcoal),
        bodyLarge: TextStyle(fontSize: 16, fontWeight: FontWeight.normal, color: charcoal),
        bodyMedium: TextStyle(fontSize: 14, fontWeight: FontWeight.normal, color: secondaryText),
        labelLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: charcoal, letterSpacing: 0.2),
        labelSmall: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: secondaryText, letterSpacing: 0.5),
      ),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: white,
      elevation: 0,
      iconTheme: IconThemeData(color: charcoal),
      titleTextStyle: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: charcoal),
      centerTitle: false,
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: neonOrange,
        foregroundColor: white,
        elevation: 0,
        minimumSize: const Size(double.infinity, 50),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
      ),
    ),
    cardTheme: CardThemeData(
      color: white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: border, width: 1),
      ),
    ),
  );
}
