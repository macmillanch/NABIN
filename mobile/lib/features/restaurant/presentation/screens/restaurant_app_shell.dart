import 'package:flutter/material.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/glass_container.dart';

class RestaurantAppShell extends StatefulWidget {
  const RestaurantAppShell({super.key});

  @override
  State<RestaurantAppShell> createState() => _RestaurantAppShellState();
}

class _RestaurantAppShellState extends State<RestaurantAppShell> {
  int _currentTab = 0;
  bool _isStoreOpen = true;

  final List<Map<String, dynamic>> _kitchenOrders = [
    {
      'id': 'ORD-9821',
      'customer': 'Rahul Sharma',
      'items': '2x Special Dum Biryani, 2x Garlic Butter Naan',
      'total': '₹560',
      'status': 'PREPARING',
      'timer': '12 mins left',
      'driver': 'Assigned (Deepak - Bike)',
      'isVeg': false,
    },
    {
      'id': 'ORD-9824',
      'customer': 'Priya Singh',
      'items': '1x Paneer Tikka Masala, 3x Butter Roti',
      'total': '₹240',
      'status': 'NEW',
      'timer': 'Action Needed',
      'driver': 'Looking for courier...',
      'isVeg': true,
    },
    {
      'id': 'ORD-9819',
      'customer': 'Ankit Gupta',
      'items': '1x Chicken Kebab Platter, 2x Filter Coffee',
      'total': '₹390',
      'status': 'READY',
      'timer': 'Driver Arrived at Counter',
      'driver': 'Arrived (Rajesh - Auto)',
      'isVeg': false,
    },
  ];

  final List<Map<String, dynamic>> _menuItems = [
    {'id': '1', 'name': 'Special Dum Biryani (Chicken)', 'category': 'Biryani & Rice', 'price': 220, 'isVeg': false, 'inStock': true},
    {'id': '2', 'name': 'Paneer Tikka Butter Masala', 'category': 'Main Course', 'price': 180, 'isVeg': true, 'inStock': true},
    {'id': '3', 'name': 'Garlic Butter Naan', 'category': 'Breads', 'price': 30, 'isVeg': true, 'inStock': true},
    {'id': '4', 'name': 'Mutton Seekh Kebab (4 pcs)', 'category': 'Starters', 'price': 290, 'isVeg': false, 'inStock': false},
  ];

