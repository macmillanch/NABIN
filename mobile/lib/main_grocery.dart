import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/config/nabin_config_controller.dart';
import 'core/config/nabin_config_lifecycle.dart';
import 'features/grocery/presentation/screens/grocery_splash_screen.dart';
import 'features/grocery/presentation/theme/grocery_theme.dart';

/// M3 — 10-Minute Standalone Grocery Express Application
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    const ProviderScope(
      child: NabinConfigLifecycle(child: M3GroceryApp()),
    ),
  );
}

class M3GroceryApp extends ConsumerWidget {
  const M3GroceryApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp(
      title: 'NABIN — 10 Min Express Grocery',
      debugShowCheckedModeBanner: false,
      theme: GroceryTheme.theme(palette: nabinPaletteOf(ref)),
      home: const GrocerySplashScreen(),
    );
  }
}
