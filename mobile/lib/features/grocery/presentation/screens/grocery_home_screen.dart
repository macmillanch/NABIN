import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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

    final List<String> pills = <String>['All', ...categories];

    return Scaffold(
      backgroundColor: GroceryTheme.bgOffWhite,
      appBar: AppBar(
        backgroundColor: GroceryTheme.surfaceWhite,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded,
              color: GroceryTheme.textDark, size: 18),
          onPressed: () {
            if (Navigator.of(context).canPop()) Navigator.of(context).pop();
          },
        ),
        title: Row(
          children: <Widget>[
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: <Color>[GroceryTheme.primaryGreen, GroceryTheme.primaryGreenDark],
                ),
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
                      color: GroceryTheme.textDark,
                    ),
                  ),
                  Text(
                    'Live prices from NABIN grocery merchants',
                    style: TextStyle(
                      fontSize: 10.5,
                      color: GroceryTheme.textMuted,
                      fontWeight: FontWeight.normal,
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
              color: GroceryTheme.primaryGreenDark,
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

                    if (categories.isNotEmpty)
                      SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(
                          children: pills.map((String label) {
                            final bool isSelected =
                                (activeCategory == null && label == 'All') ||
                                    activeCategory == label;
                            return Padding(
                              padding: const EdgeInsets.only(right: NabinSpacing.sm),
                              child: GestureDetector(
                                onTap: () =>
                                    notifier.setCategory(label == 'All' ? null : label),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 14,
                                    vertical: 8,
                                  ),
                                  decoration: BoxDecoration(
                                    color: isSelected
                                        ? GroceryTheme.primaryGreenDark
                                        : GroceryTheme.surfaceWhite,
                                    borderRadius: BorderRadius.circular(12),
                                    border: Border.all(
                                      color: isSelected
                                          ? GroceryTheme.primaryGreenDark
                                          : GroceryTheme.borderLight,
                                    ),
                                  ),
                                  child: Text(
                                    label,
                                    style: TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w800,
                                      color: isSelected
                                          ? Colors.white
                                          : GroceryTheme.textDark,
                                    ),
                                  ),
                                ),
                              ),
                            );
                          }).toList(),
                        ),
                      )
                    else if (catalogState.hasError)
                      const GroceryRefreshBanner(
                        message: 'Aisle names could not be loaded.',
                      ),

                    const SizedBox(height: NabinSpacing.md),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
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
          const Icon(Icons.search_rounded, color: GroceryTheme.primaryGreenDark, size: 22),
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
