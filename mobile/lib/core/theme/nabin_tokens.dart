import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// NABIN canonical semantic tokens.
///
/// Every Flutter role app (Customer, Driver, Restaurant Merchant, Grocery
/// Merchant, Admin) renders from these values. The web token layer in
/// `customer-web`/`admin-web` `globals.css` mirrors this file verbatim, so a
/// colour or spacing change must be applied in both places.
class NabinColor {
  static const Color brand = Color(0xFF3C4890);
  static const Color brandHover = Color(0xFF2E376E);
  static const Color brandBright = Color(0xFF5A69BE);
  static const Color brandTint = Color(0xFFE0E5FF);

  static const Color success = Color(0xFF22A447);
  static const Color successDark = Color(0xFF1B8238);
  static const Color successTint = Color(0xFFE8F5E9);
  static const Color warning = Color(0xFFF59E0B);
  static const Color warningDark = Color(0xFFB45309);
  static const Color warningTint = Color(0xFFFFF4EC);
  static const Color danger = Color(0xFFDC2626);
  static const Color dangerBright = Color(0xFFEF4444);
  // Filled danger buttons carry a label, so they use the AA-safe variant:
  // white on #DC2626 measures 4.4:1, white on #B91C1C measures 5.9:1.
  static const Color dangerDark = Color(0xFFB91C1C);
  static const Color info = Color(0xFF0284C7);

  static const Color foodOrange = Color(0xFFFF9030);
  static const Color groceryGreen = Color(0xFF22A447);
  static const Color rideBlue = Color(0xFF0052CC);
  static const Color parcelTeal = Color(0xFF00897B);
  static const Color gold = Color(0xFFFBBF24);
  static const Color telemetryCyan = Color(0xFF06B6D4);

  // Role accents are duplicated as plain colours because Dart does not allow
  // reading `NabinRole.accent` inside a constant expression.
  static const Color driverAccent = Color(0xFF2563EB);
  static const Color adminAccent = Color(0xFF1E3A8A);
  // The driver app is the one dark surface, so its tint is an alpha blend of
  // the accent rather than a pale solid — a light chip would glare at night.
  static const Color driverAccentTint = Color(0x4D2563EB);
  static const Color adminAccentTint = Color(0xFFE8EDFB);

  // Light surface ramp
  static const Color canvas = Color(0xFFF8FAFC);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color surfaceMuted = Color(0xFFF1F5F9);
  static const Color surfaceEmphasized = Color(0xFFE2E8F0);
  static const Color onSurface = Color(0xFF0F172A);
  static const Color onSurfaceMuted = Color(0xFF64748B);
  static const Color divider = Color(0xFFE2E8F0);
  static const Color onBrand = Color(0xFFFFFFFF);

  // Dark surface ramp — driver cockpit and night-mode operations
  static const Color canvasDark = Color(0xFF0B0F14);
  static const Color surfaceDark = Color(0xFF111827);
  static const Color surfaceDarkElevated = Color(0xFF17202B);
  static const Color surfaceDarkActive = Color(0xFF1E293B);
  static const Color onDarkSurface = Color(0xFFF8FAFC);
  static const Color onDarkSurfaceMuted = Color(0xFF94A3B8);
  static const Color dividerDark = Color(0x1AFFFFFF);
}

class NabinSpacing {
  static const double xxs = 4;
  static const double xs = 8;
  static const double sm = 12;
  static const double md = 16;
  static const double lg = 20;
  static const double xl = 24;
  static const double xxl = 32;
  static const double xxxl = 48;

  static const EdgeInsets page = EdgeInsets.symmetric(horizontal: md, vertical: xs);
  static const EdgeInsets card = EdgeInsets.all(md);
  static const EdgeInsets listTile = EdgeInsets.symmetric(horizontal: sm, vertical: xs);
}

class NabinRadius {
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 20;
  static const double xl = 28;
  static const double pill = 999;

  static final BorderRadius card = BorderRadius.circular(lg);
  static final BorderRadius control = BorderRadius.circular(md);
  static final BorderRadius sheet = BorderRadius.vertical(top: Radius.circular(xl));
}

class NabinElevation {
  static const List<BoxShadow> low = <BoxShadow>[
    BoxShadow(color: Color(0x0D000000), blurRadius: 4, offset: Offset(0, 2)),
  ];
  static const List<BoxShadow> mid = <BoxShadow>[
    BoxShadow(color: Color(0x14000000), blurRadius: 12, offset: Offset(0, 4)),
  ];
  static const List<BoxShadow> high = <BoxShadow>[
    BoxShadow(color: Color(0x1F000000), blurRadius: 24, offset: Offset(0, 12)),
  ];
}

class NabinMotion {
  static const Duration instant = Duration(milliseconds: 120);
  static const Duration fast = Duration(milliseconds: 180);
  static const Duration base = Duration(milliseconds: 260);
  static const Duration slow = Duration(milliseconds: 420);
  static const Curve curve = Curves.easeOutCubic;
  static const Duration stagger = Duration(milliseconds: 40);

