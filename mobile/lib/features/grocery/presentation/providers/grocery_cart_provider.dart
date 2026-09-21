import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../models/grocery_product.dart';

/// A basket line. Every field is a copy of a real product row read from
/// `GET /api/grocery/products` at add-to-cart time — no demo ids, names or
/// prices exist in this file.
class GroceryCartItem {
  const GroceryCartItem({
    required this.productId,
    required this.name,
    required this.unitPrice,
    required this.quantity,
    this.unit,
    this.packSize,
    this.merchantId,
    this.emoji = '🛒',
    this.tileColor,
  });

  factory GroceryCartItem.fromProduct(GroceryProduct product, {int quantity = 1}) {
    return GroceryCartItem(
      productId: product.id,
      name: product.name,
      unitPrice: product.currentPrice,
      quantity: quantity,
      unit: product.unit,
      packSize: product.packSize,
      merchantId: product.merchantId,
      emoji: product.emoji,
      tileColor: product.tileColor,
    );
  }

  final String productId;
  final String name;

  /// Live price captured from the fetched row. `revalidatePrices()` refreshes it
  /// from the server so a store price change cannot slip into the order.
  final double unitPrice;
  final String? unit;
  final String? packSize;
  final int quantity;

  /// Grocery checkout is scoped to one store, so each line has to remember which
  /// merchant stocked it.
  final String? merchantId;
  final String emoji;
  final Color? tileColor;

  double get lineTotal => unitPrice * quantity;

  String get sizeLabel {
    final List<String> parts = <String>[
      if (packSize != null) packSize!,
      if (unit != null && unit != packSize) unit!,
    ];
    return parts.join(' • ');
  }

  GroceryCartItem copyWith({int? quantity, double? unitPrice}) => GroceryCartItem(
        productId: productId,
        name: name,
        unitPrice: unitPrice ?? this.unitPrice,
        quantity: quantity ?? this.quantity,
        unit: unit,
        packSize: packSize,
        merchantId: merchantId,
        emoji: emoji,
        tileColor: tileColor,
      );

  /// Shape consumed by the cart and checkout screens (and by the checkout
  /// payload, which maps these to `productId` / `unitPrice` / `quantity`).
  Map<String, dynamic> toLineJson() => <String, dynamic>{
        'id': productId,
        'name': name,
        'price': unitPrice,
        'quantity': quantity,
        'unit': unit,
        'packSize': packSize,
        'merchantId': merchantId,
        'emoji': emoji,
        'bgColor': tileColor,
      };
}

enum GroceryPriceRevalidationStatus { idle, working, done, failed }

/// Result of the server-side cart revalidation (`POST /grocery/cart/revalidate`).
class GroceryPriceCheck {
  const GroceryPriceCheck({
    this.status = GroceryPriceRevalidationStatus.idle,
    this.changed = const <String>{},
    this.unlisted = const <String>{},
    this.error,
  });

  final GroceryPriceRevalidationStatus status;
  final Set<String> changed;

  /// Products the store has stopped listing since they were added.
  final Set<String> unlisted;
  final String? error;
}

class GroceryCartState {
  const GroceryCartState({
    this.lines = const <String, GroceryCartItem>{},
    this.priceCheck = const GroceryPriceCheck(),
  });

  final Map<String, GroceryCartItem> lines;
  final GroceryPriceCheck priceCheck;

  /// A revalidation flag only matters while the line it belongs to is still in
  /// the basket.
  Set<String> _live(Set<String> ids) =>
      <String>{for (final String id in ids) if (lines.containsKey(id)) id};

  Set<String> get unlistedIds => _live(priceCheck.unlisted);

  Set<String> get changedIds => _live(priceCheck.changed);

  bool get checkoutBlocked => unlistedIds.isNotEmpty;

  List<GroceryCartItem> get items => lines.values.toList();

  /// Lines the customer is actually being charged for.
  List<GroceryCartItem> get billableItems =>
      items.where((GroceryCartItem line) => !unlistedIds.contains(line.productId)).toList();

  /// `POST /grocery/checkout/validate` places one order at one store, so a
  /// basket that spans two merchants cannot be submitted.
  Set<String> get merchantIds => <String>{
        for (final GroceryCartItem line in billableItems)
          if (line.merchantId != null) line.merchantId!
      };

  String? get merchantId => merchantIds.length == 1 ? merchantIds.first : null;

  bool get spansOneStore => merchantIds.length <= 1;

