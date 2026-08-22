import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/restaurant_theme.dart';

class RestaurantMainShell extends StatefulWidget {
  const RestaurantMainShell({super.key});

  @override
  State<RestaurantMainShell> createState() => _RestaurantMainShellState();
}

class _RestaurantMainShellState extends State<RestaurantMainShell> {
  int _currentTab = 0; // 0: Dashboard, 1: Orders (KDS), 2: Menu/Inventory, 3: Analytics/Finance, 4: Profile
  String _merchantMode = 'RESTAURANT'; // 'RESTAURANT' or 'GROCERY'
  String _storeStatus = 'OPEN'; // 'OPEN', 'CLOSED', 'TEMPORARILY UNAVAILABLE'
  String _ordersFilter = 'Active'; // 'Active' or 'History'

  // Live Orders matching KDS pipeline
  final List<Map<String, dynamic>> _orders = [
    {
      'id': '1042',
      'customer': 'Sarah Jenkins',
      'time': '4 mins ago',
      'type': 'Delivery',
      'status': 'NEW', // 'NEW', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP', 'COMPLETED'
      'items': [
        {'name': 'Truffle Burger', 'qty': 2, 'done': false, 'notes': 'Medium rare, extra pickles'},
        {'name': 'Sweet Potato Fries', 'qty': 1, 'done': false, 'notes': 'With garlic aioli'},
        {'name': 'Diet Coke', 'qty': 1, 'done': false, 'notes': ''},
      ],
      'total': '₹580.00',
      'pickupOtp': '4892',
      'driver': 'Looking for driver...',
    },
    {
      'id': '1041',
      'customer': 'Marcus Chen',
      'time': '12 mins ago',
      'type': 'Takeaway',
      'status': 'PREPARING',
      'items': [
        {'name': 'Margherita Pizza', 'qty': 1, 'done': true, 'notes': 'Thin crust'},
        {'name': 'Caesar Salad', 'qty': 1, 'done': false, 'notes': 'Dressing on side'},
      ],
      'total': '₹420.00',
      'pickupOtp': '7729',
      'driver': 'Assigned: Deepak Auto (DL 1RA 4892)',
    },
    {
      'id': '1040',
      'customer': 'Elena Rostova',
      'time': '18 mins ago',
      'type': 'Delivery',
      'status': 'READY',
      'items': [
        {'name': 'Chicken Tikka Roll', 'qty': 2, 'done': true, 'notes': 'Spicy mint chutney'},
        {'name': 'Mango Lassi', 'qty': 2, 'done': true, 'notes': ''},
      ],
      'total': '₹340.00',
      'pickupOtp': '3391',
      'driver': 'Driver Arrived at Counter',
    },
  ];

  // Menu Catalog
  final List<Map<String, dynamic>> _menuItems = [
    {
      'id': '1',
      'name': 'Special Dum Biryani (Chicken)',
      'category': 'Rice & Biryani',
      'desc': 'Slow-cooked fragrant basmati rice with marinated chicken & royal saffron spices.',
      'price': 220,
      'inStock': true,
      'isVeg': false,
      'isRecommended': true,
      'imageUrl': 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=600&q=80',
    },
    {
      'id': '2',
      'name': 'Paneer Tikka Butter Masala',
      'category': 'Main Course',
      'desc': 'Charcoal grilled cottage cheese simmered in velvety makhani gravy.',
      'price': 180,
      'inStock': true,
      'isVeg': true,
      'isRecommended': true,
      'imageUrl': 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=600&q=80',
    },
    {
      'id': '3',
      'name': 'Garlic Butter Naan (2 Pcs)',
      'category': 'Breads',
      'desc': 'Crisp tandoori bread brushed with fresh garlic & golden butter.',
      'price': 40,
      'inStock': true,
      'isVeg': true,
      'isRecommended': false,
      'imageUrl': 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=600&q=80',
    },
    {
      'id': '4',
      'name': 'Tandoori Malai Chaap Tikka',
      'category': 'Starters',
      'desc': 'Smoky soya chaap infused with cardamom cream and mint dip.',
      'price': 160,
      'inStock': true,
      'isVeg': true,
      'isRecommended': false,
      'imageUrl': 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=600&q=80',
    },
    {
      'id': '5',
      'name': 'Hot Gulab Jamun with Rabri',
      'category': 'Desserts',
      'desc': 'Melt-in-mouth milk dumplings served warm with rich thickened rabri.',
      'price': 90,
      'inStock': false,
      'isVeg': true,
      'isRecommended': true,
      'imageUrl': 'https://images.unsplash.com/photo-1541781774459-bb2af2f05b55?w=600&q=80',
    },
  ];

