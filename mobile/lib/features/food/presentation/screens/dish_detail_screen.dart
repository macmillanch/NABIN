import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/nabin_tokens.dart';
import '../../../../core/theme/restaurant_theme.dart';
import '../providers/food_cart_provider.dart';
import '../providers/food_models.dart';
import '../providers/food_restaurants_provider.dart';
import '../providers/restaurant_menu_provider.dart';
import '../widgets/food_shared_widgets.dart';

/// Dish detail — the leaf of the food browsing hierarchy
/// (cuisine → restaurant list → menu → dish detail → add to cart).
///
/// Reached from the menu as `/dish-detail?restaurantId=...&dishId=...`. The
/// restaurant comes from the live `foodRestaurantsProvider` feed and the dish
/// from that restaurant's `restaurantMenuProvider`; nothing here is invented —
/// an unknown id renders the same loading/error/unavailable states the rest of
/// the app uses rather than a placeholder dish.
class DishDetailScreen extends ConsumerStatefulWidget {
  const DishDetailScreen({
    super.key,
    this.restaurantId,
    this.dishId,
  });

  final String? restaurantId;
  final String? dishId;

  @override
  ConsumerState<DishDetailScreen> createState() => _DishDetailScreenState();
}

class _DishDetailScreenState extends ConsumerState<DishDetailScreen> {
  int _quantity = 1;

  /// Constructor args win over the route query, matching the menu screen.
  Map<String, String> get _routeArgs {
    final arguments = ModalRoute.of(context)?.settings.arguments;
    if (arguments is Map) {
      return arguments.map((k, v) => MapEntry(k.toString(), v.toString()));
    }
    return const <String, String>{};
  }

  String _resolve(String? preferred, String key) {
    final first = preferred?.trim() ?? '';
    if (first.isNotEmpty) return first;
    return (_routeArgs[key] ?? '').trim();
  }

  void _add(FoodRestaurant restaurant, FoodMenuItem item, int quantity) {
    final previousRestaurantId = ref.read(foodCartProvider).restaurantId;
    final added = ref.read(foodCartProvider.notifier).add(restaurant, item, quantity: quantity);
    if (!added) {
      _snack('${item.name} just went off the menu.');
      return;
    }
    if (previousRestaurantId != null && previousRestaurantId != restaurant.id) {
      _snack('Started a new basket for ${restaurant.name}.');
    } else {
      _snack('Added $quantity × ${item.name} to your basket.');
    }
  }

