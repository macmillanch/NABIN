import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/nabin_tokens.dart';
import '../models/grocery_product.dart';
import '../providers/grocery_cart_provider.dart';
import '../theme/grocery_theme.dart';
import '../widgets/grocery_cart_sheet.dart';
import '../widgets/grocery_product_tile.dart';
import '../widgets/grocery_state_views.dart';

/// Basket screen. The three demo lines that used to be hard-coded here
/// (`c1/c2/c3` bananas, milk, tomatoes) are replaced by the live cart, whose
/// entries are copies of real `GET /grocery/products` rows, and the prices are
/// re-checked against `POST /grocery/cart/revalidate` when the screen opens.
class GroceryCartScreen extends ConsumerStatefulWidget {
  const GroceryCartScreen({super.key});

  @override
  ConsumerState<GroceryCartScreen> createState() => _GroceryCartScreenState();
}

class _GroceryCartScreenState extends ConsumerState<GroceryCartScreen> {
  // No customer-address read path is exposed to this feature, so the delivery
  // address stays a local choice until one exists.
  String _selectedAddress = 'Civil Lines, Delhi • Flat 402';
  int _selectedTip = 20;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _revalidatePrices());
  }

  void _revalidatePrices() {
    if (!mounted) return;
    ref.read(groceryCartProvider.notifier).revalidatePrices();
  }

  @override
  Widget build(BuildContext context) {
    final GroceryCartState cart = ref.watch(groceryCartProvider);
    final GroceryCartNotifier notifier = ref.read(groceryCartProvider.notifier);
    // No handling/packing charge is exposed to the customer app, so the basket
    // shows live item prices plus the optional tip; the store confirms the rest.
    final int subtotal = cart.subtotalRupees;
    final int total = subtotal + _selectedTip;

    return Scaffold(
      backgroundColor: GroceryTheme.bgOffWhite,
      appBar: AppBar(
        backgroundColor: GroceryTheme.surfaceWhite,
        elevation: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text(
              'Your grocery basket',
              style: TextStyle(
                fontWeight: FontWeight.w900,
                fontSize: 18,
                color: GroceryTheme.textDark,
              ),
            ),
            Text(
              cart.isEmpty
                  ? 'Nothing selected yet'
                  : '${cart.totalQuantity} item(s) • ${formatRupees(cart.subtotal)}',
              style: const TextStyle(fontSize: 11, color: GroceryTheme.textMuted),
            ),
          ],
        ),
        actions: <Widget>[
          if (!cart.isEmpty)
            IconButton(
              tooltip: 'Empty basket',
              icon: const Icon(Icons.delete_sweep_outlined, color: GroceryTheme.textMuted),
              onPressed: notifier.clear,
            ),
        ],
      ),
      body: cart.isEmpty
          ? Center(
              child: GroceryNotice(
                icon: Icons.shopping_bag_outlined,
                title: 'Your grocery basket is empty',
                message: 'Browse the aisles and add what you need — prices come straight from the store.',
                actionLabel: 'Browse products',
                onAction: () => context.go('/grocery-home'),
              ),
            )
          : SingleChildScrollView(
              padding: const EdgeInsets.all(NabinSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  if (cart.unlistedIds.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: NabinSpacing.sm),
                      child: GroceryRefreshBanner(
                        message: '${cart.unlistedIds.length} item(s) are no longer listed by the store. Remove them to continue.',
                      ),
                    )
                  else if (cart.changedIds.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: NabinSpacing.sm),
                      child: GroceryRefreshBanner(
                        message: '${cart.changedIds.length} price(s) were updated by the store and are reflected below.',
                      ),
                    )
                  else if (cart.priceCheck.status ==
                      GroceryPriceRevalidationStatus.failed)
                    Padding(
                      padding: const EdgeInsets.only(bottom: NabinSpacing.sm),
                      child: GroceryRefreshBanner(
                        message: 'Prices could not be re-checked with the store.',
                        onRetry: _revalidatePrices,
                      ),
                    )
                  else if (cart.priceCheck.status ==
                      GroceryPriceRevalidationStatus.working)
                    const Padding(
                      padding: EdgeInsets.only(bottom: NabinSpacing.sm),
                      child: GroceryRefreshBanner(
                        message: 'Checking today\'s prices with the store…',
                        busy: true,
                      ),
                    ),

                  // Delivery address
                  Container(
                    padding: const EdgeInsets.all(NabinSpacing.md + 2),
                    decoration: BoxDecoration(
                      color: GroceryTheme.surfaceWhite,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: GroceryTheme.borderLight),
                    ),
                    child: Row(
                      children: <Widget>[
                        Container(
                          padding: const EdgeInsets.all(NabinSpacing.xs + 2),
                          decoration: BoxDecoration(
                            color: GroceryTheme.primaryGreenLight,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.location_on_rounded,
                              color: GroceryTheme.primaryGreenDark, size: 20),
                        ),
                        const SizedBox(width: NabinSpacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              const Text(
                                'Delivering to',
                                style: TextStyle(
                                  fontSize: 11,
                                  color: GroceryTheme.textMuted,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              Text(
                                _selectedAddress,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w900,
                                  fontSize: 13.5,
                                  color: GroceryTheme.textDark,
                                ),
                              ),
                            ],
                          ),
                        ),
                        TextButton(
                          onPressed: _showAddressPicker,
                          child: const Text(
                            'Change',
                            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: NabinSpacing.lg),

                  const Text(
                    'Basket items',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: GroceryTheme.textDark),
                  ),
                  const SizedBox(height: NabinSpacing.sm),

                  for (final GroceryCartItem line in cart.items)
                    _CartRow(
                      line: line,
                      unlisted: cart.unlistedIds.contains(line.productId),
                      onRemove: notifier.remove,
                    ),

                  const SizedBox(height: NabinSpacing.md),

                  // Delivery partner tip
                  const Text(
                    'Delivery partner tip',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: GroceryTheme.textDark),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Optional, and paid on to the rider with this order',
                    style: TextStyle(fontSize: 11, color: GroceryTheme.textMuted),
                  ),
                  const SizedBox(height: NabinSpacing.sm),
                  Row(
                    children: <int>[0, 10, 20, 30, 50].map((int tip) {
                      final bool selected = _selectedTip == tip;
                      return Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: GestureDetector(
                            onTap: () => setState(() => _selectedTip = tip),
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: 9),
                              decoration: BoxDecoration(
                                color: selected ? GroceryTheme.primaryGreenDark : GroceryTheme.surfaceWhite,
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                  color: selected
                                      ? GroceryTheme.primaryGreenDark
                                      : GroceryTheme.borderLight,
                                ),
                              ),
                              child: Center(
                                child: Text(
                                  tip == 0 ? 'No tip' : formatRupees(tip.toDouble()),
                                  style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 11.5,
                                    color: selected ? Colors.white : GroceryTheme.textDark,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: NabinSpacing.xl),

                  // Bill summary
                  Container(
                    padding: const EdgeInsets.all(NabinSpacing.md),
                    decoration: BoxDecoration(
                      color: GroceryTheme.surfaceWhite,
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: GroceryTheme.borderLight),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        const Text(
                          'Bill summary',
                          style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: GroceryTheme.textDark),
                        ),
                        const SizedBox(height: NabinSpacing.sm),
                        _billRow('Items subtotal', formatRupees(cart.subtotal)),
                        const SizedBox(height: 6),
                        _billRow('Delivery fee', 'Set by the store'),
                        if (_selectedTip > 0) ...<Widget>[
                          const SizedBox(height: 6),
                          _billRow('Delivery partner tip', formatRupees(_selectedTip.toDouble())),
                        ],
                        const Divider(height: NabinSpacing.xl),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: <Widget>[
                            const Text(
                              'To pay',
                              style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: GroceryTheme.textDark),
                            ),
                            Text(
                              formatRupees(total.toDouble()),
                              style: const TextStyle(
                                fontWeight: FontWeight.w900,
                                fontSize: 20,
                                color: GroceryTheme.primaryGreenDark,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        const Text(
                          'The store confirms the final amount at checkout.',
                          style: TextStyle(fontSize: 11, color: GroceryTheme.textMuted),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: NabinSpacing.xxl),

                  ElevatedButton(
                    onPressed: cart.checkoutBlocked
                        ? null
                        : () => pushGroceryCheckout(context, cart),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: GroceryTheme.primaryGreenDark,
                      foregroundColor: Colors.white,
                      minimumSize: const Size(double.infinity, 54),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    ),
                    child: Text(
                      cart.checkoutBlocked
                          ? 'Remove unlisted items to continue'
                          : '${formatRupees(total.toDouble())} • Place order',
                      style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15),
                    ),
                  ),
                  const SizedBox(height: NabinSpacing.xxl),
                ],
              ),
            ),
    );
  }

  Widget _billRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: <Widget>[
        Text(label, style: const TextStyle(fontSize: 12.5, color: GroceryTheme.textMuted)),
        Text(
          value,
          style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold, color: GroceryTheme.textDark),
        ),
      ],
    );
  }

  void _showAddressPicker() {
    final List<String> addresses = <String>[
      'Civil Lines, Delhi • Flat 402',
      'Connaught Place, Delhi • Block B Office',
      'Kamla Nagar Market, Delhi • Shop 14',
    ];

    showModalBottomSheet<void>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(NabinRadius.xl)),
      ),
      builder: (BuildContext ctx) => Padding(
        padding: const EdgeInsets.all(NabinSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                const Expanded(
                  child: Text(
                    'Select delivery address',
                    style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16),
                  ),
                ),
                TextButton(
                  onPressed: _revalidatePrices,
                  child: const Text('Re-check prices', style: TextStyle(fontSize: 12)),
                ),
              ],
            ),
            const SizedBox(height: NabinSpacing.sm),
            for (final String address in addresses)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.location_on_rounded, color: GroceryTheme.primaryGreenDark),
                title: Text(
                  address,
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                ),
                onTap: () {
                  setState(() => _selectedAddress = address);
                  Navigator.pop(ctx);
                },
              ),
          ],
        ),
      ),
    );
  }
}

