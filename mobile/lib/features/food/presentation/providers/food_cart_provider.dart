import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'food_models.dart';

/// One basket line. `id`, `name` and `price` are the real dish fields from
/// `GET /api/restaurants/:id/menu`, which is what checkout sends upstream.
class FoodCartLine {
  const FoodCartLine({
    required this.id,
    required this.name,
    required this.price,
    required this.isVeg,
    required this.quantity,
  });

  final String id;
  final String name;
  final num price;

  /// `null` when the kitchen never declared it.
  final bool? isVeg;
  final int quantity;

  num get lineTotal => price * quantity;

  FoodCartLine copyWith({int? quantity}) => FoodCartLine(
        id: id,
        name: name,
        price: price,
        isVeg: isVeg,
        quantity: quantity ?? this.quantity,
      );

  /// Shape accepted by `POST /api/food/book` line resolution.
  Map<String, dynamic> toOrderLine() => <String, dynamic>{
        'id': id,
        'name': name,
        'quantity': quantity,
        'price': price,
        'isVeg': isVeg,
      };
}

class FoodCart {
  const FoodCart({
    this.restaurantId,
    this.restaurantName,
    this.lines = const <FoodCartLine>[],
  });

  final String? restaurantId;
  final String? restaurantName;
  final List<FoodCartLine> lines;

  int get itemCount => lines.fold(0, (int sum, line) => sum + (line.quantity > 0 ? line.quantity : 0));

  num get itemTotal => lines.fold(0, (num sum, line) => sum + line.lineTotal);

  bool get isEmpty => itemCount == 0;

  int quantityOf(String itemId) {
    for (final line in lines) {
      if (line.id == itemId) return line.quantity;
    }
    return 0;
  }
}

final foodCartProvider = StateNotifierProvider<FoodCartNotifier, FoodCart>((ref) {
  return FoodCartNotifier();
});

/// A single-restaurant basket: adding a dish from a second kitchen replaces the
/// basket, so a checkout payload can never mix dishes from two restaurants.
class FoodCartNotifier extends StateNotifier<FoodCart> {
  FoodCartNotifier() : super(const FoodCart());

  /// Returns false when the dish is sold out, so the caller can say so instead
  /// of silently doing nothing.
  bool add(FoodRestaurant restaurant, FoodMenuItem item, {int quantity = 1}) {
    if (!item.inStock || quantity <= 0) return false;
    _change(restaurant, item, (existing) => existing + quantity);
    return true;
  }

  bool decrement(FoodRestaurant restaurant, FoodMenuItem item) {
    if (!item.inStock) return false;
    _change(restaurant, item, (existing) => existing - 1);
    return true;
  }

  void clear() => state = const FoodCart();

  void _change(FoodRestaurant restaurant, FoodMenuItem item, int Function(int existing) change) {
    final switchesRestaurant = state.restaurantId != null && state.restaurantId != restaurant.id;
    final lines = switchesRestaurant ? <FoodCartLine>[] : List<FoodCartLine>.from(state.lines);

    final index = lines.indexWhere((line) => line.id == item.id);
    if (index == -1) {
      final quantity = change(0);
      if (quantity > 0) {
        lines.add(
          FoodCartLine(
            id: item.id,
            name: item.name,
            price: item.price,
            isVeg: item.isVeg,
            quantity: quantity,
          ),
        );
      }
    } else {
      final quantity = change(lines[index].quantity);
      if (quantity <= 0) {
        lines.removeAt(index);
      } else {
        lines[index] = lines[index].copyWith(quantity: quantity);
      }
    }

    state = FoodCart(
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      lines: lines,
    );
  }
}