  static PageTransitionsTheme get pageTransitions => const PageTransitionsTheme(
        builders: <TargetPlatform, PageTransitionsBuilder>{
          TargetPlatform.android: FadeForwardsPageTransitionsBuilder(),
          TargetPlatform.iOS: PredictiveBackPageTransitionsBuilder(),
          TargetPlatform.macOS: PredictiveBackPageTransitionsBuilder(),
        },
      );
}

/// The four touch targets below 48dp are the most common mobile accessibility
/// defect, so the minimums are declared once here.
class NabinTarget {
  static const Size button = Size.fromHeight(52);
  static const double icon = 48;
  static const double input = 52;
  static const double listRow = 56;
}

class NabinRole {
  const NabinRole._(this.accent, this.tint, this.label);

  final Color accent;
  final Color tint;
  final String label;

  static const NabinRole customer = NabinRole._(NabinColor.brand, NabinColor.brandTint, 'Customer');
  static const NabinRole driver =
      NabinRole._(NabinColor.driverAccent, NabinColor.driverAccentTint, 'Driver');
  static const NabinRole restaurantMerchant =
      NabinRole._(NabinColor.foodOrange, NabinColor.warningTint, 'Restaurant');
  static const NabinRole groceryMerchant =
      NabinRole._(NabinColor.groceryGreen, NabinColor.successTint, 'Grocery');
  static const NabinRole admin =
      NabinRole._(NabinColor.adminAccent, NabinColor.adminAccentTint, 'Admin');
}

class NabinType {
  /// Inter drives all product UI. `NabinWordmark` is the only place the brand
  /// face may appear.
  static TextTheme textTheme(Brightness brightness) {
    final Color primary = brightness == Brightness.dark ? NabinColor.onDarkSurface : NabinColor.onSurface;
    final Color secondary =
        brightness == Brightness.dark ? NabinColor.onDarkSurfaceMuted : NabinColor.onSurfaceMuted;

    return GoogleFonts.interTextTheme(
      TextTheme(
        displayLarge: TextStyle(
            fontSize: 32, fontWeight: FontWeight.w900, color: primary, letterSpacing: -0.5),
        displayMedium: TextStyle(
            fontSize: 28, fontWeight: FontWeight.w800, color: primary, letterSpacing: -0.4),
        headlineLarge: TextStyle(
            fontSize: 24, fontWeight: FontWeight.w800, color: primary, letterSpacing: -0.3),
        headlineMedium: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: primary),
        headlineSmall: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: primary),
        titleLarge: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: primary),
        titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: primary),
        titleSmall: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: secondary),
        bodyLarge: TextStyle(fontSize: 16, fontWeight: FontWeight.w400, color: primary, height: 1.5),
        bodyMedium: TextStyle(fontSize: 14, fontWeight: FontWeight.w400, color: secondary, height: 1.5),
        bodySmall: TextStyle(fontSize: 12, fontWeight: FontWeight.w400, color: secondary, height: 1.45),
        labelLarge: TextStyle(
            fontSize: 15, fontWeight: FontWeight.w800, color: primary, letterSpacing: 0.2),
        labelMedium: TextStyle(
            fontSize: 13, fontWeight: FontWeight.w700, color: secondary, letterSpacing: 0.3),
        labelSmall: TextStyle(
            fontSize: 11, fontWeight: FontWeight.w700, color: secondary, letterSpacing: 0.6),
      ),
    );
  }

  /// Tabular figures keep money, ETA and distance columns from jittering.
  static TextStyle numeric({double fontSize = 16, FontWeight weight = FontWeight.w700, Color? color}) =>
      GoogleFonts.inter(
        fontSize: fontSize,
        fontWeight: weight,
        color: color ?? NabinColor.onSurface,
        fontFeatures: const <FontFeature>[FontFeature.tabularFigures()],
      );
}

/// NABIN wordmark — Neuron Regular only, never for body or UI text.
///
/// Requires `assets/fonts/Neuron-Regular.ttf` registered in `pubspec.yaml`
/// under `family: Neuron`; until that licensed file is bundled Flutter falls
/// back to Inter, so the fallback weight/tracking match the intended look.
class NabinWordmark {
  static const String fontFamily = 'Neuron';

  static TextStyle scale({
    double fontSize = 22,
    Color color = NabinColor.brand,
    FontWeight fallbackWeight = FontWeight.w800,
    double letterSpacing = 1.2,
  }) =>
      TextStyle(
        fontFamily: fontFamily,
        fontFamilyFallback: const <String>['Inter'],
        fontSize: fontSize,
        fontWeight: fallbackWeight,
        letterSpacing: letterSpacing,
        color: color,
      );
}

class NabinTheme {
  /// Picks whichever text colour clears more contrast against [fill].
  ///
  /// Required because the brand orange and grocery green are both too light
  /// for white label text, which would fail WCAG AA on every CTA.
  static Color on(Color fill) {
    final double luminance = fill.computeLuminance();
    final double againstWhite = (luminance + 0.05) / 1.05;
    final double againstInk = (luminance + 0.05) / 0.0585;
    return againstWhite <= againstInk ? NabinColor.onBrand : NabinColor.onSurface;
  }

