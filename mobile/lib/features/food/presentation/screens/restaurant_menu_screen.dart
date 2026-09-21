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

/// Zomato-style restaurant page driven by `GET /api/restaurants/:id/menu`.
///
/// The restaurant id and name arrive as route arguments
/// (`/restaurant-menu?restaurantId=rest_1&restaurantName=...`), which go_router
/// exposes through `ModalRoute.of(context)!.settings.arguments`. Constructor
/// arguments win over the route query so the router can later be switched to
/// `RestaurantMenuScreen(restaurantId: state.uri.queryParameters['restaurantId'])`
/// without touching this file.
class RestaurantMenuScreen extends ConsumerStatefulWidget {
  const RestaurantMenuScreen({
    super.key,
    this.restaurantId,
    this.restaurantName,
    this.deliveryTime,
  });

  final String? restaurantId;
  final String? restaurantName;
  final String? deliveryTime;

  @override
  ConsumerState<RestaurantMenuScreen> createState() => _RestaurantMenuScreenState();
}

class _RestaurantMenuScreenState extends ConsumerState<RestaurantMenuScreen> {
  final TextEditingController _menuSearchCtrl = TextEditingController();

  /// 0 = all dishes, 1 = veg only, 2 = non-veg only.
  int _dietFilter = 0;

  /// Reads the query parameters go_router hands to the page as its arguments.
  Map<String, String> get _routeArgs {
    final arguments = ModalRoute.of(context)?.settings.arguments;
    if (arguments is Map) {
      return arguments.map((key, value) => MapEntry(key.toString(), value.toString()));
    }
    return const <String, String>{};
  }

  /// Constructor arguments win over the route query; empty means "not given".
  static String _firstNonEmpty(String? preferred, String? fallback) {
    final first = preferred?.trim() ?? '';
    if (first.isNotEmpty) return first;
    return fallback?.trim() ?? '';
  }

  static String? _firstPresent(String? preferred, String? fallback) {
    final value = _firstNonEmpty(preferred, fallback);
    return value.isEmpty ? null : value;
  }

  void _onDietFilterChanged(int value) => setState(() => _dietFilter = value);

