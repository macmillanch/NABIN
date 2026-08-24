import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/models/school_child_repository.dart';

class CustomerHomeScreen extends StatefulWidget {
  const CustomerHomeScreen({super.key});

  @override
  State<CustomerHomeScreen> createState() => _CustomerHomeScreenState();
}

class _CustomerHomeScreenState extends State<CustomerHomeScreen> {
  int _navIndex = 0;
  String _currentLocation = 'Civil Lines, Delhi';

  @override
  Widget build(BuildContext context) {
    final repo = SchoolChildRepository.instance;
    final primaryChild = repo.children.isNotEmpty ? repo.children.first : null;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        scrolledUnderElevation: 1,
        leadingWidth: 160,
        leading: Padding(
          padding: const EdgeInsets.only(left: 16),
          child: InkWell(
            onTap: _showLocationPicker,
            borderRadius: BorderRadius.circular(20),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: const Color(0xFF3C4890).withValues(alpha: 0.1),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.location_on_rounded, color: Color(0xFF3C4890), size: 18),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('LOCATION', style: TextStyle(fontSize: 8.5, fontWeight: FontWeight.w900, color: Color(0xFF3C4890), letterSpacing: 0.5)),
                      Text(
                        _currentLocation,
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.onSurface),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.keyboard_arrow_down_rounded, size: 16, color: Colors.grey),
              ],
            ),
          ),
        ),
        title: const Text(
          'NABIN',
          style: TextStyle(
            fontWeight: FontWeight.w900,
            fontSize: 20,
            color: Color(0xFF3C4890),
            letterSpacing: 1.0,
          ),
        ),
        centerTitle: true,
        actions: [
          // Quick Wallet Pill in Header
          InkWell(
            onTap: () => context.push('/wallet'),
            borderRadius: BorderRadius.circular(16),
            child: Container(
              margin: const EdgeInsets.symmetric(vertical: 10),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: const Color(0xFF3C4890).withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFF3C4890).withValues(alpha: 0.2)),
              ),
              child: const Row(
                children: [
                  Icon(Icons.account_balance_wallet_rounded, color: Color(0xFF3C4890), size: 15),
                  SizedBox(width: 5),
                  Text('₹1,250', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 12, color: Color(0xFF3C4890))),
                ],
              ),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.notifications_outlined, color: AppTheme.onSurface, size: 22),
            onPressed: _showNotificationCenter,
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Greeting Row (NO profile avatar on the right as requested)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Good Morning, Rahul 👋',
                          style: TextStyle(fontSize: 21, fontWeight: FontWeight.w900, color: AppTheme.onSurface, letterSpacing: -0.4),
                        ),
                        SizedBox(height: 2),
                        Text('Where would you like to travel or order today?', style: TextStyle(color: Color(0xFF64748B), fontSize: 12.5)),
                      ],
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 14),

              // Modern Search Bar ("Where to?")
              GestureDetector(
                onTap: () => context.push('/ride-booking'),
                child: Container(
                  height: 52,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                    boxShadow: [
                      BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 12, offset: const Offset(0, 4)),
                    ],
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.search_rounded, color: Color(0xFF3C4890), size: 22),
                      SizedBox(width: 12),
                      Text('Where to? (e.g. Connaught Place, CP)', style: TextStyle(fontSize: 14, color: Color(0xFF94A3B8), fontWeight: FontWeight.w500)),
                      Spacer(),
                      Icon(Icons.mic_none_rounded, color: Color(0xFF64748B), size: 20),
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 12),

              // Quick Location Chips
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    _buildQuickChip('🏡 Home', 'Civil Lines', () => context.push('/ride-booking')),
                    _buildQuickChip('🏢 Work', 'Connaught Place', () => context.push('/ride-booking')),
                    _buildQuickChip('🎒 School', 'ABC Public', () => context.push('/ride-booking')),
                    _buildQuickChip('✈️ Airport', 'T3 Terminal', () => context.push('/ride-booking')),
                    _buildQuickChip('🛍️ Mall', 'Select Citywalk', () => context.push('/ride-booking')),
                  ],
                ),
              ),

              const SizedBox(height: 20),

              // 🎒 School Child SafeRide Quick Action Widget
              if (primaryChild != null)
                Container(
                  margin: const EdgeInsets.only(bottom: 18),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFFFFF7ED), Color(0xFFFFFBEB)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: const Color(0xFFFFEDD5)),
                    boxShadow: [
                      BoxShadow(color: const Color(0xFFFF6D00).withValues(alpha: 0.08), blurRadius: 10, offset: const Offset(0, 3)),
                    ],
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(colors: [Color(0xFFFF6D00), Color(0xFFEA580C)]),
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: const Center(
                          child: Icon(Icons.school_rounded, color: Colors.white, size: 22),
                        ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                const Text('SAFERIDE • SCHOOL COMMUTE', style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w900, color: Color(0xFFEA580C), letterSpacing: 0.5)),
                                const SizedBox(width: 6),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                                  decoration: BoxDecoration(color: const Color(0xFF00C853).withValues(alpha: 0.15), borderRadius: BorderRadius.circular(4)),
                                  child: const Text('VERIFIED', style: TextStyle(fontSize: 8, fontWeight: FontWeight.bold, color: Color(0xFF00C853))),
                                ),
                              ],
                            ),
                            const SizedBox(height: 2),
                            Text('${primaryChild.fullName} • ${primaryChild.gradeClass}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13.5, color: Color(0xFF1E293B))),
                            Text('${primaryChild.schoolName} • Morning: 07:45 AM', style: const TextStyle(fontSize: 11, color: Color(0xFF64748B))),
                          ],
                        ),
                      ),
                      ElevatedButton(
                        onPressed: () => context.push('/ride-booking'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFFEA580C),
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                          minimumSize: const Size(64, 36),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          elevation: 0,
                        ),
                        child: const Text('Book', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                      ),
                    ],
                  ),
                ),

              // Super-App Core Services Bento Grid
              const Text('Our Services', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: Color(0xFF1E293B))),
              const SizedBox(height: 10),

              // 1. Ride (Full Width Hero Card)
              GestureDetector(
                onTap: () => context.push('/ride-booking'),
                child: Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFF3C4890), Color(0xFF28316B)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(22),
                    boxShadow: [
                      BoxShadow(color: const Color(0xFF3C4890).withValues(alpha: 0.28), blurRadius: 14, offset: const Offset(0, 5)),
                    ],
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.2),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: const Text('⚡ 2 MINS AWAY • NEARBY DRIVERS', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: 0.5)),
                            ),
                            const SizedBox(height: 10),
                            const Text('NABIN Ride', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Colors.white)),
                            const SizedBox(height: 2),
                            const Text('Bike (2W) • Auto (3W) • Car (4W)\nTransparent upfront fares & zero surge', style: TextStyle(fontSize: 11.5, color: Color(0xFFD6E4FF), height: 1.3)),
                            const SizedBox(height: 10),
                            Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: Colors.white,
                                    borderRadius: BorderRadius.circular(10),
                                  ),
                                  child: const Row(
                                    children: [
                                      Text('Book Ride', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: Color(0xFF3C4890))),
                                      SizedBox(width: 4),
                                      Icon(Icons.arrow_forward_rounded, size: 14, color: Color(0xFF3C4890)),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 12),
                      Container(
                        width: 76,
                        height: 76,
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.15),
                          shape: BoxShape.circle,
                        ),
                        child: const Center(
                          child: Icon(Icons.electric_rickshaw_rounded, color: Colors.white, size: 44),
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 14),

              // 2. Food & Grocery 2-Column Bento Grid
              Row(
                children: [
                  // Food Delivery Card
                  Expanded(
                    child: GestureDetector(
                      onTap: () => context.push('/food-home'),
                      child: Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: const Color(0xFFFFEDD5)),
                          boxShadow: [
                            BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 8, offset: const Offset(0, 3)),
                          ],
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    gradient: const LinearGradient(colors: [Color(0xFFFF9030), Color(0xFFEA580C)]),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: const Icon(Icons.restaurant_rounded, color: Colors.white, size: 20),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(color: const Color(0xFFFFEDD5), borderRadius: BorderRadius.circular(6)),
                                  child: const Text('50% OFF', style: TextStyle(fontSize: 8.5, fontWeight: FontWeight.w900, color: Color(0xFFEA580C))),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            const Text('Food Delivery', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: Color(0xFF111827))),
                            const SizedBox(height: 2),
                            const Text('Top rated kitchens\n20–25 mins delivery', style: TextStyle(fontSize: 11, color: Color(0xFF64748B), height: 1.25)),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),

                  // 10-Min Grocery Express Card
                  Expanded(
                    child: GestureDetector(
                      onTap: () => context.push('/grocery-home'),
                      child: Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: const Color(0xFFDCFCE7)),
                          boxShadow: [
                            BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 8, offset: const Offset(0, 3)),
                          ],
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    gradient: const LinearGradient(colors: [Color(0xFF22A447), Color(0xFF16A34A)]),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: const Icon(Icons.shopping_basket_rounded, color: Colors.white, size: 20),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(color: const Color(0xFFDCFCE7), borderRadius: BorderRadius.circular(6)),
                                  child: const Text('10 MINS', style: TextStyle(fontSize: 8.5, fontWeight: FontWeight.w900, color: Color(0xFF15803D))),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            const Text('10-Min Grocery', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: Color(0xFF111827))),
                            const SizedBox(height: 2),
                            const Text('Supermarket essentials\nFresh produce & snacks', style: TextStyle(fontSize: 11, color: Color(0xFF64748B), height: 1.25)),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 12),

              // 3. Parcel Express & Support 2-Column Row
              Row(
                children: [
                  // Parcel Courier Card
                  Expanded(
                    child: GestureDetector(
                      onTap: () => context.push('/parcel-booking'),
                      child: Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: const Color(0xFFE0E7FF)),
                          boxShadow: [
                            BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 8, offset: const Offset(0, 3)),
                          ],
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    gradient: const LinearGradient(colors: [Color(0xFF3C4890), Color(0xFF28316B)]),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: const Icon(Icons.inventory_2_rounded, color: Colors.white, size: 20),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(color: const Color(0xFFE0E7FF), borderRadius: BorderRadius.circular(6)),
                                  child: const Text('DUAL-OTP', style: TextStyle(fontSize: 8.5, fontWeight: FontWeight.w900, color: Color(0xFF3C4890))),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            const Text('Parcel Express', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: Color(0xFF111827))),
                            const SizedBox(height: 2),
                            const Text('Instant point-to-point\nPickup & Drop PINs', style: TextStyle(fontSize: 11, color: Color(0xFF64748B), height: 1.25)),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),

                  // 24/7 Support & Safety Help Card
                  Expanded(
                    child: GestureDetector(
                      onTap: () => context.push('/support'),
                      child: Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: const Color(0xFFF1F5F9)),
                          boxShadow: [
                            BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 8, offset: const Offset(0, 3)),
                          ],
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    gradient: const LinearGradient(colors: [Color(0xFF475569), Color(0xFF334155)]),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: const Icon(Icons.support_agent_rounded, color: Colors.white, size: 20),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(color: const Color(0xFFF1F5F9), borderRadius: BorderRadius.circular(6)),
                                  child: const Text('24/7 HELP', style: TextStyle(fontSize: 8.5, fontWeight: FontWeight.w900, color: Color(0xFF475569))),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            const Text('Support & Help', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: Color(0xFF111827))),
                            const SizedBox(height: 2),
                            const Text('Tickets, Disputes &\nEmergency assistance', style: TextStyle(fontSize: 11, color: Color(0xFF64748B), height: 1.25)),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 20),

              // Live Active Job / Telemetry Card
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: const Color(0xFF3C4890).withValues(alpha: 0.25)),
                  boxShadow: [
                    BoxShadow(color: const Color(0xFF3C4890).withValues(alpha: 0.06), blurRadius: 10, offset: const Offset(0, 3)),
                  ],
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: const BoxDecoration(
                        color: Color(0xFFEFF6FF),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.electric_rickshaw_rounded, color: Color(0xFF3C4890), size: 22),
                    ),
                    const SizedBox(width: 14),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Recent Ride: Connaught Place', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13.5, color: Color(0xFF1E293B))),
                          SizedBox(height: 2),
                          Text('Driver: Rajesh Kumar • Start OTP: 7729', style: TextStyle(color: Color(0xFF3C4890), fontSize: 11.5, fontWeight: FontWeight.bold)),
                        ],
                      ),
                    ),
                    ElevatedButton(
                      onPressed: () => context.push('/active-ride'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF3C4890),
                        foregroundColor: Colors.white,
                        minimumSize: const Size(68, 34),
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        elevation: 0,
                      ),
                      child: const Text('Track', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 20),

              // Partner Modes Switcher (Driver & Restaurant)
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFFF1F5F9),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Partner with NABIN', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: Color(0xFF475569))),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () => context.push('/driver-dashboard'),
                            icon: const Icon(Icons.drive_eta_rounded, size: 16, color: Color(0xFF3C4890)),
                            label: const Text('Driver Mode', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF3C4890))),
                            style: OutlinedButton.styleFrom(
                              backgroundColor: Colors.white,
                              side: const BorderSide(color: Color(0xFFCBD5E1)),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () => context.push('/restaurant-dashboard'),
                            icon: const Icon(Icons.storefront_rounded, size: 16, color: Color(0xFFEA580C)),
                            label: const Text('Restaurant', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFFEA580C))),
                            style: OutlinedButton.styleFrom(
                              backgroundColor: Colors.white,
                              side: const BorderSide(color: Color(0xFFCBD5E1)),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: Color(0xFFE2E8F0), width: 1)),
        ),
        child: BottomNavigationBar(
          currentIndex: _navIndex,
          onTap: (idx) async {
            if (idx == 0) return;
            setState(() => _navIndex = idx);
            if (idx == 1) {
              await context.push('/activity');
            } else if (idx == 2) {
              await context.push('/wallet');
            } else if (idx == 3) {
              await context.push('/profile');
            }
            if (mounted) {
              setState(() => _navIndex = 0);
            }
          },
          backgroundColor: Colors.white,
          selectedItemColor: const Color(0xFF3C4890),
          unselectedItemColor: const Color(0xFF94A3B8),
          type: BottomNavigationBarType.fixed,
          items: const [
            BottomNavigationBarItem(icon: Icon(Icons.home_filled), label: 'Home'),
            BottomNavigationBarItem(icon: Icon(Icons.receipt_long_rounded), label: 'Activity'),
            BottomNavigationBarItem(icon: Icon(Icons.account_balance_wallet_rounded), label: 'Wallet'),
            BottomNavigationBarItem(icon: Icon(Icons.person_rounded), label: 'Profile'),
          ],
        ),
      ),
    );
  }

  Widget _buildQuickChip(String label, String sub, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(right: 8),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Row(
          children: [
            Text(label, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: Color(0xFF1E293B))),
            const SizedBox(width: 4),
            Text('• $sub', style: const TextStyle(fontSize: 11, color: Color(0xFF64748B))),
          ],
        ),
      ),
    );
  }

  void _showLocationPicker() {
    final locations = ['Civil Lines, Delhi', 'Connaught Place, Central Delhi', 'Cyber Hub, Gurugram', 'Noida Sector 62', 'Indira Gandhi Int Airport (T3)'];
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      backgroundColor: Colors.white,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Choose Your Current City / Zone', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: Color(0xFF1E293B))),
                IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
              ],
            ),
            const SizedBox(height: 10),
            ...locations.map((loc) => ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: const Color(0xFF3C4890).withValues(alpha: 0.1), shape: BoxShape.circle),
                child: const Icon(Icons.location_on, color: Color(0xFF3C4890), size: 18),
              ),
              title: Text(loc, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13.5)),
              trailing: const Icon(Icons.chevron_right, size: 18, color: Colors.grey),
              onTap: () {
                setState(() => _currentLocation = loc);
                Navigator.pop(ctx);
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Location switched to $loc')));
              },
            )),
          ],
        ),
      ),
    );
  }

  void _showNotificationCenter() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      backgroundColor: Colors.white,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Live Notifications & Alerts', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: Color(0xFF1E293B))),
                IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
              ],
            ),
            const SizedBox(height: 12),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: const Color(0xFF3C4890).withValues(alpha: 0.1), shape: BoxShape.circle),
                child: const Icon(Icons.electric_rickshaw, color: Color(0xFF3C4890), size: 20),
              ),
              title: const Text('Driver Rajesh Kumar is 2 mins away', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
              subtitle: const Text('Start OTP: 7729 • DL 1Y AB 1234', style: TextStyle(fontSize: 11)),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: const Color(0xFFFF6D00).withValues(alpha: 0.1), shape: BoxShape.circle),
                child: const Icon(Icons.restaurant, color: Color(0xFFFF6D00), size: 20),
              ),
              title: const Text('Kitchen preparing Biryani order', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
              subtitle: const Text('Dilli Darbar Mughlai • Estimated 20 mins', style: TextStyle(fontSize: 11)),
            ),
          ],
        ),
      ),
    );
  }
}
