import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/network/session_manager.dart';

class CustomerSupportScreen extends StatefulWidget {
  const CustomerSupportScreen({super.key});

  @override
  State<CustomerSupportScreen> createState() => _CustomerSupportScreenState();
}

enum _TicketsState { loading, ready, empty, error }

class _CustomerSupportScreenState extends State<CustomerSupportScreen> {
  final TextEditingController _subjectController = TextEditingController();
  final TextEditingController _messageController = TextEditingController();
  String _selectedCategory = 'RIDE_DISPUTE';
  bool _isSubmitting = false;

  List<Map<String, dynamic>> _tickets = [];
  _TicketsState _state = _TicketsState.loading;

  final List<Map<String, String>> _categories = [
    {'id': 'RIDE_DISPUTE', 'label': 'Ride Issue / Dispute', 'icon': '🚖'},
    {'id': 'FOOD_ORDER', 'label': 'Food & Dining Issue', 'icon': '🍽️'},
    {'id': 'GROCERY_ORDER', 'label': '10-Min Grocery Issue', 'icon': '🛒'},
    {'id': 'PARCEL_DELIVERY', 'label': 'Parcel Courier Issue', 'icon': '📦'},
    {'id': 'LOST_ITEM', 'label': 'Lost Item in Vehicle', 'icon': '🔍'},
    {'id': 'PAYMENT_REFUND', 'label': 'Payment / Refund Query', 'icon': '💳'},
    {'id': 'SAFETY_INCIDENT', 'label': 'Safety & Emergency Support', 'icon': '🚨'},
  ];

  @override
  void initState() {
    super.initState();
    _loadTickets();
  }

  String? get _currentUserId =>
      SessionManager.instance.currentUser?['id']?.toString();

  Future<void> _loadTickets() async {
    final userId = _currentUserId;
    if (userId == null) {
      // No signed-in identity means no tickets we are allowed to read — show an
      // honest empty state rather than fabricating rows or calling the endpoint.
      setState(() {
        _tickets = [];
        _state = _TicketsState.empty;
      });
      return;
    }

    setState(() => _state = _TicketsState.loading);
    final res = await NabinApiService.getSupportTickets(userId: userId);
    if (!mounted) return;

    if (res['success'] != true) {
      setState(() => _state = _TicketsState.error);
      return;
    }

    final list = (res['tickets'] as List? ?? const [])
        .whereType<Map<dynamic, dynamic>>()
        .map((t) => t.cast<String, dynamic>())
        .toList();
    setState(() {
      _tickets = list;
      _state = list.isEmpty ? _TicketsState.empty : _TicketsState.ready;
    });
  }

  Future<void> _submitTicket() async {
    if (_subjectController.text.trim().isEmpty ||
        _messageController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please provide both subject and description.')),
      );
      return;
    }

    setState(() => _isSubmitting = true);
    // Identity is derived server-side from the bearer token; we no longer send a
    // body userId the backend ignores.
    final res = await NabinApiService.submitSupportTicket(
      category: _selectedCategory,
      userId: _currentUserId ?? '',
      title: _subjectController.text.trim(),
      description: _messageController.text.trim(),
    );
    if (!mounted) return;

    setState(() => _isSubmitting = false);

    final ticket = res?['ticket'];
    final ok = res?['success'] == true && ticket is Map;

