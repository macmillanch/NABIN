import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/network/session_manager.dart';
import '../../../../core/theme/driver_theme.dart';
import '../../../../core/widgets/driver_card.dart';
import '../models/driver_ticket.dart';
import '../widgets/driver_ticket_status_chip.dart';

/// The signed-in partner's own support tickets.
///
/// Read contract, verified against `backend/src/server.js:2015` and
/// `SupportTicketRepository.getTicketsByUser` with two live DRIVER sessions on 2026-10-08:
/// `GET /api/support/user/:userId` is the ONLY read a partner has — there is no
/// ticket-by-id route — and every ticket it returns carries its whole `messages` thread inside
/// it. Rows come back newest first, the endpoint has no pagination (it ignores `limit` and
/// `offset`), and the response keys are exactly `success` and `tickets`.
///
/// Identity is the dangerous part of this endpoint, because the path parameter looks like a
/// parameter. It is not an invitation to name a mailbox: `requireSupportCallerAuth` resolves the
/// caller from the bearer token alone, and `server.js:2017` then refuses anything that is not
/// that caller's own id with a 403 before the repository checks it again against the row uuid.
/// Measured: driver `DRV-103` reading `DRV-103` is 200, reading `DRV-101` is 403, and reading
/// its own row uuid rather than its session id is also 403. So the value below is taken from the
/// session the app authenticated with and is never typed, parsed from a link, or chosen by
/// anything a partner can edit.
///
/// Nothing here fabricates a conversation. No ticket id, subject, status, timestamp, message,
/// sender name or agent identity is written into this file, because the platform sends all of
/// them. And no state is improvised either: an unreachable platform is reported as a failure
/// while the rows already on screen stay up, and "NABIN has never opened a ticket for you" is a
/// different screen from "the read did not happen".
class DriverSupportScreen extends StatefulWidget {
  const DriverSupportScreen({super.key});

  @override
  State<DriverSupportScreen> createState() => _DriverSupportScreenState();
}

enum _TicketsState { loading, ready, failed }

class _DriverSupportScreenState extends State<DriverSupportScreen> {
  List<DriverTicket> _rows = const <DriverTicket>[];
  _TicketsState _state = _TicketsState.loading;
  String? _failureMessage;

