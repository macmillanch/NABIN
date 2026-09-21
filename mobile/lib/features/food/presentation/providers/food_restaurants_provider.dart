import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/network/nabin_api_service.dart';
import 'food_models.dart';

/// Search / cuisine / open-now state for the food home screen.
///
/// Kept separate from the fetch so the filter chips have one source of truth
/// and the notifier below owns debouncing and request ordering.
class FoodHomeFilters {
  const FoodHomeFilters({this.search = '', this.cuisine, this.openNow = false});

  final String search;
  final String? cuisine;
  final bool openNow;

  bool get isPlain => search.isEmpty && cuisine == null && !openNow;

  FoodHomeFilters copyWith({String? search, String? cuisine, bool? openNow, bool clearCuisine = false}) {
    return FoodHomeFilters(
      search: search ?? this.search,
      cuisine: clearCuisine ? null : (cuisine ?? this.cuisine),
      openNow: openNow ?? this.openNow,
    );
  }
}

class FoodHomeFiltersNotifier extends StateNotifier<FoodHomeFilters> {
  FoodHomeFiltersNotifier() : super(const FoodHomeFilters());

  void setSearch(String value) {
    final trimmed = value.trim();
    if (trimmed == state.search) return;
    state = state.copyWith(search: trimmed);
  }

  void setCuisine(String? cuisine) {
    if (cuisine == state.cuisine) return;
    state = cuisine == null
        ? state.copyWith(clearCuisine: true)
        : state.copyWith(cuisine: cuisine);
  }

  void setOpenNow(bool value) {
    if (value == state.openNow) return;
    state = state.copyWith(openNow: value);
  }
}

final foodHomeFiltersProvider =
    StateNotifierProvider<FoodHomeFiltersNotifier, FoodHomeFilters>((ref) {
  return FoodHomeFiltersNotifier();
});

final foodRestaurantsProvider = StateNotifierProvider<FoodRestaurantsNotifier,
    AsyncValue<FoodRestaurantFeed>>((ref) {
  final notifier = FoodRestaurantsNotifier();
  ref.listen<FoodHomeFilters>(foodHomeFiltersProvider, (previous, next) {
    notifier.applyFilters(next);
  });
  return notifier;
});

/// `GET /api/restaurants` with server-side search / cuisine / open-now.
///
/// The previous screen filtered a hard-coded array in memory; every query here
/// goes to the API, the keystroke stream is debounced by 300 ms, and a response
/// that has been overtaken by a newer request is dropped.
class FoodRestaurantsNotifier extends StateNotifier<AsyncValue<FoodRestaurantFeed>> {
  FoodRestaurantsNotifier({Duration? debounce})
      : _debounce = debounce ?? const Duration(milliseconds: 300),
        super(const AsyncValue<FoodRestaurantFeed>.loading()) {
    refresh(const FoodHomeFilters());
  }

  final Duration _debounce;

  Timer? _debounceTimer;
  int _requestSeq = 0;
  FoodHomeFilters _filters = const FoodHomeFilters();

  /// Cuisine names seen on the unfiltered feed; drives the filter pills because
  /// no endpoint publishes a cuisine taxonomy.
  List<String> _cuisineCatalog = const <String>[];

  Future<void> applyFilters(FoodHomeFilters next) async {
    final previous = _filters;
    _filters = next;
    final searchOnlyChange =
        previous.cuisine == next.cuisine && previous.openNow == next.openNow && previous.search != next.search;
    if (searchOnlyChange) {
      _scheduleRefresh();
    } else {
      await refresh(next);
    }
  }

  /// Immediate reload, e.g. from the error/retry affordance.
  Future<void> retry() => refresh(_filters);

  void _scheduleRefresh() {
    _debounceTimer?.cancel();
    _debounceTimer = Timer(_debounce, () => refresh(_filters));
  }

  Future<void> refresh(FoodHomeFilters filters) async {
    _debounceTimer?.cancel();
    _filters = filters;
    final request = ++_requestSeq;
    state = state.hasValue ? const AsyncValue<FoodRestaurantFeed>.loading().copyWithPrevious(state) : const AsyncValue<FoodRestaurantFeed>.loading();

    try {
      final response = await NabinApiService.getRestaurants(
        search: filters.search.isEmpty ? null : filters.search,
        cuisine: filters.cuisine,
        openNow: filters.openNow,
      );
      if (!mounted || request != _requestSeq) return;

      if (response == null || response['success'] != true) {
        state = AsyncValue<FoodRestaurantFeed>.error(
          response?['error'] ?? 'Could not reach the restaurant list. Pull to try again.',
          StackTrace.current,
        );
        return;
      }

      final raw = (response['restaurants'] as List?) ?? const <dynamic>[];
      final restaurants = raw
          .whereType<Map<dynamic, dynamic>>()
          .map((e) => FoodRestaurant.fromJson(Map<String, dynamic>.from(e)))
          .where((e) => e.id.isNotEmpty)
          .toList(growable: false);

      if (filters.isPlain) {
        _cuisineCatalog = _distinctCuisines(restaurants);
      }

      state = AsyncValue.data(FoodRestaurantFeed(restaurants: restaurants, cuisines: _cuisineCatalog));
    } catch (error, stackTrace) {
      if (!mounted || request != _requestSeq) return;
      state = AsyncValue<FoodRestaurantFeed>.error(error, stackTrace);
    }
  }

  static List<String> _distinctCuisines(List<FoodRestaurant> restaurants) {
    final seen = <String>{};
    final ordered = <String>[];
    for (final restaurant in restaurants) {
      for (final cuisine in restaurant.cuisines) {
        final key = cuisine.toLowerCase();
        if (seen.add(key)) ordered.add(cuisine);
      }
    }
    ordered.sort();
    return ordered;
  }

  @override
  void dispose() {
    _debounceTimer?.cancel();
    super.dispose();
  }
}
