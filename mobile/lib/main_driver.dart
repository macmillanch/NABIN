import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/config/nabin_config_controller.dart';
import 'core/config/nabin_config_lifecycle.dart';
import 'core/router/driver_router.dart';
import 'core/theme/app_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    const ProviderScope(
      child: NabinConfigLifecycle(child: NabinDriverApp()),
    ),
  );
}

class NabinDriverApp extends ConsumerWidget {
  const NabinDriverApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'NABIN Driver Partner',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.driverTheme(palette: nabinPaletteOf(ref)),
      routerConfig: driverRouter,
    );
  }
}
