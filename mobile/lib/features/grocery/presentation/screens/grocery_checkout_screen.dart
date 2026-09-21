import 'package:flutter/material.dart';
import '../theme/grocery_theme.dart';
import '../models/grocery_product.dart' show formatRupees;
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/network/session_manager.dart';
/// Grocery checkout: confirms the live basket lines, applies a server-checked
/// coupon and posts the order through `validateGroceryCheckout`.
class GroceryCheckoutScreen extends StatefulWidget {
  final List<Map<String, dynamic>> cartItems;
  final int subtotal;
  final int deliveryFee;
  final int handlingFee;

  const GroceryCheckoutScreen({
    super.key,
    required this.cartItems,
    required this.subtotal,
    this.deliveryFee = 0,
    // Zero, not a made-up store fee: rows for these only render when a caller
    // actually supplies them.
    this.handlingFee = 0,
  });

  @override
  State<GroceryCheckoutScreen> createState() => _GroceryCheckoutScreenState();
}

class _GroceryCheckoutScreenState extends State<GroceryCheckoutScreen> {
  // Address & Contact State. There is no customer-address read path exposed to
  // this feature, so the address stays a purely local choice (same three
  // options as the basket screen) until the backend serves saved addresses.
  String _selectedAddressLabel = 'Home';
  String _selectedAddressDetails = 'Civil Lines, Delhi • Flat 402';
  final TextEditingController _deliveryNoteController = TextEditingController();

  // Coupon State
  final TextEditingController _couponController = TextEditingController();
  String? _appliedCoupon;
  int _discountAmount = 0;
  String? _couponError;
  bool _couponApplying = false;

  // Delivery Partner Tip State — starts at zero; tipping is the customer's
  // choice, so nothing is pre-selected.
  int _selectedTip = 0;

  // Payment Method State (see _buildPaymentMethodSection for the ids)
  String _selectedPaymentMethod = 'UPI';

  // Order Processing State
  bool _isSubmitting = false;

  @override
  void dispose() {
    _deliveryNoteController.dispose();
    _couponController.dispose();
    super.dispose();
  }

  /// Server-side coupon preview (`POST /api/promotions/apply`). The old version
  /// matched two hard-coded strings locally and invented its own discount.
  Future<void> _applyCoupon() async {
    final String code = _couponController.text.trim().toUpperCase();
    if (code.isEmpty) {
      setState(() => _couponError = 'Enter a coupon code first.');
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
        orderAmount: widget.subtotal.toDouble(),
        service: 'GROCERY',
      );
    } catch (_) {
      data = null;
    }

    if (!mounted) return;
    setState(() => _couponApplying = false);

    final Map<String, dynamic>? applied =
        (data != null && data['success'] == true) ? data : null;

    if (applied == null) {
      setState(() {
        _appliedCoupon = null;
        _discountAmount = 0;
        _couponError = data?['error']?.toString() ??
            'That code could not be checked right now. Try again.';
      });
      return;
    }

