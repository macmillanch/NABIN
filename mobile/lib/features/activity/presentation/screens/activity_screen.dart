import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/theme/app_theme.dart';

/// The customer's real history across Ride, Food, Instamart and Parcel.
///
/// This screen used to render a `const` list of trips the signed-in user had never
/// taken ("Auto Ride to Connaught Place", `FOOD-294711`), and its receipt sheet stated a
/// payment mode the server never reported. A customer reading it would be shown orders
/// that are not theirs and prices that were invented, so every row here now comes from
/// `GET /api/customer/activity`, which derives identity from the bearer token and reads
/// the amounts back from PostgreSQL.
///
/// The three failure states are distinguished on purpose. "You have no activity yet" and
/// "we could not read your activity" are different sentences to show a customer, and the
/// backend answers the second with a 503 rather than an empty list.
class ActivityScreen extends StatefulWidget {
  const ActivityScreen({super.key});

  @override
  State<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityItem {
  const _ActivityItem({
    required this.id,
    required this.service,
    required this.title,
    required this.status,
    required this.amount,
    required this.placedAt,
    required this.itemCount,
    required this.active,
  });

  final String id;
  final String service;
  final String title;
  final String status;
  final double amount;
  final DateTime? placedAt;
  final int? itemCount;
  final bool active;

  static _ActivityItem? fromJson(Map<String, dynamic> json) {
    final id = json['id'] as String?;
    if (id == null) return null;
    final rawAmount = json['amount'];
    final rawPlacedAt = json['placedAt'] as String?;
    return _ActivityItem(
      id: id,
      service: (json['service'] as String?) ?? 'RIDE',
      title: (json['title'] as String?) ?? 'Activity',
      status: (json['status'] as String?) ?? '',
      amount: rawAmount is num ? rawAmount.toDouble() : double.tryParse('$rawAmount') ?? 0,
      placedAt: rawPlacedAt == null ? null : DateTime.tryParse(rawPlacedAt)?.toLocal(),
      itemCount: json['itemCount'] is num ? (json['itemCount'] as num).toInt() : null,
      active: json['active'] == true,
    );
  }

  String get amountLabel => '₹${amount.toStringAsFixed(2)}';

  String get whenLabel {
    final at = placedAt;
    if (at == null) return 'Date unavailable';
    final now = DateTime.now();
    final sameDay = at.year == now.year && at.month == now.month && at.day == now.day;
    final yesterday = now.difference(at).inDays == 1;
    final prefix = sameDay ? 'Today' : (yesterday ? 'Yesterday' : '${at.day}/${at.month}/${at.year}');
    final hh = at.hour.toString().padLeft(2, '0');
    final mm = at.minute.toString().padLeft(2, '0');
    return '$prefix, $hh:$mm';
  }

  IconData get icon => switch (service) {
        'FOOD' => Icons.restaurant_rounded,
        'INSTAMART' => Icons.shopping_basket_rounded,
        'PARCEL' => Icons.inventory_2_rounded,
        _ => Icons.electric_rickshaw_rounded,
      };

  Color get tint => switch (service) {
        'FOOD' => AppTheme.serviceFood,
        'INSTAMART' => AppTheme.serviceGrocery,
        'PARCEL' => AppTheme.serviceParcel,
        _ => AppTheme.serviceRide,
      };
}

/// null means "could not read"; an empty list means "genuinely nothing yet".
enum _FeedState { loading, ready, failed }

class _ActivityScreenState extends State<ActivityScreen> {
  /// 0 All, 1 Rides, 2 Food, 3 Instamart, 4 Parcels
  int _selectedFilter = 0;
  _FeedState _state = _FeedState.loading;
  List<_ActivityItem> _items = const [];

  static const _serviceByFilter = ['', 'RIDE', 'FOOD', 'INSTAMART', 'PARCEL'];

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    if (mounted) setState(() => _state = _FeedState.loading);
    final payload = await NabinApiService.getCustomerActivity();
    if (!mounted) return;
    // A refused read must not be rendered as an empty history.
    if (payload == null || payload['success'] != true) {
      setState(() {
        _state = _FeedState.failed;
        _items = const [];
      });
      return;
    }
    final raw = (payload['items'] as List?) ?? const [];
    setState(() {
      _items = raw
          .whereType<Map<String, dynamic>>()
          .map(_ActivityItem.fromJson)
          .whereType<_ActivityItem>()
          .toList();
      _state = _FeedState.ready;
    });
  }

