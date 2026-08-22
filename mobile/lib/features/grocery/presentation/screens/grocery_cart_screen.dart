import 'package:flutter/material.dart';
import '../theme/grocery_theme.dart';
import 'grocery_checkout_screen.dart';

class GroceryCartScreen extends StatefulWidget {
  const GroceryCartScreen({super.key});

  @override
  State<GroceryCartScreen> createState() => _GroceryCartScreenState();
}

class _GroceryCartScreenState extends State<GroceryCartScreen> {
  String _selectedAddress = 'Civil Lines, Delhi • Flat 402';
  int _selectedTip = 20;

  final List<Map<String, dynamic>> _cartItems = [
    {
      'id': 'c1',
      'name': 'Organic Bananas (Robusta)',
      'weight': '500g',
      'price': 35,
      'mrp': 50,
      'quantity': 2,
      'emoji': '🍌',
      'bgColor': const Color(0xFFFEF9C3),
    },
    {
      'id': 'c2',
      'name': 'Amul Taaza Fresh Toned Milk',
      'weight': '1L Pouch',
      'price': 56,
      'mrp': 60,
      'quantity': 1,
      'emoji': '🥛',
      'bgColor': const Color(0xFFE0F2FE),
    },
    {
      'id': 'c3',
      'name': 'Vine-Ripened Tomatoes',
      'weight': '500g',
      'price': 25,
      'mrp': 40,
      'quantity': 1,
      'emoji': '🍅',
      'bgColor': const Color(0xFFFEE2E2),
    },
  ];

  void _updateQuantity(int idx, int delta) {
    setState(() {
      final current = _cartItems[idx]['quantity'] as int;
      final newQty = current + delta;
      if (newQty <= 0) {
        _cartItems.removeAt(idx);
      } else {
        _cartItems[idx]['quantity'] = newQty;
      }
    });
  }

  int get _itemSubtotal {
    return _cartItems.fold(0, (sum, item) {
      final p = item['price'] as int;
      final q = item['quantity'] as int;
      return sum + (p * q);
    });
  }

