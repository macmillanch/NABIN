import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/nabin_palette.dart';
import '../../../../core/theme/nabin_tokens.dart';
import '../../../../core/config/nabin_app_config.dart';
import '../../../../core/config/nabin_config_controller.dart';
import '../../../../core/widgets/nabin_service_card.dart';
import '../../../../core/widgets/nabin_remote_banner.dart';
import '../../../../core/widgets/nabin_campaign.dart';
import '../../../../core/models/school_child_repository.dart';
import '../../../../core/network/session_manager.dart';

class CustomerHomeScreen extends ConsumerStatefulWidget {
  const CustomerHomeScreen({super.key});

  @override
  ConsumerState<CustomerHomeScreen> createState() => _CustomerHomeScreenState();
}

class _CustomerHomeScreenState extends ConsumerState<CustomerHomeScreen> {
  int _navIndex = 0;
  String _currentLocation = 'Civil Lines, Delhi';

  /// A tile is live only when the feature flag is on *and* its service row is
  /// not stopped. Both halves are needed: the published ids are lowercase
  /// (`rides`, `grocery`) while the flags are `FEATURE_RIDE`, so a gate that
  /// watched only one of the two would silently never fire.
  ///
  /// A service the server never listed stays available on the flag's answer —
  /// an absent row is not a stop, and inventing one would hide a working tile.
  bool _isAvailable(
    NabinAppConfig config, {
    required String featureKey,
    required String serviceId,
  }) {
    if (config.emergencyStop) return false;
    if (!config.featureEnabled(featureKey)) return false;
    final state = config.services[serviceId];
    if (state == null) return true;
    return state.status == 'ACTIVE' || state.status == 'DEGRADED';
  }

  /// Why a tile is off, in the server's own words when it published any. The
  /// app never invents an ETA or a reason the switchboard did not give.
  String _unavailableMessage(NabinAppConfig config, {required String serviceId, required String name}) {
    final state = config.services[serviceId];
    final notice = state?.broadcastNotice;
    if (notice != null && notice.trim().isNotEmpty) return notice.trim();
    if (config.emergencyStop) {
      return 'NABIN has stopped every service temporarily. Please try again shortly.';
    }
    if (state != null && state.status != 'ACTIVE') {
      return '${state.name ?? name} is paused in your area right now.';
    }
    return "That service isn't available in your area yet.";
  }

