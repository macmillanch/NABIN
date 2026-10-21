import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/theme/restaurant_theme.dart';

/// R10 — one dish, exactly as NABIN holds it for the signed-in merchant.
///
/// This screen is read-only on purpose, and the reason is a measured backend state, not a
/// design preference. Every operation a menu-item editor would need was probed against the
/// local development backend on 2026-10-08 (`backend/r10_contract_probe.js`), with a direct
/// PostgreSQL read as the witness so a process-local mutation could not masquerade as a
/// durable one:
///
/// - **Read** — supported and durable. `GET /api/merchant/catalog` (`server.js:6948`) selects
///   `id, sku, name, description, category, price, discount_price, is_available,
///   in_stock_quantity, image_url, updated_at` from `products`, scoped by
///   `.eq('merchant_id', merchant.id)` where the merchant comes from the bearer token. The
///   client sends no restaurant id and no merchant id, so there is nothing editable for a
///   caller to aim at another store.
/// - **Availability** — not available. `POST /api/merchant/:restaurantId/menu/:itemId/toggle`
///   (`server.js:4799`) looks the store up in the in-memory `db.restaurants` list keyed `rest_1`
///   (`server.js:4802`), so a real merchant id 404s "Restaurant not found." before ownership is
///   even evaluated, and the legacy `rest_1` path 403s for a merchant that does not own it. For
///   the one call that does resolve, a fresh HTTP read AND a direct database read both came back
///   unchanged with `updated_at` unmoved. Presenting a switch here would be a control that
///   cannot work, so there is no switch.
/// - **Photo** — still not available, but the reason changed. `POST /api/merchant/:restaurantId/
///   menu/:itemId/photo` used to refuse a real menu row with 404 `MENU_ITEM_NOT_FOUND` because its
///   membership test read the in-memory mirror; it reads the `products` catalogue now, so an
///   owner's upload is accepted. What has not changed is that nothing writes `products.image_url`:
///   `from('products')` appears six times in `src/`, all six of them `.select()` reads, and the
///   asset record goes to `db.saveMediaAsset` — the in-memory mirror. There is no media table (the
///   dev database answers `%media%` with zero tables) and no boot hydrate, so the record dies with
///   the process and this screen's read would never see the photo it uploaded.
/// - **Name / description / category / price / create / delete** — no route. Every menu write
///   path returns the Express 404 page, i.e. no handler is registered. The only price write that
///   exists is `PUT /api/grocery/products/:id/price`, which is entitlement-gated to GROCERY and
///   mutates the in-memory grocery price model plus a price-history audit row; it does not write
///   `products.price`.
///
/// So: no field is drawn as an input, no Save button exists, and the disabled affordances are
/// replaced by an explicit statement of what this app cannot do. Nothing about the dish is
/// inferred — `products` has no `is_veg`, no rating, no review count, no preparation time and no
/// sales columns (verified against the live table, and against `migrations/004`), so none of
/// those appear here.
///
/// `in_stock_quantity` is rendered by the schema's own rule: `-1` means the quantity is not
/// tracked for this kind of item (`migrations/004_missing_entities_schema.sql:28`), which the
/// backend also treats as "not tracked" (`server.js:6687`). It is never shown as `0`.
class RestaurantDishDetailScreen extends StatefulWidget {
  const RestaurantDishDetailScreen({super.key, required this.dishId});

  /// Selects which row of the CALLER'S OWN catalogue to show. It is not an identity: the
  /// server scopes the read by the bearer token, so a dish belonging to another merchant is
  /// simply absent from the answer and lands on the not-found state.
  final String dishId;

  @override
  State<RestaurantDishDetailScreen> createState() => _RestaurantDishDetailScreenState();
}

enum _ReadState { loading, ready, failed, storeUnavailable, notFound, empty }

