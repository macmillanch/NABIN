import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/restaurant_theme.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/network/session_manager.dart';
import '../../domain/restaurant_profile_form.dart';

/// Whether a list on this screen has actually been fetched.
///
/// `failed` is kept distinct from `empty` on purpose: "we could not reach the platform" and
/// "you have no items yet" ask for different sentences, and collapsing them is how an outage
/// gets rendered to a merchant as an empty store.
///
/// `unreadable` is the third sentence the platform itself forces on this screen: the catalogue
/// route answers `success: true` with an empty list and `degraded: true` when it could not reach
/// Postgres, so "your menu is empty" would be a lie told from a field that says the opposite.
enum _ListState { loading, ready, failed, unreadable }

/// What this list prints when a column the dish is supposed to speak through is empty.
///
/// The alternative was a plausible value — a name, a category, ₹0 — and a plausible value in a
/// merchant's own console reads as a statement the merchant made. This is the same sentence the
/// dish detail uses for the same reason.
const String _kMissing = '— Not available';

/// A metric the platform did not state, in the merchant's own words.
///
/// Deliberately not `0`. The Dashboard used to paint `₹3,450.00` and `28` for figures no read
/// ever returned, and a zero would have been the same mistake in a quieter font: this route only
/// answers `activeOrdersCount` and `todaySales` when its order read ran (`server.js:4649-4655`),
/// so an envelope without them is a dashboard that says nothing, not a store that sold nothing.
const String _kMetricNotStated = 'Not stated by NABIN';

class RestaurantMainShell extends StatefulWidget {
  const RestaurantMainShell({super.key});

  @override
  State<RestaurantMainShell> createState() => _RestaurantMainShellState();
}

class _RestaurantMainShellState extends State<RestaurantMainShell> {
  int _currentTab = 0; // 0: Dashboard, 1: Orders (KDS), 2: Menu/Inventory, 3: Analytics/Finance, 4: Profile

  /// The services this merchant is actually authorized to operate, as the backend said.
  ///
  /// This used to be a local switch — `_merchantMode = 'RESTAURANT'` flipped by tapping a row
  /// in the profile tab — which meant the app decided, on-device, whether you were a grocery
  /// store. It was cosmetic, not a control (the server never saw it), and it was wrong in both
  /// directions: a restaurant-only partner could appear to be running an instamart store, and a
  /// genuine hybrid partner had no way to see both. Now it is a list the platform produced.
  List<String> _services = const [];
  String _merchantMode = 'RESTAURANT';

  /// Read from the merchant's own record. There is no merchant open/close endpoint yet, so the
  /// control below is deliberately non-interactive rather than a switch that only looks live.
  bool? _storeIsOpen;
  String _ordersFilter = 'Active';
  String _restaurantId = '';

  Map<String, dynamic>? _profile;
  bool _profileFailed = false;

  _ListState _dashboardState = _ListState.loading;

  /// The two numbers the merchant dashboard route computes, and nothing else.
  ///
  /// Both are nullable because a card that painted `0` for a field the response never carried
  /// would be inventing a figure. `_salesCurrencies` holds the distinct `currency` codes among
  /// the rows that were summed — the sum itself states no currency, and `orders.currency` is a
  /// free-text column with an `INR` default (`migrations/001_central_schema.sql:202`), so the
  /// only honest designation is one the returned rows actually agree on.
  int? _activeOrdersCount;
  double? _salesAmount;
  List<String> _salesCurrencies = const [];

  /// The platform's own words when the read was refused, kept so the failure state can say
  /// which of 401/403/5xx it was rather than flattening them into "unreachable".
  String? _dashboardReason;

  /// One dashboard read in flight at a time.
  ///
  /// The route is a plain GET, so nothing on the server would collapse a burst of taps into one
  /// query; the guard lives here instead.
  bool _dashboardInFlight = false;

  _ListState _ordersState = _ListState.loading;
  List<Map<String, dynamic>> _orders = const [];

  /// Order ids with a kitchen advance already in flight.
  ///
  /// The status route deduplicates retries only when the caller sends an `Idempotency-Key`
  /// (`server.js:4691`), and this app does not send one, so a double-tap was two POSTs and the
  /// second came back as a refusal the merchant could not explain.
  final Set<String> _advancingOrderIds = <String>{};

  /// Menu state. `_menuItems` was once a hardcoded list of five dishes with Unsplash photos,
  /// shown to every store that opened this screen — the menu tab was a simulator, not a view.
  _ListState _menuState = _ListState.loading;
  List<Map<String, dynamic>> _menuItems = const [];

  // --- Restaurant discovery metadata (the merchant's own declaration) -----------------
  //
  // These three fields (`cuisines`, cover image, standard delivery window) are what turns
  // the Customer Food card from a fixture into a statement the restaurant made. Before this
  // flow existed the app never read or wrote them: `GET /api/merchant/services` returns a
  // profile WITHOUT them, and nothing here drove `PATCH /api/merchant/:id/profile`, so the
  // columns stayed NULL and every customer saw a kitchen that declared nothing.
  //
  // `_metaState` tracks the READ (loading/ready/failed) so a store that has not declared
  // anything is drawn as an empty editor, not as a load error, and a store the platform
  // could not reach is drawn as unreachable rather than blank.
  _ListState _metaState = _ListState.loading;
  List<String> _cuisines = const [];
  final TextEditingController _coverCtrl = TextEditingController();
  final TextEditingController _deliveryCtrl = TextEditingController();
  final TextEditingController _newCuisineCtrl = TextEditingController();
  bool _savingMeta = false;

  @override
  void initState() {
    super.initState();
    _initMerchant();
  }

  @override
  void dispose() {
    _coverCtrl.dispose();
    _deliveryCtrl.dispose();
    _newCuisineCtrl.dispose();
    super.dispose();
  }

  Future<void> _initMerchant() async {
    final user = SessionManager.instance.currentUser;
    final fromSession = user?['restaurantId'] as String? ?? user?['id'] as String?;
    _restaurantId = fromSession ?? '';

    // Who this store is, and what it is allowed to sell: one authenticated read, no id sent.
    final svc = await NabinApiService.getMerchantServices();
    if (!mounted) return;

    if (svc == null || svc['success'] != true) {
      // A refusal or an outage is not "a store with no name". Say which one it was.
      setState(() => _profileFailed = true);
    } else {
      final services = (svc['services'] as List?)?.map((e) => e.toString()).toList() ?? const [];
      setState(() {
        _profile = svc['profile'] is Map
            ? Map<String, dynamic>.from(svc['profile'] as Map)
            : <String, dynamic>{};
        _services = services;
        _merchantMode = services.contains('RESTAURANT') ? 'RESTAURANT' : (services.isNotEmpty ? services.first : 'RESTAURANT');
        _storeIsOpen = svc['isOpen'] is bool ? svc['isOpen'] as bool : null;
        if (svc['merchantId'] != null) _restaurantId = svc['merchantId'].toString();
      });
    }

    await _loadOrders();
    await _loadMenu();
    // The dashboard read serves both the metrics below and the Profile editor's seed row, so it
    // runs once per boot whatever services this merchant holds.
    await _loadMerchantDashboard();
  }

