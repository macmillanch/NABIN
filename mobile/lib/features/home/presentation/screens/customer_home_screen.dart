import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/nabin_palette.dart';
import '../../../../core/theme/nabin_tokens.dart';
import '../../../../core/config/nabin_app_config.dart';
import '../../../../core/config/nabin_build_env.dart';
import '../../../../core/config/nabin_config_controller.dart';
import '../../../../core/widgets/nabin_remote_banner.dart';
import '../../../../core/widgets/nabin_campaign.dart';
import '../../../../core/models/school_child_repository.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/network/session_manager.dart';
import '../../../food/presentation/providers/food_models.dart';
import '../../../grocery/presentation/models/grocery_product.dart';

class CustomerHomeScreen extends ConsumerStatefulWidget {
  const CustomerHomeScreen({super.key});

  @override
  ConsumerState<CustomerHomeScreen> createState() => _CustomerHomeScreenState();
}

class _CustomerHomeScreenState extends ConsumerState<CustomerHomeScreen> {
  int _navIndex = 0;

  /// Where the customer last said they are booking from. This used to open on
  /// 'Kamalanagar, Aizawl' — a street this app has no way to know — and the sheet
  /// under it listed five more invented localities. Nothing in the app reads the
  /// device location, and `POST /api/geofence/reverse-geocode` answers Aizawl
  /// coordinates with Delhi copy, so the only places Home may name are the ones
  /// this account saved.
  String _currentLocation = '';

  /// The signed-in customer's own orders, read once here because two sections need
  /// it: the continue-your-trip banner and the recent-activity list. Two independent
  /// reads of the same endpoint would be two chances for the two halves of Home to
  /// disagree about what the customer has done.
  List<_HomeActivity> _activity = const <_HomeActivity>[];
  bool _activityLoading = true;
  bool _activityFailed = false;

  @override
  void initState() {
    super.initState();
    _loadActivity();
    // The school shortcut is driven by the account's saved children, so Home
    // asks the platform for them like every other list it shows.
    SchoolChildRepository.instance.load();
  }

  Future<void> _loadActivity() async {
    setState(() {
      _activityLoading = true;
      _activityFailed = false;
    });
    final res = await NabinApiService.getCustomerActivity();
    if (!mounted) return;
    // A refused read stays an error state: "you have no orders" and "we could not
    // read your orders" are different sentences to show a customer.
    final usable = res != null && res['success'] == true;
    final raw = (res?['items'] as List? ?? const <dynamic>[]);
    setState(() {
      _activityFailed = !usable;
      _activity = usable
          ? raw
              .whereType<Map<dynamic, dynamic>>()
              .map((e) => _HomeActivity.fromJson(Map<String, dynamic>.from(e)))
              .whereType<_HomeActivity>()
              .toList(growable: false)
          : const <_HomeActivity>[];
      _activityLoading = false;
    });
  }

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

