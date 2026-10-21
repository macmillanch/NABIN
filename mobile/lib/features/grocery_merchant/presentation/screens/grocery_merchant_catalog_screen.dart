import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/network/nabin_api_service.dart';
import '../theme/grocery_merchant_theme.dart';

enum _StockFilter { all, stocked, lowStock, outOfStock, notStocked }

/// Curated grocery demo photos for local demo usage
final List<String> kSampleGroceryPhotos = [
  'https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=600&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=600&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=600&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=600&auto=format&fit=crop&q=80',
];

Widget _groceryPlaceholderIcon({double size = 24}) => Container(
  width: 50,
  height: 50,
  color: const Color(0xFFF1F5F9),
  child: Icon(Icons.shopping_basket_outlined, color: GroceryMerchantTheme.primaryGreen, size: size),
);

/// Data model for grocery pack variant
class GroceryPackVariant {
  GroceryPackVariant({
    required this.id,
    required this.name,
    required this.packSize,
    required this.unit,
    required this.sellingPrice,
    this.mrp = 0,
    required this.stockQty,
    this.isAvailable = true,
  });

  final String id;
  String name;
  String packSize;
  String unit;
  double sellingPrice;
  double mrp;
  int stockQty;
  bool isAvailable;

  Map<String, dynamic> toMap() => {
    'id': id,
    'name': name,
    'packSize': packSize,
    'unit': unit,
    'sellingPrice': sellingPrice,
    'mrp': mrp,
    'stockQty': stockQty,
    'isAvailable': isAvailable,
  };
}

/// NABIN master grocery catalogue & local store product manager.
class GroceryMerchantCatalogScreen extends ConsumerStatefulWidget {
  const GroceryMerchantCatalogScreen({super.key});

  @override
  ConsumerState<GroceryMerchantCatalogScreen> createState() => _GroceryMerchantCatalogScreenState();
}

class _GroceryMerchantCatalogScreenState extends ConsumerState<GroceryMerchantCatalogScreen> {
  bool _isLoading = true;
  String? _errorMessage;
  List<dynamic> _catalogue = [];
  Map<String, Map<String, dynamic>> _inventoryByMasterId = {};
  bool _catalogueIsDegraded = false;
  String _query = '';
  _StockFilter _filter = _StockFilter.all;
  String? _busyId;

