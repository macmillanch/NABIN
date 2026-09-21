import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/network/nabin_api_service.dart';
import 'package:mobile/core/network/session_manager.dart';
import '../providers/grocery_merchant_auth_provider.dart';
import '../theme/grocery_merchant_theme.dart';

/// Dashboard Screen for NABIN Grocery Merchant App
class GroceryMerchantDashboard extends ConsumerStatefulWidget {
  const GroceryMerchantDashboard({super.key});

  @override
  ConsumerState<GroceryMerchantDashboard> createState() => _GroceryMerchantDashboardState();
}

class _GroceryMerchantDashboardState extends ConsumerState<GroceryMerchantDashboard> {
  bool _isLoading = true;
  Map<String, dynamic>? _dashboardData;
  String? _errorMessage;
  Timer? _refreshTimer;
  int _unreadNotifications = 0;

  /// The dashboard payload spans every service the store runs, and this is the
  /// grocery console, so its figures come from GROCERY lines only — the same
  /// rule the grocery web console applies.
  List<dynamic> get _groceryOrders => (_dashboardData?['orders'] as List? ?? const [])
      .where((order) => order is Map && order['service_type'] == 'GROCERY')
      .toList();

  int get _activeGroceryOrders => _groceryOrders
      .where((order) => !['DELIVERED', 'REJECTED', 'CANCELLED'].contains(order['order_state']))
      .length;

  double get _salesOnRecord => _groceryOrders.fold<double>(
        0,
        (sum, order) => ['REJECTED', 'CANCELLED'].contains(order['order_state'])
            ? sum
            : sum + ((order['total_amount'] as num?)?.toDouble() ?? 0),
      );

