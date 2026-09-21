import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'nabin_app_config.dart';
import 'nabin_config_repository.dart';
import '../theme/nabin_palette.dart';

/// Holds the configuration the app is currently painting from, and refreshes it.
///
/// A failed refresh keeps the previous value on purpose: an operator pushing a
/// bad theme must not be able to blank a customer's screen, so the last good
/// answer stays in place and the failure is reported separately as [lastError].
class NabinConfigController extends StateNotifier<NabinAppConfig> {
  NabinConfigController(this._repository) : super(NabinAppConfig.bundled()) {
    refresh();
  }

  final NabinConfigRepository _repository;

  Object? lastError;

  Future<void> refresh() async {
    try {
      final config = await _repository.load(refresh: true);
      if (!mounted) return;
      state = config;
      lastError = null;
    } catch (error) {
      if (!mounted) return;
      lastError = error;
    }
  }
}

/// Overridable so a widget test can drive the app from a published theme
/// without a backend.
final nabinConfigRepositoryProvider = Provider<NabinConfigRepository>(
  (ref) => NabinConfigRepository(),
);

final nabinConfigProvider = StateNotifierProvider<NabinConfigController, NabinAppConfig>(
  (ref) => NabinConfigController(ref.watch(nabinConfigRepositoryProvider)),
);

/// The colour ramp the app should paint with right now.
///
/// Every role entrypoint resolves its theme through here, so a published theme
/// reaching this line changes the whole app: the bundled ramp paints until the
/// first configuration answer arrives, and a failed refresh leaves whatever was
/// painting before still on screen rather than falling back to defaults.
NabinPalette nabinPaletteOf(WidgetRef ref) =>
    NabinPalette.from(ref.watch(nabinConfigProvider));
