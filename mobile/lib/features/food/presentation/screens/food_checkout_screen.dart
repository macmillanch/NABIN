import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/network/session_manager.dart';
import '../../../../core/theme/restaurant_theme.dart';
import '../providers/food_models.dart' show foodPrice, foodEtaLabel, intOrNull;

class FoodCheckoutScreen extends StatefulWidget {
  final Map<String, dynamic>? cartData;

  const FoodCheckoutScreen({super.key, this.cartData});

  @override
  State<FoodCheckoutScreen> createState() => _FoodCheckoutScreenState();
}

class _FoodCheckoutScreenState extends State<FoodCheckoutScreen> {
  /// The backend defaults a missing delivery address to a Delhi hostel
  /// (`server.js:4146`), so the address is a required, typed value here rather
  /// than one sample address presented as if it belonged to the customer.
  final TextEditingController _addressCtrl = TextEditingController();
  final TextEditingController _instructionCtrl = TextEditingController();
  bool _isPlacingOrder = false;

  // Coupon state. `POST /api/promotions/apply` is the read path and the order RPC
  // redeems the code atomically, so the discount below is the server's number.
  final TextEditingController _couponCtrl = TextEditingController();
  String? _appliedCoupon;
  num _couponDiscount = 0;
  String? _couponError;
  bool _couponApplying = false;

  late final String? _restaurantId;
  late final String? _restaurantName;
  late final int? _deliveryMinutes;
  late List<Map<String, dynamic>> _items;
  late num _itemTotal;
  late num _payable;

  @override
  void initState() {
    super.initState();
    _restaurantId = _readId(widget.cartData?['restaurantId']);
    _restaurantName = widget.cartData?['restaurantName'] as String?;
    _deliveryMinutes = intOrNull(widget.cartData?['deliveryMinutes']);

    final itemsRaw = widget.cartData?['items'] as List<dynamic>?;
    _items = itemsRaw == null
        ? <Map<String, dynamic>>[]
        : itemsRaw
            .whereType<Map<dynamic, dynamic>>()
            .map((e) => Map<String, dynamic>.from(e))
            .where((e) => _quantityOf(e) > 0)
            .toList();
    _recalculateTotals();
  }

  static String? _readId(Object? value) {
    final text = value?.toString().trim();
    return (text == null || text.isEmpty) ? null : text;
  }

  static int _quantityOf(Map<String, dynamic> item) =>
      (item['quantity'] as num? ?? item['qty'] as num?)?.toInt() ?? 0;

  @override
  void dispose() {
    _addressCtrl.dispose();
    _instructionCtrl.dispose();
    _couponCtrl.dispose();
    super.dispose();
  }

  /// The restaurant's own status writes move the order, and its catalog prices
  /// are re-read from the platform when the order is created, so the only total
  /// this screen may state is the basket at menu price minus a server-checked
  /// coupon. Delivery fee, packaging and tax belong to the restaurant's bill.
  void _recalculateTotals() {
    _itemTotal = _items.fold<num>(0, (sum, item) {
      final qty = _quantityOf(item);
      final price = (item['price'] as num?) ?? 0;
      return sum + (qty * price);
    });
    _payable = (_itemTotal - _couponDiscount).clamp(0, 99999);
  }

  String get _deliveryAddress => _addressCtrl.text.trim();

  bool get _canOrder =>
      _items.isNotEmpty && _restaurantId != null && _deliveryAddress.isNotEmpty;

