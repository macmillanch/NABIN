import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/theme/driver_theme.dart';
import '../../../../core/widgets/driver_card.dart';

/// The signed-in partner's own notification feed.
///
/// Identity is the token's, not a parameter: `requireNotificationAuth` resolves a DRIVER
/// session to that driver's user id, and `NotificationRepository.getNotifications` scopes the
/// read to `recipient_user_id` / `user_id` and the mark-as-read writes to the same pair. So
/// nothing here sends a driver id, and a partner cannot name someone else's inbox.
///
/// Two refusals shape the rest of the file:
/// - **No row the platform did not send.** Titles, bodies and timestamps come from the feed.
///   A field the row does not carry renders as its absence rather than as a plausible
///   substitute, because "Your ride has been completed" is not a NABIN message unless NABIN
///   sent one.
/// - **No read the platform did not confirm.** Marking one row read, or marking all of them,
///   is a PUT. The feed is re-read after the platform answers, so the state on screen is the
///   state in the row; a refused or unreachable PUT leaves the row visibly unread.
class DriverNotificationsScreen extends StatefulWidget {
  const DriverNotificationsScreen({super.key});

  @override
  State<DriverNotificationsScreen> createState() => _DriverNotificationsScreenState();
}

enum _FeedState { loading, ready, failed }

enum _UnreadFilter { all, unread }

/// One feed row, as `mapRowToNotification` in the backend writes it.
class _Notification {
  const _Notification({
    required this.id,
    required this.title,
    required this.body,
    required this.isRead,
    required this.notificationType,
    required this.createdAt,
  });

  final String id;
  final String? title;
  final String? body;
  final bool isRead;
  final String? notificationType;
  final DateTime? createdAt;

  /// A row without an id cannot be marked read — the write would be a guess at a primary key
  /// — so it is dropped rather than rendered with a control the platform would refuse.
  static _Notification? fromJson(Map<String, dynamic> json) {
    final id = json['id'] as String?;
    if (id == null) return null;
    return _Notification(
      id: id,
      title: json['title'] as String?,
      body: json['body'] as String?,
      isRead: json['isRead'] == true,
      notificationType: json['notificationType'] as String?,
      createdAt: DateTime.tryParse('${json['createdAt']}')?.toLocal(),
    );
  }

  /// The platform writes the title. When a row carries none, the label says the row is
  /// unnamed instead of putting words in NABIN's mouth.
  String get heading => (title == null || title!.trim().isEmpty) ? 'A notification from NABIN' : title!;

  String get when {
    final at = createdAt;
    if (at == null) return '— Not available';
    final diff = DateTime.now().difference(at);
    if (diff.inSeconds < 60) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${at.day}/${at.month}/${at.year}';
  }

  IconData get icon => switch (notificationType) {
        'RIDE_REQUEST' || 'RIDE_ACCEPTED' || 'RIDE_COMPLETED' => Icons.electric_rickshaw_rounded,
        'PARCEL' => Icons.inventory_2_rounded,
        'FOOD' || 'RESTAURANT' => Icons.restaurant_rounded,
        'GROCERY' || 'INSTAMART' => Icons.local_grocery_store_rounded,
        'PAYMENT' || 'PAYOUT' => Icons.payments_rounded,
        'SUPPORT' => Icons.support_agent_rounded,
        'SECURITY' || 'ACCOUNT' => Icons.shield_outlined,
        _ => Icons.notifications_outlined,
      };
}

class _DriverNotificationsScreenState extends State<DriverNotificationsScreen> {
  static const int _pageSize = 20;

  _FeedState _state = _FeedState.loading;
  _UnreadFilter _filter = _UnreadFilter.all;
  List<_Notification> _rows = const <_Notification>[];
  int _total = 0;
  int _unreadCount = 0;
  String? _failureMessage;

