import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/network/nabin_api_service.dart';
import 'package:mobile/core/network/session_manager.dart';
import '../theme/grocery_merchant_theme.dart';
import '../utils/grocery_order_flow.dart';

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
  /// `standard_unit` values that carry a packed weight, per migration 001:
  /// ('g','kg','ml','litre','piece','dozen','pack').
  static const Set<String> _weightUnits = {'g', 'kg', 'ml', 'litre'};

  /// States where the merchant works the order before handover.
  static const Set<String> _packingStates = {'ACCEPTED', 'PREPARING', 'PACKING'};

  bool _isLoading = true;
  Map<String, dynamic>? _order;
  String? _errorMessage;
  bool _sessionExpired = false;
  String? _busyOrderId;
  String? _busyLineId;

  @override
  void initState() {
    super.initState();
    _loadOrderDetail();
  }

  String? _merchantId() => SessionManager.instance.currentUser?['id']?.toString();

  Future<void> _loadOrderDetail({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _isLoading = true;
        _errorMessage = null;
        _sessionExpired = false;
      });
    }

    try {
      final merchantId = _merchantId();
      if (merchantId == null) {
        setState(() {
          _isLoading = false;
          _sessionExpired = true;
          _errorMessage = 'Your session has expired. Please sign in again.';
        });
        return;
      }

      // There is no single-order endpoint, so we read the merchant's orders and pick one.
      final result = await NabinApiService.getMerchantOrders(merchantId);

      if (result?['success'] == true) {
        final orders = (result?['orders'] as List<dynamic>?) ?? [];
        final matches = orders.whereType<Map<String, dynamic>>().where(
              (o) => o['id']?.toString() == widget.orderId || o['order_number']?.toString() == widget.orderId,
            );
        if (matches.isEmpty) {
          setState(() {
            _isLoading = false;
            _errorMessage = 'Order not found';
          });
        } else {
          setState(() {
            _order = matches.first;
            _errorMessage = null;
            _isLoading = false;
          });
        }
      } else {
        setState(() {
          _isLoading = false;
          _errorMessage = result?['error'] ?? 'Failed to load order';
        });
      }
    } catch (_) {
      setState(() {
        _isLoading = false;
        _errorMessage = 'Network error. Please check your connection.';
      });
    }
  }

  Future<void> _performAction(GroceryMerchantAction action) async {
    final order = _order;
    if (order == null) return;

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
    final merchantId = _merchantId();
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
        await _loadOrderDetail(silent: true);
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

  /// Confirms the packed weight for one line. Only weight/volume lines reach this.
  Future<void> _submitPackedWeight(String lineId, double packedWeight) async {
    final orderId = _order?['id']?.toString();
    if (orderId == null || lineId.isEmpty) {
      _showError('This order cannot be updated yet.');
      return;
    }

    setState(() => _busyLineId = lineId);
    try {
      final result = await NabinApiService.submitGroceryPackedWeight(
        orderId: orderId,
        itemId: lineId,
        packedWeight: packedWeight,
      );
      if (result?['success'] == true) {
        // Re-read so the packed state reflects the backend, never a local guess.
        await _loadOrderDetail(silent: true);
        _showSuccess('Packed weight confirmed.');
      } else {
        _showError(result?['error'] ?? 'The platform rejected this packed weight.');
      }
    } catch (e) {
      _showError('Network error. The packed weight was not saved.');
    } finally {
      if (mounted) setState(() => _busyLineId = null);
    }
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

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: GroceryMerchantTheme.accentRose),
    );
  }

  void _showSuccess(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: GroceryMerchantTheme.primaryGreen),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = _order?['order_state'];

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
          if (_order != null)
            IconButton(
              icon: const Icon(Icons.refresh, color: Colors.white),
              onPressed: _busyOrderId == null ? _loadOrderDetail : null,
              tooltip: 'Refresh',
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
              ? _buildMessageState()
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _buildStatusBadge(state),
                      const SizedBox(height: 32),
                      _buildCustomerReference(),
                      const SizedBox(height: 16),
                      const Text(
                        'Order Summary',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: GroceryMerchantTheme.textDark,
                        ),
                      ),
                      const SizedBox(height: 12),
                      ..._buildItemRows(),
                      const SizedBox(height: 32),
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
                            '₹${_toDouble(_order?['total_amount']).toStringAsFixed(0)}',
                            style: const TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w800,
                              color: GroceryMerchantTheme.textDark,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 32),
                      if (groceryMerchantActions(state).isNotEmpty) ...[
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

  Widget _buildMessageState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
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
            if (_sessionExpired)
              ElevatedButton(
                onPressed: () =>
                    Navigator.of(context).pushNamedAndRemoveUntil('/login', (route) => false),
                style: ElevatedButton.styleFrom(
                  backgroundColor: GroceryMerchantTheme.primaryGreen,
                ),
                child: const Text('Sign in again'),
              )
            else
              ElevatedButton(
                onPressed: _loadOrderDetail,
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

  Widget _buildStatusBadge(String? state) {
    final color = groceryOrderStatusColor(state);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color, width: 1),
      ),
      child: Text(
        groceryOrderStatusLabel(state),
        style: TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
  }

  /// Orders expose only `customer_id`; there is no customer name on the order row.
  Widget _buildCustomerReference() {
    return Row(
      children: [
        const Icon(
          Icons.person_outline_rounded,
          size: 20,
          color: GroceryMerchantTheme.textMuted,
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            'Customer ref: ${_customerReference(_order?['customer_id'])}',
            style: TextStyle(
              fontSize: 16,
              color: GroceryMerchantTheme.textDark,
            ),
          ),
        ),
      ],
    );
  }

  List<Widget> _buildItemRows() {
    final lines = (_order?['lines'] as List?) ?? const [];
    if (lines.isEmpty) {
      return [
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
      ];
    }
    return lines.map((line) => _buildOrderItem(line)).toList();
  }

  Widget _buildOrderItem(dynamic line) {
    final item = (line as Map?)?.cast<String, dynamic>() ?? const <String, dynamic>{};
    final name = item['product_name_snapshot']?.toString() ?? 'Unknown Item';
    final unit = item['unit_snapshot']?.toString() ?? '';
    final quantity = _toDouble(item['quantity']);
    final unitPrice = _toDouble(item['unit_price_snapshot']);
    final lineTotal = _toDouble(item['line_total']);
    final packedQty = _toDouble(item['packed_confirmed_quantity']);
    final lineId = item['id']?.toString() ?? '';

    final isWeightUnit = _weightUnits.contains(unit.toLowerCase());
    final inPackingPhase = _packingStates.contains(_order?['order_state']);
    final isPacked = isWeightUnit && packedQty >= quantity && quantity > 0;
    final busyLine = _busyLineId != null && _busyLineId == lineId;
    final anyBusy = _busyLineId != null;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isPacked ? GroceryMerchantTheme.bgOffWhite : Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: isPacked ? GroceryMerchantTheme.borderLight : Colors.transparent,
        ),
        boxShadow: [
          if (!isPacked)
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.02),
              blurRadius: 3,
              offset: const Offset(0, 1),
            ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 50,
                height: 50,
                decoration: BoxDecoration(
                  color: GroceryMerchantTheme.surfaceElevated,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  isPacked ? Icons.check_circle_outline : Icons.shopping_bag_outlined,
                  size: 24,
                  color: isPacked
                      ? GroceryMerchantTheme.primaryGreen
                      : GroceryMerchantTheme.primaryGreen,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: isPacked
                            ? GroceryMerchantTheme.textMuted
                            : GroceryMerchantTheme.textDark,
                        decoration: isPacked ? TextDecoration.lineThrough : TextDecoration.none,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Qty: ${_trimNum(quantity)} $unit × ₹${unitPrice.toStringAsFixed(2)}',
                      style: TextStyle(
                        fontSize: 12,
                        color: GroceryMerchantTheme.textMuted,
                      ),
                    ),
                    if (isWeightUnit && packedQty > 0)
                      Text(
                        'Packed: ${_trimNum(packedQty)} $unit',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: isPacked
                              ? GroceryMerchantTheme.primaryGreen
                              : GroceryMerchantTheme.accentAmber,
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Text(
                '₹${lineTotal.toStringAsFixed(0)}',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: isPacked ? GroceryMerchantTheme.textMuted : GroceryMerchantTheme.primaryGreen,
                ),
              ),
            ],
          ),
          // Only weight/volume lines submitted through the packed-weight endpoint get an
          // input; piece/dozen/pack lines just show their quantity above.
          if (isWeightUnit && inPackingPhase && !isPacked && lineId.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: _PackedWeightField(
                unit: unit,
                remaining: (quantity - packedQty).clamp(0, quantity).toDouble(),
                max: quantity,
                busy: busyLine,
                disabled: anyBusy,
                onSubmit: (weight) => _submitPackedWeight(lineId, weight),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildStatusActionButtons() {
    final actions = groceryMerchantActions(_order?['order_state']);
    if (actions.isEmpty) return const SizedBox.shrink();
    final busy = _busyOrderId != null;

    return Row(
      children: [
        for (var i = 0; i < actions.length; i++) ...[
          if (i > 0) const SizedBox(width: 16),
          Expanded(child: _buildActionButton(actions[i], busy)),
        ],
      ],
    );
  }

  Widget _buildActionButton(GroceryMerchantAction action, bool busy) {
    final onPressed = busy ? null : () => _performAction(action);
    final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(10));

    if (action.danger) {
      return OutlinedButton.icon(
        onPressed: onPressed,
        icon: const Icon(Icons.close, size: 16),
        label: Text(action.label),
        style: OutlinedButton.styleFrom(
          foregroundColor: GroceryMerchantTheme.accentRose,
          side: const BorderSide(color: GroceryMerchantTheme.accentRose),
          padding: const EdgeInsets.symmetric(vertical: 14),
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
        padding: const EdgeInsets.symmetric(vertical: 14),
        shape: shape,
      ),
    );
  }

  String _customerReference(dynamic customerId) {
    final value = customerId?.toString() ?? '';
    if (value.isEmpty) return 'Unavailable';
    final cleaned = value.replaceAll('-', '');
    return '#${cleaned.substring(cleaned.length > 6 ? cleaned.length - 6 : 0)}';
  }

  double _toDouble(dynamic value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? 0;
    return 0;
  }
}

/// Per-line packed weight input for weight/volume order lines.
class _PackedWeightField extends StatefulWidget {
  const _PackedWeightField({
    required this.unit,
    required this.remaining,
    required this.max,
    required this.busy,
    required this.disabled,
    required this.onSubmit,
  });

  final String unit;
  final double remaining;
  final double max;
  final bool busy;
  final bool disabled;
  final Future<void> Function(double packedWeight) onSubmit;

  @override
  State<_PackedWeightField> createState() => _PackedWeightFieldState();
}

class _PackedWeightFieldState extends State<_PackedWeightField> {
  late final TextEditingController _controller =
      TextEditingController(text: _trimNum(widget.remaining));
  String? _validationError;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final value = double.tryParse(_controller.text.trim());
    if (value == null || value <= 0) {
      setState(() => _validationError = 'Enter a packed quantity greater than 0.');
      return;
    }
    if (value > widget.max) {
      setState(() => _validationError = 'Cannot exceed the ordered ${_trimNum(widget.max)} ${widget.unit}.');
      return;
    }
    setState(() => _validationError = null);
    await widget.onSubmit(value);
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: TextField(
            controller: _controller,
            enabled: !widget.busy && !widget.disabled,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(
              isDense: true,
              labelText: 'Confirm packed quantity (${widget.unit})',
              errorText: _validationError,
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
                : const Text('Pack'),
          ),
        ),
      ],
    );
  }
}

/// Renders a quantity without a trailing `.0` when it is a whole number.
String _trimNum(double value) =>
    value == value.roundToDouble() ? value.toStringAsFixed(0) : value.toString();
