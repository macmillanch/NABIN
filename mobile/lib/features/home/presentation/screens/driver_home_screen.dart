import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/network/nabin_ws_service.dart';
import '../../../../core/network/session_manager.dart';
import '../../../../core/theme/driver_theme.dart';
import '../../../../core/widgets/driver_card.dart';
import '../../../../core/widgets/driver_map_view.dart';

/// One dispatch offer, as the platform put it in front of this partner.
///
/// Every field here came from `GET /api/driver/home`, which joins the offer row to the job
/// behind it. This screen used to have no such thing: three buttons labelled "Ride", "Parcel"
/// and "Food" manufactured an offer in Dart on tap — pickup, drop, distance, a fare, and a
/// customer's name — and pressing ACCEPT JOB walked into a trip the platform had never
/// created. A partner could drive to a passenger who did not exist.
class _Offer {
  const _Offer({
    required this.offerId,
    required this.jobRef,
    required this.serviceType,
    required this.pickup,
    required this.drop,
    required this.fare,
    required this.driverEarnings,
    required this.secondsLeft,
    required this.detailsAvailable,
  });

  final String offerId;
  final String jobRef;
  final String serviceType;
  final String? pickup;
  final String? drop;
  final double? fare;
  final double? driverEarnings;
  final int? secondsLeft;
  final bool detailsAvailable;

  static _Offer? fromJson(Map<String, dynamic> json) {
    final offerId = (json['offerId'] as String?) ?? (json['id'] as String?);
    if (offerId == null) return null;
    num? read(String key) {
      final raw = json[key];
      if (raw is num) return raw;
      if (raw == null) return null;
      return num.tryParse('$raw');
    }

    return _Offer(
      offerId: offerId,
      jobRef: (json['jobId'] as String?) ?? (json['jobUuid'] as String?) ?? offerId,
      serviceType: (json['serviceType'] as String?) ?? 'RIDE',
      pickup: json['pickupAddress'] as String?,
      drop: json['dropAddress'] as String?,
      fare: read('fare')?.toDouble(),
      driverEarnings: read('driverEarnings')?.toDouble(),
      secondsLeft: read('secondsLeft')?.toInt(),
      detailsAvailable: json['detailsAvailable'] == true,
    );
  }

  String get title => switch (serviceType) {
        'FOOD' => 'Food Delivery',
        'INSTAMART' => 'Instamart Delivery',
        'GROCERY' => 'Grocery Delivery',
        'PARCEL' => 'Parcel Delivery',
        _ => 'Passenger Ride',
      };

  IconData get icon => switch (serviceType) {
        'FOOD' => Icons.restaurant_rounded,
        'INSTAMART' => Icons.shopping_basket_rounded,
        'GROCERY' => Icons.local_grocery_store_rounded,
        'PARCEL' => Icons.inventory_2_rounded,
        _ => Icons.electric_rickshaw_rounded,
      };

  Color get tint => switch (serviceType) {
        'FOOD' => DriverTheme.foodBadge,
        'PARCEL' => DriverTheme.parcelBadge,
        _ => DriverTheme.rideBadge,
      };
}

/// The trip this partner is standing on, according to the platform.
class _ActiveJob {
  const _ActiveJob({required this.ref, required this.status, required this.serviceType, required this.drop});

  final String ref;
  final String status;
  final String serviceType;
  final String? drop;

  static _ActiveJob? fromJson(dynamic json) {
    if (json is! Map) return null;
    final ref = (json['jobNumber'] as String?) ?? (json['id'] as String?);
    if (ref == null) return null;
    return _ActiveJob(
      ref: ref,
      status: (json['status'] as String?) ?? '',
      serviceType: (json['serviceType'] as String?) ?? 'RIDE',
      drop: json['dropAddress'] as String?,
    );
  }
}

class _Console {
  const _Console({
    required this.name,
    required this.vehicleLabel,
    required this.isOnline,
    required this.operationalStatus,
    required this.kycStatus,
    required this.walletBalance,
    required this.tripsToday,
    required this.earnedToday,
    required this.offers,
    required this.activeJob,
  });

  final String name;
  final String vehicleLabel;
  final bool isOnline;
  final String? operationalStatus;
  final String? kycStatus;
  final double? walletBalance;
  final int tripsToday;
  final double? earnedToday;
  final List<_Offer> offers;
  final _ActiveJob? activeJob;
}

