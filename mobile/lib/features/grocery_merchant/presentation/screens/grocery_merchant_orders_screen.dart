import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/network/nabin_api_service.dart';
import 'package:mobile/core/network/session_manager.dart';
import '../providers/grocery_merchant_auth_provider.dart';
import '../theme/grocery_merchant_theme.dart';
import 'grocery_merchant_order_detail_screen.dart';

/// Orders Screen for NABIN Grocery Merchant App
class GroceryMerchantOrdersScreen extends ConsumerStatefulWidget {
  const GroceryMerchantOrdersScreen({super.key});

  @override
  ConsumerState<GroceryMerchantOrdersScreen> createState() => _GroceryMerchantOrdersScreenState();
}

class _GroceryMerchantOrdersScreenState extends ConsumerState<GroceryMerchantOrdersScreen> {
  bool _isLoading = true;
  List<dynamic> _orders = [];
  String? _errorMessage;
  String _selectedStatus = 'ALL';

  final List<String> _statusFilters = [
    'ALL',
    'NEW',
    'ACCEPTED',
    'PICKING',
    'PACKING',
    'READY_FOR_PICKUP',
    'DELIVERED',
    'REJECTED',
    'CANCELLED',
  ];

  @override
  void initState() {
    super.initState();
    _loadOrders();
  }

  Future<void> _loadOrders() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final session = SessionManager.instance.currentUser;
      final merchantId = session?['id'] ?? 'mcht_1';

      final result = await NabinApiService.getMerchantOrders(merchantId);
      
