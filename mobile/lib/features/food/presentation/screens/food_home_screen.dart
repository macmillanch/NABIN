import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/nabin_tokens.dart';
import '../../../../core/theme/restaurant_theme.dart';
import '../providers/food_advertisements_provider.dart';
import '../providers/food_models.dart';
import '../providers/food_restaurants_provider.dart';
import '../widgets/food_shared_widgets.dart';

class FoodHomeScreen extends ConsumerStatefulWidget {
  const FoodHomeScreen({super.key});

  @override
  ConsumerState<FoodHomeScreen> createState() => _FoodHomeScreenState();
}

class _FoodHomeScreenState extends ConsumerState<FoodHomeScreen> {
  final TextEditingController _searchCtrl = TextEditingController();
  int _selectedBannerIndex = 0;
  int _bannerSlideCount = -1;
  late final PageController _bannerController;
  Timer? _bannerTimer;

  @override
  void initState() {
    super.initState();
    _bannerController = PageController();
  }

  @override
  void dispose() {
    _bannerTimer?.cancel();
    _bannerController.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  /// Autoplay only exists while there is more than one sponsored tile.
  void _syncBannerTimer(int bannerCount) {
    if (_bannerSlideCount == bannerCount) return;
    _bannerSlideCount = bannerCount;
    _bannerTimer?.cancel();
    _bannerTimer = null;
    if (_selectedBannerIndex >= bannerCount) _selectedBannerIndex = 0;
    if (bannerCount <= 1) return;

    _bannerTimer = Timer.periodic(const Duration(seconds: 4), (timer) {
      if (!_bannerController.hasClients) return;
      final next = (_selectedBannerIndex + 1) % bannerCount;
      _bannerController.animateToPage(
        next,
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeInOut,
      );
    });
  }

  void _openMenu(FoodRestaurant restaurant) {
    final query = <String, String>{
      'restaurantId': restaurant.id,
      'restaurantName': restaurant.name,
      if (restaurant.deliveryMinutes != null) 'deliveryMinutes': '${restaurant.deliveryMinutes}',
    };
    context.push('/restaurant-menu?${Uri(queryParameters: query).query}');
  }

  @override
  Widget build(BuildContext context) {
    final filters = ref.watch(foodHomeFiltersProvider);
    final filtersNotifier = ref.read(foodHomeFiltersProvider.notifier);
    final restaurantsAsync = ref.watch(foodRestaurantsProvider);
    final bannersAsync = ref.watch(foodAdvertisementsProvider);

    final feed = restaurantsAsync.valueOrNull;
    final restaurants = feed?.restaurants ?? const <FoodRestaurant>[];
    final cuisines = feed?.cuisines ?? const <String>[];
    final banners = bannersAsync.valueOrNull ?? const <FoodAdvertisement>[];
    _syncBannerTimer(banners.length);

    // `GET /api/restaurants` orders by name and applies no location filter, so
    // the unfiltered list is every listed restaurant, not a ranking and not a
    // neighbourhood. It used to be headed "Top rated restaurants" while the
    // server sorted a `rating` column whose every row held the schema DEFAULT of
    // 4.80 — an ordering of a constant, captioned as a judgement. Migration 034
    // dropped that default and the projection dropped the column, so the
    // headline now says what the query actually did.
    final headline = filters.search.isNotEmpty
        ? 'Results for "${filters.search}"'
        : filters.cuisine != null
            ? '${filters.cuisine} spots'
            : 'All restaurants';

    return Scaffold(
      backgroundColor: RestaurantTheme.lightBg,
      appBar: AppBar(
        backgroundColor: RestaurantTheme.headerBand,
        elevation: 0,
        title: Row(
          children: <Widget>[
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: NabinColor.onBrand.withValues(alpha: 0.16),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.restaurant_rounded, color: RestaurantTheme.serviceAccent, size: 20),
            ),
            const SizedBox(width: 10),
            // Expanded: the lockup is the only stretchable part of the title, so
            // a long subtitle gives way here instead of pushing past the band.
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      const Text('NABIN', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: NabinColor.onBrand)),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
                        decoration: BoxDecoration(
                          color: RestaurantTheme.serviceAccent,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: const Text(
                          'FOOD',
                          style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: NabinColor.onBrand, letterSpacing: 0.5),
                        ),
                      ),
                    ],
                  ),
                  // Not "Delivering to Home": the food flow has no saved-address
                  // book, and the address is a required field typed at checkout.
                  const Text(
                    'Address added at checkout',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 11, color: NabinColor.onBrand, fontWeight: FontWeight.w500),
                  ),
                ],
              ),
            ),
          ],
        ),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: NabinColor.onBrand, size: 18),
          onPressed: () => context.canPop() ? context.pop() : context.go('/home'),
        ),
      ),
      body: SafeArea(
        child: RefreshIndicator(
          color: RestaurantTheme.primaryAction,
          onRefresh: () => ref.read(foodRestaurantsProvider.notifier).retry(),
          child: ListView(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
            children: <Widget>[
              _SearchField(
                controller: _searchCtrl,
                onChanged: (value) {
                  // Local rebuild so the clear affordance tracks the caret,
                  // while the notifier debounces the actual API call.
                  setState(() {});
                  filtersNotifier.setSearch(value);
                },
                onClear: () {
                  _searchCtrl.clear();
                  filtersNotifier.setSearch('');
                },
              ),
              const SizedBox(height: 16),

              // Sponsored carousel — collapses to zero height while the
              // FOOD_HOME_BANNER slot has nothing published.
              ..._bannerSection(bannersAsync),

              // Circular cuisine grid. The circles are the reference's shape;
              // what fills them is the cuisine's own initial on a brand
              // gradient, because no endpoint publishes cuisine photography,
              // and a feed whose restaurants declare no cuisine shows no grid at
              // all rather than a taxonomy typed into this file.
              if (cuisines.isNotEmpty) ...<Widget>[
                Row(
                  children: <Widget>[
                    const Expanded(
                      child: Text(
                        'Eat what makes you happy',
                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
                      ),
                    ),
                    InkWell(
                      onTap: () => context.push('/food-categories'),
                      borderRadius: BorderRadius.circular(8),
                      child: const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                        child: Row(
                          children: <Widget>[
                            Text(
                              'Browse all',
                              style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: RestaurantTheme.onSecondaryAction),
                            ),
                            Icon(Icons.chevron_right_rounded, size: 16, color: RestaurantTheme.onSecondaryAction),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _CuisineWheel(
                  cuisines: cuisines,
                  selected: filters.cuisine,
                  onSelect: (cuisine) => filtersNotifier.setCuisine(
                    filters.cuisine == cuisine ? null : cuisine,
                  ),
                ),
                const SizedBox(height: 16),
              ],

              // The only two filters `GET /api/restaurants` implements. The
              // reset appears only while something is being reset.
              Row(
                children: <Widget>[
                  if (filters.cuisine != null)
                    FoodFilterPill(
                      label: 'All cuisines',
                      selected: false,
                      onTap: () => filtersNotifier.setCuisine(null),
                    ),
                  FoodFilterPill(
                    label: 'Open now',
                    icon: Icons.schedule_rounded,
                    selected: filters.openNow,
                    onTap: () => filtersNotifier.setOpenNow(!filters.openNow),
                  ),
                ],
              ),
              const SizedBox(height: 20),

              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: <Widget>[
                  Expanded(
                    child: Text(
                      headline,
                      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (restaurants.isNotEmpty)
                    Text(
                      '${restaurants.length} ${restaurants.length == 1 ? 'place' : 'places'}',
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: RestaurantTheme.secondaryText),
                    ),
                ],
              ),
              const SizedBox(height: 12),

              if (restaurantsAsync.isLoading && !restaurantsAsync.hasValue)
                const FoodListSkeleton(itemCount: 2, rowHeight: 218, band: true)
              else if (restaurantsAsync.hasError)
                FoodMessageCard(
                  icon: Icons.wifi_tethering_error_rounded,
                  title: 'Restaurants unavailable',
                  message: restaurantsAsync.error.toString(),
                  actionLabel: 'Try again',
                  onAction: () => ref.read(foodRestaurantsProvider.notifier).retry(),
                )
              else if (restaurants.isEmpty)
                FoodMessageCard(
                  icon: Icons.search_off_rounded,
                  title: 'No restaurants match this search',
                  message: filters.isPlain
                      ? 'No restaurant has opened on NABIN yet. Check back shortly.'
                      : 'Try a different dish, cuisine or turn off the open-now filter.',
                  actionLabel: filters.isPlain ? null : 'Clear filters',
                  onAction: filters.isPlain
                      ? null
                      : () {
                          _searchCtrl.clear();
                          filtersNotifier.setSearch('');
                          filtersNotifier.setCuisine(null);
                          filtersNotifier.setOpenNow(false);
                        },
                )
              else
                _RestaurantGrid(
                  restaurants: restaurants,
                  onOpen: (restaurant) => _openMenu(restaurant),
                ),
              const SizedBox(height: 30),
            ],
          ),
        ),
      ),
    );
  }

  /// Empty or loading slots render `SizedBox.shrink()` — an empty frame is
  /// worse than no banner at all. A failed fetch shows one slim retry strip.
  List<Widget> _bannerSection(AsyncValue<List<FoodAdvertisement>> bannersAsync) {
    final banners = bannersAsync.valueOrNull ?? const <FoodAdvertisement>[];

    if (bannersAsync.hasError) {
      return <Widget>[
        Semantics(
          button: true,
          child: GestureDetector(
            onTap: () => ref.read(foodAdvertisementsProvider.notifier).load(),
            child: Container(
              margin: const EdgeInsets.only(bottom: 16),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: RestaurantTheme.borderLight,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: RestaurantTheme.border),
              ),
              child: const Row(
                children: <Widget>[
                  Icon(Icons.campaign_rounded, size: 16, color: RestaurantTheme.secondaryText),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Sponsored banners did not load.',
                      style: TextStyle(fontSize: 11.5, color: RestaurantTheme.secondaryText, fontWeight: FontWeight.w600),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Text(
                    'RETRY',
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: RestaurantTheme.onSecondaryAction),
                  ),
                ],
              ),
            ),
          ),
        ),
      ];
    }

    if (banners.isEmpty) return const <Widget>[SizedBox.shrink()];

    return <Widget>[
      SizedBox(
        height: 124,
        child: PageView.builder(
          controller: _bannerController,
          onPageChanged: (index) => setState(() => _selectedBannerIndex = index),
          itemCount: banners.length,
          itemBuilder: (context, index) {
            final banner = banners[index];
            return _BannerTile(
              ad: banner,
              onTap: () => _applyBannerTarget(banner),
            );
          },
        ),
      ),
      const SizedBox(height: 8),
      if (banners.length > 1)
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List<Widget>.generate(banners.length, (index) {
            final isSelected = _selectedBannerIndex == index;
            return AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              margin: const EdgeInsets.symmetric(horizontal: 3),
              width: isSelected ? 18 : 6,
              height: 6,
              decoration: BoxDecoration(
                color: isSelected ? NabinColor.brand : NabinColor.surfaceEmphasized,
                borderRadius: BorderRadius.circular(3),
              ),
            );
          }),
        ),
      const SizedBox(height: 16),
    ];
  }

  /// Sponsored tiles that name a cuisine we actually serve jump to that filter;
  /// a raw external `ctaLink` is not navigated to from the app shell.
  void _applyBannerTarget(FoodAdvertisement ad) {
    final target = ad.targetCategory?.trim().toLowerCase() ?? '';
    if (target.isEmpty || target == 'all') return;
    final cuisines = ref.read(foodRestaurantsProvider).valueOrNull?.cuisines ?? const <String>[];
    for (final cuisine in cuisines) {
      if (cuisine.toLowerCase() == target) {
        ref.read(foodHomeFiltersProvider.notifier).setCuisine(cuisine);
        return;
      }
    }
  }
}

