import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    const ProviderScope(
      child: NabinCustomerApp(),
    ),
  );
}

class NabinCustomerApp extends StatelessWidget {
  const NabinCustomerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'NABIN Customer App',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.customerTheme,
      routerConfig: appRouter,
    );
  }
}
