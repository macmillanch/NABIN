import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/theme/driver_theme.dart';
import '../../../../core/widgets/driver_button.dart';
import '../../../../core/widgets/driver_card.dart';

/// Where NABIN sends this partner's money, and what the platform says about it.
///
/// Both halves of this screen come from one contract pair, read from the repository and then
/// probed with a live DRIVER session on 2026-10-08:
///
/// - **Read** — `GET /api/driver/earnings` (`server.js:6226`), whose `payout` block
///   (`server.js:6210-6216`) carries `destination`, `destinationVerified`, `pendingDestination`,
///   `destinationCoolingUntil`, `kycStatus` and `operationalStatus`. Those six fields are the
///   whole of what the platform exposes to a partner about their destination; the block is
///   refreshed from the durable `drivers` row before every answer
///   (`database.js:4160-4186`), so what is shown here is the column value, not a session
///   snapshot. Identity comes from the bearer token — the route takes no driver id.
/// - **Write** — `POST /api/driver/payout-destination/request` (`server.js:5805`), whose body is
///   `{upiId}` and nothing else. An accepted request writes `pending_upi_id` **and** sets
///   `payout_upi_verified` to false in one update (`DriverRepository.js:682-697`), which the
///   probe confirmed on the live row: the next read came back with `destination: null` and
///   `destinationVerified: false`. So requesting a change takes the current address out of use
///   immediately, and only an administrator's verification puts one back in
///   (`server.js:5044`, `DriverRepository.js:701`).
///
/// What is deliberately **not** here:
/// - **No payout history.** No Driver route reads `driver_payouts` — the backend only ever
///   inserts into it (`database.js:4489`) and reads one `idempotency_key` back for the
///   notification bus (`server.js:5857`), and the finance reads that do exist are
///   `authenticateAdmin` + `finance.settlement` (`server.js:2118-2160`). `GET /api/driver/earnings`
///   does have a `transactions` key, but it is served from `db.transactions`, an array seeded
///   from literals at boot and appended to by whatever this one process has done — never
///   re-read from PostgreSQL and never persisted (`database.js:2913-2919`). Rendering it would
///   be presenting a restart-lost sample as a partner's settlement record, so the screen says
///   plainly that history cannot be read here.
/// - **No verification claim.** `destinationVerified` is the platform's boolean. Nothing on this
///   screen infers it from a field being non-empty, from elapsed time, or from a successful POST.
/// - **No invented timing.** The cooling period is shown as the timestamp NABIN sent; this screen
///   neither calculates one nor promises a review window NABIN has not stated.
///
/// The destination is displayed in full, un-masked, because it is the partner's own payout
/// address on their own authenticated device and confirming it is the point of the screen — the
/// sibling Earnings and Account screens already render the same value. Nothing here logs it, and
/// nothing here puts it in a URL.
class DriverPayoutScreen extends StatefulWidget {
  const DriverPayoutScreen({super.key});

  @override
  State<DriverPayoutScreen> createState() => _DriverPayoutScreenState();
}

/// The `payout` block, plus the two read fields this screen repeats back.
class _Destination {
  const _Destination({
    required this.destination,
    required this.destinationVerified,
    required this.pendingDestination,
    required this.coolingUntil,
    required this.kycStatus,
    required this.source,
  });

  final String? destination;
  final bool destinationVerified;
  final String? pendingDestination;
  final DateTime? coolingUntil;
  final String? kycStatus;

  /// `postgres` or `hydrated-memory` (`server.js:6184`). A partner deciding where their money
  /// goes deserves to know whether the answer came from the durable row.
  final String source;

  static _Destination? fromJson(Map<String, dynamic> json) {
    if (json['success'] != true) return null;
    // A payload without the block is not "no destination" — it is a read that did not answer the
    // question, which is a different sentence and a different state.
    final raw = json['payout'];
    if (raw is! Map) return null;
    final cooling = raw['destinationCoolingUntil'];
    return _Destination(
      destination: raw['destination'] as String?,
      destinationVerified: raw['destinationVerified'] == true,
      pendingDestination: raw['pendingDestination'] as String?,
      coolingUntil: cooling is String ? DateTime.tryParse(cooling)?.toLocal() : null,
      kycStatus: raw['kycStatus'] as String?,
      source: (json['source'] as String?) ?? 'unknown',
    );
  }

