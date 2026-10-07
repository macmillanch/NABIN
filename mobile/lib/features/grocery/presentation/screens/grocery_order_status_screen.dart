import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/network/nabin_api_service.dart';
import '../models/grocery_product.dart' show GroceryProduct;
import '../theme/grocery_theme.dart';

/// Tracks one grocery order by reading it back from the platform.
///
/// Checkout already writes a real order row (`POST /api/grocery/checkout/validate` →
/// migration 019's atomic order + lines), and the store's own status writes
/// (`POST /api/merchant/:id/orders/:id/status`) are what move it. Until now the
/// customer's only next step was `/activity`, which lists orders and shows none of
/// them, so a placed order had no status screen of its own.
///
/// This screen polls `GET /api/customer/orders/:id` and renders the `order_state` the
/// row actually holds — one of the nine values migration 018's CHECK constraint
/// allows — and stops polling once the row reaches a state with no outgoing
/// transition. What that read carries is the stage, the lines, the money, the address
/// and the timestamps; it carries no store name, rider, vehicle, phone number, live
/// position or estimated arrival, so this screen prints none of those and names the
/// gap instead of filling it. The vocabulary is the store's, not a kitchen's.
class GroceryOrderStatusScreen extends StatefulWidget {
  /// Only the order id needs to come from checkout; everything else is read back.
  final Map<String, dynamic>? orderData;

  const GroceryOrderStatusScreen({super.key, this.orderData});

  @override
  State<GroceryOrderStatusScreen> createState() => _GroceryOrderStatusScreenState();
}

class _GroceryOrderStatusScreenState extends State<GroceryOrderStatusScreen> {
  static const Duration _pollEvery = Duration(seconds: 15);

  /// The seven states an order can still move through, in the order the
  /// `order_state` CHECK constraint in migration 018 lists them.
  static const List<Map<String, dynamic>> _forwardStates = <Map<String, dynamic>>[
    <String, dynamic>{
      'state': 'RECEIVED',
      'title': 'Order received',
      'copy': 'The store has your order list. It has not accepted it yet.',
      'icon': Icons.receipt_long_rounded,
    },
    <String, dynamic>{
      'state': 'ACCEPTED',
      'title': 'Store accepted',
      'copy': 'The store accepted the order.',
      'icon': Icons.check_circle_outline_rounded,
    },
    <String, dynamic>{
      'state': 'PREPARING',
      'title': 'Picking your items',
      'copy': 'Someone at the store is gathering the items.',
      'icon': Icons.shopping_basket_rounded,
    },
    <String, dynamic>{
      'state': 'PACKING',
      'title': 'Packing your items',
      'copy': 'The items are being packed for the drop.',
      'icon': Icons.inventory_2_rounded,
    },
    <String, dynamic>{
      'state': 'READY_FOR_PICKUP',
      'title': 'Ready for collection',
      'copy': 'Packed and waiting at the counter to be collected.',
      'icon': Icons.storefront_rounded,
    },
    <String, dynamic>{
      'state': 'PICKED_UP',
      'title': 'Left the store',
      'copy': 'The order left the store.',
      'icon': Icons.local_shipping_outlined,
    },
    <String, dynamic>{
      'state': 'DELIVERED',
      'title': 'Delivered',
      'copy': 'Recorded as delivered.',
      'icon': Icons.home_rounded,
    },
  ];

  /// Both titles assert only what `is_valid_order_transition` (migration 018)
  /// guarantees: REJECTED and CANCELLED have no outgoing edge, so the row cannot move
  /// again. Nothing here claims what happened to the money — no transition path writes
  /// a refund, and this read carries no payment state for a stopped order.
  static const Map<String, Map<String, String>> _stoppedStates = <String, Map<String, String>>{
    'REJECTED': <String, String>{
      'title': 'Declined by the store',
      'copy': 'The store declined this order, so it will not move again.',
    },
    'CANCELLED': <String, String>{
      'title': 'Cancelled',
      'copy': 'This order was cancelled and will not move again.',
    },
  };

