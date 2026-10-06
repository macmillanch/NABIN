import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/nabin_tokens.dart';
import '../models/grocery_product.dart';
import '../providers/grocery_cart_provider.dart';
import '../providers/grocery_products_provider.dart';
import '../theme/grocery_theme.dart';
import '../widgets/grocery_cart_sheet.dart';
import '../widgets/grocery_product_tile.dart';
import '../widgets/grocery_promo_carousel.dart';
import '../widgets/grocery_state_views.dart';

/// NABIN Grocery Express home. The grid, the aisles, the sponsored carousel and
/// the basket all read live endpoints; the demo product and banner arrays that
/// used to live here are gone.
class GroceryHomeScreen extends ConsumerStatefulWidget {
  const GroceryHomeScreen({super.key});

  @override
  ConsumerState<GroceryHomeScreen> createState() => _GroceryHomeScreenState();
}

class _GroceryHomeScreenState extends ConsumerState<GroceryHomeScreen> {
  final TextEditingController _searchController = TextEditingController();
  bool _hasSearchText = false;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _refresh(WidgetRef ref) async {
    await ref.read(groceryCatalogProvider.notifier).load();
    await ref.read(groceryProductsProvider.notifier).refresh();
  }

  void _onSearchChanged(String value) {
    setState(() => _hasSearchText = value.trim().isNotEmpty);
    ref.read(groceryProductsProvider.notifier).onSearchChanged(value);
  }

