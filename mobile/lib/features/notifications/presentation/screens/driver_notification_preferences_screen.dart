import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/theme/driver_theme.dart';
import '../../../../core/widgets/driver_card.dart';

/// What the signed-in partner is told about, and through which channel.
///
/// Every row on this screen is one boolean column of the platform's `notification_preferences`
/// row, written through `PUT /api/notifications/preferences` and read back from the row the
/// server returns. Identity comes from the bearer token, so a partner cannot name someone
/// else's preference row, and the backend snake-cases the key and drops anything outside its
/// allowlist — which is why only these thirteen keys are ever sent.
///
/// The copy under each label is deliberately uneven. `PushNotificationService` consults only
/// seven of the thirteen flags; the other six are stored and read back but no delivery path
/// looks at them today, so those rows say so instead of implying a capability the platform
/// does not have. Nothing here is client-side state: a switch that did not persist rolls back.
class DriverNotificationPreferencesScreen extends StatefulWidget {
  const DriverNotificationPreferencesScreen({super.key});

  @override
  State<DriverNotificationPreferencesScreen> createState() =>
      _DriverNotificationPreferencesScreenState();
}

/// One persisted flag. [key] is the camelCase name the backend's read returns and its PUT
/// accepts; [enforced] records whether any delivery path in the backend actually reads it.
class _PrefFlag {
  const _PrefFlag({
    required this.key,
    required this.label,
    required this.note,
    required this.enforced,
  });

  final String key;
  final String label;
  final String note;
  final bool enforced;
}

const List<_PrefFlag> _subjects = <_PrefFlag>[
  _PrefFlag(
    key: 'ridesEnabled',
    label: 'Rides',
    note: 'Ride trip messages.',
    enforced: true,
  ),
  _PrefFlag(
    key: 'driverUpdatesEnabled',
    label: 'Driver updates',
    note: 'NABIN stores this choice, but no delivery path reads it yet.',
    enforced: false,
  ),
  _PrefFlag(
    key: 'parcelEnabled',
    label: 'Parcel deliveries',
    note: 'Parcel trip messages.',
    enforced: true,
  ),
  _PrefFlag(
    key: 'foodEnabled',
    label: 'Food orders',
    note: 'Food delivery trip messages.',
    enforced: true,
  ),
  _PrefFlag(
    key: 'groceryEnabled',
    label: 'Grocery orders',
    note: 'Grocery delivery trip messages.',
    enforced: true,
  ),
  _PrefFlag(
    key: 'paymentsEnabled',
    label: 'Payments and refunds',
    note: 'Stored, not read yet — and payment messages are delivered whatever this says.',
    enforced: false,
  ),
  _PrefFlag(
    key: 'promotionsEnabled',
    label: 'Offers and promotions',
    note: 'Marketing messages.',
    enforced: true,
  ),
  _PrefFlag(
    key: 'supportEnabled',
    label: 'Support replies',
    note: 'Helpdesk messages.',
    enforced: true,
  ),
  _PrefFlag(
    key: 'systemEnabled',
    label: 'Account and system alerts',
    note: 'NABIN stores this choice, but no delivery path reads it yet.',
    enforced: false,
  ),
];

const List<_PrefFlag> _channels = <_PrefFlag>[
  _PrefFlag(
    key: 'pushEnabled',
    label: 'Push notifications',
    note: 'Off stops pushes, except payment and account-security alerts, which are mandatory.',
    enforced: true,
  ),
  _PrefFlag(
    key: 'inAppEnabled',
    label: 'In-app inbox',
    note: 'Stored, not read yet — this inbox is shown whatever this says.',
    enforced: false,
  ),
  _PrefFlag(
    key: 'smsEnabled',
    label: 'SMS',
    note: 'NABIN stores this choice, but no delivery path reads it yet.',
    enforced: false,
  ),
  _PrefFlag(
    key: 'emailEnabled',
    label: 'Email',
    note: 'NABIN stores this choice, but no delivery path reads it yet.',
    enforced: false,
  ),
];

enum _PrefsState { loading, ready, failed }