  /// `is_valid_order_transition` gives these no outgoing edge, so a further read can
  /// only return the same row. The poll stops here instead of asking forever.
  static const Set<String> _terminalStates = <String>{
    'DELIVERED',
    'REJECTED',
    'CANCELLED',
  };

  Map<String, dynamic>? _order;
  bool _loading = true;
  String? _failure;
  DateTime? _lastReadAt;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  String get _orderId {
    final data = widget.orderData;
    final raw = data?['orderId'] ??
        data?['order_id'] ??
        data?['id'] ??
        data?['orderNumber'] ??
        data?['order_number'];
    return raw?.toString().trim() ?? '';
  }

  Future<void> _load({bool silent = false}) async {
    if (_orderId.isEmpty) {
      setState(() {
        _loading = false;
        _failure = null;
      });
      return;
    }
    if (!silent) setState(() => _loading = true);

    final read = await NabinApiService.readCustomerOrder(_orderId);

    if (!mounted) return;
    setState(() {
      _loading = false;
      if (read.ok) {
        _order = read.order;
        _lastReadAt = DateTime.now();
        _failure = null;
        _armPolling(_stateOf(_order!));
      } else if (!silent) {
        _failure = _explain(read);
      }
      // A silent re-read that fails keeps the last row on screen rather than blanking
      // a status the customer was already reading.
    });
  }

  /// A re-read of the same row, never a local guess about what happened next. Once the
  /// row is in a state with no outgoing transition there is nothing left to learn.
  void _armPolling(String state) {
    if (_terminalStates.contains(state)) {
      _poll?.cancel();
      _poll = null;
      return;
    }
    _poll ??= Timer.periodic(_pollEvery, (_) => _load(silent: true));
  }

  /// The status code decides what the customer is told. Four different refusals are
  /// four different facts, and one generic error would send them to retry a signed-out
  /// session or an order number that was never minted.
  String _explain(CustomerOrderRead read) {
    if (read.status == 401) {
      return 'Sign in again to read this order.';
    }
    if (read.status == 403) {
      return 'This order belongs to a different account.';
    }
    if (read.status == 404) {
      return 'NABIN has no grocery order with that number.';
    }
    if (read.status == 200) {
      return 'The order read came back without an order.';
    }
    return "NABIN couldn't load this grocery order right now.";
  }