    final int discount = ((applied['discount'] as num?)?.toDouble() ?? 0).round();
    final int saved = discount > widget.subtotal ? widget.subtotal : discount;
    setState(() {
      _appliedCoupon = (applied['code'] ?? code).toString();
      _discountAmount = saved;
    });
    // The coupon name and its saving both come straight from the server reply.
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          '${applied['name'] ?? _appliedCoupon} applied — you save '
          '${formatRupees(saved.toDouble())}',
        ),
      ),
    );
  }

  void _removeCoupon() {
    setState(() {
      _appliedCoupon = null;
      _discountAmount = 0;
      _couponController.clear();
      _couponError = null;
    });
  }

  int get _finalTotal {
    final total = widget.subtotal + widget.deliveryFee + widget.handlingFee + _selectedTip - _discountAmount;
    return total > 0 ? total : 0;
  }

  /// Who the basket is for — straight from the session, never a hard-coded
  /// demo name. Falls back to a prompt when the profile is incomplete.
  String get _customerLabel {
    final Map<String, dynamic>? user = SessionManager.instance.currentUser;
    final String? name = _clean(user?['name']);
    final String? phone = _clean(user?['phone']);
    if (name != null && phone != null) return '$name • $phone';
    if (name != null) return name;
    if (phone != null) return phone;
    return 'Add your contact details in your profile';
  }

  static String? _clean(Object? raw) {
    final String value = raw?.toString().trim() ?? '';
    return value.isEmpty ? null : value;
  }

  Future<void> _processCheckoutOrder() async {
    setState(() => _isSubmitting = true);

    final Map<String, dynamic>? user = SessionManager.instance.currentUser;
    // Only real session values go into the payload; the backend derives the
    // customer from the auth token anyway.
    final String? customerName = user?['name']?.toString();
    final String? customerPhone = user?['phone']?.toString();

    // The backend places one grocery order at one store, so the store comes
    // from the stocked rows themselves rather than a default.
    final Set<String> stores = widget.cartItems
        .map((item) => item['merchantId']?.toString())
        .whereType<String>()
        .where((String id) => id.isNotEmpty)
        .toSet();
    if (stores.length != 1) {
      setState(() => _isSubmitting = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('These items come from more than one store. Place one order per store.'),
        ));
      }
      return;
    }

    final payload = <String, dynamic>{
      'merchantId': stores.first,
      if (customerName != null) 'customerName': customerName,
      if (customerPhone != null) 'customerPhone': customerPhone,
      'deliveryAddress': '$_selectedAddressLabel: $_selectedAddressDetails',
      'deliveryInstructions': _deliveryNoteController.text.trim(),
      'paymentMethod': _selectedPaymentMethod,
      'cartItems': widget.cartItems.map((item) => {
        'productId': item['id'],
        'productName': item['name'],
        'unitPrice': (item['price'] as num).toDouble(),
        'quantity': (item['quantity'] as num).toInt(),
        'unit': item['unit'],
        'requestedQtyKg': (item['quantity'] as num).toDouble(),
      }).toList(),
      'subtotal': widget.subtotal,
      'discount': _discountAmount,
      'deliveryFee': widget.deliveryFee,
      'handlingFee': widget.handlingFee,
      'tip': _selectedTip,
      'finalTotal': _finalTotal,
    };

    try {
      final data = await NabinApiService.validateGroceryCheckout(payload)
          .timeout(const Duration(seconds: 8));
      setState(() => _isSubmitting = false);

      if (mounted && data?['success'] == true) {
        final Object? order = data?['order'];
        final Object? id = order is Map
            ? (order['id'] ?? order['order_id'] ?? order['order_number'])
            : null;
        // Only an id the backend actually returned is shown.
        _showOrderConfirmationModal(orderId: id?.toString());
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(data?['error']?.toString() ?? 'Checkout could not be completed. Please try again.')),
        );
      }
    } catch (_) {
      setState(() => _isSubmitting = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Checkout could not be completed. Please check your connection and try again.')),
        );
      }
    }
  }

  /// The backend returns `{success, order}` only — no delivery ETA and no
  /// assigned partner — so this sheet states just what actually happened.
  void _showOrderConfirmationModal({String? orderId}) {
    showModalBottomSheet(
      context: context,
      isDismissible: false,
      enableDrag: false,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
      ),
      builder: (ctx) => SingleChildScrollView(
        padding: const EdgeInsets.all(28),
        child: SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(20),
              decoration: const BoxDecoration(
                color: GroceryTheme.primaryGreenLight,
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.check_circle_rounded,
                size: 64,
                color: GroceryTheme.primaryGreenDark,
              ),
            ),
            const SizedBox(height: 20),
            const Text(
              'Order Confirmed!',
              style: TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w900,
                color: GroceryTheme.textDark,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              orderId == null
                  ? 'The store has received your basket.'
                  : 'Order ID: $orderId',
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: GroceryTheme.textMuted,
              ),
            ),
            const SizedBox(height: 20),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: GroceryTheme.surfaceElevated,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: GroceryTheme.borderLight),
              ),
              child: const Row(
                children: [
                  Icon(
                    Icons.storefront_rounded,
                    color: GroceryTheme.primaryGreenDark,
                    size: 22,
                  ),
                  SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'The grocery merchant confirms the final amount and the '
                      'delivery time with you directly.',
                      style: TextStyle(
                        fontSize: 12,
                        color: GroceryTheme.textMuted,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 28),
            ElevatedButton(
              onPressed: () {
                Navigator.of(ctx).pop();
                Navigator.of(context).pop();
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: GroceryTheme.primaryGreenDark,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              child: const Text(
                'Done',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],
        ),
      ),
    ),
  );
}

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: GroceryTheme.bgOffWhite,
      appBar: AppBar(
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Checkout',
              style: TextStyle(
                fontWeight: FontWeight.w900,
                fontSize: 18,
                color: GroceryTheme.textDark,
              ),
            ),
            Text(
              'Prices rechecked with the store',
              style: TextStyle(
                fontSize: 11,
                color: GroceryTheme.textMuted,
              ),
            ),
          ],
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildAddressSection(),
            const SizedBox(height: 16),
            _buildOrderItemsSection(),
            const SizedBox(height: 16),
            _buildCouponSection(),
            const SizedBox(height: 16),
            _buildTipSection(),
            const SizedBox(height: 16),
            _buildPaymentMethodSection(),
            const SizedBox(height: 16),
            _buildBillSummarySection(),
            const SizedBox(height: 80),
          ],
        ),
      ),
      bottomSheet: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.08),
              blurRadius: 16,
              offset: const Offset(0, -4),
            ),
          ],
        ),
        child: SafeArea(
          child: Row(
            children: [
              Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    formatRupees(_finalTotal.toDouble()),
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w900,
                      color: GroceryTheme.textDark,
                    ),
                  ),
                  const Text(
                    'PAYABLE AMOUNT',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                      color: GroceryTheme.primaryGreenDark,
                    ),
                  ),
                ],
              ),
              const SizedBox(width: 16),
              Expanded(
                child: ElevatedButton(
                  onPressed: _isSubmitting ? null : _processCheckoutOrder,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: GroceryTheme.primaryGreenDark,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                  ),
                  child: _isSubmitting
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.5,
                            color: Colors.white,
                          ),
                        )
                      : const Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              'Place order',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ],
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildAddressSection() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: GroceryTheme.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: GroceryTheme.primaryGreen.withValues(alpha: 0.12),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.location_on_rounded,
                      color: GroceryTheme.primaryGreenDark,
                      size: 20,
                    ),
                  ),
                  const SizedBox(width: 10),
                  const Text(
                    'Delivery Address',
                    style: TextStyle(
                      fontWeight: FontWeight.w900,
                      fontSize: 15,
                      color: GroceryTheme.textDark,
                    ),
                  ),
                ],
              ),
              TextButton(
                onPressed: _showAddressPickerModal,
                child: const Text(
                  'Change',
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 13,
                    color: GroceryTheme.primaryGreenDark,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: GroceryTheme.surfaceElevated,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: GroceryTheme.primaryGreenDark,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        _selectedAddressLabel.toUpperCase(),
                        style: const TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w900,
                          color: Colors.white,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Flexible(
                      child: Text(
                        _customerLabel,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: GroceryTheme.textDark,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  _selectedAddressDetails,
                  style: const TextStyle(
                    fontSize: 13,
                    color: GroceryTheme.textMuted,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _deliveryNoteController,
            style: const TextStyle(fontSize: 13),
            decoration: InputDecoration(
              hintText: 'Add delivery instructions (e.g. Leave at door, don\'t ring bell)',
              hintStyle: const TextStyle(fontSize: 12, color: GroceryTheme.textMuted),
              prefixIcon: const Icon(Icons.sticky_note_2_outlined, size: 18, color: GroceryTheme.textMuted),
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              filled: true,
              fillColor: GroceryTheme.bgOffWhite,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide.none,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildOrderItemsSection() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: GroceryTheme.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Basket Items Preview',
                style: TextStyle(
                  fontWeight: FontWeight.w900,
                  fontSize: 15,
                  color: GroceryTheme.textDark,
                ),
              ),
              Text(
                '${widget.cartItems.length} Items',
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: GroceryTheme.textMuted,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ...widget.cartItems.map((item) {
            // Every value below comes from the live basket line written by
            // GroceryCartItem.toLineJson(); `weight` never existed on the row.
            final String name = item['name']?.toString() ?? 'Item';
            final int quantity = (item['quantity'] as num?)?.toInt() ?? 1;
            final double unitPrice = (item['price'] as num?)?.toDouble() ?? 0;
            final String size = <String?>[
              item['packSize']?.toString(),
              item['unit']?.toString(),
            ].whereType<String>().where((String v) => v.isNotEmpty).join(' • ');
            final Object? background = item['bgColor'];
            return Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      color: background is Color
                          ? background
                          : GroceryTheme.primaryGreenLight,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Center(
                      child: Text(
                        item['emoji']?.toString() ?? '🛒',
                        style: const TextStyle(fontSize: 20),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          name,
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: GroceryTheme.textDark,
                          ),
                        ),
                        Text(
                          size.isEmpty ? 'Qty: $quantity' : '$size • Qty: $quantity',
                          style: const TextStyle(
                            fontSize: 11,
                            color: GroceryTheme.textMuted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    formatRupees(unitPrice * quantity),
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w800,
                      color: GroceryTheme.textDark,
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildCouponSection() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: GroceryTheme.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.local_offer_rounded, color: GroceryTheme.accentAmber, size: 20),
              SizedBox(width: 8),
              Text(
                'Coupons & Offers',
                style: TextStyle(
                  fontWeight: FontWeight.w900,
                  fontSize: 15,
                  color: GroceryTheme.textDark,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (_appliedCoupon != null)
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: GroceryTheme.primaryGreenLight,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: GroceryTheme.primaryGreen),
              ),
              child: Row(
                children: [
                  const Icon(Icons.check_circle_rounded, color: GroceryTheme.primaryGreenDark, size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Coupon "$_appliedCoupon" Applied!',
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w900,
                            color: GroceryTheme.primaryGreenDark,
                          ),
                        ),
                        Text(
                          'Saved ₹$_discountAmount on this order',
                          style: const TextStyle(
                            fontSize: 11,
                            color: GroceryTheme.primaryGreenDark,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close_rounded, color: GroceryTheme.primaryGreenDark, size: 18),
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
                    controller: _couponController,
                    textCapitalization: TextCapitalization.characters,
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800),
                    decoration: InputDecoration(
                      hintText: 'Enter coupon code',
                      hintStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w400, color: GroceryTheme.textMuted),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                      filled: true,
                      fillColor: GroceryTheme.bgOffWhite,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: BorderSide.none,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                ElevatedButton(
                  onPressed: _couponApplying ? null : _applyCoupon,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: GroceryTheme.primaryGreenDark,
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  child: _couponApplying
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text('Apply', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13)),
                ),
              ],
            ),
          if (_couponError != null) ...[
            const SizedBox(height: 6),
            Text(
              _couponError!,
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: GroceryTheme.accentRose),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildTipSection() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: GroceryTheme.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.volunteer_activism_rounded, color: GroceryTheme.primaryGreen, size: 20),
              SizedBox(width: 8),
              Text(
                'Tip Delivery Partner',
                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: GroceryTheme.textDark),
              ),
            ],
          ),
          const SizedBox(height: 4),
          const Text(
            'Optional — the full tip reaches the delivery partner',
            style: TextStyle(fontSize: 11, color: GroceryTheme.textMuted),
          ),
          const SizedBox(height: 12),
          Row(
            children: [0, 10, 20, 30, 50].map((tipVal) {
              final isSelected = _selectedTip == tipVal;
              return Padding(
                padding: const EdgeInsets.only(right: 10),
                child: FilterChip(
                  label: Text(tipVal == 0 ? 'No tip' : '₹$tipVal'),
                  selected: isSelected,
                  selectedColor: GroceryTheme.primaryGreenDark,
                  labelStyle: TextStyle(
                    fontWeight: FontWeight.w800,
                    color: isSelected ? Colors.white : GroceryTheme.textDark,
                  ),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  onSelected: (selected) {
                    setState(() {
                      _selectedTip = selected ? tipVal : 0;
                    });
                  },
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildPaymentMethodSection() {
    // Neutral method labels — the backend stores this string and the merchant
    // collects the payment, so no specific wallet app is promised here.
    final options = [
      {'id': 'UPI', 'name': 'UPI', 'icon': Icons.qr_code_scanner_rounded, 'subtitle': 'Pay from any UPI app'},
      {'id': 'CARD', 'name': 'Credit / Debit Card', 'icon': Icons.credit_card_rounded, 'subtitle': 'Card on the NABIN wallet'},
      {'id': 'COD', 'name': 'Pay on Delivery', 'icon': Icons.payments_rounded, 'subtitle': 'Cash or UPI at the door'},
    ];

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: GroceryTheme.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Select Payment Method',
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: GroceryTheme.textDark),
          ),
          const SizedBox(height: 12),
          ...options.map((opt) {
            final isSelected = _selectedPaymentMethod == opt['id'];
            return Container(
              margin: const EdgeInsets.only(bottom: 8),
              decoration: BoxDecoration(
                color: isSelected ? GroceryTheme.primaryGreenLight : GroceryTheme.bgOffWhite,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: isSelected ? GroceryTheme.primaryGreenDark : GroceryTheme.borderLight,
                  width: isSelected ? 1.5 : 1.0,
                ),
              ),
              child: ListTile(
                leading: Icon(
                  opt['icon'] as IconData,
                  color: isSelected ? GroceryTheme.primaryGreenDark : GroceryTheme.textMuted,
                ),
                title: Text(
                  opt['name'] as String,
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 13,
                    color: isSelected ? GroceryTheme.primaryGreenDark : GroceryTheme.textDark,
                  ),
                ),
                subtitle: Text(
                  opt['subtitle'] as String,
                  style: const TextStyle(fontSize: 11, color: GroceryTheme.textMuted),
                ),
                trailing: Icon(
                  isSelected ? Icons.radio_button_checked_rounded : Icons.radio_button_off_rounded,
                  color: isSelected ? GroceryTheme.primaryGreenDark : GroceryTheme.textMuted,
                ),
                onTap: () {
                  setState(() => _selectedPaymentMethod = opt['id'] as String);
                },
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildBillSummarySection() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: GroceryTheme.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Bill breakdown',
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: GroceryTheme.textDark),
          ),
          const SizedBox(height: 12),
          _buildRow('Items subtotal', formatRupees(widget.subtotal.toDouble())),
          if (widget.deliveryFee > 0) ...[
            const SizedBox(height: 6),
            _buildRow('Delivery fee', formatRupees(widget.deliveryFee.toDouble())),
          ],
          if (widget.handlingFee > 0) ...[
            const SizedBox(height: 6),
            _buildRow('Handling fee', formatRupees(widget.handlingFee.toDouble())),
          ],
          if (_selectedTip > 0) ...[
            const SizedBox(height: 6),
            _buildRow('Delivery partner tip', formatRupees(_selectedTip.toDouble())),
          ],
          if (_discountAmount > 0) ...[
            const SizedBox(height: 6),
            _buildRow('Coupon savings', '-${formatRupees(_discountAmount.toDouble())}', isGreen: true),
          ],
          const Divider(height: 20, color: GroceryTheme.borderLight),
          _buildRow('To pay', formatRupees(_finalTotal.toDouble()), isBold: true),
          const SizedBox(height: 6),
          const Text(
            'Delivery fee, handling fee and the delivery time are set by the '
            'store and confirmed with you before payment.',
            style: TextStyle(fontSize: 11, color: GroceryTheme.textMuted),
          ),
        ],
      ),
    );
  }

  Widget _buildRow(String label, String val, {bool isGreen = false, bool isBold = false}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: isBold ? 14 : 12.5,
            fontWeight: isBold ? FontWeight.w900 : FontWeight.normal,
            color: isBold ? GroceryTheme.textDark : GroceryTheme.textMuted,
          ),
        ),
        Text(
          val,
          style: TextStyle(
            fontSize: isBold ? 16 : 12.5,
            fontWeight: isBold ? FontWeight.w900 : FontWeight.bold,
            color: isGreen ? GroceryTheme.primaryGreenDark : GroceryTheme.textDark,
          ),
        ),
      ],
    );
  }

  /// Same three local choices the basket screen offers. The customer API exposes
  /// no saved-address read path for this feature, so these cannot come from the
  /// backend yet.
  static const List<Map<String, String>> _addressChoices = <Map<String, String>>[
    <String, String>{'label': 'Home', 'icon': 'home', 'detail': 'Civil Lines, Delhi • Flat 402'},
    <String, String>{'label': 'Work', 'icon': 'work', 'detail': 'Connaught Place, Delhi • Block B Office'},
    <String, String>{'label': 'Other', 'icon': 'place', 'detail': 'Kamla Nagar, Delhi • Market Road'},
  ];

  void _showAddressPickerModal() {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Select delivery location', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
            const SizedBox(height: 4),
            const Text(
              'Saved addresses are not available for grocery yet — pick one for this order.',
              style: TextStyle(fontSize: 11, color: GroceryTheme.textMuted),
            ),
            const SizedBox(height: 12),
            for (final Map<String, String> choice in _addressChoices)
              ListTile(
                leading: Icon(_addressIcon(choice['icon']!), color: GroceryTheme.primaryGreenDark),
                title: Text('${choice['label']} — ${choice['detail']}',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                onTap: () {
                  setState(() {
                    _selectedAddressLabel = choice['label']!;
                    _selectedAddressDetails = choice['detail']!;
                  });
                  Navigator.pop(ctx);
                },
              ),
          ],
        ),
      ),
    );
  }

  static IconData _addressIcon(String key) {
    switch (key) {
      case 'work':
        return Icons.work_rounded;
      case 'place':
        return Icons.place_rounded;
      default:
        return Icons.home_rounded;
    }
  }
}
