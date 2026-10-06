import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/network/session_manager.dart';
import '../../../../core/theme/nabin_palette.dart';

/// Customer app splash. It is a routing gate, not a timer: on the first frame it
/// reads the real session state already held by [SessionManager] and sends the
/// user to Home when signed in, or to onboarding/welcome otherwise. No artificial
/// delay, no fabricated auth, no redirect loop ('/welcome' is a different route).
class CustomerSplashScreen extends StatefulWidget {
  const CustomerSplashScreen({super.key});

  @override
  State<CustomerSplashScreen> createState() => _CustomerSplashScreenState();
}

class _CustomerSplashScreenState extends State<CustomerSplashScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _route());
  }

  void _route() {
    if (!mounted) return;
    final next = SessionManager.instance.isAuthenticated ? '/home' : '/';
    context.go(next);
  }

  @override
  Widget build(BuildContext context) {
    final p = NabinPalette.of(context);
    return Scaffold(
      backgroundColor: p.canvas,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 88,
              height: 88,
              decoration: BoxDecoration(
                color: p.brand,
                borderRadius: BorderRadius.circular(22),
              ),
              child: Icon(Icons.bolt_rounded, color: p.onBrand, size: 48),
            ),
            const SizedBox(height: 20),
            Text(
              'NABIN',
              style: TextStyle(
                color: p.brand,
                fontSize: 30,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.5,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Ride  •  Food  •  Grocery  •  Parcel',
              style: TextStyle(color: p.onSurfaceMuted, fontSize: 14),
            ),
            const SizedBox(height: 28),
            SizedBox(
              width: 120,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(999),
                child: LinearProgressIndicator(
                  minHeight: 4,
                  backgroundColor: p.brandTint,
                  valueColor: AlwaysStoppedAnimation<Color>(p.brand),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
