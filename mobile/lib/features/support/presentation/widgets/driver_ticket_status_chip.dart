import 'package:flutter/material.dart';
import '../../../../core/theme/driver_theme.dart';

/// The ticket's status, as NABIN sent it.
///
/// The word is the database value verbatim — `OPEN`, `IN_PROGRESS`, `RESOLVED`, `CLOSED` are the
/// four the `support_tickets.status` CHECK allows, and a ticket can also arrive carrying one the
/// column learned later. Only an administrator moves a ticket between them; a partner's reply
/// never does. So the label is never rewritten, never translated into "Pending" or "Escalated",
/// and never inferred from whether the thread has an answer in it.
///
/// The colour is this screen's own presentation of a value it was given, which is why an
/// unrecognised status falls back to the neutral grey rather than to the colour of the nearest
/// known one.
class DriverTicketStatusChip extends StatelessWidget {
  const DriverTicketStatusChip({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final known = switch (status) {
      'RESOLVED' => DriverTheme.onlineGreen,
      'IN_PROGRESS' => DriverTheme.primaryBlue,
      'CLOSED' => DriverTheme.textMuted,
      'OPEN' => DriverTheme.roadGold,
      _ => null,
    };
    final color = known ?? DriverTheme.textMuted;
    return Container(
      key: ValueKey('driver-support-status-$status'),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.4), width: 1),
      ),
      child: Text(
        status.isEmpty ? 'STATUS NOT SENT' : status,
        style: TextStyle(color: color, fontWeight: FontWeight.w900, fontSize: 11),
      ),
    );
  }
}
