import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/network/nabin_api_service.dart';

class CustomerSupportScreen extends StatefulWidget {
  const CustomerSupportScreen({super.key});

  @override
  State<CustomerSupportScreen> createState() => _CustomerSupportScreenState();
}

class _CustomerSupportScreenState extends State<CustomerSupportScreen> {
  final TextEditingController _subjectController = TextEditingController();
  final TextEditingController _messageController = TextEditingController();
  String _selectedCategory = 'RIDE_DISPUTE';
  bool _isSubmitting = false;
  List<Map<String, dynamic>> _tickets = [];
  bool _isLoadingTickets = true;

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

  Future<void> _loadTickets() async {
    setState(() => _isLoadingTickets = true);
    try {
      await Future.delayed(const Duration(milliseconds: 400));
      setState(() {
        _tickets = [
          {
            'id': 'TKT-9821',
            'category': 'RIDE_DISPUTE',
            'subject': 'Fare calculation adjustment',
            'status': 'RESOLVED',
            'date': 'Yesterday, 4:30 PM',
            'resolution': '₹45 credit added to wallet',
          },
        ];
        _isLoadingTickets = false;
      });
    } catch (_) {
      if (mounted) setState(() => _isLoadingTickets = false);
    }
  }

  Future<void> _submitTicket() async {
    if (_subjectController.text.trim().isEmpty || _messageController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please provide both subject and description.')),
      );
      return;
    }

    setState(() => _isSubmitting = true);
    try {
      final res = await NabinApiService.submitSupportTicket(
        category: _selectedCategory,
        userId: 'usr_2',
        title: _subjectController.text.trim(),
        description: _messageController.text.trim(),
      );

      if (mounted) {
        setState(() {
          _isSubmitting = false;
          _tickets.insert(0, {
            'id': res?['ticket']?['id'] ?? 'TKT-${DateTime.now().millisecondsSinceEpoch % 10000}',
            'category': _selectedCategory,
            'subject': _subjectController.text.trim(),
            'status': 'OPEN',
            'date': 'Just now',
          });
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
    } catch (e) {
      if (mounted) {
        setState(() => _isSubmitting = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to submit ticket: $e'), backgroundColor: AppTheme.error),
        );
      }
    }
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

            if (_isLoadingTickets)
              const Center(child: Padding(padding: EdgeInsets.all(20), child: CircularProgressIndicator()))
            else if (_tickets.isEmpty)
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: AppTheme.outlineVariant)),
                child: const Center(
                  child: Text('No support tickets raised yet.', style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 13)),
                ),
              )
            else
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: _tickets.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (context, idx) {
                  final t = _tickets[idx];
                  final isResolved = t['status'] == 'RESOLVED';
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
                            Text(t['id'] ?? '', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: AppTheme.primary)),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(
                                color: isResolved ? const Color(0xFFDCFCE7) : const Color(0xFFFEF3C7),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                t['status'] ?? 'OPEN',
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w900,
                                  color: isResolved ? const Color(0xFF15803D) : const Color(0xFFB45309),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Text(t['subject'] ?? '', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: AppTheme.onSurface)),
                        const SizedBox(height: 4),
                        Text(t['date'] ?? '', style: const TextStyle(fontSize: 11, color: AppTheme.onSurfaceVariant)),
                        if (t['resolution'] != null) ...[
                          const SizedBox(height: 8),
                          Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(color: const Color(0xFFF8FAFC), borderRadius: BorderRadius.circular(8)),
                            child: Row(
                              children: [
                                const Icon(Icons.check_circle_outline, size: 14, color: AppTheme.success),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: Text('Resolution: ${t['resolution']}', style: const TextStyle(fontSize: 11.5, color: Color(0xFF334155), fontWeight: FontWeight.w600)),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ],
                    ),
                  );
                },
              ),
          ],
        ),
      ),
    );
  }
}