class _DriverNotificationPreferencesScreenState
    extends State<DriverNotificationPreferencesScreen> {
  _PrefsState _state = _PrefsState.loading;

  /// Null until the platform has returned all thirteen booleans. A partial answer cannot be
  /// drawn as thirteen switches, because six of them would be a guess.
  Map<String, bool>? _prefs;
  String? _failureMessage;

  /// One write in flight. A second toggle during an unanswered PUT would let the platform
  /// receive two overlapping rows and confirm only the last.
  String? _savingKey;
  String? _saveError;

  @override
  void initState() {
    super.initState();
    _load();
  }

  static final List<String> _allKeys =
      <_PrefFlag>[..._subjects, ..._channels].map((f) => f.key).toList();

  static Map<String, bool>? _boolsFrom(Map<dynamic, dynamic> row) {
    final out = <String, bool>{};
    for (final key in _allKeys) {
      final value = row[key];
      if (value is! bool) return null;
      out[key] = value;
    }
    return out;
  }

  Future<void> _load() async {
    setState(() {
      _state = _PrefsState.loading;
      _failureMessage = null;
    });
    final res = await NabinApiService.getNotificationPreferences();
    if (!mounted) return;

    if (res == null || res['success'] != true) {
      setState(() {
        _state = _PrefsState.failed;
        _prefs = null;
        _failureMessage = res == null
            ? 'No connection to NABIN. Your saved preferences have not changed.'
            : (res['error'] as String?) ?? 'Could not load your notification preferences.';
      });
      return;
    }

    final parsed = _boolsFrom((res['preferences'] as Map?) ?? const {});
    if (parsed == null) {
      setState(() {
        _state = _PrefsState.failed;
        _prefs = null;
        _failureMessage =
            'NABIN answered, but the answer did not carry every preference, so nothing is '
            'shown as on or off.';
      });
      return;
    }
    setState(() {
      _prefs = parsed;
      _state = _PrefsState.ready;
      _failureMessage = null;
    });
  }

  Future<void> _toggle(_PrefFlag flag, bool value) async {
    final current = _prefs;
    if (_savingKey != null || current == null) return;
    final before = current[flag.key];
    setState(() {
      _prefs = <String, bool>{...current, flag.key: value};
      _savingKey = flag.key;
      _saveError = null;
    });

    final res = await NabinApiService.updateNotificationPreferences({flag.key: value});
    if (!mounted) return;

    final returned = res != null && res['success'] == true
        ? _boolsFrom((res['preferences'] as Map?) ?? const {})
        : null;
    setState(() {
      if (returned != null) {
        // The row the platform wrote is what goes on screen, so a flag this tap did not
        // touch is shown as the server holds it rather than as this screen last saw it.
        _prefs = returned;
      } else {
        if (before != null) _prefs = <String, bool>{...?_prefs, flag.key: before};
        _saveError = res?['error'] as String? ??
            'That change was not saved. Everything else is as it was.';
      }
      _savingKey = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DriverTheme.bgLight,
      appBar: AppBar(
        title: const Text('Notification Preferences'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/account'),
        ),
        actions: [
          IconButton(
            onPressed: _state == _PrefsState.loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: SafeArea(
        child: switch (_state) {
          _PrefsState.loading => const Center(child: CircularProgressIndicator()),
          _PrefsState.failed => _buildFailed(),
          _PrefsState.ready => _buildPreferences(),
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
            const Text('Could not load your preferences',
                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: DriverTheme.textDark)),
            const SizedBox(height: 6),
            Text(_failureMessage ?? 'Nothing about your saved preferences has changed.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: DriverTheme.textMuted, fontSize: 13)),
            const SizedBox(height: 18),
            ElevatedButton.icon(
              onPressed: _load,
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

  Widget _buildPreferences() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildSection('What we tell you about', _subjects),
          const SizedBox(height: 24),
          _buildSection('How we reach you', _channels),
          if (_saveError != null) ...[
            const SizedBox(height: 4),
            Text(_saveError!,
                style: const TextStyle(
                    color: DriverTheme.alertRed, fontSize: 13, fontWeight: FontWeight.w600)),
          ],
          const SizedBox(height: 20),
          const DriverCard(
            padding: EdgeInsets.all(16),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.info_outline_rounded, size: 20, color: DriverTheme.primaryBlue),
                SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Payment, wallet and payout messages, and account-security alerts such as '
                    'KYC decisions and locked accounts, are delivered whatever these switches '
                    'say. NABIN treats those two kinds as mandatory.',
                    style: TextStyle(fontSize: 12.5, color: DriverTheme.textDark, height: 1.45),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 40),
        ],
      ),
    );
  }

  Widget _buildSection(String title, List<_PrefFlag> flags) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title,
            style: const TextStyle(
                fontSize: 16, fontWeight: FontWeight.bold, color: DriverTheme.textDark)),
        const SizedBox(height: 10),
        for (final flag in flags) _buildRow(flag),
      ],
    );
  }

  Widget _buildRow(_PrefFlag flag) {
    final saving = _savingKey == flag.key;
    return Container(
      key: ValueKey('driver-notification-pref-${flag.key}'),
      margin: const EdgeInsets.only(bottom: 10),
      child: DriverCard(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(flag.label,
                      style: const TextStyle(
                          fontWeight: FontWeight.bold, fontSize: 14, color: DriverTheme.textDark)),
                  const SizedBox(height: 2),
                  Text(
                    flag.note,
                    style: TextStyle(
                      fontSize: 12,
                      height: 1.35,
                      color: flag.enforced ? DriverTheme.textMuted : DriverTheme.roadGold,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            if (saving)
              const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                    strokeWidth: 2, color: DriverTheme.primaryBlue),
              )
            else
              Switch(
                key: ValueKey('driver-notification-pref-switch-${flag.key}'),
                value: _prefs?[flag.key] ?? true,
                activeThumbColor: DriverTheme.primaryBlue,
                // Every switch goes dead while one write is unanswered, so a rapid second tap
                // cannot put two overlapping PUTs on the wire.
                onChanged: _savingKey == null ? (val) => _toggle(flag, val) : null,
              ),
          ],
        ),
      ),
    );
  }
}