    if (!ok) {
      final msg = (res?['error'] as String?) ?? 'Could not submit your ticket. Please try again.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(msg), backgroundColor: AppTheme.error),
      );
      return;
    }

    setState(() {
      _tickets.insert(0, Map<String, dynamic>.from(ticket));
      if (_state == _TicketsState.empty) _state = _TicketsState.ready;
      _subjectController.clear();
      _messageController.clear();
    });

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Support ticket raised successfully. Our team is reviewing it.'),
        backgroundColor: AppTheme.success,
      ),
    );
  }

  String _formatDate(String? iso) {
    if (iso == null || iso.isEmpty) return '';
    final dt = DateTime.tryParse(iso);
    if (dt == null) return '';
    return DateFormat('d MMM y').format(dt.toLocal());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, color: AppTheme.onSurface, size: 20),
          onPressed: () => context.pop(),
        ),
        title: const Text(
          '24/7 NABIN Support',
          style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: AppTheme.onSurface),
        ),
        centerTitle: true,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Emergency SOS Banner
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFFFEF2F2),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFFCA5A5)),
              ),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: const BoxDecoration(color: Color(0xFFDC2626), shape: BoxShape.circle),
                    child: const Icon(Icons.sos_rounded, color: Colors.white, size: 24),
                  ),
                  const SizedBox(width: 14),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Emergency Assistance', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: Color(0xFF991B1B))),
                        SizedBox(height: 2),
                        Text('Instant 24/7 priority safety helpline for active rides & deliveries.', style: TextStyle(fontSize: 11.5, color: Color(0xFFB91C1C))),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 24),

            // Create Ticket Header
            const Text('Raise a Support Ticket', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppTheme.onSurface)),
            const SizedBox(height: 12),

            // Category Selector
            const Text('Issue Category', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppTheme.onSurfaceVariant)),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppTheme.outlineVariant),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  isExpanded: true,
                  value: _selectedCategory,
                  items: _categories.map((c) {
                    return DropdownMenuItem<String>(
                      value: c['id'],
                      child: Text('${c['icon']} ${c['label']}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                    );
                  }).toList(),
                  onChanged: (val) => setState(() => _selectedCategory = val ?? _selectedCategory),
                ),
              ),
            ),

            const SizedBox(height: 16),

            // Subject
            const Text('Subject', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppTheme.onSurfaceVariant)),
            const SizedBox(height: 8),
            TextField(
              controller: _subjectController,
              decoration: InputDecoration(
                hintText: 'Brief summary of the issue...',
                hintStyle: const TextStyle(fontSize: 13.5, color: AppTheme.onSurfaceVariant),
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppTheme.outlineVariant)),
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              ),
            ),

            const SizedBox(height: 16),

            // Description
            const Text('Description', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppTheme.onSurfaceVariant)),
            const SizedBox(height: 8),
            TextField(
              controller: _messageController,
              maxLines: 3,
              decoration: InputDecoration(
                hintText: 'Detailed information regarding the incident or booking...',
                hintStyle: const TextStyle(fontSize: 13.5, color: AppTheme.onSurfaceVariant),
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppTheme.outlineVariant)),
                contentPadding: const EdgeInsets.all(14),
              ),
            ),

            const SizedBox(height: 18),

            // Submit Button
            ElevatedButton(
              onPressed: _isSubmitting ? null : _submitTicket,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primary,
                foregroundColor: Colors.white,
                minimumSize: const Size(double.infinity, 50),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                elevation: 0,
              ),
              child: _isSubmitting
                  ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
                  : const Text('Submit Ticket', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
            ),

            const SizedBox(height: 32),

            // Previous Tickets Section
            const Text('Your Tickets & History', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppTheme.onSurface)),
            const SizedBox(height: 12),

            _buildTicketsSection(),
          ],
        ),
      ),
    );
  }

  Widget _buildTicketsSection() {
    switch (_state) {
      case _TicketsState.loading:
        return const Center(
          child: Padding(padding: EdgeInsets.all(20), child: CircularProgressIndicator()),
        );
      case _TicketsState.error:
        return Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppTheme.outlineVariant),
          ),
          child: Column(
            children: [
              const Icon(Icons.cloud_off_rounded, color: AppTheme.error, size: 30),
              const SizedBox(height: 10),
              const Text(
                "Couldn't load your tickets.",
                style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 13, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 12),
              TextButton.icon(
                onPressed: _loadTickets,
                icon: const Icon(Icons.refresh_rounded, size: 18),
                label: const Text('Retry'),
              ),
            ],
          ),
        );
      case _TicketsState.empty:
        return Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppTheme.outlineVariant),
          ),
          child: const Center(
            child: Text('No support tickets raised yet.', style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 13)),
          ),
        );
      case _TicketsState.ready:
        return ListView.separated(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: _tickets.length,
          separatorBuilder: (_, __) => const SizedBox(height: 10),
          itemBuilder: (context, idx) => _buildTicketCard(_tickets[idx]),
        );
    }
  }

  Widget _buildTicketCard(Map<String, dynamic> t) {
    final status = (t['status'] ?? 'OPEN').toString();
    final isResolved = status == 'RESOLVED';
    final id = (t['id'] ?? t['ticketNumber'] ?? '').toString();
    final subject = (t['subject'] ?? t['title'] ?? '').toString();
    final dateLabel = _formatDate(t['createdAt']?.toString());
    final resolution = (t['resolutionNotes'] ?? '').toString();

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Flexible(child: Text(id, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: AppTheme.primary))),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: isResolved ? const Color(0xFFDCFCE7) : const Color(0xFFFEF3C7),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  status,
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w900,
                    color: isResolved ? const Color(0xFF15803D) : const Color(0xFFB45309),
                  ),
                ),
              ),
            ],
          ),
          if (subject.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(subject, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: AppTheme.onSurface)),
          ],
          if (dateLabel.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(dateLabel, style: const TextStyle(fontSize: 11, color: AppTheme.onSurfaceVariant)),
          ],
          if (isResolved && resolution.isNotEmpty) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: const Color(0xFFF8FAFC), borderRadius: BorderRadius.circular(8)),
              child: Row(
                children: [
                  const Icon(Icons.check_circle_outline, size: 14, color: AppTheme.success),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text('Resolution: $resolution', style: const TextStyle(fontSize: 11.5, color: Color(0xFF334155), fontWeight: FontWeight.w600)),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
