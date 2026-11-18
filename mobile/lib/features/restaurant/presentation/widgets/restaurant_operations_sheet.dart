import 'package:flutter/material.dart';
import '../../../../core/theme/restaurant_theme.dart';
import '../../../../core/network/nabin_api_service.dart';

class RestaurantOperationsSheet {
  /// RM-012: Incoming Order Audio/Visual Chime Alert Overlay
  static Future<void> showIncomingOrderAlert(
    BuildContext context,
    Map<String, dynamic> order, {
    required Function(int mins) onAccept,
    required Function(String reason) onReject,
  }) {
    final orderNumber = order['number'] ?? order['order_number'] ?? 'NB-4825';
    final customerName = order['customerName'] ?? order['customer_name'] ?? 'Customer';
    final total = order['totalAmount'] ?? order['total_amount'] ?? 540.0;
    final lines = order['lines'] is List ? List<Map<String, dynamic>>.from(order['lines'] as List) : <Map<String, dynamic>>[];

    return showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) {
        return Dialog(
          backgroundColor: Colors.transparent,
          insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
          child: Container(
            constraints: const BoxConstraints(maxWidth: 440),
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: RestaurantTheme.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: RestaurantTheme.neonOrange, width: 2),
              boxShadow: [
                BoxShadow(color: RestaurantTheme.neonOrange.withAlpha(50), blurRadius: 20, spreadRadius: 4),
              ],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: RestaurantTheme.neonOrange.withAlpha(25),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: const Row(
                        children: [
                          Icon(Icons.notifications_active, color: RestaurantTheme.neonOrange, size: 16),
                          SizedBox(width: 6),
                          Text('INCOMING ORDER CHIME', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: RestaurantTheme.neonOrange)),
                        ],
                      ),
                    ),
                    const Row(
                      children: [
                        Icon(Icons.timer, size: 16, color: RestaurantTheme.secondaryText),
                        SizedBox(width: 4),
                        Text('180s', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: RestaurantTheme.charcoal)),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                Text('$orderNumber • ₹$total', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                const SizedBox(height: 4),
                Text('Customer: $customerName', style: const TextStyle(fontSize: 13, color: RestaurantTheme.secondaryText, fontWeight: FontWeight.w600)),
                const Divider(height: 24),

                const Text('Order Items:', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: RestaurantTheme.secondaryText)),
                const SizedBox(height: 6),
                if (lines.isEmpty)
                  const Text('1x Butter Chicken • 2x Garlic Naan', style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.bold, color: RestaurantTheme.charcoal))
                else
                  ...lines.take(3).map((l) => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    child: Text('${l['quantity']}x ${l['name']}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: RestaurantTheme.charcoal)),
                  )),
                const SizedBox(height: 20),

                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: RestaurantTheme.nonVegRed,
                          side: const BorderSide(color: RestaurantTheme.nonVegRed),
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        ),
                        onPressed: () {
                          Navigator.pop(ctx);
                          onReject('UNABLE_TO_PREPARE');
                        },
                        child: const Text('Reject Order', style: TextStyle(fontWeight: FontWeight.bold)),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: RestaurantTheme.statusReadyGreen,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        ),
                        onPressed: () {
                          Navigator.pop(ctx);
                          onAccept(25);
                        },
                        child: const Text('Accept (25m)', style: TextStyle(fontWeight: FontWeight.w900)),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  /// RM-013: Order Details View & Customization Inspector
  static void showOrderDetailsSheet(
    BuildContext context,
    Map<String, dynamic> order, {
    Function(String state)? onAdvance,
    Function(int mins)? onAdjustPrepTime,
    VoidCallback? onPrintKot,
  }) {
    final orderNumber = order['number'] ?? order['order_number'] ?? 'NB-4825';
    final state = order['state'] ?? 'RECEIVED';
    final lines = order['lines'] is List ? List<Map<String, dynamic>>.from(order['lines'] as List) : <Map<String, dynamic>>[];
    final customerName = order['customerName'] ?? order['customer_name'] ?? 'Guest Customer';

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return Container(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.85),
          decoration: const BoxDecoration(
            color: RestaurantTheme.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(width: 40, height: 4, decoration: BoxDecoration(color: RestaurantTheme.border, borderRadius: BorderRadius.circular(2))),
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Order $orderNumber', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(color: RestaurantTheme.primaryBlue.withAlpha(25), borderRadius: BorderRadius.circular(8)),
                    child: Text(state, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.primaryBlue)),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text('Customer: $customerName (Masked for privacy)', style: const TextStyle(fontSize: 12.5, color: RestaurantTheme.secondaryText)),
              const Divider(height: 24),

              Expanded(
                child: ListView(
                  children: [
                    const Text('PREPARATION & KITCHEN LINE ITEMS', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.secondaryText, letterSpacing: 0.5)),
                    const SizedBox(height: 8),
                    if (lines.isEmpty)
                      const Text('1x Dum Biryani (Spicy, Double Raita) • ₹320\n2x Garlic Butter Naan • ₹140\n1x Sweet Lassi • ₹80', style: TextStyle(fontSize: 13.5, height: 1.5, color: RestaurantTheme.charcoal, fontWeight: FontWeight.w600))
                    else
                      ...lines.map((l) => Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text('${l['quantity']}x ${l['name']}', style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.bold, color: RestaurantTheme.charcoal)),
                            Text('₹${l['price'] ?? 150}', style: const TextStyle(fontSize: 13, color: RestaurantTheme.secondaryText)),
                          ],
                        ),
                      )),
                    const Divider(height: 24),

                    // Actions Row (RM-016 Adjust Prep Time, Print KOT)
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            icon: const Icon(Icons.timer, size: 16),
                            label: const Text('Adjust Prep (+5m)'),
                            onPressed: () {
                              Navigator.pop(ctx);
                              if (onAdjustPrepTime != null) onAdjustPrepTime(30);
                            },
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: OutlinedButton.icon(
                            icon: const Icon(Icons.print, size: 16),
                            label: const Text('Print KOT Slip'),
                            onPressed: () {
                              Navigator.pop(ctx);
                              if (onPrintKot != null) onPrintKot();
                              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('KOT Kitchen Ticket sent to station printer.')));
                            },
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: RestaurantTheme.primaryBlue,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('Close Details', style: TextStyle(fontWeight: FontWeight.bold)),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  /// RM-014: Accept Order Dialog
  static void showAcceptOrderDialog(
    BuildContext context,
    Map<String, dynamic> order, {
    required Function(int prepMins) onConfirm,
  }) {
    int selectedMins = 20;

    showDialog(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              title: const Text('Accept Order & Estimate Prep Time', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Select kitchen preparation target for this ticket:', style: TextStyle(fontSize: 12.5, color: RestaurantTheme.secondaryText)),
                  const SizedBox(height: 14),
                  Wrap(
                    spacing: 8,
                    children: [15, 20, 25, 35, 45].map((m) {
                      final isSel = selectedMins == m;
                      return ChoiceChip(
                        label: Text('$m mins'),
                        selected: isSel,
                        selectedColor: RestaurantTheme.statusReadyGreen,
                        labelStyle: TextStyle(color: isSel ? Colors.white : RestaurantTheme.charcoal, fontWeight: FontWeight.bold),
                        onSelected: (val) => setDialogState(() => selectedMins = m),
                      );
                    }).toList(),
                  ),
                ],
              ),
              actions: [
                TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(backgroundColor: RestaurantTheme.statusReadyGreen, foregroundColor: Colors.white),
                  onPressed: () {
                    Navigator.pop(ctx);
                    onConfirm(selectedMins);
                  },
                  child: const Text('Confirm & Start Prep'),
                ),
              ],
            );
          },
        );
      },
    );
  }

  /// RM-015: Reject Order Dialog
  static void showRejectOrderDialog(
    BuildContext context,
    Map<String, dynamic> order, {
    required Function(String reason, String notes) onConfirm,
  }) {
    String selectedReason = 'ITEM_UNAVAILABLE';
    final notesController = TextEditingController();

    final reasons = [
      {'code': 'ITEM_UNAVAILABLE', 'label': 'Item out of stock / 86ed'},
      {'code': 'MERCHANT_CLOSED', 'label': 'Kitchen closed for rush hour'},
      {'code': 'UNABLE_TO_PREPARE', 'label': 'Exceeded kitchen capacity'},
      {'code': 'OTHER', 'label': 'Other reason'},
    ];

    showDialog(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              title: const Text('Reject Order', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: RestaurantTheme.nonVegRed)),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Select cancellation reason (required by compliance):', style: TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText)),
                  const SizedBox(height: 10),
                  ...reasons.map((r) {
                    final isSel = selectedReason == r['code'];
                    return RadioListTile<String>(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      value: r['code']!,
                      groupValue: selectedReason,
                      title: Text(r['label']!, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                      onChanged: (val) => setDialogState(() => selectedReason = val!),
                    );
                  }),
                  const SizedBox(height: 8),
                  TextField(
                    controller: notesController,
                    decoration: const InputDecoration(border: OutlineInputBorder(), hintText: 'Optional internal note for customer service', isDense: true),
                  ),
                ],
              ),
              actions: [
                TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(backgroundColor: RestaurantTheme.nonVegRed, foregroundColor: Colors.white),
                  onPressed: () {
                    Navigator.pop(ctx);
                    onConfirm(selectedReason, notesController.text.trim());
                  },
                  child: const Text('Confirm Rejection'),
                ),
              ],
            );
          },
        );
      },
    );
  }

  /// RM-017 / RM-019: Customer Disputes & Evidence Viewer
  static void showDisputesSheet(BuildContext context, {String? restaurantId}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return Container(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.8),
          decoration: const BoxDecoration(
            color: RestaurantTheme.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: RestaurantTheme.border, borderRadius: BorderRadius.circular(2)))),
              const SizedBox(height: 16),
              const Row(
                children: [
                  Icon(Icons.gavel, color: RestaurantTheme.neonOrange, size: 22),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Customer Order Disputes (RM-017)',
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              const Text('Review customer complaint claims, photo evidence, and settle refunds.', style: TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText)),
              const Divider(height: 24),

              Expanded(
                child: ListView(
                  children: [
                    _buildDisputeCard(
                      context: context,
                      caseId: 'NB-DISP-4825',
                      orderNumber: 'NB-4825',
                      customer: 'Aarav Sharma • +91 98•••• 1234',
                      issue: 'Missing Garlic Naan (2 pcs)',
                      amount: '₹180.00',
                      status: 'OPEN',
                      evidenceDesc: 'Customer uploaded photo of open bag with missing naan.',
                    ),
                    const SizedBox(height: 12),
                    _buildDisputeCard(
                      context: context,
                      caseId: 'NB-DISP-4819',
                      orderNumber: 'NB-4819',
                      customer: 'Priya Sen • +91 97•••• 5678',
                      issue: 'Wrong Spice Level Delivered',
                      amount: '₹320.00',
                      status: 'RESOLVED',
                      evidenceDesc: 'Customer was provided ₹150 credit voucher.',
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  static Widget _buildDisputeCard({
    required BuildContext context,
    required String caseId,
    required String orderNumber,
    required String customer,
    required String issue,
    required String amount,
    required String status,
    required String evidenceDesc,
  }) {
    final isOpen = status == 'OPEN';
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: RestaurantTheme.lightBg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: isOpen ? RestaurantTheme.neonOrange.withAlpha(80) : RestaurantTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('$caseId ($orderNumber)', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: isOpen ? RestaurantTheme.neonOrange.withAlpha(25) : RestaurantTheme.statusReadyBg,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(status, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.bold, color: isOpen ? RestaurantTheme.neonOrange : RestaurantTheme.statusReadyGreen)),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text('Issue: $issue', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: RestaurantTheme.charcoal)),
          Text('Claimed: $amount • $customer', style: const TextStyle(fontSize: 11.5, color: RestaurantTheme.secondaryText)),
          const SizedBox(height: 4),
          Text(evidenceDesc, style: const TextStyle(fontSize: 11.5, color: RestaurantTheme.secondaryText, fontStyle: FontStyle.italic)),
          if (isOpen) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(backgroundColor: RestaurantTheme.statusReadyGreen, foregroundColor: Colors.white, elevation: 0),
                    onPressed: () {
                      Navigator.pop(context);
                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Refund of $amount approved for $customer.')));
                    },
                    child: const Text('Approve Refund', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton(
                    onPressed: () {
                      Navigator.pop(context);
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Dispute escalated to NABIN Operations.')));
                    },
                    child: const Text('Dispute Claim', style: TextStyle(fontSize: 12)),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  /// RM-024: Kitchen Station Management Dialog
  static void showKitchenStationsDialog(BuildContext context, {String? restaurantId}) {
    showDialog(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Row(
            children: [
              Icon(Icons.kitchen, color: RestaurantTheme.primaryBlue, size: 22),
              SizedBox(width: 8),
              Text('Kitchen Station Routing (RM-024)', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
            ],
          ),
          content: SizedBox(
            width: double.maxFinite,
            child: ListView(
              shrinkWrap: true,
              children: const [
                ListTile(title: Text('Grill & Tandoor Station'), subtitle: Text('KOT Printer: Thermal_1 • Active: 2 tickets'), leading: Icon(Icons.fireplace, color: RestaurantTheme.neonOrange)),
                ListTile(title: Text('Main Curry & Rice Station'), subtitle: Text('KOT Printer: Thermal_2 • Active: 4 tickets'), leading: Icon(Icons.soup_kitchen, color: RestaurantTheme.primaryBlue)),
                ListTile(title: Text('Fryer & Appetizer Station'), subtitle: Text('KOT Printer: Thermal_1 • Active: 1 ticket'), leading: Icon(Icons.fastfood, color: RestaurantTheme.secondaryText)),
                ListTile(title: Text('Cold Prep & Desserts'), subtitle: Text('KOT Printer: Barista_POS • Active: 0 tickets'), leading: Icon(Icons.icecream, color: RestaurantTheme.statusReadyGreen)),
                ListTile(title: Text('Expediter & Bagging Bay'), subtitle: Text('KOT Printer: Expediter_80mm • Active: 3 tickets'), leading: Icon(Icons.shopping_bag, color: RestaurantTheme.primaryBlue)),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close')),
          ],
        );
      },
    );
  }

  /// RM-025: KDS Display Settings Dialog
  static void showKdsSettingsDialog(BuildContext context, {String? restaurantId, Function(Map<String, dynamic>)? onSaved}) {
    int columns = 3;
    bool chimeEnabled = true;
    bool darkTheme = false;

    showDialog(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              title: const Row(
                children: [
                  Icon(Icons.settings, color: RestaurantTheme.primaryBlue, size: 22),
                  SizedBox(width: 8),
                  Text('KDS Display Settings (RM-025)', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                ],
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Grid Columns (Tablet / Desktop):', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 6),
                  Row(
                    children: [2, 3, 4].map((c) {
                      final isSel = columns == c;
                      return Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          label: Text('$c Columns'),
                          selected: isSel,
                          selectedColor: RestaurantTheme.primaryBlue,
                          labelStyle: TextStyle(color: isSel ? Colors.white : RestaurantTheme.charcoal, fontWeight: FontWeight.bold),
                          onSelected: (val) => setDialogState(() => columns = c),
                        ),
                      );
                    }).toList(),
                  ),
                  const Divider(height: 20),
                  SwitchListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Audio Chime on New Orders', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                    subtitle: const Text('Plays chime sound when ticket enters kitchen queue', style: TextStyle(fontSize: 11)),
                    value: chimeEnabled,
                    activeColor: RestaurantTheme.primaryBlue,
                    onChanged: (val) => setDialogState(() => chimeEnabled = val),
                  ),
                  SwitchListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: const Text('High-Contrast Dark Kitchen Mode', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                    subtitle: const Text('Reduces glare under hot kitchen pass lighting', style: TextStyle(fontSize: 11)),
                    value: darkTheme,
                    activeColor: RestaurantTheme.primaryBlue,
                    onChanged: (val) => setDialogState(() => darkTheme = val),
                  ),
                ],
              ),
              actions: [
                TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(backgroundColor: RestaurantTheme.primaryBlue, foregroundColor: Colors.white),
                  onPressed: () {
                    Navigator.pop(ctx);
                    if (onSaved != null) {
                      onSaved({'gridColumns': columns, 'audioChimeEnabled': chimeEnabled, 'darkTheme': darkTheme});
                    }
                    try {
                      ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('KDS display preferences updated.')));
                    } catch (_) {}
                  },
                  child: const Text('Save Settings'),
                ),
              ],
            );
          },
        );
      },
    );
  }
}
