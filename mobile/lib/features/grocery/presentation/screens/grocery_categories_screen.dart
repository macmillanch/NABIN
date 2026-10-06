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

/// Aisle browser — the two-pane menu: aisles down the left, their products on the
/// right. The aisle names, their item counts and their representative emoji are
/// derived from real product rows (`category`, `emoji`); the grid itself comes
/// from the endpoint's `category` and `search` query params.
/// The old literal category list, its invented "42 items" counts, the fixed
/// Material icon set and the demo product array are gone, and so is the star
/// rating badge — the grocery product payload has no rating.
class GroceryCategoriesScreen extends ConsumerStatefulWidget {
  const GroceryCategoriesScreen({
    super.key,
    this.onAddToCart,
    this.initialCategory,
  });

  final void Function(String itemTitle)? onAddToCart;

  /// The aisle a home-grid tile named. Applied once the aisle names are in, and
  /// dropped if no merchant lists under that name — a pane filtered to an aisle
  /// that does not exist is an empty screen with no explanation.
  final String? initialCategory;

  @override
  ConsumerState<GroceryCategoriesScreen> createState() =>
      _GroceryCategoriesScreenState();
}

class _GroceryCategoriesScreenState extends ConsumerState<GroceryCategoriesScreen> {
  final TextEditingController _searchController = TextEditingController();

  /// null means the whole catalogue, which is why it is the aisle and not an
  /// index that gets selected: the names arrive with the catalogue read.
  String? _selectedAisle;
  bool _hasSearchText = false;
  bool _deepLinkScheduled = false;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _select(String? aisle) {
    setState(() => _selectedAisle = aisle);
    ref.read(groceryProductsProvider.notifier).setCategory(aisle);
  }

  void _applyDeepLink(List<String> categories) {
    final String wanted = (widget.initialCategory ?? '').trim();
    if (wanted.isEmpty) return;
    for (final String category in categories) {
      if (category.toLowerCase() == wanted.toLowerCase()) {
        _select(category);
        return;
      }
    }
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

    // A route's aisle can only be applied once the names exist, and applying it
    // means telling the provider, which cannot happen mid-build.
    if (!_deepLinkScheduled && categories.isNotEmpty) {
      _deepLinkScheduled = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _applyDeepLink(categories);
      });
    }

    return Scaffold(
      backgroundColor: GroceryTheme.bgOffWhite,
      appBar: AppBar(
        backgroundColor: GroceryTheme.headerBand,
        elevation: 0,
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              'Categories & aisles',
              style: TextStyle(
                fontWeight: FontWeight.w900,
                fontSize: 18,
                color: GroceryTheme.onHeader,
              ),
            ),
            Text(
              'Named by what NABIN merchants actually list',
              style: TextStyle(fontSize: 11, color: Colors.white70),
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
                          color: GroceryTheme.headerBand, size: 20),
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
                                      width: 116,
                                      child: ListView.builder(
                                        padding: EdgeInsets.zero,
                                        // Index 0 is the whole catalogue: a rail you
                                        // can only narrow, never clear.
                                        itemCount: categories.length + 1,
                                        itemBuilder: (BuildContext context, int index) {
                                          final String? aisle =
                                              index == 0 ? null : categories[index - 1];
                                          final List<GroceryProduct> rows = aisle == null
                                              ? const <GroceryProduct>[]
                                              : byCategory[aisle] ??
                                                  const <GroceryProduct>[];
                                          final bool selected = _selectedAisle == aisle;
                                          return InkWell(
                                            onTap: () => _select(aisle),
                                            child: AnimatedContainer(
                                              duration: NabinMotion.fast,
                                              padding: const EdgeInsets.symmetric(
                                                horizontal: 8,
                                                vertical: 14,
                                              ),
                                              decoration: BoxDecoration(
                                                // A selected aisle is page structure,
                                                // so it is brand indigo; the greens
                                                // stay the service identity.
                                                color: selected
                                                    ? GroceryTheme.sectionFill
                                                    : GroceryTheme.surfaceWhite,
                                                border: Border(
                                                  left: BorderSide(
                                                    color: selected
                                                        ? GroceryTheme.headerBand
                                                        : Colors.transparent,
                                                    width: 4,
                                                  ),
                                                ),
                                              ),
                                              child: Column(
                                                mainAxisSize: MainAxisSize.min,
                                                children: <Widget>[
                                                  if (aisle == null)
                                                    const Icon(Icons.apps_rounded,
                                                        size: 20,
                                                        color: GroceryTheme.headerBand)
                                                  else if (rows.isNotEmpty)
                                                    // Real emoji off a real row.
                                                    Text(
                                                      rows.first.emoji,
                                                      style: const TextStyle(fontSize: 20),
                                                    )
                                                  else
                                                    const Icon(Icons.category_outlined,
                                                        size: 20,
                                                        color: GroceryTheme.textMuted),
                                                  const SizedBox(height: 6),
                                                  Text(
                                                    aisle ?? 'All aisles',
                                                    textAlign: TextAlign.center,
                                                    style: TextStyle(
                                                      fontSize: 11,
                                                      fontWeight: selected
                                                          ? FontWeight.w900
                                                          : FontWeight.w600,
                                                      color: selected
                                                          ? GroceryTheme.headerBand
                                                          : GroceryTheme.textDark,
                                                    ),
                                                  ),
                                                  const SizedBox(height: 2),
                                                  Text(
                                                    aisle == null
                                                        ? 'Everything listed'
                                                        : '${rows.length} ${rows.length == 1 ? 'item' : 'items'}',
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
                                          // The pane names what it is showing, and the
                                          // count is the length of the response for it.
                                          Row(
                                            children: <Widget>[
                                              Expanded(
                                                child: Text(
                                                  _selectedAisle ?? 'All aisles',
                                                  maxLines: 1,
                                                  overflow: TextOverflow.ellipsis,
                                                  style: const TextStyle(
                                                    fontSize: 15.5,
                                                    fontWeight: FontWeight.w900,
                                                    color: GroceryTheme.textDark,
                                                  ),
                                                ),
                                              ),
                                              if (listState.hasValue)
                                                Text(
                                                  '${(listState.valueOrNull ?? const <GroceryProduct>[]).length} shown',
                                                  style: const TextStyle(
                                                    fontSize: 11,
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
                                                ? 'Nothing matches “${notifier.activeSearch}”'
                                                : _selectedAisle == null
                                                    ? 'Nothing is listed right now'
                                                    : 'Nothing listed in $_selectedAisle',
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
