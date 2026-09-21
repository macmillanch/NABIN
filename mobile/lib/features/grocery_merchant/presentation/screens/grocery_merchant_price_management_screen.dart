import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/network/nabin_api_service.dart';
import '../theme/grocery_merchant_theme.dart';

/// Price Management Screen for NABIN Grocery Merchant App.
///
/// Everything here is backed by the PostgreSQL merchant inventory read/write
/// path (`GET/POST /merchant/inventory`). Prices are applied one row at a time,
/// which is the only path that touches the merchant's real catalogue.
class GroceryMerchantPriceManagementScreen extends ConsumerStatefulWidget {
  const GroceryMerchantPriceManagementScreen({super.key});

  @override
  ConsumerState<GroceryMerchantPriceManagementScreen> createState() =>
      _GroceryMerchantPriceManagementScreenState();
}

class _GroceryMerchantPriceManagementScreenState
    extends ConsumerState<GroceryMerchantPriceManagementScreen> {
  bool _isLoading = true;
  List<dynamic> _inventory = [];
  String? _errorMessage;
  String? _busyId;

  bool _bulkMode = false;
  bool _applyingBulk = false;
  bool _increase = true;
  final Set<String> _selected = <String>{};
  final TextEditingController _percentController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadInventory();
  }

  @override
  void dispose() {
    _percentController.dispose();
    super.dispose();
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
          _errorMessage = result?['error'] ?? 'Failed to load products';
        });
      }
    } catch (e) {
      setState(() {
        _isLoading = false;
        _errorMessage = 'Network error. Please check your connection.';
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Single row price edit
  // ---------------------------------------------------------------------------

  Future<void> _updatePrice(Map<String, dynamic> item, double newPrice) async {
    final masterProductId = item['masterProductId'];
    if (masterProductId == null) {
      _showError('This item has no master catalogue product, so its price cannot be saved.');
      return;
    }

    setState(() => _busyId = masterProductId);
    try {
      final result = await NabinApiService.updateMerchantInventoryItem({
        'masterProductId': masterProductId,
        'currentPrice': newPrice,
      });
      if (result?['success'] == true) {
        await _loadInventory(silent: true);
        _showMessage('${item['masterName'] ?? 'Item'} price updated.',
            color: GroceryMerchantTheme.primaryGreen);
      } else {
        _showError(result?['error'] ?? 'The store rejected this price change.');
      }
    } catch (e) {
      _showError('Network error. The price was not saved.');
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  // ---------------------------------------------------------------------------
  // Bulk percentage adjust
  // ---------------------------------------------------------------------------

  List<Map<String, dynamic>> get _bulkCandidates {
    final percent = _percentValue;
    return _inventory.whereType<Map<String, dynamic>>().where((item) {
      final id = item['masterProductId']?.toString();
      if (id == null || !_selected.contains(id)) return false;
      return _adjustPrice(_toDouble(item['currentPrice']), percent) != null;
    }).toList();
  }

  double? get _percentValue => double.tryParse(_percentController.text.trim());

  double? _adjustPrice(double current, double? percent) {
    if (percent == null || percent <= 0 || current <= 0) return null;
    final factor = _increase ? (1 + percent / 100) : (1 - percent / 100);
    final adjusted = current * factor;
    if (adjusted <= 0) return null;
    return double.parse(adjusted.toStringAsFixed(2));
  }

  void _toggleSelectAll() {
    final editableIds = _inventory
        .whereType<Map<String, dynamic>>()
        .map((i) => i['masterProductId']?.toString())
        .whereType<String>()
        .toList();
    setState(() {
      if (_selected.isNotEmpty) {
        _selected.clear();
      } else {
        _selected.addAll(editableIds);
      }
    });
  }

  Future<void> _applyBulkAdjust() async {
    final percent = _percentValue;
    final candidates = _bulkCandidates;
    if (percent == null || percent <= 0) {
      _showError('Enter a percentage greater than 0.');
      return;
    }
    if (candidates.isEmpty) {
      _showError('Select at least one product to adjust.');
      return;
    }

    final confirmed = await _showBulkConfirmDialog(candidates, percent);
    if (confirmed != true || !mounted) return;

    setState(() => _applyingBulk = true);

    var succeeded = 0;
    final failures = <String>[];
    for (final item in candidates) {
      final name = item['masterName']?.toString() ?? 'Item';
      final target = _adjustPrice(_toDouble(item['currentPrice']), percent);
      final masterProductId = item['masterProductId']?.toString();
      if (target == null || masterProductId == null) continue;

      try {
        final result = await NabinApiService.updateMerchantInventoryItem({
          'masterProductId': masterProductId,
          'currentPrice': target,
        });
        if (result?['success'] == true) {
          succeeded++;
        } else {
          failures.add('$name: ${result?['error'] ?? 'the store rejected this change.'}');
        }
      } catch (e) {
        failures.add('$name: network error, not saved.');
      }
    }

    await _loadInventory(silent: true);
    if (!mounted) return;
    setState(() {
      _applyingBulk = false;
      _selected.clear();
    });
    await _showBulkResultDialog(succeeded, candidates.length, failures);
  }

  Future<bool?> _showBulkConfirmDialog(List<Map<String, dynamic>> candidates, double percent) {
    return showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Confirm bulk price change'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Apply a ${percent.toStringAsFixed(2)}% '
                '${_increase ? 'increase' : 'decrease'} to ${candidates.length} product(s)?'),
            const SizedBox(height: 12),
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 220),
              child: ListView(
                shrinkWrap: true,
                children: candidates.map((item) {
                  final current = _toDouble(item['currentPrice']);
                  final target = _adjustPrice(current, percent) ?? current;
                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Text(
                      '${item['masterName'] ?? 'Item'}:  ₹${current.toStringAsFixed(2)} → '
                      '₹${target.toStringAsFixed(2)}',
                      style: const TextStyle(fontSize: 13),
                    ),
                  );
                }).toList(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: GroceryMerchantTheme.primaryGreen,
            ),
            child: const Text('Apply'),
          ),
        ],
      ),
    );
  }

  Future<void> _showBulkResultDialog(int succeeded, int total, List<String> failures) async {
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Bulk update complete'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('$succeeded of $total products updated.'),
            if (failures.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(
                'Not saved:',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  color: GroceryMerchantTheme.accentRose,
                ),
              ),
              const SizedBox(height: 4),
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 200),
                child: ListView(
                  shrinkWrap: true,
                  children: failures
                      .map((f) => Padding(
                            padding: const EdgeInsets.symmetric(vertical: 2),
                            child: Text('• $f', style: const TextStyle(fontSize: 13)),
                          ))
                      .toList(),
                ),
              ),
            ],
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: GroceryMerchantTheme.bgOffWhite,
      appBar: AppBar(
        backgroundColor: GroceryMerchantTheme.primaryGreen,
        elevation: 0,
        title: const Text(
          'Price Management',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w800,
            color: Colors.white,
          ),
        ),
        actions: [
          IconButton(
            icon: Icon(_bulkMode ? Icons.close : Icons.tune, color: Colors.white),
            tooltip: _bulkMode ? 'Exit bulk adjust' : 'Bulk adjust',
            onPressed: _applyingBulk ? null : () => setState(() {
                  _bulkMode = !_bulkMode;
                  if (!_bulkMode) _selected.clear();
                }),
          ),
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white),
            onPressed: _isLoading ? null : _loadInventory,
          ),
        ],
      ),
      body: _buildBody(),
      bottomNavigationBar: _bulkMode && _inventory.isNotEmpty ? _buildBulkBar() : null,
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(
        child: CircularProgressIndicator(color: GroceryMerchantTheme.primaryGreen),
      );
    }
    if (_errorMessage != null) {
      return _buildErrorState();
    }
    if (_inventory.isEmpty) {
      return _buildEmptyState();
    }
    return RefreshIndicator(
      onRefresh: _loadInventory,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.fromLTRB(16, 16, 16, _bulkMode ? 200 : 16),
        children: [
          if (_bulkMode) _bulkHint,
          for (final item in _inventory) _buildRow(Map<String, dynamic>.from(item as Map)),
        ],
      ),
    );
  }

  Widget get _bulkHint => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Text(
          'Select products, set a percentage, then apply. Each product is saved individually.',
          style: TextStyle(fontSize: 13, color: GroceryMerchantTheme.textMuted),
        ),
      );

  Widget _buildErrorState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              _errorMessage!,
              style: TextStyle(color: GroceryMerchantTheme.accentRose, fontSize: 16),
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
            Icons.sell_outlined,
            size: 56,
            color: GroceryMerchantTheme.textMuted.withValues(alpha: 0.3),
          ),
          const SizedBox(height: 16),
          const Text(
            'No products to price yet',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
              color: GroceryMerchantTheme.textDark,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Stock products in Inventory first, then set their store prices here.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 14, color: GroceryMerchantTheme.textMuted),
          ),
          const SizedBox(height: 20),
          Center(
            child: ElevatedButton.icon(
              onPressed: () => Navigator.of(context).pushNamed('/inventory'),
              icon: const Icon(Icons.inventory_2_outlined),
              label: const Text('Go to Inventory'),
              style: ElevatedButton.styleFrom(
                backgroundColor: GroceryMerchantTheme.primaryGreen,
                foregroundColor: Colors.white,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRow(Map<String, dynamic> item) {
    final masterProductId = item['masterProductId']?.toString();
    final editable = masterProductId != null;
    final name = item['masterName']?.toString() ?? 'Unknown Product';
    final category = item['category']?.toString() ?? 'Grocery';
    final unit = item['unit']?.toString() ?? '';
    final packSize = item['packSize'];
    final stockQty = _toDouble(item['stockQty']).toInt();
    final price = _toDouble(item['currentPrice']);
    final listed = item['isAvailable'] == true;
    final status = item['status']?.toString() ?? 'UNKNOWN';
    final statusColor = _statusColor(status);
    final selected = masterProductId != null && _selected.contains(masterProductId);
    final percent = _percentValue;
    final preview =
        _bulkMode && selected ? _adjustPrice(price, percent) : null;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: GroceryMerchantTheme.borderLight, width: 1),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_bulkMode) ...[
            Checkbox(
              value: selected,
              activeColor: GroceryMerchantTheme.primaryGreen,
              onChanged: !editable || _applyingBulk
                  ? null
                  : (val) {
                      setState(() {
                        if (val == true) {
                          _selected.add(masterProductId);
                        } else {
                          _selected.remove(masterProductId);
                        }
                      });
                    },
            ),
            const SizedBox(width: 4),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: GroceryMerchantTheme.textDark,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '$category • ${_packSizeText(unit, packSize)}',
                  style: TextStyle(fontSize: 13, color: GroceryMerchantTheme.textMuted),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    _statusChip(status, statusColor),
                    Text(
                      'Stock: $stockQty',
                      style: TextStyle(fontSize: 13, color: GroceryMerchantTheme.textMuted),
                    ),
                    _availabilityChip(listed),
                  ],
                ),
                const SizedBox(height: 12),
                if (_bulkMode)
                  _bulkPricePreview(price, preview)
                else
                  _priceEditor(item, price, unit),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _priceEditor(Map<String, dynamic> item, double price, String unit) {
    final masterProductId = item['masterProductId']?.toString();
    final busy = masterProductId != null && _busyId == masterProductId;

    if (masterProductId == null) {
      return Text(
        '₹${price.toStringAsFixed(2)}  (not editable: no catalogue link)',
        style: TextStyle(fontSize: 14, color: GroceryMerchantTheme.textMuted),
      );
    }

    return _InlinePriceField(
      key: ValueKey('price_$masterProductId'),
      initialPrice: price,
      unit: unit,
      busy: busy,
      disabled: _busyId != null && !busy,
      onSubmit: (value) => _updatePrice(item, value),
    );
  }

  Widget _bulkPricePreview(double price, double? preview) {
    if (preview == null) {
      return Text(
        '₹${price.toStringAsFixed(2)}',
        style: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w700,
          color: GroceryMerchantTheme.textDark,
        ),
      );
    }
    return Row(
      children: [
        Text(
          '₹${price.toStringAsFixed(2)}',
          style: TextStyle(
            fontSize: 14,
            color: GroceryMerchantTheme.textMuted,
            decoration: TextDecoration.lineThrough,
          ),
        ),
        const SizedBox(width: 8),
        Text(
          '→ ₹${preview.toStringAsFixed(2)}',
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w800,
            color: GroceryMerchantTheme.primaryGreen,
          ),
        ),
      ],
    );
  }

  Widget _buildBulkBar() {
    final percent = _percentValue;
    final count = _bulkCandidates.length;
    final canApply = percent != null && percent > 0 && count > 0 && !_applyingBulk;

    return SafeArea(
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
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
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                ChoiceChip(
                  label: const Text('Increase'),
                  selected: _increase,
                  selectedColor: GroceryMerchantTheme.primaryGreen,
                  labelStyle: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: _increase ? Colors.white : GroceryMerchantTheme.textDark,
                  ),
                  onSelected: _applyingBulk ? null : (_) => setState(() => _increase = true),
                ),
                const SizedBox(width: 8),
                ChoiceChip(
                  label: const Text('Decrease'),
                  selected: !_increase,
                  selectedColor: GroceryMerchantTheme.primaryGreen,
                  labelStyle: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: !_increase ? Colors.white : GroceryMerchantTheme.textDark,
                  ),
                  onSelected: _applyingBulk ? null : (_) => setState(() => _increase = false),
                ),
                const Spacer(),
                TextButton(
                  onPressed: _applyingBulk ? null : _toggleSelectAll,
                  child: Text(_selected.isEmpty ? 'Select all' : 'Clear'),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _percentController,
                    enabled: !_applyingBulk,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(
                      isDense: true,
                      labelText: 'Percentage',
                      suffixText: '%',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                ElevatedButton.icon(
                  onPressed: canApply ? _applyBulkAdjust : null,
                  icon: _applyingBulk
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.check, size: 16),
                  label: Text('Apply ($count)'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: GroceryMerchantTheme.primaryGreen,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _statusChip(String status, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        _statusText(status),
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: color),
      ),
    );
  }

  Widget _availabilityChip(bool listed) {
    final color = listed ? GroceryMerchantTheme.primaryGreen : GroceryMerchantTheme.accentRose;
    return Text(
      listed ? 'Listed' : 'Hidden',
      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: color),
    );
  }

  String _packSizeText(String unit, dynamic packSize) {
    final size = packSize?.toString();
    if (unit.isEmpty && (size == null || size.isEmpty)) return 'Unit n/a';
    if (size == null || size.isEmpty || size == '1') return unit.isEmpty ? 'Unit n/a' : unit;
    return '$size $unit';
  }

  String _statusText(String status) => switch (status) {
        'AVAILABLE' => 'Available',
        'LOW_STOCK' => 'Low Stock',
        'OUT_OF_STOCK' => 'Out of Stock',
        'INACTIVE' => 'Hidden',
        _ => status,
      };

  Color _statusColor(String status) => switch (status) {
        'AVAILABLE' => GroceryMerchantTheme.primaryGreen,
        'LOW_STOCK' => GroceryMerchantTheme.accentAmber,
        'OUT_OF_STOCK' || 'INACTIVE' => GroceryMerchantTheme.accentRose,
        _ => GroceryMerchantTheme.textMuted,
      };

  double _toDouble(dynamic value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? 0;
    return 0;
  }

  void _showError(String message) =>
      _showMessage(message, color: GroceryMerchantTheme.accentRose);

  void _showMessage(String message, {Color? color}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: color),
    );
  }
}

