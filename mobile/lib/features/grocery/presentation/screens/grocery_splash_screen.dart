import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/grocery_auth_provider.dart';
import '../theme/grocery_theme.dart';
import 'grocery_app_shell.dart';
import 'grocery_login_screen.dart';

/// Kinetic Splash Screen for NABIN 10-Minute Express Grocery Application
class GrocerySplashScreen extends ConsumerStatefulWidget {
  const GrocerySplashScreen({super.key});

  @override
  ConsumerState<GrocerySplashScreen> createState() => _GrocerySplashScreenState();
}

class _GrocerySplashScreenState extends ConsumerState<GrocerySplashScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _animController;
  late Animation<double> _scaleAnimation;
  late Animation<double> _fadeAnimation;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    );

    _scaleAnimation = CurvedAnimation(
      parent: _animController,
      curve: Curves.elasticOut,
    );

    _fadeAnimation = CurvedAnimation(
      parent: _animController,
      curve: Curves.easeIn,
    );

    _animController.forward();

    // Auto-navigate after 2.5s
    Timer(const Duration(milliseconds: 2400), _handleNavigation);
  }

  void _handleNavigation() {
    if (!mounted) return;
    final authState = ref.read(groceryAuthProvider);

    Widget targetScreen;
    if (authState.isAuthenticated || authState.isGuest) {
      targetScreen = const GroceryAppShell();
    } else {
      targetScreen = const GroceryLoginScreen();
    }

    Navigator.of(context).pushReplacement(
      PageRouteBuilder(
        transitionDuration: const Duration(milliseconds: 600),
        pageBuilder: (_, animation, __) => FadeTransition(
          opacity: animation,
          child: targetScreen,
        ),
      ),
    );
  }

  @override
  void dispose() {
    _animController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: GroceryTheme.primaryGreenDark,
      body: Stack(
        children: [
          // Background Gradient Overlay
          Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Color(0xFF064E3B), // Deep Forest
                  GroceryTheme.primaryGreenDark,
                  Color(0xFF022C22),
                ],
              ),
            ),
          ),

          // Central Animated Branding
          Center(
            child: FadeTransition(
              opacity: _fadeAnimation,
              child: ScaleTransition(
                scale: _scaleAnimation,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Brand Icon Badge
                    Container(
                      padding: const EdgeInsets.all(22),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.25),
                            blurRadius: 30,
                            offset: const Offset(0, 10),
                          ),
                        ],
                      ),
                      child: const Icon(
                        Icons.shopping_basket_rounded,
                        size: 56,
                        color: GroceryTheme.primaryGreenDark,
                      ),
                    ),
                    const SizedBox(height: 24),

                    // App Title
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Text(
                          'NABIN',
                          style: TextStyle(
                            fontSize: 34,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -1.0,
                            color: Colors.white,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: GroceryTheme.primaryGreen,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: const Text(
                            'GROCERY',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w900,
                              color: Colors.white,
                              letterSpacing: 1.2,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),

                    // 10-Min Badge Pill
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      decoration: BoxDecoration(
                        color: GroceryTheme.accentAmber.withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: GroceryTheme.accentAmber,
                          width: 1.5,
                        ),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.bolt_rounded,
                            size: 18,
                            color: GroceryTheme.accentAmber,
                          ),
                          SizedBox(width: 6),
                          Text(
                            '10-MIN EXPRESS SUPERMARKET',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w800,
                              color: GroceryTheme.accentAmber,
                              letterSpacing: 0.8,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),

          // Bottom Loading Indicator & Version
          Positioned(
            left: 0,
            right: 0,
            bottom: 48,
            child: Column(
              children: [
                const SizedBox(
                  width: 28,
                  height: 28,
                  child: CircularProgressIndicator(
                    strokeWidth: 3,
                    valueColor: AlwaysStoppedAnimation<Color>(GroceryTheme.primaryGreen),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'Powered by NABIN Core Unified Platform v1.0',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: Colors.white.withValues(alpha: 0.6),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
