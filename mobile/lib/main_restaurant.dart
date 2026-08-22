import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/router/restaurant_router.dart';
import 'core/theme/restaurant_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    const ProviderScope(
      child: NabinRestaurantApp(),
    ),
  );
}

/// ONE Complete Mobile App called NABIN Restaurant.
/// Exclusively for restaurant partners managing Kitchen Display System (KDS),
/// Menu catalog, Stock toggles, and Financial Settlements without duplicate screens.
class NabinRestaurantApp extends StatelessWidget {
  const NabinRestaurantApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'NABIN Restaurant',
      debugShowCheckedModeBanner: false,
      theme: RestaurantTheme.lightTheme,
      routerConfig: restaurantRouter,
    );
  }
}