  @override
  void initState() {
    super.initState();
    _loadDashboardData();
    // Auto-refresh every 30 seconds
    _refreshTimer = Timer.periodic(const Duration(seconds: 30), (timer) {
      _loadDashboardData();
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadDashboardData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      // Get merchant ID from session
      final session = SessionManager.instance.currentUser;
      final merchantId = session?['id'];
      if (merchantId == null) throw Exception('No merchant session found');

      final result = await NabinApiService.getMerchantDashboard(merchantId);
      
      if (result?['success'] == true) {
        // The feed endpoint answers with the unread count, so the bell stays
        // honest without a second round trip when there is nothing to read.
        final feed = await NabinApiService.getNotifications(limit: 1, unreadOnly: true);
        int unread = 0;
        if (feed != null && feed['success'] == true) {
          unread = (feed['unreadCount'] as num?)?.toInt() ?? 0;
        }
        if (!mounted) return;
        setState(() {
          _dashboardData = result;
          _unreadNotifications = unread;
          _isLoading = false;
        });
      } else {
        setState(() {
          _isLoading = false;
          _errorMessage = result?['error'] ?? 'Failed to load dashboard';
        });
      }
    } catch (e) {
      setState(() {
        _isLoading = false;
        _errorMessage = 'Network error. Please check your connection.';
      });
    }
  }

  Future<void> _refreshData() async {
    await _loadDashboardData();
  }

  Future<void> _confirmLogout() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Log out?'),
        content: const Text('You will need to sign in again to manage your store.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: GroceryMerchantTheme.accentRose,
            ),
            child: const Text('Log out'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    ref.read(groceryMerchantAuthProvider.notifier).logout();
    Navigator.of(context).pushNamedAndRemoveUntil('/login', (route) => false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: GroceryMerchantTheme.bgOffWhite,
      appBar: AppBar(
        backgroundColor: GroceryMerchantTheme.primaryGreen,
        elevation: 0,
        title: const Text(
          'Merchant Dashboard',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w800,
            color: Colors.white,
          ),
        ),
        actions: [
          IconButton(
            icon: Badge(
              isLabelVisible: _unreadNotifications > 0,
              label: Text('$_unreadNotifications'),
              backgroundColor: GroceryMerchantTheme.accentRose,
              child: const Icon(Icons.notifications_none, color: Colors.white),
            ),
            tooltip: 'Notifications',
            onPressed: () => Navigator.of(context).pushNamed('/notifications'),
          ),
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white),
            onPressed: _refreshData,
          ),
          IconButton(
            icon: const Icon(Icons.logout, color: Colors.white),
            onPressed: _confirmLogout,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(
              child: CircularProgressIndicator(
                color: GroceryMerchantTheme.primaryGreen,
              ),
            )
          : _errorMessage != null
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        _errorMessage!,
                        style: TextStyle(
                          color: GroceryMerchantTheme.accentRose,
                          fontSize: 16,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: _loadDashboardData,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: GroceryMerchantTheme.primaryGreen,
                        ),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _refreshData,
                  child: SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Welcome Section
                        Text(
                          'Welcome back, ${_dashboardData?['restaurant']?['name'] ?? 'Merchant'}!',
                          style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w800,
                            color: GroceryMerchantTheme.textDark,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Here\'s your store overview',
                          style: TextStyle(
                            fontSize: 16,
                            color: GroceryMerchantTheme.textMuted,
                          ),
                        ),
                        const SizedBox(height: 32),

                        // Stats Cards
                        Row(
                          children: [
                            Expanded(
                              child: _buildStatCard(
                                'Active Orders',
                                '$_activeGroceryOrders',
                                Icons.shopping_bag_outlined,
                                GroceryMerchantTheme.primaryGreen,
                              ),
                            ),
                            const SizedBox(width: 16),
                            Expanded(
                              child: _buildStatCard(
                                'Sales on record',
                                '₹${_salesOnRecord.toStringAsFixed(0)}',
                                Icons.attach_money,
                                GroceryMerchantTheme.primaryGreen,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 24),

                        // Quick Actions
                        const Text(
                          'Quick Actions',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                            color: GroceryMerchantTheme.textDark,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Row(
                          children: [
                            Expanded(
                              child: _buildActionButton(
                                'New Orders',
                                Icons.inbox,
                                () => Navigator.of(context).pushNamed('/orders'),
                                GroceryMerchantTheme.primaryGreen,
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: _buildActionButton(
                                'Inventory',
                                Icons.inventory_2_outlined,
                                () => Navigator.of(context).pushNamed('/inventory'),
                                GroceryMerchantTheme.primaryGreen,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        Row(
                          children: [
                            Expanded(
                              child: _buildActionButton(
                                'Price Management',
                                Icons.price_change_outlined,
                                () => Navigator.of(context).pushNamed('/price-management'),
                                GroceryMerchantTheme.primaryGreen,
                              ),
                            ),
                            const SizedBox(width: 12),
                            // Kept as a spacer so Price Management matches the tile width above.
                            const Expanded(child: SizedBox.shrink()),
                          ],
                        ),
                        const SizedBox(height: 32),

                        // Recent Orders Section
                        const Text(
                          'Recent Orders',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                            color: GroceryMerchantTheme.textDark,
                          ),
                        ),
                        const SizedBox(height: 16),
                        _buildRecentOrdersList(),
                      ],
                    ),
                  ),
                ),
      bottomNavigationBar: _buildBottomNavigationBar(),
    );
  }

  Widget _buildStatCard(String label, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: color, size: 28),
          const SizedBox(height: 8),
          Text(
            value,
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w800,
              color: GroceryMerchantTheme.textDark,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 14,
              color: GroceryMerchantTheme.textMuted,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActionButton(String label, IconData icon, VoidCallback onPressed, Color color) {
    return ElevatedButton(
      onPressed: onPressed,
      style: ElevatedButton.styleFrom(
        backgroundColor: color.withValues(alpha: 0.1),
        foregroundColor: color,
        padding: const EdgeInsets.all(16),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        side: BorderSide(color: color.withValues(alpha: 0.2)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 24),
          const SizedBox(height: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildRecentOrdersList() {
    final orders = _groceryOrders;
    if (orders.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Icon(
              Icons.inbox_outlined,
              size: 48,
              color: GroceryMerchantTheme.textMuted.withValues(alpha: 0.3),
            ),
            const SizedBox(height: 16),
            Text(
              'No recent orders',
              style: TextStyle(
                fontSize: 16,
                color: GroceryMerchantTheme.textMuted,
              ),
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: orders.length > 5 ? 5 : orders.length,
      itemBuilder: (context, index) {
        final order = orders[index];
        return _buildOrderItem(order);
      },
    );
  }

  Widget _buildOrderItem(Map<String, dynamic> order) {
    final orderId = order['id']?.toString() ?? order['order_number']?.toString();

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: orderId == null || orderId.isEmpty
              ? null
              : () => Navigator.of(context).pushNamed('/orders/${Uri.encodeComponent(orderId)}'),
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.02),
                  blurRadius: 4,
                  offset: const Offset(0, 1),
                ),
              ],
              border: Border.all(
                color: GroceryMerchantTheme.borderLight,
                width: 1,
              ),
            ),
            child: Row(
              children: [
                // Order Info
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Order #${order['order_number'] ?? order['id'] ?? 'N/A'}',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: GroceryMerchantTheme.textDark,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '₹${(order['total_amount'] ?? 0).toStringAsFixed(0)}',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w800,
                          color: GroceryMerchantTheme.primaryGreen,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _getOrderStatusText(order['order_state'] ?? 'UNKNOWN'),
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: _getOrderStatusColor(order['order_state'] ?? 'UNKNOWN'),
                        ),
                      ),
                    ],
                  ),
                ),
                // Status Indicator
                Container(
                  width: 12,
                  height: 12,
                  decoration: BoxDecoration(
                    color: _getOrderStatusColor(order['order_state'] ?? 'UNKNOWN'),
                    borderRadius: BorderRadius.circular(6),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _getOrderStatusText(String status) {
    switch (status) {
      case 'NEW':
        return 'New Order';
      case 'ACCEPTED':
        return 'Accepted';
      case 'REJECTED':
        return 'Rejected';
      case 'PICKING':
        return 'Picking Items';
      case 'PACKING':
        return 'Packing';
      case 'READY_FOR_PICKUP':
        return 'Ready for Pickup';
      case 'DELIVERED':
        return 'Delivered';
      case 'CANCELLED':
        return 'Cancelled';
      default:
        return status;
    }
  }

  Color _getOrderStatusColor(String status) {
    switch (status) {
      case 'NEW':
        return const Color(0xFFE11D48); // Rose 600
      case 'ACCEPTED':
        return GroceryMerchantTheme.primaryGreen;
      case 'REJECTED':
        return GroceryMerchantTheme.accentRose;
      case 'PICKING':
        return const Color(0xFF2563EB); // Blue 600
      case 'PACKING':
        return GroceryMerchantTheme.accentAmber;
      case 'READY_FOR_PICKUP':
        return GroceryMerchantTheme.primaryGreen;
      case 'DELIVERED':
        return GroceryMerchantTheme.primaryGreen;
      case 'CANCELLED':
        return GroceryMerchantTheme.textMuted;
      default:
        return GroceryMerchantTheme.textMuted;
    }
  }

  Widget _buildBottomNavigationBar() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: GroceryMerchantTheme.borderLight, width: 1)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, -3),
          ),
        ],
      ),
      child: NavigationBar(
        selectedIndex: 0,
        onDestinationSelected: (index) => _handleNavigation(index),
        backgroundColor: Colors.white,
        indicatorColor: GroceryMerchantTheme.primaryGreenLight,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home_rounded, color: GroceryMerchantTheme.primaryGreenDark),
            label: 'Dashboard',
          ),
          NavigationDestination(
            icon: Icon(Icons.inbox_outlined),
            selectedIcon: Icon(Icons.inbox_rounded, color: GroceryMerchantTheme.primaryGreenDark),
            label: 'Orders',
          ),
          NavigationDestination(
            icon: Icon(Icons.inventory_2_outlined),
            selectedIcon: Icon(Icons.inventory_2_rounded, color: GroceryMerchantTheme.primaryGreenDark),
            label: 'Inventory',
          ),
        ],
      ),
    );
  }

  void _handleNavigation(int index) {
    switch (index) {
      case 0:
        // Already on dashboard
        break;
      case 1:
        Navigator.of(context).pushNamed('/orders');
        break;
      case 2:
        Navigator.of(context).pushNamed('/inventory');
        break;
    }
  }
}
