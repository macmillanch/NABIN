import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/theme/app_theme.dart';
import 'features/driver/presentation/screens/driver_app_shell.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    const ProviderScope(
      child: NabinDriverApp(),
    ),
  );
}

class NabinDriverApp extends StatelessWidget {
  const NabinDriverApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'NABIN Driver Partner',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.driverTheme,
      home: const DriverAppShell(),
    );
  }
}
