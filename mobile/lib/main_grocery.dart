import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'features/grocery/presentation/screens/grocery_splash_screen.dart';
import 'features/grocery/presentation/theme/grocery_theme.dart';

/// M3 — 10-Minute Standalone Grocery Express Application
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    const ProviderScope(
      child: M3GroceryApp(),
    ),
  );
}

class M3GroceryApp extends StatelessWidget {
  const M3GroceryApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'NABIN — 10 Min Express Grocery',
      debugShowCheckedModeBanner: false,
      theme: GroceryTheme.theme,
      home: const GrocerySplashScreen(),
    );
  }
}