  static String _stateOf(Map<String, dynamic> order) =>
      (order['order_state'] ?? order['orderState'] ?? '').toString().trim();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: GroceryTheme.bgOffWhite,
      body: SafeArea(bottom: false, child: _buildBody()),
    );
  }

  Widget _buildBody() {
    if (_loading && _order == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_failure != null || _order == null) {
      return _buildUnavailable();
    }

    final order = _order!;
    final state = _stateOf(order);
    final service = (order['service_type'] ?? order['serviceType'] ?? '').toString().trim();
    if (service.isNotEmpty && service != 'GROCERY') {
      return _buildWrongService(order, service);
    }

    return RefreshIndicator(
      color: GroceryTheme.headerBand,
      backgroundColor: GroceryTheme.surfaceWhite,
      onRefresh: () => _load(),
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          _buildStatusBand(state, order),
          _buildStageBanner(state),
          _Constrained(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
              child: Column(
                children: [
                  _buildDeliveryGap(),
                  const SizedBox(height: 14),
                  _buildOrderCard(order),
                  const SizedBox(height: 14),
                  _buildTimeline(state),
                  const SizedBox(height: 20),
                  OutlinedButton(
                    onPressed: () => context.go('/grocery-home'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(double.infinity, 48),
                      side: const BorderSide(color: GroceryTheme.headerBand),
                      foregroundColor: GroceryTheme.headerBand,
                    ),
                    child: const Text('Back to grocery',
                        style: TextStyle(fontWeight: FontWeight.w700)),
                  ),
                  const SizedBox(height: 24),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── States that carry no order ───────────────────────────────────────────────

  Widget _buildUnavailable() {
    final bool noId = _orderId.isEmpty;
    final String message = noId
        ? 'No grocery order to show. Place an order and this screen will follow it.'
        : _failure!;
    return Column(
      children: [
        _buildBandChrome(showRefresh: false),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  noId ? Icons.receipt_long_rounded : Icons.cloud_off_rounded,
                  size: 40,
                  color: GroceryTheme.textMuted,
                ),
                const SizedBox(height: 12),
                Text(
                  message,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                    color: GroceryTheme.textDark,
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Its stage, lines and total come from the order row. Nothing is '
                  'guessed while it cannot be read.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12.5, color: GroceryTheme.textMuted),
                ),
                if (!noId) ...[
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: () => _load(),
                    style: FilledButton.styleFrom(
                      backgroundColor: GroceryTheme.headerBand,
                      foregroundColor: GroceryTheme.onHeader,
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

  /// The grocery screen reads one order row, and that row says which service it
  /// belongs to. A food order on this screen would be narrated in the wrong
  /// vocabulary, so it is named instead.
  Widget _buildWrongService(Map<String, dynamic> order, String service) {
    return Column(
      children: [
        _buildBandChrome(showRefresh: true),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.error_outline_rounded,
                    size: 40, color: GroceryTheme.textMuted),
                const SizedBox(height: 12),
                Text(
                  'That order was placed as a $service order, not a grocery order.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                    color: GroceryTheme.textDark,
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Its number is real, and its stage is the same order-state field this '
                  'screen reads, but the wording here belongs to a grocery basket.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12.5, color: GroceryTheme.textMuted),
                ),
                const SizedBox(height: 6),
                Text(
                  _orderNumber(order),
                  style: const TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.4,
                    color: GroceryTheme.textMuted,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  // ── Status band ──────────────────────────────────────────────────────────────

  Widget _buildStatusBand(String state, Map<String, dynamic> order) {
    final int index = _forwardIndex(state);
    final Map<String, dynamic>? forward = index >= 0 ? _forwardStates[index] : null;
    final Map<String, String>? stopped = _stoppedStates[state];
    final bool isStopped = stopped != null;
    final bool isDelivered = state == 'DELIVERED';
    final Color band = isStopped
        ? GroceryTheme.accentRose
        : (isDelivered ? GroceryTheme.primaryGreenDark : GroceryTheme.headerBand);

    final String pill =
        forward?['title'] as String? ?? stopped?['title'] ?? 'No stage reported';

    return Container(
      width: double.infinity,
      color: band,
      child: Column(
        children: [
          _buildBandChrome(showRefresh: true),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 18),
            child: Column(
              children: [
                Text(
                  _placedLine(order),
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
                  _orderNumber(order),
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

  /// Header chrome: back, the screen's name, support. Deliberately silent about who
  /// is packing the bag, because the order read does not say.
  Widget _buildBandChrome({required bool showRefresh}) {
    return Column(
      children: [
        Row(
          children: [
            IconButton(
              icon: const Icon(Icons.keyboard_arrow_down_rounded,
                  color: Colors.white, size: 26),
              tooltip: 'Back to grocery',
              onPressed: () => context.go('/grocery-home'),
            ),
            const Spacer(),
            IconButton(
              icon: const Icon(Icons.support_agent_rounded, color: Colors.white, size: 22),
              tooltip: 'Contact support',
              onPressed: () => context.push('/support'),
            ),
          ],
        ),
        const Padding(
          padding: EdgeInsets.fromLTRB(16, 0, 16, 2),
          child: Text(
            'Grocery order status',
            style: TextStyle(
              color: Colors.white,
              fontSize: 13.5,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.3,
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
                  'Order status',
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
        'The order row does not carry a stage this app recognises, so nothing is '
            'invented for it.';
    final IconData icon =
        forward == null ? Icons.info_outline_rounded : forward['icon'] as IconData;

    return _Constrained(
      child: Container(
        width: double.infinity,
        color: GroceryTheme.surfaceWhite,
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: GroceryTheme.serviceAccent.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, size: 18, color: GroceryTheme.serviceAccent),
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
                      color: GroceryTheme.textDark,
                      height: 1.35,
                    ),
                  ),
                  if (stopped != null && _previousState().isNotEmpty)
                    Text(
                      'Stopped while it was: ${_previousState()}',
                      style: const TextStyle(
                        fontSize: 11.5,
                        color: GroceryTheme.textMuted,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── What the read does not carry ─────────────────────────────────────────────

  /// A map, a rider's phone number and an arrival time would all need a source. The
  /// order read carries none of them, so this panel names that gap instead of drawing
  /// a route that exists only in the design.
  Widget _buildDeliveryGap() {
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: const BoxDecoration(
                  color: GroceryTheme.surfaceElevated,
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.local_shipping_outlined,
                    size: 20, color: GroceryTheme.textMuted),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Text(
                  'Store, rider and arrival time',
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          const Text(
            'The order read carries the stage, the lines, the money and the address the '
            'order was placed with. It carries no store name, rider, vehicle, phone '
            'number, live position or estimated arrival, so this screen shows none.',
            style: TextStyle(fontSize: 12, height: 1.5, color: GroceryTheme.textMuted),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              const Icon(Icons.schedule_rounded, size: 14, color: GroceryTheme.textMuted),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  'Checked ${_checkedAt()} from the order row',
                  overflow: TextOverflow.ellipsis,
                  maxLines: 1,
                  style: const TextStyle(
                      fontSize: 11.5, color: GroceryTheme.textMuted),
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
    final Map<String, dynamic> meta = order['metadata'] is Map
        ? Map<String, dynamic>.from(order['metadata'] as Map)
        : const <String, dynamic>{};
    final String address = (meta['deliveryAddress'] ?? '').toString().trim();
    final String note = (meta['deliveryInstructions'] ?? '').toString().trim();
    final Map<String, dynamic>? coupon =
        meta['coupon'] is Map ? Map<String, dynamic>.from(meta['coupon'] as Map) : null;

    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Expanded(
                child: Text(
                  'Items on the order',
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                '${lines.length} line${lines.length == 1 ? '' : 's'}',
                style: const TextStyle(
                    fontSize: 11.5, fontWeight: FontWeight.w700, color: GroceryTheme.textMuted),
              ),
            ],
          ),
          const SizedBox(height: 6),
          if (lines.isEmpty)
            const Text(
              'No order lines are in this read, so nothing is listed here.',
              style: TextStyle(fontSize: 12, color: GroceryTheme.textMuted),
            )
          else
            ...lines.whereType<Map>().map(
                  (line) => _buildLineRow(
                      line, (order['currency'] ?? '').toString()),
                ),
          if (coupon != null) ...[
            const Divider(height: 22),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    (coupon['code'] ?? '').toString(),
                    style: const TextStyle(
                        fontSize: 12.5, fontWeight: FontWeight.w700, color: GroceryTheme.textDark),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  '-${_money(coupon['discount'], (order['currency'] ?? '').toString())}',
                  style: const TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: GroceryTheme.serviceAccent),
                ),
              ],
            ),
          ],
          if (address.isNotEmpty) ...[
            const Divider(height: 22),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.location_on_outlined,
                    size: 16, color: GroceryTheme.textMuted),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Deliver to',
                        style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: GroceryTheme.textMuted),
                      ),
                      Text(
                        address,
                        style: const TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                            color: GroceryTheme.textDark),
                      ),
                      if (note.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        const Text(
                          'Note for the store',
                          style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: GroceryTheme.textMuted),
                        ),
                        Text(
                          note,
                          style: const TextStyle(
                              fontSize: 12, color: GroceryTheme.textDark),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ],
          const Divider(height: 22),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Expanded(
                child: Text('Total on the order',
                    style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
              ),
              const SizedBox(width: 8),
              Text(
                _money(order['total_amount'], (order['currency'] ?? '').toString()),
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
              ),
            ],
          ),
          const SizedBox(height: 4),
          const Text(
            'The total is the one the order row stores, not the basket total this '
            'screen last showed.',
            style: TextStyle(fontSize: 11, color: GroceryTheme.textMuted),
          ),
        ],
      ),
    );
  }

  Widget _buildLineRow(Map<dynamic, dynamic> raw, String currency) {
    final line = Map<String, dynamic>.from(raw);
    final String name = (line['product_name_snapshot'] ?? '').toString().trim();
    final num quantity = _asNum(line['quantity']);
    final String unit = (line['unit_snapshot'] ?? '').toString().trim();
    final String unitPrice = _money(line['unit_price_snapshot'], currency);
    final String lineTotal = _money(line['line_total'], currency);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name,
                    style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                Text(
                  unit.isEmpty
                      ? '${_qty(quantity)} × $unitPrice'
                      : '${_qty(quantity)} $unit • $unitPrice each',
                  style: const TextStyle(fontSize: 11, color: GroceryTheme.textMuted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            lineTotal,
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
                    color: GroceryTheme.textMuted,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          const Text(
            'These are written by the store and the delivery team, not simulated here. '
            'Pull down to read the latest.',
            style: TextStyle(fontSize: 11.5, color: GroceryTheme.textMuted),
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
        ? GroceryTheme.headerBand
        : (isDone ? GroceryTheme.primaryGreenDark : GroceryTheme.surfaceWhite);
    final Color badgeIcon = isDone ? Colors.white : GroceryTheme.textMuted;

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
                  color: isDone ? Colors.transparent : GroceryTheme.borderLight,
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
                color: isDone ? GroceryTheme.primaryGreenDark : GroceryTheme.borderLight,
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
                      ? GroceryTheme.headerBand
                      : (isDone ? GroceryTheme.textDark : GroceryTheme.textMuted),
                ),
              ),
              Text(
                subtitle,
                style: const TextStyle(fontSize: 10.5, color: GroceryTheme.textMuted),
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ],
    );
  }

  // ── Shared pieces and derived values ─────────────────────────────────────────

  Widget _card({required Widget child}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: GroceryTheme.surfaceWhite,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: GroceryTheme.borderLight),
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

  String _previousState() {
    final order = _order;
    if (order == null) return '';
    return (order['previous_state'] ?? order['previousState'] ?? '').toString().trim();
  }

  String _orderNumber(Map<String, dynamic> order) {
    final raw = (order['order_number'] ?? order['orderNumber'] ?? _orderId).toString().trim();
    return raw.isEmpty ? 'No order number in this read' : '#$raw';
  }

  String _placedLine(Map<String, dynamic> order) {
    final DateTime? at = _asDate(order['created_at'] ?? order['createdAt']);
    if (at == null) return 'The order row carries no placed time';
    return 'Order placed ${_stamp(at)}';
  }

  String _checkedAt() {
    final at = _lastReadAt;
    return at == null ? 'the order row' : _stamp(at);
  }

  static DateTime? _asDate(Object? raw) {
    if (raw == null) return null;
    if (raw is DateTime) return raw;
    return DateTime.tryParse(raw.toString());
  }

  static String _stamp(DateTime at) {
    final DateTime local = at.toLocal();
    const List<String> months = <String>[
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    final int hour12 = local.hour % 12 == 0 ? 12 : local.hour % 12;
    final String minute = local.minute.toString().padLeft(2, '0');
    final String day = local.day.toString().padLeft(2, '0');
    final String month = months[local.month - 1];
    return '$day $month ${local.year}, $hour12:$minute '
        '${local.hour < 12 ? 'am' : 'pm'}';
  }

  /// The currency is printed the way the row stores it. Rupee amounts use the grocery
  /// app's shared label; anything else keeps its own code rather than a currency sign
  /// this order never carried.
  static String _money(Object? raw, String currency) {
    final double amount = _asNum(raw).toDouble();
    final String trimmed = GroceryProduct.trimAmount(amount);
    if (currency.isEmpty || currency == 'INR') return '₹$trimmed';
    return '$currency $trimmed';
  }

  static num _asNum(Object? raw) {
    if (raw is num) return raw;
    return num.tryParse(raw?.toString() ?? '') ?? 0;
  }

  /// Quantities keep their stored precision: 2 kg reads as `2`, 0.5 kg reads as `0.5`.
  static String _qty(num value) =>
      value == value.roundToDouble() ? value.toStringAsFixed(0) : value.toString();
}

/// The reading column stays bounded on a wide screen instead of stretching one card
/// across the whole canvas; the status band keeps its full width.
class _Constrained extends StatelessWidget {
  const _Constrained({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 620),
        child: child,
      ),
    );
  }
}
