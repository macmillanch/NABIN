import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/nabin_tokens.dart';
import '../models/grocery_product.dart';
import '../providers/grocery_cart_provider.dart';
import '../theme/grocery_theme.dart';
import 'grocery_product_detail_modal.dart';

/// ADD button that becomes a quantity stepper, driven by the live cart.
class GroceryAddControl extends ConsumerWidget {
  const GroceryAddControl({
    super.key,
    required this.product,
    this.compact = true,
    this.onAdded,
  });

  final GroceryProduct product;
  final bool compact;

  /// Optional host callback (the router uses it for a snackbar); the basket
  /// itself is always updated by the cart provider.
  final void Function(String productName)? onAdded;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final int quantity =
        ref.watch(groceryCartProvider.select((GroceryCartState s) => s.quantityOf(product.id)));
    final GroceryCartNotifier cart = ref.read(groceryCartProvider.notifier);

    void addOne() {
      cart.add(product);
      onAdded?.call(product.name);
    }

    if (!product.canAddToCart) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        decoration: BoxDecoration(
          color: GroceryTheme.surfaceElevated,
          borderRadius: NabinRadius.control,
          border: Border.all(color: GroceryTheme.borderLight),
        ),
        child: Text(
          product.isAvailable ? 'Out of stock' : 'Not listed',
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w900,
            color: GroceryTheme.textMuted,
          ),
        ),
      );
    }

    if (quantity == 0) {
      return ElevatedButton(
        onPressed: addOne,
        style: ElevatedButton.styleFrom(
          backgroundColor: GroceryTheme.primaryGreenDark,
          foregroundColor: Colors.white,
          elevation: 0,
          minimumSize: compact ? const Size(58, 32) : const Size(120, 44),
          maximumSize: compact ? null : const Size(double.infinity, 52),
          padding: const EdgeInsets.symmetric(horizontal: 10),
          shape: RoundedRectangleBorder(borderRadius: NabinRadius.control),
        ),
        child: const Text('ADD', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w900)),
      );
    }

    return Container(
      height: compact ? 32 : 44,
      decoration: BoxDecoration(
        color: GroceryTheme.primaryGreenDark,
        borderRadius: NabinRadius.control,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          _StepButton(
            icon: Icons.remove_rounded,
            onTap: () => cart.setQuantity(product.id, quantity - 1),
          ),
          Text(
            '$quantity',
            style: TextStyle(
              fontSize: compact ? 12 : 15,
              fontWeight: FontWeight.w900,
              color: Colors.white,
            ),
          ),
          _StepButton(
            icon: Icons.add_rounded,
            onTap: () => cart.setQuantity(product.id, quantity + 1),
          ),
        ],
      ),
    );
  }
}

class _StepButton extends StatelessWidget {
  const _StepButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: NabinRadius.control,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
        child: Icon(icon, size: 15, color: Colors.white),
      ),
    );
  }
}

/// Quantity stepper for a basket line, driven by the cart provider.
class GroceryLineStepper extends ConsumerWidget {
  const GroceryLineStepper({super.key, required this.line});

  final GroceryCartItem line;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final GroceryCartNotifier cart = ref.read(groceryCartProvider.notifier);
    return Container(
      height: 32,
      decoration: BoxDecoration(
        color: GroceryTheme.primaryGreenDark,
        borderRadius: NabinRadius.control,
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: <Widget>[
          InkWell(
            borderRadius: NabinRadius.control,
            onTap: () => cart.setQuantity(line.productId, line.quantity - 1),
            child: const Padding(
              padding: EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              child: Icon(Icons.remove_rounded, size: 14, color: Colors.white),
            ),
          ),
          Text(
            '${line.quantity}',
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: Colors.white),
          ),
          InkWell(
            borderRadius: NabinRadius.control,
            onTap: () => cart.setQuantity(line.productId, line.quantity + 1),
            child: const Padding(
              padding: EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              child: Icon(Icons.add_rounded, size: 14, color: Colors.white),
            ),
          ),
        ],
      ),
    );
  }
}

/// Blinkit-density catalogue card: artwork, discount, size, name, price, ADD.
/// Everything on it comes from one `GET /grocery/products` row.
class GroceryProductTile extends StatelessWidget {
  const GroceryProductTile({
    super.key,
    required this.product,
    this.showSource = false,
    this.onAdded,
  });

  final GroceryProduct product;
  final bool showSource;
  final void Function(String productName)? onAdded;

  @override
  Widget build(BuildContext context) {
    final int discount = product.discountPercent;

    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: GroceryTheme.surfaceWhite,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: GroceryTheme.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => GroceryProductDetailModal.show(context: context, product: product),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: Container(
                  width: double.infinity,
                  color: product.artworkBackground,
                  child: Stack(
                    fit: StackFit.expand,
                    children: <Widget>[
                      // Artwork is the server emoji on the server tile colour,
                      // with the catalogue photo on top when the row has one.
                      if (product.imageUrl != null)
                        Image.network(
                          product.imageUrl!,
                          fit: BoxFit.cover,
                          // A dead URL leaves the emoji underneath, not an empty frame.
                          errorBuilder: (context, error, stackTrace) =>
                              const SizedBox.shrink(),
                        ),
                      Center(
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          child: Text(
                            product.emoji,
                            style: const TextStyle(fontSize: 44),
                          ),
                        ),
                      ),
                      if (discount > 0)
                        Positioned(
                          top: 6,
                          left: 6,
                          child: _Badge(
                            label: '$discount% OFF',
                            background: GroceryTheme.primaryGreenDark,
                          ),
                        ),
                      if (!product.canAddToCart)
                        Positioned(
                          bottom: 6,
                          left: 6,
                          child: _Badge(
                            label: product.isAvailable ? 'OUT OF STOCK' : 'NOT LISTED',
                            background: GroceryTheme.textDark.withValues(alpha: 0.78),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
          if (product.sizeLabel.isNotEmpty)
            Text(
              product.sizeLabel,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 10,
                color: GroceryTheme.textMuted,
                fontWeight: FontWeight.w600,
              ),
            ),
          Text(
            product.name,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w800,
              color: GroceryTheme.textDark,
            ),
          ),
          if (showSource && product.sourceLabel.isNotEmpty) ...<Widget>[
            const SizedBox(height: 2),
            Text(
              product.sourceLabel,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 9.5,
                fontWeight: FontWeight.w700,
                color: GroceryTheme.textMuted,
              ),
            ),
          ],
          const SizedBox(height: 6),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              Flexible(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(
                      product.priceLabel,
                      style: const TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w900,
                        color: GroceryTheme.textDark,
                      ),
                    ),
                    if (product.hasDiscount)
                      Text(
                        product.mrpLabel,
                        style: const TextStyle(
                          fontSize: 10,
                          color: GroceryTheme.textMuted,
                          decoration: TextDecoration.lineThrough,
                        ),
                      ),
                  ],
                ),
              ),
              GroceryAddControl(product: product, onAdded: onAdded),
            ],
          ),
        ],
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.label, required this.background});

  final String label;
  final Color background;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: const TextStyle(
          fontSize: 8.5,
          fontWeight: FontWeight.w900,
          color: Colors.white,
        ),
      ),
    );
  }
}
