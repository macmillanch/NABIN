import 'package:flutter/material.dart';
import '../../../../core/theme/nabin_tokens.dart';

/// NABIN Admin App theme — deep navy control centre on neutral surfaces.
class AdminTheme {
  static const Color primaryBlue = NabinColor.adminAccent;
  static const Color accentBlue = Color(0xFF3B82F6);
  static const Color primaryGreen = NabinColor.success;
  static const Color accentRose = NabinColor.dangerBright;
  static const Color accentAmber = NabinColor.warning;

  static const Color bgOffWhite = NabinColor.canvas;
  static const Color surfaceWhite = NabinColor.surface;
  static const Color textDark = NabinColor.onSurface;
  static const Color textMuted = NabinColor.onSurfaceMuted;
  static const Color borderLight = NabinColor.divider;

  static ThemeData get theme => NabinTheme.light(role: NabinRole.admin);
}
