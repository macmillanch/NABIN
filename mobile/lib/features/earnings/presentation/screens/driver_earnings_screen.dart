import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/theme/driver_theme.dart';
import '../../../../core/widgets/driver_button.dart';
import '../../../../core/widgets/driver_card.dart';

/// Earnings and settlements for the signed-in partner.
///
/// Every figure on this screen used to be a literal: `₹1,420.00` as the balance, a UPI
/// address (`rajesh.driver@okhdfcbank`) that does not exist in the database, a
/// "NABIN Platform Fee (10%)" row when the platform's own settlement rule is 15%, three
/// invented trips, and a payout button that showed a congratulatory snack bar without
/// moving any money. A partner reading it was being told a number the platform had never
/// computed, and pressing the button confirmed a withdrawal that never happened.
///
/// It now renders `GET /api/driver/earnings`, which totals durable `jobs` rows and derives
/// the partner's identity from the bearer token. The two failure states are kept apart on
/// purpose: "you have completed no trips" and "NABIN could not read the ledger" are
/// different sentences, and the backend answers the second with a 503 rather than zeroes —
/// a driver asking what they are owed must never be answered `₹0.00` because a database
/// did not reply.
class DriverEarningsScreen extends StatefulWidget {
  const DriverEarningsScreen({super.key});

  @override
  State<DriverEarningsScreen> createState() => _DriverEarningsScreenState();
}

/// One rolling window as the platform computed it.
class _Window {
  const _Window({required this.trips, required this.gross, required this.fees, required this.net});

  final int trips;
  final double gross;
  final double fees;
  final double net;

  static const empty = _Window(trips: 0, gross: 0, fees: 0, net: 0);

  static _Window fromJson(dynamic json) {
    if (json is! Map) return empty;
    num read(String key) {
      final raw = json[key];
      return raw is num ? raw : num.tryParse('$raw') ?? 0;
    }

    return _Window(
      trips: read('trips').toInt(),
      gross: read('grossFares').toDouble(),
      fees: read('platformFees').toDouble(),
      net: read('netEarnings').toDouble(),
    );
  }

  String get grossLabel => '₹${gross.toStringAsFixed(2)}';

  String get netLabel => '₹${net.toStringAsFixed(2)}';
}

/// A settled trip, as the platform stored it.
class _Trip {
  const _Trip({
    required this.reference,
    required this.serviceType,
    required this.gross,
    required this.earnings,
    required this.commission,
    required this.settledAt,
  });

  final String reference;
  final String serviceType;
  final double gross;
  final double earnings;
  final double commission;
  final DateTime? settledAt;

  static _Trip? fromJson(Map<String, dynamic> json) {
    final reference = (json['jobNumber'] as String?) ?? (json['id'] as String?);
    if (reference == null) return null;
    num read(String key) {
      final raw = json[key];
      return raw is num ? raw : num.tryParse('$raw') ?? 0;
    }

    final rawAt = json['settledAt'] as String?;
    return _Trip(
      reference: reference,
      serviceType: (json['serviceType'] as String?) ?? 'RIDE',
      gross: read('grossFare').toDouble(),
      earnings: read('driverEarnings').toDouble(),
      commission: read('platformCommission').toDouble(),
      settledAt: rawAt == null ? null : DateTime.tryParse(rawAt)?.toLocal(),
    );
  }

  String get title => switch (serviceType) {
        'RIDE' => 'Passenger Ride',
        'FOOD' => 'Food Delivery',
        'INSTAMART' => 'Instamart Delivery',
        'GROCERY' => 'Grocery Delivery',
        'PARCEL' => 'Parcel Delivery',
        _ => serviceType,
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
        'INSTAMART' => DriverTheme.rewardGold,
        'GROCERY' => DriverTheme.rewardGold,
        'PARCEL' => DriverTheme.parcelBadge,
        _ => DriverTheme.rideBadge,
      };

  String get whenLabel {
    final at = settledAt;
    if (at == null) return 'Settlement time unavailable';
    final now = DateTime.now();
    final sameDay = at.year == now.year && at.month == now.month && at.day == now.day;
    final yesterday = now.difference(at).inDays == 1;
    final prefix = sameDay ? 'Today' : (yesterday ? 'Yesterday' : '${at.day}/${at.month}/${at.year}');
    final hh = at.hour.toString().padLeft(2, '0');
    final mm = at.minute.toString().padLeft(2, '0');
    return '$prefix, $hh:$mm · $reference';
  }
}

class _Earnings {
  const _Earnings({
    required this.walletBalance,
    required this.source,
    required this.day,
    required this.week,
    required this.month,
    required this.trips,
    required this.payoutDestination,
    required this.destinationVerified,
    required this.pendingDestination,
    required this.coolingUntil,
    required this.kycStatus,
    required this.cashCollected,
  });