  @override
  Widget build(BuildContext context) {
    final subtotal = _itemSubtotal;
    const handlingFee = 2;
    final totalAmount = subtotal + handlingFee + _selectedTip;

    return Scaffold(
      backgroundColor: GroceryTheme.bgOffWhite,
      appBar: AppBar(
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Your M3 Grocery Cart', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: GroceryTheme.textDark)),
            Text('⚡ 10-Minute Express Checkout', style: TextStyle(fontSize: 11, color: GroceryTheme.textMuted)),
          ],
        ),
      ),
      body: _cartItems.isEmpty
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    padding: const EdgeInsets.all(24),
                    decoration: const BoxDecoration(
                      color: GroceryTheme.primaryGreenLight,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.shopping_bag_outlined, size: 54, color: GroceryTheme.primaryGreenDark),
                  ),
                  const SizedBox(height: 16),
                  const Text('Your Grocery Cart is Empty', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: GroceryTheme.textDark)),
                  const SizedBox(height: 6),
                  const Text('Explore fresh veggies, dairy & snacks with 10-min delivery!', style: TextStyle(color: GroceryTheme.textMuted, fontSize: 12)),
                  const SizedBox(height: 20),
                  ElevatedButton(
                    onPressed: () {},
                    style: ElevatedButton.styleFrom(
                      backgroundColor: GroceryTheme.primaryGreenDark,
                      minimumSize: const Size(180, 44),
                    ),
                    child: const Text('Browse Products'),
                  ),
                ],
              ),
            )
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // 10-Min Guarantee Pill Banner
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: const Color(0xFFECFDF5),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: const Color(0xFFA7F3D0)),
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(8),
                          decoration: const BoxDecoration(
                            color: GroceryTheme.primaryGreenDark,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.bolt_rounded, color: Colors.white, size: 20),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Delivering in 10 Minutes ⚡', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: GroceryTheme.primaryGreenDark)),
                              Text('To: $_selectedAddress', style: const TextStyle(fontSize: 11.5, color: GroceryTheme.textDark)),
                            ],
                          ),
                        ),
                        TextButton(
                          onPressed: _showAddressPicker,
                          child: const Text('Change', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: GroceryTheme.primaryGreenDark)),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 18),

                  // Cart Items List
                  const Text('Cart Items', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: GroceryTheme.textDark)),
                  const SizedBox(height: 10),

                  ...List.generate(_cartItems.length, (idx) {
                    final item = _cartItems[idx];
                    final qty = item['quantity'] as int;
                    final price = item['price'] as int;

                    return Container(
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: GroceryTheme.borderLight),
                      ),
                      child: Row(
                        children: [
                          Container(
                            width: 50,
                            height: 50,
                            decoration: BoxDecoration(
                              color: item['bgColor'] as Color,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Center(
                              child: Text(item['emoji'] as String, style: const TextStyle(fontSize: 26)),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(item['name'] as String, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: GroceryTheme.textDark)),
                                Text('${item['weight']} • ₹$price each', style: const TextStyle(fontSize: 11, color: GroceryTheme.textMuted)),
                              ],
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: GroceryTheme.primaryGreenLight,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: GroceryTheme.primaryGreenDark.withValues(alpha: 0.3)),
                            ),
                            child: Row(
                              children: [
                                InkWell(
                                  onTap: () => _updateQuantity(idx, -1),
                                  child: const Icon(Icons.remove, size: 16, color: GroceryTheme.primaryGreenDark),
                                ),
                                Padding(
                                  padding: const EdgeInsets.symmetric(horizontal: 8),
                                  child: Text('$qty', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: GroceryTheme.primaryGreenDark)),
                                ),
                                InkWell(
                                  onTap: () => _updateQuantity(idx, 1),
                                  child: const Icon(Icons.add, size: 16, color: GroceryTheme.primaryGreenDark),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 10),
                          Text('₹${price * qty}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: GroceryTheme.textDark)),
                        ],
                      ),
                    );
                  }),

                  const SizedBox(height: 16),

                  // Delivery Partner Tip
                  const Text('Delivery Partner Tip', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: GroceryTheme.textDark)),
                  const SizedBox(height: 4),
                  const Text('100% of tip goes directly to your express delivery driver', style: TextStyle(fontSize: 11, color: GroceryTheme.textMuted)),
                  const SizedBox(height: 10),

                  Row(
                    children: [10, 20, 30, 50].map((tip) {
                      final isSel = _selectedTip == tip;
                      return Expanded(
                        child: GestureDetector(
                          onTap: () => setState(() => _selectedTip = tip),
                          child: Container(
                            margin: const EdgeInsets.only(right: 6),
                            padding: const EdgeInsets.symmetric(vertical: 8),
                            decoration: BoxDecoration(
                              color: isSel ? GroceryTheme.primaryGreenDark : Colors.white,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: isSel ? GroceryTheme.primaryGreenDark : GroceryTheme.borderLight),
                            ),
                            child: Center(
                              child: Text(
                                '₹$tip',
                                style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 12,
                                  color: isSel ? Colors.white : GroceryTheme.textDark,
                                ),
                              ),
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),

                  const SizedBox(height: 20),

                  // Bill Details Summary Card
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: GroceryTheme.borderLight),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Bill Summary', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: GroceryTheme.textDark)),
                        const SizedBox(height: 12),
                        _buildBillRow('Items Subtotal', '₹$subtotal'),
                        const SizedBox(height: 6),
                        _buildBillRow('Delivery Fee (10-Min Express)', 'FREE', isGreen: true),
                        const SizedBox(height: 6),
                        _buildBillRow('Handling Fee', '₹$handlingFee'),
                        if (_selectedTip > 0) ...[
                          const SizedBox(height: 6),
                          _buildBillRow('Delivery Partner Tip', '₹$_selectedTip'),
                        ],
                        const Divider(height: 20),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text('To Pay', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: GroceryTheme.textDark)),
                            Text('₹$totalAmount', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 20, color: GroceryTheme.primaryGreenDark)),
                          ],
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 24),

                  // Big Express Checkout Button
                  ElevatedButton(
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => GroceryCheckoutScreen(
                            cartItems: _cartItems,
                            subtotal: subtotal,
                            handlingFee: handlingFee,
                          ),
                        ),
                      );
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: GroceryTheme.primaryGreenDark,
                      foregroundColor: Colors.white,
                      minimumSize: const Size(double.infinity, 54),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text('₹$totalAmount', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
                            const Text('TOTAL • PAY ONLINE / COD', style: TextStyle(fontSize: 9.5, color: Colors.white70)),
                          ],
                        ),
                        const Row(
                          children: [
                            Text('Place Express Order', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14)),
                            SizedBox(width: 6),
                            Icon(Icons.arrow_forward_rounded, size: 18),
                          ],
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 24),
                ],
              ),
            ),
    );
  }

  Widget _buildBillRow(String label, String value, {bool isGreen = false}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(fontSize: 12.5, color: GroceryTheme.textMuted)),
        Text(
          value,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.bold,
            color: isGreen ? GroceryTheme.primaryGreenDark : GroceryTheme.textDark,
          ),
        ),
      ],
    );
  }

  void _showAddressPicker() {
    final addresses = [
      'Civil Lines, Delhi • Flat 402',
      'Connaught Place, Delhi • Block B Office',
      'Kamla Nagar Market, Delhi • Shop 14',
    ];

    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Select Delivery Address', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
            const SizedBox(height: 12),
            ...addresses.map((addr) => ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.location_on_rounded, color: GroceryTheme.primaryGreenDark),
              title: Text(addr, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
              onTap: () {
                setState(() => _selectedAddress = addr);
                Navigator.pop(ctx);
              },
            )),
          ],
        ),
      ),
    );
  }
}
