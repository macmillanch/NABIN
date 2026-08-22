import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    const ProviderScope(
      child: NabinCustomerSuperApp(),
    ),
  );
}

/// NABIN Customer Super-App
/// 1:1 Google Stitch Kinetic Reliability Design Paradigm
/// Deep Navy (#1A237E), Electric Orange (#FF6D00), Electric Cyan (#00E5FF)
class NabinCustomerSuperApp extends StatelessWidget {
  const NabinCustomerSuperApp({super.key});

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
