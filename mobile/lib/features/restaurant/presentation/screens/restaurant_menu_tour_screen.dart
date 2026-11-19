import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/restaurant_theme.dart';

class RestaurantMenuTourScreen extends StatefulWidget {
  const RestaurantMenuTourScreen({super.key});

  @override
  State<RestaurantMenuTourScreen> createState() => _RestaurantMenuTourScreenState();
}

class _RestaurantMenuTourScreenState extends State<RestaurantMenuTourScreen> {
  int _currentStep = 0;

  final List<Map<String, dynamic>> _tourSteps = [
    {
      'step': 1,
      'badge': 'High-Tempo Live Order Stream',
      'title': 'Never Miss an Order with Chime Audio Alerts',
      'subtitle': 'Incoming customer tickets trigger persistent chime notifications, allowing you to accept prep targets or 86 out-of-stock items instantly.',
      'icon': Icons.notifications_active,
      'highlight': '180s Accept Window • Auto-rejection safety protection',
    },
    {
      'step': 2,
      'badge': 'Kitchen Display System (KDS)',
      'title': 'Color-Coded Station Routing for Cook Staff',
      'subtitle': 'Route grill items, curries, and beverages to dedicated kitchen tablets. Bump orders from New to Cooking to Ready with one tap.',
      'icon': Icons.kitchen,
      'highlight': 'FIFO Queue • Auto-calculated cook timers',
    },
    {
      'step': 3,
      'badge': 'Dynamic Menu Control',
      'title': 'Instant 86-ing & Meal-Shift Scheduling',
      'subtitle': 'Run out of paneer? Freeze all dependent dishes with one tap. Schedule automated breakfast, lunch, and dinner daypart transitions.',
      'icon': Icons.restaurant_menu,
      'highlight': 'Real-time sync to Customer Super-App • 0 wasted prep',
    },
    {
      'step': 4,
      'badge': 'Automated Daily Payouts',
      'title': 'Daily T+1 Direct Bank Clearing',
      'subtitle': 'Nightly sales clear into your verified commercial bank account before 10:00 AM. Zero merchant transaction fees on settlement.',
      'icon': Icons.account_balance,
      'highlight': 'Automated reconciliation • GSTR-1 ready sales reports',
    },
  ];

  @override
  Widget build(BuildContext context) {
    final step = _tourSteps[_currentStep];

    return Scaffold(
      backgroundColor: RestaurantTheme.bgSurface,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/dashboard'),
        ),
        title: const Row(
          children: [
            Icon(Icons.restaurant, color: RestaurantTheme.primaryBlue, size: 22),
            SizedBox(width: 8),
            Text('NABIN', style: TextStyle(fontWeight: FontWeight.w900, color: RestaurantTheme.primaryBlue, letterSpacing: -0.5)),
            SizedBox(width: 6),
            Text('RMS Tour (RM-009)', style: TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText, fontWeight: FontWeight.bold)),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => context.go('/dashboard'),
            child: const Text('Skip Tour', style: TextStyle(color: RestaurantTheme.secondaryText, fontWeight: FontWeight.bold)),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Progress meter
              Row(
                children: List.generate(_tourSteps.length, (idx) {
                  final isDone = idx <= _currentStep;
                  return Expanded(
                    child: Container(
                      margin: const EdgeInsets.symmetric(horizontal: 3),
                      height: 4,
                      decoration: BoxDecoration(
                        color: isDone ? RestaurantTheme.primaryBlue : RestaurantTheme.border,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  );
                }),
              ),
              const SizedBox(height: 24),

              Expanded(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: RestaurantTheme.neonOrange.withAlpha(25),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(step['badge'] as String, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: RestaurantTheme.neonOrange)),
                      ),
                      const SizedBox(height: 16),
                      Text(
                        step['title'] as String,
                        style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal, letterSpacing: -0.5),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        step['subtitle'] as String,
                        style: const TextStyle(fontSize: 14, color: RestaurantTheme.secondaryText, height: 1.45),
                      ),
                      const SizedBox(height: 24),

                      // Feature Hero Card
                      Container(
                        padding: const EdgeInsets.all(24),
                        decoration: BoxDecoration(
                          color: RestaurantTheme.white,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: RestaurantTheme.border),
                          boxShadow: const [
                            BoxShadow(color: Color(0x08000000), blurRadius: 16, offset: Offset(0, 6)),
                          ],
                        ),
                        child: Column(
                          children: [
                            Container(
                              width: 64,
                              height: 64,
                              decoration: BoxDecoration(
                                color: RestaurantTheme.primaryBlue.withAlpha(20),
                                shape: BoxShape.circle,
                              ),
                              child: Icon(step['icon'] as IconData, size: 32, color: RestaurantTheme.primaryBlue),
                            ),
                            const SizedBox(height: 16),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                              decoration: BoxDecoration(
                                color: RestaurantTheme.statusReadyBg,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text(
                                step['highlight'] as String,
                                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: RestaurantTheme.statusReadyGreen),
                                textAlign: TextAlign.center,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              // Bottom Actions
              Row(
                children: [
                  if (_currentStep > 0)
                    Expanded(
                      child: OutlinedButton(
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        onPressed: () => setState(() => _currentStep--),
                        child: const Text('Previous'),
                      ),
                    ),
                  if (_currentStep > 0) const SizedBox(width: 12),
                  Expanded(
                    flex: 2,
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: RestaurantTheme.primaryBlue,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      onPressed: () {
                        if (_currentStep < _tourSteps.length - 1) {
                          setState(() => _currentStep++);
                        } else {
                          context.go('/dashboard');
                        }
                      },
                      child: Text(
                        _currentStep < _tourSteps.length - 1 ? 'Next Feature' : 'Enter RMS Dashboard',
                        style: const TextStyle(fontWeight: FontWeight.bold),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
            ],
          ),
        ),
      ),
    );
  }
}