/// Inline store-price editor for a single inventory row.
class _InlinePriceField extends StatefulWidget {
  const _InlinePriceField({
    super.key,
    required this.initialPrice,
    required this.unit,
    required this.busy,
    required this.disabled,
    required this.onSubmit,
  });

  final double initialPrice;
  final String unit;
  final bool busy;
  final bool disabled;
  final Future<void> Function(double newPrice) onSubmit;

  @override
  State<_InlinePriceField> createState() => _InlinePriceFieldState();
}

class _InlinePriceFieldState extends State<_InlinePriceField> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.initialPrice.toStringAsFixed(2));
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final value = double.tryParse(_controller.text.trim());
    if (value == null || value <= 0) {
      setState(() => _error = 'Enter a price greater than 0.');
      return;
    }
    setState(() => _error = null);
    await widget.onSubmit(value);
  }

  @override
  Widget build(BuildContext context) {
    final unit = widget.unit;
    return Row(
      children: [
        Expanded(
          child: TextField(
            controller: _controller,
            enabled: !widget.busy && !widget.disabled,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(
              isDense: true,
              labelText: 'Store price',
              prefixText: '₹ ',
              suffixText: unit.isEmpty ? null : 'per $unit',
              errorText: _error,
              border: const OutlineInputBorder(),
            ),
          ),
        ),
        const SizedBox(width: 8),
        SizedBox(
          height: 40,
          child: ElevatedButton(
            onPressed: widget.busy || widget.disabled ? null : _submit,
            style: ElevatedButton.styleFrom(
              backgroundColor: GroceryMerchantTheme.primaryGreen,
              foregroundColor: Colors.white,
            ),
            child: widget.busy
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Text('Save'),
          ),
        ),
      ],
    );
  }
}