      if (result?['success'] == true) {
        setState(() {
          _orders = result?['orders'] as List<dynamic>? ?? [];
          _isLoading = false;
        });
      } else {
        setState(() {
          _isLoading = false;
          _errorMessage = result?['error'] ?? 'Failed to load orders';
        });
      }
    } catch (e) {
      setState(() {
        _isLoading = false;
        _errorMessage = 'Network error. Please check your connection.';
      });
    }
  }

  List<dynamic> get _filteredOrders {
    if (_selectedStatus == 'ALL') return _orders;
    return _orders.where((order) => order['order_state'] == _selectedStatus).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: GroceryMerchantTheme.bgOffWhite,
      appBar: AppBar(
        backgroundColor: GroceryMerchantTheme.primaryGreen,
        elevation: 0,
        title: const Text(
          'Orders',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w800,
            color: Colors.white,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white),
            onPressed: _loadOrders,
          ),
        ],
      ),
      body: Column(
        children: [
          // Status Filter Chips
          Container(
            height: 50,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: _statusFilters.map((status) {
                final isSelected = _selectedStatus == status;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: FilterChip(
                    label: Text(
                      status.replaceAll('_', ' '),
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: isSelected ? Colors.white : GroceryMerchantTheme.textDark,
                      ),
                    ),
                    selected: isSelected,
                    onSelected: (selected) {
                      setState(() => _selectedStatus = status);
                    },
                    selectedColor: GroceryMerchantTheme.primaryGreen,
                    backgroundColor: Colors.white,
                    side: BorderSide(
                      color: isSelected ? GroceryMerchantTheme.primaryGreen : GroceryMerchantTheme.borderLight,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(20),
                    ),
                  ),
                );
              }).toList(),
            ),
          ),

          // Orders List
          Expanded(
            child: _isLoading
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
                              onPressed: _loadOrders,
                              style: ElevatedButton.styleFrom(
                                backgroundColor: GroceryMerchantTheme.primaryGreen,
                              ),
                              child: const Text('Retry'),
                            ),
                          ],
                        ),
                      )
                    : _filteredOrders.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(
                                  Icons.inbox_outlined,
                                  size: 48,
                                  color: GroceryMerchantTheme.textMuted.withValues(alpha: 0.3),
                                ),
                                const SizedBox(height: 16),
                                Text(
                                  _selectedStatus == 'ALL' ? 'No orders yet' : 'No $_selectedStatus orders',
                                  style: TextStyle(
                                    fontSize: 16,
                                    color: GroceryMerchantTheme.textMuted,
                                  ),
                                ),
                              ],
                            ),
                          )
                        : RefreshIndicator(
                            onRefresh: _loadOrders,
                            child: ListView.builder(
                              padding: const EdgeInsets.all(16),
                              itemCount: _filteredOrders.length,
                              itemBuilder: (context, index) {
                                final order = _filteredOrders[index];
                                return _buildOrderCard(order);
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
  }

  Widget _buildOrderCard(Map<String, dynamic> order) {
    final status = order['order_state'] ?? 'UNKNOWN';
    final statusColor = _getOrderStatusColor(status);
    final statusText = _getOrderStatusText(status);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
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
      child: InkWell(
        onTap: () {
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => GroceryMerchantOrderDetailScreen(
                orderId: order['id']?.toString() ?? order['order_number']?.toString() ?? '',
              ),
            ),
          );
        },
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header Row
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Order #${order['order_number'] ?? order['id'] ?? 'N/A'}',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: GroceryMerchantTheme.textDark,
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: statusColor.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      statusText,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: statusColor,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // Order Details
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Customer: ${order['customer_name'] ?? 'Unknown'}',
                          style: TextStyle(
                            fontSize: 13,
                            color: GroceryMerchantTheme.textMuted,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Items: ${order['items_count'] ?? (order['lines']?.length ?? 0)}',
                          style: TextStyle(
                            fontSize: 13,
                            color: GroceryMerchantTheme.textMuted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        '₹${(order['total_amount'] ?? 0).toStringAsFixed(0)}',
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                          color: GroceryMerchantTheme.textDark,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _formatTime(order['created_at']),
                        style: TextStyle(
                          fontSize: 11,
                          color: GroceryMerchantTheme.textMuted,
                        ),
                      ),
                    ],
                  ),
                ],
              ),

              // Action Buttons for active orders
              if (_isActionableStatus(status)) ...[
                const SizedBox(height: 12),
                const Divider(height: 1),
                const SizedBox(height: 12),
                _buildActionButtons(order, status),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildActionButtons(Map<String, dynamic> order, String status) {
    final orderId = order['id'];
    final merchantId = order['merchant_id'] ?? 'mcht_1';

    if (status == 'NEW') {
      return Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () => _updateOrderStatus(orderId, merchantId, 'REJECTED'),
              icon: const Icon(Icons.close, size: 16),
              label: const Text('Reject'),
              style: OutlinedButton.styleFrom(
                foregroundColor: GroceryMerchantTheme.accentRose,
                side: BorderSide(color: GroceryMerchantTheme.accentRose),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: ElevatedButton.icon(
              onPressed: () => _updateOrderStatus(orderId, merchantId, 'ACCEPTED'),
              icon: const Icon(Icons.check, size: 16),
              label: const Text('Accept Order'),
              style: ElevatedButton.styleFrom(
                backgroundColor: GroceryMerchantTheme.primaryGreen,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
            ),
          ),
        ],
      );
    } else if (status == 'ACCEPTED') {
      return Row(
        children: [
          Expanded(
            child: ElevatedButton.icon(
              onPressed: () => _updateOrderStatus(orderId, merchantId, 'PICKING'),
              icon: const Icon(Icons.shopping_basket, size: 16),
              label: const Text('Start Picking'),
              style: ElevatedButton.styleFrom(
                backgroundColor: GroceryMerchantTheme.accentAmber,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
            ),
          ),
        ],
      );
    } else if (status == 'PICKING') {
      return Row(
        children: [
          Expanded(
            child: ElevatedButton.icon(
              onPressed: () => _updateOrderStatus(orderId, merchantId, 'PACKING'),
              icon: const Icon(Icons.inventory_2, size: 16),
              label: const Text('Start Packing'),
              style: ElevatedButton.styleFrom(
                backgroundColor: GroceryMerchantTheme.primaryGreen,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
            ),
          ),
        ],
      );
    } else if (status == 'PACKING') {
      return Row(
        children: [
          Expanded(
            child: ElevatedButton.icon(
              onPressed: () => _updateOrderStatus(orderId, merchantId, 'READY_FOR_PICKUP'),
              icon: const Icon(Icons.check_circle, size: 16),
              label: const Text('Ready for Pickup'),
              style: ElevatedButton.styleFrom(
                backgroundColor: GroceryMerchantTheme.primaryGreen,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
            ),
          ),
        ],
      );
    }

    return const SizedBox.shrink();
  }

  bool _isActionableStatus(String status) {
    return ['NEW', 'ACCEPTED', 'PICKING', 'PACKING'].contains(status);
  }

  Future<void> _updateOrderStatus(String orderId, String merchantId, String newStatus) async {
    // Show confirmation dialog for rejection
    if (newStatus == 'REJECTED') {
      final reason = await _showRejectionDialog();
      if (reason == null) return;
      
      final result = await NabinApiService.updateMerchantOrderStatus(
        restaurantId: merchantId,
        orderId: orderId,
        status: newStatus,
      );
      
      if (result?['success'] == true) {
        _loadOrders();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Order rejected: $reason'),
              backgroundColor: GroceryMerchantTheme.accentRose,
            ),
          );
        }
      }
    } else {
      final result = await NabinApiService.updateMerchantOrderStatus(
        restaurantId: merchantId,
        orderId: orderId,
        status: newStatus,
      );
      
      if (result?['success'] == true) {
        _loadOrders();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Order status updated to ${_getOrderStatusText(newStatus)}'),
              backgroundColor: GroceryMerchantTheme.primaryGreen,
            ),
          );
        }
      }
    }
  }

  Future<String?> _showRejectionDialog() async {
    final reasons = [
      'ITEM_UNAVAILABLE',
      'MERCHANT_CLOSED',
      'OUT_OF_STOCK',
      'UNABLE_TO_PREPARE',
      'INVALID_ORDER',
      'OTHER',
    ];

    String? selectedReason;

    return showDialog<String>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Reject Order'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: reasons.map((reason) {
              return RadioListTile<String>(
                title: Text(reason.replaceAll('_', ' ')),
                value: reason,
                groupValue: selectedReason,
                onChanged: (value) {
                  setState(() => selectedReason = value);
                },
              );
            }).toList(),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: selectedReason != null
                  ? () => Navigator.pop(context, selectedReason)
                  : null,
              style: ElevatedButton.styleFrom(
                backgroundColor: GroceryMerchantTheme.accentRose,
              ),
              child: const Text('Reject'),
            ),
          ],
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

  String _formatTime(String? isoString) {
    if (isoString == null) return '';
    try {
      final date = DateTime.parse(isoString);
      final now = DateTime.now();
      final diff = now.difference(date);
      
      if (diff.inMinutes < 1) return 'Just now';
      if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
      if (diff.inHours < 24) return '${diff.inHours}h ago';
      return '${diff.inDays}d ago';
    } catch (_) {
      return '';
    }
  }
}