  /// The school-commute shortcut. It renders nothing until the customer's own
  /// account has a saved child, and the line under the name is that school row's
  /// timing summary — no invented pickup time and no verification badge the
  /// platform has no column for.
  Widget _schoolSafeRideCard(NabinPalette palette, NabinAppConfig config) {
    final repo = SchoolChildRepository.instance;
    return ListenableBuilder(
      listenable: repo,
      builder: (context, _) {
        final children = repo.children;
        if (children.isEmpty) return const SizedBox.shrink();
        final child = children.first;
        final summary = repo.schoolFor(child)?.generalTimingSummary;
        final detail = <String>[
          if (child.schoolName != null && child.schoolName!.isNotEmpty)
            child.schoolName!,
          if (summary != null && summary.isNotEmpty) summary,
        ].join(' • ');

        return Container(
          margin: const EdgeInsets.only(bottom: 18),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            // SafeRide is a white card with a brand-tinted action badge:
            // the old standalone amber gradient was a foreign colour that
            // fought the #1A3BA2 system, and a safety affordance reads
            // calmer as a clean card than as loud warning paint.
            color: palette.surface,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: palette.divider),
            boxShadow: [
              BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 10, offset: const Offset(0, 3)),
            ],
          ),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: palette.brandTint,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(Icons.school_rounded, color: palette.brand, size: 22),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('SAFERIDE • SCHOOL COMMUTE', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w900, color: palette.brand, letterSpacing: 0.5)),
                    const SizedBox(height: 2),
                    Text('${child.fullName} • ${child.gradeClass}', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13.5, color: palette.onSurface)),
                    if (detail.isNotEmpty)
                      Text(detail, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11, color: palette.onSurfaceMuted)),
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
                  backgroundColor: palette.brand,
                  foregroundColor: NabinTheme.on(palette.brand, palette),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  minimumSize: const Size(64, 36),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  elevation: 0,
                ),
                child: const Text('Book', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final palette = NabinPalette.of(context);
    final config = ref.watch(nabinConfigProvider);
    final user = SessionManager.instance.currentUser;
    final String firstName = user?['name']?.toString().split(' ').first ?? 'User';
    // The session entity is camelCase in both the mirror and the SQL projection; the
    // snake_case spelling here meant the pill printed ₹0 for every customer who had
    // money. A null stays null: an unreadable balance is not a balance of zero.
    final double? walletBalance = (user?['walletBalance'] as num?)?.toDouble();

    final rideOn = _isAvailable(config, featureKey: 'FEATURE_RIDE', serviceId: 'rides');
    final foodOn = _isAvailable(config, featureKey: 'FEATURE_FOOD', serviceId: 'food');
    final groceryOn = _isAvailable(config, featureKey: 'FEATURE_GROCERY', serviceId: 'grocery');
    final parcelOn = _isAvailable(config, featureKey: 'FEATURE_PARCEL', serviceId: 'parcel');

    return Scaffold(
      backgroundColor: palette.canvas,
      // The header is the one brand-blue band on the home: it carries the
      // identity (wordmark, location, wallet) in #1A3BA2 so the scrollable body
      // below can stay white/neutral. Ink on the band is always onBrand.
      appBar: AppBar(
        backgroundColor: palette.brand,
        foregroundColor: palette.onBrand,
        elevation: 0,
        scrolledUnderElevation: 0,
        leadingWidth: 168,
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
                    color: palette.onBrand.withValues(alpha: 0.16),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(Icons.location_on_rounded, color: palette.onBrand, size: 18),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('LOCATION', style: TextStyle(fontSize: 8.5, fontWeight: FontWeight.w900, color: palette.onBrand.withValues(alpha: 0.8), letterSpacing: 0.5)),
                      Text(
                        _currentLocation.isEmpty ? 'Choose your place' : _currentLocation,
                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: palette.onBrand),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                Icon(Icons.keyboard_arrow_down_rounded, size: 16, color: palette.onBrand.withValues(alpha: 0.8)),
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
              color: palette.onBrand,
              letterSpacing: 1.0,
            ),
          ),
        ),
        centerTitle: true,
        actions: [
          // Quick Wallet Pill in Header — a translucent white pill on the brand band.
          InkWell(
            onTap: () => context.push('/wallet'),
            borderRadius: BorderRadius.circular(16),
            child: Container(
              margin: const EdgeInsets.symmetric(vertical: 10),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: palette.onBrand.withValues(alpha: 0.14),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: palette.onBrand.withValues(alpha: 0.22)),
              ),
              child: Row(
                children: [
                  Icon(Icons.account_balance_wallet_rounded, color: palette.onBrand, size: 15),
                  const SizedBox(width: 5),
                  Text(walletBalance == null ? '—' : '₹${walletBalance.toStringAsFixed(0)}', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 12, color: palette.onBrand)),
                ],
              ),
            ),
          ),
          IconButton(
            icon: Icon(Icons.notifications_outlined, color: palette.onBrand, size: 22),
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
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Good Morning, $firstName 👋',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 21, fontWeight: FontWeight.w900, color: palette.onSurface, letterSpacing: -0.4),
                          ),
                          const SizedBox(height: 2),
                          Text('Where would you like to travel or order today?', style: TextStyle(color: palette.onSurfaceMuted, fontSize: 12.5)),
                        ],
                      ),
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
                          'Search rides, food, groceries, parcels',
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

              // Quick Location Chips. These five used to be 'Home • Kamalanagar',
              // 'Work • Secretariat', 'School • BCM Higher Sec', 'Airport • Lengpui'
              // and 'Mall • Buota' — streets no screen in this app had ever read, and
              // tapping one opened a ride whose pickup was none of them. A chip may
              // only name a place the account itself saved, and it opens the ride with
              // that place already chosen.
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: _savedPlaces.isEmpty
                      ? <Widget>[
                          _buildQuickChip(
                            palette,
                            '📍 Saved places',
                            SchoolChildRepository.instance.isLoading
                                ? 'Reading your account'
                                : 'None on this account yet',
                            _showLocationPicker,
                          ),
                        ]
                      : _savedPlaces
                          .map((place) => _buildQuickChip(
                                palette,
                                place.kind,
                                place.short,
                                () => place.open(context),
                              ))
                          .toList(),
                ),
              ),

              const SizedBox(height: 20),

              // A campaign the platform is running: its creatives and its
              // discounts, or nothing when no campaign applies to this surface.
              const NabinCampaignBanner(),

              // A published campaign slot. Renders nothing when no campaign is
              // live for this placement, which is the honest state of an ad slot.
              const NabinRemoteBanner(),

              _schoolSafeRideCard(palette, config),

              // Super-App Core Services Bento Grid
              Text('What do you need today?', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: palette.onSurface)),
              const SizedBox(height: 12),

              // Four service shortcuts as white tiles with a coloured icon badge.
              // The redesign deliberately drops the old full-colour hero card: one
              // giant brand block made the home read as a blue app, and a big tile
              // per service fought the 40/30/20/10 balance. Service identity now
              // lives in the ~20% accent badge, not the tile fill.
              Row(
                children: [
                  Expanded(
                    child: _ServiceTile(
                      palette: palette,
                      label: 'Ride',
                      icon: Icons.electric_rickshaw_rounded,
                      accent: palette.rideAccent,
                      enabled: rideOn,
                      onTap: () => _openService(
                        config,
                        featureKey: 'FEATURE_RIDE',
                        serviceId: 'rides',
                        name: 'NABIN Mobility',
                        route: '/ride-booking',
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _ServiceTile(
                      palette: palette,
                      label: 'Food',
                      icon: Icons.restaurant_rounded,
                      accent: palette.foodAccent,
                      enabled: foodOn,
                      onTap: () => _openService(
                        config,
                        featureKey: 'FEATURE_FOOD',
                        serviceId: 'food',
                        name: 'NABIN Food',
                        route: '/food-home',
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _ServiceTile(
                      palette: palette,
                      label: 'Grocery',
                      icon: Icons.shopping_basket_rounded,
                      accent: palette.groceryAccent,
                      enabled: groceryOn,
                      onTap: () => _openService(
                        config,
                        featureKey: 'FEATURE_GROCERY',
                        serviceId: 'grocery',
                        name: 'NABIN Grocery',
                        route: '/grocery-home',
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _ServiceTile(
                      palette: palette,
                      label: 'Parcel',
                      icon: Icons.inventory_2_rounded,
                      accent: palette.parcelAccent,
                      enabled: parcelOn,
                      onTap: () => _openService(
                        config,
                        featureKey: 'FEATURE_PARCEL',
                        serviceId: 'parcel',
                        name: 'NABIN Parcel',
                        route: '/parcel-booking',
                      ),
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 12),

              // A slim support strip keeps 24/7 help one tap away without
              // competing with the service tiles for visual weight.
              GestureDetector(
                onTap: () => context.push('/support'),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  decoration: BoxDecoration(
                    color: palette.surface,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: palette.divider),
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(7),
                        decoration: BoxDecoration(color: palette.brandTint, shape: BoxShape.circle),
                        child: Icon(Icons.support_agent_rounded, color: palette.brand, size: 16),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Support & Help', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: palette.onSurface)),
                            Text('Tickets, disputes & emergencies', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 10.5, color: palette.onSurfaceMuted)),
                          ],
                        ),
                      ),
                      Icon(Icons.chevron_right_rounded, size: 18, color: palette.onSurfaceMuted),
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 20),

              // Continue-your-trip card. It renders only when the customer has a job
              // the server actually marks active, and it names that job; Real Ride
              // state is owned by /active-ride (WebSocket-driven), so this banner only
              // links to it and asserts no progress, ETA, or fare.
              _ActiveTripCard(activity: _activity),

              const SizedBox(height: 20),

              // Discovery rails. Each one is the backend's own list: restaurants from
              // GET /restaurants, stores derived from the merchant names on real
              // GET /grocery/products rows. A rating or ETA the endpoint does not
              // return is not painted at all, and a rail whose read was refused shows
              // that instead of an empty shelf. Tapping opens the real service surface,
              // and each rail hides itself when its service is paused.
              if (foodOn) ...[
                _DiscoveryRail(
                  title: 'Recommended restaurants',
                  accent: palette.foodAccent,
                  route: '/food-home',
                  load: _loadRestaurantPlaces,
                  emptyMessage: 'No restaurants are listed yet.',
                  failedMessage: "Couldn't load recommended restaurants.",
                ),
                const SizedBox(height: 18),
              ],

              if (groceryOn) ...[
                _DiscoveryRail(
                  title: 'Grocery stores',
                  accent: palette.groceryAccent,
                  route: '/grocery-home',
                  load: _loadGroceryPlaces,
                  emptyMessage: 'No grocery stores are listed yet.',
                  failedMessage: "Couldn't load grocery stores.",
                ),
                const SizedBox(height: 18),
              ],

              _RecentActivity(
                loading: _activityLoading,
                failed: _activityFailed,
                items: _activity,
                onRetry: _loadActivity,
              ),

              const SizedBox(height: 20),

              // Partner Modes Switcher (Driver & Restaurant).
              //
              // Both buttons open a simulator that paints a sample partner's name, rating
              // and earnings, so they belong to a build that is not addressed at a real
              // customer — and the routes behind them are registered on the same condition
              // in `app_router.dart`. Without this gate, Home is one tap from a lie.
              if (NabinBuildEnv.allowsDemoConvenience) ...[
                const SizedBox(height: 20),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: palette.surfaceMuted,
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Partner with NABIN', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: palette.onSurface)),
                      const SizedBox(height: 4),
                      Text(
                        'Demo simulators of the partner apps. They show sample data, not a '
                        'real partner account.',
                        style: TextStyle(fontSize: 11, color: palette.onSurfaceMuted, height: 1.3),
                      ),
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
                              icon: Icon(Icons.storefront_rounded, size: 16, color: palette.foodAccent),
                              label: Text('Restaurant', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: palette.foodAccent)),
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
              ],

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
        // A saved place carries whatever text the customer typed, so the chip bounds
        // it instead of letting one long address push the rest of the row off screen.
        constraints: const BoxConstraints(maxWidth: 200),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: palette.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: palette.divider),
        ),
        child: Row(
          children: [
            Flexible(
              child: Text(label, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: palette.onSurface), overflow: TextOverflow.ellipsis),
            ),
            const SizedBox(width: 4),
            Flexible(
              child: Text('• $sub', style: TextStyle(fontSize: 11, color: palette.onSurfaceMuted), overflow: TextOverflow.ellipsis),
            ),
          ],
        ),
      ),
    );
  }

  /// The places this account has, exactly as the platform returned them: a saved child
  /// carries a pickup address and a saved school carries its own. Both come from
  /// `/api/children` and `/api/schools`, and both are rows the customer can delete —
  /// which is the test of whether Home is allowed to name one.
  List<_SavedPlace> get _savedPlaces {
    final repo = SchoolChildRepository.instance;
    return <_SavedPlace>[
      for (final child in repo.children)
        _SavedPlace(
          kind: '🏡 Pickup',
          short: child.fullName,
          title: child.defaultPickupAddress,
          caption: 'Pickup saved for ${child.fullName}',
          open: (context) => context.push('/ride-booking',
              extra: <String, dynamic>{'childId': child.id}),
        ),
      for (final school in repo.schools)
        _SavedPlace(
          kind: '🎒 School',
          short: school.name,
          title: school.name,
          caption: school.address,
          open: (context) => context.push('/ride-booking',
              extra: <String, dynamic>{'schoolId': school.id}),
        ),
    ];
  }

  void _showLocationPicker() {
    final palette = NabinPalette.of(context);
    final repo = SchoolChildRepository.instance;
    final places = _savedPlaces;
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
                Text('Places on your account', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: palette.onSurface)),
                IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
              ],
            ),
            const SizedBox(height: 10),
            if (repo.status == SchoolChildLoadStatus.failed)
              // An error state, not an empty one: "you have no saved places" and "we
              // could not read them" send the customer to different screens.
              Text(
                'NABIN could not read your saved places. Reopen this screen from Profile to try again.',
                style: TextStyle(fontSize: 12.5, color: palette.danger, fontWeight: FontWeight.w700, height: 1.35),
              )
            else if (places.isEmpty)
              Text(
                repo.isLoading
                    ? 'Reading your saved places…'
                    : 'No place is saved on this account yet. Save a school or a child in Profile and NABIN will hold it for the rides you book.',
                style: TextStyle(fontSize: 12.5, color: palette.onSurfaceMuted, fontWeight: FontWeight.w600, height: 1.35),
              )
            else
              ...places.map((place) => ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(color: palette.brand.withValues(alpha: 0.1), shape: BoxShape.circle),
                  child: Icon(Icons.location_on, color: palette.brand, size: 18),
                ),
                title: Text(place.title, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13.5, color: palette.onSurface)),
                subtitle: Text(place.caption, style: TextStyle(fontSize: 11.5, color: palette.onSurfaceMuted)),
                trailing: Icon(Icons.chevron_right, size: 18, color: palette.onSurfaceMuted),
                onTap: () {
                  Navigator.pop(ctx);
                  setState(() => _currentLocation = place.title);
                  place.open(context);
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
                Text('Notifications', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: palette.onSurface)),
                IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
              ],
            ),
            const SizedBox(height: 12),
            const _NotificationCenter(),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}