  /// The one authenticated read of `GET /api/merchant/:restaurantId/dashboard`.
  ///
  /// It serves two consumers, and asking the platform twice for the same response would be the
  /// sloppier design: the Dashboard tab takes `activeOrdersCount` and `todaySales` from it, and
  /// the Profile editor seeds `cuisines` / cover image / delivery window from its `restaurant`
  /// row — there is no dedicated merchant-profile GET, which is why this route is the authenticated
  /// read of the merchant's own row (`server.js:4621`).
  ///
  /// The id is the session's merchant id, resolved at boot from the bearer token's own record
  /// (`svc['merchantId']`, `server.js:4587`), never from an editable field; and the route answers
  /// 403 for a path id that is not the caller's own merchant (`server.js:4634`), so the read is
  /// scoped server-side rather than by anything here.
  Future<void> _loadMerchantDashboard() async {
    if (_dashboardInFlight) return;
    if (_restaurantId.isEmpty) {
      // No store identity: the metrics below would be a claim about an account this app cannot
      // name, and the Profile editor would be an empty form pretending to be a saved one.
      setState(() {
        _dashboardState = _ListState.failed;
        _metaState = _ListState.failed;
      });
      return;
    }

    setState(() {
      _dashboardState = _ListState.loading;
      if (_services.contains('RESTAURANT')) _metaState = _ListState.loading;
    });
    _dashboardInFlight = true;
    final res = await NabinApiService.getMerchantDashboard(_restaurantId);
    _dashboardInFlight = false;
    if (!mounted) return;

    // A refusal, an outage, or no answer at all is not "a store with no sales". Drop the figures
    // rather than carry stale ones forward, and keep the platform's words for the failure state.
    if (res == null || res['success'] != true) {
      setState(() {
        _activeOrdersCount = null;
        _salesAmount = null;
        _salesCurrencies = const [];
        _dashboardReason = res?['error']?.toString();
        _dashboardState = _ListState.failed;
        if (_services.contains('RESTAURANT')) _metaState = _ListState.failed;
      });
      return;
    }

    // Read defensively: a body whose `orders` key is anything but a list is a response this
    // screen cannot total currencies from, and `as List?` on one would throw out of the read
    // instead of leaving the currency note to say that nothing stated one.
    final rawRows = res['orders'];
    final rows = rawRows is List ? rawRows.whereType<Map>().toList() : const <Map>[];
    setState(() {
      // `activeOrdersCount` is a length and `todaySales` a sum — both arrive as JSON numbers, and
      // anything else the response might carry in those keys is not a value this screen can read,
      // so it stays null and paints as "not stated" instead of becoming a guess.
      final statedCount = res['activeOrdersCount'];
      final statedSales = res['todaySales'];
      _activeOrdersCount = statedCount is num ? statedCount.toInt() : null;
      _salesAmount = statedSales is num ? statedSales.toDouble() : null;
      _salesCurrencies = rows
          .where((row) => !_kSalesExcludedStates.contains((row['order_state'] ?? '').toString()))
          .map((row) => (row['currency'] ?? '').toString().trim())
          .where((code) => code.isNotEmpty)
          .toSet()
          .toList()
        ..sort();
      _dashboardReason = null;
      _dashboardState = _ListState.ready;
    });

    if (!_services.contains('RESTAURANT')) {
      setState(() => _metaState = _ListState.ready);
      return;
    }
    if (res['restaurant'] is! Map) {
      setState(() => _metaState = _ListState.failed);
      return;
    }
    _applyMetaFromRow(Map<String, dynamic>.from(res['restaurant'] as Map));
    setState(() => _metaState = _ListState.ready);
  }

  /// Seed the form from a merchant row. Accepts both the snake_case read (dashboard) and
  /// the camelCase write (the PATCH response), so a save reflects the stored row through
  /// the same path a fresh load does.
  void _applyMetaFromRow(Map<String, dynamic> row) {
    final rawCuisines = row['cuisines'];
    _cuisines = rawCuisines is List
        ? rawCuisines.map((e) => e.toString()).toList()
        : const [];
    final cover = row['cover_image_url'] ?? row['coverImageUrl'];
    _coverCtrl.text = cover == null ? '' : cover.toString();
    final minutes = row['standard_delivery_minutes'] ?? row['standardDeliveryMinutes'];
    _deliveryCtrl.text = minutes == null ? '' : minutes.toString();
  }

