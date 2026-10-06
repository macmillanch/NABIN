import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/theme/app_theme.dart';
import '../providers/food_models.dart' show foodPrice;

/// Tracks one food order by reading it back from the platform.
///
/// The screen used to own the lifecycle: a `Timer` walked a hard-coded stage index
/// forward every 15 seconds through nine invented titles, and it printed an order
/// number, a delivery OTP, a rider name, a phone number, a rating, a distance and an
/// ETA that no request ever supplied. The merchant's own status writes
/// (`POST /api/merchant/:id/orders/:id/status`) are what move an order, so this screen
/// polls `GET /api/customer/orders/:id` and renders whatever `order_state` the row
/// actually holds. Nothing here advances on its own.
///
/// Composition follows the reference order-tracking screen: a full-bleed status band
/// (restaurant, placed-at time, current stage pill, refresh), a single banner line for
/// what is happening now, the map panel, then the bill. Where the reference shows a
/// rider's route, this one states that no customer read carries a position.
class FoodOrderTrackingScreen extends StatefulWidget {
  /// Only the order id needs to come from checkout; everything else is read back.
  final Map<String, dynamic>? orderData;

  const FoodOrderTrackingScreen({super.key, this.orderData});

  @override
  State<FoodOrderTrackingScreen> createState() => _FoodOrderTrackingScreenState();
}

class _FoodOrderTrackingScreenState extends State<FoodOrderTrackingScreen> {
  static const Duration _pollEvery = Duration(seconds: 15);

  /// The seven states an order can still move through, in the order the
  /// `order_state` CHECK constraint in migration 018 allows.
  static const List<Map<String, dynamic>> _forwardStates = <Map<String, dynamic>>[
    <String, dynamic>{
      'state': 'RECEIVED',
      'title': 'Order received',
      'copy': 'The order is with the restaurant. It has not been accepted yet.',
      'icon': Icons.receipt_long_rounded,
    },
    <String, dynamic>{
      'state': 'ACCEPTED',
      'title': 'Order accepted',
      'copy': 'The restaurant accepted the order.',
      'icon': Icons.check_circle_outline_rounded,
    },
    <String, dynamic>{
      'state': 'PREPARING',
      'title': 'Being cooked',
      'copy': 'The kitchen is working on the order.',
      'icon': Icons.soup_kitchen_rounded,
    },
    <String, dynamic>{
      'state': 'PACKING',
      'title': 'Being packed',
      'copy': 'Items are being packed for the drop.',
      'icon': Icons.inventory_2_rounded,
    },
    <String, dynamic>{
      'state': 'READY_FOR_PICKUP',
      'title': 'Ready for pickup',
      'copy': 'Packed and waiting at the counter for a rider.',
      'icon': Icons.storefront_rounded,
    },
    <String, dynamic>{
      'state': 'PICKED_UP',
      'title': 'Collected',
      'copy': 'The order left the restaurant.',
      'icon': Icons.shopping_bag_rounded,
    },
    <String, dynamic>{
      'state': 'DELIVERED',
      'title': 'Delivered',
      'copy': 'Marked delivered.',
      'icon': Icons.home_rounded,
    },
  ];

  /// Both titles assert only what `is_valid_order_transition` (migration 018) guarantees:
  /// REJECTED and CANCELLED have no outgoing edge, so the row cannot move again. Nothing
  /// here claims what happened to the money — no transition path writes a refund, and this
  /// read carries no payment state for a declined order.
  static const Map<String, Map<String, String>> _stoppedStates = <String, Map<String, String>>{
    'REJECTED': <String, String>{
      'title': 'Declined by the restaurant',
      'copy': 'The restaurant declined this order, so it will not move any further.',
    },
    'CANCELLED': <String, String>{
      'title': 'Cancelled',
      'copy': 'This order was cancelled and will not move again.',
    },
  };

