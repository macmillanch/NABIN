import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/nabin_tokens.dart';
import '../models/grocery_product.dart';
import '../providers/grocery_cart_provider.dart';
import '../screens/grocery_checkout_screen.dart';
import '../theme/grocery_theme.dart';
import 'grocery_state_views.dart';
import 'grocery_product_tile.dart';

/// Sticky basket bar shared by the browsing screens.
class GroceryCartBar extends ConsumerWidget {
  const GroceryCartBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final GroceryCartState cart = ref.watch(groceryCartProvider);
    if (cart.isEmpty) return const SizedBox.shrink();

    return Positioned(
      left: NabinSpacing.lg,
      right: NabinSpacing.lg,
      bottom: NabinSpacing.md,
      child: GestureDetector(
        onTap: () => GroceryCartSheet.show(context),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: NabinSpacing.md, vertical: NabinSpacing.sm + 2),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: <Color>[GroceryTheme.primaryGreenDark, NabinColor.success],
            ),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: <Widget>[
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Text(
                    '${cart.totalQuantity} item${cart.totalQuantity == 1 ? '' : 's'} in basket',
                    style: const TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w900,
                      color: Colors.white70,
                      letterSpacing: 0.6,
                    ),
                  ),
                  Text(
                    formatRupees(cart.subtotal),
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w900,
                      color: Colors.white,
                    ),
                  ),
                ],
              ),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  const Text(
                    'VIEW BASKET',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w900,
                      fontSize: 13,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.22),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.arrow_forward_rounded,
                      color: Colors.white,
                      size: 16,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Pushes the real checkout with the live basket: line items carry the product
/// ids, names and server prices the basket actually holds.
void pushGroceryCheckout(BuildContext context, GroceryCartState cart) {
  if (cart.checkoutLines.isEmpty) return;
  Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (BuildContext context) => GroceryCheckoutScreen(
        cartItems: cart.checkoutLines,
        subtotal: cart.subtotalRupees,
      ),
    ),
  );
}

/// Basket sheet over the browsing screens.
class GroceryCartSheet extends ConsumerWidget {
  const GroceryCartSheet({super.key});

