import 'package:flutter/material.dart';

import '../config/nabin_app_config.dart';
import 'nabin_tokens.dart';

/// Where the colours a screen is painting came from.
enum NabinPaletteSource {
  /// Built into this build; changes only with a release.
  local,

  /// Published by the server, so no release was needed to get here.
  remote,
}

/// The NABIN colour ramp as runtime data.
///
/// [NabinColor] stays as the compile-time default ramp, but a widget that wants
/// to follow a published theme resolves through this extension instead: a
/// `const Color` is baked into the APK at compile time, so it is the one thing
/// a server can never change.
@immutable
class NabinPalette extends ThemeExtension<NabinPalette> {
  const NabinPalette({
    required this.source,
    this.brand = NabinColor.brand,
    this.brandTint = NabinColor.brandTint,
    this.onBrand = NabinColor.onBrand,
    this.canvas = NabinColor.canvas,
    this.surface = NabinColor.surface,
    this.surfaceMuted = NabinColor.surfaceMuted,
    this.surfaceEmphasized = NabinColor.surfaceEmphasized,
    this.onSurface = NabinColor.onSurface,
    this.onSurfaceMuted = NabinColor.onSurfaceMuted,
    this.divider = NabinColor.divider,
    this.success = NabinColor.success,
    this.warning = NabinColor.warning,
    this.danger = NabinColor.danger,
    this.foodAccent = NabinColor.foodOrange,
    this.groceryAccent = NabinColor.groceryGreen,
    this.publishedTokens = const <String>[],
  });

  final NabinPaletteSource source;

  /// Token names the server published and this palette accepted. A screen shows
  /// these when it says "this theme came from NABIN's servers".
  final List<String> publishedTokens;

  final Color brand;
  final Color brandTint;
  final Color onBrand;
  final Color canvas;
  final Color surface;
  final Color surfaceMuted;
  final Color surfaceEmphasized;
  final Color onSurface;
  final Color onSurfaceMuted;
  final Color divider;
  final Color success;
  final Color warning;
  final Color danger;
  final Color foodAccent;
  final Color groceryAccent;

  bool get isRemote => source == NabinPaletteSource.remote;

  /// The accent a role's surfaces paint with. A role is matched by the accent it
  /// was declared with, so the mapping needs no parallel list of role names that
  /// could drift. Driver and admin keep their compile-time accents: the
  /// published vocabulary covers the customer-facing surfaces, and claiming
  /// otherwise would overstate what is actually remote.
  Color accentFor(NabinRole role) {
    if (role.accent == NabinColor.brand) return brand;
    if (role.accent == NabinColor.foodOrange) return foodAccent;
    if (role.accent == NabinColor.groceryGreen) return groceryAccent;
    return role.accent;
  }

  Color tintFor(NabinRole role) {
    if (role.tint == NabinColor.brandTint) return brandTint;
    return role.tint;
  }

  /// Looks a token up by its published name, so a widget can ask for exactly the
  /// key an operator edited in the admin console.
  Color? token(String name) {
    switch (name) {
      case 'brand':
        return brand;
      case 'brandTint':
        return brandTint;
      case 'onBrand':
        return onBrand;
      case 'canvas':
        return canvas;
      case 'surface':
        return surface;
      case 'surfaceMuted':
        return surfaceMuted;
      case 'surfaceEmphasized':
        return surfaceEmphasized;
      case 'onSurface':
        return onSurface;
      case 'onSurfaceMuted':
        return onSurfaceMuted;
      case 'divider':
        return divider;
      case 'success':
        return success;
      case 'warning':
        return warning;
      case 'danger':
        return danger;
      case 'foodAccent':
        return foodAccent;
      case 'groceryAccent':
        return groceryAccent;
      default:
        return null;
    }
  }

  static NabinPalette defaults() => const NabinPalette(source: NabinPaletteSource.local);