/// The Home bell's feed, read from `GET /api/notifications` — the backend keys
/// that feed to the bearer token, so nothing is passed in and nothing is
/// invented. The sheet used to show two `const Text` rows asserting a live trip
/// and a food order being prepared; the platform cannot know either at the
/// moment the bell is tapped, and the read path that can answer it already
/// existed.
class _NotificationCenter extends StatefulWidget {
  const _NotificationCenter();

  @override
  State<_NotificationCenter> createState() => _NotificationCenterState();
}

class _NotificationCenterState extends State<_NotificationCenter> {
  static const int _pageLimit = 12;

  List<Map<String, dynamic>> _items = const <Map<String, dynamic>>[];
  bool _isLoading = true;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _isLoading = true;
      _failed = false;
    });
    final res = await NabinApiService.getNotifications(limit: _pageLimit);
    if (!mounted) return;
    final list = (res?['notifications'] as List? ?? const <dynamic>[])
        .whereType<Map<dynamic, dynamic>>()
        .map((n) => n.cast<String, dynamic>())
        .toList();
    setState(() {
      // A null response is a dead endpoint, not an empty inbox: only an actual
      // feed from the server is allowed to render the empty state.
      _failed = res == null || res['success'] != true;
      _items = _failed ? const <Map<String, dynamic>>[] : list;
      _isLoading = false;
    });
  }

  String _ago(String? iso) {
    final at = DateTime.tryParse(iso ?? '')?.toLocal();
    if (at == null) return '';
    final delta = DateTime.now().difference(at);
    if (delta.inMinutes < 1) return 'just now';
    if (delta.inMinutes < 60) return '${delta.inMinutes} min ago';
    if (delta.inHours < 24) return '${delta.inHours} hr ago';
    if (delta.inDays < 7) return '${delta.inDays} d ago';
    return '${at.day}/${at.month}';
  }

  @override
  Widget build(BuildContext context) {
    final palette = NabinPalette.of(context);

    if (_isLoading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: Center(child: CircularProgressIndicator(strokeWidth: 2.4)),
      );
    }

    if (_failed) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            "Couldn't load your notifications.",
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
          ),
          TextButton.icon(
            onPressed: _load,
            icon: const Icon(Icons.refresh_rounded, size: 18),
            label: const Text('Retry'),
          ),
        ],
      );
    }

    if (_items.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 18),
        child: Text(
          'No notifications yet.',
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
        ),
      );
    }

    return ConstrainedBox(
      constraints: const BoxConstraints(maxHeight: 320),
      child: ListView.separated(
        shrinkWrap: true,
        padding: EdgeInsets.zero,
        itemCount: _items.length,
        separatorBuilder: (_, __) => Divider(
            height: 1, thickness: 1, color: palette.divider),
        itemBuilder: (context, idx) {
          final n = _items[idx];
          final title = n['title']?.toString() ?? '';
          final body = n['body']?.toString() ?? '';
          final when = _ago(n['createdAt']?.toString());
          final unread = n['isRead'] != true;
          return ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: palette.brand.withValues(alpha: 0.1),
                shape: BoxShape.circle,
              ),
              child: Icon(
                unread
                    ? Icons.notifications_active
                    : Icons.notifications_none,
                color: palette.brand,
                size: 20,
              ),
            ),
            title: Text(
              title.isEmpty ? 'Notification' : title,
              style: const TextStyle(
                  fontWeight: FontWeight.bold, fontSize: 13),
            ),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (body.isNotEmpty)
                  Text(body,
                      style: const TextStyle(fontSize: 11),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis),
                if (when.isNotEmpty)
                  Text(when,
                      style: TextStyle(
                          fontSize: 11, color: palette.onSurfaceMuted)),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// A compact white service shortcut: neutral card, a coloured icon badge carrying
/// the ~20% service identity, and a single label. Disabled tiles dim rather than
/// disappear so the row stays stable when a service is paused.
class _ServiceTile extends StatelessWidget {
  const _ServiceTile({
    required this.palette,
    required this.label,
    required this.icon,
    required this.accent,
    required this.enabled,
    required this.onTap,
  });

  final NabinPalette palette;
  final String label;
  final IconData icon;
  final Color accent;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: enabled ? onTap : null,
      child: Opacity(
        opacity: enabled ? 1 : 0.45,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 6),
          decoration: BoxDecoration(
            color: palette.surface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: palette.divider),
            boxShadow: [
              BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 8, offset: const Offset(0, 3)),
            ],
          ),
          child: Column(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(color: accent.withValues(alpha: 0.12), shape: BoxShape.circle),
                child: Icon(enabled ? icon : Icons.lock_outline_rounded, color: accent, size: 22),
              ),
              const SizedBox(height: 8),
              Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: palette.onSurface)),
              // Status never relies on the dim alone: a paused service says so.
              SizedBox(
                height: 12,
                child: enabled
                    ? const SizedBox.shrink()
                    : Text('Paused', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: palette.danger)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, required this.action, required this.onAction});

  final String title;
  final String action;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    final palette = NabinPalette.of(context);
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Flexible(
          child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w900, color: palette.onSurface)),
        ),
        const SizedBox(width: 8),
        InkWell(
          onTap: onAction,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
            child: Text(action, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: palette.brand)),
          ),
        ),
      ],
    );
  }
}