/// One `products` row, with absent columns kept absent rather than defaulted.
class _Dish {
  const _Dish({
    required this.id,
    required this.sku,
    required this.name,
    required this.description,
    required this.category,
    required this.price,
    required this.discountPrice,
    required this.isAvailable,
    required this.stockQuantity,
    required this.imageUrl,
    required this.updatedAt,
  });

  final String id;
  final String? sku;
  final String? name;
  final String? description;
  final String? category;
  final num? price;
  final num? discountPrice;

  /// Null means the read did not answer the question, which is not the same as `false`.
  final bool? isAvailable;
  final int? stockQuantity;
  final String? imageUrl;
  final DateTime? updatedAt;

  bool get tracksStock => stockQuantity != null && stockQuantity! >= 0;

  static _Dish fromRow(Map<String, dynamic> row) {
    final updated = row['updated_at'];
    return _Dish(
      id: (row['id'] ?? '').toString(),
      sku: _text(row['sku']),
      name: _text(row['name']),
      description: _text(row['description']),
      category: _text(row['category']),
      price: _money(row['price']),
      discountPrice: _money(row['discount_price']),
      isAvailable: row['is_available'] is bool ? row['is_available'] as bool : null,
      stockQuantity: _whole(row['in_stock_quantity']),
      imageUrl: _text(row['image_url']),
      updatedAt: updated is String ? DateTime.tryParse(updated)?.toLocal() : null,
    );
  }

  static String? _text(Object? v) {
    if (v == null) return null;
    final s = v.toString().trim();
    return s.isEmpty ? null : s;
  }

  static num? _money(Object? v) {
    if (v is num) return v;
    if (v == null) return null;
    return num.tryParse(v.toString().trim());
  }

  static int? _whole(Object? v) {
    if (v is num) return v.toInt();
    if (v == null) return null;
    return int.tryParse(v.toString().trim());
  }
}

class _RestaurantDishDetailScreenState extends State<RestaurantDishDetailScreen> {
  _ReadState _state = _ReadState.loading;
  _Dish? _dish;
  String? _detail;
  bool _sessionClosed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  /// The single read this screen makes. No merchant id, no restaurant id, no second endpoint.
  Future<void> _load() async {
    setState(() {
      _state = _ReadState.loading;
      _detail = null;
    });
    final res = await NabinApiService.getMerchantCatalog();
    if (!mounted) return;

    if (res == null) {
      setState(() {
        _dish = null;
        _state = _ReadState.failed;
        _sessionClosed = false;
        _detail = 'No connection to NABIN. This dish has not been loaded, and nothing about it '
            'has changed.';
      });
      return;
    }

    if (res['success'] != true) {
      final code = res['statusCode'] is int ? res['statusCode'] as int : null;
      setState(() {
        _dish = null;
        _state = _ReadState.failed;
        _sessionClosed = code == 401;
        _detail = _explain(code, res['error']);
      });
      return;
    }

    // The platform answered, but not from the catalogue. `degraded: true` comes with an empty
    // list, and calling that "you have no dishes" would tell a merchant their menu is gone.
    if (res['degraded'] == true) {
      setState(() {
        _dish = null;
        _state = _ReadState.storeUnavailable;
        _detail = 'NABIN answered this read without reaching the catalogue, so the dish cannot '
            'be shown. Nothing about it has changed.';
      });
      return;
    }

    final rows = _asMapList(res['products'] ?? res['items']);
    if (rows.isEmpty) {
      setState(() {
        _dish = null;
        _state = _ReadState.empty;
        _detail = null;
      });
      return;
    }

    // Selection happens here, but scoping did not: the server already limited these rows to the
    // bearer token's merchant, so an id belonging to another store is not in this list at all.
    final wanted = widget.dishId.trim();
    Map<String, dynamic>? found;
    for (final row in rows) {
      if (wanted.isEmpty) break;
      if (row['id']?.toString() == wanted || row['sku']?.toString() == wanted) {
        found = row;
        break;
      }
    }
    if (found == null) {
      setState(() {
        _dish = null;
        _state = _ReadState.notFound;
        _detail = null;
      });
      return;
    }

    final picked = found;
    setState(() {
      _dish = _Dish.fromRow(picked);
      _state = _ReadState.ready;
      _sessionClosed = false;
      _detail = null;
    });
  }