  void _add(FoodRestaurant restaurant, FoodMenuItem item) {
    final previousRestaurantId = ref.read(foodCartProvider).restaurantId;
    final added = ref.read(foodCartProvider.notifier).add(restaurant, item);
    if (!added) {
      _showSnack('${item.name} just went off the menu.');
      return;
    }
    if (previousRestaurantId != null && previousRestaurantId != restaurant.id) {
      _showSnack('Started a new basket for ${restaurant.name}.');
    }
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  void _proceedToCheckout(FoodRestaurant restaurant, String? deliveryTime, FoodCart cart) {
    context.push('/food-checkout', extra: <String, dynamic>{
      'restaurantId': restaurant.id,
      'restaurantName': restaurant.name,
      if (deliveryTime != null) 'deliveryTime': deliveryTime,
      'items': cart.lines.map((line) => line.toOrderLine()).toList(),
      'itemTotal': cart.itemTotal,
    });
  }

  @override
  Widget build(BuildContext context) {
    final feedAsync = ref.watch(foodRestaurantsProvider);
    final args = _routeArgs;
    final feed = feedAsync.valueOrNull;

    final routeId = _firstNonEmpty(widget.restaurantId, args['restaurantId']);
    final routeName = _firstNonEmpty(widget.restaurantName, args['restaurantName']);
    final routeEta = _firstPresent(widget.deliveryTime, args['deliveryTime']);

    // Deep links without arguments fall back to the first live restaurant the
    // feed actually returned — never to a name typed into this file.
    final resolvedId = routeId.isNotEmpty
        ? routeId
        : (feed != null && feed.restaurants.isNotEmpty ? feed.restaurants.first.id : null);
    final resolved = resolvedId == null
        ? null
        : feed?.byId(resolvedId) ??
            (routeName.isEmpty ? null : FoodRestaurant(id: resolvedId, name: routeName, deliveryTime: routeEta));

    return Scaffold(
      backgroundColor: RestaurantTheme.lightBg,
      body: SafeArea(
        child: Stack(
          children: <Widget>[
            if (resolved == null)
              _MenuPlaceholder(
                loading: feedAsync.isLoading,
                errorMessage: feedAsync.hasError ? feedAsync.error.toString() : null,
                feedIsEmpty: feed != null && feed.restaurants.isEmpty,
                onRetry: () => ref.read(foodRestaurantsProvider.notifier).retry(),
              )
            else
              _MenuBody(
                restaurant: resolved,
                fallbackDeliveryTime: routeEta,
                menuSearchCtrl: _menuSearchCtrl,
                dietFilter: _dietFilter,
                onDietFilterChanged: _onDietFilterChanged,
                onMenuSearchChanged: (_) => setState(() {}),
                onAdd: (item) => _add(resolved, item),
                onDecrement: (item) => ref.read(foodCartProvider.notifier).decrement(resolved, item),
                onCheckout: (cart) => _proceedToCheckout(
                  resolved,
                  resolved.deliveryTime ?? routeEta,
                  cart,
                ),
                onRetryMenu: () => ref.read(restaurantMenuProvider(resolved.id).notifier).load(),
              ),
            Positioned(
              top: 12,
              left: 12,
              child: _CircleIconButton(
                icon: Icons.arrow_back_ios_new_rounded,
                onTap: () => context.canPop() ? context.pop() : context.go('/food-home'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MenuBody extends ConsumerWidget {
  const _MenuBody({
    required this.restaurant,
    required this.fallbackDeliveryTime,
    required this.menuSearchCtrl,
    required this.dietFilter,
    required this.onDietFilterChanged,
    required this.onMenuSearchChanged,
    required this.onAdd,
    required this.onDecrement,
    required this.onCheckout,
    required this.onRetryMenu,
  });

  final FoodRestaurant restaurant;
  final String? fallbackDeliveryTime;
  final TextEditingController menuSearchCtrl;
  final int dietFilter;
  final ValueChanged<int> onDietFilterChanged;
  final ValueChanged<String> onMenuSearchChanged;
  final ValueChanged<FoodMenuItem> onAdd;
  final ValueChanged<FoodMenuItem> onDecrement;
  final void Function(FoodCart cart) onCheckout;
  final VoidCallback onRetryMenu;

  /// Veg / non-veg pills toggle themselves off back to the full menu.
  void _toggleDietFilter(int value) => onDietFilterChanged(dietFilter == value ? 0 : value);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final menuAsync = ref.watch(restaurantMenuProvider(restaurant.id));
    final cart = ref.watch(foodCartProvider);
    final items = menuAsync.valueOrNull ?? const <FoodMenuItem>[];
    final deliveryTime = restaurant.deliveryTime ?? fallbackDeliveryTime;

    final hasVeg = items.any((item) => item.isVeg == true);
    final hasNonVeg = items.any((item) => item.isVeg == false);
    final query = menuSearchCtrl.text.trim().toLowerCase();

    final visible = items.where((item) {
      if (dietFilter == 1 && item.isVeg != true) return false;
      if (dietFilter == 2 && item.isVeg != false) return false;
      if (query.isEmpty) return true;
      return item.name.toLowerCase().contains(query) ||
          (item.category?.toLowerCase().contains(query) ?? false) ||
          (item.description?.toLowerCase().contains(query) ?? false);
    }).toList();

    // Zomato-style sections: the `category` column groups the dishes, and dishes
    // with no category stay in one unlabelled block at the end.
    final Map<String, List<FoodMenuItem>> sections = <String, List<FoodMenuItem>>{};
    for (final FoodMenuItem item in visible) {
      final key = item.category ?? '';
      (sections[key] ??= <FoodMenuItem>[]).add(item);
    }
    final sectionKeys = sections.keys.toList()
      ..sort((a, b) {
        if (a.isEmpty) return 1;
        if (b.isEmpty) return -1;
        return a.compareTo(b);
      });

    return Stack(
      children: <Widget>[
        SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(16, 0, 16, cart.itemCount > 0 ? 120 : 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              _HeroHeader(restaurant: restaurant),
              const SizedBox(height: 12),
              _InfoCard(restaurant: restaurant, deliveryTime: deliveryTime),
              const SizedBox(height: 16),
              _MenuSearchField(controller: menuSearchCtrl, onChanged: onMenuSearchChanged),
              const SizedBox(height: 14),

              // The only tabs the payload supports are the ones the dishes
              // themselves declare, and most kitchens declare no veg flag.
              if (hasVeg && hasNonVeg)
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: <Widget>[
                      FoodFilterPill(
                        label: 'All dishes',
                        selected: dietFilter == 0,
                        onTap: () => onDietFilterChanged(0),
                      ),
                      FoodFilterPill(
                        label: 'Pure veg',
                        selected: dietFilter == 1,
                        onTap: () => _toggleDietFilter(1),
                      ),
                      FoodFilterPill(
                        label: 'Non-veg',
                        selected: dietFilter == 2,
                        onTap: () => _toggleDietFilter(2),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 16),

              Text(
                dietFilter == 1
                    ? 'Pure veg dishes'
                    : dietFilter == 2
                        ? 'Non-veg dishes'
                        : 'Full menu',
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
              ),
              const SizedBox(height: 10),

              if (menuAsync.isLoading && !menuAsync.hasValue)
                const FoodListSkeleton(itemCount: 4, rowHeight: 106)
              else if (menuAsync.hasError)
                FoodMessageCard(
                  icon: Icons.menu_book_rounded,
                  title: 'Menu unavailable',
                  message: menuAsync.error.toString(),
                  actionLabel: 'Try again',
                  onAction: onRetryMenu,
                )
              else if (items.isEmpty)
                const FoodMessageCard(
                  icon: Icons.no_meals_rounded,
                  title: 'No dishes on the menu yet',
                  message: 'This kitchen has not published its dishes on NABIN yet. Check back shortly.',
                )
              else if (visible.isEmpty)
                const FoodMessageCard(
                  icon: Icons.search_off_rounded,
                  title: 'No dish matches this filter',
                  message: 'Try another word, or switch back to the full menu.',
                )
              else
                for (final entry
                    in sectionKeys.map((key) => MapEntry(key, sections[key]!))) ...[
                  if (entry.key.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 8, bottom: 10),
                      child: Text(
                        '${entry.key} (${entry.value.length})',
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w900,
                          letterSpacing: -0.2,
                          color: RestaurantTheme.charcoal,
                        ),
                      ),
                    ),
                  for (final item in entry.value)
                    _DishRow(
                      item: item,
                      quantity: cart.restaurantId == restaurant.id ? cart.quantityOf(item.id) : 0,
                      onAdd: () => onAdd(item),
                      onDecrement: () => onDecrement(item),
                    ),
                ],
            ],
          ),
        ),
        if (cart.itemCount > 0 && cart.restaurantId == restaurant.id)
          Positioned(
            left: 16,
            right: 16,
            bottom: 16,
            child: _StickyCartBar(cart: cart, onCheckout: () => onCheckout(cart)),
          ),
      ],
    );
  }
}

class _MenuPlaceholder extends StatelessWidget {
  const _MenuPlaceholder({
    required this.loading,
    required this.errorMessage,
    required this.feedIsEmpty,
    required this.onRetry,
  });

  final bool loading;
  final String? errorMessage;
  final bool feedIsEmpty;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 64, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (loading) const FoodListSkeleton(itemCount: 4, rowHeight: 106),
          if (errorMessage != null)
            FoodMessageCard(
              icon: Icons.storefront_rounded,
              title: 'Restaurant unavailable',
              message: errorMessage!,
              actionLabel: 'Try again',
              onAction: onRetry,
            ),
          if (!loading && errorMessage == null)
            FoodMessageCard(
              icon: Icons.storefront_rounded,
              title: 'No restaurant to show',
              message: feedIsEmpty
                  ? 'No restaurant is live on NABIN in this area yet, so there is no menu to open.'
                  : 'Open a restaurant from the food home screen to load its menu.',
              actionLabel: 'Reload restaurants',
              onAction: onRetry,
            ),
        ],
      ),
    );
  }
}

class _HeroHeader extends StatelessWidget {
  const _HeroHeader({required this.restaurant});

  final FoodRestaurant restaurant;

  @override
  Widget build(BuildContext context) {
    // There is no restaurant image column on the API, so the hero is the
    // initial-letter treatment rather than a network image.
    return ClipRRect(
      borderRadius: BorderRadius.circular(20),
      child: Container(
        height: 150,
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            colors: <Color>[RestaurantTheme.charcoal, NabinColor.brandHover],
            begin: Alignment.centerLeft,
            end: Alignment.centerRight,
          ),
        ),
        child: Row(
          children: <Widget>[
            const SizedBox(width: 56),
            FoodLetterTile(
              letter: restaurant.firstLetter,
              seed: restaurant.id.isEmpty ? restaurant.name : restaurant.id,
              size: 92,
              radius: 20,
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  Text(
                    restaurant.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: NabinColor.onBrand,
                      fontWeight: FontWeight.w900,
                      fontSize: 17,
                      height: 1.2,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    restaurant.cuisineLabel.isEmpty ? 'NABIN Food partner' : restaurant.cuisineLabel,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.8),
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
          ],
        ),
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.restaurant, required this.deliveryTime});

  final FoodRestaurant restaurant;
  final String? deliveryTime;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
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
            children: <Widget>[
              Expanded(
                child: Text(
                  restaurant.name,
                  style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: RestaurantTheme.charcoal),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: restaurant.isOpen
                      ? RestaurantTheme.vegGreen.withValues(alpha: 0.12)
                      : RestaurantTheme.borderLight,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  restaurant.isOpen ? '● OPEN' : 'CLOSED',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w900,
                    color: restaurant.isOpen ? RestaurantTheme.vegGreen : RestaurantTheme.secondaryText,
                  ),
                ),
              ),
            ],
          ),
          if (restaurant.address != null) ...<Widget>[
            const SizedBox(height: 3),
            Text(
              restaurant.address!,
              style: const TextStyle(color: RestaurantTheme.secondaryText, fontSize: 12),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              if (restaurant.rating != null)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
                  decoration: BoxDecoration(
                    color: RestaurantTheme.vegGreen.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      const Icon(Icons.star_rounded, size: 12, color: RestaurantTheme.vegGreen),
                      const SizedBox(width: 2),
                      Text(
                        restaurant.rating!.toStringAsFixed(1),
                        style: const TextStyle(
                          color: RestaurantTheme.vegGreen,
                          fontWeight: FontWeight.bold,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ),
              if (deliveryTime != null)
                ConstrainedBox(
                  constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width - 64),
                  child: Text(
                    '• Delivery in $deliveryTime',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: RestaurantTheme.secondaryText,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MenuSearchField extends StatelessWidget {
  const _MenuSearchField({required this.controller, required this.onChanged});

  final TextEditingController controller;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 46,
      padding: const EdgeInsets.symmetric(horizontal: 14),
      decoration: BoxDecoration(
        color: RestaurantTheme.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: RestaurantTheme.border),
      ),
      child: Row(
        children: <Widget>[
          const Icon(Icons.search_rounded, color: RestaurantTheme.neonOrange, size: 20),
          const SizedBox(width: 8),
          Expanded(
            child: TextField(
              controller: controller,
              onChanged: onChanged,
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: RestaurantTheme.charcoal),
              decoration: const InputDecoration(
                hintText: 'Search dishes inside this menu...',
                hintStyle: TextStyle(color: RestaurantTheme.secondaryText, fontSize: 12),
                border: InputBorder.none,
                isDense: true,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DishRow extends StatelessWidget {
  const _DishRow({
    required this.item,
    required this.quantity,
    required this.onAdd,
    required this.onDecrement,
  });

  final FoodMenuItem item;
  final int quantity;
  final VoidCallback onAdd;
  final VoidCallback onDecrement;

  @override
  Widget build(BuildContext context) {
    final soldOut = !item.inStock;

    return Opacity(
      opacity: soldOut ? 0.55 : 1,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: RestaurantTheme.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: RestaurantTheme.border),
          boxShadow: <BoxShadow>[
            BoxShadow(color: Colors.black.withValues(alpha: 0.02), blurRadius: 6, offset: const Offset(0, 2)),
          ],
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Stack(
              children: <Widget>[
                FoodLetterTile(
                  letter: item.firstLetter,
                  seed: item.id.isEmpty ? item.name : item.id,
                  size: 82,
                  imageUrl: item.imageUrl,
                ),
                Positioned(top: 5, left: 5, child: FoodDietDot(isVeg: item.isVeg)),
              ],
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    item.name,
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: RestaurantTheme.charcoal),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '₹${foodPrice(item.price)}',
                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: RestaurantTheme.charcoal),
                  ),
                  if (item.description != null) ...<Widget>[
                    const SizedBox(height: 4),
                    Text(
                      item.description!,
                      style: const TextStyle(color: RestaurantTheme.secondaryText, fontSize: 11, height: 1.2),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            soldOut
                ? Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: <Widget>[
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                          decoration: BoxDecoration(
                            color: RestaurantTheme.borderLight,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: RestaurantTheme.border),
                          ),
                          child: const Text(
                            'SOLD OUT',
                            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 10.5, color: RestaurantTheme.secondaryText),
                          ),
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'not addable',
                          style: TextStyle(fontSize: 9, color: RestaurantTheme.secondaryText),
                        ),
                      ],
                    ),
                  )
                : quantity == 0
                    ? ElevatedButton(
                        onPressed: onAdd,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: RestaurantTheme.neonOrangeLight,
                          foregroundColor: RestaurantTheme.neonOrangeDark,
                          elevation: 0,
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                          minimumSize: const Size(64, 32),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10),
                            side: const BorderSide(color: RestaurantTheme.neonOrange),
                          ),
                        ),
                        child: const Text('+ ADD', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 11.5)),
                      )
                    : Container(
                        decoration: BoxDecoration(
                          color: RestaurantTheme.neonOrange,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: <Widget>[
                            IconButton(
                              icon: const Icon(Icons.remove, size: 14, color: NabinColor.onBrand),
                              padding: EdgeInsets.zero,
                              constraints: const BoxConstraints(minWidth: 26, minHeight: 28),
                              onPressed: onDecrement,
                            ),
                            Text(
                              '$quantity',
                              style: const TextStyle(
                                color: NabinColor.onBrand,
                                fontWeight: FontWeight.w900,
                                fontSize: 12,
                              ),
                            ),
                            IconButton(
                              icon: const Icon(Icons.add, size: 14, color: NabinColor.onBrand),
                              padding: EdgeInsets.zero,
                              constraints: const BoxConstraints(minWidth: 26, minHeight: 28),
                              onPressed: onAdd,
                            ),
                          ],
                        ),
                      ),
          ],
        ),
      ),
    );
  }
}