/// One card in a discovery rail. Every line on it comes from a real row of the
/// endpoint that rail reads, and each of [area], [tag] and [eta] is nullable
/// because the endpoints answer with those columns only when the merchant has
/// filled them in. A null renders no icon and no figure rather than a
/// placeholder the customer would read as a real delivery time. There is no
/// star on this card at all: `GET /api/restaurants` projects no rating, because
/// `merchants.rating` has no reviews table behind it.
class _PlaceCard extends StatelessWidget {
  const _PlaceCard({
    required this.name,
    required this.tag,
    required this.accent,
    required this.icon,
    required this.onTap,
    this.area,
    this.eta,
  });

  final String name;
  final String? area;
  final String? tag;
  final String? eta;
  final Color accent;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = NabinPalette.of(context);
    final meta = <String>[
      if (area != null && area!.isNotEmpty) area!,
      if (tag != null && tag!.isNotEmpty) tag!,
    ].join(' • ');
    final hasEta = eta != null && eta!.isNotEmpty;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 158,
        margin: const EdgeInsets.only(right: 12),
        decoration: BoxDecoration(
          color: palette.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: palette.divider),
          boxShadow: [
            BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 10, offset: const Offset(0, 4)),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              height: 74,
              width: double.infinity,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [accent.withValues(alpha: 0.18), accent.withValues(alpha: 0.06)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: const BorderRadius.vertical(top: Radius.circular(15)),
              ),
              child: Icon(icon, color: accent, size: 30),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: palette.onSurface)),
                  if (meta.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(meta, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 10.5, color: palette.onSurfaceMuted)),
                  ],
                  if (hasEta) ...[
                    const SizedBox(height: 8),
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Row(
                        children: [
                          Icon(Icons.schedule_rounded, color: palette.onSurfaceMuted, size: 13),
                          const SizedBox(width: 2),
                          Text(eta!, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: palette.onSurfaceMuted)),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ActivityRow extends StatelessWidget {
  const _ActivityRow({required this.icon, required this.accent, required this.title, required this.meta, required this.amount});

  final IconData icon;
  final Color accent;
  final String title;
  final String meta;
  final String amount;

  @override
  Widget build(BuildContext context) {
    final palette = NabinPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(color: accent.withValues(alpha: 0.12), shape: BoxShape.circle),
            child: Icon(icon, color: accent, size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: palette.onSurface)),
                const SizedBox(height: 1),
                Text(meta, style: TextStyle(fontSize: 11, color: palette.onSurfaceMuted)),
              ],
            ),
          ),
          Text(amount, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: palette.onSurface)),
        ],
      ),
    );
  }
}