  bool get isEmpty => lines.isEmpty;

  int get totalQuantity => billableItems
      .fold<int>(0, (int sum, GroceryCartItem line) => sum + line.quantity);

  double get subtotal => billableItems
      .fold<double>(0, (double sum, GroceryCartItem line) => sum + line.lineTotal);

  /// The checkout screen still bills in whole rupees.
  int get subtotalRupees => subtotal.round();

  List<Map<String, dynamic>> get checkoutLines =>
      billableItems.map((GroceryCartItem line) => line.toLineJson()).toList();

  int quantityOf(String productId) => lines[productId]?.quantity ?? 0;

  GroceryCartState copyWith({
    Map<String, GroceryCartItem>? lines,
    GroceryPriceCheck? priceCheck,
  }) =>
      GroceryCartState(
        lines: lines ?? this.lines,
        priceCheck: priceCheck ?? this.priceCheck,
      );
}

class GroceryCartNotifier extends StateNotifier<GroceryCartState> {
  GroceryCartNotifier() : super(const GroceryCartState());

  int _revalidationToken = 0;

  void add(GroceryProduct product, {int quantity = 1}) {
    final GroceryCartItem? existing = state.lines[product.id];
    final Map<String, GroceryCartItem> next = Map<String, GroceryCartItem>.of(state.lines);
    next[product.id] = existing == null
        ? GroceryCartItem.fromProduct(product, quantity: quantity)
        : existing.copyWith(quantity: existing.quantity + quantity);
    state = state.copyWith(lines: next);
  }

  void setQuantity(String productId, int quantity) {
    final GroceryCartItem? line = state.lines[productId];
    if (line == null) return;
    final Map<String, GroceryCartItem> next = Map<String, GroceryCartItem>.of(state.lines);
    if (quantity <= 0) {
      next.remove(productId);
    } else {
      next[productId] = line.copyWith(quantity: quantity);
    }
    state = state.copyWith(lines: next);
  }

  void remove(String productId) => setQuantity(productId, 0);

  void clear() => state = const GroceryCartState();

  /// Asks the backend what each line costs right now and what it still lists.
  Future<void> revalidatePrices() async {
    if (state.lines.isEmpty) return;
    final int token = ++_revalidationToken;
    state = state.copyWith(
      priceCheck: const GroceryPriceCheck(status: GroceryPriceRevalidationStatus.working),
    );

    final List<Map<String, dynamic>> payload = state.items
        .map((GroceryCartItem line) => <String, dynamic>{
              'productId': line.productId,
              'unitPrice': line.unitPrice,
              'quantity': line.quantity,
            })
        .toList();

    try {
      final Map<String, dynamic>? response = await NabinApiService.revalidateCart(payload);
      if (!mounted || token != _revalidationToken) return;
      if (response?['success'] != true) {
        state = state.copyWith(
          priceCheck: GroceryPriceCheck(
            status: GroceryPriceRevalidationStatus.failed,
            error: response?['error']?.toString(),
          ),
        );
        return;
      }

      final Map<String, GroceryCartItem> next = Map<String, GroceryCartItem>.of(state.lines);
      final Set<String> changed = <String>{};
      final Set<String> unlisted = <String>{};

      final Object? rows = response?['items'];
      if (rows is List) {
        for (final Map row in rows.whereType<Map>()) {
          final String? productId = row['productId']?.toString();
          if (productId == null) continue;
          final GroceryCartItem? line = next[productId];
          if (line == null) continue;

          if (row['available'] != true) {
            unlisted.add(productId);
            continue;
          }
          final double serverPrice = toAmount(row['serverPrice'], fallback: line.unitPrice);
          if ((serverPrice - line.unitPrice).abs() > 0.01) {
            next[productId] = line.copyWith(unitPrice: serverPrice);
            changed.add(productId);
          }
        }
      }

      state = state.copyWith(
        lines: next,
        priceCheck: GroceryPriceCheck(
          status: GroceryPriceRevalidationStatus.done,
          changed: changed,
          unlisted: unlisted,
        ),
      );
    } catch (_) {
      if (!mounted || token != _revalidationToken) return;
      state = state.copyWith(
        priceCheck: const GroceryPriceCheck(
          status: GroceryPriceRevalidationStatus.failed,
          error: 'Network error',
        ),
      );
    }
  }
}

final groceryCartProvider =
    StateNotifierProvider<GroceryCartNotifier, GroceryCartState>((ref) => GroceryCartNotifier());