class _StickyCartBar extends StatelessWidget {
  const _StickyCartBar({required this.cart, required this.onCheckout});

  final FoodCart cart;
  final VoidCallback onCheckout;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: RestaurantTheme.charcoal,
        borderRadius: BorderRadius.circular(18),
        boxShadow: <BoxShadow>[
          BoxShadow(
            color: RestaurantTheme.charcoal.withValues(alpha: 0.35),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: <Widget>[
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(
                '${cart.itemCount} ${cart.itemCount == 1 ? 'ITEM' : 'ITEMS'} • ${cart.restaurantName ?? 'this kitchen'}',
                style: const TextStyle(
                  color: RestaurantTheme.neonOrange,
                  fontSize: 9.5,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 0.5,
                ),
              ),
              Text(
                '₹${foodPrice(cart.itemTotal)}',
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: NabinColor.onBrand),
              ),
            ],
          ),
          ElevatedButton(
            onPressed: onCheckout,
            style: ElevatedButton.styleFrom(
              backgroundColor: RestaurantTheme.neonOrange,
              foregroundColor: RestaurantTheme.charcoal,
              minimumSize: const Size(140, 42),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              elevation: 0,
            ),
            child: const Row(
              children: <Widget>[
                Text('Proceed to Checkout', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 12)),
                SizedBox(width: 4),
                Icon(Icons.arrow_forward_rounded, size: 14),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CircleIconButton extends StatelessWidget {
  const _CircleIconButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(8),
        decoration: const BoxDecoration(
          color: NabinColor.surface,
          shape: BoxShape.circle,
          boxShadow: <BoxShadow>[BoxShadow(color: Colors.black26, blurRadius: 6)],
        ),
        child: Icon(icon, size: 16, color: RestaurantTheme.charcoal),
      ),
    );
  }
}