  /// Single factory that produces every role theme, so the nine interfaces
  /// cannot drift into nine separate visual systems.
  static ThemeData light({NabinRole role = NabinRole.customer, String title = 'NABIN'}) {
    final ColorScheme scheme = ColorScheme.fromSeed(
      seedColor: role.accent,
      brightness: Brightness.light,
    ).copyWith(
      primary: role.accent,
      onPrimary: on(role.accent),
      secondary: NabinColor.groceryGreen,
      onSecondary: on(NabinColor.groceryGreen),
      surface: NabinColor.surface,
      onSurface: NabinColor.onSurface,
      error: NabinColor.dangerDark,
      onError: NabinColor.onBrand,
      outlineVariant: NabinColor.divider,
    );
    return _compose(scheme, NabinColor.canvas, NabinType.textTheme(Brightness.light), role);
  }

  /// High-contrast night ramp for in-vehicle driver screens.
  static ThemeData dark({NabinRole role = NabinRole.driver, String title = 'NABIN'}) {
    final ColorScheme scheme = ColorScheme.fromSeed(
      seedColor: role.accent,
      brightness: Brightness.dark,
    ).copyWith(
      primary: role.accent,
      onPrimary: on(role.accent),
      secondary: NabinColor.success,
      surface: NabinColor.surfaceDarkElevated,
      onSurface: NabinColor.onDarkSurface,
      error: NabinColor.dangerBright,
      outlineVariant: NabinColor.dividerDark,
    );
    return _compose(scheme, NabinColor.canvasDark, NabinType.textTheme(Brightness.dark), role);
  }

  static ThemeData _compose(ColorScheme scheme, Color canvas, TextTheme text, NabinRole role) => ThemeData(
        useMaterial3: true,
        colorScheme: scheme,
        scaffoldBackgroundColor: canvas,
        canvasColor: canvas,
        fontFamily: 'Inter',
        textTheme: text,
        pageTransitionsTheme: NabinMotion.pageTransitions,
        splashFactory: InkSparkle.splashFactory,
        appBarTheme: AppBarTheme(
          backgroundColor: canvas,
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          centerTitle: false,
          titleTextStyle: text.titleLarge,
          iconTheme: IconThemeData(color: scheme.onSurface),
        ),
        cardTheme: CardThemeData(
          color: scheme.surface,
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          margin: EdgeInsets.zero,
          shape: RoundedRectangleBorder(
            side: BorderSide(color: scheme.outlineVariant),
            borderRadius: NabinRadius.card,
          ),
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            minimumSize: NabinTarget.button,
            shape: RoundedRectangleBorder(borderRadius: NabinRadius.control),
            textStyle: text.labelLarge,
          ),
        ),
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: scheme.primary,
            foregroundColor: scheme.onPrimary,
            elevation: 0,
            minimumSize: NabinTarget.button,
            shape: RoundedRectangleBorder(borderRadius: NabinRadius.control),
            textStyle: text.labelLarge,
          ),
        ),
        outlinedButtonTheme: OutlinedButtonThemeData(
          style: OutlinedButton.styleFrom(
            minimumSize: NabinTarget.button,
            side: BorderSide(color: scheme.outlineVariant),
            shape: RoundedRectangleBorder(borderRadius: NabinRadius.control),
            textStyle: text.labelLarge,
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: scheme.surface,
          contentPadding: NabinSpacing.listTile,
          hintStyle: text.bodyMedium,
          border: OutlineInputBorder(
            borderRadius: NabinRadius.control,
            borderSide: BorderSide(color: scheme.outlineVariant),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: NabinRadius.control,
            borderSide: BorderSide(color: scheme.outlineVariant),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: NabinRadius.control,
            borderSide: BorderSide(color: scheme.primary, width: 2),
          ),
          errorBorder: OutlineInputBorder(
            borderRadius: NabinRadius.control,
            borderSide: const BorderSide(color: NabinColor.danger, width: 2),
          ),
        ),
        chipTheme: ChipThemeData(
          backgroundColor: role.tint,
          side: BorderSide.none,
          labelStyle: text.labelMedium?.copyWith(color: scheme.onSurface),
          shape: const StadiumBorder(),
        ),
        bottomNavigationBarTheme: BottomNavigationBarThemeData(
          backgroundColor: scheme.surface,
          selectedItemColor: scheme.primary,
          unselectedItemColor: NabinColor.onSurfaceMuted,
          type: BottomNavigationBarType.fixed,
        ),
        snackBarTheme: SnackBarThemeData(
          behavior: SnackBarBehavior.floating,
          backgroundColor: NabinColor.onSurface,
          contentTextStyle: text.bodyMedium?.copyWith(color: NabinColor.surface),
          shape: RoundedRectangleBorder(borderRadius: NabinRadius.control),
        ),
        navigationBarTheme: NavigationBarThemeData(
          backgroundColor: scheme.surface,
          indicatorColor: role.tint,
          surfaceTintColor: Colors.transparent,
          height: NabinTarget.listRow + NabinSpacing.xs,
        ),
      );
}