  Widget _buildDashboardTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: _isStoreOpen ? const Color(0x2600E676) : const Color(0x26FF1744),
              borderRadius: BorderRadius.circular(22),
              border: Border.all(
                color: _isStoreOpen ? const Color(0xFF00E676) : const Color(0xFFFF1744),
                width: 1.5,
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: _isStoreOpen ? const Color(0xFF00E676) : const Color(0xFFFF1744),
                      ),
                      child: Icon(_isStoreOpen ? Icons.storefront : Icons.store_mall_directory_outlined, color: Colors.black, size: 22),
                    ),
                    const SizedBox(width: 14),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _isStoreOpen ? 'KITCHEN IS OPEN' : 'KITCHEN IS CLOSED',
                          style: TextStyle(
                            fontWeight: FontWeight.w900,
                            color: _isStoreOpen ? const Color(0xFF00E676) : const Color(0xFFFF1744),
                            fontSize: 15,
                          ),
                        ),
                        Text(_isStoreOpen ? 'Accepting online food orders' : 'Temporarily paused', style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                      ],
                    ),
                  ],
                ),
                Switch(
                  value: _isStoreOpen,
                  activeThumbColor: const Color(0xFF00E676),
                  onChanged: (val) => setState(() => _isStoreOpen = val),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          Row(
            children: [
              Expanded(
                child: GlassContainer(
                  padding: const EdgeInsets.all(16),
                  borderRadius: BorderRadius.circular(18),
                  child: const Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text("TODAY'S SALES", style: TextStyle(color: AppTheme.restaurantAccent, fontSize: 11, fontWeight: FontWeight.bold)),
                      SizedBox(height: 4),
                      Text("₹4,890", style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: Colors.white)),
                      SizedBox(height: 2),
                      Text("18 Orders Delivered", style: TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: GlassContainer(
                  padding: const EdgeInsets.all(16),
                  borderRadius: BorderRadius.circular(18),
                  child: const Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text("AVG PREP TIME", style: TextStyle(color: AppTheme.restaurantReady, fontSize: 11, fontWeight: FontWeight.bold)),
                      SizedBox(height: 4),
                      Text("14 mins", style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: Colors.white)),
                      SizedBox(height: 2),
                      Text("99.4% On-Time", style: TextStyle(color: Color(0xFF00E676), fontSize: 11, fontWeight: FontWeight.bold)),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 40),
        ],
      ),
    );
  }

  Widget _buildOrdersTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Live Kitchen Display', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Colors.white)),
          const SizedBox(height: 16),

          ..._kitchenOrders.map((order) {
            final isNew = order['status'] == 'NEW';
            final isPrep = order['status'] == 'PREPARING';
            final isReady = order['status'] == 'READY';

            return Container(
              margin: const EdgeInsets.only(bottom: 16),
              child: GlassContainer(
                padding: const EdgeInsets.all(18),
                borderRadius: BorderRadius.circular(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(order['id'] as String, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: AppTheme.restaurantAccent)),
                        Text(order['timer'] as String, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.restaurantReady)),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Text(order['items'] as String, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: Colors.white)),
                    const SizedBox(height: 4),
                    Text('Customer: ${order['customer']} • ${order['total']}', style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                    const SizedBox(height: 14),
                    if (isNew)
                      ElevatedButton(
                        onPressed: () => setState(() => order['status'] = 'PREPARING'),
                        style: ElevatedButton.styleFrom(backgroundColor: AppTheme.restaurantAccent, foregroundColor: Colors.white),
                        child: const Text('Accept & Cook', style: TextStyle(fontWeight: FontWeight.bold)),
                      ),
                    if (isPrep)
                      ElevatedButton(
                        onPressed: () => setState(() => order['status'] = 'READY'),
                        style: ElevatedButton.styleFrom(backgroundColor: AppTheme.restaurantReady, foregroundColor: Colors.black),
                        child: const Text('Mark Ready for Pickup', style: TextStyle(fontWeight: FontWeight.bold)),
                      ),
                    if (isReady)
                      const Text('✓ Ready for Driver Handover (OTP)', style: TextStyle(color: Color(0xFF00E676), fontWeight: FontWeight.bold, fontSize: 12)),
                  ],
                ),
              ),
            );
          }),
          const SizedBox(height: 40),
        ],
      ),
    );
  }

  Widget _buildMenuTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Menu & Stock Manager', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Colors.white)),
          const SizedBox(height: 16),

          ..._menuItems.map((dish) {
            final inStock = dish['inStock'] as bool;
            return Container(
              margin: const EdgeInsets.only(bottom: 12),
              child: GlassContainer(
                padding: const EdgeInsets.all(16),
                borderRadius: BorderRadius.circular(18),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(dish['name'] as String, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Colors.white)),
                          const SizedBox(height: 2),
                          Text('${dish['category']} • ₹${dish['price']}', style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                        ],
                      ),
                    ),
                    Switch(
                      value: inStock,
                      activeThumbColor: const Color(0xFF00E676),
                      onChanged: (val) => setState(() => dish['inStock'] = val),
                    ),
                  ],
                ),
              ),
            );
          }),
          const SizedBox(height: 40),
        ],
      ),
    );
  }

  Widget _buildEarningsTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Financials & Payouts', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Colors.white)),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(22),
              gradient: const LinearGradient(colors: [Color(0xFF1A237E), Color(0xFF283593)]),
              border: Border.all(color: AppTheme.glassBorder),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('NET WEEKLY SETTLEMENT (PENDING)', style: TextStyle(color: AppTheme.restaurantReady, fontSize: 11, fontWeight: FontWeight.bold, letterSpacing: 1.0)),
                SizedBox(height: 6),
                Text('₹28,450', style: TextStyle(fontSize: 34, fontWeight: FontWeight.w900, color: Colors.white)),
                SizedBox(height: 4),
                Text('Direct Deposit to HDFC Bank **** 4892 on Monday', style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
              ],
            ),
          ),
          const SizedBox(height: 40),
        ],
      ),
    );
  }

  Widget _buildProfileTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          GlassContainer(
            padding: const EdgeInsets.all(20),
            borderRadius: BorderRadius.circular(22),
            child: const Row(
              children: [
                CircleAvatar(
                  radius: 28,
                  backgroundColor: AppTheme.restaurantAccent,
                  child: Icon(Icons.restaurant, color: Colors.white, size: 28),
                ),
                SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Dilli Darbar Mughlai Kitchen', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: Colors.white)),
                      SizedBox(height: 2),
                      Text('FSSAI: 1002001928491 • GST Verified', style: TextStyle(color: Color(0xFF00E676), fontSize: 12, fontWeight: FontWeight.bold)),
                      SizedBox(height: 2),
                      Text('Civil Lines, North Campus, Delhi', style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 40),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: AppTheme.restaurantTheme,
      child: Scaffold(
        backgroundColor: AppTheme.backgroundDark,
        appBar: AppBar(
          backgroundColor: const Color(0xFF0F1321),
          elevation: 0,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back, color: Colors.white),
            onPressed: () => Navigator.of(context).pop(),
          ),
          title: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(6),
                decoration: const BoxDecoration(
                  color: AppTheme.restaurantAccent,
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.restaurant, color: Colors.white, size: 16),
              ),
              const SizedBox(width: 10),
              const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('NABIN Restaurant Partner', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: Colors.white)),
                  Text('Merchant Console', style: TextStyle(fontSize: 11, color: AppTheme.restaurantReady, fontWeight: FontWeight.bold)),
                ],
              ),
            ],
          ),
        ),
        body: IndexedStack(
          index: _currentTab,
          children: [
            _buildDashboardTab(),
            _buildOrdersTab(),
            _buildMenuTab(),
            _buildEarningsTab(),
            _buildProfileTab(),
          ],
        ),
        bottomNavigationBar: Container(
          decoration: const BoxDecoration(
            color: Color(0xFF0B0E14),
            border: Border(top: BorderSide(color: AppTheme.glassBorder)),
          ),
          child: BottomNavigationBar(
            currentIndex: _currentTab,
            onTap: (index) => setState(() => _currentTab = index),
            backgroundColor: Colors.transparent,
            selectedItemColor: AppTheme.restaurantAccent,
            unselectedItemColor: AppTheme.textSecondary,
            type: BottomNavigationBarType.fixed,
            items: const [
              BottomNavigationBarItem(icon: Icon(Icons.dashboard_rounded), label: 'Dashboard'),
              BottomNavigationBarItem(icon: Icon(Icons.soup_kitchen_rounded), label: 'Orders'),
              BottomNavigationBarItem(icon: Icon(Icons.menu_book_rounded), label: 'Menu'),
              BottomNavigationBarItem(icon: Icon(Icons.account_balance_rounded), label: 'Earnings'),
              BottomNavigationBarItem(icon: Icon(Icons.storefront_rounded), label: 'Profile'),
            ],
          ),
        ),
      ),
    );
  }
}