/// A row of `GET /api/customer/activity`, which is the only place Home is
/// allowed to learn what this customer has ordered. Same projection the Activity
/// screen makes from that payload: no amount, status or timestamp the endpoint
/// did not return.
class _HomeActivity {
  const _HomeActivity({
    required this.service,
    required this.title,
    required this.amount,
    required this.placedAt,
    required this.active,
  });

  final String service;
  final String title;
  final double amount;
  final DateTime? placedAt;
  final bool active;

  static _HomeActivity? fromJson(Map<String, dynamic> json) {
    // The id is what makes a row addressable upstream; a row without one cannot
    // be trusted to belong to this customer, so it is dropped rather than drawn.
    final id = json['id'] as String?;
    if (id == null || id.isEmpty) return null;
    final rawAmount = json['amount'];
    final rawPlacedAt = json['placedAt'];
    return _HomeActivity(
      service: (json['service'] as String?) ?? 'RIDE',
      title: (json['title'] as String?) ?? 'Activity',
      amount: rawAmount is num ? rawAmount.toDouble() : double.tryParse('$rawAmount') ?? 0,
      placedAt: rawPlacedAt == null ? null : DateTime.tryParse('$rawPlacedAt')?.toLocal(),
      active: json['active'] == true,
    );
  }

  String get amountLabel => '₹${amount.toStringAsFixed(2)}';

