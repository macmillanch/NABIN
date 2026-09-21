import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../models/grocery_product.dart';

const Duration grocerySearchDebounce = Duration(milliseconds: 300);

List<GroceryProduct> parseGroceryProducts(Object? raw) {
  if (raw is! List) return const <GroceryProduct>[];
  return raw
      .whereType<Map>()
      .map((Map row) => GroceryProduct.fromApi(row.cast<String, dynamic>()))
      .where((GroceryProduct product) => product.id.isNotEmpty)
      .toList();
}

String _errorOf(Map<String, dynamic>? response) =>
    (response?['error'] ?? response?['message'])?.toString() ?? 'Could not reach NABIN.';

/// The unfiltered catalogue. It is the source of truth for anything derived
/// rather than queried — the aisle names, per-aisle counts and the price-drop
/// list — because the backend exposes no category, deal or banner endpoint.
class GroceryCatalogNotifier extends StateNotifier<AsyncValue<List<GroceryProduct>>> {
  GroceryCatalogNotifier() : super(const AsyncValue.loading()) {
    load();
  }

  int _requestToken = 0;

  Future<void> load() async {
    final int token = ++_requestToken;
    state = const AsyncValue<List<GroceryProduct>>.loading().copyWithPrevious(state);
    try {
      final Map<String, dynamic>? response = await NabinApiService.getGroceryProducts();
      if (!mounted || token != _requestToken) return;
      if (response?['success'] == true) {
        state = AsyncValue.data(parseGroceryProducts(response?['products']));
      } else {
        state = AsyncValue.error(_errorOf(response), StackTrace.current);
      }
    } catch (error, stackTrace) {
      if (!mounted || token != _requestToken) return;
      state = AsyncValue.error(error, stackTrace);
    }
  }
}

final groceryCatalogProvider =
    StateNotifierProvider<GroceryCatalogNotifier, AsyncValue<List<GroceryProduct>>>(
  (ref) => GroceryCatalogNotifier(),
);

/// Aisle names derived from the `category` field of real product rows.
final groceryCategoriesProvider = Provider<List<String>>((ref) {
  final AsyncValue<List<GroceryProduct>> catalog = ref.watch(groceryCatalogProvider);
  final Set<String> names = <String>{};
  for (final GroceryProduct product in catalog.valueOrNull ?? const <GroceryProduct>[]) {
    final String? category = product.category;
    if (category != null) names.add(category);
  }
  final List<String> sorted = names.toList()..sort();
  return sorted;
});

int _discountOf(GroceryProduct product) => product.discountPercent;

/// "Deals" are computed from `mrp` versus `currentPrice`; the payload has no
/// `discount_percent`, campaign window or coupon to read them from.
List<GroceryProduct> priceDropsOf(List<GroceryProduct> products) {
  final List<GroceryProduct> drops = products
      .where((GroceryProduct product) => product.hasDiscount && product.canAddToCart)
      .toList()
    ..sort((GroceryProduct a, GroceryProduct b) {
      final int byPercent = _discountOf(b).compareTo(_discountOf(a));
      return byPercent != 0 ? byPercent : b.savings.compareTo(a.savings);
    });
  return drops;
}

/// The browsing list. Category and search go to the endpoint as the real
/// `category` / `search` query params — the list is never filtered in memory.
class GroceryProductsNotifier extends StateNotifier<AsyncValue<List<GroceryProduct>>> {
  GroceryProductsNotifier() : super(const AsyncValue.loading()) {
    _fetch();
  }

  Timer? _debounce;
  int _requestToken = 0;
  String? _category;
  String _search = '';

  String? get activeCategory => _category;

  String get activeSearch => _search;

  void setCategory(String? category) {
    final String trimmed = category?.trim() ?? '';
    final String? next = trimmed.isEmpty || trimmed.toLowerCase() == 'all' ? null : trimmed;
    if (next == _category) return;
    _category = next;
    _debounce?.cancel();
    _fetch();
  }

  void onSearchChanged(String raw) {
    final String next = raw.trim();
    if (next == _search) return;
    _search = next;
    _debounce?.cancel();
    _debounce = Timer(grocerySearchDebounce, _fetch);
  }

  Future<void> refresh() => _fetch();

  Future<void> _fetch() async {
    // A newer request invalidates anything still in flight, so a slow response
    // for an old query can never overwrite the result of a newer one.
    final int token = ++_requestToken;
    final String? category = _category;
    final String search = _search;
    state = const AsyncValue<List<GroceryProduct>>.loading().copyWithPrevious(state);
    try {
      final Map<String, dynamic>? response = await NabinApiService.getGroceryProducts(
        category: category,
        search: search.isEmpty ? null : search,
      );
      if (!mounted || token != _requestToken) return;
      if (response?['success'] == true) {
        state = AsyncValue.data(parseGroceryProducts(response?['products']));
      } else {
        state = AsyncValue.error(_errorOf(response), StackTrace.current);
      }
    } catch (error, stackTrace) {
      if (!mounted || token != _requestToken) return;
      state = AsyncValue.error(error, stackTrace);
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }
}

final groceryProductsProvider =
    StateNotifierProvider<GroceryProductsNotifier, AsyncValue<List<GroceryProduct>>>(
  (ref) => GroceryProductsNotifier(),
);
