/// The support-ticket shape the Driver screens read and write.
///
/// Field-for-field this is `mapRowToTicket` in `backend/src/repositories/SupportTicketRepository.js`
/// — the object `GET /api/support/user/:userId` puts in `tickets`, and the object
/// `POST /api/support/ticket` and `POST /api/support/ticket/:id/message` return as `ticket`.
/// Messages ride inside the ticket as the `support_tickets.messages` JSONB column (migration
/// 008_support_domain.sql:16); there is no message-by-id route and no per-message page, so a
/// thread is always read with its ticket.
///
/// Nothing here supplies a value the platform did not send. A field the row lacks renders as
/// its absence, because a ticket number, a status or a timestamp that NABIN did not return is
/// a fabrication with a widget drawn around it.
library;

/// One entry in a ticket's `messages` array.
///
/// The backend builds this server-side: `senderRole`, `senderName` and `senderId` come from the
/// authenticated caller, not from the request body. A live probe (2026-10-08) posted
/// `senderRole: 'ADMIN'` and `senderName: 'SPOOFED NAME'` as a driver and the stored message
/// carried the driver's own role and name.
class DriverTicketMessage {
  const DriverTicketMessage({
    required this.text,
    required this.readable,
    required this.senderName,
    required this.senderRole,
    required this.senderId,
    required this.at,
  });

  final String text;

  /// False when the entry arrived without readable text. The thread then says so rather than
  /// painting an empty bubble, and rather than dropping the entry and quietly shortening the
  /// conversation.
  final bool readable;
  final String? senderName;
  final String? senderRole;
  final String? senderId;
  final DateTime? at;

  /// True for a message this partner wrote. `senderRole` is the platform's own attribution of
  /// the session that sent it, so it is the only honest way to tell the two sides apart here:
  /// nothing in this app decides who an agent is called.
  bool get isFromThisDriver => (senderRole ?? '').toUpperCase() == 'DRIVER';

  /// The sender as the platform recorded it. `senderName` and `senderRole` are set server-side
  /// from the authenticated session, so an answer that carries neither is an answer that did
  /// not say who wrote it, and the thread says so instead of naming an agent itself.
  String get from {
    final name = senderName?.trim();
    final role = senderRole?.trim();
    if (name != null && name.isNotEmpty && role != null && role.isNotEmpty) return '$name · $role';
    if (name != null && name.isNotEmpty) return name;
    if (role != null && role.isNotEmpty) return role;
    return 'Sender not recorded';
  }

  /// The message's own timestamp. There is no substitute for it: a time the platform did not
  /// send is a time this screen would be inventing.
  String get when {
    final at = this.at;
    if (at == null) return 'No timestamp on this message';
    String two(int v) => v.toString().padLeft(2, '0');
    return '${at.day}/${at.month}/${at.year} ${two(at.hour)}:${two(at.minute)}';
  }

  static DriverTicketMessage fromJson(Object? json) {
    if (json is! Map) {
      return const DriverTicketMessage(
        text: '',
        readable: false,
        senderName: null,
        senderRole: null,
        senderId: null,
        at: null,
      );
    }
    final text = (json['text'] as String?)?.trim() ?? '';
    return DriverTicketMessage(
      text: text,
      readable: text.isNotEmpty,
      senderName: json['senderName'] as String?,
      senderRole: json['senderRole'] as String?,
      senderId: json['senderId']?.toString(),
      at: DateTime.tryParse('${json['timestamp']}')?.toLocal(),
    );
  }
}

/// A support ticket as the platform returned it.
class DriverTicket {
  const DriverTicket({
    required this.ref,
    required this.ticketNumber,
    required this.uuid,
    required this.title,
    required this.description,
    required this.status,
    required this.category,
    required this.priority,
    required this.messages,
    required this.resolutionNotes,
    required this.createdAt,
    required this.updatedAt,
    required this.resolvedAt,
  });

  /// The value `POST /api/support/ticket/:id/message` accepts. `mapRowToTicket` sets `id` to
  /// `ticket_number || id`, and the reply route resolves either that or the row uuid.
  final String ref;
  final String? ticketNumber;
  final String? uuid;
  final String title;
  final String description;

  /// The status exactly as the platform sent it. The column CHECK allows `OPEN`,
  /// `IN_PROGRESS`, `RESOLVED` and `CLOSED`, and a driver reply never moves it — only an
  /// administrator does. An unexpected value is displayed rather than mapped onto a guess.
  final String status;
  final String? category;
  final String? priority;
  final List<DriverTicketMessage> messages;

  /// Written by the platform when it resolves the ticket. Empty until it does.
  final String resolutionNotes;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final DateTime? resolvedAt;

  /// Null when the answer carries no handle at all — such a row could not be opened or
  /// replied to, so it is not shown.
  static DriverTicket? fromJson(Object? json) {
    if (json is! Map) return null;
    final number = json['ticketNumber']?.toString();
    final uuid = json['uuid']?.toString();
    final id = json['id']?.toString();
    final ref = <String?>[id, number, uuid].firstWhere(
      (v) => v != null && v.isNotEmpty,
      orElse: () => null,
    );
    if (ref == null) return null;
    return DriverTicket(
      ref: ref,
      ticketNumber: (number == null || number.isEmpty) ? null : number,
      uuid: (uuid == null || uuid.isEmpty) ? null : uuid,
      title: (json['title'] ?? json['subject'] ?? '').toString(),
      description: (json['description'] ?? '').toString(),
      status: (json['status'] ?? '').toString(),
      category: json['category']?.toString(),
      priority: json['priority']?.toString(),
      messages: (json['messages'] is List)
          ? (json['messages'] as List).map(DriverTicketMessage.fromJson).toList(growable: false)
          : const <DriverTicketMessage>[],
      resolutionNotes: (json['resolutionNotes'] ?? '').toString(),
      createdAt: DateTime.tryParse('${json['createdAt']}')?.toLocal(),
      updatedAt: DateTime.tryParse('${json['updatedAt']}')?.toLocal(),
      resolvedAt: DateTime.tryParse('${json['resolvedAt']}')?.toLocal(),
    );
  }

  /// True when this row is the one a route asked for, by either spelling of its handle.
  bool matches(String otherRef) =>
      ref == otherRef ||
      (ticketNumber != null && ticketNumber == otherRef) ||
      (uuid != null && uuid == otherRef);

  String get label => (title.trim().isNotEmpty)
      ? title
      : (ticketNumber ?? 'Ticket ${ref.substring(0, ref.length > 8 ? 8 : ref.length)}');

  /// The relative label for `createdAt`, in the same shape the Driver notification feed uses.
  /// A row with no timestamp says so rather than borrowing the moment it was opened.
  String get when {
    final at = createdAt;
    if (at == null) return 'Date not recorded';
    final diff = DateTime.now().difference(at);
    if (diff.inSeconds < 60) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${at.day}/${at.month}/${at.year}';
  }
}