  void _snack(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final restaurantId = _resolve(widget.restaurantId, 'restaurantId');
    final dishId = _resolve(widget.dishId, 'dishId');

    final feedAsync = ref.watch(foodRestaurantsProvider);
    final feed = feedAsync.valueOrNull;
    final restaurant = restaurantId.isEmpty ? null : feed?.byId(restaurantId);

    final menuAsync = restaurantId.isEmpty
        ? const AsyncValue<List<FoodMenuItem>>.loading()
        : ref.watch(restaurantMenuProvider(restaurantId));
    final items = menuAsync.valueOrNull ?? const <FoodMenuItem>[];
    FoodMenuItem? dish;
    for (final item in items) {
      if (item.id == dishId) {
        dish = item;
        break;
      }
    }

    return Scaffold(
      backgroundColor: RestaurantTheme.lightBg,
      appBar: AppBar(
        backgroundColor: RestaurantTheme.headerBand,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: NabinColor.onBrand, size: 18),
          onPressed: () => context.canPop() ? context.pop() : context.go('/food-home'),
        ),
        title: Text(
          restaurant?.name ?? 'Dish details',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: NabinColor.onBrand),
        ),
      ),
      body: SafeArea(
        child: _resolveBody(
          context,
          restaurantId: restaurantId,
          feedAsync: feedAsync,
          restaurant: restaurant,
          menuAsync: menuAsync,
          dish: dish,
        ),
      ),
      bottomNavigationBar: (restaurant != null && dish != null && dish.inStock)
          ? _CartBar(
              quantity: _quantity,
              totalPrice: dish.price * _quantity,
              restaurantName: restaurant.name,
              onIncrement: () => setState(() => _quantity += 1),
              onDecrement: () => setState(() => _quantity = (_quantity - 1).clamp(1, 99)),
              onAdd: () => _add(restaurant, dish!, _quantity),
            )
          : null,
    );
  }

  Widget _resolveBody(
    BuildContext context, {
    required String restaurantId,
    required AsyncValue<FoodRestaurantFeed> feedAsync,
    required FoodRestaurant? restaurant,
    required AsyncValue<List<FoodMenuItem>> menuAsync,
    required FoodMenuItem? dish,
  }) {
    // A deep link with no resolvable restaurant id has nothing to ask the API for.
    if (restaurantId.isEmpty) {
      return _singleMessage(
        icon: Icons.storefront_rounded,
        title: 'No restaurant selected',
        message: 'Open a restaurant from the food home screen to view its dishes.',
        actionLabel: 'Back to food',
        onAction: () => context.go('/food-home'),
      );
    }

    if (feedAsync.isLoading && !feedAsync.hasValue) {
      return ListView(
        padding: const EdgeInsets.all(18),
        children: const <Widget>[FoodListSkeleton(itemCount: 2, rowHeight: 160)],
      );
    }

    if (restaurant == null) {
      if (feedAsync.hasError) {
        return _singleMessage(
          icon: Icons.wifi_tethering_error_rounded,
          title: 'Restaurant unavailable',
          message: feedAsync.error.toString(),
          actionLabel: 'Try again',
          onAction: () => ref.read(foodRestaurantsProvider.notifier).retry(),
        );
      }
      return _singleMessage(
        icon: Icons.storefront_rounded,
        title: 'Restaurant not found',
        message: 'This restaurant is no longer live on NABIN in your area.',
        actionLabel: 'Browse restaurants',
        onAction: () => context.go('/food-home'),
      );
    }

    if (menuAsync.isLoading && !menuAsync.hasValue) {
      return ListView(
        padding: const EdgeInsets.all(18),
        children: const <Widget>[FoodListSkeleton(itemCount: 2, rowHeight: 160)],
      );
    }

    if (dish == null) {
      if (menuAsync.hasError) {
        return _singleMessage(
          icon: Icons.menu_book_rounded,
          title: 'Menu unavailable',
          message: menuAsync.error.toString(),
          actionLabel: 'Try again',
          onAction: () => ref.read(restaurantMenuProvider(restaurantId).notifier).load(),
        );
      }
      return _singleMessage(
        icon: Icons.no_meals_rounded,
        title: 'Dish not on the menu',
        message: 'This dish is no longer listed by ${restaurant.name}.',
        actionLabel: 'View the menu',
        onAction: () => context.go('/restaurant-menu?restaurantId=$restaurantId'),
      );
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _DishHero(item: dish),
          const SizedBox(height: 16),
          _DishInfoCard(item: dish, restaurantName: restaurant.name),
          if (!dish.inStock) ...<Widget>[
            const SizedBox(height: 16),
            const FoodMessageCard(
              icon: Icons.remove_shopping_cart_rounded,
              title: 'Currently unavailable',
              message: 'This kitchen has sold out of this dish, so it cannot be added to a basket right now.',
              padding: EdgeInsets.symmetric(vertical: 24, horizontal: 16),
            ),
          ],
        ],
      ),
    );
  }

  Widget _singleMessage({
    required IconData icon,
    required String title,
    required String message,
    String? actionLabel,
    VoidCallback? onAction,
  }) {
    return ListView(
      padding: const EdgeInsets.all(18),
      children: <Widget>[
        FoodMessageCard(icon: icon, title: title, message: message, actionLabel: actionLabel, onAction: onAction),
      ],
    );
  }
}

class _DishHero extends StatelessWidget {
  const _DishHero({required this.item});