  /// A missing `placedAt` is admitted as missing. Home has no clock that knows
  /// when the order happened, so it must not draw a plausible one.
  String get whenLabel {
    final at = placedAt;
    if (at == null) return 'Time unrecorded';
    final now = DateTime.now();
    final sameDay = at.year == now.year && at.month == now.month && at.day == now.day;
    final yesterday = now.difference(at).inDays == 1;
    final prefix = sameDay ? 'Today' : (yesterday ? 'Yesterday' : '${at.day}/${at.month}/${at.year}');
    final hh = at.hour.toString().padLeft(2, '0');
    final mm = at.minute.toString().padLeft(2, '0');
    return '$prefix, $hh:$mm';
  }

  IconData get icon => switch (service) {
        'FOOD' => Icons.restaurant_rounded,
        'INSTAMART' => Icons.shopping_basket_rounded,
        'PARCEL' => Icons.inventory_2_rounded,
        _ => Icons.electric_rickshaw_rounded,
      };
}

/// One card in a discovery rail, reduced to what the endpoint actually returned.
/// [eta] exists only for restaurants — a grocery product row carries no window,
/// and neither rail carries a rating the backend can back.
class _RailPlace {
  const _RailPlace({
    required this.name,
    required this.icon,
    this.area,
    this.tag,
    this.eta,
  });