  final double walletBalance;
  final String source;
  final _Window day;
  final _Window week;
  final _Window month;
  final List<_Trip> trips;
  final String? payoutDestination;
  final bool destinationVerified;
  final String? pendingDestination;
  final DateTime? coolingUntil;
  final String? kycStatus;

  /// `null` means the platform does not know how the money was collected. Rendering that as
  /// `₹0.00` would be a claim that nothing was collected in cash, which is not what the
  /// ledger says — it says the ledger has no collection record yet.
  final double? cashCollected;

  static _Earnings? fromJson(Map<String, dynamic> json) {
    if (json['success'] != true) return null;
    final rawWallet = json['walletBalance'];
    final wallet = rawWallet is num ? rawWallet.toDouble() : double.tryParse('$rawWallet');
    // An absent balance is not a zero balance.
    if (wallet == null) return null;

    final windows = json['windows'] is Map ? json['windows'] as Map : const {};
    final rawTrips = (json['recentTrips'] as List?) ?? const [];
    final rawPayout = json['payout'] is Map ? json['payout'] as Map : const {};
    final rawCooling = rawPayout['destinationCoolingUntil'];

    return _Earnings(
      walletBalance: wallet,
      source: (json['source'] as String?) ?? 'unknown',
      day: _Window.fromJson(windows['last24h']),
      week: _Window.fromJson(windows['last7d']),
      month: _Window.fromJson(windows['last30d']),
      trips: rawTrips
          .whereType<Map<String, dynamic>>()
          .map(_Trip.fromJson)
          .whereType<_Trip>()
          .toList(),
      payoutDestination: rawPayout['destination'] as String?,
      destinationVerified: rawPayout['destinationVerified'] == true,
      pendingDestination: rawPayout['pendingDestination'] as String?,
      coolingUntil: rawCooling is String ? DateTime.tryParse(rawCooling) : null,
      kycStatus: rawPayout['kycStatus'] as String?,
      cashCollected: () {
        final raw = json['cashCollectedToday'];
        return raw is num ? raw.toDouble() : double.tryParse('$raw');
      }(),
    );
  }

  /// Why a withdrawal is not currently possible, or null when it is.
  ///
  /// The backend enforces every one of these; this only exists so the button can explain
  /// itself instead of letting the partner discover the rule by being refused.
  String? get withdrawalBlocker {
    if (kycStatus != null && kycStatus != 'VERIFIED') {
      return 'ID verification is $kycStatus. Complete KYC to withdraw.';
    }
    if (!destinationVerified || payoutDestination == null) {
      final pending = pendingDestination;
      return pending == null
          ? 'Add and verify a UPI address to withdraw.'
          : 'Verification pending for $pending.';
    }
    final cooling = coolingUntil;
    if (cooling != null && cooling.isAfter(DateTime.now())) {
      return 'New payout address is locked until ${cooling.day}/${cooling.month}/${cooling.year}.';
    }
    if (walletBalance <= 0) return 'There is nothing to withdraw yet.';
    return null;
  }
}

enum _LedgerState { loading, ready, failed }

