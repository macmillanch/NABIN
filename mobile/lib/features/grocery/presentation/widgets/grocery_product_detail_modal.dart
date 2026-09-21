import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/nabin_tokens.dart';
import '../models/grocery_product.dart';
import '../providers/grocery_cart_provider.dart';
import '../theme/grocery_theme.dart';
import 'grocery_product_tile.dart';

/// Product sheet for one `GET /grocery/products` row.
///
/// Removed from the previous version because the backend has no data for them:
/// the multi-angle image gallery (no image URL on a grocery product), the
/// star rating and review count, the favourites and save-for-later toggles
/// (nothing persists them), the express-delivery ETA badge and the
/// "sourced from Azadpur Mandi / DarkStore #84" guarantee copy.
class GroceryProductDetailModal extends ConsumerStatefulWidget {
  const GroceryProductDetailModal({super.key, required this.product});

  final GroceryProduct product;

  static Future<void> show({
    required BuildContext context,
    required GroceryProduct product,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (BuildContext context) =>
          GroceryProductDetailModal(product: product),
    );
  }

  @override
  ConsumerState<GroceryProductDetailModal> createState() =>
      _GroceryProductDetailModalState();
}

class _GroceryProductDetailModalState
    extends ConsumerState<GroceryProductDetailModal> {
  GroceryProduct get _product => widget.product;

  void _setQuantity(int quantity) {
    ref.read(groceryCartProvider.notifier).setQuantity(_product.id, quantity);
  }

  @override
  Widget build(BuildContext context) {
    final GroceryProduct product = _product;
    final int quantity =
        ref.watch(groceryCartProvider.select((GroceryCartState s) => s.quantityOf(product.id)));
    final int discount = product.discountPercent;
    final double? previous = product.previousPrice;

    return Container(
      height: MediaQuery.sizeOf(context).height * 0.82,
      decoration: const BoxDecoration(
        color: GroceryTheme.surfaceWhite,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: Column(
        children: <Widget>[
          const SizedBox(height: 12),
          Container(
            width: 48,
            height: 5,
            decoration: BoxDecoration(
              color: GroceryTheme.borderLight,
              borderRadius: BorderRadius.circular(10),
            ),
          ),
          const SizedBox(height: 12),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: NabinSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  ClipRRect(
                    borderRadius: BorderRadius.circular(22),
                    child: Container(
                      height: 200,
                      width: double.infinity,
                      color: product.artworkBackground,
                      child: Stack(
                        fit: StackFit.expand,
                        children: <Widget>[
                          Center(
                            child: Text(product.emoji, style: const TextStyle(fontSize: 84)),
                          ),
                          if (product.imageUrl != null)
                            Image.network(
                              product.imageUrl!,
                              fit: BoxFit.cover,
                              errorBuilder: (context, error, stackTrace) =>
                                  const SizedBox.shrink(),
                            ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: NabinSpacing.md),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: <Widget>[
                      if (discount > 0)
                        _Pill(
                          label: '$discount% OFF',
                          color: GroceryTheme.primaryGreenDark,
                        ),
                      if (product.isWeightBased)
                        _Pill(
                          label: 'Priced by packed weight',
                          color: GroceryTheme.textDark,
                        ),
                      if (product.priceStatus == 'FROZEN')
                        _Pill(
                          label: 'Price frozen by platform',
                          color: GroceryTheme.accentRose,
                        ),
                      if (!product.canAddToCart)
                        _Pill(
                          label: product.isAvailable ? 'Out of stock' : 'Not listed right now',
                          color: GroceryTheme.textMuted,
                        ),
                    ],
                  ),
                  const SizedBox(height: NabinSpacing.md),
                  Text(
                    product.name,
                    style: const TextStyle(
                      fontSize: 21,
                      fontWeight: FontWeight.w900,
                      color: GroceryTheme.textDark,
                    ),
                  ),
                  if (product.sizeLabel.isNotEmpty) ...<Widget>[
                    const SizedBox(height: 4),
                    Text(
                      product.sizeLabel,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: GroceryTheme.textMuted,
                      ),
                    ),
                  ],
                  const SizedBox(height: NabinSpacing.md),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: <Widget>[
                      Text(
                        product.priceLabel,
                        style: const TextStyle(
                          fontSize: 26,
                          fontWeight: FontWeight.w900,
                          color: GroceryTheme.primaryGreenDark,
                        ),
                      ),
                      if (product.hasDiscount) ...<Widget>[
                        const SizedBox(width: 10),
                        Text(
                          'MRP ${product.mrpLabel}',
                          style: const TextStyle(
                            fontSize: 14,
                            decoration: TextDecoration.lineThrough,
                            color: GroceryTheme.textMuted,
                          ),
                        ),
                      ],
                      const Spacer(),
                      if (product.savings > 0)
                        Text(
                          'You save ${formatRupees(product.savings)}',
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w900,
                            color: GroceryTheme.primaryGreenDark,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: NabinSpacing.lg),
                  const Divider(color: GroceryTheme.borderLight, height: 1),
                  const SizedBox(height: NabinSpacing.md),
                  Text(
                    'What the store lists',
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w900,
                      color: GroceryTheme.textDark,
                    ),
                  ),
                  const SizedBox(height: NabinSpacing.sm),
                  for (final _Fact fact in _facts(product, previous))
                    _FactRow(fact: fact),
                  if (product.priceUpdatedLabel.isNotEmpty) ...<Widget>[
                    const SizedBox(height: NabinSpacing.xs),
                    Row(
                      children: <Widget>[
                        const Icon(Icons.schedule_rounded,
                            size: 14, color: GroceryTheme.textMuted),
                        const SizedBox(width: 6),
                        Text(
                          product.priceUpdatedLabel,
                          style: const TextStyle(
                            fontSize: 11.5,
                            color: GroceryTheme.textMuted,
                          ),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: NabinSpacing.xxl),
                ],
              ),
            ),
          ),
          Container(
            padding: const EdgeInsets.all(NabinSpacing.md),
            decoration: const BoxDecoration(
              color: GroceryTheme.surfaceWhite,
              borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
              border: Border(top: BorderSide(color: GroceryTheme.borderLight)),
            ),
            child: SafeArea(
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: quantity == 0
                        ? GroceryAddControl(product: product, compact: false)
                        : Row(
                            children: <Widget>[
                              SizedBox(
                                height: 44,
                                child: OutlinedButton(
                                  onPressed: () => _setQuantity(quantity - 1),
                                  style: OutlinedButton.styleFrom(
                                    side: const BorderSide(color: GroceryTheme.borderLight),
                                    shape: RoundedRectangleBorder(
                                      borderRadius: NabinRadius.control,
                                    ),
                                  ),
                                  child: const Icon(Icons.remove_rounded,
                                      size: 18, color: GroceryTheme.primaryGreenDark),
                                ),
                              ),
                              Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 14),
                                child: Text(
                                  '$quantity in basket',
                                  style: const TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w900,
                                    color: GroceryTheme.textDark,
                                  ),
                                ),
                              ),
                              Expanded(
                                child: ElevatedButton(
                                  onPressed: () => _setQuantity(quantity + 1),
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: GroceryTheme.primaryGreenDark,
                                    foregroundColor: Colors.white,
                                    minimumSize: const Size(0, 44),
                                  ),
                                  child: const Text('Add one more'),
                                ),
                              ),
                            ],
                          ),
                  ),
                  const SizedBox(width: NabinSpacing.sm),
                  SizedBox(
                    width: 108,
                    child: ElevatedButton(
                      onPressed: () {
                        if (quantity == 0) {
                          ref.read(groceryCartProvider.notifier).add(product);
                        }
                        Navigator.pop(context);
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: GroceryTheme.surfaceElevated,
                        foregroundColor: GroceryTheme.textDark,
                        minimumSize: const Size(0, 44),
                      ),
                      child: const Text('Done', style: TextStyle(fontWeight: FontWeight.w900)),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Only fields the endpoint actually returns, and only when they are present.
  List<_Fact> _facts(GroceryProduct product, double? previous) {
    final List<_Fact> facts = <_Fact>[
      if (product.merchantName != null)
        _Fact('Sold by', product.merchantName!, Icons.storefront_rounded),
      if (product.brand != null) _Fact('Brand', product.brand!, Icons.verified_rounded),
      if (product.category != null)
        _Fact('Aisle', product.category!, Icons.category_rounded),
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
      if (previous != null && (previous - product.currentPrice).abs() > 0.01)
        _Fact(
          'Price movement',
          '${formatRupees(previous)} → ${product.priceLabel}',
          Icons.trending_up_rounded,
        ),
    ];
    return facts;
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
            child: Text(
              fact.label,
              style: const TextStyle(fontSize: 12, color: GroceryTheme.textMuted),
            ),
          ),
          Expanded(
            child: Text(
              fact.value,
              style: const TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                color: GroceryTheme.textDark,
              ),
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
