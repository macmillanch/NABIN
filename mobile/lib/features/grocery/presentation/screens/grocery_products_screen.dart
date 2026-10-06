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
import '../widgets/grocery_state_views.dart';

/// Dedicated grocery product list — the level between the aisles and the
/// product detail (category → product list → detail → quantity → basket).
///
/// Search and the category both go to `GET /api/grocery/products` as the real
/// `search` / `category` params through `groceryProductsProvider`; the list is
/// never filtered in memory. The backend exposes no sort, so the sort control
/// here only re-orders the rows the endpoint already returned for the active
/// query — it is honest about sorting "these results", not the whole catalogue.
class GroceryProductsScreen extends ConsumerStatefulWidget {
  const GroceryProductsScreen({
    super.key,
    this.initialCategory,
    this.initialSearch,
  });

  final String? initialCategory;
  final String? initialSearch;

  @override
  ConsumerState<GroceryProductsScreen> createState() => _GroceryProductsScreenState();
}

enum _Sort { relevance, priceLowHigh, priceHighLow, discount, availableFirst }

extension on _Sort {
  String get label => switch (this) {
        _Sort.relevance => 'Best match',
        _Sort.priceLowHigh => 'Price: low to high',
        _Sort.priceHighLow => 'Price: high to low',
        _Sort.discount => 'Biggest discount',
        _Sort.availableFirst => 'In stock first',
      };
}

class _GroceryProductsScreenState extends ConsumerState<GroceryProductsScreen> {
  late final TextEditingController _searchController;
  bool _hasSearchText = false;
  _Sort _sort = _Sort.relevance;