enum _ConsoleState { loading, ready, failed }

class DriverHomeScreen extends StatefulWidget {
  const DriverHomeScreen({super.key});

  @override
  State<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

class _DriverHomeScreenState extends State<DriverHomeScreen> {
  int _navIndex = 0;

  _ConsoleState _state = _ConsoleState.loading;
  _Console? _console;
  String? _failureMessage;
  bool _isSwitchingAvailability = false;

  /// Offers the partner has already answered, so a late second tap cannot ask twice while
  /// the first request is still in flight. The backend is idempotent regardless; this only
  /// stops the UI offering an action it knows is spent.
  final Set<String> _answeredOffers = <String>{};

  StreamSubscription<Map<String, dynamic>>? _jobFeed;
  StreamSubscription<Map<String, dynamic>>? _authFeed;
  Timer? _refreshTimer;
  bool _lastKnownOnline = false;

  @override
  void initState() {
    super.initState();
    _load();
    _listenForDispatch();
    // An offer is only alive for the dispatch TTL, so a screen left open on a parked phone
    // must not show a queue that has since expired. Polled rather than trusted to the tap.
    _refreshTimer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (mounted && _state == _ConsoleState.ready && !_isSwitchingAvailability) _load(silent: true);
    });
  }

  void _listenForDispatch() {
    final session = SessionManager.instance.currentUser;
    final driverId = session?['id'] as String?;
    final token = SessionManager.instance.token;
    if (driverId != null && token != null) {
      // Reconnect behaviour lives in the shared socket: it is opened here, and the streams
      // below are what make a new offer appear without the partner pulling to refresh.
      unawaited(NabinWsService.instance.connect(role: 'DRIVER', userId: driverId, token: token));
    }
    _jobFeed = NabinWsService.instance.onIncomingJob.listen((_) {
      if (mounted) _load(silent: true);
    });
    _authFeed = NabinWsService.instance.onAuthError.listen((_) {
      // The socket saying "that token is not valid" outranks anything cached on screen.
      if (!mounted) return;
      SessionManager.instance.clearSession();
      context.go('/login');
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _jobFeed?.cancel();
    _authFeed?.cancel();
    NabinWsService.instance.disconnect();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _state = _ConsoleState.loading);
    final home = await NabinApiService.getDriverHome();
    if (!mounted) return;

    if (home == null || home['success'] != true) {
      // A 503 here means the platform could not read dispatch or the assignment, not that
      // the partner has no work. Showing an empty queue would send them home early.
      final offline = home == null;
      final code = home?['code'];
      setState(() {
        _state = _ConsoleState.failed;
        _console = null;
        _failureMessage = offline
            ? 'No connection to NABIN. Your availability on the platform has not changed.'
            : (code == 'STORE_UNAVAILABLE'
                ? 'NABIN could not read your dispatch state just now. Try again in a moment.'
                : (home['error'] as String?) ?? 'Could not load your console.');
      });
      return;
    }

    final driver = (home['driver'] as Map?) ?? const {};
    final offers = ((home['offers'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(_Offer.fromJson)
        .whereType<_Offer>()
        .toList();
    final console = _Console(
      name: (driver['name'] as String?) ?? 'NABIN Partner',
      vehicleLabel: [
        driver['vehicleType'],
        driver['vehicleNumber'],
      ].whereType<String>().where((s) => s.isNotEmpty).join(' • '),
      isOnline: driver['isOnline'] == true,
      operationalStatus: driver['operationalStatus'] as String?,
      kycStatus: driver['kycStatus'] as String?,
      walletBalance: (driver['walletBalance'] as num?)?.toDouble(),
      tripsToday: 0,
      earnedToday: null,
      offers: offers,
      activeJob: _ActiveJob.fromJson(home['activeJob']),
    );
    setState(() {
      _console = console;
      _lastKnownOnline = console.isOnline;
      _state = _ConsoleState.ready;
      _failureMessage = null;
    });

    // Today's money is a separate, durable read. It is fetched after the console is on
    // screen so availability and the queue are never held up behind it, and a failure here
    // leaves the figure unknown rather than zero.
    unawaited(_loadToday());
  }

  Future<void> _loadToday() async {
    final earnings = await NabinApiService.getMyEarnings();
    if (!mounted || earnings == null || earnings['success'] != true) return;
    final day = (earnings['windows'] as Map?)?['last24h'] as Map?;
    final current = _console;
    if (current == null) return;
    setState(() {
      _console = _Console(
        name: current.name,
        vehicleLabel: current.vehicleLabel,
        isOnline: current.isOnline,
        operationalStatus: current.operationalStatus,
        kycStatus: current.kycStatus,
        walletBalance: (earnings['walletBalance'] as num?)?.toDouble() ?? current.walletBalance,
        tripsToday: (day?['trips'] as num?)?.toInt() ?? current.tripsToday,
        earnedToday: (day?['netEarnings'] as num?)?.toDouble(),
        offers: current.offers,
        activeJob: current.activeJob,
      );
    });
  }

  /// The switch is a request, not an assignment.
  ///
  /// The old screen kept `_isOnline` in Dart and drew whatever it liked, so a partner could
  /// be shown ONLINE while the platform had them offline — and a restart erased the
  /// difference entirely. The state on screen now comes back from the server, and a refused
  /// or failed switch restores the last answer the platform actually gave.
  Future<void> _setAvailability(bool wantOnline) async {
    if (_isSwitchingAvailability) return;
    setState(() => _isSwitchingAvailability = true);
    final res = await NabinApiService.setDriverAvailability(isOnline: wantOnline);
    if (!mounted) return;
    setState(() => _isSwitchingAvailability = false);

    final accepted = res != null && res['success'] == true;
    final current = _console;
    if (accepted && current != null) {
      setState(() {
        _console = _Console(
          name: current.name,
          vehicleLabel: current.vehicleLabel,
          isOnline: res['isOnline'] == true,
          operationalStatus: (res['operationalStatus'] as String?) ?? current.operationalStatus,
          kycStatus: current.kycStatus,
          walletBalance: current.walletBalance,
          tripsToday: current.tripsToday,
          earnedToday: current.earnedToday,
          offers: current.offers,
          activeJob: current.activeJob,
        );
        _lastKnownOnline = _console!.isOnline;
      });
      return;
    }

    // Refused or unreachable: put the last server-confirmed state back on screen and say why.
    final reason = res?['error'] as String? ?? 'Could not reach NABIN. Your status on the platform did not change.';
    setState(() {
      if (current != null) {
        _console = _Console(
          name: current.name,
          vehicleLabel: current.vehicleLabel,
          isOnline: _lastKnownOnline,
          operationalStatus: current.operationalStatus,
          kycStatus: current.kycStatus,
          walletBalance: current.walletBalance,
          tripsToday: current.tripsToday,
          earnedToday: current.earnedToday,
          offers: current.offers,
          activeJob: current.activeJob,
        );
      }
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(reason), backgroundColor: Colors.red.shade700),
    );
  }

  Future<void> _accept(_Offer offer) async {
    if (!_answeredOffers.add(offer.offerId)) return;
    final res = await NabinApiService.acceptDriverOffer(
      offerId: offer.offerId,
      // One key per offer: a retry after a dropped connection is the same claim, not a
      // second one.
      idempotencyKey: 'driver_accept_${offer.offerId}',
    );
    if (!mounted) return;

    if (res != null && res['success'] == true) {
      final job = res['job'] is Map ? Map<String, dynamic>.from(res['job'] as Map) : <String, dynamic>{};
      // What the screen shows next must be the platform's answer, so the console is re-read
      // rather than edited to match what the tap expected.
      await _load(silent: true);
      if (!mounted) return;
      context.push('/active-job', extra: {'jobId': offer.jobRef, ...job});
      return;
    }

    _answeredOffers.remove(offer.offerId);
    final code = res?['code'] as String?;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(code == 'JOB_ALREADY_ASSIGNED' || code == 'OFFER_NOT_AVAILABLE'
            ? 'Another partner took this trip. Pull to see what is still yours.'
            : res?['error'] as String? ?? 'Could not accept the trip.'),
        backgroundColor: Colors.red.shade700,
      ),
    );
    await _load(silent: true);
  }

  Future<void> _decline(_Offer offer) async {
    if (!_answeredOffers.add(offer.offerId)) return;
    final res = await NabinApiService.rejectDriverOffer(offerId: offer.offerId, reason: 'DRIVER_DECLINED');
    if (!mounted) return;
    if (res == null || res['success'] != true) {
      _answeredOffers.remove(offer.offerId);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(res?['error'] as String? ?? 'Could not decline the trip.')),
      );
    }
    await _load(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DriverTheme.bgLight,
      body: SafeArea(
        child: switch (_state) {
          _ConsoleState.loading => const Center(child: CircularProgressIndicator()),
          _ConsoleState.failed => _buildFailed(),
          _ConsoleState.ready => _buildConsole(),
        },
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _navIndex,
        onTap: (idx) {
          setState(() => _navIndex = idx);
          if (idx == 1) context.push('/earnings');
          if (idx == 2) context.push('/account');
        },
        backgroundColor: Colors.white,
        selectedItemColor: DriverTheme.primaryBlue,
        unselectedItemColor: DriverTheme.textMuted,
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.map_rounded), label: 'Home Map'),
          BottomNavigationBarItem(icon: Icon(Icons.account_balance_wallet_rounded), label: 'Earnings'),
          BottomNavigationBarItem(icon: Icon(Icons.person_rounded), label: 'Account'),
        ],
      ),
    );
  }

  Widget _buildFailed() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.cloud_off_rounded, size: 54, color: DriverTheme.textMuted),
            const SizedBox(height: 14),
            const Text('Could not load your console',
                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: DriverTheme.textDark)),
            const SizedBox(height: 6),
            Text(_failureMessage ?? 'Nothing about your trips or your money has changed.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: DriverTheme.textMuted, fontSize: 13)),
            const SizedBox(height: 18),
            ElevatedButton.icon(
              onPressed: _load,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Retry'),
              style: ElevatedButton.styleFrom(
                backgroundColor: DriverTheme.primaryBlue,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildConsole() {
    final console = _console;
    if (console == null) return const SizedBox.shrink();

    return RefreshIndicator(
      onRefresh: _load,
      child: Stack(
        children: [
          const Positioned.fill(
            // A schematic backdrop only. It no longer claims to show this partner's position
            // or the other vehicles around them, because the app has no source for either:
            // there is no location provider in this build, so the coordinates it used to draw
            // — and the "nearby drivers" — were invented. See TASKS.md for the GPS gap.
            child: DriverMapView(
              vehicleType: '3W',
              showRoute: false,
              showNearbyDrivers: false,
              animateVehicle: false,
            ),
          ),
          SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Column(
              children: [
                _buildHeader(console),
                const SizedBox(height: 10),
                _buildTodayCard(console),
                const SizedBox(height: 10),
                if (console.activeJob != null) _buildActiveJob(console.activeJob!),
                const SizedBox(height: 10),
                _buildOfferQueue(console),
                const SizedBox(height: 24),
                const Text('Live location is not reported by this build. NABIN shows your last '
                    'position only when the app can read one from the device.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 11, color: DriverTheme.textMuted)),
                const SizedBox(height: 60),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHeader(_Console console) {
    return DriverCard(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      borderRadius: 22,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('NABIN DRIVER',
                    style: TextStyle(
                        fontWeight: FontWeight.w900, fontSize: 14, color: DriverTheme.primaryBlue, letterSpacing: 0.5)),
                Text(console.name,
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: DriverTheme.textDark)),
                if (console.vehicleLabel.isNotEmpty)
                  Text(console.vehicleLabel,
                      style: const TextStyle(fontSize: 11, color: DriverTheme.textMuted)),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Row(
                children: [
                  Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: console.isOnline ? DriverTheme.onlineGreen : DriverTheme.offlineGrey,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    _isSwitchingAvailability ? 'UPDATING…' : (console.isOnline ? 'ONLINE' : 'OFFLINE'),
                    style: TextStyle(
                      fontWeight: FontWeight.w900,
                      fontSize: 12,
                      color: console.isOnline ? DriverTheme.onlineGreen : DriverTheme.offlineGrey,
                    ),
                  ),
                  const SizedBox(width: 4),
                  Switch(
                    value: console.isOnline,
                    activeThumbColor: DriverTheme.onlineGreen,
                    onChanged: _isSwitchingAvailability ? null : (val) => _setAvailability(val),
                  ),
                ],
              ),
              if (console.operationalStatus != null && console.operationalStatus != 'AVAILABLE')
                Text('Status: ${console.operationalStatus}',
                    style: const TextStyle(fontSize: 11, color: DriverTheme.roadGold)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildTodayCard(_Console console) {
    final earned = console.earnedToday;
    return DriverCard(
      padding: const EdgeInsets.all(18),
      borderRadius: 24,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text("TODAY'S EARNINGS",
                  style: TextStyle(
                      fontSize: 10, fontWeight: FontWeight.w800, color: DriverTheme.textMuted, letterSpacing: 0.8)),
              const SizedBox(height: 2),
              // Unknown is shown as unknown. The card used to read ₹1,420.00 permanently.
              Text(earned == null ? '—' : '₹${earned.toStringAsFixed(2)}',
                  style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
            ],
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: BoxDecoration(
              color: const Color(0xFFF1F5F9),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              children: [
                const Icon(Icons.check_circle, color: DriverTheme.onlineGreen, size: 16),
                const SizedBox(width: 6),
                Text('${console.tripsToday} Trips Done',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: DriverTheme.textDark)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActiveJob(_ActiveJob job) {
    return DriverCard(
      onTap: () => context.push('/active-job', extra: {'jobId': job.ref, 'status': job.status}),
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: DriverTheme.warningAmber.withValues(alpha: 0.18),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.navigation_rounded, color: DriverTheme.roadGold, size: 22),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('You are on a trip',
                    style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: DriverTheme.textDark)),
                const SizedBox(height: 2),
                Text('${job.ref} · ${job.status}${job.drop == null ? '' : ' · ${job.drop}'}',
                    style: const TextStyle(fontSize: 12, color: DriverTheme.textMuted)),
              ],
            ),
          ),
          const Icon(Icons.chevron_right, color: DriverTheme.textMuted),
        ],
      ),
    );
  }

  Widget _buildOfferQueue(_Console console) {
    final offers = console.offers.where((o) => !_answeredOffers.contains(o.offerId)).toList();

    return DriverCard(
      padding: const EdgeInsets.all(16),
      borderRadius: 22,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('OFFERS FOR YOU',
                  style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: DriverTheme.textDark)),
              if (!console.isOnline)
                const Text('Go online to receive trips',
                    style: TextStyle(fontSize: 11, color: DriverTheme.roadGold, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 12),
          if (offers.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text('No trips are being offered to you right now. New ones appear here on their own.',
                  style: TextStyle(fontSize: 13, color: DriverTheme.textMuted, height: 1.4)),
            )
          else
            ...offers.map(_buildOfferCard),
        ],
      ),
    );
  }

  Widget _buildOfferCard(_Offer offer) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: offer.tint.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(offer.icon, color: offer.tint, size: 18),
              const SizedBox(width: 8),
              Expanded(
                child: Text(offer.title,
                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: DriverTheme.textDark)),
              ),
              if (offer.secondsLeft != null)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: DriverTheme.warningAmber.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text('${offer.secondsLeft}s',
                      style: const TextStyle(fontWeight: FontWeight.w900, color: DriverTheme.roadGold, fontSize: 12)),
                ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            // Refuses to render an address the platform did not send.
            offer.pickup ?? 'Pickup unavailable',
            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: DriverTheme.textDark),
          ),
          const SizedBox(height: 4),
          Text(offer.drop ?? 'Destination unavailable',
              style: const TextStyle(fontSize: 13, color: DriverTheme.textDark)),
          const SizedBox(height: 10),
          Text(
            offer.driverEarnings == null
                ? 'Earning not shown for this trip'
                : 'You earn ₹${offer.driverEarnings!.toStringAsFixed(2)}'
                    '${offer.fare == null ? '' : '  ·  trip fare ₹${offer.fare!.toStringAsFixed(2)}'}',
            style: const TextStyle(fontWeight: FontWeight.w900, color: DriverTheme.onlineGreen, fontSize: 14)),
          if (!offer.detailsAvailable)
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text('NABIN could not read the trip details for this offer.',
                  style: TextStyle(fontSize: 11, color: DriverTheme.roadGold)),
            ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _decline(offer),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: DriverTheme.borderLight),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  child: const Text('Decline', style: TextStyle(color: DriverTheme.textMuted, fontWeight: FontWeight.bold)),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  onPressed: offer.detailsAvailable ? () => _accept(offer) : null,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: DriverTheme.onlineGreen,
                    foregroundColor: Colors.black,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  child: const Text('ACCEPT TRIP', style: TextStyle(fontWeight: FontWeight.w900)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
