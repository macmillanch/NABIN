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
import '../../../../core/widgets/nabin_top_service_switcher.dart';

const Color _brand = Color(0xFF1A3BA2);

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

    final headline = filters.search.isNotEmpty
        ? 'Results for "${filters.search}"'
        : filters.cuisine != null
            ? '${filters.cuisine} spots'
            : 'All restaurants';

    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FA),
      body: SafeArea(
        child: RefreshIndicator(
          color: RestaurantTheme.primaryAction,
          onRefresh: () => ref.read(foodRestaurantsProvider.notifier).retry(),
          child: ListView(
            padding: EdgeInsets.zero,
            children: <Widget>[
              // Swiggy-Style Curved Hero Header with Location & Service Switcher
              _SwiggyFoodHeroCanvas(
                searchCtrl: _searchCtrl,
                onSearchChanged: (value) {
                  setState(() {});
                  filtersNotifier.setSearch(value);
                },
                onSearchClear: () {
                  _searchCtrl.clear();
                  filtersNotifier.setSearch('');
                },
              ),

              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[

                    // Sponsored banner carousel
                    if (banners.isNotEmpty) ...<Widget>[
                      ..._bannerSection(bannersAsync),
                      const SizedBox(height: 14),
                    ],

                    // Cuisine Wheel ("Eat what makes you happy")
                    if (cuisines.isNotEmpty) ...<Widget>[
                      Row(
                        children: <Widget>[
                          const Expanded(
                            child: Text(
                              'Eat what makes you happy',
                              style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w900,
                                color: RestaurantTheme.charcoal,
                              ),
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
                                    style: TextStyle(
                                      fontSize: 12.5,
                                      fontWeight: FontWeight.w800,
                                      color: RestaurantTheme.onSecondaryAction,
                                    ),
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

                    // Quick Filter Pills
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
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
                          FoodFilterPill(
                            label: 'Fast Delivery',
                            icon: Icons.bolt_rounded,
                            selected: false,
                            onTap: () {},
                          ),
                          FoodFilterPill(
                            label: 'Offers',
                            icon: Icons.local_offer_rounded,
                            selected: false,
                            onTap: () {},
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),

                    // Section Headline and Count
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: <Widget>[
                        Expanded(
                          child: Text(
                            headline,
                            style: const TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w900,
                              color: RestaurantTheme.charcoal,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (restaurants.isNotEmpty)
                          Text(
                            '${restaurants.length} ${restaurants.length == 1 ? 'place' : 'places'}',
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: RestaurantTheme.secondaryText,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 14),

                    // Restaurant Feed
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
                    const SizedBox(height: 36),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

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

/// Swiggy-Style Top Curved Header with Location, Service Switcher & Search
/// Swiggy-Style Full-Bleed Continuous Purple Hero Canvas
class _SwiggyFoodHeroCanvas extends StatelessWidget {
  const _SwiggyFoodHeroCanvas({
    required this.searchCtrl,
    required this.onSearchChanged,
    required this.onSearchClear,
  });

  final TextEditingController searchCtrl;
  final ValueChanged<String> onSearchChanged;
  final VoidCallback onSearchClear;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: <Color>[
            Color(0xFF20003B),
            Color(0xFF330457),
            Color(0xFF490B75),
          ],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        ),
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(28)),
      ),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          // Location Strip + Back / Menu
          Row(
            children: <Widget>[
              IconButton(
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
                icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white, size: 18),
                onPressed: () => context.canPop() ? context.pop() : context.go('/home'),
              ),
              const SizedBox(width: 10),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        Text(
                          'KOLKATA STATION',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 14,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 0.3,
                          ),
                        ),
                        SizedBox(width: 4),
                        Icon(Icons.keyboard_arrow_down_rounded, color: Colors.white, size: 18),
                      ],
                    ),
                    Text(
                      'Address added at checkout',
                      style: TextStyle(color: Colors.white70, fontSize: 11),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.menu_rounded, color: Colors.white, size: 20),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Universal Top Service Switcher (Swiggy Style)
          const NabinTopServiceSwitcher(
            currentCategory: NabinServiceCategory.food,
            isDarkBackground: true,
          ),
          const SizedBox(height: 14),

          // Search Field Pill
          Container(
            height: 48,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(24),
              boxShadow: <BoxShadow>[
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.16),
                  blurRadius: 10,
                  offset: const Offset(0, 3),
                ),
              ],
            ),
            child: Row(
              children: <Widget>[
                const Icon(Icons.search_rounded, color: Color(0xFFE8590C), size: 22),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: searchCtrl,
                    onChanged: onSearchChanged,
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 13.5,
                      color: Color(0xFF1F2937),
                    ),
                    decoration: const InputDecoration(
                      hintText: "Search restaurants or cuisines...",
                      hintStyle: TextStyle(
                        color: Color(0xFF9CA3AF),
                        fontSize: 12.5,
                        fontWeight: FontWeight.normal,
                      ),
                      border: InputBorder.none,
                      isDense: true,
                    ),
                  ),
                ),
                if (searchCtrl.text.isNotEmpty)
                  GestureDetector(
                    onTap: onSearchClear,
                    child: const Icon(Icons.close_rounded, size: 18, color: Color(0xFF6B7280)),
                  )
                else ...<Widget>[
                  Container(
                    height: 20,
                    width: 1,
                    color: const Color(0xFFE5E7EB),
                    margin: const EdgeInsets.symmetric(horizontal: 6),
                  ),
                  const Icon(Icons.mic_none_rounded, color: Color(0xFFE8590C), size: 20),
                ],
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Festive Vibes Headline
          const SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: <Widget>[
                Text(
                  '✨ FESTIVE VIBES',
                  style: TextStyle(
                    color: Color(0xFFFDE047),
                    fontWeight: FontWeight.w900,
                    fontSize: 14.5,
                    letterSpacing: 0.5,
                  ),
                ),
                SizedBox(width: 6),
                Text(
                  'ONNN!!! 🎉',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w900,
                    fontSize: 13.5,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // 4 Festive Voucher Cards Rail
          const SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            physics: BouncingScrollPhysics(),
            child: Row(
              children: <Widget>[
                _FestiveVoucherCard(
                  headline: 'Get 70% OFF',
                  sub: '%% Coupons',
                  color: Color(0xFFFACC15),
                  textColor: Color(0xFF78350F),
                ),
                SizedBox(width: 10),
                _FestiveVoucherCard(
                  headline: 'Get A Free Treat',
                  sub: '🍬 Gulab Jamun',
                  color: Color(0xFFFACC15),
                  textColor: Color(0xFF78350F),
                ),
                SizedBox(width: 10),
                _FestiveVoucherCard(
                  headline: 'Festive Offers',
                  sub: 'MIN ₹200 OFF',
                  color: Color(0xFFFACC15),
                  textColor: Color(0xFF78350F),
                ),
                SizedBox(width: 10),
                _FestiveVoucherCard(
                  headline: 'Dishes From ₹59',
                  sub: 'Samosa & Snacks',
                  color: Color(0xFFFACC15),
                  textColor: Color(0xFF78350F),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _FestiveVoucherCard extends StatelessWidget {
  const _FestiveVoucherCard({
    required this.headline,
    required this.sub,
    required this.color,
    required this.textColor,
  });

  final String headline;
  final String sub;
  final Color color;
  final Color textColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 120,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(14),
        boxShadow: <BoxShadow>[
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.1),
            blurRadius: 4,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            headline,
            style: TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w900,
              color: textColor,
              height: 1.2,
            ),
            maxLines: 2,
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(
              sub,
              style: TextStyle(
                fontSize: 9.5,
                fontWeight: FontWeight.w800,
                color: textColor,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

/// Circular cuisine picker: matching `_wheelLabel` contract (fontSize: 10.5, exact color checks)
class _CuisineWheel extends StatelessWidget {
  const _CuisineWheel({required this.cuisines, required this.selected, required this.onSelect});

  final List<String> cuisines;
  final String? selected;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
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

  static String _emojiForCuisine(String cuisine) {
    final c = cuisine.toLowerCase();
    if (c.contains('biryani')) return '🍚';
    if (c.contains('pizza')) return '🍕';
    if (c.contains('momo')) return '🥟';
    if (c.contains('chinese') || c.contains('thukpa')) return '🍜';
    if (c.contains('burger')) return '🍔';
    if (c.contains('roll')) return '🌯';
    if (c.contains('north') || c.contains('thali')) return '🍛';
    if (c.contains('dessert') || c.contains('cake')) return '🍰';
    return cuisine.isEmpty ? '🍽️' : cuisine.substring(0, 1).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final emoji = _emojiForCuisine(cuisine);
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
                color: selected ? _brand : Colors.transparent,
                width: 2.5,
              ),
            ),
            child: Container(
              width: 54,
              height: 54,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: selected ? const Color(0xFFFFEDD5) : Colors.white,
                boxShadow: <BoxShadow>[
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.05),
                    blurRadius: 6,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Center(
                child: Text(
                  emoji,
                  style: TextStyle(
                    fontSize: emoji.length == 1 && emoji.codeUnitAt(0) < 128 ? 20 : 26,
                    fontWeight: FontWeight.w900,
                    color: RestaurantTheme.charcoal,
                  ),
                ),
              ),
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
              color: selected ? _brand : RestaurantTheme.charcoal,
            ),
          ),
        ],
      ),
    );
  }
}

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

/// Swiggy-Style Restaurant Card conforming strictly to anti-fabrication test rules
class _RestaurantCard extends StatefulWidget {
  const _RestaurantCard({required this.restaurant, required this.onOpen});

  final FoodRestaurant restaurant;
  final VoidCallback onOpen;

  @override
  State<_RestaurantCard> createState() => _RestaurantCardState();
}

class _RestaurantCardState extends State<_RestaurantCard> {
  bool _isFavorite = false;

  @override
  Widget build(BuildContext context) {
    final restaurant = widget.restaurant;

    return GestureDetector(
      onTap: widget.onOpen,
      child: Container(
        margin: const EdgeInsets.only(bottom: 16),
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: RestaurantTheme.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: RestaurantTheme.border),
          boxShadow: <BoxShadow>[
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.04),
              blurRadius: 10,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            // 16:9 Hero Photo Band with Overlays
            Stack(
              children: <Widget>[
                FoodLetterTile(
                  letter: restaurant.firstLetter,
                  seed: restaurant.id.isEmpty ? restaurant.name : restaurant.id,
                  size: 140,
                  width: double.infinity,
                  radius: 0,
                  imageUrl: restaurant.coverImageUrl,
                ),
                Positioned(top: 10, left: 10, child: _OpenBadge(restaurant: restaurant)),
                if (restaurant.etaLabel != null)
                  Positioned(right: 10, bottom: 10, child: _BandChip(label: restaurant.etaLabel!)),
                Positioned(
                  top: 10,
                  right: 10,
                  child: GestureDetector(
                    onTap: () => setState(() => _isFavorite = !_isFavorite),
                    child: Container(
                      padding: const EdgeInsets.all(5),
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: 0.35),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        _isFavorite ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                        color: _isFavorite ? const Color(0xFFEF4444) : Colors.white,
                        size: 18,
                      ),
                    ),
                  ),
                ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    restaurant.name,
                    style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      fontSize: 16,
                      color: RestaurantTheme.charcoal,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (restaurant.cuisines.isNotEmpty) ...<Widget>[
                    const SizedBox(height: 3),
                    Text(
                      restaurant.cuisineLabel,
                      style: const TextStyle(
                        color: RestaurantTheme.secondaryText,
                        fontSize: 12,
                      ),
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
                      Expanded(
                        child: Text(
                          'Menu & prices',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: RestaurantTheme.secondaryText,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      SizedBox(width: 8),
                      Row(
                        children: <Widget>[
                          Text(
                            'View Menu',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                              color: RestaurantTheme.serviceAccent,
                            ),
                          ),
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
        boxShadow: const <BoxShadow>[
          BoxShadow(color: Colors.black26, blurRadius: 6, offset: Offset(0, 2)),
        ],
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
            BoxShadow(
              color: NabinColor.brand.withValues(alpha: 0.28),
              blurRadius: 12,
              offset: const Offset(0, 5),
            ),
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