  final String name;
  final IconData icon;
  final String? area;
  final String? tag;
  final String? eta;
}

/// Home lists three places per rail, matching the three activity rows. The
/// backend has no ranked or nearby list to go deeper than that.
const int _railLimit = 3;

const List<IconData> _restaurantIcons = <IconData>[
  Icons.restaurant_rounded,
  Icons.local_dining_rounded,
  Icons.dinner_dining_rounded,
];

const List<IconData> _groceryIcons = <IconData>[
  Icons.local_grocery_store_rounded,
  Icons.storefront_rounded,
  Icons.shopping_bag_rounded,
];

/// `GET /api/restaurants`, as cards. Null means the read was refused and an empty
/// list means the backend has no restaurant listed yet — Home shows a
/// different sentence for each, so the two never blur into one another.
Future<List<_RailPlace>?> _loadRestaurantPlaces() async {
  final res = await NabinApiService.getRestaurants();
  if (res == null || res['success'] != true) return null;
  final rows = ((res['restaurants'] as List?) ?? const <dynamic>[])
      .whereType<Map<dynamic, dynamic>>()
      .map((e) => FoodRestaurant.fromJson(Map<String, dynamic>.from(e)))
      .where((e) => e.id.isNotEmpty)
      .take(_railLimit)
      .toList(growable: false);
  return <_RailPlace>[
    for (final (index, row) in rows.indexed)
      _RailPlace(
        name: row.name,
        icon: _restaurantIcons[index % _restaurantIcons.length],
        area: row.address,
        tag: row.cuisines.isEmpty ? null : row.cuisines.take(2).join(' • '),
        eta: row.etaLabel,
      ),
  ];
}

/// Store names derived from `GET /api/grocery/products`, which lists products and
/// carries no store endpoint of its own. `merchantName` is the only store
/// identity a product row has, so Home collapses the rows to distinct names in
/// the order the backend sent them and tags each with its first real category.
Future<List<_RailPlace>?> _loadGroceryPlaces() async {
  final res = await NabinApiService.getGroceryProducts();
  if (res == null || res['success'] != true) return null;
  final products = ((res['products'] as List?) ?? const <dynamic>[])
      .whereType<Map<dynamic, dynamic>>()
      .map((e) => GroceryProduct.fromApi(Map<String, dynamic>.from(e)))
      .where((e) => e.id.isNotEmpty);

  final stores = <String, String?>{};
  for (final product in products) {
    final name = product.merchantName;
    if (name == null || stores.containsKey(name)) continue;
    stores[name] = product.category;
  }

  return <_RailPlace>[
    for (final (index, entry) in stores.entries.take(_railLimit).indexed)
      _RailPlace(
        name: entry.key,
        icon: _groceryIcons[index % _groceryIcons.length],
        tag: entry.value,
      ),
  ];
}

/// A horizontally scrolling rail of places backed by one real read. Both of
/// Home's discovery rails are this widget: they differ only in the endpoint they
/// call and the copy each state shows. The rail opens its service's own surface
/// rather than a per-place route, because no endpoint behind Home resolves a
/// single restaurant or store page from these rows.
class _DiscoveryRail extends StatefulWidget {
  const _DiscoveryRail({
    required this.title,
    required this.accent,
    required this.route,
    required this.load,
    required this.emptyMessage,
    required this.failedMessage,
  });

  final String title;
  final Color accent;
  final String route;
  final Future<List<_RailPlace>?> Function() load;
  final String emptyMessage;
  final String failedMessage;

  @override
  State<_DiscoveryRail> createState() => _DiscoveryRailState();
}

class _DiscoveryRailState extends State<_DiscoveryRail> {
  List<_RailPlace> _places = const <_RailPlace>[];
  bool _loading = true;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _failed = false;
    });
    final List<_RailPlace>? places = await widget.load();
    if (!mounted) return;
    setState(() {
      _failed = places == null;
      _places = places ?? const <_RailPlace>[];
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SectionHeader(
          title: widget.title,
          action: 'See all',
          onAction: () => context.push(widget.route),
        ),
        const SizedBox(height: 12),
        if (_loading)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 26),
            child: Center(child: CircularProgressIndicator(strokeWidth: 2.4)),
          )
        else if (_failed)
          _RailNotice(message: widget.failedMessage, onRetry: _reload)
        else if (_places.isEmpty)
          _RailNotice(message: widget.emptyMessage)
        else
          SizedBox(
            height: 168,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              itemCount: _places.length,
              itemBuilder: (context, index) {
                final place = _places[index];
                return _PlaceCard(
                  name: place.name,
                  area: place.area,
                  tag: place.tag,
                  eta: place.eta,
                  accent: widget.accent,
                  icon: place.icon,
                  onTap: () => context.push(widget.route),
                );
              },
            ),
          ),
      ],
    );
  }
}