  /// `POST /api/promotions/apply` — the same read the grocery basket uses. The
  /// reply carries the code's name and its discount; a refusal is shown as the
  /// server's own reason instead of a locally invented one.
  Future<void> _applyCoupon() async {
    final String code = _couponCtrl.text.trim().toUpperCase();
    if (code.isEmpty) {
      setState(() => _couponError = 'Enter a coupon code first.');
      return;
    }
    if (_itemTotal <= 0) {
      setState(() => _couponError = 'Add dishes to the basket before applying a code.');
      return;
    }

    setState(() {
      _couponError = null;
      _couponApplying = true;
    });

    Map<String, dynamic>? data;
    try {
      data = await NabinApiService.applyPromoCoupon(
        code: code,
        orderAmount: _itemTotal.toDouble(),
        service: 'FOOD',
      );
    } catch (_) {
      data = null;
    }

    if (!mounted) return;

    final Map<String, dynamic>? applied =
        (data != null && data['success'] == true) ? data : null;

    setState(() {
      _couponApplying = false;
      if (applied == null) {
        _appliedCoupon = null;
        _couponDiscount = 0;
        _couponError = data?['error']?.toString() ??
            'That code could not be checked right now. Try again.';
      } else {
        final num discount = (data!['discount'] as num?) ?? 0;
        _appliedCoupon = (applied['code'] ?? code).toString();
        _couponDiscount =
            discount > _itemTotal ? _itemTotal : discount;
      }
    });
    if (applied != null) _recalculateTotals();
  }

  void _removeCoupon() {
    setState(() {
      _appliedCoupon = null;
      _couponDiscount = 0;
      _couponError = null;
      _couponCtrl.clear();
    });
    _recalculateTotals();
  }

