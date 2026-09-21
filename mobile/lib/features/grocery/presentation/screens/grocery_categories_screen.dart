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

/// Aisle browser. The aisle names, their item counts and their representative
/// emoji are derived from real product rows (`category`, `emoji`); the grid
/// itself comes from the endpoint's `category` and `search` query params.
/// The old literal category list, its invented "42 items" counts, the fixed
/// Material icon set and the demo product array are gone, and so is the star
/// rating badge — the grocery product payload has no rating.
class GroceryCategoriesScreen extends ConsumerStatefulWidget {
  const GroceryCategoriesScreen({super.key, this.onAddToCart});

  final void Function(String itemTitle)? onAddToCart;

  @override
  ConsumerState<GroceryCategoriesScreen> createState() =>
      _GroceryCategoriesScreenState();
}

class _GroceryCategoriesScreenState extends ConsumerState<GroceryCategoriesScreen> {
  final TextEditingController _searchController = TextEditingController();
  int _selectedIndex = 0;
  bool _hasSearchText = false;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _selectCategory(int index, List<String> categories) {
    setState(() => _selectedIndex = index);
    ref.read(groceryProductsProvider.notifier).setCategory(categories[index]);
  }

  void _onSearchChanged(String value) {
    setState(() => _hasSearchText = value.trim().isNotEmpty);
    ref.read(groceryProductsProvider.notifier).onSearchChanged(value);
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<GroceryProduct>> catalogState =
        ref.watch(groceryCatalogProvider);
    final AsyncValue<List<GroceryProduct>> listState =
        ref.watch(groceryProductsProvider);
    final List<String> categories = ref.watch(groceryCategoriesProvider);
    final GroceryProductsNotifier notifier =
        ref.read(groceryProductsProvider.notifier);
    final bool showCartBar = ref.watch(
      groceryCartProvider.select((GroceryCartState cart) => cart.totalQuantity > 0),
    );

    // Per-aisle counts and the tile emoji come straight off the catalogue rows.
    final Map<String, List<GroceryProduct>> byCategory =
        <String, List<GroceryProduct>>{};
    for (final GroceryProduct product
        in catalogState.valueOrNull ?? const <GroceryProduct>[]) {
      final String? category = product.category;
      if (category == null) continue;
      byCategory.putIfAbsent(category, () => <GroceryProduct>[]).add(product);
    }

    if (_selectedIndex >= categories.length) _selectedIndex = 0;

    return Scaffold(
      backgroundColor: GroceryTheme.bgOffWhite,
      appBar: AppBar(
        backgroundColor: GroceryTheme.surfaceWhite,
        elevation: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: const <Widget>[
            Text(
              'Categories & aisles',
              style: TextStyle(
                fontWeight: FontWeight.w900,
                fontSize: 18,
                color: GroceryTheme.textDark,
              ),
            ),
            Text(
              'Named by what NABIN merchants actually list',
              style: TextStyle(fontSize: 11, color: GroceryTheme.textMuted),
            ),
          ],
        ),
      ),
      body: SafeArea(
        child: Stack(
          children: <Widget>[
            Column(
              children: <Widget>[
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    NabinSpacing.md,
                    NabinSpacing.sm,
                    NabinSpacing.md,
                    NabinSpacing.sm,
                  ),
                  child: TextField(
                    controller: _searchController,
                    onChanged: _onSearchChanged,
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                    decoration: InputDecoration(
                      hintText: 'Search the catalogue…',
                      hintStyle: const TextStyle(
                        color: GroceryTheme.textMuted,
                        fontSize: 13,
                        fontWeight: FontWeight.normal,
                      ),
                      prefixIcon: const Icon(Icons.search_rounded,
                          color: GroceryTheme.primaryGreenDark, size: 20),
                      suffixIcon: _hasSearchText
                          ? IconButton(
                              icon: const Icon(Icons.close_rounded, size: 18),
                              onPressed: () {
                                _searchController.clear();
                                _onSearchChanged('');
                              },
                            )
                          : null,
                      filled: true,
                      fillColor: GroceryTheme.surfaceWhite,
                      contentPadding: const EdgeInsets.symmetric(vertical: 12),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: const BorderSide(color: GroceryTheme.borderLight),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: const BorderSide(color: GroceryTheme.borderLight),
                      ),
                    ),
                  ),
                ),
                Expanded(
                  child: !catalogState.hasValue && catalogState.isLoading
                      ? const GrocerySkeletonGrid()
                      : !catalogState.hasValue && catalogState.hasError
                          ? GroceryNotice(
                              icon: Icons.cloud_off_rounded,
                              title: 'The aisles could not be loaded',
                              message: describeGroceryAsyncError(catalogState.error),
                              actionLabel: 'Try again',
                              onAction: () =>
                                  ref.read(groceryCatalogProvider.notifier).load(),
                              iconColor: GroceryTheme.accentRose,
                            )
                          : categories.isEmpty
                              ? const GroceryNotice(
                                  icon: Icons.category_outlined,
                                  title: 'No aisles are listed yet',
                                  message:
                                      'Once a merchant lists products with a category, the aisle appears here.',
                                )
                              : Row(
                                  crossAxisAlignment: CrossAxisAlignment.stretch,
                                  children: <Widget>[
                                    SizedBox(
                                      width: 120,
                                      child: ListView.builder(
                                        padding: EdgeInsets.zero,
                                        itemCount: categories.length,
                                        itemBuilder: (BuildContext context, int index) {
                                          final String category = categories[index];
                                          final List<GroceryProduct> rows =
                                              byCategory[category] ??
                                                  const <GroceryProduct>[];
                                          final bool selected = _selectedIndex == index;
                                          return InkWell(
                                            onTap: () => _selectCategory(index, categories),
                                            child: AnimatedContainer(
                                              duration: NabinMotion.fast,
                                              padding: const EdgeInsets.symmetric(
                                                horizontal: 8,
                                                vertical: 14,
                                              ),
                                              decoration: BoxDecoration(
                                                color: selected
                                                    ? GroceryTheme.primaryGreenLight
                                                    : GroceryTheme.surfaceWhite,
                                                border: Border(
                                                  left: BorderSide(
                                                    color: selected
                                                        ? GroceryTheme.primaryGreenDark
                                                        : Colors.transparent,
                                                    width: 4,
                                                  ),
                                                ),
                                              ),
                                              child: Column(
                                                mainAxisSize: MainAxisSize.min,
                                                children: <Widget>[
                                                  // Real emoji off a real row.
                                                  Text(
                                                    rows.first.emoji,
                                                    style: const TextStyle(fontSize: 20),
                                                  ),
                                                  const SizedBox(height: 6),
                                                  Text(
                                                    category,
                                                    textAlign: TextAlign.center,
                                                    style: TextStyle(
                                                      fontSize: 11,
                                                      fontWeight: selected
                                                          ? FontWeight.w900
                                                          : FontWeight.w600,
                                                      color: selected
                                                          ? GroceryTheme.primaryGreenDark
                                                          : GroceryTheme.textDark,
                                                    ),
                                                  ),
                                                  const SizedBox(height: 2),
                                                  Text(
                                                    '${rows.length} ${rows.length == 1 ? 'item' : 'items'}',
                                                    style: const TextStyle(
                                                      fontSize: 9.5,
                                                      color: GroceryTheme.textMuted,
                                                      fontWeight: FontWeight.w700,
                                                    ),
                                                  ),
                                                ],
                                              ),
                                            ),
                                          );
                                        },
                                      ),
                                    ),
                                    const VerticalDivider(
                                        width: 1, color: GroceryTheme.borderLight),
                                    Expanded(
                                      child: ListView(
                                        padding: const EdgeInsets.all(NabinSpacing.md),
                                        children: <Widget>[
                                          GroceryProductsView(
                                            state: listState,
                                            onRetry: notifier.refresh,
                                            emptyIcon: Icons.search_rounded,
                                            emptyTitle: notifier.activeSearch.isNotEmpty
                                                ? 'Nothing matches “${notifier.activeSearch}”'
                                                : 'Nothing listed in ${categories[_selectedIndex]}',
                                            emptyMessage:
                                                'Pick another aisle, or clear the search to see the whole catalogue.',
                                            builder: (BuildContext context,
                                                    List<GroceryProduct> items) =>
                                                GroceryProductsGrid(
                                              products: items,
                                              tileBuilder: (BuildContext context,
                                                      GroceryProduct product) =>
                                                  GroceryProductTile(
                                                product: product,
                                                onAdded: widget.onAddToCart,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                ),
              ],
            ),
            if (showCartBar) const GroceryCartBar(),
          ],
        ),
      ),
    );
  }
}
