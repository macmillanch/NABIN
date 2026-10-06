import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/nabin_palette.dart';
import '../../../../core/theme/nabin_tokens.dart';

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

  // Each slide borrows its service's own accent (Ride/Food/Parcel) rather than a
  // bespoke gradient: the onboarding must read as the same white-dominant app the
  // customer lands in, with #1A3BA2 as the only brand voice and service colour
  // kept to the ~20% accent role.
  final List<Map<String, dynamic>> _slides = const [
    {
      'title': 'Fast, Reliable Rides',
      'tag': '2W BIKE • 3W AUTO • 4W CAB',
      'desc': 'Get a ride at your doorstep in minutes with transparent upfront fares, live GPS telemetry, and zero surge pricing.',
      'icon': Icons.electric_rickshaw,
      'accent': 'ride',
    },
    {
      'title': 'Food Delivered Hot',
      'tag': 'TOP RESTAURANTS • CLOUD KITCHENS',
      'desc': 'Order your favorite meals from verified top kitchens with express live delivery tracking and sealed packaging.',
      'icon': Icons.restaurant_rounded,
      'accent': 'food',
    },
    {
      'title': 'Dual-OTP Secure Parcel',
      'tag': 'SAME-DAY • ZERO LOSS GUARANTEE',
      'desc': 'Send packages, documents, and gifts across town with Dual-OTP security for both sender and receiver.',
      'icon': Icons.inventory_2_rounded,
      'accent': 'parcel',
    },
  ];

  Color _accentFor(NabinPalette p, String key) {
    switch (key) {
      case 'food':
        return p.foodAccent;
      case 'grocery':
        return p.groceryAccent;
      case 'parcel':
        return p.parcelAccent;
      default:
        return p.rideAccent;
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = NabinPalette.of(context);
    return Scaffold(
      backgroundColor: palette.canvas,
      body: SafeArea(
        child: Column(
          children: [
            // Top Bar with Brand Badge & Skip
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                    decoration: BoxDecoration(
                      color: palette.brand,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.bolt, color: palette.onBrand, size: 16),
                        const SizedBox(width: 4),
                        Text('NABIN', style: TextStyle(color: palette.onBrand, fontWeight: FontWeight.w900, fontSize: 13, letterSpacing: 1.2)),
                      ],
                    ),
                  ),
                  TextButton(
                    onPressed: () => context.push('/phone-entry'),
                    style: TextButton.styleFrom(
                      foregroundColor: palette.brand,
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
                  final accent = _accentFor(palette, slide['accent'] as String);
                  return SingleChildScrollView(
                    padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 8),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        // A white card carries the slide so the page stays neutral;
                        // the icon sits in a soft accent-tinted badge, not a loud
                        // full-colour circle.
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 34),
                          decoration: BoxDecoration(
                            color: palette.surface,
                            borderRadius: BorderRadius.circular(22),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.05),
                                blurRadius: 20,
                                offset: const Offset(0, 8),
                              ),
                            ],
                          ),
                          child: Column(
                            children: [
                              Container(
                                width: 108,
                                height: 108,
                                decoration: BoxDecoration(
                                  color: accent.withValues(alpha: 0.12),
                                  shape: BoxShape.circle,
                                ),
                                child: Icon(slide['icon'] as IconData, size: 52, color: accent),
                              ),
                              const SizedBox(height: 22),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(
                                  color: accent.withValues(alpha: 0.1),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text(
                                  slide['tag'] as String,
                                  style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: accent, letterSpacing: 0.8),
                                ),
                              ),
                              const SizedBox(height: 12),
                              Text(
                                slide['title'] as String,
                                style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: palette.onSurface, letterSpacing: -0.5),
                                textAlign: TextAlign.center,
                              ),
                              const SizedBox(height: 10),
                              Text(
                                slide['desc'] as String,
                                style: TextStyle(fontSize: 13.5, color: palette.onSurfaceMuted, height: 1.45),
                                textAlign: TextAlign.center,
                              ),
                            ],
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
                          color: isActive ? palette.brand : palette.surfaceMuted,
                          borderRadius: BorderRadius.circular(4),
                        ),
                      );
                    }),
                  ),
                  const SizedBox(height: 24),

                  ElevatedButton(
                    onPressed: () => context.push('/phone-entry'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: palette.brand,
                      foregroundColor: NabinTheme.on(palette.brand, palette),
                      minimumSize: const Size(double.infinity, 56),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                      elevation: 0,
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Text('Get Started', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, letterSpacing: 0.3)),
                        const SizedBox(width: 8),
                        Icon(Icons.arrow_forward, size: 20, color: NabinTheme.on(palette.brand, palette)),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    'By continuing you agree to NABIN Terms of Service & Privacy Policy',
                    style: TextStyle(color: palette.onSurfaceMuted, fontSize: 11),
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