  void _clearSearch() {
    _searchController.clear();
    setState(() => _hasSearchText = false);
    ref.read(groceryProductsProvider.notifier).onSearchChanged('');
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<GroceryProduct>> listState = ref.watch(groceryProductsProvider);
    final AsyncValue<List<GroceryProduct>> catalogState = ref.watch(groceryCatalogProvider);
    final List<String> categories = ref.watch(groceryCategoriesProvider);
    final GroceryProductsNotifier notifier = ref.read(groceryProductsProvider.notifier);
    final String? activeCategory = notifier.activeCategory;
    final List<GroceryProduct> products = listState.valueOrNull ?? const <GroceryProduct>[];
    final bool showCartBar = ref.watch(
      groceryCartProvider.select((GroceryCartState cart) => cart.totalQuantity > 0),
    );

    // An aisle's artwork is one of that aisle's own catalogue rows, so a tile
    // cannot show a picture of something the store has not listed.
    final Map<String, GroceryProduct> aisleArt = <String, GroceryProduct>{};
    for (final GroceryProduct product
        in catalogState.valueOrNull ?? const <GroceryProduct>[]) {
      final String? category = product.category;
      if (category != null) aisleArt.putIfAbsent(category, () => product);
    }

    return Scaffold(
      backgroundColor: GroceryTheme.bgOffWhite,
      appBar: AppBar(
        backgroundColor: GroceryTheme.headerBand,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded,
              color: GroceryTheme.onHeader, size: 18),
          onPressed: () {
            if (Navigator.of(context).canPop()) Navigator.of(context).pop();
          },
        ),
        title: Row(
          children: <Widget>[
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
              decoration: BoxDecoration(
                color: GroceryTheme.serviceAccent,
                borderRadius: BorderRadius.circular(9),
              ),
              child: const Text(
                'NABIN',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                  fontSize: 13,
                  letterSpacing: 0.5,
                ),
              ),
            ),
            const SizedBox(width: 10),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    'Grocery Express',
                    style: TextStyle(
                      fontWeight: FontWeight.w900,
                      fontSize: 15,
                      color: GroceryTheme.onHeader,
                    ),
                  ),
                  Text(
                    'Live prices from NABIN grocery merchants',
                    style: TextStyle(
                      fontSize: 10.5,
                      color: Colors.white70,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      body: SafeArea(
        child: Stack(
          children: <Widget>[
            RefreshIndicator(
              color: GroceryTheme.primaryAction,
              onRefresh: () => _refresh(ref),
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.only(
                  left: NabinSpacing.lg,
                  right: NabinSpacing.lg,
                  top: NabinSpacing.sm,
                  bottom: 96,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    _buildSearchField(),
                    const SizedBox(height: NabinSpacing.md),

                    // Sponsored campaigns. Renders nothing when the slot is empty.
                    GroceryPromoCarousel(
                      categories: categories,
                      onCategoryFilter: notifier.setCategory,
                    ),
                    const SizedBox(height: NabinSpacing.sm),

                    // "Shop by category". The aisle names are the categories real
                    // merchants list under, and each tile opens the two-pane menu on
                    // that aisle. No delivery-time promise sits above it, because the
                    // platform has no SLA read to put there.
                    if (categories.isNotEmpty) ...<Widget>[
                      Row(
                        children: <Widget>[
                          const Expanded(
                            child: Text(
                              'Shop by category',
                              style: TextStyle(
                                fontSize: 16.5,
                                fontWeight: FontWeight.w900,
                                color: GroceryTheme.textDark,
                              ),
                            ),
                          ),
                          InkWell(
                            borderRadius: BorderRadius.circular(8),
                            onTap: () => context.push('/grocery-categories'),
                            child: const Padding(
                              padding: EdgeInsets.symmetric(horizontal: 2, vertical: 2),
                              child: Row(
                                children: <Widget>[
                                  Text(
                                    'Browse the menu',
                                    style: TextStyle(
                                      fontSize: 12.5,
                                      fontWeight: FontWeight.w900,
                                      color: GroceryTheme.onSecondaryAction,
                                    ),
                                  ),
                                  Icon(Icons.chevron_right_rounded,
                                      size: 16, color: GroceryTheme.onSecondaryAction),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: NabinSpacing.sm),
                      _AisleGrid(
                        aisles: categories,
                        artwork: aisleArt,
                        onOpen: (String aisle) => context.push(
                          '/grocery-categories?aisle=${Uri.encodeComponent(aisle)}',
                        ),
                      ),
                    ] else if (catalogState.hasError)
                      const GroceryRefreshBanner(
                        message: 'Aisle names could not be loaded.',
                      ),

                    const SizedBox(height: NabinSpacing.md),
                    Row(
                      children: <Widget>[
                        Expanded(
                          child: Text(
                            activeCategory ?? 'All products',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 16.5,
                              fontWeight: FontWeight.w900,
                              color: GroceryTheme.textDark,
                            ),
                          ),
                        ),
                        if (listState.hasValue)
                          Text(
                            '${products.length} ${products.length == 1 ? 'item' : 'items'}',
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: GroceryTheme.textMuted,
                            ),
                          ),
                        const SizedBox(width: NabinSpacing.sm),
                        InkWell(
                          borderRadius: BorderRadius.circular(8),
                          onTap: () => context.push(
                            activeCategory == null
                                ? '/grocery-products'
                                : '/grocery-products?category=${Uri.encodeComponent(activeCategory)}',
                          ),
                          child: const Padding(
                            padding: EdgeInsets.symmetric(horizontal: 2, vertical: 2),
                            child: Row(
                              children: <Widget>[
                                Text(
                                  'Sort',
                                  style: TextStyle(
                                    fontSize: 12.5,
                                    fontWeight: FontWeight.w900,
                                    color: GroceryTheme.onSecondaryAction,
                                  ),
                                ),
                                Icon(Icons.chevron_right_rounded, size: 16, color: GroceryTheme.onSecondaryAction),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: NabinSpacing.sm),

                    GroceryProductsView(
                      state: listState,
                      onRetry: notifier.refresh,
                      emptyIcon: Icons.search_rounded,
                      emptyTitle: notifier.activeSearch.isNotEmpty
                          ? 'No products match “${notifier.activeSearch}”'
                          : 'This aisle has nothing listed right now',
                      emptyMessage: notifier.activeSearch.isNotEmpty
                          ? 'The search runs against the NABIN catalogue, so try a shorter word.'
                          : 'Try another aisle, or pull down to refresh the catalogue.',
                      builder: (BuildContext context, List<GroceryProduct> items) =>
                          GroceryProductsGrid(
                        products: items,
                        tileBuilder: (BuildContext context, GroceryProduct product) =>
                            GroceryProductTile(product: product),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (showCartBar) const GroceryCartBar(),
          ],
        ),
      ),
    );
  }

  Widget _buildSearchField() {
    return Container(
      height: 50,
      padding: const EdgeInsets.symmetric(horizontal: NabinSpacing.md),
      decoration: BoxDecoration(
        color: GroceryTheme.surfaceWhite,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: GroceryTheme.borderLight),
      ),
      child: Row(
        children: <Widget>[
          const Icon(Icons.search_rounded, color: GroceryTheme.headerBand, size: 22),
          const SizedBox(width: 10),
          Expanded(
            child: TextField(
              controller: _searchController,
              onChanged: _onSearchChanged,
              textInputAction: TextInputAction.search,
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 14,
                color: GroceryTheme.textDark,
              ),
              decoration: const InputDecoration(
                hintText: 'Search the NABIN grocery catalogue…',
                hintStyle: TextStyle(
                  color: GroceryTheme.textMuted,
                  fontSize: 13,
                  fontWeight: FontWeight.normal,
                ),
                border: InputBorder.none,
                isDense: true,
              ),
            ),
          ),
          if (_hasSearchText)
            GestureDetector(
              onTap: _clearSearch,
              child: const Icon(Icons.close_rounded, size: 18, color: GroceryTheme.textMuted),
            ),
        ],
      ),
    );
  }
}

/// The aisle grid: four across on a phone, more as the screen widens. It is a
/// Wrap because it lives inside the home's scroll view.
class _AisleGrid extends StatelessWidget {
  const _AisleGrid({
    required this.aisles,
    required this.artwork,
    required this.onOpen,
  });

  final List<String> aisles;
  final Map<String, GroceryProduct> artwork;
  final ValueChanged<String> onOpen;

  static const double _gap = 8;

  @override
  Widget build(BuildContext context) {
    final double available = MediaQuery.sizeOf(context).width - NabinSpacing.lg * 2;
    final int columns = available >= 720 ? 8 : available >= 480 ? 6 : 4;
    final double tile = (available - _gap * (columns - 1)) / columns;
    return Wrap(
      spacing: _gap,
      runSpacing: _gap,
      children: aisles
          .map(
            (String aisle) => SizedBox(
              width: tile,
              child: _AisleTile(
                name: aisle,
                product: artwork[aisle],
                onTap: () => onOpen(aisle),
              ),
            ),
          )
          .toList(),
    );
  }
}

class _AisleTile extends StatelessWidget {
  const _AisleTile({required this.name, required this.product, required this.onTap});

  final String name;
  final GroceryProduct? product;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final GroceryProduct? row = product;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.all(5),
        decoration: BoxDecoration(
          color: GroceryTheme.surfaceWhite,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: GroceryTheme.borderLight),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            AspectRatio(
              aspectRatio: 1,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Container(
                  color: row?.artworkBackground ?? GroceryTheme.sectionFill,
                  child: Stack(
                    fit: StackFit.expand,
                    children: <Widget>[
                      if (row?.imageUrl != null)
                        Image.network(
                          row!.imageUrl!,
                          fit: BoxFit.cover,
                          errorBuilder: (context, error, stackTrace) =>
                              const SizedBox.shrink(),
                        ),
                      Center(
                        child: row == null
                            ? const Icon(Icons.category_outlined,
                                size: 22, color: GroceryTheme.textMuted)
                            : FittedBox(
                                fit: BoxFit.scaleDown,
                                child: Text(row.emoji,
                                    style: const TextStyle(fontSize: 26)),
                              ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 5),
            Text(
              name,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 10,
                height: 1.2,
                fontWeight: FontWeight.w800,
                color: GroceryTheme.textDark,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