  Map<String, dynamic>? _order;
  bool _loading = true;
  bool _failed = false;
  DateTime? _lastReadAt;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _load();
    // A re-read of the same row, never a local guess about what happened next.
    if (_orderId.isNotEmpty) {
      _poll = Timer.periodic(_pollEvery, (_) => _load(silent: true));
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  String get _orderId {
    final data = widget.orderData;
    final raw = data?['orderId'] ?? data?['orderNumber'] ?? data?['id'];
    return raw?.toString() ?? '';
  }

  Future<void> _load({bool silent = false}) async {
    if (_orderId.isEmpty) {
      setState(() {
        _loading = false;
        _failed = false;
      });
      return;
    }
    if (!silent) setState(() => _loading = true);

    final res = await NabinApiService.getCustomerOrder(_orderId);

    if (!mounted) return;
    setState(() {
      _loading = false;
      if (res != null && res['success'] == true && res['order'] is Map) {
        _order = Map<String, dynamic>.from(res['order'] as Map);
        _lastReadAt = DateTime.now();
        _failed = false;
      } else if (!silent) {
        _failed = true;
      }
      // A silent re-read that fails keeps the last row on screen rather than
      // blanking a status the customer was already reading.
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.surface,
      body: SafeArea(
        bottom: false,
        child: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (_loading && _order == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_failed || _order == null) {
      return _buildUnavailable();
    }

    final order = _order!;
    final state = (order['order_state'] ?? order['orderState'] ?? '').toString();

    return RefreshIndicator(
      color: AppTheme.primary,
      backgroundColor: AppTheme.surface,
      onRefresh: () => _load(),
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          _buildStatusBand(state),
          _buildStageBanner(state),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
            child: Column(
              children: [
                _buildPositionPanel(),
                const SizedBox(height: 14),
                _buildOrderCard(order),
                const SizedBox(height: 14),
                _buildTimeline(state),
                const SizedBox(height: 20),
                OutlinedButton(
                  onPressed: () => context.go('/home'),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(double.infinity, 48),
                    side: const BorderSide(color: AppTheme.primary),
                    foregroundColor: AppTheme.primary,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14)),
                  ),
                  child: const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.home_rounded, size: 18),
                      SizedBox(width: 8),
                      Text('Back to NABIN',
                          style: TextStyle(fontWeight: FontWeight.w700)),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildUnavailable() {
    final bool noId = _orderId.isEmpty;
    return Column(
      children: [
        _buildBandChrome(state: '', showRefresh: false),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  noId ? Icons.receipt_long_rounded : Icons.cloud_off_rounded,
                  size: 40,
                  color: AppTheme.onSurfaceVariant,
                ),
                const SizedBox(height: 12),
                Text(
                  noId
                      ? 'No order to track. Place an order and this screen will follow it.'
                      : "NABIN couldn't load this order right now.",
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                    color: AppTheme.onSurface,
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Its stage, timing and total come from the order row. Nothing is '
                  'guessed while it cannot be read.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12.5, color: AppTheme.onSurfaceVariant),
                ),
                if (!noId) ...[
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: () => _load(),
                    style: FilledButton.styleFrom(
                      backgroundColor: AppTheme.primary,
                      foregroundColor: Colors.white,
                    ),
                    child: const Text('Retry'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  // ── Status band ──────────────────────────────────────────────────────────────

  Widget _buildStatusBand(String state) {
    final int index = _forwardIndex(state);
    final Map<String, dynamic>? forward = index >= 0 ? _forwardStates[index] : null;
    final Map<String, String>? stopped = _stoppedStates[state];
    final bool isStopped = stopped != null;
    final bool isDelivered = state == 'DELIVERED';
    final Color band =
        isStopped ? AppTheme.error : (isDelivered ? AppTheme.success : AppTheme.primary);

    final String headline = _placedLine();
    final String pill = forward?['title'] as String? ??
        stopped?['title'] ??
        'No stage reported';

    return Container(
      width: double.infinity,
      color: band,
      child: Column(
        children: [
          _buildBandChrome(state: state, showRefresh: true),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 18),
            child: Column(
              children: [
                Text(
                  headline,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    height: 1.2,
                  ),
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.16),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    pill,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  _orderNumber(_order!),
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.8),
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.4,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Restaurant name (from the menu read that produced the order), back and support.
  Widget _buildBandChrome({required String state, required bool showRefresh}) {
    final restaurant = (widget.orderData?['restaurantName'] ?? '').toString();
    return Column(
      children: [
        Row(
          children: [
            IconButton(
              icon: const Icon(Icons.keyboard_arrow_down_rounded,
                  color: Colors.white, size: 26),
              tooltip: 'Back to Food',
              onPressed: () => context.go('/food-home'),
            ),
            const Spacer(),
            IconButton(
              icon: const Icon(Icons.support_agent_rounded, color: Colors.white, size: 22),
              tooltip: 'Contact support',
              onPressed: () => context.push('/support'),
            ),
          ],
        ),
        if (restaurant.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 2),
            child: Text(
              restaurant,
              textAlign: TextAlign.center,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.92),
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        if (showRefresh)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text(
                  'Live status',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1.1,
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.refresh_rounded, color: Colors.white, size: 20),
                  tooltip: 'Read the order again',
                  onPressed: () => _load(),
                ),
              ],
            ),
          ),
      ],
    );
  }

  // ── Banner line under the band ───────────────────────────────────────────────

  Widget _buildStageBanner(String state) {
    final int index = _forwardIndex(state);
    final Map<String, dynamic>? forward = index >= 0 ? _forwardStates[index] : null;
    final Map<String, String>? stopped = _stoppedStates[state];
    final String copy = forward?['copy'] as String? ??
        stopped?['copy'] ??
        'The order row does not carry a stage this app recognises, so nothing is invented for it.';
    final IconData icon = forward == null
        ? Icons.info_outline_rounded
        : forward['icon'] as IconData;

    return Container(
      width: double.infinity,
      color: AppTheme.surface,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: AppTheme.primary.withValues(alpha: 0.08),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 18, color: AppTheme.primary),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  copy,
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: AppTheme.onSurface,
                    height: 1.35,
                  ),
                ),
                if (stopped != null && _previousState(state).isNotEmpty)
                  Text(
                    'Stopped while it was: ${_previousState(state)}',
                    style: const TextStyle(
                      fontSize: 11.5,
                      color: AppTheme.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── The panel the reference fills with a live route ──────────────────────────

  /// A map needs coordinates. No customer read returns the restaurant's, the drop's or
  /// a rider's, so this panel names that gap instead of drawing a route that exists
  /// only in the design.
  Widget _buildPositionPanel() {    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppTheme.outlineVariant),
      ),
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: const BoxDecoration(
                  color: AppTheme.surfaceCard,
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.delivery_dining_rounded,
                    size: 20, color: AppTheme.onSurfaceVariant),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Text(
                  'Rider and arrival time',
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          const Text(
            'The order read carries the stage, the lines, the money and the address the '
            'order was placed with. It carries no rider name, vehicle, phone number, live '
            'position or estimated arrival, and a food order has no delivery job row this '
            'app can read those from, so this screen shows none.',
            style: TextStyle(fontSize: 12, height: 1.5, color: AppTheme.onSurfaceVariant),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              const Icon(Icons.schedule_rounded, size: 14, color: AppTheme.onSurfaceVariant),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  'Checked ${_checkedAt()} from the order row',
                  overflow: TextOverflow.ellipsis,
                  maxLines: 1,
                  style: const TextStyle(
                      fontSize: 11.5, color: AppTheme.onSurfaceVariant),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ── Bill ─────────────────────────────────────────────────────────────────────

  Widget _buildOrderCard(Map<String, dynamic> order) {
    final List<dynamic> lines = order['lines'] is List
        ? List<dynamic>.from(order['lines'] as List)
        : const <dynamic>[];
    final String address = _deliveryAddress(order);

    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Expanded(
                child: Text(
                  'Order summary',
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5),
                ),
              ),
              const SizedBox(width: 10),
              Text(
                _total(order),
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
              ),
            ],
          ),
          if (address.isNotEmpty) ...[
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.place_outlined, size: 15, color: AppTheme.onSurfaceVariant),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    address,
                    style: const TextStyle(fontSize: 12, color: AppTheme.onSurfaceVariant),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 10),
          const Divider(height: 1),
          const SizedBox(height: 10),
          if (lines.isEmpty)
            const Text(
              'The order lines are not in this read yet.',
              style: TextStyle(fontSize: 12, color: AppTheme.onSurfaceVariant),
            )
          else
            ...lines.map(_buildLineRow),
        ],
      ),
    );
  }

  Widget _buildLineRow(dynamic raw) {
    final line = raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{};
    final String name = (line['product_name_snapshot'] ?? 'Item').toString();
    final String quantity = _quantity(line['quantity']);
    final String unit = (line['unit_snapshot'] ?? '').toString();
    final num unitPrice = _asNumber(line['unit_price_snapshot']);
    final num lineTotal = _asNumber(line['line_total']);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                Text(
                  unit.isEmpty
                      ? '$quantity × ₹${foodPrice(unitPrice)}'
                      : '$quantity $unit • ₹${foodPrice(unitPrice)} each',
                  style: const TextStyle(fontSize: 11, color: AppTheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          Text(
            '₹${foodPrice(lineTotal)}',
            style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }

  // ── Stage list ───────────────────────────────────────────────────────────────

  Widget _buildTimeline(String state) {
    final int current = _forwardIndex(state);
    final bool stopped = _stoppedStates.containsKey(state);

    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Order stages',
                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
              ),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  current >= 0
                      ? 'Step ${current + 1} of ${_forwardStates.length}'
                      : stopped
                          ? 'Closed'
                          : 'No stage reported',
                  textAlign: TextAlign.end,
                  overflow: TextOverflow.ellipsis,
                  maxLines: 1,
                  style: const TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: AppTheme.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          const Text(
            'These are written by the restaurant and the delivery team, not simulated here. Pull down to read the latest.',
            style: TextStyle(fontSize: 11.5, color: AppTheme.onSurfaceVariant),
          ),
          const SizedBox(height: 14),
          ...List.generate(_forwardStates.length, (idx) {
            final stage = _forwardStates[idx];
            return _buildStep(
              idx,
              stage['title'] as String,
              stage['copy'] as String,
              stage['icon'] as IconData,
              current: current,
              isLast: idx == _forwardStates.length - 1,
            );
          }),
        ],
      ),
    );
  }

  Widget _buildStep(
    int idx,
    String title,
    String subtitle,
    IconData icon, {
    required int current,
    bool isLast = false,
  }) {
    final bool isDone = current >= 0 && idx <= current;
    final bool isCurrent = current == idx;

    final Color badge = isCurrent
        ? AppTheme.primary
        : (isDone ? AppTheme.success : AppTheme.surface);
    final Color badgeIcon = isDone ? Colors.white : AppTheme.onSurfaceVariant;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Column(
          children: [
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                color: badge,
                shape: BoxShape.circle,
                border: Border.all(
                  color: isDone ? Colors.transparent : AppTheme.outlineVariant,
                ),
              ),
              child: Icon(
                isDone && !isCurrent ? Icons.check_rounded : icon,
                color: badgeIcon,
                size: 14,
              ),
            ),
            if (!isLast)
              Container(
                width: 2,
                height: 22,
                color: isDone ? AppTheme.success : AppTheme.outlineVariant,
              ),
          ],
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: isCurrent
                      ? FontWeight.w800
                      : (isDone ? FontWeight.w700 : FontWeight.w500),
                  color: isCurrent
                      ? AppTheme.primary
                      : (isDone ? AppTheme.onSurface : AppTheme.onSurfaceVariant),
                ),
              ),
              Text(
                subtitle,
                style: const TextStyle(fontSize: 10.5, color: AppTheme.onSurfaceVariant),
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ],
    );
  }

  // ── Shared pieces and derived values ─────────────────────────────────────────

  Widget _card({required Widget child, Color? borderColor}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceCard,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: borderColor ?? AppTheme.outlineVariant),
      ),
      child: child,
    );
  }

  int _forwardIndex(String state) {
    for (var i = 0; i < _forwardStates.length; i++) {
      if (_forwardStates[i]['state'] == state) return i;
    }
    return -1;
  }

  String _previousState(String state) {
    final order = _order;
    if (order == null) return '';
    final previous = (order['previous_state'] ?? '').toString();
    return previous == state ? '' : previous;
  }

  String _orderNumber(Map<String, dynamic> order) {
    final number = (order['order_number'] ?? order['orderNumber'] ?? '').toString();
    return number.isEmpty ? 'No order number reported' : '#$number';
  }

  String _deliveryAddress(Map<String, dynamic> order) {
    if (order['metadata'] is! Map) return '';
    final meta = Map<String, dynamic>.from(order['metadata'] as Map);
    return (meta['deliveryAddress'] ?? '').toString();
  }

  String _total(Map<String, dynamic> order) {
    final amount = _asNumber(order['total_amount'] ?? order['totalAmount']);
    final currency = (order['currency'] ?? 'INR').toString();
    return currency == 'INR'
        ? '₹${foodPrice(amount)}'
        : '$currency ${amount.toStringAsFixed(2)}';
  }

  num _asNumber(dynamic raw) {
    if (raw is num) return raw;
    return double.tryParse(raw?.toString() ?? '') ?? 0;
  }

  /// `quantity` is NUMERIC(10,3) because grocery units are weights; a food portion is
  /// a whole number, so trim the zero decimals rather than print "2.000".
  String _quantity(dynamic raw) {
    final value = _asNumber(raw);
    if (value == value.roundToDouble() && value < 10000) return value.round().toString();
    return value.toString();
  }

  /// The band's headline is the stored `created_at`, and it drops the time rather than
  /// inventing one when the row's timestamp cannot be read.
  String _placedLine() {
    final clock = _clock(_order?['created_at']);
    return clock.isEmpty ? 'Order placed' : 'Order placed at $clock';
  }

  String _checkedAt() {
    final clock = _clock(_lastReadAt);
    return clock.isEmpty ? '—' : clock;
  }

  String _clock(dynamic raw) {
    final parsed = DateTime.tryParse(raw?.toString() ?? '') ?? (raw is DateTime ? raw : null);
    if (parsed == null) return '';
    final local = parsed.toLocal();
    final hour12 = local.hour % 12 == 0 ? 12 : local.hour % 12;
    final suffix = local.hour < 12 ? 'AM' : 'PM';
    return '$hour12:${local.minute.toString().padLeft(2, '0')} $suffix';
  }
}
