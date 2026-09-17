import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/router/grocery_merchant_router.dart';
import 'features/grocery/presentation/theme/grocery_theme.dart';

/// NABIN Grocery Merchant App — Partner console for independent grocery merchants
/// Manages incoming grocery orders, catalog/stock, and merchant dashboard.
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    const ProviderScope(
      child: NabinGroceryMerchantApp(),
    ),
  );
}

class NabinGroceryMerchantApp extends StatelessWidget {
  const NabinGroceryMerchantApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'NABIN Grocery — Merchant',
      debugShowCheckedModeBanner: false,
      theme: GroceryTheme.theme,
      routerConfig: groceryMerchantRouter,
    );
  }
}
