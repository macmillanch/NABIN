import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/network/session_manager.dart';
import '../../../../core/theme/restaurant_theme.dart';
import '../providers/food_models.dart' show foodPrice;

class FoodCheckoutScreen extends StatefulWidget {
  final Map<String, dynamic>? cartData;

  const FoodCheckoutScreen({super.key, this.cartData});

  @override
  State<FoodCheckoutScreen> createState() => _FoodCheckoutScreenState();
}

class _FoodCheckoutScreenState extends State<FoodCheckoutScreen> {
  final String _deliveryAddress = 'Flat 402, Civil Lines, Delhi (Home)';
  String _selectedPaymentMethod = 'UPI'; // 'UPI', 'WALLET', 'CARD', 'COD'
  final TextEditingController _instructionCtrl = TextEditingController();
  bool _isPlacingOrder = false;
  final num _couponDiscount = 50;

  late final String? _restaurantId;
  late final String? _restaurantName;
  late final String? _deliveryTime;
  late List<Map<String, dynamic>> _items;
  late num _itemTotal;
  final num _deliveryFee = 25;
  final num _packagingFee = 15;
  late num _taxAmount;
  late num _grandTotal;

  @override
  void initState() {
    super.initState();
    _restaurantId = _readId(widget.cartData?['restaurantId']);
    _restaurantName = widget.cartData?['restaurantName'] as String?;
    _deliveryTime = widget.cartData?['deliveryTime'] as String?;

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

  void _recalculateTotals() {
    _itemTotal = _items.fold<num>(0, (sum, item) {
      final qty = _quantityOf(item);
      final price = (item['price'] as num?) ?? 0;
      return sum + (qty * price);
    });
    _taxAmount = (_itemTotal * 0.05).round();
    _grandTotal = (_itemTotal + _deliveryFee + _packagingFee + _taxAmount - _couponDiscount).clamp(0, 99999);
  }

  bool get _canOrder => _items.isNotEmpty && _restaurantId != null;

  Future<void> _placeOrder() async {
    final restaurantId = _restaurantId;
    if (restaurantId == null || _items.isEmpty) return;

    setState(() => _isPlacingOrder = true);

    final user = SessionManager.instance.currentUser;
    final customerId = user?['id']?.toString() ?? 'cust_active';

    final payload = {
      'customerId': customerId,
      'restaurantId': restaurantId,
      'deliveryAddress': _deliveryAddress,
      // Real dish ids, names and quantities from the restaurant's own menu rows.
      'items': _items
          .map((item) => <String, dynamic>{
                'id': item['id'],
                'name': item['name'],
                'quantity': _quantityOf(item),
                'price': item['price'],
              })
          .toList(),
      // Extra details for UI tracking, backend may ignore what it doesn't need
      'instructions': _instructionCtrl.text.trim(),
      'itemTotal': _itemTotal,
      'discount': _couponDiscount,
      'grandTotal': _grandTotal,
      'paymentMethod': _selectedPaymentMethod,
    };

    final res = await NabinApiService.bookFood(payload);

    if (!mounted) return;
    setState(() => _isPlacingOrder = false);

    if (res != null && res['success'] == true) {
      final job = res['job'] ?? res['order'] ?? {};
      context.pushReplacement('/food-tracking', extra: {
        'orderId': job['id'] ?? 'FD-88912',
        'deliveryOtp': job['deliveryOtp'] ?? job['pickupOtp'] ?? '4892',
        'restaurantName': _restaurantName ?? 'Your restaurant',
        'grandTotal': '₹${foodPrice(_grandTotal)}',
        'items': _items,
        'deliveryAddress': _deliveryAddress,
        'driverName': 'Assigning...',
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
        backgroundColor: RestaurantTheme.charcoal,
        elevation: 0,
        title: const Text('Checkout & Payment', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: Colors.white)),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white, size: 18),
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
                  boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 6)],
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: RestaurantTheme.neonOrange.withValues(alpha: 0.12),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.location_on_rounded, color: RestaurantTheme.neonOrange, size: 22),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('DELIVERY ADDRESS', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: RestaurantTheme.neonOrange, letterSpacing: 0.5)),
                          const SizedBox(height: 2),
                          Text(_deliveryAddress, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: RestaurantTheme.charcoal)),
                          Text(
                            _deliveryTime == null
                                ? 'Estimated delivery shown after the kitchen confirms'
                                : 'Estimated delivery: $_deliveryTime',
                            style: const TextStyle(fontSize: 11, color: RestaurantTheme.secondaryText),
                          ),
                        ],
                      ),
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
                  boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 6)],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(_restaurantName ?? 'Selected kitchen', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14.5, color: RestaurantTheme.charcoal)),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(color: RestaurantTheme.neonOrangeLight, borderRadius: BorderRadius.circular(8)),
                          child: Text('${_items.length} items', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.neonOrangeDark)),
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
                                border: Border.all(color: isVeg ? RestaurantTheme.vegGreen : RestaurantTheme.nonVegRed, width: 1.2),
                              ),
                              child: Icon(
                                Icons.fiber_manual_record,
                                color: isVeg ? RestaurantTheme.vegGreen : RestaurantTheme.nonVegRed,
                                size: 7,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                item['name']?.toString() ?? 'Dish',
                                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: RestaurantTheme.charcoal),
                              ),
                            ),
                            Text('$qty × ₹${foodPrice(price)}', style: const TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText)),
                            const SizedBox(width: 12),
                            Text('₹${foodPrice(qty * price)}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: RestaurantTheme.charcoal)),
                          ],
                        ),
                      );
                    }),
                    if (_items.isEmpty)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 8),
                        child: Text(
                          'Your basket is empty — add dishes from the restaurant menu first.',
                          style: TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText),
                        ),
                      ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _instructionCtrl,
                      decoration: InputDecoration(
                        hintText: 'Add cooking or delivery instructions for kitchen...',
                        hintStyle: const TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText),
                        prefixIcon: const Icon(Icons.note_alt_outlined, size: 18, color: RestaurantTheme.neonOrange),
                        filled: true,
                        fillColor: RestaurantTheme.lightBg,
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: RestaurantTheme.border)),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 14),

              // Coupon Offer Applied Strip
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: RestaurantTheme.neonOrangeLight,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: RestaurantTheme.neonOrange.withValues(alpha: 0.3)),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.local_offer_rounded, color: RestaurantTheme.neonOrangeDark, size: 18),
                    SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('NABINFOOD30 Applied', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 12, color: RestaurantTheme.neonOrangeDark)),
                          Text('₹50 instant festive discount applied to bill', style: TextStyle(fontSize: 10.5, color: RestaurantTheme.secondaryText)),
                        ],
                      ),
                    ),
                    Text('✓ APPLIED', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: RestaurantTheme.neonOrangeDark)),
                  ],
                ),
              ),

              const SizedBox(height: 14),

              // Detailed Bill Breakdown
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: RestaurantTheme.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: RestaurantTheme.border),
                  boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 6)],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Bill Summary', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: RestaurantTheme.charcoal)),
                    const SizedBox(height: 10),
                    _buildBillRow('Item Total', '₹${foodPrice(_itemTotal)}'),
                    _buildBillRow('Delivery Fee', '₹${foodPrice(_deliveryFee)}'),
                    _buildBillRow('Restaurant Packaging & Platform Fee', '₹${foodPrice(_packagingFee)}'),
                    _buildBillRow('Govt GST & Taxes (5%)', '₹${foodPrice(_taxAmount)}'),
                    _buildBillRow('Coupon Discount (NABINFOOD30)', '-₹${foodPrice(_couponDiscount)}', isDiscount: true),
                    const Divider(height: 18, color: RestaurantTheme.border),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('To Pay', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                        Text('₹${foodPrice(_grandTotal)}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                      ],
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 14),

              // Payment Method Card
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: RestaurantTheme.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: RestaurantTheme.border),
                  boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 6)],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Select Payment Method', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: RestaurantTheme.charcoal)),
                    const SizedBox(height: 10),
                    _buildPaymentOption('UPI', 'UPI / Google Pay / PhonePe / PayZapp', Icons.qr_code_2_rounded, RestaurantTheme.neonOrange),
                    _buildPaymentOption('WALLET', 'NABIN Wallet (Balance: ₹1,250.00)', Icons.account_balance_wallet_rounded, RestaurantTheme.masterBlue),
                    _buildPaymentOption('CARD', 'Credit / Debit Card', Icons.credit_card_rounded, const Color(0xFF4F46E5)),
                    _buildPaymentOption('COD', 'Cash on Delivery', Icons.payments_rounded, const Color(0xFF059669)),
                  ],
                ),
              ),

              const SizedBox(height: 20),

              // Confirm and Place Order Button
              ElevatedButton(
                onPressed: _isPlacingOrder || !_canOrder ? null : _placeOrder,
                style: ElevatedButton.styleFrom(
                  backgroundColor: RestaurantTheme.neonOrange,
                  foregroundColor: Colors.white,
                  minimumSize: const Size(double.infinity, 52),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  elevation: 0,
                ),
                child: _isPlacingOrder
                    ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
                    : Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            _canOrder
                                ? 'Place Order • ₹${foodPrice(_grandTotal)}'
                                : _restaurantId == null
                                    ? 'Open a restaurant menu to order'
                                    : 'Add dishes to your basket',
                            style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15),
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
        children: [
          Text(label, style: TextStyle(fontSize: 12, color: isDiscount ? RestaurantTheme.vegGreen : RestaurantTheme.secondaryText, fontWeight: isDiscount ? FontWeight.w700 : FontWeight.normal)),
          Text(amount, style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: isDiscount ? RestaurantTheme.vegGreen : RestaurantTheme.charcoal)),
        ],
      ),
    );
  }

  Widget _buildPaymentOption(String id, String title, IconData icon, Color color) {
    final isSelected = _selectedPaymentMethod == id;
    return InkWell(
      onTap: () => setState(() => _selectedPaymentMethod = id),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: isSelected ? color.withValues(alpha: 0.08) : RestaurantTheme.lightBg,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: isSelected ? color : RestaurantTheme.border, width: 1.2),
        ),
        child: Row(
          children: [
            Icon(icon, color: color, size: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                title,
                style: TextStyle(
                  fontWeight: isSelected ? FontWeight.w900 : FontWeight.bold,
                  fontSize: 12.5,
                  color: isSelected ? color : RestaurantTheme.charcoal,
                ),
              ),
            ),
            Icon(
              isSelected ? Icons.check_circle_rounded : Icons.radio_button_unchecked,
              color: isSelected ? color : RestaurantTheme.border,
              size: 18,
            ),
          ],
        ),
      ),
    );
  }
}