  Future<void> _placeOrder() async {
    final restaurantId = _restaurantId;
    final address = _deliveryAddress;
    if (restaurantId == null || _items.isEmpty || address.isEmpty) return;

    setState(() => _isPlacingOrder = true);

    final user = SessionManager.instance.currentUser;
    final String? customerId = user?['id']?.toString().trim();
    final String? customerName = user?['name']?.toString().trim();
    final String? customerPhone = user?['phone']?.toString().trim();

    final payload = <String, dynamic>{
      // Only identity values the session actually holds. The backend derives the
      // customer from the auth token; a made-up stand-in id would be a false claim.
      if (customerId != null && customerId.isNotEmpty) 'customerId': customerId,
      if (customerName != null && customerName.isNotEmpty) 'customerName': customerName,
      if (customerPhone != null && customerPhone.isNotEmpty) 'customerPhone': customerPhone,
      'restaurantId': restaurantId,
      'deliveryAddress': address,
      // Real dish ids, names and quantities from the restaurant's own menu rows.
      'items': _items
          .map((item) => <String, dynamic>{
                'id': item['id'],
                'name': item['name'],
                'quantity': _quantityOf(item),
                'price': item['price'],
              })
          .toList(),
      // The code, never the amount: `redeem_promotion_atomic` decides the discount
      // against the prices it re-reads from the platform.
      if (_appliedCoupon != null) 'couponCode': _appliedCoupon,
      'instructions': _instructionCtrl.text.trim(),
    };

    final res = await NabinApiService.bookFood(payload);

    if (!mounted) return;
    setState(() => _isPlacingOrder = false);

    if (res != null && res['success'] == true) {
      final job = res['job'] ?? res['order'] ?? {};
      // Only the id crosses. The stage, lines and total are read back from the order
      // row by the tracking screen, so nothing here can hand off a claim the backend
      // never made — the food order never carries an OTP or a rider.
      context.pushReplacement('/food-tracking', extra: {
        'orderId': job['id'] ?? job['order_id'] ?? job['orderNumber'],
        'restaurantName': _restaurantName,
      });
    } else {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(res?['error'] ?? 'Booking failed')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: RestaurantTheme.lightBg,
      appBar: AppBar(
        backgroundColor: RestaurantTheme.headerBand,
        elevation: 0,
        title: const Text('Checkout & Payment',
            style: TextStyle(
                fontWeight: FontWeight.w900,
                fontSize: 16,
                color: Colors.white)),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded,
              color: Colors.white, size: 18),
          onPressed: () => context.pop(),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Delivery Location Card
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: RestaurantTheme.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: RestaurantTheme.border),
                  boxShadow: [
                    BoxShadow(
                        color: Colors.black.withValues(alpha: 0.03),
                        blurRadius: 6)
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: const BoxDecoration(
                            color: RestaurantTheme.sectionFill,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.location_on_rounded,
                              color: RestaurantTheme.headerBand, size: 22),
                        ),
                        const SizedBox(width: 12),
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('DELIVERY ADDRESS',
                                  style: TextStyle(
                                      fontSize: 10,
                                      fontWeight: FontWeight.w900,
                                      color: RestaurantTheme.headerBand,
                                      letterSpacing: 0.5)),
                              SizedBox(height: 2),
                              Text(
                                  'Saved addresses are not available for food yet, '
                                  'so type where this order should be delivered.',
                                  style: TextStyle(
                                      fontSize: 11,
                                      color: RestaurantTheme.secondaryText)),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _addressCtrl,
                      maxLines: 2,
                      style: const TextStyle(
                          fontSize: 13, fontWeight: FontWeight.w600),
                      decoration: InputDecoration(
                        hintText: 'House / flat, street or area, Aizawl',
                        hintStyle: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w400,
                            color: RestaurantTheme.secondaryText),
                        filled: true,
                        fillColor: RestaurantTheme.lightBg,
                        border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide:
                                const BorderSide(color: RestaurantTheme.border)),
                        contentPadding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 10),
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      _deliveryMinutes == null
                          ? 'Delivery time is confirmed by the restaurant'
                          : 'Delivery time shown at the restaurant: ${foodEtaLabel(_deliveryMinutes)}',
                      style: const TextStyle(
                          fontSize: 11,
                          color: RestaurantTheme.secondaryText),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 14),

              // Items Ordered List Card
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: RestaurantTheme.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: RestaurantTheme.border),
                  boxShadow: [
                    BoxShadow(
                        color: Colors.black.withValues(alpha: 0.03),
                        blurRadius: 6)
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Flexible(
                          child: Text(_restaurantName ?? 'Selected kitchen',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w900,
                                  fontSize: 14.5,
                                  color: RestaurantTheme.charcoal)),
                        ),
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                              color: RestaurantTheme.sectionFill,
                              borderRadius: BorderRadius.circular(8)),
                          child: Text('${_items.length} items',
                              style: const TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold,
                                  color: RestaurantTheme.headerBand)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    const Divider(height: 1, color: RestaurantTheme.border),
                    const SizedBox(height: 10),
                    ..._items.map((item) {
                      final isVeg = item['isVeg'] == true;
                      final qty = _quantityOf(item);
                      final price = (item['price'] as num?) ?? 0;
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 5),
                        child: Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(2),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(3),
                                border: Border.all(
                                    color: isVeg
                                        ? RestaurantTheme.vegGreen
                                        : RestaurantTheme.nonVegRed,
                                    width: 1.2),
                              ),
                              child: Icon(
                                Icons.fiber_manual_record,
                                color: isVeg
                                    ? RestaurantTheme.vegGreen
                                    : RestaurantTheme.nonVegRed,
                                size: 7,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                item['name']?.toString() ?? 'Dish',
                                style: const TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.bold,
                                    color: RestaurantTheme.charcoal),
                              ),
                            ),
                            Text('$qty × ₹${foodPrice(price)}',
                                style: const TextStyle(
                                    fontSize: 12,
                                    color: RestaurantTheme.secondaryText)),
                            const SizedBox(width: 12),
                            Text('₹${foodPrice(qty * price)}',
                                style: const TextStyle(
                                    fontWeight: FontWeight.w900,
                                    fontSize: 13,
                                    color: RestaurantTheme.charcoal)),
                          ],
                        ),
                      );
                    }),
                    if (_items.isEmpty)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 8),
                        child: Text(
                          'Your basket is empty — add dishes from the restaurant menu first.',
                          style: TextStyle(
                              fontSize: 12,
                              color: RestaurantTheme.secondaryText),
                        ),
                      ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _instructionCtrl,
                      decoration: InputDecoration(
                        hintText:
                            'Add cooking or delivery instructions for kitchen...',
                        hintStyle: const TextStyle(
                            fontSize: 12, color: RestaurantTheme.secondaryText),
                        prefixIcon: const Icon(Icons.note_alt_outlined,
                            size: 18, color: RestaurantTheme.headerBand),
                        filled: true,
                        fillColor: RestaurantTheme.lightBg,
                        border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: const BorderSide(
                                color: RestaurantTheme.border)),
                        contentPadding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 10),
                      ),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'The order record carries the address, your contact and the '
                      'dishes — no instruction field reaches the kitchen yet, so '
                      'this note stays on your device.',
                      style: TextStyle(
                          fontSize: 11, color: RestaurantTheme.secondaryText),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 14),

              // Coupon: the code goes to the platform, the discount comes back
              // from it.
              _buildCouponCard(),

              const SizedBox(height: 14),

              // Detailed Bill Breakdown
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: RestaurantTheme.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: RestaurantTheme.border),
                  boxShadow: [
                    BoxShadow(
                        color: Colors.black.withValues(alpha: 0.03),
                        blurRadius: 6)
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Bill Summary',
                        style: TextStyle(
                            fontWeight: FontWeight.w900,
                            fontSize: 14,
                            color: RestaurantTheme.charcoal)),
                    const SizedBox(height: 10),
                    _buildBillRow('Item total (menu prices)',
                        '₹${foodPrice(_itemTotal)}'),
                    if (_couponDiscount > 0)
                      _buildBillRow('Coupon $_appliedCoupon',
                          '-₹${foodPrice(_couponDiscount)}',
                          isDiscount: true),
                    const Divider(height: 18, color: RestaurantTheme.border),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        // Flexible, not a bare Text: the amount keeps its own
                        // width and the label gives way on a narrow screen or a
                        // large text scale instead of overflowing the card.
                        const Flexible(
                          child: Text('Estimated to pay',
                              style: TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w900,
                                  color: RestaurantTheme.charcoal)),
                        ),
                        Text('₹${foodPrice(_payable)}',
                            style: const TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.w900,
                                color: RestaurantTheme.charcoal)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'The restaurant re-reads every dish price when the order '
                      'lands, and its own bill adds delivery, packaging and any '
                      'tax it charges. Those are not worked out in this app.',
                      style: TextStyle(
                          fontSize: 11, color: RestaurantTheme.secondaryText),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 14),

              // Settlement: what actually happens to the money on this order.
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: RestaurantTheme.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: RestaurantTheme.border),
                  boxShadow: [
                    BoxShadow(
                        color: Colors.black.withValues(alpha: 0.03),
                        blurRadius: 6)
                  ],
                ),
                child: const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.payments_outlined,
                            size: 20, color: RestaurantTheme.headerBand),
                        SizedBox(width: 10),
                        Text('Payment',
                            style: TextStyle(
                                fontWeight: FontWeight.w900,
                                fontSize: 14,
                                color: RestaurantTheme.charcoal)),
                      ],
                    ),
                    SizedBox(height: 8),
                    Text(
                      'The restaurant collects the payment when it delivers. This '
                      'app does not charge a UPI ID, card or wallet, and the food '
                      'order record carries no payment method, so no amount is paid '
                      'here and nothing is debited when you place the order.',
                      style: TextStyle(
                          fontSize: 12,
                          height: 1.45,
                          color: RestaurantTheme.secondaryText),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 20),

              // Confirm and Place Order Button
              ElevatedButton(
                onPressed: _isPlacingOrder || !_canOrder ? null : _placeOrder,
                style: ElevatedButton.styleFrom(
                  backgroundColor: RestaurantTheme.primaryAction,
                  foregroundColor: Colors.white,
                  minimumSize: const Size(double.infinity, 52),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14)),
                  elevation: 0,
                ),
                child: _isPlacingOrder
                    ? const SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(
                            color: Colors.white, strokeWidth: 2.5))
                    : Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Flexible(
                            child: Text(
                              _canOrder
                                  ? 'Place Order • ₹${foodPrice(_payable)}'
                                  : _restaurantId == null
                                      ? 'Open a restaurant menu to order'
                                      : _items.isEmpty
                                          ? 'Add dishes to your basket'
                                          : 'Type the delivery address first',
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w900, fontSize: 15),
                            ),
                          ),
                          if (_canOrder) ...[
                            const SizedBox(width: 8),
                            const Icon(Icons.arrow_forward_rounded, size: 18),
                          ],
                        ],
                      ),
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBillRow(String label, String amount, {bool isDiscount = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(label,
                style: TextStyle(
                    fontSize: 12,
                    color: isDiscount
                        ? RestaurantTheme.vegGreen
                        : RestaurantTheme.secondaryText,
                    fontWeight:
                        isDiscount ? FontWeight.w700 : FontWeight.normal)),
          ),
          const SizedBox(width: 10),
          Text(amount,
              textAlign: TextAlign.right,
              style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  color: isDiscount
                      ? RestaurantTheme.vegGreen
                      : RestaurantTheme.charcoal)),
        ],
      ),
    );
  }

  /// Coupon entry against `POST /api/promotions/apply`. An empty basket or a
  /// refused code shows the platform's own reason; no discount is displayed that
  /// the server did not compute.
  Widget _buildCouponCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: RestaurantTheme.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: RestaurantTheme.border),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 6)
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.local_offer_rounded,
                  size: 20, color: RestaurantTheme.headerBand),
              SizedBox(width: 10),
              Text('Coupons & offers',
                  style: TextStyle(
                      fontWeight: FontWeight.w900,
                      fontSize: 14,
                      color: RestaurantTheme.charcoal)),
            ],
          ),
          const SizedBox(height: 10),
          if (_appliedCoupon != null)
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: RestaurantTheme.sectionFill,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: RestaurantTheme.headerBand),
              ),
              child: Row(
                children: [
                  const Icon(Icons.check_circle_rounded,
                      size: 20, color: RestaurantTheme.headerBand),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Coupon "$_appliedCoupon" applied by the platform',
                          style: const TextStyle(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w900,
                              color: RestaurantTheme.charcoal),
                        ),
                        Text(
                          'Saves ₹${foodPrice(_couponDiscount)} on this bill',
                          style: const TextStyle(
                              fontSize: 11, color: RestaurantTheme.secondaryText),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close_rounded, size: 18),
                    color: RestaurantTheme.secondaryText,
                    tooltip: 'Remove the coupon',
                    onPressed: _removeCoupon,
                  ),
                ],
              ),
            )
          else
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _couponCtrl,
                    textCapitalization: TextCapitalization.characters,
                    style: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w800),
                    decoration: InputDecoration(
                      hintText: 'Enter the code the platform issued',
                      hintStyle: const TextStyle(
                          fontSize: 12, color: RestaurantTheme.secondaryText),
                      filled: true,
                      fillColor: RestaurantTheme.lightBg,
                      border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide:
                              const BorderSide(color: RestaurantTheme.border)),
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 10),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                ElevatedButton(
                  onPressed: _couponApplying || _itemTotal <= 0 ? null : _applyCoupon,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: RestaurantTheme.headerBand,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(
                        horizontal: 18, vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                    elevation: 0,
                  ),
                  child: _couponApplying
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white))
                      : const Text('Apply',
                          style:
                              TextStyle(fontWeight: FontWeight.w900, fontSize: 13)),
                ),
              ],
            ),
          if (_couponError != null) ...[
            const SizedBox(height: 6),
            Text(
              _couponError!,
              style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: RestaurantTheme.nonVegRed),
            ),
          ],
        ],
      ),
    );
  }
}
