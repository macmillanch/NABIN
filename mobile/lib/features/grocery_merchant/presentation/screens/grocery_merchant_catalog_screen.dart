import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/network/nabin_api_service.dart';
import '../theme/grocery_merchant_theme.dart';

enum _StockFilter { all, notStocked, stocked }

/// NABIN master grocery catalogue browser — the merchant's entry point for
/// stocking products that exist centrally but not yet in their own store.
class GroceryMerchantCatalogScreen extends ConsumerStatefulWidget {
  const GroceryMerchantCatalogScreen({super.key});

  @override
  ConsumerState<GroceryMerchantCatalogScreen> createState() => _GroceryMerchantCatalogScreenState();
}

class _GroceryMerchantCatalogScreenState
    extends ConsumerState<GroceryMerchantCatalogScreen> {
  bool _isLoading = true;
  String? _errorMessage;
  List<dynamic> _catalogue = [];
  Map<String, Map<String, dynamic>> _inventoryByMasterId = {};
  bool _catalogueIsDegraded = false;
  String _query = '';
  _StockFilter _filter = _StockFilter.all;
  String? _busyId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  /// The two reads are independent, so they run together; the diff between them
  /// is what tells the merchant what they have not stocked yet.
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
    // `pack_size` already carries the unit ("1 litre"), so the unit is only
    // appended when the pack text is a bare number.
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

  /// Category headers and rows in one flat list so a filter change can't leave
  /// an empty section on screen.
  List<Widget> _buildRows() {
    final needle = _query.trim().toLowerCase();

    final categories = <String, List<Widget>>{};
    for (final raw in _catalogue) {
      final item = Map<String, dynamic>.from(raw);
      final masterId = item['id']?.toString();
      if (masterId == null) continue;

      final stocked = _inventoryByMasterId[masterId];
      if (_filter == _StockFilter.stocked && stocked == null) continue;
      if (_filter == _StockFilter.notStocked && stocked != null) continue;

      if (needle.isNotEmpty) {
        final haystack =
            '${_label(item['name'])} ${_label(item['brand'])} ${_label(item['category'])} ${_label(item['subcategory'])}'
                .toLowerCase();
        if (!haystack.contains(needle)) continue;
      }

      final category =
          _label(item['category']).isEmpty ? 'Uncategorised' : _label(item['category']);
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
                ? 'Nothing in this filter.'
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
            height: 60,
            decoration: BoxDecoration(
              color: statusColor,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _label(item['name']),
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: GroceryMerchantTheme.textDark,
                  ),
                ),
                if (details.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    details,
                    style: const TextStyle(
                      fontSize: 13,
                      color: GroceryMerchantTheme.textMuted,
                    ),
                  ),
                ],
                const SizedBox(height: 8),
                if (stocked != null)
                  Text(
                    'In store • ${stocked['stockQty'] ?? 0} ${_label(stocked['unit'])} at '
                    '₹${(stocked['currentPrice'] as num?)?.toStringAsFixed(2) ?? '0.00'} • '
                    '${_getStatusText(status)}',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: statusColor,
                    ),
                  )
                else
                  const Text(
                    'Not stocked in your store yet',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: GroceryMerchantTheme.textMuted,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 12),
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
            TextButton(
              onPressed: () => _openStockSheet(item, stocked),
              style: TextButton.styleFrom(
                foregroundColor: GroceryMerchantTheme.primaryGreen,
              ),
              child: Text(stocked == null ? 'Stock' : 'Edit'),
            ),
        ],
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
          'Master Catalogue',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w800,
            color: Colors.white,
          ),
        ),
        actions: [
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
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                      child: TextField(
                        onChanged: (val) => setState(() => _query = val),
                        decoration: InputDecoration(
                          hintText: 'Search the NABIN catalogue',
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
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final option in _StockFilter.values)
                            ChoiceChip(
                              label: Text(_filterLabel(option)),
                              selected: _filter == option,
                              selectedColor: GroceryMerchantTheme.primaryGreenLight,
                              showCheckmark: false,
                              labelStyle: TextStyle(
                                fontWeight: FontWeight.w700,
                                color: _filter == option
                                    ? GroceryMerchantTheme.primaryGreenDark
                                    : GroceryMerchantTheme.textMuted,
                              ),
                              onSelected: (_) => setState(() => _filter = option),
                            ),
                        ],
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
      case _StockFilter.notStocked:
        return 'Not stocked';
      case _StockFilter.stocked:
        return 'Stocked';
    }
  }

  String _getStatusText(String status) {
    switch (status) {
      case 'AVAILABLE':
        return 'Available';
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
