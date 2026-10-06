import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/nabin_tokens.dart';
import '../../../../core/theme/restaurant_theme.dart';
import '../providers/food_models.dart';
import '../providers/food_restaurants_provider.dart';
import '../widgets/food_shared_widgets.dart';

/// Cuisine selection — the top of the food browsing hierarchy
/// (category → restaurant list → menu sections → dish detail).
///
/// Cuisines are derived from the live restaurant feed; there is no cuisine
/// taxonomy endpoint on the server, so this screen shows exactly the cuisines
/// restaurants actually declare, with a truthful restaurant count per cuisine.
class FoodCategoryScreen extends ConsumerWidget {
  const FoodCategoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final restaurantsAsync = ref.watch(foodRestaurantsProvider);
    final feed = restaurantsAsync.valueOrNull;
    final cuisines = feed?.cuisines ?? const <String>[];
    final restaurants = feed?.restaurants ?? const <FoodRestaurant>[];

    // Count restaurants that declare each cuisine (a restaurant lists several).
    final counts = <String, int>{
      for (final cuisine in cuisines)
        cuisine: restaurants
            .where((r) => r.cuisines.any((c) => c.toLowerCase() == cuisine.toLowerCase()))
            .length,
    };

    return Scaffold(
      backgroundColor: RestaurantTheme.lightBg,
      appBar: AppBar(
        backgroundColor: RestaurantTheme.headerBand,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded,
              color: NabinColor.onBrand, size: 18),
          onPressed: () => context.canPop() ? context.pop() : context.go('/food-home'),
        ),
        title: const Text(
          'Browse by cuisine',
          style: TextStyle(
            fontWeight: FontWeight.w900,
            fontSize: 16,
            color: NabinColor.onBrand,
          ),
        ),
      ),
      body: SafeArea(
        child: RefreshIndicator(
          color: RestaurantTheme.primaryAction,
          onRefresh: () => ref.read(foodRestaurantsProvider.notifier).retry(),
          child: _body(context, ref, restaurantsAsync, cuisines, counts),
        ),
      ),
    );
  }

  Widget _body(
    BuildContext context,
    WidgetRef ref,
    AsyncValue<FoodRestaurantFeed> restaurantsAsync,
    List<String> cuisines,
    Map<String, int> counts,
  ) {
    if (restaurantsAsync.isLoading && !restaurantsAsync.hasValue) {
      return ListView(
        padding: const EdgeInsets.all(18),
        children: const <Widget>[
          FoodListSkeleton(itemCount: 4, rowHeight: 92),
        ],
      );
    }

    if (restaurantsAsync.hasError) {
      return ListView(
        padding: const EdgeInsets.all(18),
        children: <Widget>[
          FoodMessageCard(
            icon: Icons.wifi_tethering_error_rounded,
            title: 'Cuisines unavailable',
            message: restaurantsAsync.error.toString(),
            actionLabel: 'Try again',
            onAction: () => ref.read(foodRestaurantsProvider.notifier).retry(),
          ),
        ],
      );
    }

    if (cuisines.isEmpty) {
      return ListView(
        padding: const EdgeInsets.all(18),
        children: const <Widget>[
          FoodMessageCard(
            icon: Icons.rice_bowl_rounded,
            title: 'No cuisines yet',
            message:
                'No restaurants have opened on NABIN in this area yet, so there are no cuisines to browse. Check back shortly.',
          ),
        ],
      );
    }

    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 30),
      physics: const AlwaysScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        childAspectRatio: 1.5,
        crossAxisSpacing: 12,
        mainAxisSpacing: 12,
      ),
      itemCount: cuisines.length,
      itemBuilder: (context, index) {
        final cuisine = cuisines[index];
        return _CuisineTile(
          cuisine: cuisine,
          count: counts[cuisine] ?? 0,
          onTap: () {
            ref.read(foodHomeFiltersProvider.notifier).setCuisine(cuisine);
            context.go('/food-home');
          },
        );
      },
    );
  }
}

class _CuisineTile extends StatelessWidget {
  const _CuisineTile({
    required this.cuisine,
    required this.count,
    required this.onTap,
  });

  final String cuisine;
  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: RestaurantTheme.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: RestaurantTheme.border),
          boxShadow: <BoxShadow>[
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.03),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: <Widget>[
            FoodLetterTile(
              letter: cuisine.isEmpty ? '?' : cuisine.substring(0, 1).toUpperCase(),
              seed: cuisine,
              size: 44,
              radius: 12,
              icon: Icons.restaurant_menu_rounded,
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  cuisine,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontWeight: FontWeight.w900,
                    fontSize: 15,
                    color: RestaurantTheme.charcoal,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  count == 1 ? '1 restaurant' : '$count restaurants',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: RestaurantTheme.secondaryText,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