  bool get coolingActive {
    final at = coolingUntil;
    return at != null && at.isAfter(DateTime.now());
  }
}

enum _ReadState { loading, ready, failed }

class _DriverPayoutScreenState extends State<DriverPayoutScreen> {
  /// The one VPA shape the route accepts (`DriverRepository.js:675`): a local part of 2-256
  /// characters from `[a-zA-Z0-9._-]`, then `@`, then 2-64 letters. A value that passes it but is
  /// longer than 100 characters is refused by the `varchar(100)` column with a raw PostgreSQL
  /// message (measured 2026-10-08), so the column cap is applied here as well.
  static final RegExp _upiPattern = RegExp(r'^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$');

  _ReadState _read = _ReadState.loading;
  _Destination? _data;
  String? _readFailure;
  bool _sessionClosed = false;

  final TextEditingController _upiController = TextEditingController();
  bool _isSubmitting = false;
  String? _submitFailure;
  String? _submitted;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _upiController.dispose();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _read = _ReadState.loading);
    final payload = await NabinApiService.getMyEarnings();
    if (!mounted) return;

    final parsed = payload == null ? null : _Destination.fromJson(payload);
    if (parsed != null) {
      setState(() {
        _data = parsed;
        _read = _ReadState.ready;
        _readFailure = null;
        _sessionClosed = false;
      });
      return;
    }

    // A failure must not be drawn as "no destination on file", so the reason is kept in words.
    final code = payload?['statusCode'];
    setState(() {
      _sessionClosed = code == 401;
      if (silent) {
        // A refresh that failed leaves what was already on screen: the destination has not
        // changed, and replacing it with an error would imply it had.
        _readFailure = _explain(code, payload?['error']);
      } else {
        _data = null;
        _read = _ReadState.failed;
        _readFailure = _explain(code, payload?['error']);
      }
    });
  }

  String _explain(Object? code, Object? serverError) {
    if (code == 401) {
      return 'Your session with NABIN has closed. Sign in again to see your payout destination.';
    }
    final server = serverError is String ? serverError.trim() : '';
    if (server.isNotEmpty) return server;
    if (code is int && code >= 500) {
      return 'NABIN could not read your payout destination just now. Nothing about it has changed.';
    }
    return 'No connection to NABIN. Your payout destination has not been loaded, and nothing about '
        'it has changed.';
  }

  String? _validate(String raw) {
    final value = raw.trim();
    if (value.isEmpty) return 'NABIN needs a UPI address to record. Enter one.';
    if (value.length > 100) {
      return 'NABIN stores a payout address up to 100 characters. This is ${value.length}.';
    }
    if (!_upiPattern.hasMatch(value)) {
      return 'NABIN refused this shape: a UPI address is 2-256 characters of letters, digits, '
          'dot, underscore or hyphen, then @, then 2-64 letters.';
    }
    return null;
  }

  Future<void> _submit() async {
    // One write in flight. This route has no idempotency key and no deduplication — a second
    // accepted request simply overwrites `pending_upi_id` (measured 2026-10-08) — so a double
    // tap is a second write, not a retry of the first.
    if (_isSubmitting) return;
    final upiId = _upiController.text.trim();
    final problem = _validate(upiId);
    if (problem != null) {
      setState(() => _submitFailure = problem);
      return;
    }

    setState(() {
      _isSubmitting = true;
      _submitFailure = null;
      _submitted = null;
    });

    final res = await NabinApiService.requestPayoutDestination(upiId: upiId);
    if (!mounted) return;
    setState(() => _isSubmitting = false);

    if (res == null) {
      // The request left and no answer came back. With no idempotency key there is no way to
      // tell from here whether the pending destination moved, so the honest instruction is to
      // look, not to send again.
      setState(() {
        _submitFailure = 'NABIN did not answer, so this request could not be confirmed. Do not '
            'send it again — pull to refresh and check what NABIN holds as your pending '
            'destination before you do.';
      });
      return;
    }

    final code = res['statusCode'] is int ? res['statusCode'] as int : null;
    final serverError = res['error'] is String ? (res['error'] as String).trim() : '';

    if (res['success'] == true) {
      // The platform's own answer, not this screen's hope: a 200 here means PENDING_VERIFICATION,
      // never a verified destination.
      final status = res['status'] is String ? (res['status'] as String) : 'PENDING_VERIFICATION';
      setState(() => _submitted = 'NABIN recorded this destination as $status. It is not verified '
          'yet — a NABIN administrator has to verify it before payouts can use it, and NABIN has '
          'not told this app how long that takes.');
      // Re-read so the state shown after the write is the platform's, not the response's summary.
      await _load(silent: true);
      return;
    }

    setState(() {
      if (code == 401) {
        _submitFailure = 'Your session with NABIN has closed. Sign in again before requesting a '
            'payout destination.';
      } else if (code != null && code >= 500) {
        _submitFailure = 'NABIN could not complete the request just now. Nothing was '
            'changed — refresh to see the destination NABIN still holds.';
      } else if (serverError.isNotEmpty) {
        // A 400 or 403 from this route is a refusal made before the row is written, so
        // "nothing was changed" is a fact here rather than an assumption.
        _submitFailure = 'NABIN refused this request: $serverError Nothing was changed.';
      } else {
        _submitFailure = 'NABIN refused this request. Nothing was changed.';
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DriverTheme.bgLight,
      appBar: AppBar(
        title: const Text('Payout destination'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            if (context.canPop()) {
              context.pop();
            } else {
              context.go('/account');
            }
          },
        ),
        actions: [
          IconButton(
            onPressed: _read == _ReadState.loading ? null : () => _load(silent: true),
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: SafeArea(
        child: switch (_read) {
          _ReadState.loading => const Center(child: CircularProgressIndicator()),
          _ReadState.failed => _buildFailed(),
          _ReadState.ready => _buildBody(),
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
            Icon(_sessionClosed ? Icons.lock_outline_rounded : Icons.cloud_off_rounded,
                size: 54, color: DriverTheme.textMuted),
            const SizedBox(height: 14),
            Text(_sessionClosed ? 'Your session has closed' : 'Could not load your payout destination',
                textAlign: TextAlign.center,
                style: const TextStyle(
                    fontWeight: FontWeight.w900, fontSize: 17, color: DriverTheme.textDark)),
            const SizedBox(height: 6),
            Text(_readFailure ?? '',
                textAlign: TextAlign.center,
                style: const TextStyle(color: DriverTheme.textMuted, fontSize: 13)),
            const SizedBox(height: 18),
            ElevatedButton.icon(
              key: const ValueKey('driver-payout-retry'),
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

  Widget _buildBody() {
    final d = _data;
    if (d == null) return const SizedBox.shrink();
    final destination = d.destination;
    final pending = d.pendingDestination;

    return RefreshIndicator(
      onRefresh: () => _load(silent: true),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
        children: [
          const Text(
            'NABIN sends your settled earnings to this UPI address. An administrator verifies a '
            'destination before any payout may use it, so the state below is NABIN\'s own, not '
            'something this app decides.',
            style: TextStyle(fontSize: 13, color: DriverTheme.textMuted, height: 1.4),
          ),
          if (d.source != 'postgres') ...[
            const SizedBox(height: 12),
            _Note(
              icon: Icons.storage_rounded,
              text: 'This answer came from NABIN\'s in-memory mirror (source: ${d.source}), not '
                  'from the durable driver record.',
            ),
          ],
          const SizedBox(height: 20),

          _StatusRow(
            key: const ValueKey('driver-payout-verified-state'),
            label: 'Verified destination',
            value: destination ?? 'No verified payout address on file',
            detail: d.destinationVerified
                ? 'VERIFIED on NABIN — payouts can be sent here'
                : (pending == null
                    ? 'NABIN has no verified destination for you yet'
                    : 'NABIN has not verified a destination for you yet'),
            verified: d.destinationVerified,
          ),

          if (pending != null)
            _StatusRow(
              key: const ValueKey('driver-payout-pending-state'),
              label: 'Requested destination',
              value: pending,
              detail: 'NABIN holds this as pending an administrator\'s verification',
              verified: false,
            ),

          if (d.coolingActive)
            _StatusRow(
              key: const ValueKey('driver-payout-cooling-state'),
              label: 'Destination cooling period',
              value: 'Until ${_stamp(d.coolingUntil!)}',
              detail: 'NABIN set this when the current destination was verified. A payout sent '
                  'before it passes is refused by the platform.',
              verified: false,
            ),

          if ((d.kycStatus ?? '').isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text('KYC on NABIN: ${d.kycStatus}',
                  style: const TextStyle(fontSize: 12, color: DriverTheme.textMuted)),
            ),

          if (_readFailure != null) ...[
            _Note(
              icon: Icons.refresh_rounded,
              text: _readFailure!,
              tone: _NoteTone.warning,
            ),
            const SizedBox(height: 12),
          ],

          const SizedBox(height: 8),
          const Text('Request a different destination',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
          const SizedBox(height: 4),
          Text(
            destination != null
                ? 'Sending a request takes this verified address out of use straight away: NABIN '
                    'marks the destination unverified in the same write and will not pay out to '
                    'the new one until an administrator verifies it.'
                : 'NABIN stores this as your requested destination and an administrator verifies '
                    'it before any payout can use it.',
            style: const TextStyle(fontSize: 12.5, color: DriverTheme.textMuted, height: 1.4),
          ),
          if (pending != null) ...[
            const SizedBox(height: 8),
            const Text(
              'A request you already made is still pending. Sending another replaces the pending '
              'address — NABIN keeps no queue of destination requests.',
              style: TextStyle(fontSize: 12.5, color: DriverTheme.textMuted, height: 1.4),
            ),
          ],
          const SizedBox(height: 12),
          DriverCard(
            backgroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: TextField(
              key: const ValueKey('driver-payout-upi-field'),
              controller: _upiController,
              maxLength: 100,
              enabled: !_isSubmitting,
              textInputAction: TextInputAction.done,
              keyboardType: TextInputType.text,
              autocorrect: false,
              enableInteractiveSelection: true,
              style: const TextStyle(fontWeight: FontWeight.bold, color: DriverTheme.textDark),
              decoration: const InputDecoration(
                labelText: 'New UPI address',
                counterText: '',
                border: InputBorder.none,
              ),
              onChanged: (_) {
                if (_submitFailure != null) setState(() => _submitFailure = null);
              },
              onSubmitted: (_) => _submit(),
            ),
          ),
          const SizedBox(height: 6),
          const Text('NABIN stores a payout address up to 100 characters.',
              style: TextStyle(fontSize: 11.5, color: DriverTheme.textMuted)),
          const SizedBox(height: 16),

          if (_submitted != null)
            _Note(
              key: const ValueKey('driver-payout-submitted'),
              icon: Icons.hourglass_top_rounded,
              text: _submitted!,
              tone: _NoteTone.good,
            ),

          if (_submitFailure != null)
            Container(
              key: const ValueKey('driver-payout-submit-failure'),
              margin: const EdgeInsets.only(bottom: 16),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: DriverTheme.alertRed.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: DriverTheme.alertRed.withValues(alpha: 0.45)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.error_outline_rounded, size: 20, color: DriverTheme.alertRed),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(_submitFailure!,
                        style: const TextStyle(
                            fontSize: 13,
                            color: DriverTheme.alertRed,
                            fontWeight: FontWeight.w700,
                            height: 1.35)),
                  ),
                ],
              ),
            ),

          DriverButton(
            key: const ValueKey('driver-payout-submit'),
            text: 'Send request',
            icon: Icons.send_rounded,
            isLoading: _isSubmitting,
            onPressed: _submit,
          ),

          const SizedBox(height: 28),
          const Text('Payout history',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
          const SizedBox(height: 10),
          const DriverCard(
            key: ValueKey('driver-payout-history-unavailable'),
            // White, like every other card on this light-background screen: `DriverCard`'s
            // default is the dark theme's elevated surface, which reads as a black hole here.
            backgroundColor: Colors.white,
            padding: EdgeInsets.all(16),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.hourglass_empty_rounded, size: 22, color: DriverTheme.textMuted),
                SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Payout history isn\'t available in the Driver app yet. NABIN has no payout '
                    'read this app can call, so there are no amounts, dates or references to show. '
                    'Your settled trips are listed in Earnings & Settlements.',
                    style: TextStyle(fontSize: 13, color: DriverTheme.textMuted, height: 1.4),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          TextButton.icon(
            key: const ValueKey('driver-payout-open-earnings'),
            onPressed: () => context.push('/earnings'),
            icon: const Icon(Icons.account_balance_wallet_outlined, size: 20),
            label: const Text('Open Earnings & Settlements'),
            style: TextButton.styleFrom(foregroundColor: DriverTheme.primaryBlue),
          ),
        ],
      ),
    );
  }

  /// The timestamp exactly as NABIN sent it, in the same `d/m/yyyy HH:mm` shape the support
  /// thread uses. There is no substitute for it: a cooling date this app calculated would be a
  /// date NABIN never stated.
  static String _stamp(DateTime at) {
    String two(int v) => v.toString().padLeft(2, '0');
    return '${two(at.day)}/${two(at.month)}/${at.year} ${two(at.hour)}:${two(at.minute)}';
  }
}

/// One destination state, labelled with the platform's own word for it.
class _StatusRow extends StatelessWidget {
  const _StatusRow({
    super.key,
    required this.label,
    required this.value,
    required this.detail,
    required this.verified,
  });

  final String label;
  final String value;
  final String detail;
  final bool verified;

  @override
  Widget build(BuildContext context) {
    final color = verified ? DriverTheme.onlineGreen : DriverTheme.warningAmber;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      child: DriverCard(
        backgroundColor: Colors.white,
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(verified ? Icons.verified_rounded : Icons.pending_outlined,
                    size: 16, color: verified ? DriverTheme.onlineGreen : DriverTheme.roadGold),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(label.toUpperCase(),
                      style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 0.6,
                          color: color)),
                ),
              ],
            ),
            const SizedBox(height: 8),
            // The address itself, wrapped rather than ellipsised: a destination the partner cannot
            // read in full is a destination they cannot confirm.
            Text(value,
                style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w900,
                    color: verified ? DriverTheme.textDark : DriverTheme.textMuted,
                    height: 1.35)),
            const SizedBox(height: 4),
            Text(detail, style: const TextStyle(fontSize: 12, color: DriverTheme.textMuted, height: 1.35)),
          ],
        ),
      ),
    );
  }
}

enum _NoteTone { plain, good, warning }

class _Note extends StatelessWidget {
  const _Note({super.key, required this.icon, required this.text, this.tone = _NoteTone.plain});

  final IconData icon;
  final String text;
  final _NoteTone tone;

  @override
  Widget build(BuildContext context) {
    final Color tint = switch (tone) {
      _NoteTone.good => DriverTheme.onlineGreen,
      _NoteTone.warning => DriverTheme.warningAmber,
      _NoteTone.plain => DriverTheme.primaryBlue,
    };
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: tint.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: tint.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: tint),
          const SizedBox(width: 10),
          Expanded(
            child: Text(text,
                style: const TextStyle(
                    fontSize: 12.5,
                    color: DriverTheme.textDark,
                    fontWeight: FontWeight.w600,
                    height: 1.35)),
          ),
        ],
      ),
    );
  }
}
