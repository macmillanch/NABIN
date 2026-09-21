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
      if (restaurant.deliveryTime != null) 'deliveryTime': restaurant.deliveryTime!,
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

    final headline = filters.search.isNotEmpty
        ? 'Results for "${filters.search}"'
        : filters.cuisine != null
            ? '${filters.cuisine} spots'
            : 'Top restaurants near you';

    return Scaffold(
      backgroundColor: RestaurantTheme.lightBg,
      appBar: AppBar(
        backgroundColor: RestaurantTheme.charcoal,
        elevation: 0,
        title: Row(
          children: <Widget>[
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: RestaurantTheme.neonOrange.withValues(alpha: 0.2),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.restaurant_rounded, color: RestaurantTheme.neonOrange, size: 20),
            ),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    const Text('NABIN', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: NabinColor.onBrand)),
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
                      decoration: BoxDecoration(
                        color: RestaurantTheme.neonOrange,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: const Text(
                        'FOOD',
                        style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: NabinColor.onBrand, letterSpacing: 0.5),
                      ),
                    ),
                  ],
                ),
                const Text(
                  'Delivering to Home',
                  style: TextStyle(fontSize: 11, color: RestaurantTheme.secondaryText, fontWeight: FontWeight.w500),
                ),
              ],
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
          color: RestaurantTheme.neonOrange,
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

              if (cuisines.isNotEmpty) ...<Widget>[
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: <Widget>[
                      FoodFilterPill(
                        label: 'All',
                        selected: filters.cuisine == null,
                        onTap: () => filtersNotifier.setCuisine(null),
                      ),
                      for (final cuisine in cuisines)
                        FoodFilterPill(
                          label: cuisine,
                          selected: filters.cuisine == cuisine,
                          onTap: () => filtersNotifier.setCuisine(
                            filters.cuisine == cuisine ? null : cuisine,
                          ),
                        ),
                      Container(width: 1, height: 26, margin: const EdgeInsets.symmetric(horizontal: 6), color: RestaurantTheme.border),
                      FoodFilterPill(
                        label: 'Open now',
                        icon: Icons.schedule_rounded,
                        selected: filters.openNow,
                        onTap: () => filtersNotifier.setOpenNow(!filters.openNow),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
              ] else ...<Widget>[
                const SizedBox(height: 4),
                if (filters.openNow || restaurantsAsync.isLoading)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: FoodFilterPill(
                      label: 'Open now',
                      icon: Icons.schedule_rounded,
                      selected: filters.openNow,
                      onTap: () => filtersNotifier.setOpenNow(!filters.openNow),
                    ),
                  ),
                const SizedBox(height: 16),
              ],

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
                const FoodListSkeleton()
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
                      ? 'No restaurant has opened on NABIN in this area yet. Check back shortly.'
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
                for (final restaurant in restaurants) _RestaurantCard(
                  restaurant: restaurant,
                  onOpen: () => _openMenu(restaurant),
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
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: RestaurantTheme.neonOrangeDark),
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
                color: isSelected ? RestaurantTheme.neonOrange : RestaurantTheme.border,
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
          const Icon(Icons.search_rounded, color: RestaurantTheme.neonOrange, size: 22),
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
          gradient: const LinearGradient(
            colors: <Color>[RestaurantTheme.charcoal, NabinColor.brandHover],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(20),
          boxShadow: <BoxShadow>[
            BoxShadow(color: RestaurantTheme.charcoal.withValues(alpha: 0.35), blurRadius: 10, offset: const Offset(0, 4)),
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
                      Text(
                        ad.ctaText!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: RestaurantTheme.neonOrange, fontSize: 11, fontWeight: FontWeight.w900),
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
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: RestaurantTheme.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: RestaurantTheme.border),
          boxShadow: <BoxShadow>[
            BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 8, offset: const Offset(0, 2)),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                FoodLetterTile(letter: restaurant.firstLetter, seed: restaurant.id.isEmpty ? restaurant.name : restaurant.id),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Row(
                        children: <Widget>[
                          Expanded(
                            child: Text(
                              restaurant.name,
                              style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: RestaurantTheme.charcoal),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          const SizedBox(width: 8),
                          _OpenBadge(restaurant: restaurant),
                        ],
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
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: <Widget>[
                          if (restaurant.rating != null)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: RestaurantTheme.vegGreen.withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: <Widget>[
                                  const Icon(Icons.star_rounded, size: 12, color: RestaurantTheme.vegGreen),
                                  const SizedBox(width: 2),
                                  Text(
                                    restaurant.rating!.toStringAsFixed(1),
                                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 11, color: RestaurantTheme.vegGreen),
                                  ),
                                ],
                              ),
                            ),
                          if (restaurant.deliveryTime != null)
                            Text(
                              '• ${restaurant.deliveryTime}',
                              style: const TextStyle(color: RestaurantTheme.secondaryText, fontSize: 11, fontWeight: FontWeight.w600),
                            ),
                          if (restaurant.address != null)
                            ConstrainedBox(
                              constraints: BoxConstraints(
                                maxWidth: MediaQuery.sizeOf(context).width - 170,
                              ),
                              child: Text(
                                '• ${restaurant.address}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(color: RestaurantTheme.secondaryText, fontSize: 11),
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: <Widget>[
                Text(
                  restaurant.isApproved ? 'Menu & prices' : 'Currently not accepting orders',
                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: RestaurantTheme.secondaryText),
                ),
                const Row(
                  children: <Widget>[
                    Text('View Menu', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: RestaurantTheme.neonOrange)),
                    SizedBox(width: 2),
                    Icon(Icons.chevron_right_rounded, size: 16, color: RestaurantTheme.neonOrange),
                  ],
                ),
              ],
            ),
          ],
        ),
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
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: isOpen ? RestaurantTheme.vegGreen.withValues(alpha: 0.12) : RestaurantTheme.borderLight,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        isOpen ? '● OPEN' : 'CLOSED',
        style: TextStyle(
          fontSize: 9,
          fontWeight: FontWeight.w900,
          color: isOpen ? RestaurantTheme.vegGreen : RestaurantTheme.secondaryText,
        ),
      ),
    );
  }
}
