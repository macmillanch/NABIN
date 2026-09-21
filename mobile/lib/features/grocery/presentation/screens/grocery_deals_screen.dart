import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/nabin_tokens.dart';
import '../models/grocery_product.dart';
import '../providers/grocery_cart_provider.dart';
import '../providers/grocery_products_provider.dart';
import '../theme/grocery_theme.dart';
import '../widgets/grocery_cart_sheet.dart';
import '../widgets/grocery_product_tile.dart';
import '../widgets/grocery_state_views.dart';

/// Price-drop browser.
///
/// The list is computed from `mrp` versus the live `currentPrice` of real
/// catalogue rows, because the backend has no deals, campaign-window or coupon
/// read path for a customer. Removed from the previous version for that reason:
/// the ticking "FLASH SALE ENDS IN 03:57:30" countdown, the three hard-coded
/// promo codes (M3FRESH / M3SUPER50 / M3SNACKS) and their minimum-order copy,
/// the fixed "Up to 50% OFF on 200+ items" claim, and the four demo "avocado /
/// blueberry" deal cards.
class GroceryDealsScreen extends ConsumerWidget {
  const GroceryDealsScreen({super.key, this.onAddToCart});

  final void Function(String itemTitle)? onAddToCart;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<GroceryProduct>> catalogState =
        ref.watch(groceryCatalogProvider);
    final List<GroceryProduct> drops =
        priceDropsOf(catalogState.valueOrNull ?? const <GroceryProduct>[]);
    final bool showCartBar = ref.watch(
      groceryCartProvider.select((GroceryCartState cart) => cart.totalQuantity > 0),
    );
    final int best = drops.isEmpty
        ? 0
        : drops
            .map((GroceryProduct product) => product.discountPercent)
            .reduce((int a, int b) => a > b ? a : b);
    final double saved =
        drops.fold<double>(0, (double sum, GroceryProduct p) => sum + p.savings);

    return Scaffold(
      backgroundColor: GroceryTheme.bgOffWhite,
      appBar: AppBar(
        backgroundColor: GroceryTheme.surfaceWhite,
        elevation: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: const <Widget>[
            Text(
              'Daily price drops',
              style: TextStyle(
                fontWeight: FontWeight.w900,
                fontSize: 18,
                color: GroceryTheme.textDark,
              ),
            ),
            Text(
              'Listed price below MRP right now',
              style: TextStyle(fontSize: 11, color: GroceryTheme.textMuted),
            ),
          ],
        ),
      ),
      body: SafeArea(
        child: Stack(
          children: <Widget>[
            RefreshIndicator(
              color: GroceryTheme.primaryGreenDark,
              onRefresh: () => ref.read(groceryCatalogProvider.notifier).load(),
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(NabinSpacing.md),
                children: <Widget>[
                  if (drops.isNotEmpty) _Header(best: best, drops: drops, saved: saved),
                  const SizedBox(height: NabinSpacing.md),
                  GroceryProductsView(
                    state: catalogState,
                    transform: priceDropsOf,
                    onRetry: () => ref.read(groceryCatalogProvider.notifier).load(),
                    emptyIcon: Icons.local_offer_outlined,
                    emptyTitle: catalogState.valueOrNull == null
                        ? 'The catalogue could not be read'
                        : 'Nothing is discounted right now',
                    emptyMessage: catalogState.valueOrNull == null
                        ? 'Check the connection and try again.'
                        : 'No listed product has a selling price below its list price right now.',
                    aspectRatio: 0.72,
                    builder: (BuildContext context, List<GroceryProduct> items) =>
                        GroceryProductsGrid(
                      products: items,
                      aspectRatio: 0.72,
                      tileBuilder: (BuildContext context, GroceryProduct product) =>
                          GroceryProductTile(
                        product: product,
                        showSource: true,
                        onAdded: onAddToCart,
                      ),
                    ),
                  ),
                  const SizedBox(height: 96),
                ],
              ),
            ),
            if (showCartBar) const GroceryCartBar(),
          ],
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.best, required this.drops, required this.saved});

  final int best;
  final List<GroceryProduct> drops;
  final double saved;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(NabinSpacing.md + 2),
      decoration: BoxDecoration(
        color: GroceryTheme.primaryGreenLight,
        borderRadius: NabinRadius.card,
        border: Border.all(color: GroceryTheme.borderLight),
      ),
      child: Row(
        children: <Widget>[
          const Icon(Icons.local_offer_rounded, color: GroceryTheme.primaryGreenDark, size: 28),
          const SizedBox(width: NabinSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  'Up to $best% below MRP',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                    color: GroceryTheme.primaryGreenDark,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${drops.length} listed ${drops.length == 1 ? 'item' : 'items'} — buying all of them once would save ${formatRupees(saved)} against MRP.',
                  style: const TextStyle(
                    fontSize: 11.5,
                    color: GroceryTheme.textMuted,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