  static List<Map<String, dynamic>> _asMapList(Object? raw) {
    if (raw is! List) return const [];
    return raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  String _explain(int? code, Object? serverError) {
    if (code == 401) {
      return 'Your session with NABIN has closed. Sign in again to see this dish.';
    }
    if (code == 403) {
      return 'NABIN does not let this account read that catalogue.';
    }
    final server = serverError is String ? serverError.trim() : '';
    if (server.isNotEmpty) return server;
    if (code != null && code >= 500) {
      return 'NABIN could not read this dish just now. Nothing about it has changed.';
    }
    return 'NABIN refused this read. Nothing about this dish has changed.';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: RestaurantTheme.lightBg,
      appBar: AppBar(
        backgroundColor: RestaurantTheme.headerBand,
        foregroundColor: RestaurantTheme.onHeader,
        title: const Text('Dish detail'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          tooltip: 'Back to menu',
          onPressed: () {
            if (context.canPop()) {
              context.pop();
            } else {
              context.go('/dashboard');
            }
          },
        ),
        actions: [
          IconButton(
            key: const ValueKey('r10-refresh'),
            onPressed: _state == _ReadState.loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Reload this dish from NABIN',
          ),
        ],
      ),
      body: SafeArea(child: _buildBody()),
    );
  }

  Widget _buildBody() {
    switch (_state) {
      case _ReadState.loading:
        return const Center(child: CircularProgressIndicator(color: RestaurantTheme.headerBand));
      case _ReadState.failed:
        return _Message(
          key: const ValueKey('r10-failed'),
          icon: _sessionClosed ? Icons.lock_outline_rounded : Icons.cloud_off_rounded,
          title: _sessionClosed ? 'Your session has closed' : 'Could not load this dish',
          body: _detail ?? '',
          actionLabel: 'Try again',
          onAction: _load,
        );
      case _ReadState.storeUnavailable:
        return _Message(
          key: const ValueKey('r10-unavailable'),
          icon: Icons.storage_rounded,
          title: 'The catalogue could not be read',
          body: _detail ?? '',
          actionLabel: 'Try again',
          onAction: _load,
        );
      case _ReadState.notFound:
        return _Message(
          key: const ValueKey('r10-not-found'),
          icon: Icons.search_off_rounded,
          title: 'This dish is not in your catalogue',
          body: 'NABIN did not return this item for the account you are signed in with. It '
              'either belongs to another store or it is no longer listed.',
          actionLabel: 'Back to menu',
          onAction: () => _goBack(context),
        );
      case _ReadState.empty:
        return _Message(
          key: const ValueKey('r10-empty'),
          icon: Icons.restaurant_menu_rounded,
          title: 'No dishes listed yet',
          body: 'This store has no menu items on NABIN, so there is nothing to open here.',
          actionLabel: 'Back to menu',
          onAction: () => _goBack(context),
        );
      case _ReadState.ready:
        return _buildDish();
    }
  }

  void _goBack(BuildContext context) {
    if (context.canPop()) {
      context.pop();
    } else {
      context.go('/dashboard');
    }
  }

  Widget _buildDish() {
    final d = _dish;
    if (d == null) return const SizedBox.shrink();

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        _PhotoCard(dish: d),
        const SizedBox(height: 14),
        _AvailabilityCard(dish: d),
        const SizedBox(height: 14),
        _SpecsCard(dish: d),
        const SizedBox(height: 14),
        const _EditingCard(),
      ],
    );
  }
}

/// The dish photo, or the honest statement that NABIN holds none.
class _PhotoCard extends StatelessWidget {
  const _PhotoCard({required this.dish});