  /// One write in flight at a time. `_busyId` names the row being marked and `_isMarkingAll`
  /// the bulk call, so a rapid second tap reaches neither while the first is unanswered.
  String? _busyId;
  bool _isMarkingAll = false;
  bool _isLoadingMore = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _state = _FeedState.loading;
        _failureMessage = null;
      });
    }
    final res = await NabinApiService.getNotifications(
      limit: _pageSize,
      unreadOnly: _filter == _UnreadFilter.unread,
    );
    if (!mounted) return;

    if (res == null || res['success'] != true) {
      // An unreachable platform is not an empty inbox, and a pull-to-refresh failure must
      // not throw away the rows that are already on screen.
      final message = res == null
          ? 'No connection to NABIN. Nothing about your notifications has changed.'
          : (res['error'] as String?) ?? 'Could not load your notifications.';
      if (silent && _rows.isNotEmpty) {
        setState(() => _failureMessage = message);
        return;
      }
      setState(() {
        _state = _FeedState.failed;
        _rows = const <_Notification>[];
        _failureMessage = message;
      });
      return;
    }

    final rows = ((res['notifications'] as List?) ?? const [])
        .whereType<Map>()
        .map((row) => _Notification.fromJson(row.cast<String, dynamic>()))
        .whereType<_Notification>()
        .toList();
    setState(() {
      _rows = rows;
      // `total` counts the rows the current filter matches and `unreadCount` is the
      // platform's own count. Neither is derived from what this page happens to hold.
      _total = (res['total'] as num?)?.toInt() ?? rows.length;
      _unreadCount = (res['unreadCount'] as num?)?.toInt() ?? 0;
      _state = _FeedState.ready;
      _failureMessage = null;
    });
  }

  Future<void> _loadMore() async {
    if (_isLoadingMore || _rows.length >= _total) return;
    setState(() => _isLoadingMore = true);
    final res = await NabinApiService.getNotifications(
      limit: _pageSize,
      offset: _rows.length,
      unreadOnly: _filter == _UnreadFilter.unread,
    );
    if (!mounted) return;
    setState(() => _isLoadingMore = false);

    if (res == null || res['success'] != true) {
      _showMessage(res?['error'] as String? ?? 'The older notifications did not load.');
      return;
    }
    final page = ((res['notifications'] as List?) ?? const [])
        .whereType<Map>()
        .map((row) => _Notification.fromJson(row.cast<String, dynamic>()))
        .whereType<_Notification>()
        .toList();
    setState(() {
      _rows = <_Notification>[..._rows, ...page];
      _total = (res['total'] as num?)?.toInt() ?? _total;
    });
  }

  Future<void> _markRead(_Notification row) async {
    if (_busyId != null || _isMarkingAll) return;
    setState(() => _busyId = row.id);
    final res = await NabinApiService.markNotificationAsRead(row.id);
    if (!mounted) return;
    setState(() => _busyId = null);

    if (res == null || res['success'] != true) {
      // Stays unread on screen, because it is still unread in the database.
      _showMessage(res?['error'] as String? ?? 'NABIN did not mark that as read.');
      return;
    }
    // The write is confirmed by re-reading the feed, so the read flag and the unread count
    // both come back from the platform rather than being assumed here.
    await _load(silent: true);
  }

  Future<void> _markAllRead() async {
    if (_isMarkingAll || _unreadCount == 0) return;
    setState(() => _isMarkingAll = true);
    final res = await NabinApiService.markAllNotificationsAsRead();
    if (!mounted) return;
    setState(() => _isMarkingAll = false);

    if (res == null || res['success'] != true) {
      _showMessage(res?['error'] as String? ?? 'NABIN did not mark these as read.');
      return;
    }
    final updated = (res['updatedCount'] as num?)?.toInt() ?? 0;
    _showMessage(updated == 0
        ? 'Nothing was unread.'
        : 'Marked $updated notification${updated == 1 ? '' : 's'} as read.');
    await _load(silent: true);
  }

  void _showMessage(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: DriverTheme.primaryBlue),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DriverTheme.bgLight,
      appBar: AppBar(
        title: const Text('Notifications'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/home'),
        ),
        actions: [
          // A dead "mark all" button on an inbox with nothing unread is the misleading
          // actionable state, so the affordance appears only when there is a read to make.
          if (_state == _FeedState.ready && _unreadCount > 0)
            IconButton(
              onPressed: _isMarkingAll ? null : _markAllRead,
              icon: _isMarkingAll
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: DriverTheme.primaryBlue),
                    )
                  : const Icon(Icons.done_all_rounded),
              tooltip: 'Mark all as read',
            ),
          IconButton(
            onPressed: _state == _FeedState.loading ? null : () => _load(),
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: SafeArea(
        child: switch (_state) {
          _FeedState.loading => const Center(child: CircularProgressIndicator()),
          _FeedState.failed => _buildFailed(),
          _FeedState.ready => _buildFeed(),
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
            const Icon(Icons.cloud_off_rounded, size: 54, color: DriverTheme.textMuted),
            const SizedBox(height: 14),
            const Text('Could not load your notifications',
                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: DriverTheme.textDark)),
            const SizedBox(height: 6),
            Text(_failureMessage ?? 'Nothing about your notifications has changed.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: DriverTheme.textMuted, fontSize: 13)),
            const SizedBox(height: 18),
            ElevatedButton.icon(
              onPressed: () => _load(),
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Retry'),
              style: ElevatedButton.styleFrom(
                backgroundColor: DriverTheme.primaryBlue,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFeed() {
    return RefreshIndicator(
      onRefresh: () => _load(silent: true),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        children: [
          Row(
            children: [
              for (final option in _UnreadFilter.values)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    key: ValueKey('driver-notifications-filter-${option.name}'),
                    label: Text(option == _UnreadFilter.unread
                        ? 'Unread ($_unreadCount)'
                        : 'All ($_total)'),
                    selected: _filter == option,
                    onSelected: (_) {
                      if (_filter == option) return;
                      setState(() => _filter = option);
                      _load();
                    },
                  ),
                ),
            ],
          ),
          if (_failureMessage != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(_failureMessage!,
                  style: const TextStyle(fontSize: 12, color: DriverTheme.roadGold)),
            ),
          const SizedBox(height: 12),
          if (_rows.isEmpty) _buildEmpty() else ..._rows.map(_buildCard),
          if (_rows.isNotEmpty && _rows.length < _total)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: _isLoadingMore
                  ? const Center(
                      child: Padding(
                        padding: EdgeInsets.all(16),
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: DriverTheme.primaryBlue),
                      ),
                    )
                  : TextButton(
                      onPressed: _loadMore,
                      child: Text('Load older (${_total - _rows.length})',
                          style: const TextStyle(color: DriverTheme.primaryBlue)),
                    ),
            ),
          const SizedBox(height: 40),
        ],
      ),
    );
  }

  /// Empty under the Unread filter is a different sentence from empty under All: the first is
  /// "nothing needs you", the second is "NABIN has never written you".
  Widget _buildEmpty() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 12),
      child: Column(
        children: [
          Icon(Icons.notifications_none_rounded, size: 54, color: DriverTheme.textMuted.withValues(alpha: 0.6)),
          const SizedBox(height: 14),
          Text(
            _filter == _UnreadFilter.unread ? 'Nothing unread' : 'No notifications yet',
            style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: DriverTheme.textDark),
          ),
          const SizedBox(height: 6),
          Text(
            _filter == _UnreadFilter.unread
                ? 'Every notification NABIN has sent you has been read.'
                : 'Trip, payout and support messages from NABIN land here.',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 13, color: DriverTheme.textMuted, height: 1.4),
          ),
        ],
      ),
    );
  }

  Widget _buildCard(_Notification row) {
    final busy = _busyId == row.id;
    final body = row.body?.trim();
    return Container(
      key: ValueKey('driver-notification-${row.id}'),
      margin: const EdgeInsets.only(bottom: 12),
      child: DriverCard(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(row.icon, size: 22, color: row.isRead ? DriverTheme.textMuted : DriverTheme.primaryBlue),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(row.heading,
                      style: const TextStyle(
                          fontWeight: FontWeight.w900, fontSize: 14, color: DriverTheme.textDark)),
                  if (body != null && body.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(body,
                        style: const TextStyle(fontSize: 13, color: DriverTheme.textDark, height: 1.4)),
                  ],
                  const SizedBox(height: 8),
                  Text(row.when, style: const TextStyle(fontSize: 12, color: DriverTheme.textMuted)),
                ],
              ),
            ),
            const SizedBox(width: 10),
            if (busy)
              const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2, color: DriverTheme.primaryBlue),
              )
            else if (!row.isRead)
              TextButton(
                key: ValueKey('driver-notification-mark-read-${row.id}'),
                onPressed: _isMarkingAll ? null : () => _markRead(row),
                style: TextButton.styleFrom(
                  foregroundColor: DriverTheme.primaryBlue,
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                ),
                child: const Text('Mark read', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
              )
            else
              const Icon(Icons.check_circle_outline_rounded, size: 18, color: DriverTheme.textMuted),
          ],
        ),
      ),
    );
  }
}
