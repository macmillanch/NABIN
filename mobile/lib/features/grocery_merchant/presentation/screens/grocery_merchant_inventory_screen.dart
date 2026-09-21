import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/network/nabin_api_service.dart';
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
  String? _busyId;

  @override
  void initState() {
    super.initState();
    _loadInventory();
  }

  Future<void> _loadInventory({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _isLoading = true;
        _errorMessage = null;
      });
    }

    try {
      // The backend scopes this to the bearer token's merchant, so nothing is passed.
      final result = await NabinApiService.getMerchantInventory();

      if (result?['success'] == true) {
        setState(() {
          _inventory = result?['inventory'] as List<dynamic>? ?? [];
          _errorMessage = null;
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
              : _inventory.isEmpty
                  ? _buildEmptyState()
                  : RefreshIndicator(
                      onRefresh: _loadInventory,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _inventory.length,
                        itemBuilder: (context, index) => _buildInventoryCard(_inventory[index]),
                      ),
                    ),
    );
  }

  Widget _buildEmptyState() {
    return RefreshIndicator(
      onRefresh: _loadInventory,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(32),
        children: [
          Icon(
            Icons.inventory_2_outlined,
            size: 56,
            color: GroceryMerchantTheme.textMuted.withValues(alpha: 0.3),
          ),
          const SizedBox(height: 16),
          const Text(
            'No products stocked yet',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
              color: GroceryMerchantTheme.textDark,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Add products from the NABIN master catalogue to start selling.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 14, color: GroceryMerchantTheme.textMuted),
          ),
        ],
      ),
    );
  }

  Widget _buildInventoryCard(Map<String, dynamic> item) {
    final status = item['status'] ?? 'UNKNOWN';
    final statusColor = _getStatusColor(status);
    final statusText = _getStatusText(status);
    final listed = item['isAvailable'] == true;
    final stockQty = (item['stockQty'] as num?)?.toInt() ?? 0;
    final price = (item['currentPrice'] as num?)?.toDouble() ?? 0;
    final unit = item['unit'] ?? '';
    final busy = _busyId != null && _busyId == item['masterProductId'];

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: listed ? Colors.white : GroceryMerchantTheme.bgOffWhite,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          if (listed)
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.03),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
        ],
        border: Border.all(
          color: listed ? GroceryMerchantTheme.borderLight : GroceryMerchantTheme.accentRose.withValues(alpha: 0.3),
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
                        item['masterName'] ?? 'Unknown Product',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: listed ? GroceryMerchantTheme.textDark : GroceryMerchantTheme.textMuted,
                          decoration: listed ? TextDecoration.none : TextDecoration.lineThrough,
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
                  '${item['category'] ?? 'Grocery'} • $stockQty $unit',
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
                      '₹${price.toStringAsFixed(2)}',
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
                value: listed,
                activeColor: GroceryMerchantTheme.primaryGreen,
                onChanged: busy
                    ? null
                    : (val) {
                        _updateInventoryItem(item, isAvailable: val);
                      },
              ),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    onPressed: busy ? null : () => _showUpdateQuantityDialog(item),
                    icon: const Icon(Icons.edit_outlined, color: GroceryMerchantTheme.textMuted, size: 20),
                    tooltip: 'Update Quantity',
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    onPressed: busy ? null : () => _showUpdatePriceDialog(item),
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
    final controller = TextEditingController(text: (item['stockQty'] ?? 0).toString());
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Stock ${item['masterName'] ?? 'product'}'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(
            labelText: 'Quantity',
            suffixText: item['unit'] as String?,
            border: const OutlineInputBorder(),
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
              if (newQuantity != null && newQuantity >= 0) {
                _updateInventoryItem(item, stockQty: newQuantity);
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
    final controller = TextEditingController(text: (item['currentPrice'] ?? 0).toString());
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Price ${item['masterName'] ?? 'product'}'),
        content: TextField(
          controller: controller,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(
            labelText: 'Store price',
            prefixText: '₹',
            suffixText: 'per ${item['unit'] ?? 'pack'}',
            border: const OutlineInputBorder(),
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
              if (newPrice != null && newPrice > 0) {
                _updateInventoryItem(item, currentPrice: newPrice);
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

  Future<void> _updateInventoryItem(
    Map<String, dynamic> item, {
    int? stockQty,
    double? currentPrice,
    bool? isAvailable,
  }) async {
    final masterProductId = item['masterProductId'];
    if (masterProductId == null) {
      _showMessage('This item has no master catalogue product, so it cannot be updated.', isError: true);
      return;
    }

    final payload = <String, dynamic>{
      'masterProductId': masterProductId,
      if (stockQty != null) 'stockQty': stockQty,
      if (currentPrice != null) 'currentPrice': currentPrice,
      if (isAvailable != null) 'isAvailable': isAvailable,
    };

    setState(() => _busyId = masterProductId);
    try {
      final result = await NabinApiService.updateMerchantInventoryItem(payload);
      if (result?['success'] == true) {
        await _loadInventory(silent: true);
        _showMessage('${item['masterName'] ?? 'Item'} updated.', color: GroceryMerchantTheme.primaryGreen);
      } else {
        _showMessage(result?['error'] ?? 'The store rejected this update.', isError: true);
      }
    } catch (e) {
      _showMessage('Network error. The change was not saved.', isError: true);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  void _showMessage(String message, {Color? color, bool isError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: color ??
            (isError ? GroceryMerchantTheme.accentRose : GroceryMerchantTheme.primaryGreen),
      ),
    );
  }

  String _getStatusText(String status) {
    switch (status) {
      case 'AVAILABLE':
        return 'Available';
      case 'LOW_STOCK':
        return 'Low Stock';
      case 'OUT_OF_STOCK':
        return 'Out of Stock';
      case 'INACTIVE':
        return 'Hidden';
      default:
        return status;
    }
  }

  Color _getStatusColor(String status) {
    switch (status) {
      case 'AVAILABLE':
        return GroceryMerchantTheme.primaryGreen;
      case 'LOW_STOCK':
        return GroceryMerchantTheme.accentAmber;
      case 'OUT_OF_STOCK':
      case 'INACTIVE':
        return GroceryMerchantTheme.accentRose;
      default:
        return GroceryMerchantTheme.textMuted;
    }
  }
}