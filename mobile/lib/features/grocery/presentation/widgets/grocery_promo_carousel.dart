import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/theme/nabin_tokens.dart';
import '../models/grocery_advertisement.dart';
import '../providers/grocery_advertisements_provider.dart';
import '../theme/grocery_theme.dart';

/// Sponsored campaign carousel fed by `GET /api/advertisements?slot=GROCERY_HERO_CAROUSEL`.
///
/// Every tile carries a sponsor label so paid inventory is never mistaken for
/// organic content, and the widget returns zero height while the feed is loading,
/// empty or failed — no reserved grey box. A tile only reacts to a tap when its
/// `targetCategory` matches a real product aisle, because that is the one action
/// the app can honour without a new route; external `ctaLink` targets are not
/// navigable from here and those tiles stay inert.
class GroceryPromoCarousel extends ConsumerStatefulWidget {
  const GroceryPromoCarousel({super.key, required this.categories, this.onCategoryFilter});

  /// Live aisle names, used to decide whether a campaign can filter the grid.
  final List<String> categories;

  final void Function(String category)? onCategoryFilter;

  @override
  ConsumerState<GroceryPromoCarousel> createState() => _GroceryPromoCarouselState();
}

class _GroceryPromoCarouselState extends ConsumerState<GroceryPromoCarousel> {
  static const Duration _autoScroll = Duration(seconds: 5);

  final PageController _controller = PageController();
  Timer? _timer;
  int _page = 0;
  int _adCount = 0;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(_autoScroll, _advance);
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _advance(Timer timer) {
    if (!mounted || _adCount < 2 || !_controller.hasClients) return;
    final int next = (_page + 1) % _adCount;
    _controller.animateToPage(
      next,
      duration: NabinMotion.base,
      curve: NabinMotion.curve,
    );
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<GroceryAdvertisement>> state =
        ref.watch(groceryCarouselAdsProvider);
    final List<GroceryAdvertisement> ads = state.valueOrNull ?? const <GroceryAdvertisement>[];
    _adCount = ads.length;

    // Loading, failed and empty all collapse to nothing: sponsored slots are
    // not allowed to punch a hole in the browsing page.
    if (ads.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        SizedBox(
          height: 128,
          child: PageView.builder(
            controller: _controller,
            itemCount: ads.length,
            onPageChanged: (int index) => setState(() => _page = index),
            itemBuilder: (BuildContext context, int index) => _AdTile(
              ad: ads[index],
              filterCategory: ads[index].categoryFilterIn(widget.categories),
              onTap: widget.onCategoryFilter,
            ),
          ),
        ),
        if (ads.length > 1) ...<Widget>[
          const SizedBox(height: NabinSpacing.xs),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              for (int index = 0; index < ads.length; index++)
                AnimatedContainer(
                  duration: NabinMotion.fast,
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  width: _page == index ? 18 : 6,
                  height: 6,
                  decoration: BoxDecoration(
                    color: _page == index
                        ? GroceryTheme.primaryGreenDark
                        : GroceryTheme.borderLight,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
            ],
          ),
        ],
      ],
    );
  }
}

class _AdTile extends StatelessWidget {
  const _AdTile({
    required this.ad,
    required this.filterCategory,
    this.onTap,
  });

  final GroceryAdvertisement ad;
  final String? filterCategory;
  final void Function(String category)? onTap;

  @override
  Widget build(BuildContext context) {
    final Color accent = ad.accent;
    final Color labelColor = NabinTheme.on(accent);
    final String? filter = filterCategory;
    final void Function(String category)? handler = onTap;
    // Sponsored tiles only navigate when the campaign's target category really
    // exists in the catalogue; otherwise they stay inert (no dead taps).
    final VoidCallback? press =
        (filter != null && handler != null && ad.isInteractiveInApp)
            ? () => handler(filter)
            : null;
    final bool tappable = press != null;

    return Container(
      margin: const EdgeInsets.only(right: NabinSpacing.sm),
      child: ClipRRect(
        borderRadius: NabinRadius.card,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: press,
            child: Ink(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: <Color>[
                    accent,
                    Color.alphaBlend(Colors.black.withValues(alpha: 0.26), accent),
                  ],
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.all(NabinSpacing.md),
                child: Row(
                children: <Widget>[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: <Widget>[
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.22),
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(
                              color: labelColor.withValues(alpha: 0.35),
                            ),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: <Widget>[
                              Icon(
                                tappable
                                    ? Icons.campaign_rounded
                                    : Icons.workspace_premium_rounded,
                                size: 11,
                                color: labelColor,
                              ),
                              const SizedBox(width: 4),
                              ConstrainedBox(
                                constraints: const BoxConstraints(maxWidth: 150),
                                child: Text(
                                  ad.sponsorLabel,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 8.5,
                                    fontWeight: FontWeight.w900,
                                    letterSpacing: 0.4,
                                    color: labelColor,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 7),
                        Text(
                          ad.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: labelColor,
                            fontSize: 15.5,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        if (ad.tagline != null) ...<Widget>[
                          const SizedBox(height: 2),
                          Text(
                            ad.tagline!,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: labelColor.withValues(alpha: 0.9),
                              fontSize: 11,
                              fontWeight: FontWeight.w500,
                              height: 1.3,
                            ),
                          ),
                        ],
                        if (tappable) ...<Widget>[
                          const SizedBox(height: 4),
                          Text(
                            ad.ctaText ?? 'Shop ${filterCategory!} →',
                            style: TextStyle(
                              color: labelColor,
                              fontSize: 10.5,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  if (ad.hasImage) ...<Widget>[
                    const SizedBox(width: NabinSpacing.sm),
                    ClipRRect(
                      borderRadius: NabinRadius.control,
                      child: Image.network(
                        ad.imageUrl!,
                        width: 86,
                        height: 86,
                        fit: BoxFit.cover,
                        // The gradient tile is the fallback, so a campaign
                        // without reachable artwork never shows a broken box.
                        errorBuilder: (BuildContext context, Object error, StackTrace? stack) =>
                            const SizedBox(width: 86, height: 86),
                        loadingBuilder:
                            (
                              BuildContext context,
                              Widget child,
                              ImageChunkEvent? progress,
                            ) =>
                                progress == null
                                    ? child
                                    : const SizedBox(width: 86, height: 86),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            ),
          ),
        ),
      ),
    );
  }
}
