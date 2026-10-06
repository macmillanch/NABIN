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

/// Product detail as its own screen — the leaf of the grocery browsing
/// hierarchy (category → product list → product detail → quantity → basket).
///
/// Reached from any grocery tile as `/grocery-product-detail?productId=...`.
/// There is no single-product endpoint, so the row is resolved from the live
/// `groceryCatalogProvider` by id; an unknown or since-delisted id renders the
/// same loading/error/unavailable states used everywhere else rather than a
/// placeholder. No rating, review count, delivery ETA, veg flag, coupon or
/// gallery is shown — the grocery product payload carries none of them.
class GroceryProductDetailScreen extends ConsumerWidget {
  const GroceryProductDetailScreen({super.key, this.productId});

  final String? productId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<GroceryProduct>> catalog =
        ref.watch(groceryCatalogProvider);
    final id = (productId ?? '').trim();

    GroceryProduct? product;
    for (final row in catalog.valueOrNull ?? const <GroceryProduct>[]) {
      if (row.id == id) {
        product = row;
        break;
      }
    }

    return Scaffold(
      backgroundColor: GroceryTheme.bgOffWhite,
      appBar: AppBar(
        backgroundColor: GroceryTheme.headerBand,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded,
              color: GroceryTheme.onHeader, size: 18),
          onPressed: () => context.canPop()
              ? context.pop()
              : context.go('/grocery-home'),
        ),
        title: const Text(
          'Product details',
          style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: GroceryTheme.onHeader),
        ),
      ),
      body: _body(context, ref, id, catalog, product),
      bottomNavigationBar: product != null && product.canAddToCart
          ? _DetailActionBar(product: product)
          : null,
    );
  }

  Widget _body(
    BuildContext context,
    WidgetRef ref,
    String id,
    AsyncValue<List<GroceryProduct>> catalog,
    GroceryProduct? product,
  ) {
    if (id.isEmpty) {
      return _message(
        icon: Icons.shopping_basket_outlined,
        title: 'No product selected',
        message: 'Open a product from the grocery aisles to see its details.',
        actionLabel: 'Back to grocery',
        onAction: () => context.go('/grocery-home'),
      );
    }

    if (!catalog.hasValue && catalog.isLoading) {
      return const SingleChildScrollView(
        padding: EdgeInsets.all(NabinSpacing.lg),
        child: GrocerySkeletonGrid(tileCount: 2, aspectRatio: 1.6),
      );
    }

    if (!catalog.hasValue && catalog.hasError) {
      return _message(
        icon: Icons.cloud_off_rounded,
        title: 'This product could not be loaded',
        message: describeGroceryAsyncError(catalog.error),
        actionLabel: 'Try again',
        onAction: () => ref.read(groceryCatalogProvider.notifier).load(),
      );
    }

    if (product == null) {
      return _message(
        icon: Icons.remove_shopping_cart_rounded,
        title: 'Product no longer listed',
        message:
            'No NABIN grocery merchant lists this product right now, so its details cannot be shown.',
        actionLabel: 'Browse groceries',
        onAction: () => context.go('/grocery-home'),
      );
    }

    return RefreshIndicator(
      color: GroceryTheme.primaryGreenDark,
      onRefresh: () => ref.read(groceryCatalogProvider.notifier).load(),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
            NabinSpacing.lg, NabinSpacing.lg, NabinSpacing.lg, NabinSpacing.xxxl),
        children: <Widget>[
          _Artwork(product: product),
          const SizedBox(height: NabinSpacing.md),
          _Pills(product: product),
          const SizedBox(height: NabinSpacing.md),
          _TitleBlock(product: product),
          const SizedBox(height: NabinSpacing.md),
          _PriceRow(product: product),
          const SizedBox(height: NabinSpacing.lg),
          const Divider(color: GroceryTheme.borderLight, height: 1),
          const SizedBox(height: NabinSpacing.md),
          const Text(
            'What the store lists',
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: GroceryTheme.textDark),
          ),
          const SizedBox(height: NabinSpacing.sm),
          for (final _Fact fact in _facts(product))
            _FactRow(fact: fact),
          if (product.priceUpdatedLabel.isNotEmpty) ...<Widget>[
            const SizedBox(height: NabinSpacing.xs),
            Row(
              children: <Widget>[
                const Icon(Icons.schedule_rounded, size: 14, color: GroceryTheme.textMuted),
                const SizedBox(width: 6),
                Text(
                  product.priceUpdatedLabel,
                  style: const TextStyle(fontSize: 11.5, color: GroceryTheme.textMuted),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _message({
    required IconData icon,
    required String title,
    required String message,
    String? actionLabel,
    VoidCallback? onAction,
  }) {
    return ListView(
      padding: const EdgeInsets.all(NabinSpacing.lg),
      children: <Widget>[
        GroceryNotice(icon: icon, title: title, message: message, actionLabel: actionLabel, onAction: onAction),
      ],
    );
  }

  /// Only fields the endpoint actually returns, and only when present.
  static List<_Fact> _facts(GroceryProduct product) => <_Fact>[
        if (product.merchantName != null)
          _Fact('Sold by', product.merchantName!, Icons.storefront_rounded),
        if (product.brand != null) _Fact('Brand', product.brand!, Icons.verified_rounded),
        if (product.category != null) _Fact('Aisle', product.category!, Icons.category_rounded),
        if (product.unit != null) _Fact('Sold per', product.unit!, Icons.straighten_rounded),
        if (product.packSize != null)
          _Fact('Pack size', product.packSize!, Icons.inventory_2_outlined),
        _Fact(
          'Availability',
          product.canAddToCart
              ? 'Listed • ${GroceryProduct.trimAmount(product.stockQty)} in stock'
              : 'Not available for order',
          Icons.inventory_rounded,
        ),
        if (product.previousPrice != null &&
            (product.previousPrice! - product.currentPrice).abs() > 0.01)
          _Fact(
            'Price movement',
            '${formatRupees(product.previousPrice!)} → ${product.priceLabel}',
            Icons.trending_up_rounded,
          ),
      ];
}

class _Artwork extends StatelessWidget {
  const _Artwork({required this.product});

  final GroceryProduct product;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(22),
      child: Container(
        height: MediaQuery.sizeOf(context).width * 0.6,
        width: double.infinity,
        color: product.artworkBackground,
        child: Stack(
          fit: StackFit.expand,
          children: <Widget>[
            Center(child: Text(product.emoji, style: const TextStyle(fontSize: 96))),
            if (product.imageUrl != null)
              Image.network(
                product.imageUrl!,
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) => const SizedBox.shrink(),
              ),
          ],
        ),
      ),
    );
  }
}

class _Pills extends StatelessWidget {
  const _Pills({required this.product});

  final GroceryProduct product;

  @override
  Widget build(BuildContext context) {
    final discount = product.discountPercent;
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: <Widget>[
        if (discount > 0) _Pill(label: '$discount% OFF', color: GroceryTheme.primaryGreenDark),
        if (product.isWeightBased)
          const _Pill(label: 'Priced by packed weight', color: GroceryTheme.textDark),
        if (product.priceStatus == 'FROZEN')
          const _Pill(label: 'Price frozen by platform', color: GroceryTheme.accentRose),
        if (!product.canAddToCart)
          _Pill(
            label: product.isAvailable ? 'Out of stock' : 'Not listed right now',
            color: GroceryTheme.textMuted,
          ),
      ],
    );
  }
}

