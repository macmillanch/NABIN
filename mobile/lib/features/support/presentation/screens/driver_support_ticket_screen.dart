import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/network/session_manager.dart';
import '../../../../core/theme/driver_theme.dart';
import '../../../../core/widgets/driver_card.dart';
import '../models/driver_ticket.dart';
import '../widgets/driver_ticket_status_chip.dart';

/// One ticket's thread, and the only way a partner can answer it.
///
/// How a thread is read is decided by the backend, not by this screen. There is no
/// `GET /api/support/ticket/:id` — `backend/src/server.js` exposes exactly three partner support
/// routes — so the thread comes from `GET /api/support/user/:userId`, whose rows each carry their
/// whole `messages` JSONB array, and this screen selects the row whose handle matches the route.
/// That is also why opening a ticket is a read of the partner's own list and nothing else: the
/// list is scoped by the bearer token (`server.js:2017`, then the repository's uuid check), so a
/// ticket belonging to another driver is simply never in the rows to be selected. Measured with
/// two live driver sessions on 2026-10-08: driver B reading driver A's list is 403, and replying
/// to a ticket that is not theirs is 404, not 403, so ticket numbers cannot be enumerated.
///
/// A reply is `POST /api/support/ticket/:id/message` with a body of one field, `text`. The
/// platform writes the sender: a probe that sent `senderRole: 'ADMIN'` and a fake `senderName`
/// stored the driver's own role and name instead (`SupportTicketRepository.addMessage`). So the
/// bubbles below label both sides from `senderRole` / `senderName` as returned, and this file
/// never names an agent, never draws a "Support Team" that NABIN did not send, and never shows a
/// reply as delivered before the platform has confirmed it.
///
/// Two backend behaviours that a nicer UI would hide are stated here instead: the route has no
/// status guard, so a reply is accepted on a resolved ticket and stays in the thread; and it has
/// no idempotency key, so the send is single-flight and a refusal keeps the typed text.
class DriverSupportTicketScreen extends StatefulWidget {
  const DriverSupportTicketScreen({super.key, required this.ticketRef});

  /// Either spelling the reply route resolves — the minted `ticket_number` or the row uuid.
  final String ticketRef;

  @override
  State<DriverSupportTicketScreen> createState() => _DriverSupportTicketScreenState();
}

enum _TicketState { loading, ready, missing, failed }

class _DriverSupportTicketScreenState extends State<DriverSupportTicketScreen> {
  static const int _replyLimit = 4000;

  final TextEditingController _replyController = TextEditingController();
  final ScrollController _scrollController = ScrollController();

  _TicketState _state = _TicketState.loading;
  DriverTicket? _ticket;
  String? _failureMessage;
  String? _replyFailure;

  /// One POST in flight. `addMessage` appends unconditionally, so a second tap on an unanswered
  /// first one is a second message in the thread with nothing in the backend to collapse them.
  bool _isSendingReply = false;