  final _Dish dish;

  @override
  Widget build(BuildContext context) {
    final url = dish.imageUrl;
    return _Card(
      key: const ValueKey('r10-photo-card'),
      title: 'Dish photo',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (url != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: Image.network(
                url,
                key: const ValueKey('r10-photo'),
                height: 170,
                width: double.infinity,
                fit: BoxFit.cover,
                // A photo that is stored but did not come back is not a dish with no photo, so
                // the two say different things.
                errorBuilder: (context, error, stackTrace) => const _PhotoPlaceholder(
                  key: ValueKey('r10-photo-unloaded'),
                  caption: 'The photo could not be loaded from NABIN',
                ),
              ),
            )
          else
            const _PhotoPlaceholder(
              key: ValueKey('r10-no-photo'),
              caption: 'No photo on NABIN',
            ),
          const SizedBox(height: 10),
          const Text(
            'Menu-item photos cannot be changed from this app yet, so this picture is shown as '
            'NABIN holds it.',
            style: TextStyle(fontSize: 12.5, height: 1.4, color: RestaurantTheme.secondaryText),
          ),
        ],
      ),
    );
  }
}

/// The dish photo slot when there is no picture to show, or it did not arrive.
class _PhotoPlaceholder extends StatelessWidget {
  const _PhotoPlaceholder({super.key, required this.caption});

  final String caption;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 120,
      width: double.infinity,
      decoration: BoxDecoration(
        color: RestaurantTheme.lightBg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: RestaurantTheme.border),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.image_not_supported_outlined,
              size: 26, color: RestaurantTheme.secondaryText),
          const SizedBox(height: 6),
          Text(caption,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800,
                  color: RestaurantTheme.secondaryText)),
        ],
      ),
    );
  }
}

/// Availability as a stated fact from the row — never a control the platform cannot honour.
class _AvailabilityCard extends StatelessWidget {
  const _AvailabilityCard({required this.dish});

  final _Dish dish;

  @override
  Widget build(BuildContext context) {
    final available = dish.isAvailable;
    final Color tone = available == null
        ? RestaurantTheme.secondaryText
        : (available ? RestaurantTheme.vegGreen : RestaurantTheme.nonVegRed);
    final String label = available == null
        ? 'Not stated by NABIN'
        : (available ? 'Available for orders' : 'Not available for orders');

    return _Card(
      key: const ValueKey('r10-availability-card'),
      title: 'Availability',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: tone.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: tone.withValues(alpha: 0.45)),
                ),
                child: Text(label,
                    style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w900, color: tone)),
              ),
            ],
          ),
          const SizedBox(height: 10),
          const Text(
            'Availability shows the state NABIN holds for this dish. It cannot be switched from '
            'this app: the platform does not offer this store a menu-item availability update, so '
            'a switch here would change nothing on NABIN.',
            style: TextStyle(fontSize: 12.5, height: 1.4, color: RestaurantTheme.secondaryText),
          ),
        ],
      ),
    );
  }
}

/// Every value on this card is a column the read returned. A column that came back empty is
/// drawn as empty, never as a plausible substitute.
const String _kMissing = '— Not available';

class _SpecsCard extends StatelessWidget {
  const _SpecsCard({required this.dish});

  final _Dish dish;

  @override
  Widget build(BuildContext context) {
    final d = dish;
    return _Card(
      key: const ValueKey('r10-specs-card'),
      title: 'Dish details',
      child: Column(
        children: [
          _Row(label: 'Name', value: d.name ?? _kMissing),
          _Row(label: 'Description', value: d.description ?? _kMissing),
          _Row(label: 'Category', value: d.category ?? _kMissing),
          _Row(label: 'Price', value: d.price == null ? _kMissing : _rupees(d.price!)),
          _Row(
            label: 'Discounted price',
            value: d.discountPrice == null ? _kMissing : _rupees(d.discountPrice!),
          ),
          _Row(label: 'SKU', value: d.sku ?? _kMissing),
          _Row(
            label: 'Stock quantity',
            value: d.tracksStock ? '${d.stockQuantity}' : 'Not tracked for this dish',
          ),
          _Row(
            label: 'Last changed on NABIN',
            value: d.updatedAt == null ? _kMissing : _stamp(d.updatedAt!),
          ),
        ],
      ),
    );
  }