  @override
  void initState() {
    super.initState();
    final seed = (widget.initialSearch ?? '').trim();
    _searchController = TextEditingController(text: seed);
    _hasSearchText = seed.isNotEmpty;
    // The provider owns the live query; seed it from the route once the first
    // frame is up so we never call a notifier during build.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(groceryProductsProvider.notifier).setCategory(widget.initialCategory);
      if (seed.isNotEmpty) {
        ref.read(groceryProductsProvider.notifier).onSearchChanged(seed);
      }
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
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

  /// Sort the already-fetched rows for the active query. Nothing here invents
  /// a server sort the endpoint does not have.
  List<GroceryProduct> _applySort(List<GroceryProduct> rows) {
    final List<GroceryProduct> sorted = List<GroceryProduct>.of(rows);
    switch (_sort) {
      case _Sort.relevance:
        return rows;
      case _Sort.priceLowHigh:
        sorted.sort((a, b) => a.currentPrice.compareTo(b.currentPrice));
      case _Sort.priceHighLow:
        sorted.sort((a, b) => b.currentPrice.compareTo(a.currentPrice));
      case _Sort.discount:
        sorted.sort((a, b) {
          final byPercent = b.discountPercent.compareTo(a.discountPercent);
          return byPercent != 0 ? byPercent : b.savings.compareTo(a.savings);
        });
      case _Sort.availableFirst:
        sorted.sort((a, b) => (b.canAddToCart ? 1 : 0).compareTo(a.canAddToCart ? 1 : 0));
    }
    return sorted;
  }

  @override
  Widget build(BuildContext context) {
    final listState = ref.watch(groceryProductsProvider);
    final notifier = ref.read(groceryProductsProvider.notifier);
    final categories = ref.watch(groceryCategoriesProvider);
    final activeCategory = notifier.activeCategory;
    final products = listState.valueOrNull ?? const <GroceryProduct>[];
    final showCartBar = ref.watch(
      groceryCartProvider.select((GroceryCartState cart) => cart.totalQuantity > 0),
    );

    return Scaffold(
      backgroundColor: GroceryTheme.bgOffWhite,
      appBar: AppBar(
        backgroundColor: GroceryTheme.headerBand,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: GroceryTheme.onHeader, size: 18),
          onPressed: () => context.canPop() ? context.pop() : context.go('/grocery-home'),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              activeCategory ?? 'All products',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: GroceryTheme.onHeader),
            ),
            if (listState.hasValue)
              Text(
                '${products.length} ${products.length == 1 ? 'item' : 'items'} from NABIN merchants',
                style: const TextStyle(
                    fontSize: 11, fontWeight: FontWeight.normal, color: Colors.white70),
              ),
          ],
        ),
        actions: <Widget>[
          PopupMenuButton<_Sort>(
            initialValue: _sort,
            tooltip: 'Sort these results',
            icon: const Icon(Icons.sort_rounded, color: GroceryTheme.textDark),
            onSelected: (value) => setState(() => _sort = value),
            itemBuilder: (context) => <PopupMenuEntry<_Sort>>[
              for (final option in _Sort.values)
                PopupMenuItem<_Sort>(
                  value: option,
                  child: Row(
                    children: <Widget>[
                      SizedBox(
                        width: 18,
                        child: option == _sort
                            ? const Icon(Icons.check_rounded, size: 18, color: GroceryTheme.headerBand)
                            : null,
                      ),
                      const SizedBox(width: 8),
                      // The menu is 256px wide and the label gets the rest: a
                      // bare Text here pushed the row past the menu's own width.
                      Expanded(
                        child: Text(
                          option.label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ],
      ),
      body: SafeArea(
        child: Stack(
          children: <Widget>[
            RefreshIndicator(
              color: GroceryTheme.primaryAction,
              onRefresh: notifier.refresh,
              child: Column(
                children: <Widget>[
                  _SearchField(controller: _searchController, hasText: _hasSearchText, onChanged: _onSearchChanged, onClear: _clearSearch),
                  if (categories.isNotEmpty)
                    _CategoryChips(
                      categories: categories,
                      active: activeCategory,
                      onSelect: notifier.setCategory,
                    ),
                  Expanded(
                    child: SingleChildScrollView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(NabinSpacing.md, NabinSpacing.md, NabinSpacing.md, 96),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          if (_sort != _Sort.relevance && listState.hasValue)
                            Padding(
                              padding: const EdgeInsets.only(bottom: NabinSpacing.sm),
                              child: Text(
                                'Sorted by ${_sort.label} (these results only)',
                                style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: GroceryTheme.textMuted),
                              ),
                            ),
                          GroceryProductsView(
                            state: listState,
                            onRetry: notifier.refresh,
                            transform: _applySort,
                            emptyIcon: Icons.search_rounded,
                            emptyTitle: notifier.activeSearch.isNotEmpty
                                ? 'No products match “${notifier.activeSearch}”'
                                : 'Nothing listed here right now',
                            emptyMessage: notifier.activeSearch.isNotEmpty
                                ? 'The search runs against the live NABIN catalogue, so try a shorter word or clear the filter.'
                                : 'Try another aisle, or pull down to refresh the catalogue.',
                            builder: (context, items) => GroceryProductsGrid(
                              products: items,
                              tileBuilder: (context, product) => GroceryProductTile(product: product),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
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

class _SearchField extends StatelessWidget {
  const _SearchField({
    required this.controller,
    required this.hasText,
    required this.onChanged,
    required this.onClear,
  });

  final TextEditingController controller;
  final bool hasText;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(NabinSpacing.md, NabinSpacing.sm, NabinSpacing.md, NabinSpacing.sm),
      child: Container(
        height: 48,
        padding: const EdgeInsets.symmetric(horizontal: NabinSpacing.md),
        decoration: BoxDecoration(
          color: GroceryTheme.surfaceWhite,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: GroceryTheme.borderLight),
        ),
        child: Row(
          children: <Widget>[
            const Icon(Icons.search_rounded, color: GroceryTheme.headerBand, size: 20),
            const SizedBox(width: 10),
            Expanded(
              child: TextField(
                controller: controller,
                onChanged: onChanged,
                textInputAction: TextInputAction.search,
                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: GroceryTheme.textDark),
                decoration: const InputDecoration(
                  hintText: 'Search this list…',
                  hintStyle: TextStyle(color: GroceryTheme.textMuted, fontSize: 13, fontWeight: FontWeight.normal),
                  border: InputBorder.none,
                  isDense: true,
                ),
              ),
            ),
            if (hasText)
              GestureDetector(
                onTap: onClear,
                child: const Icon(Icons.close_rounded, size: 18, color: GroceryTheme.textMuted),
              ),
          ],
        ),
      ),
    );
  }
}

class _CategoryChips extends StatelessWidget {
  const _CategoryChips({required this.categories, required this.active, required this.onSelect});

  final List<String> categories;
  final String? active;
  final ValueChanged<String?> onSelect;

  @override
  Widget build(BuildContext context) {
    final pills = <String?>[null, ...categories];
    return SizedBox(
      height: 44,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: NabinSpacing.md),
        itemCount: pills.length,
        separatorBuilder: (_, __) => const SizedBox(width: NabinSpacing.sm),
        itemBuilder: (context, index) {
          final category = pills[index];
          final selected = active == category;
          return GestureDetector(
            onTap: () => onSelect(category),
            child: Container(
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 14),
              decoration: BoxDecoration(
                color: selected ? GroceryTheme.chipSelected : GroceryTheme.sectionFill,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: selected ? GroceryTheme.chipSelected : Colors.transparent,
                ),
              ),
              child: Text(
                category ?? 'All',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  color: selected ? GroceryTheme.onChipSelected : GroceryTheme.textDark,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
