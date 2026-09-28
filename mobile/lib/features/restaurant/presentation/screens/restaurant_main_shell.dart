import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/restaurant_theme.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/network/session_manager.dart';

/// Whether a list on this screen has actually been fetched.
///
/// `failed` is kept distinct from `empty` on purpose: "we could not reach the platform" and
/// "you have no items yet" ask for different sentences, and collapsing them is how an outage
/// gets rendered to a merchant as an empty store.
enum _ListState { loading, ready, failed }

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

  List<Map<String, dynamic>> _orders = [];

  /// Menu state. `_menuItems` was once a hardcoded list of five dishes with Unsplash photos,
  /// shown to every store that opened this screen — the menu tab was a simulator, not a view.
  _ListState _menuState = _ListState.loading;
  List<Map<String, dynamic>> _menuItems = const [];

  @override
  void initState() {
    super.initState();
    _initMerchant();
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
  }

  Future<void> _loadOrders() async {
    if (_restaurantId.isEmpty) return;
    final res = await NabinApiService.getMerchantOrders(_restaurantId);
    if (!mounted) return;
    if (res != null && res['success'] == true) {
      setState(() => _orders = List<Map<String, dynamic>>.from(res['orders'] ?? []));
    }
  }

  /// The merchant's own catalogue rows — for a restaurant these ARE the menu items.
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
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Store Status', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                        const SizedBox(height: 2),
                        Text(
                          _storeStatus == 'OPEN'
                              ? 'Accepting incoming live orders'
                              : _storeStatus == 'CLOSED'
                                  ? 'Currently closed'
                                  : 'Temporarily paused (kitchen busy)',
                          style: const TextStyle(fontSize: 12, color: RestaurantTheme.secondaryText),
                        ),
                      ],
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
                Row(
                  children: [
                    _buildStatusChoice('OPEN', Icons.check_circle_outline, RestaurantTheme.vegGreen),
                    const SizedBox(width: 8),
                    _buildStatusChoice('CLOSED', Icons.cancel_outlined, RestaurantTheme.secondaryText),
                    const SizedBox(width: 8),
                    _buildStatusChoice('PAUSED', Icons.pause_circle_outline, RestaurantTheme.warning),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Bento Grid Metrics (3 Cards)
          _buildMetricBentoCard(
            title: 'TODAY\'S REVENUE',
            value: '₹3,450.00',
            subtext: '+15% vs yesterday',
            icon: Icons.payments_rounded,
          ),
          const SizedBox(height: 10),
          _buildMetricBentoCard(
            title: 'TOTAL ORDERS',
            value: '28',
            subtext: '3 active in kitchen pipeline',
            icon: Icons.receipt_long_rounded,
          ),
          const SizedBox(height: 10),
          _buildMetricBentoCard(
            title: 'AVG. PREP TIME',
            value: '16 mins',
            subtext: 'Optimal kitchen efficiency',
            icon: Icons.timer_rounded,
          ),
          const SizedBox(height: 20),

          // Live Orders Header
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  const Text('Live Kitchen Queue', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: RestaurantTheme.neonOrangeLight,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text('${_orders.where((o) => o['status'] != 'COMPLETED').length} ACTIVE', style: const TextStyle(fontSize: 9.5, fontWeight: FontWeight.w900, color: RestaurantTheme.neonOrangeDark)),
                  ),
                ],
              ),
              TextButton(
                onPressed: () => setState(() => _currentTab = 1),
                child: const Text('View All (KDS) →', style: TextStyle(fontWeight: FontWeight.w800, color: RestaurantTheme.neonOrange, fontSize: 12)),
              ),
            ],
          ),
          const SizedBox(height: 10),

          // Active Orders Cards
          ..._orders.where((o) => o['status'] != 'COMPLETED').map((order) => _buildStitchOrderCard(order)),
        ],
      ),
    );
  }

  Widget _buildStatusChoice(String statusKey, IconData icon, Color color) {
    final isSelected = (_storeStatus == statusKey) || (statusKey == 'PAUSED' && _storeStatus == 'TEMPORARILY UNAVAILABLE');
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

  Widget _buildMetricBentoCard({required String title, required String value, required String subtext, required IconData icon}) {
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
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: RestaurantTheme.secondaryText, letterSpacing: 0.5)),
              const SizedBox(height: 6),
              Text(value, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
              const SizedBox(height: 2),
              Text(subtext, style: const TextStyle(fontSize: 11, color: RestaurantTheme.secondaryText, fontWeight: FontWeight.w500)),
            ],
          ),
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
              Row(
                children: [
                  ChoiceChip(
                    label: const Text('Active Queue'),
                    selected: _ordersFilter == 'Active',
                    selectedColor: RestaurantTheme.neonOrange,
                    labelStyle: TextStyle(color: _ordersFilter == 'Active' ? Colors.white : RestaurantTheme.charcoal, fontWeight: FontWeight.w800, fontSize: 12),
                    onSelected: (val) => setState(() => _ordersFilter = 'Active'),
                  ),
                  const SizedBox(width: 8),
                  ChoiceChip(
                    label: const Text('Completed History'),
                    selected: _ordersFilter == 'History',
                    selectedColor: RestaurantTheme.neonOrange,
                    labelStyle: TextStyle(color: _ordersFilter == 'History' ? Colors.white : RestaurantTheme.charcoal, fontWeight: FontWeight.w800, fontSize: 12),
                    onSelected: (val) => setState(() => _ordersFilter = 'History'),
                  ),
                ],
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
        Expanded(
          child: LayoutBuilder(
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
                  itemCount: _orders.length,
                  itemBuilder: (context, index) => _buildStitchOrderCard(_orders[index]),
                );
              }
              // List Layout for Mobile
              return ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: _orders.length,
                itemBuilder: (context, index) => _buildStitchOrderCard(_orders[index]),
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _buildStitchOrderCard(Map<String, dynamic> order) {
    Color statusBg = RestaurantTheme.neonOrangeLight;
    Color statusText = RestaurantTheme.neonOrangeDark;
    Color borderColor = RestaurantTheme.border;
    String statusLabel = 'PREPARING';
    double borderWidth = 1.0;

    final status = order['status'] as String;
    if (status == 'NEW') {
      statusBg = const Color(0xFFFFE4E6);
      statusText = const Color(0xFFE11D48); // Rose 600
      borderColor = const Color(0xFFFDA4AF); // Rose 300
      borderWidth = 2.0;
      statusLabel = 'NEW ORDER';
    } else if (status == 'ACCEPTED') {
      statusBg = const Color(0xFFFEF3C7);
      statusText = const Color(0xFFD97706); // Amber 600
      borderColor = const Color(0xFFFCD34D); // Amber 300
      borderWidth = 1.5;
      statusLabel = 'ACCEPTED';
    } else if (status == 'READY') {
      statusBg = const Color(0xFFDCFCE7); // Green 100
      statusText = const Color(0xFF16A34A); // Green 600
      borderColor = const Color(0xFF86EFAC); // Green 300
      borderWidth = 2.0;
      statusLabel = 'READY FOR PICKUP';
    } else if (status == 'COMPLETED') {
      statusBg = const Color(0xFFF1F5F9);
      statusText = RestaurantTheme.secondaryText;
      statusLabel = 'DELIVERED';
    }

    final items = order['items'] as List<dynamic>;

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        color: RestaurantTheme.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderColor, width: borderWidth),
        boxShadow: [
          if (status == 'NEW' || status == 'READY')
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
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Text('#${order['id']}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
                    const SizedBox(width: 8),
                    Text(order['time'], style: const TextStyle(fontSize: 11, color: RestaurantTheme.secondaryText)),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(color: statusBg, borderRadius: BorderRadius.circular(8)),
                  child: Text(statusLabel, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: statusText)),
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
                Text(order['customer'], style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: RestaurantTheme.charcoal)),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(color: RestaurantTheme.lightBg, borderRadius: BorderRadius.circular(4)),
                  child: Text(order['type'], style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.bold, color: RestaurantTheme.secondaryText)),
                ),
              ],
            ),
          ),

          // Items List with Checkboxes
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: Column(
              children: items.map((item) {
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Row(
                    children: [
                      Checkbox(
                        value: item['done'] ?? false,
                        activeColor: RestaurantTheme.neonOrange,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
                        onChanged: (val) {
                          setState(() => item['done'] = val);
                        },
                      ),
                      Expanded(
                        child: Text(
                          '${item['qty']}x ${item['name']}',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: (item['done'] ?? false) ? RestaurantTheme.secondaryText : RestaurantTheme.charcoal,
                            decoration: (item['done'] ?? false) ? TextDecoration.lineThrough : null,
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              }).toList(),
            ),
          ),

          // Driver info & OTP
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(order['driver'], style: const TextStyle(fontSize: 11, color: RestaurantTheme.secondaryText, fontStyle: FontStyle.italic)),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(color: RestaurantTheme.neonOrangeLight, borderRadius: BorderRadius.circular(6)),
                  child: Text('OTP: ${order['pickupOtp']}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: RestaurantTheme.neonOrangeDark)),
                ),
              ],
            ),
          ),

          // Action Button
          Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                Expanded(
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: status == 'NEW' || status == 'ACCEPTED'
                          ? RestaurantTheme.neonOrange
                          : status == 'PREPARING'
                              ? RestaurantTheme.vegGreen
                              : RestaurantTheme.charcoal,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      elevation: 0,
                    ),
                    onPressed: () async {
                      String newStatus = status;
                      if (status == 'NEW') {
                        newStatus = 'ACCEPTED';
                      } else if (status == 'ACCEPTED') {
                        newStatus = 'PREPARING';
                      } else if (status == 'PREPARING') {
                        newStatus = 'READY';
                      } else if (status == 'READY') {
                        newStatus = 'COMPLETED';
                      }
                      
                      final res = await NabinApiService.updateMerchantOrderStatus(
                        restaurantId: _restaurantId,
                        orderId: order['id'].toString(),
                        status: newStatus,
                      );
                      
                      if (!mounted) return;
                      
                      if (res != null && res['success'] == true) {
                        setState(() {
                          order['status'] = newStatus;
                        });
                      } else {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Failed to update status: ${res?['error'] ?? 'Unknown'}')),
                        );
                      }
                    },
                    child: Text(
                      status == 'NEW'
                          ? 'Accept & Prepare'
                          : status == 'ACCEPTED'
                              ? 'Start Cooking'
                              : status == 'PREPARING'
                                  ? 'Mark Ready for Pickup'
                                  : 'Handover to Rider',
                      style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 12),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: RestaurantTheme.charcoal,
                    side: const BorderSide(color: RestaurantTheme.border),
                    padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  onPressed: () {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('KOT Ticket printed for Order #${order['id']}')),
                    );
                  },
                  child: const Text('Print KOT', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // 3. MENU MANAGEMENT TAB
  Widget _buildMenuTab() {
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          color: RestaurantTheme.white,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Menu Catalog', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: RestaurantTheme.charcoal)),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: RestaurantTheme.neonOrange,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  elevation: 0,
                ),
                icon: const Icon(Icons.add, size: 16, color: Colors.white),
                label: const Text('Add Dish', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                // There is no merchant-facing "create a menu item" endpoint, so this used to be
                // a button that opened nothing. Say so rather than look like a working control.
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Adding dishes is done on the NABIN merchant portal, not in this app.'),
                      duration: Duration(seconds: 3),
                    ),
                  );
                },
              ),
            ],
          ),
        ),
        const Divider(height: 1, color: RestaurantTheme.border),
        Expanded(child: _buildMenuList()),
      ],
    );
  }

  /// Loading / failed / empty / real rows. Never a fabricated dish.
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
    if (_menuItems.isEmpty) {
      return _buildMenuMessage(
        icon: Icons.restaurant_menu_rounded,
        title: 'No dishes listed yet',
        body: 'This store has no menu items on NABIN. Dishes added on the merchant portal appear here.',
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _menuItems.length,
      itemBuilder: (context, index) {
        final row = _menuItems[index];
        final item = _normalizeMenuItem(row);
        final inStock = item['inStock'] as bool;
        final isVeg = item['isVeg'] as bool;

              return Container(
                margin: const EdgeInsets.only(bottom: 14),
                decoration: BoxDecoration(
                  color: RestaurantTheme.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: inStock ? RestaurantTheme.border : const Color(0xFFFFDAD6)),
                  boxShadow: [
                    BoxShadow(color: Colors.black.withValues(alpha: 0.02), blurRadius: 6, offset: const Offset(0, 2)),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Dish Image Banner with Availability Badge
                    ClipRRect(
                      borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
                      child: Stack(
                        children: [
                          Image.network(
                            item['imageUrl'] as String,
                            height: 130,
                            width: double.infinity,
                            fit: BoxFit.cover,
                            color: inStock ? null : Colors.grey,
                            colorBlendMode: inStock ? null : BlendMode.saturation,
                            errorBuilder: (context, error, stackTrace) => Container(
                              height: 130,
                              color: RestaurantTheme.lightBg,
                              child: const Center(child: Icon(Icons.fastfood_rounded, size: 36, color: RestaurantTheme.neonOrange)),
                            ),
                          ),
                          Positioned(
                            top: 8,
                            right: 8,
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(
                                color: inStock ? Colors.white : const Color(0xFFFFDAD6),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: inStock ? RestaurantTheme.vegGreen : RestaurantTheme.nonVegRed),
                              ),
                              child: Text(
                                inStock ? '● In Stock' : 'Out of Stock',
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w800,
                                  color: inStock ? RestaurantTheme.vegGreen : RestaurantTheme.nonVegRed,
                                ),
                              ),
                            ),
                          ),
                          Positioned(
                            top: 8,
                            left: 8,
                            child: Container(
                              padding: const EdgeInsets.all(2.5),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(4),
                                border: Border.all(color: isVeg ? RestaurantTheme.vegGreen : RestaurantTheme.nonVegRed, width: 1.2),
                              ),
                              child: Icon(
                                Icons.fiber_manual_record,
                                color: isVeg ? RestaurantTheme.vegGreen : RestaurantTheme.nonVegRed,
                                size: 8,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),

                    // Dish Details & Stock Switch
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
                                  item['name'] as String,
                                  style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14.5, color: RestaurantTheme.charcoal),
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: RestaurantTheme.neonOrangeLight,
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  '₹${item['price']}',
                                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: RestaurantTheme.neonOrangeDark),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            item['desc'] as String,
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
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: RestaurantTheme.lightBg,
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  item['category'] as String,
                                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: RestaurantTheme.secondaryText),
                                ),
                              ),
                              Row(
                                children: [
                                  Text(
                                    inStock ? 'Available' : 'Disabled',
                                    style: TextStyle(
                                      fontSize: 11.5,
                                      fontWeight: FontWeight.bold,
                                      color: inStock ? RestaurantTheme.charcoal : RestaurantTheme.nonVegRed,
                                    ),
                                  ),
                                  const SizedBox(width: 6),
                                  Switch(
                                    value: inStock,
                                    activeThumbColor: RestaurantTheme.neonOrange,
                                    onChanged: (val) async {
                                      // Written back onto the fetched row, not onto a copy:
                                      // `_MenuRow` is a read view over `_menuItems[index]`, and
                                      // the map is what the list re-renders from.
                                      final row = _menuItems[index];
                                      final previous = row['is_available'];
                                      setState(() => row['is_available'] = val);

                                      // Resolved before the gap: `context` after an await is a
                                      // use-after-unmount waiting to happen, and the mounted
                                      // check below is on the State, not on this BuildContext.
                                      final messenger = ScaffoldMessenger.of(context);

                                      final res = await NabinApiService.toggleMenuItem(
                                        restaurantId: _restaurantId,
                                        itemId: item['id'] as String,
                                        inStock: val,
                                      );

                                      if (!mounted) return;

                                      if (res == null || res['success'] != true) {
                                        setState(() => row['is_available'] = previous);
                                        messenger.showSnackBar(
                                          SnackBar(content: Text('NABIN refused the change: ${res?['error'] ?? 'no response from the platform'}')),
                                        );
                                      }
                                    },
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
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

  /// Maps one `products` row onto the keys this list renders.
  ///
  /// Deliberately tolerant of missing columns rather than casting: a real catalogue row has
  /// `is_available` and `in_stock_quantity`, and has no notion of veg/non-veg at all, so the
  /// previous `item['isVeg'] as bool` on a hand-written literal would have thrown the moment
  /// the list came from the server. Absent values render as absent, never as a guess.
  Map<String, dynamic> _normalizeMenuItem(Map<String, dynamic> row) {
    final price = row['discount_price'] ?? row['price'];
    return <String, dynamic>{
      'id': (row['id'] ?? row['sku'] ?? '').toString(),
      'name': (row['name'] ?? 'Untitled item').toString(),
      'desc': (row['description'] ?? '').toString(),
      'price': price is num ? price : num.tryParse('$price') ?? 0,
      'category': (row['category'] ?? 'Menu').toString(),
      'imageUrl': row['image_url']?.toString(),
      'inStock': row['is_available'] == true,
      'isVeg': row['is_veg'] == true,
      'isRecommended': false,
    };
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
                            Text(
                              'Restaurant KDS',
                              style: TextStyle(
                                fontWeight: FontWeight.w900,
                                fontSize: 12,
                                color: isRestaurant ? Colors.white : Colors.white60,
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
                            Text(
                              'Grocery DarkStore',
                              style: TextStyle(
                                fontWeight: FontWeight.w900,
                                fontSize: 12,
                                color: !isRestaurant ? Colors.white : Colors.white60,
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