class _DriverEarningsScreenState extends State<DriverEarningsScreen> {
  int _periodIndex = 0; // 0: Daily, 1: Weekly, 2: Monthly
  _LedgerState _state = _LedgerState.loading;
  _Earnings? _data;
  String? _failureMessage;
  bool _isWithdrawing = false;

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    setState(() => _state = _LedgerState.loading);
    final payload = await NabinApiService.getMyEarnings();
    if (!mounted) return;
    final parsed = payload == null ? null : _Earnings.fromJson(payload);
    if (parsed == null) {
      // Includes a 503 from the ledger and a 401 from an expired session. Neither may be
      // drawn as an empty earning, because both would read as "you earned nothing".
      final code = payload?['code'];
      final blocked = payload != null && (code == 'STORE_UNAVAILABLE' || payload['statusCode'] == 503);
      setState(() {
        _state = _LedgerState.failed;
        _data = null;
        _failureMessage = blocked
            ? 'NABIN could not read the settlement ledger just now. Your earnings are safe — try again in a moment.'
            : (payload?['error'] as String?) ?? 'Could not load your earnings. Check your connection and try again.';
      });
      return;
    }
    setState(() {
      _data = parsed;
      _state = _LedgerState.ready;
      _failureMessage = null;
    });
  }

  _Window get _selected {
    final data = _data;
    if (data == null) return _Window.empty;
    switch (_periodIndex) {
      case 1:
        return data.week;
      case 2:
        return data.month;
      default:
        return data.day;
    }
  }

  Future<void> _withdraw() async {
    final data = _data;
    if (data == null || data.withdrawalBlocker != null) return;
    setState(() => _isWithdrawing = true);
    final res = await NabinApiService.requestDriverPayout(amount: data.walletBalance);
    if (!mounted) return;
    setState(() => _isWithdrawing = false);

    final ok = res != null && res['success'] == true;
    // The amount, the destination and the balance are all decided server-side, so this
    // message repeats the platform's answer rather than the client's expectation of it.
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(ok
            ? 'Payout of ₹${data.walletBalance.toStringAsFixed(2)} sent to ${data.payoutDestination}.'
            : res?['error'] as String? ?? 'NABIN declined the payout. Please try again.'),
        backgroundColor: ok ? DriverTheme.onlineGreen : Colors.red.shade700,
      ),
    );
    if (ok) await _fetch();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DriverTheme.bgLight,
      appBar: AppBar(
        title: const Text('Earnings & Settlements'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/home'),
        ),
        actions: [
          IconButton(
            onPressed: _state == _LedgerState.loading ? null : _fetch,
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: SafeArea(
        child: switch (_state) {
          _LedgerState.loading => const Center(child: CircularProgressIndicator()),
          _LedgerState.failed => _buildFailed(),
          _LedgerState.ready => _buildLedger(),
        },
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
            const Text('Could not load your earnings',
                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: DriverTheme.textDark)),
            const SizedBox(height: 6),
            Text(
              _failureMessage ?? 'Nothing about your money has changed.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: DriverTheme.textMuted, fontSize: 13),
            ),
            const SizedBox(height: 18),
            ElevatedButton.icon(
              onPressed: _fetch,
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

  Widget _buildLedger() {
    final data = _data;
    if (data == null) return const SizedBox.shrink();
    final window = _selected;

    return RefreshIndicator(
      onRefresh: _fetch,
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Period Selector Tabs (Daily / Weekly / Monthly)
            Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: const Color(0xFFE2E8F0),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Row(
                children: [
                  _buildPeriodBtn(0, 'Daily'),
                  _buildPeriodBtn(1, 'Weekly'),
                  _buildPeriodBtn(2, 'Monthly'),
                ],
              ),
            ),
            const SizedBox(height: 18),

            // Main Balance Statement Card
            DriverCard(
              backgroundColor: DriverTheme.primaryBlue,
              borderColor: DriverTheme.primaryBlueDark,
              padding: const EdgeInsets.all(22),
              borderRadius: 24,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('WITHDRAWABLE BALANCE',
                      style: TextStyle(
                          color: DriverTheme.accentCyan,
                          fontSize: 11,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 1.0)),
                  const SizedBox(height: 6),
                  // The wallet is not a period figure: money earned last month is still
                  // withdrawable today, so this stays the balance while the tabs move the
                  // breakdown below it.
                  Text('₹${data.walletBalance.toStringAsFixed(2)}',
                      style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w900, color: Colors.white)),
                  const SizedBox(height: 4),
                  Text(
                    data.payoutDestination == null
                        ? 'No verified payout address yet'
                        : 'Direct Payout via UPI to ${data.payoutDestination}',
                    style: const TextStyle(color: Colors.white70, fontSize: 12),
                  ),
                  const SizedBox(height: 18),
                  Builder(builder: (context) {
                    final blocker = data.withdrawalBlocker;
                    if (blocker == null) {
                      return DriverButton(
                        text: 'Withdraw ₹${data.walletBalance.toStringAsFixed(2)} to UPI',
                        color: DriverTheme.onlineGreen,
                        textColor: Colors.black,
                        height: 48,
                        isLoading: _isWithdrawing,
                        onPressed: _withdraw,
                      );
                    }
                    // No disabled button with a dead handler and no tappable lie: when the
                    // platform will not allow a payout, the card says so in words instead of
                    // presenting a control that cannot work.
                    return Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: Colors.white24),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.lock_outline_rounded, size: 18, color: Colors.white70),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(blocker,
                                style: const TextStyle(color: Colors.white70, fontSize: 12, height: 1.3)),
                          ),
                        ],
                      ),
                    );
                  }),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Earned in the selected period
            Text(
              _periodIndex == 0
                  ? 'Last 24 Hours'
                  : (_periodIndex == 1 ? 'Last 7 Days' : 'Last 30 Days'),
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: DriverTheme.textDark),
            ),
            const SizedBox(height: 10),
            DriverCard(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  _BreakdownRow(
                      title: 'Gross Customer Fares', value: window.grossLabel, isPositive: true),
                  const Divider(color: DriverTheme.borderLight, height: 20),
                  _BreakdownRow(
                      title: 'NABIN Platform Commission',
                      value: '-₹${window.fees.toStringAsFixed(2)}',
                      isPositive: false),
                  const Divider(color: DriverTheme.borderLight, height: 20),
                  _BreakdownRow(
                    title: 'Completed Trips',
                    value: '${window.trips}',
                  ),
                  const Divider(color: DriverTheme.borderLight, height: 20),
                  _BreakdownRow(
                      title: 'Net Driver Earnings', value: window.netLabel, isTotal: true),
                  const Divider(color: DriverTheme.borderLight, height: 20),
                  // `cashCollected` is null until the ledger records collection per trip, so
                  // this row refuses to print a number it was not given.
                  _BreakdownRow(
                    title: 'Cash Collected from Passengers',
                    value: data.cashCollected == null ? 'Not reported yet' : '₹${data.cashCollected!.toStringAsFixed(2)}',
                  ),
                ],
              ),
            ),
            if (data.source != 'postgres') ...[
              const SizedBox(height: 12),
              _NoteCard(
                icon: Icons.storage_rounded,
                text: 'Figures come from NABIN\'s in-memory mirror (source: ${data.source}) because '
                    'the settlement database is not reachable from this server.',
              ),
            ],
            const SizedBox(height: 24),

            // Trip History Ledger
            const Text('Completed Jobs History',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: DriverTheme.textDark)),
            const SizedBox(height: 4),
            const Text('The 10 most recent settled trips in the last 30 days.',
                style: TextStyle(fontSize: 11, color: DriverTheme.textMuted)),
            const SizedBox(height: 10),
            if (data.trips.isEmpty)
              const DriverCard(
                padding: EdgeInsets.all(18),
                child: Row(
                  children: [
                    Icon(Icons.inbox_rounded, color: DriverTheme.textMuted, size: 22),
                    SizedBox(width: 12),
                    Expanded(
                      child: Text('No completed trips in the last 30 days.',
                          style: TextStyle(color: DriverTheme.textMuted, fontSize: 13)),
                    ),
                  ],
                ),
              )
            else
              ...data.trips.map(_buildHistoryItem),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }

  Widget _buildPeriodBtn(int index, String label) {
    final isSelected = _periodIndex == index;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _periodIndex = index),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: isSelected ? Colors.white : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
            boxShadow: isSelected ? const [BoxShadow(color: Colors.black12, blurRadius: 4)] : null,
          ),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                fontWeight: FontWeight.w800,
                fontSize: 13,
                color: isSelected ? DriverTheme.primaryBlue : DriverTheme.textMuted,
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHistoryItem(_Trip trip) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      child: DriverCard(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: trip.tint.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(trip.icon, color: trip.tint, size: 22),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(trip.title,
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: DriverTheme.textDark)),
                  const SizedBox(height: 2),
                  Text(trip.whenLabel,
                      style: const TextStyle(color: DriverTheme.textMuted, fontSize: 11)),
                  const SizedBox(height: 2),
                  // Fare and the partner's own share are different numbers; showing only one
                  // of them is what let the old screen imply a 10% fee that never existed.
                  Text('Fare ₹${trip.gross.toStringAsFixed(2)} · Commission ₹${trip.commission.toStringAsFixed(2)}',
                      style: const TextStyle(color: DriverTheme.textMuted, fontSize: 10)),
                ],
              ),
            ),
            Text('₹${trip.earnings.toStringAsFixed(2)}',
                style: const TextStyle(fontWeight: FontWeight.w900, color: DriverTheme.onlineGreen, fontSize: 16)),
          ],
        ),
      ),
    );
  }
}

class _NoteCard extends StatelessWidget {
  const _NoteCard({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF7E6),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFF2D9A6)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: const Color(0xFF9A6B00)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(text, style: const TextStyle(fontSize: 11, color: Color(0xFF6B4A00), height: 1.35)),
          ),
        ],
      ),
    );
  }
}

class _BreakdownRow extends StatelessWidget {
  final String title;
  final String value;
  final bool isPositive;
  final bool isTotal;

  const _BreakdownRow({
    required this.title,
    required this.value,
    this.isPositive = true,
    this.isTotal = false,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Expanded(
          child: Text(
            title,
            style: TextStyle(
              fontSize: isTotal ? 14 : 13,
              fontWeight: isTotal ? FontWeight.w900 : FontWeight.w600,
              color: isTotal ? DriverTheme.textDark : DriverTheme.textMuted,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Text(
          value,
          style: TextStyle(
            fontSize: isTotal ? 16 : 13,
            fontWeight: isTotal ? FontWeight.w900 : FontWeight.bold,
            color: isTotal
                ? DriverTheme.onlineGreen
                : (isPositive ? DriverTheme.textDark : DriverTheme.alertRed),
          ),
        ),
      ],
    );
  }
}