class _SearchField extends StatelessWidget {
  const _SearchField({
    required this.controller,
    required this.onChanged,
    required this.onClear,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 52,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: RestaurantTheme.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: RestaurantTheme.border),
        boxShadow: <BoxShadow>[
          BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 8, offset: const Offset(0, 2)),
        ],
      ),
      child: Row(
        children: <Widget>[
          const Icon(Icons.search_rounded, color: RestaurantTheme.headerBand, size: 22),
          const SizedBox(width: 10),
          Expanded(
            child: TextField(
              controller: controller,
              textInputAction: TextInputAction.search,
              onChanged: onChanged,
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: RestaurantTheme.charcoal),
              decoration: const InputDecoration(
                hintText: 'Search restaurants or cuisines...',
                hintStyle: TextStyle(color: RestaurantTheme.secondaryText, fontSize: 13, fontWeight: FontWeight.normal),
                border: InputBorder.none,
                isDense: true,
              ),
            ),
          ),
          if (controller.text.isNotEmpty)
            GestureDetector(
              onTap: onClear,
              child: const Icon(Icons.close_rounded, size: 18, color: RestaurantTheme.secondaryText),
            ),
        ],
      ),
    );
  }
}

class _BannerTile extends StatelessWidget {
  const _BannerTile({required this.ad, required this.onTap});

