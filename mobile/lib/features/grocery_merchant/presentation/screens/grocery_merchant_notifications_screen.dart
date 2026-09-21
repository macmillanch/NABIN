import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/network/nabin_api_service.dart';
import 'package:mobile/core/network/nabin_ws_service.dart';
import 'package:mobile/core/network/session_manager.dart';
import '../theme/grocery_merchant_theme.dart';

/// Notifications for the signed-in store. The backend keys this feed to the
/// bearer token's own identity, so nothing here passes a merchant id.
class GroceryMerchantNotificationsScreen extends ConsumerStatefulWidget {
  const GroceryMerchantNotificationsScreen({super.key});

  @override
  ConsumerState<GroceryMerchantNotificationsScreen> createState() =>
      _GroceryMerchantNotificationsScreenState();
}

enum _UnreadFilter { all, unread }

class _GroceryMerchantNotificationsScreenState
    extends ConsumerState<GroceryMerchantNotificationsScreen> {
  static const int _pageSize = 20;

  bool _isLoading = true;
  bool _isLoadingMore = false;
  List<dynamic> _notifications = [];
  int _total = 0;
  int _unreadCount = 0;
  String? _errorMessage;
  String? _busyId;
  _UnreadFilter _filter = _UnreadFilter.all;
  StreamSubscription<Map<String, dynamic>>? _notificationSub;

  @override
  void initState() {
    super.initState();
    _load();
    _listenForLiveNotifications();
  }

  @override
  void dispose() {
    _notificationSub?.cancel();
    super.dispose();
  }

  /// Live order notifications arrive on the store's socket. When the socket is
  /// not available the screen still works — pull to refresh is the fallback.
  void _listenForLiveNotifications() {
    final merchantId = SessionManager.instance.currentUser?['id']?.toString();
    if (merchantId == null) return;
    NabinWsService.instance.connect(role: 'MERCHANT', userId: merchantId);
    _notificationSub = NabinWsService.instance.onNotification.listen((_) {
      if (mounted) _load(silent: true);
    });
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _isLoading = true;
        _errorMessage = null;
      });
    }

    try {
      final result = await NabinApiService.getNotifications(
        limit: _pageSize,
        unreadOnly: _filter == _UnreadFilter.unread,
      );

      if (result == null || result['success'] != true) {
        setState(() {
          _isLoading = false;
          _errorMessage = result?['error'] ??
              'Could not reach the notification feed. Pull to refresh once you are back online.';
        });
        return;
      }

      setState(() {
        _notifications = result['notifications'] as List<dynamic>? ?? [];
        _total = (result['total'] as num?)?.toInt() ?? _notifications.length;
        _unreadCount = (result['unreadCount'] as num?)?.toInt() ?? 0;
        _isLoading = false;
        _errorMessage = null;
      });
    } catch (e) {
      setState(() {
        _isLoading = false;
        _errorMessage = 'Network error. Please check your connection.';
      });
    }
  }

  Future<void> _loadMore() async {
    if (_isLoadingMore || _notifications.length >= _total) return;
    setState(() => _isLoadingMore = true);
    try {
      final result = await NabinApiService.getNotifications(
        limit: _pageSize,
        offset: _notifications.length,
        unreadOnly: _filter == _UnreadFilter.unread,
      );
      if (result == null || result['success'] != true) {
        _showMessage('There were more notifications, but they did not load.');
        return;
      }
      setState(() {
        _notifications = [
          ..._notifications,
          ...(result['notifications'] as List<dynamic>? ?? []),
        ];
        _total = (result['total'] as num?)?.toInt() ?? _total;
      });
    } finally {
      if (mounted) setState(() => _isLoadingMore = false);
    }
  }

  Future<void> _openNotification(Map<String, dynamic> notification) async {
    final id = notification['id']?.toString();
    if (id == null) return;

    final isUnread = notification['isRead'] != true;
    if (isUnread) {
      setState(() => _busyId = id);
      final result = await NabinApiService.markNotificationAsRead(id);
      if (!mounted) return;
      if (result?['success'] != true) {
        // Keep it visibly unread rather than lying about the state change.
        _showMessage(result?['error'] ?? 'The feed rejected the update.');
      } else {
        setState(() {
          notification['isRead'] = true;
          notification['status'] = 'READ';
          if (_unreadCount > 0) _unreadCount--;
        });
      }
      setState(() => _busyId = null);
    }

    if (notification['relatedEntityType'] == 'ORDER' &&
        notification['relatedEntityId'] != null &&
        mounted) {
      await context.push('/orders/${Uri.encodeComponent(notification['relatedEntityId'].toString())}');
      if (mounted) await _load(silent: true);
    }
  }

  Future<void> _markAllRead() async {
    final result = await NabinApiService.markAllNotificationsAsRead();
    if (!mounted) return;
    if (result != null && result['success'] == true) {
      await _load(silent: true);
      _showMessage('Marked ${result['updatedCount'] ?? 0} as read.');
    } else {
      _showMessage(result?['error'] ?? 'Could not mark these as read.');
    }
  }

  void _showMessage(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: GroceryMerchantTheme.primaryGreen),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: GroceryMerchantTheme.bgOffWhite,
      appBar: AppBar(
        backgroundColor: GroceryMerchantTheme.primaryGreen,
        elevation: 0,
        title: const Text(
          'Notifications',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Colors.white),
        ),
        actions: [
          if (_unreadCount > 0)
            IconButton(
              icon: const Icon(Icons.done_all, color: Colors.white),
              tooltip: 'Mark all as read',
              onPressed: _markAllRead,
            ),
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white),
            tooltip: 'Refresh',
            onPressed: _load,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(
              child: CircularProgressIndicator(color: GroceryMerchantTheme.primaryGreen),
            )
          : _errorMessage != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(32),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          _errorMessage!,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 16,
                            color: GroceryMerchantTheme.accentRose,
                          ),
                        ),
                        const SizedBox(height: 16),
                        ElevatedButton(
                          onPressed: _load,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: GroceryMerchantTheme.primaryGreen,
                          ),
                          child: const Text('Retry'),
                        ),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: () => _load(silent: true),
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                    children: [
                      Wrap(
                        spacing: 8,
                        children: [
                          for (final option in _UnreadFilter.values)
                            ChoiceChip(
                              label: Text(option == _UnreadFilter.unread
                                  ? 'Unread • $_unreadCount'
                                  : 'All'),
                              selected: _filter == option,
                              onSelected: (_) {
                                if (_filter == option) return;
                                setState(() => _filter = option);
                                _load();
                              },
                            ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      if (_notifications.isEmpty) _buildEmptyState(),
                      for (final notification in _notifications)
                        _buildCard(notification as Map<String, dynamic>),
                      if (_notifications.length < _total)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: _isLoadingMore
                              ? const Center(
                                  child: Padding(
                                    padding: EdgeInsets.all(16),
                                    child: CircularProgressIndicator(
                                        color: GroceryMerchantTheme.primaryGreen),
                                  ),
                                )
                              : TextButton(
                                  onPressed: _loadMore,
                                  child: Text(
                                    'Load older (${_total - _notifications.length})',
                                    style: const TextStyle(
                                        color: GroceryMerchantTheme.primaryGreenDark),
                                  ),
                                ),
                        ),
                    ],
                  ),
                ),
    );
  }

  Widget _buildEmptyState() {
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        children: [
          Icon(
            Icons.notifications_none_outlined,
            size: 56,
            color: GroceryMerchantTheme.textMuted.withValues(alpha: 0.3),
          ),
          const SizedBox(height: 16),
          const Text(
            'Nothing here yet',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
              color: GroceryMerchantTheme.textDark,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            _filter == _UnreadFilter.unread
                ? 'No unread notifications. Switch to All to see the older ones.'
                : 'New orders and store updates land here as they happen.',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 14, color: GroceryMerchantTheme.textMuted),
          ),
        ],
      ),
    );
  }

  Widget _buildCard(Map<String, dynamic> notification) {
    final isUnread = notification['isRead'] != true;
    final id = notification['id']?.toString();
    final busy = id != null && _busyId == id;
    final goesToOrder =
        notification['relatedEntityType'] == 'ORDER' && notification['relatedEntityId'] != null;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: isUnread ? Colors.white : GroceryMerchantTheme.bgOffWhite,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isUnread
              ? GroceryMerchantTheme.primaryGreen.withValues(alpha: 0.35)
              : GroceryMerchantTheme.borderLight,
          width: 1,
        ),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: busy ? null : () => _openNotification(notification),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  _iconFor(notification['notificationType']?.toString()),
                  size: 22,
                  color: isUnread
                      ? GroceryMerchantTheme.primaryGreen
                      : GroceryMerchantTheme.textMuted,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        notification['title']?.toString() ?? 'Notification',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: GroceryMerchantTheme.textDark,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        notification['body']?.toString() ?? '',
                        style: const TextStyle(
                          fontSize: 14,
                          color: GroceryMerchantTheme.textDark,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Text(
                            _timeAgo(notification['createdAt']?.toString()),
                            style: const TextStyle(
                              fontSize: 12,
                              color: GroceryMerchantTheme.textMuted,
                            ),
                          ),
                          if (goesToOrder) ...[
                            const SizedBox(width: 8),
                            const Icon(Icons.chevron_right,
                                size: 16, color: GroceryMerchantTheme.textMuted),
                            const Flexible(
                              child: Text(
                                'order',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: GroceryMerchantTheme.textMuted,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                if (busy)
                  const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: GroceryMerchantTheme.primaryGreen),
                  )
                else if (isUnread)
                  Container(
                    width: 10,
                    height: 10,
                    margin: const EdgeInsets.only(top: 4),
                    decoration: const BoxDecoration(
                      color: GroceryMerchantTheme.primaryGreen,
                      shape: BoxShape.circle,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  IconData _iconFor(String? type) {
    switch (type) {
      case 'ORDER_RECEIVED':
        return Icons.shopping_bag_outlined;
      case 'ORDER_UPDATE':
        return Icons.autorenew;
      case 'PAYMENT':
        return Icons.payments_rounded;
      default:
        return Icons.notifications_outlined;
    }
  }

  String _timeAgo(String? isoString) {
    if (isoString == null) return '';
    final parsed = DateTime.tryParse(isoString);
    if (parsed == null) return '';
    final diff = DateTime.now().difference(parsed.toLocal());
    if (diff.inSeconds < 60) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${parsed.day}/${parsed.month}/${parsed.year}';
  }
}
