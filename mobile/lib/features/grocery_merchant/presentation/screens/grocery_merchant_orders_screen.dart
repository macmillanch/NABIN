import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/network/nabin_api_service.dart';
import 'package:mobile/core/network/session_manager.dart';
import '../theme/grocery_merchant_theme.dart';
import '../utils/grocery_order_flow.dart';
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
  String? _busyOrderId;

  /// Values must match `orders.order_state` in migration 018 — there is no NEW or PICKING state.
  final List<String> _statusFilters = [
    'ALL',
    'RECEIVED',
    'ACCEPTED',
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

  Future<void> _loadOrders({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _isLoading = true;
        _errorMessage = null;
      });
    }

    try {
      final session = SessionManager.instance.currentUser;
      final merchantId = session?['id'];
      if (merchantId == null) {
        setState(() {
          _isLoading = false;
          _errorMessage = 'Your session has expired. Please sign in again.';
        });
        return;
      }

      final result = await NabinApiService.getMerchantOrders(merchantId);

      if (result?['success'] == true) {
        setState(() {
          _orders = result?['orders'] as List<dynamic>? ?? [];
          _errorMessage = null;
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
    final statusColor = groceryOrderStatusColor(status);
    final statusText = groceryOrderStatusLabel(status);

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
                          'Customer ref: ${_customerReference(order['customer_id'])}',
                          style: TextStyle(
                            fontSize: 13,
                            color: GroceryMerchantTheme.textMuted,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Items: ${(order['lines'] as List?)?.length ?? 0}',
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
              if (groceryMerchantActions(status).isNotEmpty) ...[
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
    final actions = groceryMerchantActions(status);
    if (actions.isEmpty) return const SizedBox.shrink();
    final busy = _busyOrderId != null && _busyOrderId == order['id'];

    return Row(
      children: [
        for (var i = 0; i < actions.length; i++) ...[
          if (i > 0) const SizedBox(width: 12),
          Expanded(child: _buildActionButton(order, actions[i], busy)),
        ],
      ],
    );
  }

  Widget _buildActionButton(Map<String, dynamic> order, GroceryMerchantAction action, bool busy) {
    final onPressed = busy ? null : () => _performAction(order, action);
    final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(8));

    if (action.danger) {
      return OutlinedButton.icon(
        onPressed: onPressed,
        icon: const Icon(Icons.close, size: 16),
        label: Text(action.label),
        style: OutlinedButton.styleFrom(
          foregroundColor: GroceryMerchantTheme.accentRose,
          side: const BorderSide(color: GroceryMerchantTheme.accentRose),
          shape: shape,
        ),
      );
    }

    return ElevatedButton.icon(
      onPressed: onPressed,
      icon: const Icon(Icons.check, size: 16),
      label: Text(action.label),
      style: ElevatedButton.styleFrom(
        backgroundColor: GroceryMerchantTheme.primaryGreen,
        foregroundColor: Colors.white,
        shape: shape,
      ),
    );
  }

  Future<void> _performAction(Map<String, dynamic> order, GroceryMerchantAction action) async {
    String? reason;
    if (action.status == 'REJECTED') {
      reason = await _showRejectionDialog();
      if (reason == null) return;
    }

    final updated = await _updateOrderStatus(
      order['id']?.toString() ?? '',
      action.status,
      reason: reason,
    );
    if (!updated || !mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(reason == null
            ? '${action.label} confirmed.'
            : 'Order rejected (${groceryRejectionReasonLabel(reason)}).'),
        backgroundColor:
            action.danger ? GroceryMerchantTheme.accentRose : GroceryMerchantTheme.primaryGreen,
      ),
    );
  }

  Future<bool> _updateOrderStatus(String orderId, String status, {String? reason}) async {
    final session = SessionManager.instance.currentUser;
    final merchantId = session?['id'];
    if (merchantId == null || orderId.isEmpty) return false;

    setState(() => _busyOrderId = orderId);
    try {
      final result = await NabinApiService.updateMerchantOrderStatus(
        restaurantId: merchantId,
        orderId: orderId,
        status: status,
        reason: reason,
      );
      if (result?['success'] == true) {
        await _loadOrders(silent: true);
        return true;
      }
      _showError(result?['error'] ?? 'The platform rejected this status change.');
      return false;
    } catch (e) {
      _showError('Network error. The order status did not change.');
      return false;
    } finally {
      if (mounted) setState(() => _busyOrderId = null);
    }
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: GroceryMerchantTheme.accentRose),
    );
  }

  Future<String?> _showRejectionDialog() async {
    String? selectedReason;

    return showDialog<String>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Reject Order'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: kGroceryRejectionReasons.map((reason) {
              return RadioListTile<String>(
                title: Text(groceryRejectionReasonLabel(reason)),
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

  /// Orders expose only `customer_id`; there is no customer name or phone on the
  /// order row, so the merchant sees a stable reference instead of an invented name.
  String _customerReference(dynamic customerId) {
    final value = customerId?.toString() ?? '';
    if (value.isEmpty) return 'Unavailable';
    return '#${value.replaceAll('-', '').substring(value.length > 6 ? value.length - 6 : 0)}';
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