  /// The id this session was minted with, which is what the route accepts. `null` is a closed
  /// or unknown session, not an empty mailbox.
  String? get _ownUserId => SessionManager.instance.currentUser?['id']?.toString();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _state = _TicketsState.loading;
        _failureMessage = null;
      });
    }
    final userId = _ownUserId;
    if (userId == null || userId.isEmpty) {
      if (!mounted) return;
      setState(() {
        _state = _TicketsState.failed;
        _rows = const <DriverTicket>[];
        _failureMessage = 'NABIN does not know which partner this session belongs to. '
            'Sign in again to read your tickets.';
      });
      return;
    }

    final res = await NabinApiService.getSupportTickets(userId: userId);
    if (!mounted) return;

    if (res['success'] != true) {
      final message = _explainFailure(res);
      // A refresh that failed leaves the previous rows where they are: nothing about the
      // partner's tickets changed just because this read did not land.
      if (silent && _rows.isNotEmpty) {
        setState(() => _failureMessage = message);
        return;
      }
      setState(() {
        _state = _TicketsState.failed;
        _rows = const <DriverTicket>[];
        _failureMessage = message;
      });
      return;
    }

    final rows = ((res['tickets'] as List?) ?? const [])
        .map(DriverTicket.fromJson)
        .whereType<DriverTicket>()
        .toList();
    setState(() {
      _rows = rows;
      _state = _TicketsState.ready;
      _failureMessage = null;
    });
  }

  /// The repository's existing session-expiry wording pattern: the code the platform answered
  /// with becomes a sentence the partner can act on, and the server's own message is kept when
  /// it is the more specific one.
  String _explainFailure(Map<String, dynamic> res) {
    final code = res['statusCode'];
    if (code == 401) return 'Your session with NABIN has closed. Sign in again to read your tickets.';
    if (code == 403) {
      return 'NABIN refused this read: a partner may only open their own tickets.';
    }
    final server = res['error'];
    if (server is String && server.trim().isNotEmpty) return server;
    if (code is int && code >= 500) {
      return 'NABIN could not serve the ticket list (HTTP $code). Nothing on this screen has changed.';
    }
    return 'No connection to NABIN. Your tickets have not been loaded, and nothing about them has changed.';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DriverTheme.bgLight,
      appBar: AppBar(
        title: const Text('Driver Support'),
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
            onPressed: _state == _TicketsState.loading ? null : () => _load(),
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh',
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        key: const ValueKey('driver-support-new-ticket'),
        onPressed: () => context.push('/support/new'),
        backgroundColor: DriverTheme.primaryBlue,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add_rounded),
        label: const Text('New ticket'),
      ),
      body: SafeArea(
        child: switch (_state) {
          _TicketsState.loading => const Center(child: CircularProgressIndicator()),
          _TicketsState.failed => _buildFailed(),
          _TicketsState.ready => _buildList(),
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
            const Text('Could not load your tickets',
                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: DriverTheme.textDark)),
            const SizedBox(height: 6),
            Text(_failureMessage ?? 'Nothing about your tickets has changed.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: DriverTheme.textMuted, fontSize: 13)),
            const SizedBox(height: 18),
            ElevatedButton.icon(
              key: const ValueKey('driver-support-retry'),
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

  Widget _buildList() {
    return RefreshIndicator(
      onRefresh: () => _load(silent: true),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 96),
        children: [
          if (_failureMessage != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text(_failureMessage!,
                  style: const TextStyle(fontSize: 12, color: DriverTheme.roadGold)),
            ),
          if (_rows.isEmpty) _buildEmpty() else ..._rows.map(_buildCard),
        ],
      ),
    );
  }

  /// The partner has never opened a ticket. Not an error, and not a place to promise an answer
  /// time: the backend sends no such thing.
  Widget _buildEmpty() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 12),
      child: Column(
        children: [
          Icon(Icons.support_agent_rounded,
              size: 54, color: DriverTheme.textMuted.withValues(alpha: 0.6)),
          const SizedBox(height: 14),
          const Text('No tickets yet',
              style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: DriverTheme.textDark)),
          const SizedBox(height: 6),
          const Text(
            'You have not raised anything with the NABIN partner helpdesk yet. A ticket is a '
            'written thread: whatever you send stays on this screen until the platform answers it.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13, color: DriverTheme.textMuted, height: 1.4),
          ),
          const SizedBox(height: 18),
          SizedBox(
            width: 220,
            child: OutlinedButton.icon(
              key: const ValueKey('driver-support-empty-new-ticket'),
              onPressed: () => context.push('/support/new'),
              icon: const Icon(Icons.add_rounded, size: 18),
              label: const Text('Raise your first ticket'),
              style: OutlinedButton.styleFrom(
                foregroundColor: DriverTheme.primaryBlue,
                side: const BorderSide(color: DriverTheme.primaryBlue),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCard(DriverTicket row) {
    return Container(
      key: ValueKey('driver-support-ticket-${row.ref}'),
      margin: const EdgeInsets.only(bottom: 12),
      child: DriverCard(
        backgroundColor: Colors.white,
        borderColor: DriverTheme.borderLight,
        padding: const EdgeInsets.all(16),
        borderRadius: 20,
        onTap: () => context.push('/support/ticket/${Uri.encodeComponent(row.ref)}'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    row.label,
                    style: const TextStyle(
                        fontWeight: FontWeight.w900, fontSize: 14.5, color: DriverTheme.textDark),
                  ),
                ),
                const SizedBox(width: 10),
                DriverTicketStatusChip(status: row.status),
              ],
            ),
            const SizedBox(height: 6),
            // The reference the platform minted. A row that carries none says so instead of
            // printing a made-up ticket number.
            Text(
              row.ticketNumber ?? 'No ticket number on this row',
              style: const TextStyle(fontSize: 12, color: DriverTheme.textMuted, letterSpacing: 0.3),
            ),
            const SizedBox(height: 8),
            Text(row.when, style: const TextStyle(fontSize: 12, color: DriverTheme.textMuted)),
          ],
        ),
      ),
    );
  }
}
