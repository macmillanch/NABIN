import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/theme/driver_theme.dart';
import '../../../../core/widgets/driver_button.dart';
import '../../../../core/widgets/driver_card.dart';
import '../models/driver_ticket.dart';

/// Raises one support ticket, through the one route that creates them.
///
/// Write contract, read from `backend/src/server.js:2004` and
/// `SupportTicketRepository.createTicket` and then probed with a live DRIVER session on
/// 2026-10-08. The fields the endpoint actually reads are `title` (it also accepts `subject`),
/// `description`, `category`, `priority`, `evidenceUrls`, `jobId`, and `driverId` /
/// `driverName` / `merchantId`, the last three landing only in the metadata of the first message.
/// Its validation is thin and specific: an empty `title` is 400 "Missing required field: title",
/// an empty `description` is 400 "Missing required field: description", `category` is uppercased
/// with no allowlist, an unknown `priority` is silently rewritten to `NORMAL`, and the status is
/// `OPEN` whatever the caller asks for.
///
/// Three consequences shape this form:
/// - **No identity in the body.** `userId` is read by nobody on this route — a probe sent another
///   driver's id and the stored owner was still the token's own driver. Sending it would imply a
///   control that does not exist, so it is not sent.
/// - **No priority control.** §16 of the brief is right for the wrong reason: the backend accepts
///   `CRITICAL`, but nothing in the repository treats a ticket differently because of it. A
///   selector here would promise that naming a ticket urgent moves it up a queue, and no code
///   was found that does that.
/// - **A subject that fits the column.** `support_tickets.subject` is `varchar(200)`
///   (migration 003_extended_schema.sql:52) and the backend does not trim it first, so a 212-character
///   title answers 400 with a raw PostgreSQL type error. The cap belongs to the column, not to
///   this screen's taste, so the field stops at 200 and the counter is the reason.
class DriverSupportNewTicketScreen extends StatefulWidget {
  const DriverSupportNewTicketScreen({super.key});

  @override
  State<DriverSupportNewTicketScreen> createState() => _DriverSupportNewTicketScreenState();
}