  // Incoming Order Modal Alert
  void _showIncomingOrderDialog() {
    int countdown = 45;
    int selectedPrep = 20;
    Timer? timer;

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            timer ??= Timer.periodic(const Duration(seconds: 1), (t) {
              if (countdown > 0) {
                setModalState(() => countdown--);
              } else {
                t.cancel();
                if (Navigator.of(ctx).canPop()) Navigator.of(ctx).pop();
              }
            });

            return Dialog(
              backgroundColor: RestaurantTheme.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20), side: const BorderSide(color: RestaurantTheme.border)),
              insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Header
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(color: RestaurantTheme.neonOrangeLight, shape: BoxShape.circle),
                              child: const Icon(Icons.notifications_active, color: RestaurantTheme.neonOrange, size: 22),
                            ),
                            const SizedBox(width: 10),
                            const Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('NEW INCOMING ORDER', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: RestaurantTheme.neonOrange, letterSpacing: 1.0)),
                                Text('#1043', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                              ],
                            ),
                          ],
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                          decoration: BoxDecoration(
                            color: RestaurantTheme.neonOrangeLight,
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(color: RestaurantTheme.neonOrange),
                          ),
                          child: Text('${countdown}s', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: RestaurantTheme.neonOrangeDark)),
                        ),
                      ],
                    ),
                    const Divider(height: 24, color: RestaurantTheme.border),

                    // Customer & Items
                    const Text('Customer: David K. • Home Delivery', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: RestaurantTheme.charcoal)),
                    const SizedBox(height: 10),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: RestaurantTheme.lightBg,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: RestaurantTheme.border),
                      ),
                      child: const Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('2x Special Dum Biryani', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5, color: RestaurantTheme.charcoal)),
                          SizedBox(height: 4),
                          Text('1x Paneer Butter Masala', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5, color: RestaurantTheme.charcoal)),
                          SizedBox(height: 6),
                          Text('Special Note: Please provide extra green mint chutney.', style: TextStyle(fontSize: 11.5, color: RestaurantTheme.neonOrangeDark, fontStyle: FontStyle.italic)),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Prep Time Selector
                    const Text('Estimated Preparation Time:', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: RestaurantTheme.secondaryText)),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [15, 20, 30, 45].map((m) {
                        final isSel = selectedPrep == m;
                        return ChoiceChip(
                          label: Text('${m}m'),
                          selected: isSel,
                          selectedColor: RestaurantTheme.neonOrange,
                          labelStyle: TextStyle(color: isSel ? Colors.white : RestaurantTheme.charcoal, fontWeight: FontWeight.bold),
                          onSelected: (val) {
                            if (val) setModalState(() => selectedPrep = m);
                          },
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 20),

                    // Buttons
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            style: OutlinedButton.styleFrom(
                              foregroundColor: RestaurantTheme.nonVegRed,
                              side: const BorderSide(color: RestaurantTheme.nonVegRed),
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            ),
                            onPressed: () {
                              timer?.cancel();
                              Navigator.of(ctx).pop();
                            },
                            child: const Text('Reject', style: TextStyle(fontWeight: FontWeight.w800)),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          flex: 2,
                          child: ElevatedButton(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: RestaurantTheme.neonOrange,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            ),
                            onPressed: () {
                              timer?.cancel();
                              Navigator.of(ctx).pop();
                              setState(() {
                                _orders.insert(0, {
                                  'id': '1043',
                                  'customer': 'David K.',
                                  'time': 'Just now',
                                  'type': 'Delivery',
                                  'status': 'ACCEPTED',
                                  'items': [
                                    {'name': 'Special Dum Biryani', 'qty': 2, 'done': false, 'notes': 'Extra raita'},
                                    {'name': 'Paneer Butter Masala', 'qty': 1, 'done': false, 'notes': ''},
                                  ],
                                  'total': '₹620.00',
                                  'pickupOtp': '5519',
                                  'driver': 'Searching for nearby driver...',
                                });
                                _currentTab = 1;
                              });
                            },
                            child: const Text('Accept Order', style: TextStyle(fontWeight: FontWeight.w900)),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  // 1. DASHBOARD TAB
  Widget _buildDashboardTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Store Status Bar
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: RestaurantTheme.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: RestaurantTheme.border),
              boxShadow: [
                BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 6, offset: const Offset(0, 2)),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Store Status', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                        const SizedBox(height: 2),
                        Text(
                          _storeStatus == 'OPEN'
                              ? 'Accepting incoming live orders'
                              : _storeStatus == 'CLOSED'
                                  ? 'Currently closed'
                                  : 'Temporarily paused (kitchen busy)',
                          style: const TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText),
                        ),
                      ],
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: _storeStatus == 'OPEN'
                            ? RestaurantTheme.vegGreen.withValues(alpha: 0.12)
                            : _storeStatus == 'CLOSED'
                                ? const Color(0xFFF1F5F9)
                                : RestaurantTheme.warning.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        _storeStatus,
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w900,
                          color: _storeStatus == 'OPEN'
                              ? RestaurantTheme.vegGreen
                              : _storeStatus == 'CLOSED'
                                  ? RestaurantTheme.secondaryText
                                  : const Color(0xFFB45309),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    _buildStatusChoice('OPEN', Icons.check_circle_outline, RestaurantTheme.vegGreen),
                    const SizedBox(width: 8),
                    _buildStatusChoice('CLOSED', Icons.cancel_outlined, RestaurantTheme.secondaryText),
                    const SizedBox(width: 8),
                    _buildStatusChoice('PAUSED', Icons.pause_circle_outline, RestaurantTheme.warning),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Bento Grid Metrics (3 Cards)
          _buildMetricBentoCard(
            title: 'TODAY\'S REVENUE',
            value: '₹3,450.00',
            subtext: '+15% vs yesterday',
            icon: Icons.payments_rounded,
          ),
          const SizedBox(height: 10),
          _buildMetricBentoCard(
            title: 'TOTAL ORDERS',
            value: '28',
            subtext: '3 active in kitchen pipeline',
            icon: Icons.receipt_long_rounded,
          ),
          const SizedBox(height: 10),
          _buildMetricBentoCard(
            title: 'AVG. PREP TIME',
            value: '16 mins',
            subtext: 'Optimal kitchen efficiency',
            icon: Icons.timer_rounded,
          ),
          const SizedBox(height: 20),

          // Live Orders Header
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  const Text('Live Kitchen Queue', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: RestaurantTheme.neonOrangeLight,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text('${_orders.where((o) => o['status'] != 'COMPLETED').length} ACTIVE', style: const TextStyle(fontSize: 9.5, fontWeight: FontWeight.w900, color: RestaurantTheme.neonOrangeDark)),
                  ),
                ],
              ),
              TextButton(
                onPressed: () => setState(() => _currentTab = 1),
                child: const Text('View All (KDS) →', style: TextStyle(fontWeight: FontWeight.w800, color: RestaurantTheme.neonOrange, fontSize: 12)),
              ),
            ],
          ),
          const SizedBox(height: 10),

          // Active Orders Cards
          ..._orders.where((o) => o['status'] != 'COMPLETED').map((order) => _buildStitchOrderCard(order)),
        ],
      ),
    );
  }

  Widget _buildStatusChoice(String statusKey, IconData icon, Color color) {
    final isSelected = (_storeStatus == statusKey) || (statusKey == 'PAUSED' && _storeStatus == 'TEMPORARILY UNAVAILABLE');
    return Expanded(
      child: InkWell(
        onTap: () {
          setState(() {
            _storeStatus = statusKey == 'PAUSED' ? 'TEMPORARILY UNAVAILABLE' : statusKey;
          });
        },
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: isSelected ? color.withValues(alpha: 0.12) : RestaurantTheme.lightBg,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: isSelected ? color : RestaurantTheme.border, width: 1.2),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 14, color: isSelected ? color : RestaurantTheme.secondaryText),
              const SizedBox(width: 4),
              Text(
                statusKey,
                style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: isSelected ? color : RestaurantTheme.secondaryText),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMetricBentoCard({required String title, required String value, required String subtext, required IconData icon}) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: RestaurantTheme.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: RestaurantTheme.border),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.02), blurRadius: 6, offset: const Offset(0, 2)),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: RestaurantTheme.secondaryText, letterSpacing: 0.5)),
              const SizedBox(height: 6),
              Text(value, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
              const SizedBox(height: 2),
              Text(subtext, style: const TextStyle(fontSize: 11, color: RestaurantTheme.secondaryText, fontWeight: FontWeight.w500)),
            ],
          ),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: RestaurantTheme.neonOrange.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, size: 24, color: RestaurantTheme.neonOrange),
          ),
        ],
      ),
    );
  }

  // 2. KDS ORDERS TAB
  Widget _buildOrdersKdsTab() {
    return Column(
      children: [
        // Controls Header
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          color: RestaurantTheme.white,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  ChoiceChip(
                    label: const Text('Active Queue'),
                    selected: _ordersFilter == 'Active',
                    selectedColor: RestaurantTheme.neonOrange,
                    labelStyle: TextStyle(color: _ordersFilter == 'Active' ? Colors.white : RestaurantTheme.charcoal, fontWeight: FontWeight.w800, fontSize: 12),
                    onSelected: (val) => setState(() => _ordersFilter = 'Active'),
                  ),
                  const SizedBox(width: 8),
                  ChoiceChip(
                    label: const Text('Completed History'),
                    selected: _ordersFilter == 'History',
                    selectedColor: RestaurantTheme.neonOrange,
                    labelStyle: TextStyle(color: _ordersFilter == 'History' ? Colors.white : RestaurantTheme.charcoal, fontWeight: FontWeight.w800, fontSize: 12),
                    onSelected: (val) => setState(() => _ordersFilter = 'History'),
                  ),
                ],
              ),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: RestaurantTheme.neonOrange,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  elevation: 0,
                ),
                icon: const Icon(Icons.flash_on, size: 14, color: Colors.white),
                label: const Text('Simulate Order', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                onPressed: _showIncomingOrderDialog,
              ),
            ],
          ),
        ),
        const Divider(height: 1, color: RestaurantTheme.border),

        // Orders List
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: _orders.length,
            itemBuilder: (context, index) => _buildStitchOrderCard(_orders[index]),
          ),
        ),
      ],
    );
  }

  Widget _buildStitchOrderCard(Map<String, dynamic> order) {
    Color statusBg = RestaurantTheme.neonOrangeLight;
    Color statusText = RestaurantTheme.neonOrangeDark;
    String statusLabel = 'PREPARING';

    final status = order['status'] as String;
    if (status == 'NEW') {
      statusBg = const Color(0xFFFFE4E6);
      statusText = RestaurantTheme.nonVegRed;
      statusLabel = 'NEW ORDER';
    } else if (status == 'ACCEPTED') {
      statusBg = const Color(0xFFFEF3C7);
      statusText = const Color(0xFFB45309);
      statusLabel = 'ACCEPTED';
    } else if (status == 'READY') {
      statusBg = RestaurantTheme.vegGreen.withValues(alpha: 0.12);
      statusText = RestaurantTheme.vegGreen;
      statusLabel = 'READY FOR PICKUP';
    } else if (status == 'COMPLETED') {
      statusBg = const Color(0xFFF1F5F9);
      statusText = RestaurantTheme.secondaryText;
      statusLabel = 'DELIVERED';
    }

    final items = order['items'] as List<dynamic>;

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        color: RestaurantTheme.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: RestaurantTheme.border),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.02), blurRadius: 6, offset: const Offset(0, 2)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Order Header
          Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Text('#${order['id']}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                    const SizedBox(width: 8),
                    Text(order['time'], style: const TextStyle(fontSize: 11, color: RestaurantTheme.secondaryText)),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(color: statusBg, borderRadius: BorderRadius.circular(8)),
                  child: Text(statusLabel, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: statusText)),
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: RestaurantTheme.border),

          // Customer Row
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(order['customer'], style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: RestaurantTheme.charcoal)),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(color: RestaurantTheme.lightBg, borderRadius: BorderRadius.circular(4)),
                  child: Text(order['type'], style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.bold, color: RestaurantTheme.secondaryText)),
                ),
              ],
            ),
          ),

          // Items List with Checkboxes
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: Column(
              children: items.map((item) {
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Row(
                    children: [
                      Checkbox(
                        value: item['done'] ?? false,
                        activeColor: RestaurantTheme.neonOrange,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
                        onChanged: (val) {
                          setState(() => item['done'] = val);
                        },
                      ),
                      Expanded(
                        child: Text(
                          '${item['qty']}x ${item['name']}',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: (item['done'] ?? false) ? RestaurantTheme.secondaryText : RestaurantTheme.charcoal,
                            decoration: (item['done'] ?? false) ? TextDecoration.lineThrough : null,
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              }).toList(),
            ),
          ),

          // Driver info & OTP
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(order['driver'], style: const TextStyle(fontSize: 11, color: RestaurantTheme.secondaryText, fontStyle: FontStyle.italic)),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(color: RestaurantTheme.neonOrangeLight, borderRadius: BorderRadius.circular(6)),
                  child: Text('OTP: ${order['pickupOtp']}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: RestaurantTheme.neonOrangeDark)),
                ),
              ],
            ),
          ),

          // Action Button
          Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                Expanded(
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: status == 'NEW' || status == 'ACCEPTED'
                          ? RestaurantTheme.neonOrange
                          : status == 'PREPARING'
                              ? RestaurantTheme.vegGreen
                              : RestaurantTheme.charcoal,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      elevation: 0,
                    ),
                    onPressed: () {
                      setState(() {
                        if (status == 'NEW') order['status'] = 'ACCEPTED';
                        else if (status == 'ACCEPTED') order['status'] = 'PREPARING';
                        else if (status == 'PREPARING') order['status'] = 'READY';
                        else if (status == 'READY') order['status'] = 'COMPLETED';
                      });
                    },
                    child: Text(
                      status == 'NEW'
                          ? 'Accept & Prepare'
                          : status == 'ACCEPTED'
                              ? 'Start Cooking'
                              : status == 'PREPARING'
                                  ? 'Mark Ready for Pickup'
                                  : 'Handover to Rider',
                      style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 12),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: RestaurantTheme.charcoal,
                    side: const BorderSide(color: RestaurantTheme.border),
                    padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  onPressed: () {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('KOT Ticket printed for Order #${order['id']}')),
                    );
                  },
                  child: const Text('Print KOT', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // 3. MENU MANAGEMENT TAB
  Widget _buildMenuTab() {
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          color: RestaurantTheme.white,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Menu Catalog', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: RestaurantTheme.neonOrange,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  elevation: 0,
                ),
                icon: const Icon(Icons.add, size: 16, color: Colors.white),
                label: const Text('Add Dish', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                onPressed: () {},
              ),
            ],
          ),
        ),
        const Divider(height: 1, color: RestaurantTheme.border),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: _menuItems.length,
            itemBuilder: (context, index) {
              final item = _menuItems[index];
              final inStock = item['inStock'] as bool;
              final isVeg = item['isVeg'] as bool;

              return Container(
                margin: const EdgeInsets.only(bottom: 14),
                decoration: BoxDecoration(
                  color: RestaurantTheme.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: inStock ? RestaurantTheme.border : const Color(0xFFFFDAD6)),
                  boxShadow: [
                    BoxShadow(color: Colors.black.withValues(alpha: 0.02), blurRadius: 6, offset: const Offset(0, 2)),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Dish Image Banner with Availability Badge
                    ClipRRect(
                      borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
                      child: Stack(
                        children: [
                          Image.network(
                            item['imageUrl'] as String,
                            height: 130,
                            width: double.infinity,
                            fit: BoxFit.cover,
                            color: inStock ? null : Colors.grey,
                            colorBlendMode: inStock ? null : BlendMode.saturation,
                            errorBuilder: (context, error, stackTrace) => Container(
                              height: 130,
                              color: RestaurantTheme.lightBg,
                              child: const Center(child: Icon(Icons.fastfood_rounded, size: 36, color: RestaurantTheme.neonOrange)),
                            ),
                          ),
                          Positioned(
                            top: 8,
                            right: 8,
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(
                                color: inStock ? Colors.white : const Color(0xFFFFDAD6),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: inStock ? RestaurantTheme.vegGreen : RestaurantTheme.nonVegRed),
                              ),
                              child: Text(
                                inStock ? '● In Stock' : 'Out of Stock',
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w800,
                                  color: inStock ? RestaurantTheme.vegGreen : RestaurantTheme.nonVegRed,
                                ),
                              ),
                            ),
                          ),
                          Positioned(
                            top: 8,
                            left: 8,
                            child: Container(
                              padding: const EdgeInsets.all(2.5),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(4),
                                border: Border.all(color: isVeg ? RestaurantTheme.vegGreen : RestaurantTheme.nonVegRed, width: 1.2),
                              ),
                              child: Icon(
                                Icons.fiber_manual_record,
                                color: isVeg ? RestaurantTheme.vegGreen : RestaurantTheme.nonVegRed,
                                size: 8,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),

                    // Dish Details & Stock Switch
                    Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Text(
                                  item['name'] as String,
                                  style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14.5, color: RestaurantTheme.charcoal),
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: RestaurantTheme.neonOrangeLight,
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  '₹${item['price']}',
                                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: RestaurantTheme.neonOrangeDark),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            item['desc'] as String,
                            style: const TextStyle(fontSize: 11.5, color: RestaurantTheme.secondaryText),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 10),
                          const Divider(height: 1, color: RestaurantTheme.border),
                          const SizedBox(height: 8),

                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: RestaurantTheme.lightBg,
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  item['category'] as String,
                                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: RestaurantTheme.secondaryText),
                                ),
                              ),
                              Row(
                                children: [
                                  Text(
                                    inStock ? 'Available' : 'Disabled',
                                    style: TextStyle(
                                      fontSize: 11.5,
                                      fontWeight: FontWeight.bold,
                                      color: inStock ? RestaurantTheme.charcoal : RestaurantTheme.nonVegRed,
                                    ),
                                  ),
                                  const SizedBox(width: 6),
                                  Switch(
                                    value: inStock,
                                    activeColor: RestaurantTheme.neonOrange,
                                    onChanged: (val) {
                                      setState(() => item['inStock'] = val);
                                    },
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  // 4. FINANCE TAB
  Widget _buildFinanceTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: RestaurantTheme.charcoal,
              borderRadius: BorderRadius.circular(18),
              boxShadow: [BoxShadow(color: RestaurantTheme.charcoal.withValues(alpha: 0.25), blurRadius: 10)],
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('TOTAL PAYOUT BALANCE', style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w900, color: RestaurantTheme.neonOrange, letterSpacing: 0.5)),
                SizedBox(height: 6),
                Text('₹18,420.50', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: Colors.white)),
                SizedBox(height: 6),
                Text('Auto-settles daily at 08:00 AM to HDFC Bank (•••• 1092)', style: TextStyle(fontSize: 11.5, color: Color(0xFF94A3B8))),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: RestaurantTheme.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: RestaurantTheme.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Recent Daily Settlements', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: RestaurantTheme.charcoal)),
                const SizedBox(height: 12),
                _buildSettlementRow('Yesterday (21 Aug)', '₹4,120.00', 'PAID TO BANK'),
                _buildSettlementRow('20 Aug 2026', '₹5,890.00', 'PAID TO BANK'),
                _buildSettlementRow('19 Aug 2026', '₹3,750.00', 'PAID TO BANK'),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSettlementRow(String date, String amount, String status) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(date, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold, color: RestaurantTheme.charcoal)),
              Text(status, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: RestaurantTheme.vegGreen)),
            ],
          ),
          Text(amount, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
        ],
      ),
    );
  }

  // 5. PROFILE TAB
  Widget _buildProfileTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: RestaurantTheme.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: RestaurantTheme.border),
            ),
            child: const Row(
              children: [
                Icon(Icons.storefront_rounded, size: 36, color: RestaurantTheme.neonOrange),
                SizedBox(width: 14),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Dilli Darbar Mughlai Kitchen', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                    Text('FSSAI: 1002001928491 • Verified Partner', style: TextStyle(fontSize: 11, color: RestaurantTheme.vegGreen, fontWeight: FontWeight.bold)),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          OutlinedButton(
            onPressed: () => context.go('/home'),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(double.infinity, 48),
              side: const BorderSide(color: RestaurantTheme.neonOrange),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.swap_horiz_rounded, color: RestaurantTheme.neonOrange),
                SizedBox(width: 8),
                Text('Switch to Customer Super-App', style: TextStyle(fontWeight: FontWeight.bold, color: RestaurantTheme.neonOrange)),
              ],
            ),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isRestaurant = _merchantMode == 'RESTAURANT';
    final primaryAccent = isRestaurant ? RestaurantTheme.neonOrange : const Color(0xFF22A447);
    final primaryLight = isRestaurant ? RestaurantTheme.neonOrangeLight : const Color(0xFFE8F5E9);

    return Scaffold(
      backgroundColor: RestaurantTheme.lightBg,
      appBar: AppBar(
        backgroundColor: RestaurantTheme.charcoal,
        elevation: 0,
        leading: IconButton(
          icon: Icon(isRestaurant ? Icons.restaurant_rounded : Icons.storefront_rounded, color: primaryAccent),
          onPressed: () {},
        ),
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'NABIN',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w900,
                color: Colors.white,
                letterSpacing: 1.0,
              ),
            ),
            const SizedBox(width: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: primaryAccent,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                isRestaurant ? 'RESTAURANT' : 'GROCERY',
                style: const TextStyle(fontSize: 9.5, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: 0.5),
              ),
            ),
          ],
        ),
        centerTitle: true,
        actions: [
          IconButton(
            icon: Icon(Icons.notifications_active_rounded, color: primaryAccent),
            onPressed: _showIncomingOrderDialog,
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            color: RestaurantTheme.charcoalDark,
            child: Container(
              padding: const EdgeInsets.all(3),
              decoration: BoxDecoration(
                color: Colors.black45,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.white12),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: GestureDetector(
                      onTap: () => setState(() => _merchantMode = 'RESTAURANT'),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        decoration: BoxDecoration(
                          color: isRestaurant ? RestaurantTheme.neonOrange : Colors.transparent,
                          borderRadius: BorderRadius.circular(9),
                        ),
                        alignment: Alignment.center,
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Text('🍽️', style: TextStyle(fontSize: 12)),
                            const SizedBox(width: 6),
                            Text(
                              'Restaurant KDS',
                              style: TextStyle(
                                fontWeight: FontWeight.w900,
                                fontSize: 12,
                                color: isRestaurant ? Colors.white : Colors.white60,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: GestureDetector(
                      onTap: () => setState(() => _merchantMode = 'GROCERY'),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        decoration: BoxDecoration(
                          color: !isRestaurant ? const Color(0xFF22A447) : Colors.transparent,
                          borderRadius: BorderRadius.circular(9),
                        ),
                        alignment: Alignment.center,
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Text('🛒', style: TextStyle(fontSize: 12)),
                            const SizedBox(width: 6),
                            Text(
                              'Grocery DarkStore',
                              style: TextStyle(
                                fontWeight: FontWeight.w900,
                                fontSize: 12,
                                color: !isRestaurant ? Colors.white : Colors.white60,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
      body: [
        _buildDashboardTab(),
        _buildOrdersKdsTab(),
        _buildMenuTab(),
        _buildFinanceTab(),
        _buildProfileTab(),
      ][_currentTab],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentTab,
        onDestinationSelected: (idx) => setState(() => _currentTab = idx),
        backgroundColor: RestaurantTheme.white,
        indicatorColor: primaryLight,
        destinations: [
          NavigationDestination(icon: const Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard_rounded, color: primaryAccent), label: 'Dashboard'),
          NavigationDestination(icon: const Icon(Icons.receipt_long_outlined), selectedIcon: Icon(Icons.receipt_long_rounded, color: primaryAccent), label: isRestaurant ? 'Orders (KDS)' : 'Orders'),
          NavigationDestination(icon: Icon(isRestaurant ? Icons.restaurant_menu_outlined : Icons.inventory_2_outlined), selectedIcon: Icon(isRestaurant ? Icons.restaurant_menu_rounded : Icons.inventory_2_rounded, color: primaryAccent), label: isRestaurant ? 'Menu' : 'Products'),
          NavigationDestination(icon: const Icon(Icons.insights_outlined), selectedIcon: Icon(Icons.insights_rounded, color: primaryAccent), label: 'Finance'),
          NavigationDestination(icon: const Icon(Icons.person_outline), selectedIcon: Icon(Icons.person_rounded, color: primaryAccent), label: 'Profile'),
        ],
      ),
    );
  }
}