  /// Validate the form and send the authenticated PATCH, then reflect the server's row.
  Future<void> _saveRestaurantProfile() async {
    final validation = buildProfilePatchBody(
      cuisines: _cuisines,
      coverUrl: _coverCtrl.text,
      deliveryMinutes: _deliveryCtrl.text,
    );
    if (!validation.isValid) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(validation.error!), duration: const Duration(seconds: 3)),
      );
      return;
    }
    if (_restaurantId.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No restaurant identity to save against.')),
      );
      return;
    }

    setState(() => _savingMeta = true);
    final res = await NabinApiService.updateMerchantRestaurantProfile(
      restaurantId: _restaurantId,
      patch: validation.body!,
    );
    if (!mounted) return;
    setState(() => _savingMeta = false);

    // A refusal or an outage is NOT a save. Keep the last-known values on screen and say
    // what the platform answered — never flip the form to look like it persisted.
    if (res == null || res['success'] != true || res['restaurant'] is! Map) {
      final reason = res?['error'] ?? 'NABIN could not save these details.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Not saved: $reason'), duration: const Duration(seconds: 4)),
      );
      return;
    }

    _applyMetaFromRow(Map<String, dynamic>.from(res['restaurant'] as Map));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Saved. Customers will now see these details on your listing.'),
        duration: Duration(seconds: 3),
      ),
    );
  }

  void _addCuisine() {
    final error = cuisineAddError(_cuisines, _newCuisineCtrl.text);
    if (error != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error), duration: const Duration(seconds: 3)),
      );
      return;
    }
    setState(() {
      _cuisines = [..._cuisines, _newCuisineCtrl.text.trim()];
      _newCuisineCtrl.clear();
    });
  }

  void _removeCuisine(String name) {
    setState(() => _cuisines = _cuisines.where((c) => c != name).toList());
  }

  Future<void> _loadOrders() async {
    if (_restaurantId.isEmpty) {
      // Nothing to read: the session never resolved a store, so the list below would be claiming
      // an empty order book on no evidence at all.
      setState(() => _ordersState = _ListState.failed);
      return;
    }
    setState(() => _ordersState = _ListState.loading);
    final res = await NabinApiService.getMerchantOrders(_restaurantId);
    if (!mounted) return;
    // A refusal or an outage is not "no orders", and the rows we already had are not proof of
    // what is on the platform now. Drop them and say which of the two it was.
    if (res == null || res['success'] != true) {
      setState(() {
        _orders = const [];
        _ordersState = _ListState.failed;
      });
      return;
    }
    final rows = (res['orders'] as List?) ?? const [];
    setState(() {
      _orders = rows.whereType<Map>().map((row) => _normalizeOrder(row.cast<String, dynamic>())).toList();
      _ordersState = _ListState.ready;
    });
  }

  /// One merchant order row, in the columns the read actually returns.
  ///
  /// `GET /api/merchant/:restaurantId/orders` answers with PostgreSQL rows (`OrderRepository.js:449`
  /// selects `*, order_lines(*)`), and this card used to read `status`, `items`, `time`,
  /// `customer`, `type`, `driver` and `pickupOtp` — seven keys that appear in no order row the
  /// probe fetched from either merchant. Every one of them came back `null`, and the card filled
  /// the holes: a default `'PREPARING'` pill, and a driver line plus an `OTP: null` badge that
  /// said a rider had been assigned and a code existed. `pickup_otp` is a column of `jobs`
  /// (`migrations/001_central_schema.sql:160`), never of `orders`.
  ///
  /// What is kept here is only what the contract carries, and a blank column stays `null` — the
  /// card decides the sentence, this decides the value.
  Map<String, dynamic> _normalizeOrder(Map<String, dynamic> row) {
    final meta = row['metadata'] is Map ? Map<String, dynamic>.from(row['metadata'] as Map) : const <String, dynamic>{};
    final rawLines = (row['lines'] ?? row['order_lines']) is List ? (row['lines'] ?? row['order_lines']) as List : const [];
    return <String, dynamic>{
      'id': (row['id'] ?? '').toString(),
      'number': _textOf(row['order_number']),
      'state': _textOf(row['order_state']),
      'serviceType': _textOf(row['service_type']),
      'placedAt': DateTime.tryParse((row['created_at'] ?? '').toString()),
      'customerName': _textOf(meta['customerName']),
      'channel': _textOf(row['order_channel'] ?? meta['orderChannel']),
      'tableNumber': _textOf(row['table_number'] ?? meta['tableNumber']),
      'pickupTime': _textOf(row['pickup_time'] ?? meta['pickupTime']),
      'lines': rawLines.whereType<Map>().map((line) => _normalizeOrderLine(line.cast<String, dynamic>())).toList(),
    };
  }

  /// One line of an order — the name and count the platform snapshotted at checkout.
  Map<String, dynamic> _normalizeOrderLine(Map<String, dynamic> line) {
    return <String, dynamic>{
      'name': _textOf(line['product_name_snapshot']),
      'quantity': _moneyOf(line['quantity']),
      'unit': _textOf(line['unit_snapshot']),
    };
  }

  /// The states the platform considers finished.
  ///
  /// `order_state` is defined over exactly nine values (`018_order_state_lines_and_checkout_linkage.sql`),
  /// and these three have no outgoing transition (`:448-450`). The card compared against
  /// `'COMPLETED'` instead — a value the enum does not contain — so the test was true for every
  /// order forever and the "Active" count was just the length of the list.
  static const Set<String> _kTerminalStates = <String>{'DELIVERED', 'REJECTED', 'CANCELLED'};

  /// The states the dashboard route leaves out of its money sum — and they are not the terminal
  /// set above. `DELIVERED` orders count toward `todaySales` (`server.js:4646`) while being
  /// excluded from `activeOrdersCount` (`:4644`), so conflating the two would understate takings.
  static const Set<String> _kSalesExcludedStates = <String>{'CANCELLED', 'REJECTED'};

  /// Every state the platform lists as readable on an order row.
  static const Set<String> _kKnownStates = <String>{
    'RECEIVED', 'ACCEPTED', 'PREPARING', 'PACKING', 'READY_FOR_PICKUP',
    'PICKED_UP', 'DELIVERED', 'REJECTED', 'CANCELLED',
  };

  /// The one kitchen advance the platform accepts, by the state the order is in now.
  ///
  /// Read from the transition legality function (`018:429-441`) and the write route's approved
  /// set (`server.js:4720`). The button used to walk `NEW → ACCEPTED → PREPARING → READY →
  /// COMPLETED`; `READY` and `COMPLETED` are not states at all, so the last two taps each sent a
  /// POST the backend answered with 400, and the card kept offering "Handover to Rider" after the
  /// kitchen's part was over — a step only the driver's own flow performs.
  static const Map<String, String> _kNextKitchenState = <String, String>{
    'RECEIVED': 'ACCEPTED',
    'ACCEPTED': 'PREPARING',
    'PREPARING': 'READY_FOR_PICKUP',
    'PACKING': 'READY_FOR_PICKUP',
  };

  /// The label for an advance, keyed by the state it moves the order into.
  static const Map<String, String> _kAdvanceLabel = <String, String>{
    'ACCEPTED': 'Accept order',
    'PREPARING': 'Start cooking',
    'READY_FOR_PICKUP': 'Mark ready for pickup',
  };

  bool _isActiveOrder(Map<String, dynamic> order) => !_kTerminalStates.contains(order['state']);

  /// The orders the KDS list shows right now.
  ///
  /// The two chips above the list wrote `_ordersFilter` and nothing read it, so "Active Queue" and
  /// "Completed History" selected a label and left the same list on screen. They filter now.
  List<Map<String, dynamic>> get _visibleOrders {
    final bool showHistory = _ordersFilter == 'History';
    return _orders.where((o) => _isActiveOrder(o) != showHistory).toList();
  }

  /// The KDS ticket prints the time the platform stamped the order, in the merchant's own
  /// timezone. `order['time']` was a key no row carries, so this line used to paint `null`.
  static final DateFormat _kPlacedAtFormat = DateFormat('d MMM, h:mm a');

  /// What the pill says about a state, including the case where the row said nothing.
  static String _stateLabel(String? state) {
    if (state == null) return 'STATE NOT STATED';
    if (!_kKnownStates.contains(state)) return 'UNRECOGNISED STATE: $state';
    return state.replaceAll('_', ' ');
  }

  /// The pill's colours for a state: background, text, border, border width.
  ///
  /// Anything the enum does not define — including a row that carried no `order_state` at all —
  /// gets the quiet neutral pair. A loud pill is a claim that the platform asked the kitchen for
  /// something, and an unread state has not asked for anything.
  static (Color, Color, Color, double) _pillOf(String? state) {
    if (state == 'RECEIVED') {
      return (const Color(0xFFFFE4E6), const Color(0xFFE11D48), const Color(0xFFFDA4AF), 2.0);
    }
    if (state == 'READY_FOR_PICKUP') {
      return (const Color(0xFFDCFCE7), const Color(0xFF16A34A), const Color(0xFF86EFAC), 2.0);
    }
    if (state == 'ACCEPTED' || state == 'PREPARING' || state == 'PACKING' || state == 'PICKED_UP') {
      return (const Color(0xFFFEF3C7), const Color(0xFFD97706), const Color(0xFFFCD34D), 1.5);
    }
    return (const Color(0xFFF1F5F9), RestaurantTheme.secondaryText, RestaurantTheme.border, 1.0);
  }

  /// The merchant's own catalogue rows — for a restaurant these ARE the menu items.
  ///
  /// The read carries no restaurant id and no merchant id: `GET /api/merchant/catalog` scopes
  /// itself to the bearer token's merchant (`server.js:6961`), so this list cannot be aimed at
  /// another store.
  Future<void> _loadMenu() async {
    setState(() => _menuState = _ListState.loading);
    final res = await NabinApiService.getMerchantCatalog();
    if (!mounted) return;
    if (res == null) {
      setState(() => _menuState = _ListState.failed);
      return;
    }
    if (res['success'] != true) {
      setState(() => _menuState = _ListState.failed);
      return;
    }
    // The platform answered, but not from the catalogue, and it says so with an empty list plus
    // `degraded: true`. Rendering that as "no dishes listed yet" would tell a merchant their menu
    // is gone when the truth is that NABIN could not read it.
    if (res['degraded'] == true) {
      setState(() {
        _menuItems = const [];
        _menuState = _ListState.unreadable;
      });
      return;
    }
    setState(() {
      _menuItems = List<Map<String, dynamic>>.from((res['products'] ?? res['items'] ?? []) as List);
      _menuState = _ListState.ready;
    });
  }

  /// Switch between services the platform has actually granted this merchant.
  ///
  /// The header switcher used to write `_merchantMode` from a tap with no check at all, so any
  /// partner could put their own app into "Grocery" mode regardless of what they sell. That
  /// was never a control — the server did not consult it — and it was misleading in the one
  /// way that matters: a restaurant partner could believe they were looking at a grocery
  // console, and the writes they then attempted were refused. The list below is the backend's
  /// answer, and nothing here pretends to be entitled to a service it was not granted.
  void _selectService(String mode) {
    final granted = mode == 'RESTAURANT' ? _services.contains('RESTAURANT') : _services.contains('INSTAMART');
    if (!granted) {
      final label = mode == 'RESTAURANT' ? 'Restaurant' : 'Instamart';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('This merchant account is not authorized for $label on NABIN.'),
          duration: const Duration(seconds: 3),
        ),
      );
      return;
    }
    setState(() => _merchantMode = mode);
  }

  /// Derived from the merchant record, never from a tap.
  ///
  /// `_storeStatus` used to be a plain string initialised to `'OPEN'` and rewritten by
  /// `onTap: () => setState(...)`, so pressing "Closed" told the partner they were closed
  /// while the platform — and every customer searching for them — still saw an open store.
  /// Nothing was sent and nothing was stored. Until there is a merchant open/close endpoint,
  /// the real value is displayed and the control is explicit about not being live.
  String get _storeStatus {
    if (_storeIsOpen == null) return 'UNKNOWN';
    return _storeIsOpen! ? 'OPEN' : 'CLOSED';
  }

  String get _displayName {
    final name = _profile?['name'];
    return (name == null || name.toString().trim().isEmpty) ? '' : name.toString().trim();
  }

  // The menu is the merchant's own catalogue rows, loaded in `_loadMenu()` from
  // `GET /api/merchant/catalog`. What used to sit here was a `final` list of five dishes —
  // biryani, paneer tikka, naan, chaap, gulab jamun — with prices, descriptions and Unsplash
  // photo URLs, offered to every restaurant that opened the app. A partner could not tell
  // their own menu from a prop, and toggling availability on those rows would have flipped
  // stock on items the platform never priced.

  // The "NEW INCOMING ORDER" dialog that lived here was a generator, not a view. It showed
  // order `#1043`, a customer named "David K.", two line items and a note nobody had written,
  // and its Accept button inserted all of that into `_orders` locally. It was wired to the
  // AppBar notification bell and to a button labelled "Simulate Order", so a partner could
  // manufacture a booked order that the platform had never created and then cook food for it.
  // Incoming orders arrive from the merchant order read; nothing here may invent one.


  // 1. DASHBOARD TAB
  Widget _buildDashboardTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Store Status Bar
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: RestaurantTheme.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: RestaurantTheme.border),
              boxShadow: [
                BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 6, offset: const Offset(0, 2)),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    // `Flexible`, not a bare Column: the caption below is a whole sentence, and a
                    // single unconstrained Column in a `spaceBetween` Row is how this card used to
                    // overflow a 390dp phone. Layout only — the state and its wording are unchanged.
                    Flexible(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Store Status', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                          const SizedBox(height: 2),
                          // `merchants.is_open` is a BOOLEAN (`001_central_schema.sql:81`), so the
                          // platform has two states, and the third sentence this line used to paint
                          // — "Temporarily paused (kitchen busy)" — was a reason nobody had given.
                          // It appeared whenever the read could not answer, which is the one case
                          // where this screen knows nothing at all.
                          Text(
                            _storeStatus == 'OPEN'
                                ? 'Open on NABIN, accepting orders'
                                : _storeStatus == 'CLOSED'
                                    ? 'Currently closed'
                                    : 'Status not readable from NABIN right now',
                            style: const TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: _storeStatus == 'OPEN'
                            ? RestaurantTheme.vegGreen.withValues(alpha: 0.12)
                            : _storeStatus == 'CLOSED'
                                ? const Color(0xFFF1F5F9)
                                : RestaurantTheme.warning.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        _storeStatus,
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w900,
                          color: _storeStatus == 'OPEN'
                              ? RestaurantTheme.vegGreen
                              : _storeStatus == 'CLOSED'
                                  ? RestaurantTheme.secondaryText
                                  : const Color(0xFFB45309),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                // Two states, because the column behind this has two values. The third row that
                // used to sit here — 'PAUSED' — offered a state NABIN does not store, so a partner
                // staring at it could only conclude the app was broken when the pill said OPEN.
                Row(
                  children: [
                    _buildStatusChoice('OPEN', Icons.check_circle_outline, RestaurantTheme.vegGreen),
                    const SizedBox(width: 8),
                    _buildStatusChoice('CLOSED', Icons.cancel_outlined, RestaurantTheme.secondaryText),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          _buildDashboardMetricsSection(),
          const SizedBox(height: 20),

          // Kitchen Queue Header
          //
          // Two removals, both about what this line is entitled to say. "Live" went: the rows
          // under it come from one authenticated read this screen asked for, and this app opens no
          // stream to a merchant console, so the word claimed a connection the code does not have.
          // The locally-counted `n ACTIVE` badge went with it — the platform answers that question
          // itself as `activeOrdersCount`, which the card above paints, and counting the visible
          // rows again here was a second answer invented from a partial list.
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Flexible(
                child: Text(
                  'Kitchen Queue',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
                ),
              ),
              TextButton(
                onPressed: () => setState(() => _currentTab = 1),
                child: const Text('View All (KDS) →', style: TextStyle(fontWeight: FontWeight.w800, color: RestaurantTheme.neonOrange, fontSize: 12)),
              ),
            ],
          ),
          const SizedBox(height: 10),

          // The queue body states its own condition, because an absent row and an unreadable
          // platform look identical when the code simply maps over a list that failed to fill.
          if (_ordersState == _ListState.loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 18),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_ordersState == _ListState.failed)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(
                child: Text(
                  'NABIN could not be reached, so this queue is not a statement about your orders. Use Refresh on the Orders tab to try again.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: RestaurantTheme.secondaryText),
                ),
              ),
            )
          else if (!_orders.any(_isActiveOrder))
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(
                child: Text(
                  'No orders waiting in the kitchen from NABIN.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: RestaurantTheme.secondaryText),
                ),
              ),
            )
          else
            ..._orders.where(_isActiveOrder).map((order) => _buildStitchOrderCard(order)),
        ],
      ),
    );
  }

  Widget _buildStatusChoice(String statusKey, IconData icon, Color color) {
    final isSelected = _storeStatus == statusKey;
    return Expanded(
      child: InkWell(
        // Tapping used to rewrite a Dart string, which showed the partner whichever state they
        // had just pressed while the platform — and every customer searching this store — kept
        // showing the stored one. There is no merchant open/close endpoint yet, so this reports
        // that plainly instead of mimicking a control that works.
        onTap: () {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Store open/close is set on NABIN and is not changeable from this app yet.'),
              duration: Duration(seconds: 3),
            ),
          );
        },
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: isSelected ? color.withValues(alpha: 0.12) : RestaurantTheme.lightBg,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: isSelected ? color : RestaurantTheme.border, width: 1.2),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 14, color: isSelected ? color : RestaurantTheme.secondaryText),
              const SizedBox(width: 4),
              Text(
                statusKey,
                style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: isSelected ? color : RestaurantTheme.secondaryText),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// The Dashboard's figures, in whichever state the one read that produces them left them in.
  ///
  /// Three cards used to sit in this slot and none of them came from anywhere: `TODAY'S REVENUE
  /// ₹3,450.00` with `+15% vs yesterday`, then `TOTAL ORDERS 28` with `3 active in kitchen
  /// pipeline`, then `AVG. PREP TIME 16 mins` with `Optimal kitchen efficiency`. Every one of
  /// them was typed into the source, so a partner read their takings, their order book and their
  /// kitchen's speed off numbers that had no relation to the platform. The first two have a real
  /// field behind them once the read is wired; the third has no column, no route and no
  /// calculation anywhere, so it is gone rather than replaced with something equally plausible.
  ///
  /// What remains is the two values `GET /api/merchant/:restaurantId/dashboard` actually computes
  /// (`server.js:4644-4647`), and nothing else this screen was told to look like.
  Widget _buildDashboardMetricsSection() {
    if (_dashboardState == _ListState.loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 18),
        child: Center(child: CircularProgressIndicator()),
      );
    }

    if (_dashboardState == _ListState.failed) {
      // Not "a day with no sales". The read was refused, or did not answer, and the difference
      // between those two sentences is the whole reason this screen exists.
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
            const Text(
              'NABIN could not give this store\'s figures, so none are shown.',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: RestaurantTheme.charcoal),
            ),
            if (_dashboardReason != null && _dashboardReason!.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                _dashboardReason!,
                style: const TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText),
              ),
            ],
            const SizedBox(height: 8),
            TextButton(
              onPressed: _loadMerchantDashboard,
              child: const Text('Try again', style: TextStyle(fontWeight: FontWeight.w800)),
            ),
          ],
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Flexible(
              child: Text(
                'Read from NABIN',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
              ),
            ),
            // The dashboard route is a plain authenticated GET with no server-side coalescing, so
            // a burst of taps would be a burst of reads. `_loadMerchantDashboard` is single-flight.
            TextButton(
              onPressed: _loadMerchantDashboard,
              child: const Text('Refresh', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
            ),
          ],
        ),
        const SizedBox(height: 8),
        _buildMetricBentoCard(
          title: 'ORDERS NOT FINISHED',
          value: _activeOrdersCount == null ? _kMetricNotStated : '$_activeOrdersCount',
          caption: 'Every order whose state is not DELIVERED, REJECTED or CANCELLED, among the '
              'latest order rows NABIN reads for this store.',
          icon: Icons.receipt_long_rounded,
        ),
        const SizedBox(height: 10),
        _buildMetricBentoCard(
          title: 'SALES TOTAL',
          value: _salesValueText,
          caption: 'The order amounts NABIN returned, leaving CANCELLED and REJECTED out. '
              '$_salesCurrencyNote The platform applies no date filter to this, whatever the '
              'field is called, so it is not today\'s takings.',
          icon: Icons.payments_rounded,
        ),
        const SizedBox(height: 8),
        Text(
          _provenanceNote,
          style: const TextStyle(fontSize: 11.5, height: 1.35, color: RestaurantTheme.secondaryText),
        ),
      ],
    );
  }

  /// The sales figure, with a currency designation only when the summed orders agree on one.
  ///
  /// `todaySales` is a bare sum of `total_amount` (`server.js:4645-4647`) and says nothing about
  /// currency; `orders.currency` is a `VARCHAR(10)` that defaults to `INR`
  /// (`001_central_schema.sql:202`) but is not constrained to it. So the code shown here is the
  /// code the rows that went into the sum actually carry — never a rupee symbol assumed from the
  /// chrome around it.
  String get _salesValueText {
    final amount = _salesAmount;
    if (amount == null) return _kMetricNotStated;
    final formatted = NumberFormat('#,##0.00').format(amount);
    final codes = _salesCurrencies;
    return codes.length == 1 ? '${codes.first} $formatted' : formatted;
  }

  /// What the summed rows say about currency, including the case where they say nothing.
  String get _salesCurrencyNote {
    final codes = _salesCurrencies;
    if (codes.isEmpty) return 'No order in this read states a currency.';
    if (codes.length == 1) return 'Every summed order states ${codes.first}.';
    return 'These orders state ${codes.length} different currency codes, so the total has none.';
  }

  /// The honest ceiling on what those two numbers mean.
  ///
  /// Both are measured, not phrased carefully: the route does not stream or cache, so the figures
  /// are the last read's; and `getOrdersByMerchant` swallows a store error into an empty list
  /// (`OrderRepository.js:450` and `:465`), which the route then totals into honest-looking zeros
  /// with `success: true`. The UI cannot tell those two apart and must not pretend it can.
  String get _provenanceNote {
    return 'These are the figures from the last read this screen asked for, not a live feed. '
        'NABIN also answers 0 for both when its own order read cannot run, so a zero here is the '
        'platform\'s answer, not proof that the store was reached.';
  }

  /// One figure, its label, and the sentence that limits what the figure claims.
  ///
  /// The text column is `Expanded` because a caption that explains a metric is longer than the
  /// metric, and an unconstrained `Column` inside a `spaceBetween` `Row` is exactly what overflow
  /// a 390dp phone.
  Widget _buildMetricBentoCard({
    required String title,
    required String value,
    required String caption,
    required IconData icon,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: RestaurantTheme.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: RestaurantTheme.border),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.02), blurRadius: 6, offset: const Offset(0, 2)),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: RestaurantTheme.secondaryText, letterSpacing: 0.5)),
                const SizedBox(height: 6),
                Text(value, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                const SizedBox(height: 2),
                Text(caption, style: const TextStyle(fontSize: 11, height: 1.35, color: RestaurantTheme.secondaryText, fontWeight: FontWeight.w500)),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: RestaurantTheme.neonOrange.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, size: 24, color: RestaurantTheme.neonOrange),
          ),
        ],
      ),
    );
  }

  // 2. KDS ORDERS TAB
  Widget _buildOrdersKdsTab() {
    return Column(
      children: [
        // Controls Header
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          color: RestaurantTheme.white,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              // Layout-only guard, and it earns its place: this row is what a merchant reads the
              // filter state from on a 390dp phone, and two chips plus a button had no way to give
              // way at all — so the tab could not be verified at phone width. `Flexible` + `Wrap`
              // keeps the chips left and Refresh right on every width where they fit on one line,
              // which is every width the app targets; the chips only stack when they genuinely
              // cannot share a line. Labels, taps and what each filter selects are unchanged.
              Flexible(
                child: Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  children: [
                    ChoiceChip(
                      label: const Text('Active Queue'),
                      selected: _ordersFilter == 'Active',
                      selectedColor: RestaurantTheme.neonOrange,
                      labelStyle: TextStyle(color: _ordersFilter == 'Active' ? Colors.white : RestaurantTheme.charcoal, fontWeight: FontWeight.w800, fontSize: 12),
                      onSelected: (val) => setState(() => _ordersFilter = 'Active'),
                    ),
                    ChoiceChip(
                      label: const Text('Completed History'),
                      selected: _ordersFilter == 'History',
                      selectedColor: RestaurantTheme.neonOrange,
                      labelStyle: TextStyle(color: _ordersFilter == 'History' ? Colors.white : RestaurantTheme.charcoal, fontWeight: FontWeight.w800, fontSize: 12),
                      onSelected: (val) => setState(() => _ordersFilter = 'History'),
                    ),
                  ],
                ),
              ),
              // Was a button labelled "Simulate Order" that opened a dialog inventing order
              // `#1043` for a customer called David K. A merchant pressing it saw an order
              // nobody had placed. This one re-reads the real order list.
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: RestaurantTheme.neonOrange,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  elevation: 0,
                ),
                icon: const Icon(Icons.refresh_rounded, size: 14, color: Colors.white),
                label: const Text('Refresh', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                onPressed: _loadOrders,
              ),
            ],
          ),
        ),
        const Divider(height: 1, color: RestaurantTheme.border),

        // Orders List
        Expanded(child: _buildOrdersList()),
      ],
    );
  }

  /// The KDS list itself, in the one of four conditions a read can leave it in.
  ///
  /// Before this, a failed read and an empty order book looked identical — and both looked
  /// identical to "the platform is unreachable". The same distinction the menu tab already makes.
  Widget _buildOrdersList() {
    if (_ordersState == _ListState.loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_ordersState == _ListState.failed) {
      return const Padding(
        padding: EdgeInsets.all(24),
        child: Center(
          child: Text(
            'NABIN could not be reached, so this list is not a statement about your orders. Use Refresh to try again.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: RestaurantTheme.secondaryText),
          ),
        ),
      );
    }
    final visible = _visibleOrders;
    if (visible.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: Text(
            _ordersFilter == 'History'
                ? 'No finished orders from NABIN.'
                : 'No orders waiting in the kitchen from NABIN.',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: RestaurantTheme.secondaryText),
          ),
        ),
      );
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth > 600) {
          // KDS Grid Layout for Tablets/Desktop
          return GridView.builder(
            padding: const EdgeInsets.all(16),
            gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
              maxCrossAxisExtent: 400,
              mainAxisSpacing: 16,
              crossAxisSpacing: 16,
              mainAxisExtent: 350, // Fixed height for standard KDS ticket
            ),
            itemCount: visible.length,
            itemBuilder: (context, index) => _buildStitchOrderCard(visible[index]),
          );
        }
        // List Layout for Mobile
        return ListView.builder(
          key: const Key('r-shell-orders-list'),
          padding: const EdgeInsets.all(16),
          itemCount: visible.length,
          itemBuilder: (context, index) => _buildStitchOrderCard(visible[index]),
        );
      },
    );
  }

  /// A KDS ticket for one real order row.
  ///
  /// Every value painted here is a column the merchant orders read returns. The card used to
  /// speak through seven keys that were `null` on every row the probe fetched (`status`, `items`,
  /// `time`, `customer`, `type`, `driver`, `pickupOtp`) and fill each hole with something
  /// plausible: a `PREPARING` pill on an order whose state it had not read, an italic driver line,
  /// and an `OTP:` badge. A merchant acting on that believes the platform told them something.
  Widget _buildStitchOrderCard(Map<String, dynamic> order) {
    final String? state = order['state'] as String?;
    final (Color statusBg, Color statusText, Color borderColor, double borderWidth) = _pillOf(state);
    final String statusLabel = _stateLabel(state);
    // The one state where the kitchen owes a decision and nobody has made it yet.
    final bool needsAttention = state == 'RECEIVED';

    final String? orderNumber = order['number'] as String?;
    final DateTime? placedAt = order['placedAt'] as DateTime?;
    final String? customerName = order['customerName'] as String?;
    final String? serviceType = order['serviceType'] as String?;
    final String? channel = order['channel'] as String?;
    final String? tableNumber = order['tableNumber'] as String?;
    final String? pickupTime = order['pickupTime'] as String?;
    final List<Map<String, dynamic>> lines =
        order['lines'] is List ? List<Map<String, dynamic>>.from(order['lines'] as List) : const [];
    final String? advanceTo = _kNextKitchenState[state];
    final bool advancing = _advancingOrderIds.contains(order['id'] as String);

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        color: RestaurantTheme.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderColor, width: borderWidth),
        boxShadow: [
          if (needsAttention)
            BoxShadow(color: borderColor.withValues(alpha: 0.3), blurRadius: 8, offset: const Offset(0, 4))
          else
            BoxShadow(color: Colors.black.withValues(alpha: 0.02), blurRadius: 6, offset: const Offset(0, 2)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Order Header
          Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Flexible(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      // The order number the platform minted (`order_number`), not the row's uuid.
                      // `#3f0a9c1e-…` used to stand where a merchant expected a ticket number, and
                      // quoting it to a customer over the phone was impossible.
                      Flexible(
                        child: Text(
                          orderNumber ?? _kMissing,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
                        ),
                      ),
                      if (placedAt != null) ...[
                        const SizedBox(width: 8),
                        // Both halves of this pair have to be able to give way: the ticket number
                        // and the timestamp are both single-line and either one alone can be wider
                        // than the space left beside the state pill.
                        Flexible(
                          child: Text(
                            _kPlacedAtFormat.format(placedAt.toLocal()),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 11, color: RestaurantTheme.secondaryText),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Flexible(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(color: statusBg, borderRadius: BorderRadius.circular(8)),
                    child: Text(
                      statusLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: statusText),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: RestaurantTheme.border),

          // Customer Row
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Flexible(
                  // The name on the checkout snapshot. It is not guaranteed: an order placed
                  // without one used to print `null`, and the tempting fix was a polite "Guest",
                  // which would be a name the platform never gave.
                  child: Text(
                    customerName ?? _kMissing,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: RestaurantTheme.charcoal),
                  ),
                ),
                if (channel != null) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                    decoration: BoxDecoration(
                      color: channel == 'DINE_IN'
                          ? const Color(0xFFEBF1FF)
                          : channel == 'TAKEAWAY'
                              ? const Color(0xFFFEF3C7)
                              : RestaurantTheme.lightBg,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      channel == 'DINE_IN'
                          ? (tableNumber != null ? '🍽️ Dine-In · T$tableNumber' : '🍽️ Dine-In')
                          : channel == 'TAKEAWAY'
                              ? (pickupTime != null ? '🛍️ Takeaway · $pickupTime' : '🛍️ Takeaway')
                              : '🛵 Delivery',
                      style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.bold,
                        color: channel == 'DINE_IN'
                            ? const Color(0xFF1A3BA2)
                            : channel == 'TAKEAWAY'
                                ? const Color(0xFFB45309)
                                : RestaurantTheme.secondaryText,
                      ),
                    ),
                  ),
                ] else if (serviceType != null) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                    decoration: BoxDecoration(color: RestaurantTheme.lightBg, borderRadius: BorderRadius.circular(4)),
                    child: Text(serviceType, style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.bold, color: RestaurantTheme.secondaryText)),
                  ),
                ],
              ],
            ),
          ),

          // The order's own lines, exactly as the platform snapshotted them.
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: lines.isEmpty
                  ? const [Text('No order lines on this order.', style: TextStyle(fontSize: 12.5, color: RestaurantTheme.secondaryText))]
                  : lines.map((line) {
                      final String? name = line['name'] as String?;
                      final num? quantity = line['quantity'] as num?;
                      final String? unit = line['unit'] as String?;
                      final String count = quantity == null
                          ? ''
                          : '${quantity == quantity.roundToDouble() ? quantity.toInt() : quantity}x ';
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 3),
                        child: Text(
                          '$count${name ?? _kMissing}${unit == null ? '' : ' · $unit'}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: RestaurantTheme.charcoal),
                        ),
                      );
                    }).toList(),
            ),
          ),

          if (channel == 'TAKEAWAY' && state == 'READY_FOR_PICKUP')
            Padding(
              padding: const EdgeInsets.all(14),
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF1A3BA2),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    elevation: 0,
                  ),
                  icon: const Icon(Icons.check_circle_outline, size: 16),
                  onPressed: advancing ? null : () => _completeTakeawayHandover(order['id'] as String),
                  label: const Text(
                    'Verify Handover & Complete',
                    style: TextStyle(fontWeight: FontWeight.w900, fontSize: 12),
                  ),
                ),
              ),
            )
          else if (advanceTo != null)
            Padding(
              padding: const EdgeInsets.all(14),
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: advanceTo == 'READY_FOR_PICKUP'
                        ? RestaurantTheme.vegGreen
                        : RestaurantTheme.neonOrange,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    elevation: 0,
                  ),
                  onPressed: advancing ? null : () => _advanceOrder(order['id'] as String, advanceTo),
                  child: Text(
                    _kAdvanceLabel[advanceTo] ?? 'Update order',
                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 12),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _completeTakeawayHandover(String orderId) async {
    if (_restaurantId.isEmpty) return;
    final res = await NabinApiService.recordTakeawayHandover(
      restaurantId: _restaurantId,
      orderId: orderId,
      handoverBy: _profile?['name'] as String? ?? 'Restaurant Staff',
    );
    if (!mounted) return;
    if (res != null && res['success'] == true) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Takeaway order handed over and completed!'),
          duration: Duration(seconds: 3),
        ),
      );
      _loadOrders();
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(res?['error']?.toString() ?? 'Failed to verify handover.'),
        duration: const Duration(seconds: 4),
      ),
    );
  }

  /// Move one order to the next state the platform accepts for the kitchen.
  ///
  /// The ticket is rewritten from what the platform answers, never from what was asked: a refusal
  /// (or no answer at all) leaves the order showing the state it was read in, and says which of
  /// the two happened.
  Future<void> _advanceOrder(String orderId, String toState) async {
    if (_advancingOrderIds.contains(orderId)) return;
    setState(() => _advancingOrderIds.add(orderId));

    final res = await NabinApiService.updateMerchantOrderStatus(
      restaurantId: _restaurantId,
      orderId: orderId,
      status: toState,
    );
    if (!mounted) return;
    setState(() => _advancingOrderIds.remove(orderId));

    if (res != null && res['success'] == true) {
      final String? confirmed = _textOf(res['newState'] ?? res['order_state']);
      setState(() {
        _orders = _orders
            .map((o) => o['id'] == orderId ? <String, dynamic>{...o, 'state': confirmed ?? toState} : o)
            .toList();
      });
      return;
    }

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(res == null
            ? 'NABIN did not answer, so this order has not been updated.'
            : _textOf(res['error']) ?? 'NABIN refused the update.'),
        duration: const Duration(seconds: 4),
      ),
    );
  }

  // 3. MENU TAB — read-only view of the merchant's own catalogue rows
  Widget _buildMenuTab() {
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          color: RestaurantTheme.white,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              const Expanded(
                child: Text(
                  'Menu Catalog',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
                ),
              ),
              const SizedBox(width: 8),
              // This was an `ElevatedButton.icon` labelled "Add Dish" with a plus glyph, and its
              // tap produced a SnackBar. Nothing was created, and the message it showed named a
              // merchant portal this app has no endpoint for. There is no menu-item write path on
              // the backend at all (R10 §3 measured zero: no handler for name, description,
              // category, price, image, availability, create or delete), so the one honest
              // statement here is that the tab does not edit — said once, in the header, rather
              // than repeated on every card or faked as a control.
              InkWell(
                onTap: () => context.push('/menu/manage'),
                borderRadius: BorderRadius.circular(8),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: RestaurantTheme.lightBg,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: RestaurantTheme.border),
                  ),
                  child: const Text(
                    'No editing in this app',
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: RestaurantTheme.secondaryText),
                  ),
                ),
              ),
            ],
          ),
        ),
        const Divider(height: 1, color: RestaurantTheme.border),
        Expanded(child: _buildMenuList()),
      ],
    );
  }

  /// Loading / failed / unreadable / successfully empty / real rows. Never a fabricated dish.
  Widget _buildMenuList() {
    if (_menuState == _ListState.loading) {
      return const Center(child: Padding(
        padding: EdgeInsets.all(32),
        child: CircularProgressIndicator(color: RestaurantTheme.neonOrange),
      ));
    }
    if (_menuState == _ListState.failed) {
      return _buildMenuMessage(
        icon: Icons.cloud_off_rounded,
        title: 'Menu unavailable',
        body: 'NABIN could not read your catalogue. This is a connection problem, not an empty menu.',
      );
    }
    if (_menuState == _ListState.unreadable) {
      return _buildMenuMessage(
        icon: Icons.cloud_off_rounded,
        title: 'Menu unavailable',
        body: 'NABIN reached the catalogue but could not read it, and answered with an empty list. '
            'Nothing here is a statement about your dishes.',
      );
    }
    if (_menuItems.isEmpty) {
      return _buildMenuMessage(
        icon: Icons.restaurant_menu_rounded,
        title: 'No dishes listed yet',
        body: 'This store has no menu items on NABIN.',
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _menuItems.length,
      itemBuilder: (context, index) {
        final row = _menuItems[index];
        final item = _normalizeMenuItem(row);
        // Null means the read carried no `is_available` at all, which is not the same fact as
        // `false` and must not be drawn as one.
        final isAvailable = item['isAvailable'] as bool?;
        final delisted = isAvailable == false;
        final dishId = (item['id'] as String?) ?? '';
        final (availabilityLabel, availabilityColor) = _availabilityOf(isAvailable);

        // A real catalogue row may hold no photo at all — both rows on the development store do,
        // `image_url` is NULL — and `Image.network` takes a non-null String. The cast below threw
        // for every dish without an image, which took the menu list down with it, and the menu
        // list is the only route into the dish detail. Absent renders as the same placeholder a
        // failed load renders, never as a stand-in photograph.
        final photo = item['imageUrl'] == null
            ? Container(
                height: 130,
                color: RestaurantTheme.lightBg,
                child: const Center(child: Icon(Icons.fastfood_rounded, size: 36, color: RestaurantTheme.neonOrange)),
              )
            : Image.network(
                item['imageUrl'] as String,
                height: 130,
                width: double.infinity,
                fit: BoxFit.cover,
                color: delisted ? Colors.grey : null,
                colorBlendMode: delisted ? BlendMode.saturation : null,
                errorBuilder: (context, error, stackTrace) => Container(
                  height: 130,
                  color: RestaurantTheme.lightBg,
                  child: const Center(child: Icon(Icons.fastfood_rounded, size: 36, color: RestaurantTheme.neonOrange)),
                ),
              );

              // R10: the row opens that dish's own detail. `dishId` selects one row out of the
              // catalogue the backend already scoped to this merchant, so the link carries no
              // identity and cannot address another store's dish.
              return GestureDetector(
                key: ValueKey('r06-menu-row-$dishId'),
                onTap: dishId.isEmpty
                    ? null
                    : () => context.push('/menu/dish/${Uri.encodeComponent(dishId)}'),
                child: Container(
                margin: const EdgeInsets.only(bottom: 14),
                decoration: BoxDecoration(
                  color: RestaurantTheme.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: delisted ? const Color(0xFFFFDAD6) : RestaurantTheme.border),
                  boxShadow: [
                    BoxShadow(color: Colors.black.withValues(alpha: 0.02), blurRadius: 6, offset: const Offset(0, 2)),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Dish image banner. The two overlays that used to sit here were both claims:
                    // a green/red "● In Stock"/"Out of Stock" pill, and a veg/non-veg square.
                    // `is_available` is not stock — `in_stock_quantity` is a separate column the
                    // card cannot speak through — and `products` has no `is_veg` column at all, so
                    // the square painted every single dish as non-vegetarian. The availability the
                    // backend did send is stated once, read-only, in the row below the details.
                    ClipRRect(
                      borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
                      child: photo,
                    ),

                    // Dish details, all of them the stored row's own values.
                    Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Text(
                                  (item['name'] as String?) ?? _kMissing,
                                  style: TextStyle(
                                    fontWeight: FontWeight.w900,
                                    fontSize: 14.5,
                                    color: item['name'] == null ? RestaurantTheme.secondaryText : RestaurantTheme.charcoal,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              // The stored `price` only. `discount_price ?? price` used to render
                              // here, which put one unlabelled number on the card for whichever
                              // of two columns happened to be set; the labelled pair lives on the
                              // dish detail. An empty price is shown as empty, never as ₹0.
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: item['price'] == null ? RestaurantTheme.lightBg : RestaurantTheme.neonOrangeLight,
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  item['price'] == null ? _kMissing : _rupees(item['price'] as num),
                                  style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w900,
                                    color: item['price'] == null ? RestaurantTheme.secondaryText : RestaurantTheme.neonOrangeDark,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            (item['desc'] as String?) ?? _kMissing,
                            style: const TextStyle(fontSize: 11.5, color: RestaurantTheme.secondaryText),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 10),
                          const Divider(height: 1, color: RestaurantTheme.border),
                          const SizedBox(height: 8),

                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Flexible(
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: RestaurantTheme.lightBg,
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  // No invented fallback category: a dish with no `category`
                                  // column says so instead of filing itself under "Menu".
                                  child: Text(
                                    (item['category'] as String?) ?? _kMissing,
                                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: RestaurantTheme.secondaryText),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Flexible(
                                child: Text(
                                  availabilityLabel,
                                  textAlign: TextAlign.end,
                                  style: TextStyle(
                                    fontSize: 11.5,
                                    fontWeight: FontWeight.w800,
                                    color: availabilityColor,
                                  ),
                                ),
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
            },
    );
  }

  Widget _buildMenuMessage({required IconData icon, required String title, required String body}) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 38, color: RestaurantTheme.secondaryText),
            const SizedBox(height: 12),
            Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
            const SizedBox(height: 6),
            Text(body, textAlign: TextAlign.center, style: const TextStyle(fontSize: 12.5, color: RestaurantTheme.secondaryText)),
            const SizedBox(height: 14),
            OutlinedButton(onPressed: _loadMenu, child: const Text('Try again')),
          ],
        ),
      ),
    );
  }

  /// Maps one `products` row onto the keys this list renders, and keeps blanks blank.
  ///
  /// Every fallback in the previous version was an invention. A dish with no name became
  /// 'Untitled item'; one with no category filed itself under 'Menu'; one with no price showed as
  /// ₹0, which is a claim about money rather than about a missing column; and `isVeg` was read
  /// from `row['is_veg']` — a column `products` does not have — so it was always false and every
  /// dish on NABIN was painted non-vegetarian. `isRecommended` was a local `false` no part of
  /// this screen ever read, and `inStock` renamed `is_available` as a stock statement when
  /// `in_stock_quantity` is the column that would carry one. `discount_price ?? price` printed
  /// whichever of two columns happened to be set as one unlabelled number.
  ///
  /// A blank now stays blank and the card says so. That is the whole contract: this list may not
  /// know more about a dish than the read that produced it.
  Map<String, dynamic> _normalizeMenuItem(Map<String, dynamic> row) {
    return <String, dynamic>{
      'id': (row['id'] ?? row['sku'] ?? '').toString(),
      'name': _textOf(row['name']),
      'desc': _textOf(row['description']),
      'price': _moneyOf(row['price']),
      'category': _textOf(row['category']),
      'imageUrl': _textOf(row['image_url']),
      'isAvailable': row['is_available'] is bool ? row['is_available'] : null,
    };
  }

  static String? _textOf(Object? value) {
    if (value == null) return null;
    final text = value.toString().trim();
    return text.isEmpty ? null : text;
  }

  static num? _moneyOf(Object? value) {
    if (value is num) return value;
    if (value == null) return null;
    return num.tryParse(value.toString().trim());
  }

  static String _rupees(num amount) {
    final asWhole = amount == amount.roundToDouble();
    return asWhole ? '₹${amount.toInt()}' : '₹$amount';
  }

  /// The stored availability, in the three states a read can actually leave this column in.
  ///
  /// `null` is not `false`: the first means the catalogue row carried no verdict, the second
  /// means it said the dish is not orderable. Collapsing them is how a dish gets marked off the
  /// menu on the merchant's own screen with nothing behind it. Same wording as the dish detail.
  static (String, Color) _availabilityOf(bool? isAvailable) {
    if (isAvailable == true) {
      return ('Available for orders', RestaurantTheme.vegGreen);
    }
    if (isAvailable == false) {
      return ('Not available for orders', RestaurantTheme.nonVegRed);
    }
    return ('Not stated by NABIN', RestaurantTheme.secondaryText);
  }

  // 4. FINANCE TAB
  //
  // This tab used to print a payout balance of ₹18,420.50, a settlement schedule, a bank
  // account ending 1092, and three dated "PAID TO BANK" rows — all typed into the source, all
  // shown to every restaurant that opened it. There is no merchant payouts or settlements
  // endpoint on the backend at all, so there is nothing honest to render here yet; the numbers
  // were not stale, they were invented. Reporting "not available" is the only correct state
  // until that endpoint exists, and this screen must not become a statement about money.
  Widget _buildFinanceTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: RestaurantTheme.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: RestaurantTheme.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(Icons.lock_clock_rounded, size: 18, color: RestaurantTheme.secondaryText),
                  SizedBox(width: 8),
                  Text('Payouts and settlements', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                ],
              ),
              const SizedBox(height: 10),
              const Text(
                'Not available in this app yet.',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: RestaurantTheme.charcoal),
              ),
              const SizedBox(height: 6),
              const Text(
                'NABIN has no merchant payout or settlement endpoint to read from, so this '
                'screen shows no balance, no bank account and no settlement history rather than '
                'a figure that would look like money you are owed.',
                style: TextStyle(fontSize: 12.5, height: 1.4, color: RestaurantTheme.secondaryText),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Payout history is not available from this app yet.'),
                      duration: Duration(seconds: 3),
                    ),
                  );
                },
                icon: const Icon(Icons.help_outline_rounded, size: 16),
                label: const Text('Why is this empty?'),
              ),
            ],
          ),
        ),
      ],
    );
  }

  /// The merchant's own declaration of how it appears in Customer Food discovery.
  ///
  /// These are the three migration-034 columns `GET /api/restaurants` projects and the
  /// Customer card draws. Editing them is the whole point of this screen — the values here
  /// are what a customer sees about this restaurant, so nothing is prefilled with a guess
  /// and nothing is sent the merchant did not put on the form.
  ///
  /// Cover image: this repo has no image upload — there is no Supabase Storage usage and no
  /// `image_picker` anywhere, and the `PATCH` route accepts only an http(s) URL string (the
  /// same convention `products.image_url` and `advertisements.image_url` already follow). So
  /// the merchant points at a hosted image URL; a file-upload control would need storage
  /// infrastructure that does not exist and is deliberately not faked here.
  Widget _buildDiscoverySection() {
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
          const Text(
            'Restaurant discovery',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
          ),
          const SizedBox(height: 2),
          const Text(
            'What customers see when they browse Food. Saved only to NABIN after you press Save.',
            style: TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText),
          ),
          const SizedBox(height: 14),
          if (_metaState == _ListState.loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_metaState == _ListState.failed)
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Could not load your declared details from NABIN.',
                  style: TextStyle(fontSize: 13, color: RestaurantTheme.charcoal, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 8),
                TextButton(
                  // The same read the Dashboard tab refreshes: this editor is seeded from the
                  // dashboard route's `restaurant` row, so "try again" re-runs that one GET.
                  onPressed: _loadMerchantDashboard,
                  child: const Text('Try again', style: TextStyle(fontWeight: FontWeight.w800)),
                ),
              ],
            )
          else ...[
            // Cuisines — TEXT[], so many, order preserved, blanks/duplicates rejected.
            const Text('Cuisines', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: RestaurantTheme.charcoal)),
            const SizedBox(height: 6),
            if (_cuisines.isEmpty)
              const Text('None declared yet — customers will see this kitchen under "All restaurants" only.',
                  style: TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText))
            else
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _cuisines.map((name) => InputChip(
                      label: Text(name),
                      onDeleted: () => _removeCuisine(name),
                      deleteIcon: const Icon(Icons.close, size: 16),
                    )).toList(),
              ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _newCuisineCtrl,
                    maxLength: kCuisineMaxLength,
                    decoration: const InputDecoration(
                      hintText: 'Add a cuisine (e.g. Mughlai)',
                      counterText: '',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                    onSubmitted: (_) => _addCuisine(),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  tooltip: 'Add cuisine',
                  onPressed: _addCuisine,
                  icon: const Icon(Icons.add_circle_outline, color: RestaurantTheme.primaryAction),
                ),
              ],
            ),
            const SizedBox(height: 14),

            // Cover image — an http(s) URL string; no upload exists in this repo.
            const Text('Cover image URL', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: RestaurantTheme.charcoal)),
            const SizedBox(height: 6),
            TextField(
              controller: _coverCtrl,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                hintText: 'https://…/banner.jpg',
                helperText: 'Point to an image you host. Uploading from this device is not available yet.',
                isDense: true,
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 14),

            // Standard delivery window — this restaurant's stated minutes, not a live ETA.
            const Text('Standard delivery time (minutes)', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: RestaurantTheme.charcoal)),
            const SizedBox(height: 6),
            TextField(
              controller: _deliveryCtrl,
              keyboardType: TextInputType.number,
              maxLength: 3,
              decoration: const InputDecoration(
                hintText: '$kDeliveryMinutesMin–$kDeliveryMinutesMax',
                helperText: 'Your usual time to prepare and hand off an order, not a live estimate.',
                counterText: '',
                isDense: true,
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: RestaurantTheme.primaryAction,
                  foregroundColor: RestaurantTheme.onPrimaryAction,
                  minimumSize: const Size(double.infinity, 48),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: _savingMeta ? null : _saveRestaurantProfile,
                icon: _savingMeta
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.save_rounded),
                label: Text(_savingMeta ? 'Saving…' : 'Save discovery details'),
              ),
            ),
          ],
        ],
      ),
    );
  }

  // 5. PROFILE TAB
  Widget _buildProfileTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: RestaurantTheme.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: RestaurantTheme.border),
            ),
            child: Row(
              children: [
                const Icon(Icons.storefront_rounded, size: 36, color: RestaurantTheme.neonOrange),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // The store's own name from its merchant record, or nothing at all. This
                      // row previously read "Dilli Darbar Mughlai Kitchen" with
                      // "FSSAI: 1002001928491 • Verified Partner" under it — a business, a
                      // food licence and a verification claim that belong to no one, shown to
                      // every restaurant that signed in. `merchants` has no verification
                      // column, so there is no badge to render here and none is implied.
                      Text(
                        _displayName.isNotEmpty
                            ? _displayName
                            : (_profileFailed ? 'Could not load your store profile' : 'Restaurant profile not configured'),
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal),
                      ),
                      Text(
                        _profile?['fssaiLicense']?.toString().trim().isNotEmpty == true
                            ? 'FSSAI: ${_profile!['fssaiLicense']}'
                            : 'No FSSAI licence on this merchant record',
                        style: const TextStyle(fontSize: 11, color: RestaurantTheme.secondaryText, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          if (_services.contains('RESTAURANT')) ...[
            _buildDiscoverySection(),
            const SizedBox(height: 16),
          ],
          OutlinedButton(
            onPressed: () => context.go('/home'),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(double.infinity, 48),
              side: const BorderSide(color: RestaurantTheme.neonOrange),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.swap_horiz_rounded, color: RestaurantTheme.neonOrange),
                SizedBox(width: 8),
                Text('Switch to Customer Super-App', style: TextStyle(fontWeight: FontWeight.bold, color: RestaurantTheme.neonOrange)),
              ],
            ),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isRestaurant = _merchantMode == 'RESTAURANT';
    final primaryAccent = isRestaurant ? RestaurantTheme.neonOrange : const Color(0xFF22A447);
    final primaryLight = isRestaurant ? RestaurantTheme.neonOrangeLight : const Color(0xFFE8F5E9);

    return Scaffold(
      backgroundColor: RestaurantTheme.lightBg,
      appBar: AppBar(
        backgroundColor: RestaurantTheme.charcoal,
        elevation: 0,
        leading: IconButton(
          icon: Icon(isRestaurant ? Icons.restaurant_rounded : Icons.storefront_rounded, color: primaryAccent),
          // Was `onPressed: () {}` — an icon button in the app bar that swallowed every tap.
          // It now reports the identity and services the platform actually granted, which is
          // what a partner reaching for the store icon is asking.
          onPressed: () {
            final services = _services.isEmpty ? 'none on record' : _services.join(', ');
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('${_displayName.isNotEmpty ? _displayName : 'This store'} — authorized services: $services'),
                duration: const Duration(seconds: 3),
              ),
            );
          },
        ),
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'NABIN',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w900,
                color: Colors.white,
                letterSpacing: 1.0,
              ),
            ),
            const SizedBox(width: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: primaryAccent,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                isRestaurant ? 'RESTAURANT' : 'GROCERY',
                style: const TextStyle(fontSize: 9.5, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: 0.5),
              ),
            ),
          ],
        ),
        centerTitle: true,
        actions: [
          IconButton(
            // The bell used to open the fabricated "new order" dialog. It now re-reads the
            // real order list and shows it, which is what a partner pressing it expects.
            tooltip: 'Refresh orders',
            icon: Icon(Icons.notifications_active_rounded, color: primaryAccent),
            onPressed: () async {
              await _loadOrders();
              if (mounted) setState(() => _currentTab = 1);
            },
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            color: RestaurantTheme.charcoalDark,
            child: Container(
              padding: const EdgeInsets.all(3),
              decoration: BoxDecoration(
                color: Colors.black45,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.white12),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: GestureDetector(
                      onTap: () => _selectService('RESTAURANT'),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        decoration: BoxDecoration(
                          color: isRestaurant ? RestaurantTheme.neonOrange : Colors.transparent,
                          borderRadius: BorderRadius.circular(9),
                        ),
                        alignment: Alignment.center,
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Text('🍽️', style: TextStyle(fontSize: 12)),
                            const SizedBox(width: 6),
                            Flexible(
                              child: Text(
                                'Restaurant KDS',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontWeight: FontWeight.w900,
                                  fontSize: 12,
                                  color: isRestaurant ? Colors.white : Colors.white60,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: GestureDetector(
                      onTap: () => _selectService('GROCERY'),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        decoration: BoxDecoration(
                          color: !isRestaurant ? const Color(0xFF22A447) : Colors.transparent,
                          borderRadius: BorderRadius.circular(9),
                        ),
                        alignment: Alignment.center,
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Text('🛒', style: TextStyle(fontSize: 12)),
                            const SizedBox(width: 6),
                            Flexible(
                              child: Text(
                                'Grocery DarkStore',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontWeight: FontWeight.w900,
                                  fontSize: 12,
                                  color: !isRestaurant ? Colors.white : Colors.white60,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
      body: [
        _buildDashboardTab(),
        _buildOrdersKdsTab(),
        _buildMenuTab(),
        _buildFinanceTab(),
        _buildProfileTab(),
      ][_currentTab],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentTab,
        onDestinationSelected: (idx) => setState(() => _currentTab = idx),
        backgroundColor: RestaurantTheme.white,
        indicatorColor: primaryLight,
        destinations: [
          NavigationDestination(icon: const Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard_rounded, color: primaryAccent), label: 'Dashboard'),
          NavigationDestination(icon: const Icon(Icons.receipt_long_outlined), selectedIcon: Icon(Icons.receipt_long_rounded, color: primaryAccent), label: isRestaurant ? 'Orders (KDS)' : 'Orders'),
          NavigationDestination(icon: Icon(isRestaurant ? Icons.restaurant_menu_outlined : Icons.inventory_2_outlined), selectedIcon: Icon(isRestaurant ? Icons.restaurant_menu_rounded : Icons.inventory_2_rounded, color: primaryAccent), label: isRestaurant ? 'Menu' : 'Products'),
          NavigationDestination(icon: const Icon(Icons.insights_outlined), selectedIcon: Icon(Icons.insights_rounded, color: primaryAccent), label: 'Finance'),
          NavigationDestination(icon: const Icon(Icons.person_outline), selectedIcon: Icon(Icons.person_rounded, color: primaryAccent), label: 'Profile'),
        ],
      ),
    );
  }
}
