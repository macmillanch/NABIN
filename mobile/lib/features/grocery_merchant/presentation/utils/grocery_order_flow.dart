import 'package:flutter/material.dart';
import '../theme/grocery_merchant_theme.dart';

/// A merchant-triggerable order state transition offered by the backend.
class GroceryMerchantAction {
  const GroceryMerchantAction(this.status, this.label, {this.danger = false});

  final String status;
  final String label;
  final bool danger;
}

/// Mirrors `is_valid_order_transition` (supabase/migrations/018) intersected with the
/// merchant allow-list in `backend/src/server.js`, so the UI can never offer a
/// transition the database would reject.
const Map<String, List<GroceryMerchantAction>> kGroceryMerchantActions = {
  'RECEIVED': [
    GroceryMerchantAction('ACCEPTED', 'Accept order'),
    GroceryMerchantAction('REJECTED', 'Reject', danger: true),
  ],
  'ACCEPTED': [GroceryMerchantAction('PACKING', 'Start packing')],
  'PREPARING': [GroceryMerchantAction('READY_FOR_PICKUP', 'Ready for handover')],
  'PACKING': [GroceryMerchantAction('READY_FOR_PICKUP', 'Ready for handover')],
  'READY_FOR_PICKUP': [],
  'PICKED_UP': [],
  'DELIVERED': [],
  'REJECTED': [],
  'CANCELLED': [],
};

/// `server.js` rejects a REJECTED transition unless one of these exact codes is sent.
const List<String> kGroceryRejectionReasons = [
  'ITEM_UNAVAILABLE',
  'MERCHANT_CLOSED',
  'OUT_OF_STOCK',
  'UNABLE_TO_PREPARE',
  'INVALID_ORDER',
  'OTHER',
];

const Set<String> kGroceryIncomingStates = {'RECEIVED'};

List<GroceryMerchantAction> groceryMerchantActions(String? state) =>
    kGroceryMerchantActions[state] ?? const [];

bool isGroceryOrderActive(String? state) =>
    !['DELIVERED', 'REJECTED', 'CANCELLED'].contains(state);

String groceryOrderStatusLabel(String? state) => switch (state) {
      'RECEIVED' => 'New order',
      'ACCEPTED' => 'Accepted',
      'PREPARING' => 'Preparing',
      'PACKING' => 'Packing',
      'READY_FOR_PICKUP' => 'Ready for handover',
      'PICKED_UP' => 'Handed to driver',
      'DELIVERED' => 'Completed',
      'REJECTED' => 'Rejected',
      'CANCELLED' => 'Cancelled',
      _ => state ?? 'Unknown',
    };

Color groceryOrderStatusColor(String? state) => switch (state) {
      'RECEIVED' => GroceryMerchantTheme.accentRose,
      'ACCEPTED' || 'PREPARING' || 'PACKING' => GroceryMerchantTheme.accentAmber,
      'READY_FOR_PICKUP' => GroceryMerchantTheme.primaryGreen,
      'PICKED_UP' => GroceryMerchantTheme.textMuted,
      'DELIVERED' => GroceryMerchantTheme.primaryGreen,
      'REJECTED' || 'CANCELLED' => GroceryMerchantTheme.accentRose,
      _ => GroceryMerchantTheme.textMuted,
    };

String groceryRejectionReasonLabel(String reason) => reason.replaceAll('_', ' ').toLowerCase();