class _DriverSupportNewTicketScreenState extends State<DriverSupportNewTicketScreen> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _titleController = TextEditingController();
  final TextEditingController _descriptionController = TextEditingController();

  /// Every value here is one the repository already branches on or already stores:
  /// `DRIVER_SUPPORT` is what this app's own helpdesk entry sent before this screen existed,
  /// `GENERAL` is the column default, and `LOST_ITEM` / `SAFETY_INCIDENT` are the two categories
  /// `resolveTicket` carries driver-specific handling for. Nothing is invented to fill a menu.
  static const List<Map<String, String>> _categories = [
    {'id': 'DRIVER_SUPPORT', 'label': 'Partner support'},
    {'id': 'GENERAL', 'label': 'General question'},
    {'id': 'LOST_ITEM', 'label': 'Lost item'},
    {'id': 'SAFETY_INCIDENT', 'label': 'Safety incident report'},
  ];

  String _category = 'DRIVER_SUPPORT';
  bool _isCreating = false;
  String? _failure;

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    // One write in flight. A second deliberate tap while the first is unanswered would be a
    // second ticket, and this route has no idempotency key to collapse it.
    if (_isCreating) return;
    if (_formKey.currentState?.validate() != true) return;

    final title = _titleController.text.trim();
    final description = _descriptionController.text.trim();
    setState(() {
      _isCreating = true;
      _failure = null;
    });

    final res = await NabinApiService.submitSupportTicket(
      category: _category,
      title: title,
      description: description,
    );
    if (!mounted) return;
    setState(() => _isCreating = false);

    if (res == null) {
      // The request went out and no answer came back. Whether the row exists is not knowable
      // from here, so the honest instruction is to look, not to send again.
      setState(() {
        _failure = 'NABIN did not answer. Your ticket may already exist, so do not send it '
            'again — go back to your tickets and refresh the list to see whether it is there.';
      });
      return;
    }

    final ticket = DriverTicket.fromJson(res['ticket']);
    if (res['success'] == true && ticket != null) {
      // The thread opens on the row the platform just returned: its own reference, its own
      // status, its own first message. Nothing about it is reconstructed here.
      context.pushReplacement('/support/ticket/${Uri.encodeComponent(ticket.ref)}');
      return;
    }

    final code = res['statusCode'] is int ? res['statusCode'] as int : null;
    final serverError = res['error'] is String ? (res['error'] as String).trim() : '';
    setState(() {
      if (code == 401) {
        _failure = 'Your session with NABIN has closed. Sign in again before raising a ticket.';
      } else if (code == 403) {
        _failure = 'NABIN refused this ticket. Nothing was created.';
      } else if (code != null && code >= 500) {
        _failure = 'NABIN could not complete the request (HTTP $code). Open your tickets and '
            'refresh the list before sending this one again.';
      } else if (serverError.isNotEmpty) {
        // A 400 from this route is a validation refusal, which happens before the row is
        // written, so "nothing was created" is a fact here rather than an assumption.
        _failure = 'NABIN refused this ticket: $serverError. Nothing was created.';
      } else {
        _failure = 'NABIN refused this ticket. Nothing was created.';
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DriverTheme.bgLight,
      appBar: AppBar(
        title: const Text('New Support Ticket'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            if (context.canPop()) {
              context.pop();
            } else {
              context.go('/support');
            }
          },
        ),
      ),
      body: SafeArea(
        child: Form(
          key: _formKey,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
            children: [
              const Text(
                'A ticket is a written thread with the NABIN partner helpdesk. It does not call '
                'anyone, and NABIN has not told this app how quickly a ticket gets an answer, so '
                'no estimate is shown here.',
                style: TextStyle(fontSize: 13, color: DriverTheme.textMuted, height: 1.4),
              ),
              const SizedBox(height: 20),

              const Text('What is this about?',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
              const SizedBox(height: 8),
              DriverCard(
                backgroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    key: const ValueKey('driver-support-category'),
                    isExpanded: true,
                    value: _category,
                    items: _categories
                        .map((c) => DropdownMenuItem<String>(
                              value: c['id'],
                              child: Text(c['label']!,
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w700, fontSize: 14, color: DriverTheme.textDark)),
                            ))
                        .toList(),
                    onChanged: _isCreating
                        ? null
                        : (val) => setState(() => _category = val ?? _category),
                  ),
                ),
              ),
              const SizedBox(height: 20),

              const Text('Subject',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
              const SizedBox(height: 8),
              DriverCard(
                backgroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: TextFormField(
                  key: const ValueKey('driver-support-title'),
                  controller: _titleController,
                  maxLength: 200,
                  enabled: !_isCreating,
                  textCapitalization: TextCapitalization.sentences,
                  style: const TextStyle(fontWeight: FontWeight.bold, color: DriverTheme.textDark),
                  decoration: const InputDecoration(
                    hintText: 'One line that names the problem',
                    counterText: '',
                    border: InputBorder.none,
                  ),
                  validator: (value) =>
                      (value ?? '').trim().isEmpty ? 'NABIN requires a subject. Enter one.' : null,
                ),
              ),
              const SizedBox(height: 20),

              const Text('Description',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
              const SizedBox(height: 8),
              DriverCard(
                backgroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: TextFormField(
                  key: const ValueKey('driver-support-description'),
                  controller: _descriptionController,
                  maxLines: 6,
                  minLines: 3,
                  maxLength: 4000,
                  enabled: !_isCreating,
                  textCapitalization: TextCapitalization.sentences,
                  style: const TextStyle(color: DriverTheme.textDark, height: 1.4),
                  decoration: const InputDecoration(
                    hintText: 'What happened, and what you need from NABIN',
                    counterText: '',
                    border: InputBorder.none,
                  ),
                  validator: (value) =>
                      (value ?? '').trim().isEmpty ? 'NABIN requires a description. Enter one.' : null,
                ),
              ),
              const SizedBox(height: 8),
              const Text('4,000 characters is the length the ticket thread itself refuses beyond.',
                  style: TextStyle(fontSize: 11.5, color: DriverTheme.textMuted)),
              const SizedBox(height: 20),

              if (_failure != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Container(
                    key: const ValueKey('driver-support-create-failure'),
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
                          child: Text(_failure!,
                              style: const TextStyle(
                                  fontSize: 13, color: DriverTheme.alertRed, fontWeight: FontWeight.w700, height: 1.35)),
                        ),
                      ],
                    ),
                  ),
                ),

              DriverButton(
                key: const ValueKey('driver-support-submit'),
                text: _isCreating ? 'Sending…' : 'Send ticket',
                icon: Icons.send_rounded,
                isLoading: _isCreating,
                onPressed: _submit,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