class _TitleBlock extends StatelessWidget {
  const _TitleBlock({required this.product});

  final GroceryProduct product;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          product.name,
          style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w900, color: GroceryTheme.textDark),
        ),
        if (product.sizeLabel.isNotEmpty) ...<Widget>[
          const SizedBox(height: 4),
          Text(
            product.sizeLabel,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: GroceryTheme.textMuted),
          ),
        ],
      ],
    );
  }
}

class _PriceRow extends StatelessWidget {
  const _PriceRow({required this.product});

  final GroceryProduct product;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.baseline,
          textBaseline: TextBaseline.alphabetic,
          children: <Widget>[
            Text(
              product.priceLabel,
              style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w900, color: GroceryTheme.primaryGreenDark),
            ),
            if (product.hasDiscount) ...<Widget>[
              const SizedBox(width: 10),
              Flexible(
                child: Text(
                  'MRP ${product.mrpLabel}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 14,
                    decoration: TextDecoration.lineThrough,
                    color: GroceryTheme.textMuted,
                  ),
                ),
              ),
            ],
          ],
        ),
        if (product.savings > 0) ...<Widget>[
          const SizedBox(height: 2),
          Text(
            'You save ${formatRupees(product.savings)} against MRP',
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: GroceryTheme.primaryGreenDark),
          ),
        ],
      ],
    );
  }
}

class _DetailActionBar extends ConsumerWidget {
  const _DetailActionBar({required this.product});

  final GroceryProduct product;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final quantity = ref.watch(groceryCartProvider.select((s) => s.quantityOf(product.id)));
    final showBar = ref.watch(
      groceryCartProvider.select((GroceryCartState c) => c.totalQuantity > 0),
    );

    return Container(
      padding: const EdgeInsets.all(NabinSpacing.md),
      decoration: const BoxDecoration(
        color: GroceryTheme.surfaceWhite,
        border: Border(top: BorderSide(color: GroceryTheme.borderLight)),
      ),
      child: SafeArea(
        child: Row(
          children: <Widget>[
            Expanded(child: GroceryAddControl(product: product, compact: false)),
            if (showBar && quantity > 0) ...<Widget>[
              const SizedBox(width: NabinSpacing.sm),
              SizedBox(
                width: 132,
                height: 48,
                child: ElevatedButton(
                  onPressed: () => GroceryCartSheet.show(context),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: GroceryTheme.textDark,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: NabinRadius.control),
                  ),
                  child: const Text('View basket', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13)),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Fact {
  const _Fact(this.label, this.value, this.icon);

  final String label;
  final String value;
  final IconData icon;
}

class _FactRow extends StatelessWidget {
  const _FactRow({required this.fact});

  final _Fact fact;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: NabinSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(fact.icon, size: 16, color: GroceryTheme.primaryGreenDark),
          const SizedBox(width: NabinSpacing.sm),
          SizedBox(
            width: 92,
            child: Text(fact.label, style: const TextStyle(fontSize: 12, color: GroceryTheme.textMuted)),
          ),
          Expanded(
            child: Text(
              fact.value,
              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: GroceryTheme.textDark),
            ),
          ),
        ],
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w900, color: color),
      ),
    );
  }
}