  /// This ramp with every published token applied. Tokens the server did not
  /// send keep their built-in value, so a partial publication is a partial
  /// change rather than a half-painted screen.
  NabinPalette withRemote(Map<String, Color> published) {
    if (published.isEmpty) return this;
    final applied = <String, Color>{
      for (final entry in published.entries)
        // A token the published vocabulary does not define, or a value that
        // matches the built-in ramp anyway, changes nothing.
        if (token(entry.key) != null && entry.value != token(entry.key)) entry.key: entry.value,
    };
    if (applied.isEmpty) return this;
    Color pick(String name, Color current) => applied[name] ?? current;
    return NabinPalette(
      source: NabinPaletteSource.remote,
      publishedTokens: List<String>.unmodifiable(
        (<String>{...publishedTokens, ...applied.keys}).toList()..sort(),
      ),
      brand: pick('brand', brand),
      brandTint: pick('brandTint', brandTint),
      onBrand: pick('onBrand', onBrand),
      canvas: pick('canvas', canvas),
      surface: pick('surface', surface),
      surfaceMuted: pick('surfaceMuted', surfaceMuted),
      surfaceEmphasized: pick('surfaceEmphasized', surfaceEmphasized),
      onSurface: pick('onSurface', onSurface),
      onSurfaceMuted: pick('onSurfaceMuted', onSurfaceMuted),
      divider: pick('divider', divider),
      success: pick('success', success),
      warning: pick('warning', warning),
      danger: pick('danger', danger),
      foodAccent: pick('foodAccent', foodAccent),
      groceryAccent: pick('groceryAccent', groceryAccent),
    );
  }

  /// The palette a widget should paint with, falling back to the built-in ramp
  /// when no theme is installed (widget tests, and the frame before the first
  /// configuration answer arrives).
  static NabinPalette of(BuildContext context) {
    final fromTheme = Theme.of(context).extension<NabinPalette>();
    return fromTheme ?? defaults();
  }

  /// Convenience for the config → palette step every role app performs at
  /// startup.
  static NabinPalette from(NabinAppConfig? config) {
    if (config == null || !config.hasRemoteTheme) return defaults();
    return defaults().withRemote(config.theme);
  }

  @override
  NabinPalette copyWith({
    NabinPaletteSource? source,
    Color? brand,
    Color? brandTint,
    Color? onBrand,
    Color? canvas,
    Color? surface,
    Color? surfaceMuted,
    Color? surfaceEmphasized,
    Color? onSurface,
    Color? onSurfaceMuted,
    Color? divider,
    Color? success,
    Color? warning,
    Color? danger,
    Color? foodAccent,
    Color? groceryAccent,
    List<String>? publishedTokens,
  }) =>
      NabinPalette(
        source: source ?? this.source,
        brand: brand ?? this.brand,
        brandTint: brandTint ?? this.brandTint,
        onBrand: onBrand ?? this.onBrand,
        canvas: canvas ?? this.canvas,
        surface: surface ?? this.surface,
        surfaceMuted: surfaceMuted ?? this.surfaceMuted,
        surfaceEmphasized: surfaceEmphasized ?? this.surfaceEmphasized,
        onSurface: onSurface ?? this.onSurface,
        onSurfaceMuted: onSurfaceMuted ?? this.onSurfaceMuted,
        divider: divider ?? this.divider,
        success: success ?? this.success,
        warning: warning ?? this.warning,
        danger: danger ?? this.danger,
        foodAccent: foodAccent ?? this.foodAccent,
        groceryAccent: groceryAccent ?? this.groceryAccent,
        publishedTokens: publishedTokens ?? this.publishedTokens,
      );

  @override
  NabinPalette lerp(ThemeExtension<NabinPalette>? other, double t) {
    if (other is! NabinPalette) return this;
    Color mix(Color a, Color b) => Color.lerp(a, b, t)!;
    return NabinPalette(
      source: t < 0.5 ? source : other.source,
      publishedTokens: t < 0.5 ? publishedTokens : other.publishedTokens,
      brand: mix(brand, other.brand),
      brandTint: mix(brandTint, other.brandTint),
      onBrand: mix(onBrand, other.onBrand),
      canvas: mix(canvas, other.canvas),
      surface: mix(surface, other.surface),
      surfaceMuted: mix(surfaceMuted, other.surfaceMuted),
      surfaceEmphasized: mix(surfaceEmphasized, other.surfaceEmphasized),
      onSurface: mix(onSurface, other.onSurface),
      onSurfaceMuted: mix(onSurfaceMuted, other.onSurfaceMuted),
      divider: mix(divider, other.divider),
      success: mix(success, other.success),
      warning: mix(warning, other.warning),
      danger: mix(danger, other.danger),
      foodAccent: mix(foodAccent, other.foodAccent),
      groceryAccent: mix(groceryAccent, other.groceryAccent),
    );
  }
}
