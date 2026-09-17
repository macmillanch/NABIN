import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/network/nabin_api_service.dart';
import 'package:mobile/core/network/session_manager.dart';
import '../providers/grocery_merchant_auth_provider.dart';
import '../theme/grocery_merchant_theme.dart';

/// Order Detail Screen for NABIN Grocery Merchant App
class GroceryMerchantOrderDetailScreen extends ConsumerStatefulWidget {
  final String orderId;

  const GroceryMerchantOrderDetailScreen({
    super.key,
    required this.orderId,
  });

  @override
  ConsumerState<GroceryMerchantOrderDetailScreen> createState() => _GroceryMerchantOrderDetailScreenState();
}

class _GroceryMerchantOrderDetailScreenState extends ConsumerState<GroceryMerchantOrderDetailScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _order;
  String? _errorMessage;
  String? _rejectionReason;

  @override
  void initState() {
    super.initState();
    _loadOrderDetail();
  }

  Future<void> _loadOrderDetail() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final session = SessionManager.instance.currentUser;
      final merchantId = session?['id'] ?? 'mcht_1';

      // Fetch order details - use the merchant orders API with specific order lookup
      final result = await NabinApiService.getMerchantOrders(merchantId);
      
      if (result != null && result['success'] == true && result['orders'] != null) {
        final orders = result['orders'] as List;
        final order = orders.firstWhere((o) => o?['id'] == widget.orderId || o?['order_number'] == widget.orderId, orElse: () => orders.firstOrNull);
        
        if (order != null) {
          setState(() {
            _order = order;
            _isLoading = false;
          });
        } else {
          setState(() {
            _errorMessage = 'Order not found';
            _isLoading = false;
          });
        }
      } else {
        setState(() {
          _errorMessage = result?['error'] ?? 'Failed to load order';
          _isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        _errorMessage = 'Network error. Please check your connection.';
        _isLoading = false;
      });
    }
  }

  Future<void> _updateOrderStatus(String newStatus) async {
    final order = _order!;
    final orderId = order['id'];
    final merchantId = order['merchant_id'] ?? 'mcht_1';

    if (newStatus == 'REJECTED') {
      final reason = await _showRejectionDialog();
      if (reason == null) return;
      
      final result = await NabinApiService.updateMerchantOrderStatus(
        restaurantId: merchantId,
        orderId: orderId,
        status: newStatus,
        reason: reason,
      );
      
      if (result?['success'] == true) {
        _loadOrderDetail();
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
        _loadOrderDetail();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Order status updated to ${_getStatusText(newStatus)}'),
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

  String _getStatusText(String status) {
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

  Color _getStatusColor(String status) {
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: GroceryMerchantTheme.bgOffWhite,
      appBar: AppBar(
        backgroundColor: GroceryMerchantTheme.primaryGreen,
        elevation: 0,
        title: Text(
          _order != null 
              ? 'Order #${_order!['order_number'] ?? _order!['id']}'
              : 'Order Detail',
          style: const TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w800,
            color: Colors.white,
          ),
        ),
        actions: [
          if (_order != null && 
              !['DELIVERED', 'CANCELLED'].contains(_order!['order_state'])) ...[
            IconButton(
              icon: const Icon(Icons.close, color: Colors.white),
              onPressed: () => _updateOrderStatus('REJECTED'),
              tooltip: 'Reject Order',
            ),
          ],
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
                        onPressed: _loadOrderDetail,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: GroceryMerchantTheme.primaryGreen,
                        ),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                )
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Order Status Badge
                      Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: _getStatusColor(_order!['order_state'] ?? 'UNKNOWN').withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: _getStatusColor(_order!['order_state'] ?? 'UNKNOWN'),
            width: 1,
          ),
        ),
        child: Text(
          _getStatusText(_order!['order_state'] ?? 'UNKNOWN'),
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            color: _getStatusColor(_order!['order_state'] ?? 'UNKNOWN'),
          ),
        ),
      ),
                      const SizedBox(height: 32),

                      // Customer Info
                      Row(
                        children: [
                          const Icon(
                            Icons.person_outline_rounded,
                            size: 20,
                            color: GroceryMerchantTheme.textMuted,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              'Customer: ${_order?['customer_name'] ?? 'Unknown'}',
                              style: TextStyle(
                                fontSize: 16,
                                color: GroceryMerchantTheme.textDark,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),

                      // Order Summary
                      const Text(
                        'Order Summary',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: GroceryMerchantTheme.textDark,
                        ),
                      ),
                      const SizedBox(height: 12),

                      // Items List
                      ...(_order?['lines'] ?? []).map((item) => _buildOrderItem(item)).toList(),
                      if (_order?['lines'] == null || _order!['lines'].isEmpty)
                        const Padding(
                          padding: EdgeInsets.all(16),
                          child: Text(
                            'No items in this order',
                            style: TextStyle(
                              fontSize: 14,
                              color: GroceryMerchantTheme.textMuted,
                            ),
                          ),
                        ),
                      const SizedBox(height: 32),

                      // Order Total
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            'Total Amount',
                            style: TextStyle(
                              fontSize: 14,
                              color: GroceryMerchantTheme.textMuted,
                            ),
                          ),
                          Text(
                            '₹${(_order?['total_amount'] ?? 0).toStringAsFixed(0)}',
                            style: const TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w800,
                              color: GroceryMerchantTheme.textDark,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 32),

                      // Action Buttons
                      if (_isActionableStatus(_order?['order_state'] ?? '')) ...[
                        const Text(
                          'Quick Actions',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            color: GroceryMerchantTheme.textDark,
                          ),
                        ),
                        const SizedBox(height: 12),
                        _buildStatusActionButtons(),
                      ],
                    ],
                  ),
                ),
    );
  }

  Widget _buildOrderItem(Map<String, dynamic> item) {
    bool isPicked = false;
    final isPickingState = _order?['order_state'] == 'PICKING' || _order?['order_state'] == 'PACKING';

    return StatefulBuilder(
      builder: (context, setState) {
        return Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: isPicked ? GroceryMerchantTheme.bgOffWhite : Colors.white,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: isPicked ? GroceryMerchantTheme.borderLight : Colors.transparent,
            ),
            boxShadow: [
              if (!isPicked)
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.02),
                  blurRadius: 3,
                  offset: const Offset(0, 1),
                ),
            ],
          ),
          child: Row(
            children: [
              if (isPickingState) ...[
                Checkbox(
                  value: isPicked,
                  activeColor: GroceryMerchantTheme.primaryGreen,
                  onChanged: (val) {
                    setState(() => isPicked = val ?? false);
                  },
                ),
                const SizedBox(width: 4),
              ] else ...[
                // Item Image/Icon
                Container(
                  width: 50,
                  height: 50,
                  decoration: BoxDecoration(
                    color: GroceryMerchantTheme.surfaceElevated,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(
                    Icons.shopping_bag_outlined,
                    size: 24,
                    color: GroceryMerchantTheme.primaryGreen,
                  ),
                ),
                const SizedBox(width: 12),
              ],
              // Item Details
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item['product_name_snapshot'] ?? item['productName'] ?? 'Unknown Item',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: isPicked ? GroceryMerchantTheme.textMuted : GroceryMerchantTheme.textDark,
                        decoration: isPicked ? TextDecoration.lineThrough : TextDecoration.none,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Qty: ${item['quantity'] ?? 1} × ₹${(item['unitPriceAtCheckout'] ?? item['price'] ?? 0).toStringAsFixed(0)}',
                      style: TextStyle(
                        fontSize: 12,
                        color: GroceryMerchantTheme.textMuted,
                      ),
                    ),
                  ],
                ),
              ),
              // Item Price
              Text(
                '₹${(item['finalItemAmount'] ?? (item['unitPriceAtCheckout'] ?? item['price'] ?? 0) * (item['quantity'] ?? 1)).toStringAsFixed(0)}',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: isPicked ? GroceryMerchantTheme.textMuted : GroceryMerchantTheme.primaryGreen,
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildStatusActionButtons() {
    final status = _order?['order_state'] ?? '';

    if (status == 'NEW') {
      return Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () => _updateOrderStatus('REJECTED'),
              icon: const Icon(Icons.close, size: 16),
              label: const Text('Reject'),
              style: OutlinedButton.styleFrom(
                foregroundColor: GroceryMerchantTheme.accentRose,
                side: BorderSide(color: GroceryMerchantTheme.accentRose),
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: ElevatedButton.icon(
              onPressed: () => _updateOrderStatus('ACCEPTED'),
              icon: const Icon(Icons.check, size: 16),
              label: const Text('Accept Order'),
              style: ElevatedButton.styleFrom(
                backgroundColor: GroceryMerchantTheme.primaryGreen,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
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
              onPressed: () => _updateOrderStatus('PICKING'),
              icon: const Icon(Icons.shopping_basket, size: 16),
              label: const Text('Start Picking'),
              style: ElevatedButton.styleFrom(
                backgroundColor: GroceryMerchantTheme.accentAmber,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
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
              onPressed: () => _updateOrderStatus('PACKING'),
              icon: const Icon(Icons.inventory_2, size: 16),
              label: const Text('Start Packing'),
              style: ElevatedButton.styleFrom(
                backgroundColor: GroceryMerchantTheme.primaryGreen,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
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
              onPressed: () => _updateOrderStatus('READY_FOR_PICKUP'),
              icon: const Icon(Icons.check_circle, size: 16),
              label: const Text('Ready for Pickup'),
              style: ElevatedButton.styleFrom(
                backgroundColor: GroceryMerchantTheme.primaryGreen,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
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
}