  final FoodAdvertisement ad;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(right: 6),
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: RestaurantTheme.headerBand,
          borderRadius: BorderRadius.circular(20),
          boxShadow: <BoxShadow>[
            BoxShadow(color: NabinColor.brand.withValues(alpha: 0.28), blurRadius: 12, offset: const Offset(0, 5)),
          ],
        ),
        child: Row(
          children: <Widget>[
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.18),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            ad.sponsorLabel.toUpperCase(),
                            style: const TextStyle(
                              color: RestaurantTheme.neonOrange,
                              fontSize: 9,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 0.5,
                            ),
                          ),
                        ),
                        if (ad.brand != null) ...<Widget>[
                          const SizedBox(width: 6),
                          Flexible(
                            child: Text(
                              ad.brand!,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.8),
                                fontSize: 10,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      ad.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: NabinColor.onBrand, fontWeight: FontWeight.w900, fontSize: 15),
                    ),
                    if (ad.tagline != null) ...<Widget>[
                      const SizedBox(height: 2),
                      Text(
                        ad.tagline!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: Colors.white.withValues(alpha: 0.85), fontSize: 11, fontWeight: FontWeight.w500),
                      ),
                    ],
                    if (ad.ctaText != null) ...<Widget>[
                      const SizedBox(height: 6),
                      Row(
                        children: <Widget>[
                          Flexible(
                            child: Text(
                              ad.ctaText!,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: NabinColor.onBrand,
                                fontSize: 11,
                                fontWeight: FontWeight.w900,
                                letterSpacing: 0.3,
                              ),
                            ),
                          ),
                          const Icon(Icons.arrow_forward_rounded, size: 13, color: NabinColor.onBrand),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),
            if (ad.imageUrl != null)
              Image.network(
                ad.imageUrl!,
                width: 110,
                height: 124,
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) => const SizedBox(width: 110, height: 124),
              ),
          ],
        ),
      ),
    );
  }
}