  void _openService(
    NabinAppConfig config, {
    required String featureKey,
    required String serviceId,
    required String name,
    required String route,
  }) {
    if (_isAvailable(config, featureKey: featureKey, serviceId: serviceId)) {
      context.push(route);
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(_unavailableMessage(config, serviceId: serviceId, name: name)),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final palette = NabinPalette.of(context);
    final config = ref.watch(nabinConfigProvider);
    final repo = SchoolChildRepository.instance;
    final primaryChild = repo.children.isNotEmpty ? repo.children.first : null;
    final user = SessionManager.instance.currentUser;
    final String firstName = user?['name']?.toString().split(' ').first ?? 'User';
    final double walletBalance = (user?['wallet_balance'] as num?)?.toDouble() ?? 0.0;

    final rideOn = _isAvailable(config, featureKey: 'FEATURE_RIDE', serviceId: 'rides');
    final foodOn = _isAvailable(config, featureKey: 'FEATURE_FOOD', serviceId: 'food');
    final groceryOn = _isAvailable(config, featureKey: 'FEATURE_GROCERY', serviceId: 'grocery');
    final parcelOn = _isAvailable(config, featureKey: 'FEATURE_PARCEL', serviceId: 'parcel');

    return Scaffold(
      backgroundColor: palette.canvas,
      appBar: AppBar(
        backgroundColor: palette.surface,
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
                    color: palette.brand.withValues(alpha: 0.1),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(Icons.location_on_rounded, color: palette.brand, size: 18),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('LOCATION', style: TextStyle(fontSize: 8.5, fontWeight: FontWeight.w900, color: palette.brand, letterSpacing: 0.5)),
                      Text(
                        _currentLocation,
                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: palette.onSurface),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                Icon(Icons.keyboard_arrow_down_rounded, size: 16, color: palette.onSurfaceMuted),
              ],
            ),
          ),
        ),
        title: NabinCampaignWordmark(
          // The built-in wordmark is also the fallback for a campaign that
          // published none, so the header never depends on a fetch succeeding.
          fallback: Text(
            'NABIN',
            style: TextStyle(
              fontWeight: FontWeight.w900,
              fontSize: 20,
              color: palette.brand,
              letterSpacing: 1.0,
            ),
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
                color: palette.brand.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: palette.brand.withValues(alpha: 0.2)),
              ),
              child: Row(
                children: [
                  Icon(Icons.account_balance_wallet_rounded, color: palette.brand, size: 15),
                  const SizedBox(width: 5),
                  Text('₹${walletBalance.toStringAsFixed(0)}', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 12, color: palette.brand)),
                ],
              ),
            ),
          ),
          IconButton(
            icon: Icon(Icons.notifications_outlined, color: palette.onSurface, size: 22),
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
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Good Morning, $firstName 👋',
                          style: TextStyle(fontSize: 21, fontWeight: FontWeight.w900, color: palette.onSurface, letterSpacing: -0.4),
                        ),
                        const SizedBox(height: 2),
                        Text('Where would you like to travel or order today?', style: TextStyle(color: palette.onSurfaceMuted, fontSize: 12.5)),
                      ],
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 14),

              // What the platform itself has published: a pause, a lockdown, or
              // nothing at all when every service is running.
              const NabinPlatformNotice(),

              // What a live campaign published for this surface, or nothing.
              const NabinCampaignAnnouncement(surface: 'CUSTOMER_HOME'),
              const NabinCampaignPopup(surface: 'CUSTOMER_HOME'),

              // Modern Search Bar ("Where to?")
              GestureDetector(
                onTap: () => context.push('/ride-booking'),
                child: Container(
                  height: 52,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  decoration: BoxDecoration(
                    color: palette.surface,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: palette.divider),
                    boxShadow: [
                      BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 12, offset: const Offset(0, 4)),
                    ],
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.search_rounded, color: palette.brand, size: 22),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'Where to? (e.g. Connaught Place, CP)',
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 14, color: palette.onSurfaceMuted, fontWeight: FontWeight.w500),
                        ),
                      ),
                      Icon(Icons.mic_none_rounded, color: palette.onSurfaceMuted, size: 20),
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
                    _buildQuickChip(palette, '🏡 Home', 'Civil Lines', () => context.push('/ride-booking')),
                    _buildQuickChip(palette, '🏢 Work', 'Connaught Place', () => context.push('/ride-booking')),
                    _buildQuickChip(palette, '🎒 School', 'ABC Public', () => context.push('/ride-booking')),
                    _buildQuickChip(palette, '✈️ Airport', 'T3 Terminal', () => context.push('/ride-booking')),
                    _buildQuickChip(palette, '🛍️ Mall', 'Select Citywalk', () => context.push('/ride-booking')),
                  ],
                ),
              ),

              const SizedBox(height: 20),

              // A campaign the platform is running: its creatives and its
              // discounts, or nothing when no campaign applies to this surface.
              const NabinCampaignBanner(),

              // A published campaign slot. Renders nothing when no campaign is
              // live for this placement, which is the honest state of an ad slot.
              const NabinRemoteBanner(),

              // 🎒 School Child SafeRide Quick Action Widget
              if (primaryChild != null)
                Container(
                  margin: const EdgeInsets.only(bottom: 18),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    // SafeRide keeps its own amber ramp: the published theme
                    // vocabulary has no school token, and recolouring a safety
                    // affordance from a brand change would be wrong anyway.
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
                                  decoration: BoxDecoration(color: palette.success.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(4)),
                                  child: Text('VERIFIED', style: TextStyle(fontSize: 8, fontWeight: FontWeight.bold, color: palette.success)),
                                ),
                              ],
                            ),
                            const SizedBox(height: 2),
                            Text('${primaryChild.fullName} • ${primaryChild.gradeClass}', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13.5, color: palette.onSurface)),
                            Text('${primaryChild.schoolName} • Morning: 07:45 AM', style: TextStyle(fontSize: 11, color: palette.onSurfaceMuted)),
                          ],
                        ),
                      ),
                      ElevatedButton(
                        onPressed: () => _openService(
                          config,
                          featureKey: 'FEATURE_RIDE',
                          serviceId: 'rides',
                          name: 'NABIN Mobility',
                          route: '/ride-booking',
                        ),
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
              Text('Our Services', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: palette.onSurface)),
              const SizedBox(height: 10),

              // 1. Ride (Full Width Hero Card)
              NabinServiceCard(
                title: 'NABIN Ride',
                subtitle: 'Bike (2W) • Auto (3W) • Car (4W)\nTransparent upfront fares & zero surge',
                icon: Icons.electric_rickshaw_rounded,
                primaryColor: palette.brand,
                tagText: '⚡ 2 MINS AWAY • NEARBY DRIVERS',
                isEnabled: rideOn,
                isHero: true,
                onTap: () => _openService(
                  config,
                  featureKey: 'FEATURE_RIDE',
                  serviceId: 'rides',
                  name: 'NABIN Mobility',
                  route: '/ride-booking',
                ),
              ),

              const SizedBox(height: 14),

              // 2. Food & Grocery 2-Column Bento Grid
              Row(
                children: [
                  // Food Delivery Card
                  Expanded(
                    child: NabinServiceCard(
                      title: 'Food Delivery',
                      subtitle: 'Top rated kitchens\n20–25 mins delivery',
                      icon: Icons.restaurant_rounded,
                      primaryColor: palette.foodAccent,
                      tagText: '50% OFF',
                      tagColor: palette.foodAccent,
                      isEnabled: foodOn,
                      onTap: () => _openService(
                        config,
                        featureKey: 'FEATURE_FOOD',
                        serviceId: 'food',
                        name: 'NABIN Food',
                        route: '/food-home',
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),

                  // 10-Min Grocery Express Card
                  Expanded(
                    child: NabinServiceCard(
                      title: '10-Min Grocery',
                      subtitle: 'Supermarket essentials\nFresh produce & snacks',
                      icon: Icons.shopping_basket_rounded,
                      primaryColor: palette.groceryAccent,
                      tagText: '10 MINS',
                      tagColor: palette.groceryAccent,
                      isEnabled: groceryOn,
                      onTap: () => _openService(
                        config,
                        featureKey: 'FEATURE_GROCERY',
                        serviceId: 'grocery',
                        name: 'NABIN Grocery',
                        route: '/grocery-home',
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
                    child: NabinServiceCard(
                      title: 'Parcel Express',
                      subtitle: 'Instant point-to-point\nPickup & Drop PINs',
                      icon: Icons.inventory_2_rounded,
                      primaryColor: palette.brand,
                      tagText: 'DUAL-OTP',
                      tagColor: palette.brand,
                      isEnabled: parcelOn,
                      onTap: () => _openService(
                        config,
                        featureKey: 'FEATURE_PARCEL',
                        serviceId: 'parcel',
                        name: 'NABIN Parcel',
                        route: '/parcel-booking',
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
                          color: palette.surface,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: palette.surfaceMuted),
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
                                  decoration: BoxDecoration(color: palette.surfaceMuted, borderRadius: BorderRadius.circular(6)),
                                  child: Text('24/7 HELP', style: TextStyle(fontSize: 8.5, fontWeight: FontWeight.w900, color: palette.onSurfaceMuted)),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            Text('Support & Help', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: palette.onSurface)),
                            const SizedBox(height: 2),
                            Text('Tickets, Disputes &\nEmergency assistance', style: TextStyle(fontSize: 11, color: palette.onSurfaceMuted, height: 1.25)),
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
                  color: palette.surface,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: palette.brand.withValues(alpha: 0.25)),
                  boxShadow: [
                    BoxShadow(color: palette.brand.withValues(alpha: 0.06), blurRadius: 10, offset: const Offset(0, 3)),
                  ],
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: palette.brandTint,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(Icons.electric_rickshaw_rounded, color: palette.brand, size: 22),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Recent Ride: Connaught Place', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13.5, color: palette.onSurface)),
                          const SizedBox(height: 2),
                          Text('Driver: Rajesh Kumar • Start OTP: 7729', style: TextStyle(color: palette.brand, fontSize: 11.5, fontWeight: FontWeight.bold)),
                        ],
                      ),
                    ),
                    ElevatedButton(
                      onPressed: () => context.push('/active-ride'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: palette.brand,
                        foregroundColor: NabinTheme.on(palette.brand, palette),
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
                  color: palette.surfaceMuted,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Partner with NABIN', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: palette.onSurfaceMuted)),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () => context.push('/driver-dashboard'),
                            icon: Icon(Icons.drive_eta_rounded, size: 16, color: palette.brand),
                            label: Text('Driver Mode', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: palette.brand)),
                            style: OutlinedButton.styleFrom(
                              backgroundColor: palette.surface,
                              side: BorderSide(color: palette.divider),
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
                              backgroundColor: palette.surface,
                              side: BorderSide(color: palette.divider),
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
        decoration: BoxDecoration(
          color: palette.surface,
          border: Border(top: BorderSide(color: palette.divider, width: 1)),
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
          backgroundColor: palette.surface,
          selectedItemColor: palette.brand,
          unselectedItemColor: palette.onSurfaceMuted,
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

  Widget _buildQuickChip(NabinPalette palette, String label, String sub, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(right: 8),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: palette.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: palette.divider),
        ),
        child: Row(
          children: [
            Text(label, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: palette.onSurface)),
            const SizedBox(width: 4),
            Text('• $sub', style: TextStyle(fontSize: 11, color: palette.onSurfaceMuted)),
          ],
        ),
      ),
    );
  }

  void _showLocationPicker() {
    final palette = NabinPalette.of(context);
    final locations = ['Civil Lines, Delhi', 'Connaught Place, Central Delhi', 'Cyber Hub, Gurugram', 'Noida Sector 62', 'Indira Gandhi Int Airport (T3)'];
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      backgroundColor: palette.surface,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Choose Your Current City / Zone', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: palette.onSurface)),
                IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
              ],
            ),
            const SizedBox(height: 10),
            ...locations.map((loc) => ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: palette.brand.withValues(alpha: 0.1), shape: BoxShape.circle),
                child: Icon(Icons.location_on, color: palette.brand, size: 18),
              ),
              title: Text(loc, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13.5, color: palette.onSurface)),
              trailing: Icon(Icons.chevron_right, size: 18, color: palette.onSurfaceMuted),
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
    final palette = NabinPalette.of(context);
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      backgroundColor: palette.surface,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Live Notifications & Alerts', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: palette.onSurface)),
                IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
              ],
            ),
            const SizedBox(height: 12),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: palette.brand.withValues(alpha: 0.1), shape: BoxShape.circle),
                child: Icon(Icons.electric_rickshaw, color: palette.brand, size: 20),
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