  static Future<void> show(BuildContext context) => showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        backgroundColor: GroceryTheme.surfaceWhite,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(NabinRadius.xl)),
        ),
        builder: (BuildContext context) => const GroceryCartSheet(),
      );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final GroceryCartState cart = ref.watch(groceryCartProvider);
    final GroceryCartNotifier notifier = ref.read(groceryCartProvider.notifier);

    return Padding(
      padding: EdgeInsets.only(
        left: NabinSpacing.lg,
        right: NabinSpacing.lg,
        top: NabinSpacing.md,
        bottom: MediaQuery.viewInsetsOf(context).bottom + NabinSpacing.lg,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: <Widget>[
              Text(
                cart.isEmpty ? 'Your basket' : '${cart.totalQuantity} items in your basket',
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w900,
                  color: GroceryTheme.textDark,
                ),
              ),
              if (!cart.isEmpty)
                TextButton(
                  onPressed: notifier.clear,
                  child: const Text('Empty', style: TextStyle(fontWeight: FontWeight.w800)),
                ),
            ],
          ),
          const Divider(height: NabinSpacing.lg, color: GroceryTheme.borderLight),
          if (cart.isEmpty)
            const GroceryNotice(
              icon: Icons.shopping_bag_outlined,
              title: 'Nothing in the basket yet',
              message: 'Add products from the aisles below and they will show up here.',
            )
          else ...<Widget>[
            _PriceCheckBanner(cart: cart, onRetry: notifier.revalidatePrices),
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 260),
              child: ListView.separated(
                shrinkWrap: true,
                padding: EdgeInsets.zero,
                itemCount: cart.items.length,
                separatorBuilder: (BuildContext context, int index) =>
                    const Divider(height: NabinSpacing.lg, color: GroceryTheme.borderLight),
                itemBuilder: (BuildContext context, int index) {
                  final GroceryCartItem line = cart.items[index];
                  final bool unlisted = cart.unlistedIds.contains(line.productId);
                  return Row(
                    children: <Widget>[
                      Container(
                        width: 38,
                        height: 38,
                        decoration: BoxDecoration(
                          color: line.tileColor ?? GroceryTheme.primaryGreenLight,
                          borderRadius: NabinRadius.control,
                        ),
                        child: Center(child: Text(line.emoji, style: const TextStyle(fontSize: 18))),
                      ),
                      const SizedBox(width: NabinSpacing.sm),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              line.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 13,
                                color: GroceryTheme.textDark,
                              ),
                            ),
                            Text(
                              unlisted
                                  ? 'No longer listed by the store'
                                  : '${line.sizeLabel.isEmpty ? '' : '${line.sizeLabel} • '}${formatRupees(line.unitPrice)} each',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 11,
                                color: unlisted ? GroceryTheme.accentRose : GroceryTheme.textMuted,
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (unlisted)
                        TextButton(
                          onPressed: () => notifier.remove(line.productId),
                          child: const Text('Remove', style: TextStyle(fontWeight: FontWeight.w800)),
                        )
                      else
                        SizedBox(
                          width: 96,
                          child: GroceryLineStepper(line: line),
                        ),
                      SizedBox(
                        width: 62,
                        child: Text(
                          formatRupees(line.lineTotal),
                          textAlign: TextAlign.right,
                          style: const TextStyle(
                            fontWeight: FontWeight.w900,
                            fontSize: 13,
                            color: GroceryTheme.textDark,
                          ),
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
            const Divider(height: NabinSpacing.lg, color: GroceryTheme.borderLight),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: <Widget>[
                const Text(
                  'Items total',
                  style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: GroceryTheme.textDark),
                ),
                Text(
                  formatRupees(cart.subtotal),
                  style: const TextStyle(
                    fontWeight: FontWeight.w900,
                    fontSize: 18,
                    color: GroceryTheme.primaryGreenDark,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            const Text(
              'Delivery, handling and any store coupon are itemised at checkout.',
              style: TextStyle(fontSize: 11, color: GroceryTheme.textMuted),
            ),
            const SizedBox(height: NabinSpacing.md),
            SizedBox(
              width: double.infinity,
              height: 52,
              child: ElevatedButton(
                onPressed: cart.checkoutBlocked || cart.checkoutLines.isEmpty
                    ? null
                    : () {
                        Navigator.pop(context);
                        pushGroceryCheckout(context, cart);
                      },
                style: ElevatedButton.styleFrom(
                  backgroundColor: GroceryTheme.primaryGreenDark,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                ),
                child: Text(
                  cart.checkoutBlocked
                      ? 'Remove unlisted items to continue'
                      : 'Review & pay ${formatRupees(cart.subtotal)}',
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _PriceCheckBanner extends StatelessWidget {
  const _PriceCheckBanner({required this.cart, required this.onRetry});

  final GroceryCartState cart;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final GroceryPriceCheck check = cart.priceCheck;

    if (cart.unlistedIds.isNotEmpty) {
      return Padding(
        padding: const EdgeInsets.only(bottom: NabinSpacing.sm),
        child: GroceryRefreshBanner(
          message: '${cart.unlistedIds.length} item(s) are no longer listed by the store.',
        ),
      );
    }

    switch (check.status) {
      case GroceryPriceRevalidationStatus.working:
        return const Padding(
          padding: EdgeInsets.only(bottom: NabinSpacing.sm),
          child: GroceryRefreshBanner(message: 'Checking today\'s prices with the store…', busy: true),
        );
      case GroceryPriceRevalidationStatus.failed:
        return Padding(
          padding: const EdgeInsets.only(bottom: NabinSpacing.sm),
          child: GroceryRefreshBanner(
            message: 'Prices could not be re-checked, so they are the ones shown when you added them.',
            onRetry: onRetry,
          ),
        );
      case GroceryPriceRevalidationStatus.done:
        if (cart.changedIds.isEmpty) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.only(bottom: NabinSpacing.sm),
          child: GroceryRefreshBanner(
            message: '${cart.changedIds.length} price(s) changed at the store and are now updated here.',
          ),
        );
      case GroceryPriceRevalidationStatus.idle:
        return const SizedBox.shrink();
    }
  }
}