/// The reference is a phone list, so a phone gets one card per row. On a tablet
/// a single row would stretch the band across 800 px of gradient for no gain,
/// so the same cards go two-up once there is room for two.
class _RestaurantGrid extends StatelessWidget {
  const _RestaurantGrid({required this.restaurants, required this.onOpen});

  final List<FoodRestaurant> restaurants;
  final ValueChanged<FoodRestaurant> onOpen;

  @override
  Widget build(BuildContext context) {
    final available = MediaQuery.sizeOf(context).width - 36;
    final columns = available >= 700 ? 2 : 1;

    if (columns == 1) {
      return Column(
        children: <Widget>[
          for (final restaurant in restaurants)
            _RestaurantCard(restaurant: restaurant, onOpen: () => onOpen(restaurant)),
        ],
      );
    }

    const gap = 12.0;
    final cardWidth = (available - gap) / columns;
    return Wrap(
      spacing: gap,
      children: <Widget>[
        for (final restaurant in restaurants)
          SizedBox(
            width: cardWidth,
            child: _RestaurantCard(restaurant: restaurant, onOpen: () => onOpen(restaurant)),
          ),
      ],
    );
  }
}

class _RestaurantCard extends StatelessWidget {
  const _RestaurantCard({required this.restaurant, required this.onOpen});