  // Local demo custom products created by merchant
  final List<Map<String, dynamic>> _customProducts = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _isLoading = true;
        _errorMessage = null;
      });
    }

    try {
      final results = await Future.wait([
        NabinApiService.getMerchantMasterCatalog(),
        NabinApiService.getMerchantInventory(),
      ]);

      final catalogue = results[0];
      final inventory = results[1];

      if (catalogue == null || inventory == null ||
          catalogue['success'] != true || inventory['success'] != true) {
        final message = catalogue?['error'] ?? inventory?['error'] ??
            'Failed to load the master catalogue';
        if (mounted) {
          setState(() {
            _isLoading = false;
            _errorMessage = message;
          });
        }
        return;
      }

      final byMasterId = <String, Map<String, dynamic>>{};
      for (final row in (inventory['inventory'] as List<dynamic>? ?? [])) {
        final key = row['masterProductId']?.toString();
        if (key != null) byMasterId[key] = Map<String, dynamic>.from(row);
      }

      if (mounted) {
        setState(() {
          _catalogue = catalogue['products'] as List<dynamic>? ?? [];
          _catalogueIsDegraded = catalogue['degraded'] == true;
          _inventoryByMasterId = byMasterId;
          _errorMessage = null;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = 'Network error. Please check your connection.';
          _isLoading = false;
        });
      }
    }
  }

  String _label(dynamic value) => (value ?? '').toString().trim();

  String _sizeLabel(Map<String, dynamic> item) {
    final unit = _label(item['standard_unit']);
    final pack = _label(item['pack_size']);
    if (pack.isEmpty) return unit;
    if (unit.isEmpty || pack.toLowerCase().contains(unit.toLowerCase())) return pack;
    return '$pack $unit';
  }

  String _pricingLabel(dynamic value) {
    final raw = _label(value);
    if (raw.isEmpty) return '';
    return raw
        .toLowerCase()
        .split(RegExp(r'[_\s]+'))
        .where((word) => word.isNotEmpty)
        .map((word) => '${word[0].toUpperCase()}${word.substring(1)}')
        .join(' ');
  }

  /// Combine master catalogue with merchant's custom products
  List<Widget> _buildRows() {
    final needle = _query.trim().toLowerCase();
    final categories = <String, List<Widget>>{};

    // 1. Process custom products first
    for (final custom in _customProducts) {
      final isStocked = custom['isStocked'] == true;
      final stockQty = (custom['stockQty'] as num?)?.toInt() ?? 0;
      final lowStockThreshold = (custom['lowStockThreshold'] as num?)?.toInt() ?? 5;

      if (_filter == _StockFilter.stocked && !isStocked) continue;
      if (_filter == _StockFilter.notStocked && isStocked) continue;
      if (_filter == _StockFilter.lowStock && (!isStocked || stockQty > lowStockThreshold || stockQty == 0)) continue;
      if (_filter == _StockFilter.outOfStock && (!isStocked || stockQty > 0)) continue;

      if (needle.isNotEmpty) {
        final haystack = '${_label(custom['name'])} ${_label(custom['brand'])} ${_label(custom['category'])}'.toLowerCase();
        if (!haystack.contains(needle)) continue;
      }

      final category = _label(custom['category']).isEmpty ? 'Uncategorised' : _label(custom['category']);
      (categories[category] ??= []).add(_buildCustomProductTile(custom));
    }

    // 2. Process master catalogue products
    for (final raw in _catalogue) {
      final item = Map<String, dynamic>.from(raw);
      final masterId = item['id']?.toString();
      if (masterId == null) continue;

      final stocked = _inventoryByMasterId[masterId];
      final isStocked = stocked != null;
      final status = stocked?['status']?.toString() ?? 'NOT_STOCKED';

      if (_filter == _StockFilter.stocked && !isStocked) continue;
      if (_filter == _StockFilter.notStocked && isStocked) continue;
      if (_filter == _StockFilter.lowStock && (!isStocked || status != 'LOW_STOCK')) continue;
      if (_filter == _StockFilter.outOfStock && (!isStocked || status != 'OUT_OF_STOCK')) continue;

      if (needle.isNotEmpty) {
        final haystack =
            '${_label(item['name'])} ${_label(item['brand'])} ${_label(item['category'])} ${_label(item['subcategory'])}'
                .toLowerCase();
        if (!haystack.contains(needle)) continue;
      }

      final category = _label(item['category']).isEmpty ? 'Uncategorised' : _label(item['category']);
      (categories[category] ??= []).add(_buildCatalogueTile(item, masterId, stocked));
    }

    final sorted = categories.keys.toList()..sort();
    final rows = <Widget>[];
    for (final category in sorted) {
      rows.add(
        Padding(
          padding: const EdgeInsets.only(top: 20, bottom: 10, left: 4),
          child: Text(
            category,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w800,
              color: GroceryMerchantTheme.textDark,
            ),
          ),
        ),
      );
      rows.addAll(categories[category]!);
    }

    if (rows.isEmpty) {
      rows.add(_buildNoMatches());
    }
    return rows;
  }

  Widget _buildNoMatches() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 64),
      child: Column(
        children: [
          Icon(
            Icons.search_off,
            size: 48,
            color: GroceryMerchantTheme.textMuted.withValues(alpha: 0.3),
          ),
          const SizedBox(height: 12),
          Text(
            _query.trim().isEmpty
                ? 'No items found matching the selected filter.'
                : 'No catalogue products match "${_query.trim()}".',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 14, color: GroceryMerchantTheme.textMuted),
          ),
        ],
      ),
    );
  }

  Widget _buildCatalogueTile(
    Map<String, dynamic> item,
    String masterId,
    Map<String, dynamic>? stocked,
  ) {
    final status = stocked?['status'] ?? 'NOT_STOCKED';
    final statusColor = _getStatusColor(status);
    final busy = _busyId == masterId;
    final size = _sizeLabel(item);
    final details = [
      _label(item['brand']),
      size,
      _pricingLabel(item['pricing_model']),
    ].where((part) => part.isNotEmpty).join(' • ');

    final int stockQty = (stocked?['stockQty'] as num?)?.toInt() ?? 0;
    final double currentPrice = (stocked?['currentPrice'] as num?)?.toDouble() ?? 0.0;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: stocked == null
              ? GroceryMerchantTheme.borderLight
              : statusColor.withValues(alpha: 0.35),
          width: 1,
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 4,
            height: 64,
            decoration: BoxDecoration(
              color: statusColor,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _label(item['name']),
                  style: const TextStyle(
                    fontSize: 15.5,
                    fontWeight: FontWeight.w700,
                    color: GroceryMerchantTheme.textDark,
                  ),
                ),
                if (details.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    details,
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: GroceryMerchantTheme.textMuted,
                    ),
                  ),
                ],
                const SizedBox(height: 8),
                if (stocked != null)
                  Row(
                    children: [
                      Text(
                        '₹${currentPrice.toStringAsFixed(2)} • ',
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: GroceryMerchantTheme.textDark),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: statusColor.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          '$stockQty ${_label(stocked['unit'])} (${_getStatusText(status)})',
                          style: TextStyle(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w800,
                            color: statusColor,
                          ),
                        ),
                      ),
                    ],
                  )
                else
                  const Text(
                    'Not stocked in your store yet',
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: GroceryMerchantTheme.textMuted,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          // Action Buttons
          if (busy)
            const SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(
                strokeWidth: 2.4,
                color: GroceryMerchantTheme.primaryGreen,
              ),
            )
          else
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Quick Stock Adjusters if Stocked
                if (stocked != null) ...[
                  InkWell(
                    onTap: stockQty > 0
                        ? () => _adjustStock(masterId, stockQty - 1, currentPrice, _label(item['name']))
                        : null,
                    child: Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        border: Border.all(color: GroceryMerchantTheme.borderLight),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: const Icon(Icons.remove, size: 14, color: GroceryMerchantTheme.textDark),
                    ),
                  ),
                  const SizedBox(width: 4),
                  InkWell(
                    onTap: () => _adjustStock(masterId, stockQty + 1, currentPrice, _label(item['name'])),
                    child: Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        border: Border.all(color: GroceryMerchantTheme.borderLight),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: const Icon(Icons.add, size: 14, color: GroceryMerchantTheme.textDark),
                    ),
                  ),
                  const SizedBox(width: 6),
                ],
                // Customer Preview Button
                IconButton(
                  icon: const Icon(Icons.remove_red_eye_outlined, size: 18, color: GroceryMerchantTheme.textMuted),
                  tooltip: 'Preview Product',
                  onPressed: () => _openCustomerPreview(item, stocked),
                ),
                // Edit / Stock Button
                TextButton(
                  onPressed: () => _openStockSheet(item, stocked),
                  style: TextButton.styleFrom(
                    foregroundColor: GroceryMerchantTheme.primaryGreen,
                  ),
                  child: Text(stocked == null ? 'Stock' : 'Edit'),
                ),
              ],
            ),
        ],
      ),
    );
  }

  Widget _buildCustomProductTile(Map<String, dynamic> item) {
    final stockQty = (item['stockQty'] as num?)?.toInt() ?? 0;
    final lowStockThreshold = (item['lowStockThreshold'] as num?)?.toInt() ?? 5;
    final currentPrice = (item['sellingPrice'] as num?)?.toDouble() ?? 0.0;
    final unit = _label(item['unit']);
    final photo = (item['photos'] as List?)?.isNotEmpty == true ? (item['photos'] as List).first : null;

    final isOutOfStock = stockQty == 0;
    final isLowStock = stockQty > 0 && stockQty <= lowStockThreshold;
    final statusColor = isOutOfStock
        ? GroceryMerchantTheme.accentRose
        : isLowStock
            ? GroceryMerchantTheme.accentAmber
            : GroceryMerchantTheme.primaryGreen;
    final statusText = isOutOfStock
        ? 'Out of stock'
        : isLowStock
            ? 'Low stock ($stockQty left)'
            : 'In stock ($stockQty $unit)';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: statusColor.withValues(alpha: 0.35), width: 1),
      ),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: photo != null
                ? Image.network(photo, width: 50, height: 50, fit: BoxFit.cover, errorBuilder: (_, __, ___) => _placeholderIcon())
                : _placeholderIcon(),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                      decoration: BoxDecoration(color: const Color(0xFFEFF6FF), borderRadius: BorderRadius.circular(4)),
                      child: const Text('CUSTOM', style: TextStyle(fontSize: 8.5, fontWeight: FontWeight.bold, color: Color(0xFF2563EB))),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        _label(item['name']),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: GroceryMerchantTheme.textDark),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  '${_label(item['brand'])} • ${_label(item['category'])}',
                  style: const TextStyle(fontSize: 12, color: GroceryMerchantTheme.textMuted),
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Text('₹${currentPrice.toStringAsFixed(2)} ', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(color: statusColor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(4)),
                      child: Text(statusText, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: statusColor)),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          // Actions: [-], [+], Preview, Edit, Delete
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              InkWell(
                onTap: stockQty > 0
                    ? () {
                        setState(() => item['stockQty'] = stockQty - 1);
                      }
                    : null,
                child: Container(
                  padding: const EdgeInsets.all(5),
                  decoration: BoxDecoration(border: Border.all(color: GroceryMerchantTheme.borderLight), borderRadius: BorderRadius.circular(6)),
                  child: const Icon(Icons.remove, size: 14),
                ),
              ),
              const SizedBox(width: 4),
              InkWell(
                onTap: () {
                  setState(() => item['stockQty'] = stockQty + 1);
                },
                child: Container(
                  padding: const EdgeInsets.all(5),
                  decoration: BoxDecoration(border: Border.all(color: GroceryMerchantTheme.borderLight), borderRadius: BorderRadius.circular(6)),
                  child: const Icon(Icons.add, size: 14),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.remove_red_eye_outlined, size: 18),
                tooltip: 'Preview',
                onPressed: () => _openCustomerPreview(item, {'currentPrice': currentPrice, 'stockQty': stockQty, 'unit': unit}),
              ),
              IconButton(
                icon: const Icon(Icons.edit_outlined, size: 18),
                tooltip: 'Edit',
                onPressed: () => _openAddEditProductSheet(initialProduct: item),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline, size: 18, color: Colors.red),
                tooltip: 'Delete',
                onPressed: () => _deleteCustomProduct(item),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _placeholderIcon() => _groceryPlaceholderIcon();

  Future<void> _adjustStock(String masterId, int newQty, double price, String name) async {
    if (newQty < 0) return;
    setState(() => _busyId = masterId);
    try {
      final res = await NabinApiService.updateMerchantInventoryItem({
        'masterProductId': masterId,
        'currentPrice': price,
        'stockQty': newQty,
        'isAvailable': newQty > 0,
      });
      if (res?['success'] == true) {
        if (_inventoryByMasterId.containsKey(masterId)) {
          setState(() {
            _inventoryByMasterId[masterId]!['stockQty'] = newQty;
            _inventoryByMasterId[masterId]!['status'] = newQty == 0 ? 'OUT_OF_STOCK' : (newQty <= 5 ? 'LOW_STOCK' : 'AVAILABLE');
          });
        }
      }
    } catch (_) {}
    if (mounted) setState(() => _busyId = null);
  }

  void _deleteCustomProduct(Map<String, dynamic> item) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Product?'),
        content: Text('Delete "${item['name']}" from your grocery store inventory?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () {
              Navigator.pop(ctx);
              setState(() {
                _customProducts.removeWhere((p) => p['id'] == item['id']);
              });
              _showMessage('Deleted "${item['name']}".', color: Colors.red);
            },
            child: const Text('Delete', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  void _openAddEditProductSheet({Map<String, dynamic>? initialProduct}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _AddEditGroceryProductSheet(
        initialProduct: initialProduct,
        onSave: (savedProduct) {
          setState(() {
            if (initialProduct != null) {
              final idx = _customProducts.indexWhere((p) => p['id'] == savedProduct['id']);
              if (idx != -1) _customProducts[idx] = savedProduct;
            } else {
              _customProducts.insert(0, savedProduct);
            }
          });
          _showMessage('Product "${savedProduct['name']}" saved in catalog.');
        },
      ),
    );
  }

  void _openCustomerPreview(Map<String, dynamic> item, Map<String, dynamic>? stocked) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _CustomerGroceryProductPreviewSheet(
        item: item,
        stocked: stocked,
      ),
    );
  }

  void _openStockSheet(
    Map<String, dynamic> item,
    Map<String, dynamic>? stocked,
  ) {
    final masterId = item['id']?.toString() ?? '';
    final unit = _label(item['standard_unit']);
    final name = _label(item['name']);
    final priceController = TextEditingController(
      text: (stocked?['currentPrice'] ?? '').toString(),
    );
    final qtyController = TextEditingController(
      text: (stocked?['stockQty'] ?? 0).toString(),
    );
    var listed = stocked?['isAvailable'] != false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) => StatefulBuilder(
        builder: (sheetContext, setSheetState) => Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(sheetContext).viewInsets.bottom + 20,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                stocked == null ? 'Stock in your store' : 'Update your stock',
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: GroceryMerchantTheme.textDark,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                name,
                style: const TextStyle(fontSize: 14, color: GroceryMerchantTheme.textMuted),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: priceController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(
                  labelText: 'Store price',
                  prefixText: '₹',
                  suffixText: unit.isEmpty ? null : 'per $unit',
                  border: const OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: qtyController,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  labelText: 'Stock quantity',
                  suffixText: unit.isEmpty ? null : unit,
                  border: const OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 4),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: listed,
                activeColor: GroceryMerchantTheme.primaryGreen,
                title: const Text('List in my store'),
                subtitle: Text(
                  listed
                      ? 'Customers can buy it now.'
                      : 'Kept in stock but hidden from customers.',
                  style: const TextStyle(
                    fontSize: 12,
                    color: GroceryMerchantTheme.textMuted,
                  ),
                ),
                onChanged: (val) => setSheetState(() => listed = val),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(sheetContext),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: GroceryMerchantTheme.textMuted,
                        side: const BorderSide(color: GroceryMerchantTheme.borderLight),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                      child: const Text('Cancel'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: () {
                        final price = double.tryParse(priceController.text);
                        final qty = int.tryParse(qtyController.text);
                        if (price == null || price <= 0 || qty == null || qty < 0) {
                          ScaffoldMessenger.of(sheetContext).showSnackBar(
                            const SnackBar(
                              content: Text(
                                'Enter a price above zero and a quantity of zero or more.',
                              ),
                              backgroundColor: GroceryMerchantTheme.accentRose,
                            ),
                          );
                          return;
                        }
                        Navigator.pop(sheetContext);
                        _stockItem(
                          masterId: masterId,
                          name: name,
                          currentPrice: price,
                          stockQty: qty,
                          isAvailable: listed,
                          wasStocked: stocked != null,
                        );
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: GroceryMerchantTheme.primaryGreen,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                      child: Text(stocked == null ? 'Stock product' : 'Save'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _stockItem({
    required String masterId,
    required String name,
    required double currentPrice,
    required int stockQty,
    required bool isAvailable,
    required bool wasStocked,
  }) async {
    if (masterId.isEmpty) {
      _showMessage('This catalogue row has no id, so it cannot be stocked.',
          isError: true);
      return;
    }

    setState(() => _busyId = masterId);
    try {
      final result = await NabinApiService.updateMerchantInventoryItem({
        'masterProductId': masterId,
        'currentPrice': currentPrice,
        'stockQty': stockQty,
        'isAvailable': isAvailable,
      });

      if (result?['success'] == true) {
        await _load(silent: true);
        _showMessage(
          wasStocked ? '$name updated.' : '$name is now in your store.',
          color: GroceryMerchantTheme.primaryGreen,
        );
      } else {
        _showMessage(result?['error'] ?? 'The store rejected this change.',
            isError: true);
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: GroceryMerchantTheme.bgOffWhite,
      appBar: AppBar(
        backgroundColor: GroceryMerchantTheme.primaryGreen,
        elevation: 0,
        title: const Text(
          'Product Catalog',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w800,
            color: Colors.white,
          ),
        ),
        actions: [
          // Add Custom Product button
          IconButton(
            icon: const Icon(Icons.add_box_outlined, color: Colors.white),
            tooltip: 'Add Custom Product',
            onPressed: () => _openAddEditProductSheet(),
          ),
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white),
            onPressed: () => _load(),
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
                        style: const TextStyle(
                          color: GroceryMerchantTheme.accentRose,
                          fontSize: 16,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: () => _load(),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: GroceryMerchantTheme.primaryGreen,
                        ),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                )
              : Column(
                  children: [
                    // Search bar
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                      child: TextField(
                        onChanged: (val) => setState(() => _query = val),
                        decoration: InputDecoration(
                          hintText: 'Search products by name, brand, or category',
                          prefixIcon: const Icon(Icons.search),
                          filled: true,
                          fillColor: Colors.white,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                            borderSide: const BorderSide(color: GroceryMerchantTheme.borderLight),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                            borderSide: const BorderSide(color: GroceryMerchantTheme.borderLight),
                          ),
                        ),
                      ),
                    ),
                    // Stock Filter Pills
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(
                          children: [
                            for (final option in _StockFilter.values)
                              Padding(
                                padding: const EdgeInsets.only(right: 6),
                                child: ChoiceChip(
                                  label: Text(_filterLabel(option)),
                                  selected: _filter == option,
                                  selectedColor: GroceryMerchantTheme.primaryGreenLight,
                                  showCheckmark: false,
                                  labelStyle: TextStyle(
                                    fontWeight: FontWeight.w700,
                                    fontSize: 12,
                                    color: _filter == option
                                        ? GroceryMerchantTheme.primaryGreenDark
                                        : GroceryMerchantTheme.textMuted,
                                  ),
                                  onSelected: (_) => setState(() => _filter = option),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                    if (_catalogueIsDegraded)
                      Container(
                        width: double.infinity,
                        margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                        padding: const EdgeInsets.all(12),
                        color: GroceryMerchantTheme.accentAmber.withValues(alpha: 0.12),
                        child: const Text(
                          'The live catalogue is unreachable, so this is the backup list '
                          'and stocking it may not persist.',
                          style: TextStyle(
                            fontSize: 13,
                            color: GroceryMerchantTheme.textDark,
                          ),
                        ),
                      ),
                    Expanded(
                      child: RefreshIndicator(
                        onRefresh: () => _load(silent: true),
                        child: ListView(
                          physics: const AlwaysScrollableScrollPhysics(),
                          padding: const EdgeInsets.all(16),
                          children: _buildRows(),
                        ),
                      ),
                    ),
                  ],
                ),
    );
  }

  String _filterLabel(_StockFilter filter) {
    switch (filter) {
      case _StockFilter.all:
        return 'All';
      case _StockFilter.stocked:
        return 'In Stock';
      case _StockFilter.lowStock:
        return 'Low Stock (≤5)';
      case _StockFilter.outOfStock:
        return 'Out of Stock';
      case _StockFilter.notStocked:
        return 'Not Stocked';
    }
  }

  String _getStatusText(String status) {
    switch (status) {
      case 'AVAILABLE':
        return 'In stock';
      case 'LOW_STOCK':
        return 'Low stock';
      case 'OUT_OF_STOCK':
        return 'Out of stock';
      case 'INACTIVE':
        return 'Hidden';
      case 'NOT_STOCKED':
        return 'Not stocked';
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

/// Add / Edit Grocery Product Bottom Sheet
class _AddEditGroceryProductSheet extends StatefulWidget {
  const _AddEditGroceryProductSheet({this.initialProduct, required this.onSave});

  final Map<String, dynamic>? initialProduct;
  final ValueChanged<Map<String, dynamic>> onSave;

  @override
  State<_AddEditGroceryProductSheet> createState() => _AddEditGroceryProductSheetState();
}

class _AddEditGroceryProductSheetState extends State<_AddEditGroceryProductSheet> {
  late TextEditingController _nameCtrl;
  late TextEditingController _brandCtrl;
  late TextEditingController _categoryCtrl;
  late TextEditingController _descCtrl;
  late TextEditingController _sellingPriceCtrl;
  late TextEditingController _mrpCtrl;
  late TextEditingController _stockQtyCtrl;
  late TextEditingController _lowStockCtrl;
  late TextEditingController _skuCtrl;

  String _unit = 'kg';
  bool _isAvailable = true;
  List<String> _photos = [];
  final List<GroceryPackVariant> _variants = [];
  String? _error;

  final List<String> _unitOptions = ['kg', 'g', 'litre', 'ml', 'piece', 'pack'];

  @override
  void initState() {
    super.initState();
    final p = widget.initialProduct;
    _nameCtrl = TextEditingController(text: p?['name']?.toString() ?? '');
    _brandCtrl = TextEditingController(text: p?['brand']?.toString() ?? 'Fresho');
    _categoryCtrl = TextEditingController(text: p?['category']?.toString() ?? 'Daily Essentials');
    _descCtrl = TextEditingController(text: p?['description']?.toString() ?? '');
    _sellingPriceCtrl = TextEditingController(text: (p?['sellingPrice'] ?? '120').toString());
    _mrpCtrl = TextEditingController(text: (p?['mrp'] ?? '140').toString());
    _stockQtyCtrl = TextEditingController(text: (p?['stockQty'] ?? '25').toString());
    _lowStockCtrl = TextEditingController(text: (p?['lowStockThreshold'] ?? '5').toString());
    _skuCtrl = TextEditingController(text: p?['sku']?.toString() ?? 'SKU-${DateTime.now().millisecondsSinceEpoch.toString().slice(-4)}');

    _unit = p?['unit']?.toString() ?? 'kg';
    _isAvailable = p?['isAvailable'] != false;
    _photos = (p?['photos'] as List?)?.map((e) => e.toString()).toList() ?? [kSampleGroceryPhotos[0]];
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _brandCtrl.dispose();
    _categoryCtrl.dispose();
    _descCtrl.dispose();
    _sellingPriceCtrl.dispose();
    _mrpCtrl.dispose();
    _stockQtyCtrl.dispose();
    _lowStockCtrl.dispose();
    _skuCtrl.dispose();
    super.dispose();
  }

  void _addPhotoDialog() {
    final textCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Add Grocery Photo'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Enter image URL or select from demo gallery:'),
            const SizedBox(height: 10),
            TextField(controller: textCtrl, decoration: const InputDecoration(hintText: 'https://...', border: OutlineInputBorder())),
            const SizedBox(height: 12),
            const Text('Curated grocery photos:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              children: kSampleGroceryPhotos.map((url) {
                return InkWell(
                  onTap: () => textCtrl.text = url,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: Image.network(
                      url,
                      width: 44,
                      height: 44,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => _groceryPlaceholderIcon(),
                    ),
                  ),
                );
              }).toList(),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () {
              if (textCtrl.text.trim().isNotEmpty) {
                setState(() { _photos.add(textCtrl.text.trim()); });
                Navigator.pop(ctx);
              }
            },
            child: const Text('Add'),
          ),
        ],
      ),
    );
  }

  void _save() {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Product name is required.');
      return;
    }
    final price = double.tryParse(_sellingPriceCtrl.text);
    if (price == null || price <= 0) {
      setState(() => _error = 'Enter a selling price above 0.');
      return;
    }
    final stock = int.tryParse(_stockQtyCtrl.text);
    if (stock == null || stock < 0) {
      setState(() => _error = 'Stock quantity cannot be negative.');
      return;
    }

    final saved = <String, dynamic>{
      'id': widget.initialProduct?['id'] ?? 'custom-prod-${DateTime.now().millisecondsSinceEpoch}',
      'name': name,
      'brand': _brandCtrl.text.trim(),
      'category': _categoryCtrl.text.trim(),
      'description': _descCtrl.text.trim(),
      'unit': _unit,
      'sellingPrice': price,
      'mrp': double.tryParse(_mrpCtrl.text) ?? price,
      'stockQty': stock,
      'lowStockThreshold': int.tryParse(_lowStockCtrl.text) ?? 5,
      'isAvailable': _isAvailable,
      'isStocked': true,
      'photos': _photos,
      'sku': _skuCtrl.text.trim(),
      'variants': _variants.map((v) => v.toMap()).toList(),
    };

    widget.onSave(saved);
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.90,
        child: Column(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
            decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: GroceryMerchantTheme.borderLight))),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  widget.initialProduct == null ? 'Add Product' : 'Edit Product',
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: GroceryMerchantTheme.textDark),
                ),
                Row(
                  children: [
                    TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
                    const SizedBox(width: 8),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(backgroundColor: GroceryMerchantTheme.primaryGreen, foregroundColor: Colors.white),
                      onPressed: _save,
                      child: const Text('Save Product'),
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (_error != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              color: const Color(0xFFFEE2E2),
              child: Text(_error!, style: const TextStyle(color: Colors.red, fontWeight: FontWeight.bold, fontSize: 12)),
            ),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextField(controller: _nameCtrl, decoration: const InputDecoration(labelText: 'Product Name *', border: OutlineInputBorder())),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(child: TextField(controller: _brandCtrl, decoration: const InputDecoration(labelText: 'Brand', border: OutlineInputBorder()))),
                      const SizedBox(width: 12),
                      Expanded(child: TextField(controller: _categoryCtrl, decoration: const InputDecoration(labelText: 'Category', border: OutlineInputBorder()))),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextField(controller: _descCtrl, maxLines: 2, decoration: const InputDecoration(labelText: 'Description', border: OutlineInputBorder())),
                  const SizedBox(height: 16),
                  const Text('UNIT & PRICING', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: GroceryMerchantTheme.textMuted)),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          value: _unit,
                          decoration: const InputDecoration(labelText: 'Unit of Sale', border: OutlineInputBorder()),
                          items: _unitOptions.map((u) => DropdownMenuItem(value: u, child: Text(u))).toList(),
                          onChanged: (val) { if (val != null) setState(() => _unit = val); },
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: _sellingPriceCtrl,
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          decoration: const InputDecoration(labelText: 'Selling Price (₹) *', prefixText: '₹', border: OutlineInputBorder()),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: _mrpCtrl,
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          decoration: const InputDecoration(labelText: 'MRP (₹)', prefixText: '₹', border: OutlineInputBorder()),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  const Text('INVENTORY & STOCK', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: GroceryMerchantTheme.textMuted)),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _stockQtyCtrl,
                          keyboardType: TextInputType.number,
                          decoration: InputDecoration(labelText: 'Stock Qty *', suffixText: _unit, border: const OutlineInputBorder()),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: _lowStockCtrl,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(labelText: 'Low Stock Alert', border: OutlineInputBorder()),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Available for Online Order', style: TextStyle(fontWeight: FontWeight.bold)),
                    value: _isAvailable,
                    activeColor: GroceryMerchantTheme.primaryGreen,
                    onChanged: (v) => setState(() => _isAvailable = v),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('PRODUCT PHOTOS', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: GroceryMerchantTheme.textMuted)),
                      TextButton.icon(
                        onPressed: _addPhotoDialog,
                        icon: const Icon(Icons.add_photo_alternate, size: 16),
                        label: const Text('Add Photo'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    height: 80,
                    child: ListView.builder(
                      scrollDirection: Axis.horizontal,
                      itemCount: _photos.length,
                      itemBuilder: (ctx, idx) => Container(
                        margin: const EdgeInsets.only(right: 10),
                        width: 80,
                        height: 80,
                        decoration: BoxDecoration(borderRadius: BorderRadius.circular(8), border: Border.all(color: GroceryMerchantTheme.borderLight)),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.network(
                            _photos[idx],
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => _groceryPlaceholderIcon(),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
      ),
    );
  }
}

/// Customer Grocery Product Preview Sheet
class _CustomerGroceryProductPreviewSheet extends StatefulWidget {
  const _CustomerGroceryProductPreviewSheet({required this.item, this.stocked});

  final Map<String, dynamic> item;
  final Map<String, dynamic>? stocked;

  @override
  State<_CustomerGroceryProductPreviewSheet> createState() => _CustomerGroceryProductPreviewSheetState();
}

class _CustomerGroceryProductPreviewSheetState extends State<_CustomerGroceryProductPreviewSheet> {
  int _quantity = 1;

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final name = (item['name'] ?? '').toString();
    final brand = (item['brand'] ?? '').toString();
    final price = (widget.stocked?['currentPrice'] as num?)?.toDouble() ?? (item['sellingPrice'] as num?)?.toDouble() ?? 99.0;
    final stock = (widget.stocked?['stockQty'] as num?)?.toInt() ?? (item['stockQty'] as num?)?.toInt() ?? 10;
    final unit = (widget.stocked?['unit'] ?? item['unit'] ?? 'pack').toString();

    final isOutOfStock = stock == 0;
    final total = price * _quantity;

    return Container(
      height: MediaQuery.of(context).size.height * 0.70,
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: const BoxDecoration(
              color: GroceryMerchantTheme.primaryGreen,
              borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Row(
                  children: [
                    Icon(Icons.storefront, color: Colors.white, size: 18),
                    SizedBox(width: 8),
                    Text('Customer Product Preview', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  ],
                ),
                IconButton(icon: const Icon(Icons.close, color: Colors.white), onPressed: () => Navigator.pop(context)),
              ],
            ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(brand.toUpperCase(), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: GroceryMerchantTheme.textMuted)),
                  const SizedBox(height: 4),
                  Text(name, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: GroceryMerchantTheme.textDark)),
                  const SizedBox(height: 8),
                  Text('Unit: $unit • In Stock: $stock available', style: const TextStyle(fontSize: 13, color: GroceryMerchantTheme.textMuted)),
                  const SizedBox(height: 16),
                  Text('₹${price.toStringAsFixed(2)}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: GroceryMerchantTheme.primaryGreenDark)),
                  const Spacer(),
                  if (isOutOfStock)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(color: const Color(0xFFFEE2E2), borderRadius: BorderRadius.circular(10)),
                      child: const Center(child: Text('Currently Out of Stock for Customers', style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold))),
                    )
                  else
                    Row(
                      children: [
                        Container(
                          decoration: BoxDecoration(border: Border.all(color: GroceryMerchantTheme.borderLight), borderRadius: BorderRadius.circular(8)),
                          child: Row(
                            children: [
                              IconButton(
                                icon: const Icon(Icons.remove),
                                onPressed: _quantity > 1 ? () => setState(() => _quantity--) : null,
                              ),
                              Text('$_quantity', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                              IconButton(
                                icon: const Icon(Icons.add),
                                onPressed: _quantity < stock ? () => setState(() => _quantity++) : null,
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: ElevatedButton(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: GroceryMerchantTheme.primaryGreen,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            ),
                            onPressed: () {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text('Preview Basket: $_quantity $unit x ₹${price.toStringAsFixed(2)} = ₹${total.toStringAsFixed(2)}'),
                                  backgroundColor: GroceryMerchantTheme.primaryGreen,
                                ),
                              );
                            },
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                const Text('Add to Basket', style: TextStyle(fontWeight: FontWeight.bold)),
                                Text('₹${total.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w900)),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

extension StringSlice on String {
  String slice(int start, [int? end]) {
    final len = length;
    int s = start < 0 ? len + start : start;
    if (s < 0) s = 0;
    if (s > len) s = len;
    int e = end == null ? len : (end < 0 ? len + end : end);
    if (e < 0) e = 0;
    if (e > len) e = len;
    if (s > e) return '';
    return substring(s, e);
  }
}