  String? get _ownUserId => SessionManager.instance.currentUser?['id']?.toString();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _replyController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _state = _TicketState.loading;
        _failureMessage = null;
      });
    }
    final userId = _ownUserId;
    if (userId == null || userId.isEmpty) {
      if (!mounted) return;
      setState(() {
        _state = _TicketState.failed;
        _failureMessage = 'NABIN does not know which partner this session belongs to. '
            'Sign in again to read this ticket.';
      });
      return;
    }

    final res = await NabinApiService.getSupportTickets(userId: userId);
    if (!mounted) return;

    if (res['success'] != true) {
      final message = _explainReadFailure(res);
      // A failed refresh of a thread already on screen must not erase it.
      if (silent && _ticket != null) {
        setState(() => _failureMessage = message);
        return;
      }
      setState(() {
        _state = _TicketState.failed;
        _failureMessage = message;
      });
      return;
    }

    DriverTicket? found;
    for (final row in ((res['tickets'] as List?) ?? const <Object>[])) {
      final ticket = DriverTicket.fromJson(row);
      if (ticket != null && ticket.matches(widget.ticketRef)) {
        found = ticket;
        break;
      }
    }
    setState(() {
      _ticket = found;
      // Not in the partner's own list is its own honest answer. It is not rendered as a ticket
      // with no messages, and it is not retried against the reply route to find out whose it is.
      _state = found == null ? _TicketState.missing : _TicketState.ready;
      _failureMessage = null;
    });
  }

  String _explainReadFailure(Map<String, dynamic> res) {
    final code = res['statusCode'];
    if (code == 401) return 'Your session with NABIN has closed. Sign in again to read this ticket.';
    if (code == 403) return 'NABIN refused this read: a partner may only open their own tickets.';
    final server = res['error'];
    if (server is String && server.trim().isNotEmpty) return server;
    if (code is int && code >= 500) {
      return 'NABIN could not serve this thread (HTTP $code). Nothing on this screen has changed.';
    }
    return 'No connection to NABIN. This thread has not been loaded, and nothing about it has changed.';
  }

  Future<void> _sendReply() async {
    if (_isSendingReply) return;
    final text = _replyController.text.trim();
    if (text.isEmpty) {
      // The backend answers this with 400 "Message text cannot be empty". Nothing was sent, so
      // nothing is added to the thread.
      setState(() => _replyFailure = 'Write something before sending — an empty message is refused.');
      return;
    }
    final ticket = _ticket;
    if (ticket == null) return;

    setState(() {
      _isSendingReply = true;
      _replyFailure = null;
    });

    final res = await NabinApiService.sendSupportTicketMessage(
      ticketRef: ticket.ref,
      text: text,
    );
    if (!mounted) return;
    setState(() => _isSendingReply = false);

    final code = res['statusCode'] is int ? res['statusCode'] as int : null;
    if (res['success'] != true) {
      // The typed text stays in the field. A reply this screen cannot confirm is a reply the
      // partner has still not sent, and clearing what they wrote would make them type it again
      // to find out whether it had already landed.
      final serverError = res['error'] is String ? (res['error'] as String).trim() : '';
      String message;
      if (code == 401) {
        message = 'Your session with NABIN has closed. Sign in again to reply.';
      } else if (code == 404) {
        // The route answers 404 for a ticket it will not name, so this cannot say whose it is.
        message = 'NABIN has no ticket for you with that reference. Your message was not added.';
      } else if (code == null) {
        // No status at all means no answer came back. Whether the message appended is not
        // knowable from here, so the instruction is to look, not to send it a second time.
        message = 'No answer from NABIN. Your reply may or may not have been delivered — refresh '
            'the thread before sending it again.';
      } else if (serverError.isNotEmpty) {
        message = 'NABIN refused the reply: $serverError';
      } else {
        message = 'NABIN refused the reply (HTTP $code). Nothing was added to the thread.';
      }
      setState(() => _replyFailure = message);
      return;
    }

    // The thread is rebuilt from the ticket the platform returned after the write, so the
    // message on screen is the one in the row — sender attribution and timestamp included.
    final updated = DriverTicket.fromJson(res['ticket']);
    if (updated != null) {
      setState(() => _ticket = updated);
      _replyController.clear();
      _scrollToBottom();
      return;
    }
    // Confirmed but without a usable row: re-read rather than assume what the thread now holds.
    await _load(silent: true);
    _replyController.clear();
  }

  void _scrollToBottom() {
    if (!_scrollController.hasClients) return;
    final max = _scrollController.position.maxScrollExtent;
    _scrollController.animateTo(max, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DriverTheme.bgLight,
      appBar: AppBar(
        title: const Text('Support Ticket'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/support'),
        ),
        actions: [
          IconButton(
            onPressed: _state == _TicketState.loading ? null : () => _load(),
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh thread',
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: switch (_state) {
                _TicketState.loading => const Center(child: CircularProgressIndicator()),
                _TicketState.failed => _buildFailed(),
                _TicketState.missing => _buildMissing(),
                _TicketState.ready => _buildThread(),
              },
            ),
            if (_state == _TicketState.ready) _buildComposer(),
          ],
        ),
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
            const Text('Could not load this ticket',
                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: DriverTheme.textDark)),
            const SizedBox(height: 6),
            Text(_failureMessage ?? 'Nothing about this ticket has changed.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: DriverTheme.textMuted, fontSize: 13)),
            const SizedBox(height: 18),
            ElevatedButton.icon(
              key: const ValueKey('driver-support-ticket-retry'),
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

  Widget _buildMissing() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.search_off_rounded, size: 50, color: DriverTheme.textMuted),
            const SizedBox(height: 14),
            const Text('That ticket is not in your list',
                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: DriverTheme.textDark)),
            const SizedBox(height: 6),
            Text(
              'NABIN answered this read, and none of the tickets it sent belong to your account '
              'with the reference ${widget.ticketRef}.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: DriverTheme.textMuted, fontSize: 13, height: 1.4),
            ),
            const SizedBox(height: 18),
            ElevatedButton.icon(
              key: const ValueKey('driver-support-ticket-back-to-list'),
              onPressed: () => context.go('/support'),
              icon: const Icon(Icons.list_rounded),
              label: const Text('My tickets'),
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

  Widget _buildThread() {
    final ticket = _ticket;
    if (ticket == null) return const SizedBox.shrink();
    return RefreshIndicator(
      onRefresh: () => _load(silent: true),
      child: ListView(
        key: const ValueKey('driver-support-thread'),
        controller: _scrollController,
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
        children: [
          _buildHeader(ticket),
          if (_failureMessage != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(_failureMessage!,
                  style: const TextStyle(fontSize: 12, color: DriverTheme.roadGold)),
            ),
          const SizedBox(height: 18),
          const Text('Thread',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
          const SizedBox(height: 10),
          if (ticket.messages.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text('NABIN sent this ticket with no messages on it.',
                  style: TextStyle(fontSize: 13, color: DriverTheme.textMuted)),
            )
          else
            ...ticket.messages.map(_buildBubble),
          if (ticket.resolutionNotes.trim().isNotEmpty) _buildResolution(ticket),
          const SizedBox(height: 8),
        ],
      ),
    );
  }

  Widget _buildHeader(DriverTicket ticket) {
    return DriverCard(
      key: const ValueKey('driver-support-ticket-header'),
      backgroundColor: Colors.white,
      borderColor: DriverTheme.borderLight,
      padding: const EdgeInsets.all(16),
      borderRadius: 22,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  ticket.label,
                  style: const TextStyle(
                      fontWeight: FontWeight.w900, fontSize: 16, color: DriverTheme.textDark),
                ),
              ),
              const SizedBox(width: 10),
              DriverTicketStatusChip(status: ticket.status),
            ],
          ),
          const SizedBox(height: 8),
          // Every line below is a value the platform sent, or a statement that it sent nothing.
          _metaLine(Icons.confirmation_number_outlined,
              ticket.ticketNumber ?? 'No ticket number on this row'),
          _metaLine(Icons.label_outline_rounded,
              (ticket.category == null || ticket.category!.isEmpty)
                  ? 'Category not recorded'
                  : 'Category: ${ticket.category}'),
          _metaLine(Icons.schedule_rounded, ticket.when),
        ],
      ),
    );
  }

  Widget _metaLine(IconData icon, String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 15, color: DriverTheme.textMuted),
          const SizedBox(width: 8),
          Expanded(
            child: Text(text, style: const TextStyle(fontSize: 12.5, color: DriverTheme.textMuted)),
          ),
        ],
      ),
    );
  }

  Widget _buildBubble(DriverTicketMessage message) {
    final fromDriver = message.isFromThisDriver;
    final color = fromDriver ? DriverTheme.primaryBlue : DriverTheme.bgLight;
    final ink = fromDriver ? Colors.white : DriverTheme.textDark;
    return Align(
      alignment: fromDriver ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 300),
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: DriverTheme.borderLight),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              message.from,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w900,
                color: fromDriver ? Colors.white.withValues(alpha: 0.85) : DriverTheme.textMuted,
              ),
            ),
            const SizedBox(height: 5),
            Text(
              message.readable
                  ? message.text
                  : 'NABIN sent this entry in the thread without any text this app could read.',
              style: TextStyle(
                fontSize: 13.5,
                color: ink,
                height: 1.4,
                fontWeight: message.readable ? FontWeight.normal : FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              message.when,
              style: TextStyle(
                fontSize: 11,
                color: fromDriver ? Colors.white.withValues(alpha: 0.8) : DriverTheme.textMuted,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// `resolutionNotes` is a column the platform writes when it resolves a ticket, so it is
  /// labelled as NABIN's words and not as the partner's.
  Widget _buildResolution(DriverTicket ticket) {
    return Container(
      key: const ValueKey('driver-support-resolution'),
      margin: const EdgeInsets.only(top: 6),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: DriverTheme.onlineGreen.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: DriverTheme.onlineGreen.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Resolution notes from NABIN',
              style: TextStyle(
                  fontSize: 12, fontWeight: FontWeight.w900, color: DriverTheme.onlineGreenDark)),
          const SizedBox(height: 5),
          Text(ticket.resolutionNotes,
              style: const TextStyle(fontSize: 13, color: DriverTheme.textDark, height: 1.4)),
        ],
      ),
    );
  }

  Widget _buildComposer() {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 10, 20, 12),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: DriverTheme.borderLight)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_replyFailure != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                _replyFailure!,
                key: const ValueKey('driver-support-reply-failure'),
                style: const TextStyle(
                    fontSize: 12.5, color: DriverTheme.alertRed, fontWeight: FontWeight.w700),
              ),
            ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: TextField(
                  key: const ValueKey('driver-support-reply-field'),
                  controller: _replyController,
                  enabled: !_isSendingReply,
                  minLines: 1,
                  maxLines: 4,
                  maxLength: _replyLimit,
                  textCapitalization: TextCapitalization.sentences,
                  style: const TextStyle(color: DriverTheme.textDark, fontSize: 14),
                  decoration: InputDecoration(
                    hintText: 'Write a reply',
                    counterText: '',
                    filled: true,
                    fillColor: DriverTheme.bgLight,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(color: DriverTheme.borderLight),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: const BorderSide(color: DriverTheme.borderLight),
                    ),
                  ),
                  onSubmitted: (_) => _sendReply(),
                ),
              ),
              const SizedBox(width: 10),
              IconButton(
                key: const ValueKey('driver-support-send'),
                onPressed: _isSendingReply ? null : _sendReply,
                icon: _isSendingReply
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(
                            strokeWidth: 2.5, color: DriverTheme.primaryBlue),
                      )
                    : const Icon(Icons.send_rounded, color: DriverTheme.primaryBlue),
                tooltip: 'Send reply',
              ),
            ],
          ),
        ],
      ),
    );
  }
}