  final FoodRestaurant restaurant;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onOpen,
      child: Container(
        margin: const EdgeInsets.only(bottom: 14),
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: RestaurantTheme.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: RestaurantTheme.border),
          boxShadow: <BoxShadow>[
            BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 8, offset: const Offset(0, 2)),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            // The reference's full-width photo band. `cover_image_url` (034) is
            // the only picture a restaurant can have, and a merchant who has not
            // declared one gets the letter plate instead: FoodLetterTile layers
            // Image.network over that plate and falls back to it when the URL
            // fails, so both states are supported and no stock photo is invented.
            // The status and the ETA sit on the corners the reference uses for
            // its badge and its time chip.
            Stack(
              children: <Widget>[
                FoodLetterTile(
                  letter: restaurant.firstLetter,
                  seed: restaurant.id.isEmpty ? restaurant.name : restaurant.id,
                  size: 104,
                  width: double.infinity,
                  radius: 0,
                  imageUrl: restaurant.coverImageUrl,
                ),
                Positioned(top: 10, left: 10, child: _OpenBadge(restaurant: restaurant)),
                if (restaurant.etaLabel != null)
                  Positioned(right: 10, bottom: 10, child: _BandChip(label: restaurant.etaLabel!)),
              ],
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  // The reference put a `[4.1★]` pill here. NABIN has no rating
                  // source, so the name owns the line instead.
                  Text(
                    restaurant.name,
                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: RestaurantTheme.charcoal),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (restaurant.cuisineLabel.isNotEmpty) ...<Widget>[
                    const SizedBox(height: 2),
                    Text(
                      restaurant.cuisineLabel,
                      style: const TextStyle(color: RestaurantTheme.secondaryText, fontSize: 12),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  if (restaurant.address != null) ...<Widget>[
                    const SizedBox(height: 6),
                    Row(
                      children: <Widget>[
                        const Icon(Icons.location_on_outlined, size: 13, color: RestaurantTheme.secondaryText),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            restaurant.address!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: RestaurantTheme.secondaryText, fontSize: 11),
                          ),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 10),
                  const Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: <Widget>[
                      // A caption for the tap target, not a status claim: the
                      // restaurant's real state is the OPEN/CLOSED badge on the
                      // band, which reads the projected `isOpen` boolean.
                      Expanded(
                        child: Text(
                          'Menu & prices',
                          style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: RestaurantTheme.secondaryText),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      SizedBox(width: 8),
                      Row(
                        children: <Widget>[
                          Text('View Menu', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: RestaurantTheme.serviceAccent)),
                          SizedBox(width: 2),
                          Icon(Icons.chevron_right_rounded, size: 16, color: RestaurantTheme.serviceAccent),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// White chip that sits on the band, like the reference's time-over-photo chip.
/// The label comes from `FoodRestaurant.etaLabel`, which is the only place the
/// declared minute count becomes a sentence.
class _BandChip extends StatelessWidget {
  const _BandChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 190),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3.5),
      decoration: BoxDecoration(
        color: NabinColor.surface,
        borderRadius: BorderRadius.circular(8),
        boxShadow: const <BoxShadow>[BoxShadow(color: Colors.black26, blurRadius: 6, offset: Offset(0, 2))],
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
      ),
    );
  }
}

/// Circular cuisine picker: the reference's round tiles, driven by the cuisine
/// vocabulary derived from the unfiltered feed.
class _CuisineWheel extends StatelessWidget {
  const _CuisineWheel({required this.cuisines, required this.selected, required this.onSelect});

  final List<String> cuisines;
  final String? selected;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    // Same column rule as the grocery aisle grid, so the two services read as
    // one system instead of two layouts.
    final available = MediaQuery.sizeOf(context).width - 36;
    final columns = available >= 720 ? 8 : available >= 480 ? 6 : 4;
    const gap = 8.0;
    final tileWidth = (available - gap * (columns - 1)) / columns;

    return Wrap(
      spacing: gap,
      runSpacing: 14,
      children: <Widget>[
        for (final cuisine in cuisines)
          SizedBox(
            width: tileWidth,
            child: _CuisineChoice(
              cuisine: cuisine,
              selected: selected?.toLowerCase() == cuisine.toLowerCase(),
              onTap: () => onSelect(cuisine),
            ),
          ),
      ],
    );
  }
}

class _CuisineChoice extends StatelessWidget {
  const _CuisineChoice({required this.cuisine, required this.selected, required this.onTap});

  final String cuisine;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: <Widget>[
          AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            padding: const EdgeInsets.all(2.5),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(
                color: selected ? RestaurantTheme.chipSelected : Colors.transparent,
                width: 2.5,
              ),
            ),
            child: FoodLetterTile(
              letter: cuisine.isEmpty ? '?' : cuisine.substring(0, 1).toUpperCase(),
              seed: cuisine,
              size: 54,
              radius: 27,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            cuisine,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 10.5,
              height: 1.15,
              fontWeight: FontWeight.w800,
              color: selected ? RestaurantTheme.onSecondaryAction : RestaurantTheme.charcoal,
            ),
          ),
        ],
      ),
    );
  }
}


class _OpenBadge extends StatelessWidget {
  const _OpenBadge({required this.restaurant});

  final FoodRestaurant restaurant;

  @override
  Widget build(BuildContext context) {
    final isOpen = restaurant.isOpen;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3.5),
      decoration: BoxDecoration(
        color: NabinColor.surface,
        borderRadius: BorderRadius.circular(8),
        boxShadow: const <BoxShadow>[
          BoxShadow(color: Colors.black26, blurRadius: 6, offset: Offset(0, 2)),
        ],
      ),
      child: Text(
        isOpen ? '● OPEN' : '● CLOSED',
        style: TextStyle(
          fontSize: 9.5,
          fontWeight: FontWeight.w900,
          letterSpacing: 0.3,
          color: isOpen ? RestaurantTheme.vegGreen : RestaurantTheme.secondaryText,
        ),
      ),
    );
  }
}
