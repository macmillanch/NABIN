import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/config/nabin_config_controller.dart';
import 'core/config/nabin_config_lifecycle.dart';
import 'core/router/admin_router.dart';
import 'features/admin/presentation/theme/admin_theme.dart';

/// NABIN Admin App — Unified Control Center
/// Manages the entire platform: Ride, Food, Grocery, Parcel.
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    const ProviderScope(
      child: NabinConfigLifecycle(child: NabinAdminApp()),
    ),
  );
}

class NabinAdminApp extends ConsumerWidget {
  const NabinAdminApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'NABIN Admin',
      debugShowCheckedModeBanner: false,
      theme: AdminTheme.theme(palette: nabinPaletteOf(ref)),
      routerConfig: adminRouter,
    );
  }
}
