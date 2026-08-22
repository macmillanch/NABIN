import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';

class ParcelBookingScreen extends StatefulWidget {
  const ParcelBookingScreen({super.key});

  @override
  State<ParcelBookingScreen> createState() => _ParcelBookingScreenState();
}

class _ParcelBookingScreenState extends State<ParcelBookingScreen> {
  int _weightTier = 0; // 0: Up to 5kg, 1: 5-10kg, 2: 10-20kg

  final List<Map<String, dynamic>> _tiers = [
    {
      'title': 'Small (Up to 5kg)',
      'desc': 'Documents, electronics, keys, medicines',
      'fare': '₹40',
      'icon': Icons.mail_outline_rounded,
    },
    {
      'title': 'Medium (5 - 10kg)',
      'desc': 'Apparel, shoe boxes, food parcels',
      'fare': '₹65',
      'icon': Icons.inventory_2_outlined,
    },
    {
      'title': 'Heavy (10 - 20kg)',
      'desc': 'Bulk cargo, cartons, office goods',
      'fare': '₹110',
      'icon': Icons.local_shipping_outlined,
    },
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Text('Send Instant Parcel'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: AppTheme.onSurface, size: 20),
          onPressed: () => context.pop(),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Dual-OTP Security Banner
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFFE8F5E9), Color(0xFFF1F8E9)],
                  ),
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: const Color(0xFFA5D6A7)),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.verified_user_rounded, color: Color(0xFF2E7D32), size: 28),
                    SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Dual-OTP Guaranteed Delivery', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: Color(0xFF1B5E20))),
                          SizedBox(height: 2),
                          Text('Sender & Recipient OTPs ensure 100% loss-free courier handover.', style: TextStyle(color: Color(0xFF2E7D32), fontSize: 11)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),

              // Connected Sender & Receiver Timeline Card
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceContainerLowest,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: AppTheme.outlineVariant.withValues(alpha: 0.6)),
                  boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 6, offset: Offset(0, 2))],
                ),
                child: Column(
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.radio_button_checked, color: Color(0xFF00C853), size: 18),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('PICKUP FROM (SENDER)', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: AppTheme.onSurfaceVariant, letterSpacing: 0.8)),
                              const SizedBox(height: 4),
                              TextFormField(
                                initialValue: 'Flat 402, Kamla Nagar, Delhi (Rahul • 9876543210)',
                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.onSurface),
                                decoration: const InputDecoration(border: InputBorder.none, isDense: true, contentPadding: EdgeInsets.zero),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const Padding(
                      padding: EdgeInsets.only(left: 8),
                      child: Row(
                        children: [
                          SizedBox(width: 1, height: 24, child: ColoredBox(color: AppTheme.outlineVariant)),
                        ],
                      ),
                    ),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.location_on_rounded, color: Color(0xFFFF3D00), size: 18),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('DELIVER TO (RECEIVER)', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: AppTheme.onSurfaceVariant, letterSpacing: 0.8)),
                              const SizedBox(height: 4),
                              TextFormField(
                                initialValue: 'Plot 18, Block B, Connaught Place, New Delhi (Priya • 9811223344)',
                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.onSurface),
                                decoration: const InputDecoration(border: InputBorder.none, isDense: true, contentPadding: EdgeInsets.zero),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              const Text('Select Package Size & Weight', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: AppTheme.onSurface)),
              const SizedBox(height: 12),

              ...List.generate(_tiers.length, (idx) {
                final tier = _tiers[idx];
                final isSelected = _weightTier == idx;
                return GestureDetector(
                  onTap: () => setState(() => _weightTier = idx),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    margin: const EdgeInsets.only(bottom: 10),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: isSelected ? const Color(0xFF00897B).withValues(alpha: 0.08) : AppTheme.surfaceContainerLowest,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: isSelected ? const Color(0xFF00897B) : AppTheme.outlineVariant.withValues(alpha: 0.6),
                        width: isSelected ? 2 : 1,
                      ),
                      boxShadow: isSelected ? [BoxShadow(color: const Color(0xFF00897B).withValues(alpha: 0.2), blurRadius: 8)] : null,
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: isSelected ? const Color(0xFF00897B) : AppTheme.surfaceContainer,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Icon(tier['icon'] as IconData, color: isSelected ? Colors.white : AppTheme.onSurfaceVariant, size: 22),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(tier['title'] as String, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: AppTheme.onSurface)),
                              const SizedBox(height: 2),
                              Text(tier['desc'] as String, style: const TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 11)),
                            ],
                          ),
                        ),
                        Text(tier['fare'] as String, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: AppTheme.onSurface)),
                      ],
                    ),
                  ),
                );
              }),
              const SizedBox(height: 24),

              ElevatedButton(
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Courier Dispatch Broadcasted! Driver assigned with Dual-OTP.')),
                  );
                  context.pop();
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF00897B),
                  foregroundColor: Colors.white,
                  minimumSize: const Size(double.infinity, 56),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  elevation: 2,
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text('Book Courier Delivery • ${_tiers[_weightTier]['fare']}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                    const SizedBox(width: 8),
                    const Icon(Icons.arrow_forward_rounded, size: 18),
                  ],
                ),
              ),
              const SizedBox(height: 20),
            ],
          ),
        ),
      ),
    );
  }
}
