import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';

import '../../../../core/network/session_manager.dart';

class WelcomeScreen extends StatefulWidget {
  const WelcomeScreen({super.key});

  @override
  State<WelcomeScreen> createState() => _WelcomeScreenState();
}

class _WelcomeScreenState extends State<WelcomeScreen> {
  final PageController _pageController = PageController();
  int _currentPage = 0;

  @override
  void initState() {
    super.initState();
    _checkExistingSession();
  }

  Future<void> _checkExistingSession() async {
    final hasValidSession = await SessionManager.instance.validateExistingSession();
    if (hasValidSession && mounted) {
      context.go('/home');
    }
  }

  final List<Map<String, dynamic>> _slides = const [
    {
      'title': 'Fast, Reliable Rides',
      'tag': '2W BIKE • 3W AUTO • 4W CAB',
      'desc': 'Get a ride at your doorstep in minutes with transparent upfront fares, live GPS telemetry, and zero surge pricing.',
      'icon': Icons.electric_rickshaw,
      'gradient': [Color(0xFF0052CC), Color(0xFF003D9B)],
    },
    {
      'title': 'Food Delivered Hot',
      'tag': 'TOP RESTAURANTS • CLOUD KITCHENS',
      'desc': 'Order your favorite meals from verified top kitchens with express live delivery tracking and sealed packaging.',
      'icon': Icons.restaurant_rounded,
      'gradient': [Color(0xFFFF6D00), Color(0xFFA33500)],
    },
    {
      'title': 'Dual-OTP Secure Parcel',
      'tag': 'SAME-DAY • ZERO LOSS GUARANTEE',
      'desc': 'Send packages, documents, and gifts across town with military-grade Dual-OTP security for both sender and receiver.',
      'icon': Icons.inventory_2_rounded,
      'gradient': [Color(0xFF00897B), Color(0xFF004D40)],
    },
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      body: SafeArea(
        child: Column(
          children: [
            // Top Bar with Brand Badge & Skip
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [AppTheme.primary, AppTheme.primaryContainer],
                          ),
                          borderRadius: BorderRadius.circular(12),
                          boxShadow: [
                            BoxShadow(
                              color: AppTheme.primary.withValues(alpha: 0.25),
                              blurRadius: 8,
                              offset: const Offset(0, 3),
                            ),
                          ],
                        ),
                        child: const Row(
                          children: [
                            Icon(Icons.bolt, color: Colors.white, size: 16),
                            SizedBox(width: 4),
                            Text('NABIN', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 13, letterSpacing: 1.2)),
                          ],
                        ),
                      ),
                    ],
                  ),
                  TextButton(
                    onPressed: () => context.push('/phone-entry'),
                    style: TextButton.styleFrom(
                      foregroundColor: AppTheme.primary,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    child: const Text('Skip', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                  ),
                ],
              ),
            ),

            // Carousel Slides
            Expanded(
              child: PageView.builder(
                controller: _pageController,
                onPageChanged: (idx) => setState(() => _currentPage = idx),
                itemCount: _slides.length,
                itemBuilder: (context, index) {
                  final slide = _slides[index];
                  final gradient = slide['gradient'] as List<Color>;
                  return SingleChildScrollView(
                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const SizedBox(height: 12),
                        Container(
                          width: 120,
                          height: 120,
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              colors: gradient,
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                            ),
                            shape: BoxShape.circle,
                            boxShadow: [
                              BoxShadow(
                                color: gradient.first.withValues(alpha: 0.35),
                                blurRadius: 24,
                                offset: const Offset(0, 8),
                              ),
                            ],
                          ),
                          child: Icon(slide['icon'] as IconData, size: 60, color: Colors.white),
                        ),
                        const SizedBox(height: 24),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: AppTheme.surfaceContainerHigh,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            slide['tag'] as String,
                            style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: AppTheme.primary, letterSpacing: 0.8),
                          ),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          slide['title'] as String,
                          style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w900, color: AppTheme.onSurface, letterSpacing: -0.5),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 10),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          child: Text(
                            slide['desc'] as String,
                            style: const TextStyle(fontSize: 13, color: AppTheme.onSurfaceVariant, height: 1.45),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),

            // Bottom Indicators & Get Started Action
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
              child: Column(
                children: [
                  // Smooth Pill Indicator
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(_slides.length, (idx) {
                      final isActive = idx == _currentPage;
                      return AnimatedContainer(
                        duration: const Duration(milliseconds: 300),
                        curve: Curves.easeOutCubic,
                        margin: const EdgeInsets.symmetric(horizontal: 4),
                        width: isActive ? 28 : 8,
                        height: 8,
                        decoration: BoxDecoration(
                          gradient: isActive
                              ? const LinearGradient(colors: [AppTheme.primary, AppTheme.primaryContainer])
                              : null,
                          color: isActive ? null : AppTheme.surfaceContainerHighest,
                          borderRadius: BorderRadius.circular(4),
                        ),
                      );
                    }),
                  ),
                  const SizedBox(height: 28),

                  ElevatedButton(
                    onPressed: () => context.push('/phone-entry'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.primaryContainer,
                      foregroundColor: Colors.white,
                      minimumSize: const Size(double.infinity, 56),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                      elevation: 3,
                      shadowColor: AppTheme.primary.withValues(alpha: 0.4),
                    ),
                    child: const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text('Get Started', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, letterSpacing: 0.3)),
                        SizedBox(width: 8),
                        Icon(Icons.arrow_forward, size: 20),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  const Text(
                    'By continuing you agree to NABIN Terms of Service & Privacy Policy',
                    style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 11),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
