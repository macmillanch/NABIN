import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/nabin_tokens.dart';
import '../models/grocery_product.dart';
import '../theme/grocery_theme.dart';

/// Honest placeholder tiles for the first load of a product list.
class GrocerySkeletonGrid extends StatelessWidget {
  const GrocerySkeletonGrid({
    super.key,
    this.tileCount = 4,
    this.crossAxisCount = 2,
    this.aspectRatio = 0.68,
  });

  final int tileCount;
  final int crossAxisCount;
  final double aspectRatio;

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      padding: EdgeInsets.zero,
      itemCount: tileCount,
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: crossAxisCount,
        childAspectRatio: aspectRatio,
        crossAxisSpacing: NabinSpacing.sm,
        mainAxisSpacing: NabinSpacing.sm,
      ),
      itemBuilder: (BuildContext context, int index) => Container(
        decoration: BoxDecoration(
          color: GroceryTheme.surfaceElevated,
          borderRadius: NabinRadius.card,
          border: Border.all(color: GroceryTheme.borderLight),
        ),
        child: const Center(
          child: SizedBox(
            width: 22,
            height: 22,
            child: CircularProgressIndicator(
              strokeWidth: 2.4,
              color: GroceryTheme.primaryGreenDark,
            ),
          ),
        ),
      ),
    );
  }
}

/// Single message surface for the empty and error states of every grocery list.
class GroceryNotice extends StatelessWidget {
  const GroceryNotice({
    super.key,
    required this.title,
    this.message,
    this.icon = Icons.shopping_basket_outlined,
    this.actionLabel,
    this.onAction,
    this.iconColor,
  });

  final String title;
  final String? message;
  final IconData icon;
  final String? actionLabel;
  final VoidCallback? onAction;
  final Color? iconColor;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: NabinSpacing.xl,
        vertical: NabinSpacing.xxl,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Container(
            padding: const EdgeInsets.all(NabinSpacing.lg),
            decoration: const BoxDecoration(
              color: GroceryTheme.surfaceElevated,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 34, color: iconColor ?? GroceryTheme.textMuted),
          ),
          const SizedBox(height: NabinSpacing.md),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w900,
              color: GroceryTheme.textDark,
            ),
          ),
          if (message != null) ...<Widget>[
            const SizedBox(height: 6),
            Text(
              message!,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 12.5,
                color: GroceryTheme.textMuted,
                height: 1.4,
              ),
            ),
          ],
          if (actionLabel != null && onAction != null) ...<Widget>[
            const SizedBox(height: NabinSpacing.md),
            ElevatedButton.icon(
              onPressed: onAction,
              icon: const Icon(Icons.refresh_rounded, size: 18),
              label: Text(actionLabel!),
              style: ElevatedButton.styleFrom(
                backgroundColor: GroceryTheme.primaryGreenDark,
                foregroundColor: Colors.white,
                minimumSize: const Size(150, 44),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Shown when a background refresh failed or is running while the previous
/// results stay on screen, so stale data is never presented as current.
class GroceryRefreshBanner extends StatelessWidget {
  const GroceryRefreshBanner({
    super.key,
    required this.message,
    this.onRetry,
    this.busy = false,
  });

  final String message;
  final VoidCallback? onRetry;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: NabinSpacing.sm),
      padding: const EdgeInsets.symmetric(
        horizontal: NabinSpacing.md,
        vertical: NabinSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: GroceryTheme.surfaceElevated,
        borderRadius: NabinRadius.control,
        border: Border.all(color: GroceryTheme.borderLight),
      ),
      child: Row(
        children: <Widget>[
          Icon(
            busy ? Icons.update_rounded : Icons.error_outline_rounded,
            size: 18,
            color: GroceryTheme.textMuted,
          ),
          const SizedBox(width: NabinSpacing.sm),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: GroceryTheme.textDark,
              ),
            ),
          ),
          if (onRetry != null)
            TextButton(
              onPressed: onRetry,
              child: const Text(
                'Retry',
                style: TextStyle(fontWeight: FontWeight.w900),
              ),
            ),
        ],
      ),
    );
  }
}