/// What a rail says when it has no cards. A dead read also gets the retry, so an
/// outage never reads as a quiet street — and an empty list never shows a button
/// for a read that succeeded.
class _RailNotice extends StatelessWidget {
  const _RailNotice({required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final palette = NabinPalette.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
      decoration: BoxDecoration(
        color: palette.surfaceMuted,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(message, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: palette.onSurface)),
          if (onRetry != null)
            TextButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded, size: 18),
              label: const Text('Retry'),
            ),
        ],
      ),
    );
  }
}

/// The continue-your-trip banner. It used to be a `const` card asserting an
/// ongoing trip to every customer who opened the app, naming a destination no
/// booking had chosen. It now appears only for a job the server itself marks
/// `active`, and only for the ride that `/active-ride` can actually show. The
/// banner states no progress, ETA or fare: live trip state belongs to that
/// screen, which is driven by the ride socket.
class _ActiveTripCard extends StatelessWidget {
  const _ActiveTripCard({required this.activity});

  final List<_HomeActivity> activity;

  @override
  Widget build(BuildContext context) {
    final palette = NabinPalette.of(context);
    _HomeActivity? trip;
    for (final item in activity) {
      if (item.active && item.service == 'RIDE') {
        trip = item;
        break;
      }
    }
    if (trip == null) return const SizedBox.shrink();

    return GestureDetector(
      onTap: () => context.push('/active-ride'),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: palette.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: palette.brand.withValues(alpha: 0.25)),
          boxShadow: [
            BoxShadow(color: palette.brand.withValues(alpha: 0.06), blurRadius: 10, offset: const Offset(0, 3)),
          ],
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(9),
              decoration: BoxDecoration(color: palette.brandTint, shape: BoxShape.circle),
              child: Icon(trip.icon, color: palette.brand, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Ongoing trip', style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w900, letterSpacing: 0.5, color: palette.brand)),
                  const SizedBox(height: 2),
                  Text(trip.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13.5, color: palette.onSurface)),
                  const SizedBox(height: 2),
                  Text('Tap to view live trip status', style: TextStyle(fontSize: 11, color: palette.onSurfaceMuted)),
                ],
              ),
            ),
            const SizedBox(width: 8),
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
    );
  }
}

/// Home's three most recent orders, in the order the server sent them. No
/// client-side sort: Dart's sort is not stable and `GET /customer/activity`
/// already returns newest-first, which is the same contract the Activity screen
/// relies on. Each row is the server's own title, service, timestamp and amount.
class _RecentActivity extends StatelessWidget {
  const _RecentActivity({
    required this.loading,
    required this.failed,
    required this.items,
    required this.onRetry,
  });

  final bool loading;
  final bool failed;
  final List<_HomeActivity> items;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final palette = NabinPalette.of(context);
    final shown = items.take(3).toList(growable: false);

    Color accentOf(String service) => switch (service) {
          'FOOD' => palette.foodAccent,
          'INSTAMART' => palette.groceryAccent,
          'PARCEL' => palette.parcelAccent,
          _ => palette.rideAccent,
        };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SectionHeader(
          title: 'Recent activity',
          action: 'See all',
          onAction: () => context.push('/activity'),
        ),
        const SizedBox(height: 10),
        if (loading)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(child: CircularProgressIndicator(strokeWidth: 2.4)),
          )
        else if (failed)
          _RailNotice(message: "Couldn't load your activity.", onRetry: onRetry)
        else if (shown.isEmpty)
          const _RailNotice(message: 'No orders yet.')
        else
          Container(
            decoration: BoxDecoration(
              color: palette.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: palette.divider),
            ),
            child: Column(
              children: [
                for (final (index, item) in shown.indexed) ...[
                  if (index > 0) Divider(height: 1, thickness: 1, color: palette.divider),
                  _ActivityRow(
                    icon: item.icon,
                    accent: accentOf(item.service),
                    title: item.title,
                    meta: '${item.service.toLowerCase()} • ${item.whenLabel}',
                    amount: item.amountLabel,
                  ),
                ],
              ],
            ),
          ),
      ],
    );
  }
}

/// One of the customer's own saved places, as a Home chip and a picker row.
/// Every field traces to a `/api/children` or `/api/schools` column, and [open]
/// hands the ride screen the id of that row — the chip that names a place has to
/// book from it, or it is decoration wearing an address.
class _SavedPlace {
  const _SavedPlace({
    required this.kind,
    required this.short,
    required this.title,
    required this.caption,
    required this.open,
  });

  final String kind;
  final String short;
  final String title;
  final String caption;
  final void Function(BuildContext context) open;
}
