import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/router/admin_router.dart';
import 'features/admin/presentation/theme/admin_theme.dart';

/// NABIN Admin App — Unified Control Center
/// Manages the entire platform: Ride, Food, Grocery, Parcel.
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    const ProviderScope(
      child: NabinAdminApp(),
    ),
  );
}

class NabinAdminApp extends StatelessWidget {
  const NabinAdminApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'NABIN Admin',
      debugShowCheckedModeBanner: false,
      theme: AdminTheme.theme,
      routerConfig: adminRouter,
    );
  }
}