  final FoodMenuItem item;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Stack(
        clipBehavior: Clip.none,
        children: <Widget>[
          FoodLetterTile(
            letter: item.firstLetter,
            seed: item.id.isEmpty ? item.name : item.id,
            size: 168,
            radius: 28,
            imageUrl: item.imageUrl,
          ),
          Positioned(top: 10, left: 10, child: FoodDietDot(isVeg: item.isVeg)),
        ],
      ),
    );
  }
}

class _DishInfoCard extends StatelessWidget {
  const _DishInfoCard({required this.item, required this.restaurantName});

  final FoodMenuItem item;
  final String restaurantName;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: RestaurantTheme.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: RestaurantTheme.border),
        boxShadow: <BoxShadow>[BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 8)],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Text(
                  item.name,
                  style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 19, color: RestaurantTheme.charcoal, height: 1.15),
                ),
              ),
              const SizedBox(width: 10),
              Text(
                '₹${foodPrice(item.price)}',
                style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: RestaurantTheme.neonOrangeDark),
              ),
            ],
          ),
          if (item.category != null) ...<Widget>[
            const SizedBox(height: 6),
            Text(
              item.category!,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: RestaurantTheme.secondaryText),
            ),
          ],
          const SizedBox(height: 10),
          Row(
            children: <Widget>[
              const Icon(Icons.storefront_rounded, size: 14, color: RestaurantTheme.secondaryText),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'From $restaurantName',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: RestaurantTheme.secondaryText),
                ),
              ),
              if (!item.inStock)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: RestaurantTheme.borderLight,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Text(
                    'SOLD OUT',
                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: RestaurantTheme.secondaryText),
                  ),
                )
              else if (item.isVeg != null)
                FoodDietDot(isVeg: item.isVeg),
            ],
          ),
          if (item.description != null) ...<Widget>[
            const SizedBox(height: 14),
            const Text(
              'About this dish',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
            ),
            const SizedBox(height: 4),
            Text(
              item.description!,
              style: const TextStyle(fontSize: 13, height: 1.4, color: RestaurantTheme.secondaryText),
            ),
          ],
        ],
      ),
    );
  }
}

class _CartBar extends StatelessWidget {
  const _CartBar({
    required this.quantity,
    required this.totalPrice,
    required this.restaurantName,
    required this.onIncrement,
    required this.onDecrement,
    required this.onAdd,
  });

  final int quantity;
  final num totalPrice;
  final String restaurantName;
  final VoidCallback onIncrement;
  final VoidCallback onDecrement;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        decoration: const BoxDecoration(
          color: RestaurantTheme.white,
          border: Border(top: BorderSide(color: RestaurantTheme.border)),
          boxShadow: <BoxShadow>[BoxShadow(color: Colors.black12, blurRadius: 12, offset: Offset(0, -4))],
        ),
        child: Row(
          children: <Widget>[
            Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: RestaurantTheme.neonOrange),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  IconButton(
                    icon: const Icon(Icons.remove, size: 18, color: RestaurantTheme.neonOrangeDark),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 34, minHeight: 40),
                    onPressed: onDecrement,
                  ),
                  Text(
                    '$quantity',
                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: RestaurantTheme.charcoal),
                  ),
                  IconButton(
                    icon: const Icon(Icons.add, size: 18, color: RestaurantTheme.neonOrangeDark),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 34, minHeight: 40),
                    onPressed: onIncrement,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: ElevatedButton.icon(
                onPressed: onAdd,
                icon: const Icon(Icons.add_shopping_cart_rounded, size: 18),
                label: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    'Add ${quantity > 1 ? '$quantity × ' : ''}₹${foodPrice(totalPrice)} • $restaurantName',
                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13.5),
                    maxLines: 1,
                  ),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: RestaurantTheme.primaryAction,
                  foregroundColor: NabinColor.onBrand,
                  minimumSize: const Size(0, 50),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  elevation: 0,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