/// Turns whatever the HTTP layer threw into a sentence a customer can read.
String describeGroceryAsyncError(Object? error) {
  final String text = error?.toString().trim() ?? '';
  if (text.isEmpty) return 'Something went wrong on the way to the store.';
  if (text.contains('SocketException') || text.contains('Failed to connect')) {
    return 'No connection to NABIN right now. Check your network and try again.';
  }
  if (text == 'TimeoutException') {
    return 'The store took too long to answer. Try again.';
  }
  return text.startsWith('Exception: ') ? text.substring('Exception: '.length) : text;
}

/// The four required states — loading, error with retry, empty, data — for any
/// product list fed by an [AsyncValue]. The caller only supplies the data view.
class GroceryProductsView extends StatelessWidget {
  const GroceryProductsView({
    super.key,
    required this.state,
    required this.onRetry,
    required this.builder,
    required this.emptyTitle,
    this.emptyMessage,
    this.emptyIcon = Icons.shopping_basket_outlined,
    this.crossAxisCount = 2,
    this.aspectRatio = 0.68,
    this.transform,
  });

  final AsyncValue<List<GroceryProduct>> state;
  final VoidCallback onRetry;
  final Widget Function(BuildContext context, List<GroceryProduct> products) builder;
  final String emptyTitle;
  final String? emptyMessage;
  final IconData emptyIcon;
  final int crossAxisCount;
  final double aspectRatio;

  /// Optional subset of the loaded rows (for example the discounted ones). The
  /// loading / error flags of [state] still drive the other three states.
  final List<GroceryProduct> Function(List<GroceryProduct> products)? transform;

  @override
  Widget build(BuildContext context) {
    final List<GroceryProduct> loaded = state.valueOrNull ?? const <GroceryProduct>[];
    final List<GroceryProduct> products =
        transform == null ? loaded : transform!(loaded);

    // Nothing has arrived yet.
    if (!state.hasValue && state.isLoading) {
      return GrocerySkeletonGrid(
        crossAxisCount: crossAxisCount,
        aspectRatio: aspectRatio,
      );
    }

    // Nothing has arrived and the request failed.
    if (!state.hasValue && state.hasError) {
      return GroceryNotice(
        icon: Icons.cloud_off_rounded,
        title: 'These items could not be loaded',
        message: describeGroceryAsyncError(state.error),
        actionLabel: 'Try again',
        onAction: onRetry,
        iconColor: GroceryTheme.accentRose,
      );
    }

    // The request answered, but this list has nothing to show.
    if (products.isEmpty) {
      return GroceryNotice(
        icon: emptyIcon,
        title: emptyTitle,
        message: emptyMessage,
      );
    }

    final Widget content = builder(context, products);
    final bool refreshFailed = state.hasError;
    final bool refreshing = state.isLoading;
    if (!refreshFailed && !refreshing) return content;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        GroceryRefreshBanner(
          message: refreshFailed
              ? 'Showing the last results NABIN returned — the refresh failed.'
              : 'Updating prices from NABIN…',
          busy: !refreshFailed,
          onRetry: refreshFailed ? onRetry : null,
        ),
        content,
      ],
    );
  }
}

/// 2-column grid that sits inside an already scrolling page.
class GroceryProductsGrid extends StatelessWidget {
  const GroceryProductsGrid({
    super.key,
    required this.products,
    required this.tileBuilder,
    this.crossAxisCount = 2,
    this.aspectRatio = 0.68,
    this.scrollable = false,
  });

  final List<GroceryProduct> products;
  final Widget Function(BuildContext context, GroceryProduct product) tileBuilder;
  final int crossAxisCount;
  final double aspectRatio;
  final bool scrollable;

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: !scrollable,
      physics: scrollable
          ? const ClampingScrollPhysics()
          : const NeverScrollableScrollPhysics(),
      padding: EdgeInsets.zero,
      itemCount: products.length,
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: crossAxisCount,
        childAspectRatio: aspectRatio,
        crossAxisSpacing: NabinSpacing.sm,
        mainAxisSpacing: NabinSpacing.sm,
      ),
      itemBuilder: (BuildContext context, int index) =>
          tileBuilder(context, products[index]),
    );
  }
}
