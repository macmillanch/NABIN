import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../theme/grocery_theme.dart';

/// Dedicated 10-Minute Express Checkout Screen for NABIN Grocery App
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
    this.handlingFee = 2,
  });

  @override
  State<GroceryCheckoutScreen> createState() => _GroceryCheckoutScreenState();
}

class _GroceryCheckoutScreenState extends State<GroceryCheckoutScreen> {
  // Address & Contact State
  String _selectedAddressLabel = 'Home';
  String _selectedAddressDetails = 'Flat 402, Civil Lines Hub, North Delhi, 110054';
  final TextEditingController _deliveryNoteController = TextEditingController();

  // Coupon State
  final TextEditingController _couponController = TextEditingController();
  String? _appliedCoupon;
  int _discountAmount = 0;
  String? _couponError;

  // Delivery Partner Tip State
  int _selectedTip = 20;

  // Payment Method State
  String _selectedPaymentMethod = 'UPI_GPAY'; // UPI_GPAY, UPI_PHONEPE, CARD, COD

  // Order Processing State
  bool _isSubmitting = false;

  @override
  void dispose() {
    _deliveryNoteController.dispose();
    _couponController.dispose();
    super.dispose();
  }

  void _applyCoupon() {
    final code = _couponController.text.trim().toUpperCase();
    setState(() {
      _couponError = null;
    });

    if (code == 'FESTIVAL30') {
      setState(() {
        _appliedCoupon = 'FESTIVAL30';
        _discountAmount = (widget.subtotal * 0.30).round();
        if (_discountAmount > 60) _discountAmount = 60;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('🎉 Coupon FESTIVAL30 applied! Saved 30% up to ₹60'),
          backgroundColor: GroceryTheme.primaryGreenDark,
        ),
      );
    } else if (code == 'NABIN10') {
      setState(() {
        _appliedCoupon = 'NABIN10';
        _discountAmount = 50;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('🎉 Coupon NABIN10 applied! ₹50 instant discount'),
          backgroundColor: GroceryTheme.primaryGreenDark,
        ),
      );
    } else {
      setState(() {
        _couponError = 'Invalid coupon code. Try FESTIVAL30 or NABIN10';
      });
    }
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

  Future<void> _processCheckoutOrder() async {
    setState(() => _isSubmitting = true);

    final payload = {
      'customerId': 'cust_express_8812',
      'customerName': 'Rahul Sharma',
      'customerPhone': '+91 98765 43210',
      'deliveryAddress': '$_selectedAddressLabel: $_selectedAddressDetails',
      'deliveryInstructions': _deliveryNoteController.text.trim(),
      'paymentMethod': _selectedPaymentMethod,
      'cartItems': widget.cartItems.map((item) => {
        'productId': item['id'],
        'productName': item['name'],
        'unitPrice': item['price'],
        'quantity': item['quantity'],
        'requestedQtyKg': item['quantity'],
      }).toList(),
      'subtotal': widget.subtotal,
      'discount': _discountAmount,
      'deliveryFee': widget.deliveryFee,
      'handlingFee': widget.handlingFee,
      'tip': _selectedTip,
      'finalTotal': _finalTotal,
    };

    try {
      final response = await http.post(
        Uri.parse('http://127.0.0.1:4000/api/grocery/checkout/validate'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(payload),
      ).timeout(const Duration(seconds: 4));

      final data = jsonDecode(response.body);
      setState(() => _isSubmitting = false);

      if (mounted) {
        _showOrderConfirmationModal(
          orderId: data['order']?['id'] ?? 'ORD-EXPRESS-${DateTime.now().millisecondsSinceEpoch.toString().substring(7)}',
          etaMinutes: 9,
        );
      }
    } catch (_) {
      setState(() => _isSubmitting = false);
      if (mounted) {
        _showOrderConfirmationModal(
          orderId: 'ORD-EXPRESS-${DateTime.now().millisecondsSinceEpoch.toString().substring(7)}',
          etaMinutes: 10,
        );
      }
    }
  }

  void _showOrderConfirmationModal({required String orderId, required int etaMinutes}) {
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
              'Express Order Confirmed! ⚡',
              style: TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w900,
                color: GroceryTheme.textDark,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Order ID: $orderId',
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: GroceryTheme.textMuted,
              ),
            ),
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: GroceryTheme.surfaceElevated,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: GroceryTheme.borderLight),
              ),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: GroceryTheme.primaryGreen.withValues(alpha: 0.15),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.electric_moped_rounded,
                      color: GroceryTheme.primaryGreenDark,
                      size: 28,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Estimated Delivery: $etaMinutes Mins',
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w900,
                            color: GroceryTheme.textDark,
                          ),
                        ),
                        const SizedBox(height: 2),
                        const Text(
                          'Partner assigned • DarkStore #84 packing items',
                          style: TextStyle(
                            fontSize: 12,
                            color: GroceryTheme.textMuted,
                          ),
                        ),
                      ],
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
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.location_searching_rounded, color: Colors.white, size: 20),
                  SizedBox(width: 8),
                  Text(
                    'Track Live Delivery Map',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
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
              'Express Checkout',
              style: TextStyle(
                fontWeight: FontWeight.w900,
                fontSize: 18,
                color: GroceryTheme.textDark,
              ),
            ),
            Text(
              '⚡ 10-Minute DarkStore #84 Delivery',
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
                    '₹$_finalTotal',
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
                              'Pay & Place Order ⚡',
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
                    const Text(
                      'Rahul Sharma • +91 98765 43210',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: GroceryTheme.textDark,
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
            return Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      color: item['bgColor'] ?? GroceryTheme.primaryGreenLight,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Center(
                      child: Text(
                        item['emoji'] ?? '📦',
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
                          item['name'],
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: GroceryTheme.textDark,
                          ),
                        ),
                        Text(
                          '${item['weight']} • Qty: ${item['quantity']}',
                          style: const TextStyle(
                            fontSize: 11,
                            color: GroceryTheme.textMuted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    '₹${(item['price'] as int) * (item['quantity'] as int)}',
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
                      hintText: 'Enter Promo Code (e.g. FESTIVAL30)',
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
                  onPressed: _applyCoupon,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: GroceryTheme.primaryGreenDark,
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  child: const Text('Apply', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13)),
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
            '100% of the tip goes directly to your express delivery driver',
            style: TextStyle(fontSize: 11, color: GroceryTheme.textMuted),
          ),
          const SizedBox(height: 12),
          Row(
            children: [10, 20, 30, 50].map((tipVal) {
              final isSelected = _selectedTip == tipVal;
              return Padding(
                padding: const EdgeInsets.only(right: 10),
                child: FilterChip(
                  label: Text('₹$tipVal'),
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
    final options = [
      {'id': 'UPI_GPAY', 'name': 'Google Pay UPI', 'icon': Icons.account_balance_wallet_rounded, 'subtitle': 'Instant 1-Click Pay'},
      {'id': 'UPI_PHONEPE', 'name': 'PhonePe / Paytm UPI', 'icon': Icons.mobile_friendly_rounded, 'subtitle': 'UPI QR & App Direct'},
      {'id': 'CARD', 'name': 'Credit / Debit Card', 'icon': Icons.credit_card_rounded, 'subtitle': 'Visa, MasterCard, RuPay'},
      {'id': 'COD', 'name': 'Pay on Delivery (COD)', 'icon': Icons.payments_rounded, 'subtitle': 'Cash or QR Code at door'},
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
            'Bill Breakdown',
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: GroceryTheme.textDark),
          ),
          const SizedBox(height: 12),
          _buildRow('Items Subtotal', '₹${widget.subtotal}'),
          const SizedBox(height: 6),
          _buildRow('Delivery Fee (10-Min Express)', widget.deliveryFee == 0 ? 'FREE' : '₹${widget.deliveryFee}', isGreen: true),
          const SizedBox(height: 6),
          _buildRow('Store Handling Fee', '₹${widget.handlingFee}'),
          if (_selectedTip > 0) ...[
            const SizedBox(height: 6),
            _buildRow('Delivery Partner Tip', '₹$_selectedTip'),
          ],
          if (_discountAmount > 0) ...[
            const SizedBox(height: 6),
            _buildRow('Coupon Savings', '-₹$_discountAmount', isGreen: true),
          ],
          const Divider(height: 20, color: GroceryTheme.borderLight),
          _buildRow('To Pay', '₹$_finalTotal', isBold: true),
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
            const Text('Select Delivery Location', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
            const SizedBox(height: 12),
            ListTile(
              leading: const Icon(Icons.home_rounded, color: GroceryTheme.primaryGreenDark),
              title: const Text('Home (Civil Lines)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
              subtitle: const Text('Flat 402, Civil Lines Hub, North Delhi', style: TextStyle(fontSize: 11)),
              onTap: () {
                setState(() {
                  _selectedAddressLabel = 'Home';
                  _selectedAddressDetails = 'Flat 402, Civil Lines Hub, North Delhi, 110054';
                });
                Navigator.pop(ctx);
              },
            ),
            ListTile(
              leading: const Icon(Icons.work_rounded, color: GroceryTheme.primaryGreenDark),
              title: const Text('Work (Connaught Place)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
              subtitle: const Text('Block B Office, Inner Circle, CP', style: TextStyle(fontSize: 11)),
              onTap: () {
                setState(() {
                  _selectedAddressLabel = 'Work';
                  _selectedAddressDetails = 'Block B Office, Inner Circle, Connaught Place';
                });
                Navigator.pop(ctx);
              },
            ),
          ],
        ),
      ),
    );
  }
}