  List<_ActivityItem> get _visible {
    final service = _serviceByFilter[_selectedFilter];
    if (service.isEmpty) return _items;
    return _items.where((i) => i.service == service).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Text('Activity & Trip History'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: AppTheme.onSurface, size: 20),
          onPressed: () => context.canPop() ? context.pop() : context.go('/home'),
        ),
      ),
      body: SafeArea(
        child: switch (_state) {
          _FeedState.loading => const Center(child: CircularProgressIndicator()),
          _FeedState.failed => _buildFailed(),
          _FeedState.ready => _buildList(),
        },
      ),
    );
  }

  Widget _buildFailed() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.cloud_off_rounded, size: 54, color: AppTheme.onSurfaceVariant),
            const SizedBox(height: 14),
            const Text('Could not load your activity',
                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: AppTheme.onSurface)),
            const SizedBox(height: 6),
            const Text('Nothing about your trips has changed. Check your connection and try again.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 13)),
            const SizedBox(height: 18),
            ElevatedButton.icon(
              onPressed: _fetch,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Retry'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primary,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildList() {
    final items = _visible;
    final actives = items.where((i) => i.active).toList();
    final past = items.where((i) => !i.active).toList();

    if (items.isEmpty) {
      return RefreshIndicator(
        onRefresh: _fetch,
        child: ListView(
          children: [
            SizedBox(height: MediaQuery.of(context).size.height * 0.28),
            _FilterBar(selected: _selectedFilter, onSelected: _selectFilter, counts: const {}),
            const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text('No trips or orders yet.\nAnything you book with NABIN shows up here.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 13, height: 1.5)),
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _fetch,
      child: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        children: [
          _FilterBar(
            selected: _selectedFilter,
            onSelected: _selectFilter,
            counts: {for (final s in _serviceByFilter.skip(1)) s: items.where((i) => i.service == s).length},
          ),
          const SizedBox(height: 14),
          if (actives.isNotEmpty) ...[
            const Text('In progress',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: AppTheme.onSurface)),
            const SizedBox(height: 8),
            ...actives.map(_buildTile),
            const SizedBox(height: 14),
          ],
          if (past.isNotEmpty) ...[
            const Text('Earlier',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: AppTheme.onSurface)),
            const SizedBox(height: 8),
            ...past.map(_buildTile),
          ],
        ],
      ),
    );
  }

  void _selectFilter(int index) => setState(() => _selectedFilter = index);

  Widget _buildTile(_ActivityItem item) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        leading: Container(
          width: 42,
          height: 42,
          decoration: BoxDecoration(
            color: item.tint.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(item.icon, color: item.tint, size: 22),
        ),
        title: Text(item.title,
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: AppTheme.onSurface)),
        subtitle: Text('${item.service.toLowerCase()} • ${item.whenLabel}',
            style: const TextStyle(fontSize: 12, color: AppTheme.onSurfaceVariant)),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(item.amountLabel,
                style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: AppTheme.primary)),
            const SizedBox(height: 2),
            Text(item.status.replaceAll('_', ' '),
                style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    color: item.active ? AppTheme.success : AppTheme.onSurfaceVariant)),
          ],
        ),
        onTap: () => _showActivityDetails(item),
      ),
    );
  }

  void _showActivityDetails(_ActivityItem item) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      backgroundColor: AppTheme.surfaceContainerLowest,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Flexible(
                  child: Text(item.title,
                      style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: AppTheme.onSurface)),
                ),
                IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => Navigator.pop(ctx)),
              ],
            ),
            const Divider(),
            const SizedBox(height: 8),
            _detailLine('Reference', item.id),
            _detailLine('Service', item.service),
            _detailLine('Status', item.status.replaceAll('_', ' ')),
            _detailLine('Placed', item.whenLabel),
            if (item.itemCount != null) _detailLine('Items', '${item.itemCount}'),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Amount:',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: AppTheme.onSurface)),
                Text(item.amountLabel,
                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 20, color: AppTheme.primary)),
              ],
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primaryContainer,
                foregroundColor: Colors.white,
                minimumSize: const Size(double.infinity, 50),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              child: const Text('Close', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _detailLine(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 92,
            child: Text(label,
                style: const TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 13, fontWeight: FontWeight.w700)),
          ),
          Expanded(
            child: Text(value,
                style: const TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 13)),
          ),
        ],
      ),
    );
  }
}

class _FilterBar extends StatelessWidget {
  const _FilterBar({required this.selected, required this.onSelected, required this.counts});

  final int selected;
  final ValueChanged<int> onSelected;
  final Map<String, int> counts;

  static const _labels = ['All', 'Rides', 'Food', 'Instamart', 'Parcels'];
  static const _services = ['', 'RIDE', 'FOOD', 'INSTAMART', 'PARCEL'];

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 36,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: _labels.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final isSelected = selected == index;
          final count = index == 0 ? null : counts[_services[index]];
          return GestureDetector(
            onTap: () => onSelected(index),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: isSelected ? AppTheme.primary : AppTheme.surfaceContainerLowest,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                    color: isSelected ? AppTheme.primary : AppTheme.outlineVariant.withValues(alpha: 0.6)),
              ),
              child: Text(
                count == null ? _labels[index] : '${_labels[index]} ($count)',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  color: isSelected ? Colors.white : AppTheme.onSurfaceVariant,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
