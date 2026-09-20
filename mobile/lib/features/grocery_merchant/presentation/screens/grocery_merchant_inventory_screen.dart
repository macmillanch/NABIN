import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/network/nabin_api_service.dart';
import 'package:mobile/core/network/session_manager.dart';
import '../theme/grocery_merchant_theme.dart';

/// Inventory Screen for NABIN Grocery Merchant App
class GroceryMerchantInventoryScreen extends ConsumerStatefulWidget {
  const GroceryMerchantInventoryScreen({super.key});

  @override
  ConsumerState<GroceryMerchantInventoryScreen> createState() => _GroceryMerchantInventoryScreenState();
}

class _GroceryMerchantInventoryScreenState extends ConsumerState<GroceryMerchantInventoryScreen> {
  bool _isLoading = true;
  List<dynamic> _inventory = [];
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadInventory();
  }

  Future<void> _loadInventory() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final session = SessionManager.instance.currentUser;
      final merchantId = session?['id'] ?? 'mcht_1';

      final result = await NabinApiService.getMerchantInventory(merchantId);
      
      if (result?['success'] == true) {
        setState(() {
          _inventory = result?['inventory'] as List<dynamic>? ?? [];
          _isLoading = false;
        });
      } else {
        setState(() {
          _isLoading = false;
          _errorMessage = result?['error'] ?? 'Failed to load inventory';
        });
      }
    } catch (e) {
      setState(() {
        _errorMessage = 'Network error. Please check your connection.';
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: GroceryMerchantTheme.bgOffWhite,
      appBar: AppBar(
        backgroundColor: GroceryMerchantTheme.primaryGreen,
        elevation: 0,
        title: const Text(
          'Inventory',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w800,
            color: Colors.white,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white),
            onPressed: _loadInventory,
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
                        onPressed: _loadInventory,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: GroceryMerchantTheme.primaryGreen,
                        ),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _loadInventory,
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _inventory.length,
                    itemBuilder: (context, index) {
                      final item = _inventory[index];
                      return _buildInventoryCard(item);
                    },
                  ),
                ),
    );
  }

  Widget _buildInventoryCard(Map<String, dynamic> item) {
    final status = item['status'] ?? 'UNKNOWN';
    final statusColor = _getStatusColor(status);
    final statusText = _getStatusText(status);
    final inStock = status != 'OUT_OF_STOCK';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: inStock ? Colors.white : GroceryMerchantTheme.bgOffWhite,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          if (inStock)
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.03),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
        ],
        border: Border.all(
          color: inStock ? GroceryMerchantTheme.borderLight : GroceryMerchantTheme.accentRose.withValues(alpha: 0.3),
          width: 1,
        ),
      ),
      child: Row(
        children: [
          // Status Indicator
          Container(
            width: 4,
            height: 60,
            decoration: BoxDecoration(
              color: statusColor,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(width: 16),
          // Item Info
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        item['productName'] ?? 'Unknown Product',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: inStock ? GroceryMerchantTheme.textDark : GroceryMerchantTheme.textMuted,
                          decoration: inStock ? TextDecoration.none : TextDecoration.lineThrough,
                        ),
                      ),
                    ),
                    Icon(
                      Icons.qr_code_scanner,
                      size: 16,
                      color: GroceryMerchantTheme.textMuted.withValues(alpha: 0.5),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  '${item['category'] ?? 'Unknown Category'} • ${item['quantity'] ?? 0} ${item['unit'] ?? ''}',
                  style: TextStyle(
                    fontSize: 14,
                    color: GroceryMerchantTheme.textMuted,
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: statusColor.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(6),
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
                    Text(
                      '₹${item['price'] ?? 0}',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        color: GroceryMerchantTheme.textDark,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          // Action Buttons
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Switch(
                value: inStock,
                activeColor: GroceryMerchantTheme.primaryGreen,
                onChanged: (val) {
                  _updateInventoryItem(item, quantity: val ? 10 : 0); // Quick toggle updates quantity
                },
              ),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    onPressed: () => _showUpdateQuantityDialog(item),
                    icon: const Icon(Icons.edit_outlined, color: GroceryMerchantTheme.textMuted, size: 20),
                    tooltip: 'Update Quantity',
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    onPressed: () => _showUpdatePriceDialog(item),
                    icon: const Icon(Icons.price_change_outlined, color: GroceryMerchantTheme.textMuted, size: 20),
                    tooltip: 'Update Price',
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _showUpdateQuantityDialog(Map<String, dynamic> item) {
    final controller = TextEditingController(text: item['quantity'].toString());
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Update Quantity'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(
            labelText: 'Quantity',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              final newQuantity = int.tryParse(controller.text);
              if (newQuantity != null) {
                _updateInventoryItem(item, quantity: newQuantity);
                Navigator.pop(context);
              }
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: GroceryMerchantTheme.primaryGreen,
            ),
            child: const Text('Update'),
          ),
        ],
      ),
    );
  }

  void _showUpdatePriceDialog(Map<String, dynamic> item) {
    final controller = TextEditingController(text: item['price'].toString());
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Update Price'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(
            labelText: 'Price',
            prefixText: '₹',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              final newPrice = double.tryParse(controller.text);
              if (newPrice != null) {
                _updateInventoryItem(item, price: newPrice);
                Navigator.pop(context);
              }
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: GroceryMerchantTheme.primaryGreen,
            ),
            child: const Text('Update'),
          ),
        ],
      ),
    );
  }

  Future<void> _updateInventoryItem(Map<String, dynamic> item, {int? quantity, double? price}) async {
    try {
      final session = SessionManager.instance.currentUser;
      final merchantId = session?['id'] ?? 'mcht_1';

      final payload = {
        'id': item['id'],
        'merchantId': merchantId,
        'productName': item['productName'],
        'category': item['category'],
        'quantity': quantity ?? item['quantity'],
        'unit': item['unit'],
        'price': price ?? item['price'],
        'status': item['status'],
      };

      final result = await NabinApiService.updateMerchantInventoryItem(payload);
      
      if (result?['success'] == true) {
        _loadInventory();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Inventory updated successfully'),
              backgroundColor: GroceryMerchantTheme.primaryGreen,
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Failed to update inventory'),
            backgroundColor: GroceryMerchantTheme.accentRose,
          ),
        );
      }
    }
  }

  String _getStatusText(String status) {
    switch (status) {
      case 'IN_STOCK':
        return 'In Stock';
      case 'LOW_STOCK':
        return 'Low Stock';
      case 'OUT_OF_STOCK':
        return 'Out of Stock';
      default:
        return status;
    }
  }

  Color _getStatusColor(String status) {
    switch (status) {
      case 'IN_STOCK':
        return GroceryMerchantTheme.primaryGreen;
      case 'LOW_STOCK':
        return GroceryMerchantTheme.accentAmber;
      case 'OUT_OF_STOCK':
        return GroceryMerchantTheme.accentRose;
      default:
        return GroceryMerchantTheme.textMuted;
    }
  }
}