class _CartRow extends StatelessWidget {
  const _CartRow({
    required this.line,
    required this.unlisted,
    required this.onRemove,
  });

  final GroceryCartItem line;
  final bool unlisted;
  final void Function(String productId) onRemove;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: NabinSpacing.sm),
      padding: const EdgeInsets.all(NabinSpacing.sm + 2),
      decoration: BoxDecoration(
        color: GroceryTheme.surfaceWhite,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: GroceryTheme.borderLight),
      ),
      child: Row(
        children: <Widget>[
          Container(
            width: 50,
            height: 50,
            decoration: BoxDecoration(
              color: line.tileColor ?? GroceryTheme.primaryGreenLight,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Center(child: Text(line.emoji, style: const TextStyle(fontSize: 26))),
          ),
          const SizedBox(width: NabinSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  line.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                    color: GroceryTheme.textDark,
                  ),
                ),
                Text(
                  unlisted
                      ? 'No longer listed by the store'
                      : '${line.sizeLabel.isEmpty ? '' : '${line.sizeLabel} • '}${formatRupees(line.unitPrice)} each',
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
              onPressed: () => onRemove(line.productId),
              child: const Text('Remove', style: TextStyle(fontWeight: FontWeight.w800)),
            )
          else
            SizedBox(
              width: 100,
              child: GroceryLineStepper(line: line),
            ),
          const SizedBox(width: NabinSpacing.sm),
          SizedBox(
            width: 66,
            child: Text(
              formatRupees(line.lineTotal),
              textAlign: TextAlign.right,
              style: const TextStyle(
                fontWeight: FontWeight.w900,
                fontSize: 14,
                color: GroceryTheme.textDark,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