  static String _rupees(num amount) {
    final asWhole = amount == amount.roundToDouble();
    return asWhole ? '₹${amount.toInt()}' : '₹$amount';
  }

  static String _stamp(DateTime at) {
    String two(int v) => v.toString().padLeft(2, '0');
    return '${two(at.day)}/${two(at.month)}/${at.year} ${two(at.hour)}:${two(at.minute)}';
  }
}

/// What this app can and cannot do with a menu item, stated plainly.
class _EditingCard extends StatelessWidget {
  const _EditingCard();

  @override
  Widget build(BuildContext context) {
    return const _Card(
      key: ValueKey('r10-editing-card'),
      title: 'Editing this dish',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'This screen reads the dish out of your own catalogue on NABIN and shows it back. '
            'Nothing on it can be edited, because the platform does not currently offer menu-item '
            'editing to this app:',
            style: TextStyle(fontSize: 12.5, height: 1.45, color: RestaurantTheme.charcoal),
          ),
          SizedBox(height: 10),
          _Limitation('Name', 'View only'),
          _Limitation('Description', 'View only'),
          _Limitation('Price', 'View only'),
          _Limitation('Category', 'View only'),
          _Limitation('Availability', 'View only'),
          _Limitation('Photo', 'View only'),
          _Limitation('Add a dish', 'Not available in this app'),
          _Limitation('Remove a dish', 'Not available in this app'),
          SizedBox(height: 10),
          Text(
            'There is no Save button here because there is no change this app can make. Orders '
            'still use whatever NABIN holds for this dish.',
            style: TextStyle(fontSize: 12.5, height: 1.45, color: RestaurantTheme.secondaryText),
          ),
        ],
      ),
    );
  }
}

class _Limitation extends StatelessWidget {
  const _Limitation(this.field, this.state);

  final String field;
  final String state;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(field,
                style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700,
                    color: RestaurantTheme.charcoal)),
          ),
          Text(state,
              textAlign: TextAlign.right,
              style: const TextStyle(fontSize: 12.5, color: RestaurantTheme.secondaryText)),
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label.toUpperCase(),
              style: const TextStyle(
                  fontSize: 10.5, fontWeight: FontWeight.w900, letterSpacing: 0.6,
                  color: RestaurantTheme.secondaryText)),
          const SizedBox(height: 2),
          Text(value,
              style: TextStyle(
                  fontSize: 13.5,
                  height: 1.4,
                  fontWeight: value == _kMissing ? FontWeight.w500 : FontWeight.w700,
                  color: value == _kMissing
                      ? RestaurantTheme.secondaryText
                      : RestaurantTheme.charcoal)),
        ],
      ),
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({super.key, required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: RestaurantTheme.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: RestaurantTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900,
                  color: RestaurantTheme.charcoal)),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({
    super.key,
    required this.icon,
    required this.title,
    required this.body,
    required this.actionLabel,
    required this.onAction,
  });

  final IconData icon;
  final String title;
  final String body;
  final String actionLabel;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 38, color: RestaurantTheme.secondaryText),
            const SizedBox(height: 12),
            Text(title,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900,
                    color: RestaurantTheme.charcoal)),
            if (body.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(body,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 12.5, height: 1.4,
                      color: RestaurantTheme.secondaryText)),
            ],
            const SizedBox(height: 14),
            OutlinedButton(
              key: const ValueKey('r10-message-action'),
              onPressed: onAction,
              child: Text(actionLabel),
            ),
          ],
        ),
      ),
    );
  }
}
