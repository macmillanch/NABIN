import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/models/school_model.dart';
import '../../../../core/models/child_model.dart';
import '../../../../core/models/school_child_repository.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Text('Profile & Settings'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: AppTheme.onSurface, size: 20),
          onPressed: () => context.canPop() ? context.pop() : context.go('/home'),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // User Card with Stats
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceContainerLowest,
                  borderRadius: BorderRadius.circular(22),
                  border: Border.all(color: AppTheme.outlineVariant.withValues(alpha: 0.6)),
                  boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 8, offset: Offset(0, 2))],
                ),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 60,
                          height: 60,
                          decoration: BoxDecoration(
                            gradient: const LinearGradient(colors: [AppTheme.primary, AppTheme.primaryContainer]),
                            shape: BoxShape.circle,
                            boxShadow: [BoxShadow(color: AppTheme.primary.withValues(alpha: 0.3), blurRadius: 8)],
                          ),
                          child: const Center(
                            child: Text('RS', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 20, color: Colors.white)),
                          ),
                        ),
                        const SizedBox(width: 16),
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('Rahul Sharma', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: AppTheme.onSurface)),
                              SizedBox(height: 2),
                              Text('+91 98765 43210', style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 13)),
                              SizedBox(height: 2),
                              Text('rahul.sharma@example.com', style: TextStyle(color: AppTheme.primary, fontSize: 12, fontWeight: FontWeight.bold)),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 18),
                    const Divider(color: AppTheme.outlineVariant, height: 1),
                    const SizedBox(height: 14),
                    // Stats Row
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceAround,
                      children: [
                        _buildStatItem('42', 'Rides Taken'),
                        _buildStatItem('18', 'Food Orders'),
                        _buildStatItem('⭐ 4.98', 'User Rating'),
                      ],
                    ),
                  ],
                ),
              ),
              const Text('Family & School Ride Settings', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: AppTheme.onSurface)),
              const SizedBox(height: 12),

              _buildTile(
                Icons.school_rounded,
                'Saved Schools',
                'Manage school locations, pickup points & timings',
                color: AppTheme.primary,
                onTap: () => _showSavedSchoolsSheet(context),
              ),
              _buildTile(
                Icons.child_care_rounded,
                'Saved Child Profiles',
                'Manage child names, photos, classes & guardians',
                color: const Color(0xFFFF6D00),
                onTap: () => _showSavedChildrenSheet(context),
              ),
              const SizedBox(height: 20),

              const Text('Account Preferences', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: AppTheme.onSurface)),
              const SizedBox(height: 12),

              _buildTile(
                Icons.credit_card_rounded,
                'Saved Payment Cards & UPI',
                'Visa **** 8888, UPI Autopay',
                onTap: () => _showModal(context, 'Saved Payment Cards', 'Primary: HDFC Visa Card **** 8888\nUPI Autopay: rahul@okhdfcbank\nStatus: Verified & Active'),
              ),
              _buildTile(
                Icons.location_on_outlined,
                'Saved Addresses',
                'Home (Kamla Nagar), Work (CP)',
                onTap: () => _showModal(context, 'Saved Addresses', '1. Home: Flat 402, Kamla Nagar, Delhi\n2. Work: Tower B, Connaught Place, New Delhi'),
              ),
              _buildTile(
                Icons.notifications_outlined,
                'Push Notification Preferences',
                'Ride updates, school arrival alerts, receipts',
                onTap: () => _showModal(context, 'Notification Preferences', '• Real-time Ride Telemetry: Enabled\n• School Arrival & Drop-off SMS: Enabled\n• Dual-OTP Verification SMS: Enabled'),
              ),
              _buildTile(
                Icons.support_agent_rounded,
                '24/7 NABIN Support & Disputes',
                'Help center, tickets, and safety assistance',
                color: AppTheme.primary,
                onTap: () => context.push('/support'),
              ),
              const SizedBox(height: 20),

              const Text('Partner Ecosystem', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: AppTheme.onSurface)),
              const SizedBox(height: 12),

              _buildTile(
                Icons.drive_eta_rounded,
                'Switch to Driver Partner Mode',
                'Go online, accept rides, food & parcel deliveries',
                color: const Color(0xFF0284C7),
                onTap: () => context.push('/driver-dashboard'),
              ),
              _buildTile(
                Icons.storefront_rounded,
                'Switch to Merchant Partner Portal',
                'Restaurant KDS & Grocery DarkStore management',
                color: const Color(0xFFFF9030),
                onTap: () => context.push('/restaurant-dashboard'),
              ),
              const SizedBox(height: 28),

              ElevatedButton(
                onPressed: () {
                  showDialog(
                    context: context,
                    builder: (ctx) => AlertDialog(
                      title: const Text('Log Out?', style: TextStyle(fontWeight: FontWeight.w900)),
                      content: const Text('Are you sure you want to log out of your NABIN account?'),
                      actions: [
                        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
                        ElevatedButton(
                          onPressed: () {
                            Navigator.pop(ctx);
                            context.go('/');
                          },
                          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD50000), foregroundColor: Colors.white),
                          child: const Text('Log Out'),
                        ),
                      ],
                    ),
                  );
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFFFEBEE),
                  foregroundColor: const Color(0xFFD50000),
                  elevation: 0,
                  minimumSize: const Size(double.infinity, 52),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: Color(0xFFFFCDD2))),
                ),
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.logout_rounded, size: 18),
                    SizedBox(width: 8),
                    Text('Log Out of NABIN', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14)),
                  ],
                ),
              ),
              const SizedBox(height: 40),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStatItem(String value, String label) {
    return Column(
      children: [
        Text(value, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: AppTheme.primary)),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 11, fontWeight: FontWeight.w600)),
      ],
    );
  }

  Widget _buildTile(IconData icon, String title, String subtitle, {Color? color, VoidCallback? onTap}) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppTheme.surfaceContainerLowest,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppTheme.outlineVariant.withValues(alpha: 0.6)),
            boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 4, offset: Offset(0, 1))],
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: (color ?? AppTheme.primary).withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, color: color ?? AppTheme.primary, size: 20),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.onSurface)),
                    const SizedBox(height: 2),
                    Text(subtitle, style: const TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 11)),
                  ],
                ),
              ),
              const Icon(Icons.arrow_forward_ios_rounded, color: AppTheme.outlineVariant, size: 14),
            ],
          ),
        ),
      ),
    );
  }

  void _showModal(BuildContext context, String title, String details) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      backgroundColor: AppTheme.surfaceContainerLowest,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: AppTheme.onSurface)),
                IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => Navigator.pop(ctx)),
              ],
            ),
            const SizedBox(height: 12),
            Text(details, style: const TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 14, height: 1.5)),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primaryContainer,
                foregroundColor: Colors.white,
                minimumSize: const Size(double.infinity, 48),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              child: const Text('Close', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }

  // --- SAVED SCHOOLS MANAGEMENT SHEET ---
  void _showSavedSchoolsSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setSheetState) {
          final repo = SchoolChildRepository.instance;
          final schools = repo.schools;

          return Container(
            height: MediaQuery.of(context).size.height * 0.85,
            decoration: const BoxDecoration(
              color: AppTheme.surfaceContainerLowest,
              borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
            ),
            padding: const EdgeInsets.fromLTRB(20, 14, 20, 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(color: AppTheme.outlineVariant, borderRadius: BorderRadius.circular(2)),
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.school_rounded, color: AppTheme.primary, size: 24),
                        SizedBox(width: 8),
                        Text('Saved Schools', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: AppTheme.onSurface)),
                      ],
                    ),
                    IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => Navigator.pop(ctx)),
                  ],
                ),
                const Text('Manage pickup locations, security notes and custom daily timings for child rides.', style: TextStyle(fontSize: 12, color: AppTheme.onSurfaceVariant)),
                const SizedBox(height: 14),

                // List of Saved Schools
                Expanded(
                  child: schools.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.school_outlined, size: 48, color: AppTheme.onSurfaceVariant.withValues(alpha: 0.5)),
                              const SizedBox(height: 10),
                              const Text('No saved schools yet', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.onSurfaceVariant)),
                            ],
                          ),
                        )
                      : ListView.builder(
                          itemCount: schools.length,
                          itemBuilder: (context, idx) {
                            final school = schools[idx];
                            return Container(
                              margin: const EdgeInsets.only(bottom: 12),
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                color: AppTheme.surfaceContainerLow,
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(
                                  color: school.isFavorite ? AppTheme.primary : AppTheme.outlineVariant.withValues(alpha: 0.6),
                                  width: school.isFavorite ? 1.5 : 1,
                                ),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Container(
                                        padding: const EdgeInsets.all(8),
                                        decoration: BoxDecoration(
                                          color: AppTheme.primary.withValues(alpha: 0.1),
                                          borderRadius: BorderRadius.circular(10),
                                        ),
                                        child: const Icon(Icons.apartment_rounded, color: AppTheme.primary, size: 20),
                                      ),
                                      const SizedBox(width: 10),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Row(
                                              children: [
                                                Flexible(
                                                  child: Text(school.name, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: AppTheme.onSurface)),
                                                ),
                                                if (school.isFavorite) ...[
                                                  const SizedBox(width: 6),
                                                  Container(
                                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                                                    decoration: BoxDecoration(color: AppTheme.primaryContainer, borderRadius: BorderRadius.circular(6)),
                                                    child: const Text('FAVORITE', style: TextStyle(color: Colors.white, fontSize: 8.5, fontWeight: FontWeight.bold)),
                                                  ),
                                                ],
                                              ],
                                            ),
                                            const SizedBox(height: 2),
                                            Text('📍 ${school.address}', style: const TextStyle(fontSize: 11, color: AppTheme.onSurfaceVariant)),
                                          ],
                                        ),
                                      ),
                                      IconButton(
                                        icon: Icon(
                                          school.isFavorite ? Icons.star_rounded : Icons.star_outline_rounded,
                                          color: school.isFavorite ? const Color(0xFFFFB300) : AppTheme.outline,
                                          size: 22,
                                        ),
                                        onPressed: () {
                                          repo.toggleFavoriteSchool(school.id);
                                          setSheetState(() {});
                                        },
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 8),
                                  const Divider(height: 1, color: AppTheme.outlineVariant),
                                  const SizedBox(height: 8),
                                  Row(
                                    children: [
                                      const Icon(Icons.schedule_rounded, size: 14, color: AppTheme.primary),
                                      const SizedBox(width: 6),
                                      Text(school.generalTimingSummary, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.onSurface)),
                                    ],
                                  ),
                                  if (school.instructions != null && school.instructions!.isNotEmpty) ...[
                                    const SizedBox(height: 4),
                                    Text('Note: ${school.instructions}', style: const TextStyle(fontSize: 10.5, fontStyle: FontStyle.italic, color: AppTheme.onSurfaceVariant)),
                                  ],
                                  const SizedBox(height: 10),
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.end,
                                    children: [
                                      TextButton.icon(
                                        onPressed: () {
                                          _showAddEditSchoolDialog(context, school: school, onSaved: () {
                                            setSheetState(() {});
                                          });
                                        },
                                        icon: const Icon(Icons.edit_rounded, size: 14),
                                        label: const Text('Edit Timing & Info', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                                      ),
                                      const SizedBox(width: 8),
                                      IconButton(
                                        icon: const Icon(Icons.delete_outline_rounded, color: Color(0xFFD50000), size: 18),
                                        onPressed: () {
                                          repo.deleteSchool(school.id);
                                          setSheetState(() {});
                                        },
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                ),

                const SizedBox(height: 12),
                ElevatedButton.icon(
                  onPressed: () {
                    _showAddEditSchoolDialog(context, onSaved: () {
                      setSheetState(() {});
                    });
                  },
                  icon: const Icon(Icons.add_rounded, color: Colors.white),
                  label: const Text('+ Add New School', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Colors.white)),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primaryContainer,
                    minimumSize: const Size(double.infinity, 50),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  // Dialog to Add or Edit a School (with day-by-day timing customizer)
  void _showAddEditSchoolDialog(BuildContext context, {SavedSchool? school, required VoidCallback onSaved}) {
    final isEdit = school != null;
    final nameCtrl = TextEditingController(text: school?.name ?? '');
    final addrCtrl = TextEditingController(text: school?.address ?? '');
    final noteCtrl = TextEditingController(text: school?.instructions ?? '');
    String startTiming = '08:30 AM';
    String endTiming = '02:30 PM';
    bool saturdayOpen = isEdit ? (school.customDayTimings.firstWhere((d) => d.dayName == 'Saturday', orElse: () => const SchoolTimingDay(dayName: 'Saturday', isOpen: true)).isOpen) : true;
    String satEndTiming = '12:30 PM';

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDlgState) => Container(
          height: MediaQuery.of(context).size.height * 0.9,
          decoration: const BoxDecoration(
            color: AppTheme.surfaceContainerLowest,
            borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
          ),
          padding: EdgeInsets.fromLTRB(20, 16, 20, MediaQuery.of(context).viewInsets.bottom + 20),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(isEdit ? 'Edit School Information' : 'Add New School', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: AppTheme.onSurface)),
                    IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => Navigator.pop(ctx)),
                  ],
                ),
                const SizedBox(height: 14),

                // School Name (Required)
                const Text('School Name *', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.onSurface)),
                const SizedBox(height: 6),
                TextField(
                  controller: nameCtrl,
                  decoration: InputDecoration(
                    hintText: 'e.g. ABC Public School',
                    prefixIcon: const Icon(Icons.school_outlined, size: 20),
                    filled: true,
                    fillColor: AppTheme.surfaceContainerLow,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 12),

                // School Address (Required)
                const Text('School Address & Pickup Gate *', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.onSurface)),
                const SizedBox(height: 6),
                TextField(
                  controller: addrCtrl,
                  decoration: InputDecoration(
                    hintText: 'e.g. Kamalanagar, Gate 2 turnaround',
                    prefixIcon: const Icon(Icons.location_on_outlined, size: 20),
                    filled: true,
                    fillColor: AppTheme.surfaceContainerLow,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 12),

                // Map Pin Coordinate Preview
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE8F5E9),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFA5D6A7)),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.pin_drop_rounded, color: Color(0xFF2E7D32), size: 20),
                      SizedBox(width: 8),
                      Expanded(
                        child: Text('Map location pinned automatically (28.6912° N, 77.2114° E). Tap to adjust on map.', style: TextStyle(fontSize: 11, color: Color(0xFF1B5E20))),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),

                // School Timings Section
                const Text('Official School Timing Schedule', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: AppTheme.onSurface)),
                const SizedBox(height: 4),
                const Text('Configure standard hours across weekdays and weekends:', style: TextStyle(fontSize: 11, color: AppTheme.onSurfaceVariant)),
                const SizedBox(height: 10),

                // Monday - Friday Timing
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppTheme.surfaceContainerLow,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Monday – Friday Hours:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8), border: Border.all(color: AppTheme.outlineVariant)),
                              child: Text('Start: $startTiming', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                            ),
                          ),
                          const SizedBox(width: 8),
                          const Text('to', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11, color: AppTheme.onSurfaceVariant)),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8), border: Border.all(color: AppTheme.outlineVariant)),
                              child: Text('End: $endTiming', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 10),

                // Saturday Timing
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppTheme.surfaceContainerLow,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('Saturday Schedule:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                          Switch(
                            value: saturdayOpen,
                            activeThumbColor: AppTheme.primary,
                            onChanged: (val) => setDlgState(() => saturdayOpen = val),
                          ),
                        ],
                      ),
                      if (saturdayOpen) ...[
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            Expanded(
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8), border: Border.all(color: AppTheme.outlineVariant)),
                                child: Text('Start: $startTiming', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                              ),
                            ),
                            const SizedBox(width: 8),
                            const Text('to', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 11, color: AppTheme.onSurfaceVariant)),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8), border: Border.all(color: AppTheme.outlineVariant)),
                                child: Text('End: $satEndTiming', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                              ),
                            ),
                          ],
                        ),
                      ] else ...[
                        const Text('• Closed on Saturdays', style: TextStyle(fontSize: 11, fontStyle: FontStyle.italic, color: AppTheme.onSurfaceVariant)),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 10),

                // Sunday Indicator
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(color: AppTheme.surfaceContainerLow, borderRadius: BorderRadius.circular(10)),
                  child: const Row(
                    children: [
                      Icon(Icons.event_busy_rounded, size: 16, color: AppTheme.onSurfaceVariant),
                      SizedBox(width: 8),
                      Text('Sunday: Closed (Standard)', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppTheme.onSurfaceVariant)),
                    ],
                  ),
                ),
                const SizedBox(height: 14),

                // Instructions (Optional)
                const Text('Special Pickup Instructions (Optional)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.onSurface)),
                const SizedBox(height: 6),
                TextField(
                  controller: noteCtrl,
                  decoration: InputDecoration(
                    hintText: 'e.g. Wait at security guard station near gate 2',
                    filled: true,
                    fillColor: AppTheme.surfaceContainerLow,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 20),

                ElevatedButton(
                  onPressed: () {
                    if (nameCtrl.text.trim().isEmpty || addrCtrl.text.trim().isEmpty) {
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Please enter school name and address.')));
                      return;
                    }

                    final newSchool = SavedSchool(
                      id: school?.id ?? 'sch_${DateTime.now().millisecondsSinceEpoch}',
                      name: nameCtrl.text.trim(),
                      address: addrCtrl.text.trim(),
                      latitude: school?.latitude ?? 28.6912,
                      longitude: school?.longitude ?? 77.2114,
                      instructions: noteCtrl.text.trim().isNotEmpty ? noteCtrl.text.trim() : null,
                      isFavorite: school?.isFavorite ?? false,
                      generalTimingSummary: '$startTiming – $endTiming • Mon–Fri',
                      customDayTimings: SavedSchool.defaultWeeklySchedule(
                        start: startTiming,
                        end: endTiming,
                        satOpen: saturdayOpen,
                        satEnd: satEndTiming,
                      ),
                    );

                    if (isEdit) {
                      SchoolChildRepository.instance.updateSchool(newSchool);
                    } else {
                      SchoolChildRepository.instance.addSchool(newSchool);
                    }

                    Navigator.pop(ctx);
                    onSaved();
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primaryContainer,
                    foregroundColor: Colors.white,
                    minimumSize: const Size(double.infinity, 50),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                  child: Text(isEdit ? 'Update School' : 'Save School', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // --- SAVED CHILDREN MANAGEMENT SHEET ---
  void _showSavedChildrenSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setSheetState) {
          final repo = SchoolChildRepository.instance;
          final children = repo.children;

          return Container(
            height: MediaQuery.of(context).size.height * 0.85,
            decoration: const BoxDecoration(
              color: AppTheme.surfaceContainerLowest,
              borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
            ),
            padding: const EdgeInsets.fromLTRB(20, 14, 20, 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(color: AppTheme.outlineVariant, borderRadius: BorderRadius.circular(2)),
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.child_care_rounded, color: Color(0xFFFF6D00), size: 24),
                        SizedBox(width: 8),
                        Text('Saved Child Profiles', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: AppTheme.onSurface)),
                      ],
                    ),
                    IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => Navigator.pop(ctx)),
                  ],
                ),
                const Text('Save child profiles to auto-populate school rides with guardian emergency details.', style: TextStyle(fontSize: 12, color: AppTheme.onSurfaceVariant)),
                const SizedBox(height: 14),

                // Children List
                Expanded(
                  child: children.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.child_care_outlined, size: 48, color: AppTheme.onSurfaceVariant.withValues(alpha: 0.5)),
                              const SizedBox(height: 10),
                              const Text('No child profiles saved yet', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.onSurfaceVariant)),
                            ],
                          ),
                        )
                      : ListView.builder(
                          itemCount: children.length,
                          itemBuilder: (context, idx) {
                            final child = children[idx];
                            return Container(
                              margin: const EdgeInsets.only(bottom: 12),
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                color: AppTheme.surfaceContainerLow,
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(color: AppTheme.outlineVariant.withValues(alpha: 0.6)),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Container(
                                        width: 44,
                                        height: 44,
                                        decoration: BoxDecoration(
                                          gradient: const LinearGradient(colors: [Color(0xFFFF6D00), Color(0xFFFF9E80)]),
                                          shape: BoxShape.circle,
                                          boxShadow: [BoxShadow(color: const Color(0xFFFF6D00).withValues(alpha: 0.25), blurRadius: 6)],
                                        ),
                                        child: Center(
                                          child: Text(
                                            child.fullName.isNotEmpty ? child.fullName.substring(0, 1) : 'C',
                                            style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 18),
                                          ),
                                        ),
                                      ),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(child.fullName, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: AppTheme.onSurface)),
                                            const SizedBox(height: 2),
                                            Text(
                                              '${child.schoolName} • ${child.gradeClass}${child.section != null && child.section!.isNotEmpty ? ' (${child.section})' : ''}',
                                              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.primary),
                                            ),
                                          ],
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 8),
                                  const Divider(height: 1, color: AppTheme.outlineVariant),
                                  const SizedBox(height: 8),
                                  Text('Guardian: ${child.guardianName} (${child.guardianPhone})', style: const TextStyle(fontSize: 11, color: AppTheme.onSurfaceVariant)),
                                  Text('Pickup: ${child.defaultPickupAddress}', style: const TextStyle(fontSize: 11, color: AppTheme.onSurfaceVariant)),
                                  const SizedBox(height: 8),
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.end,
                                    children: [
                                      TextButton.icon(
                                        onPressed: () {
                                          _showAddEditChildDialog(context, child: child, onSaved: () {
                                            setSheetState(() {});
                                          });
                                        },
                                        icon: const Icon(Icons.edit_rounded, size: 14),
                                        label: const Text('Edit Profile', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                                      ),
                                      const SizedBox(width: 8),
                                      IconButton(
                                        icon: const Icon(Icons.delete_outline_rounded, color: Color(0xFFD50000), size: 18),
                                        onPressed: () {
                                          repo.deleteChild(child.id);
                                          setSheetState(() {});
                                        },
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                ),

                const SizedBox(height: 12),
                ElevatedButton.icon(
                  onPressed: () {
                    _showAddEditChildDialog(context, onSaved: () {
                      setSheetState(() {});
                    });
                  },
                  icon: const Icon(Icons.add_rounded, color: Colors.white),
                  label: const Text('+ Add Child Profile', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Colors.white)),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFFF6D00),
                    minimumSize: const Size(double.infinity, 50),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  // Dialog to Add or Edit Child Profile
  void _showAddEditChildDialog(BuildContext context, {SavedChild? child, required VoidCallback onSaved}) {
    final isEdit = child != null;
    final nameCtrl = TextEditingController(text: child?.fullName ?? '');
    final classCtrl = TextEditingController(text: child?.gradeClass ?? 'Class 5');
    final sectionCtrl = TextEditingController(text: child?.section ?? '');
    final guardianCtrl = TextEditingController(text: child?.guardianName ?? 'Rahul Sharma (Father)');
    final phoneCtrl = TextEditingController(text: child?.guardianPhone ?? '+91 98765 43210');
    final pickupCtrl = TextEditingController(text: child?.defaultPickupAddress ?? 'Flat 402, Civil Lines, Delhi');
    final noteCtrl = TextEditingController(text: child?.specialInstructions ?? '');
    
    final schools = SchoolChildRepository.instance.schools;
    String selectedSchoolId = child?.schoolId ?? (schools.isNotEmpty ? schools.first.id : 'sch_1');

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDlgState) => Container(
          height: MediaQuery.of(context).size.height * 0.9,
          decoration: const BoxDecoration(
            color: AppTheme.surfaceContainerLowest,
            borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
          ),
          padding: EdgeInsets.fromLTRB(20, 16, 20, MediaQuery.of(context).viewInsets.bottom + 20),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(isEdit ? 'Edit Child Profile' : 'Add Child Profile', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: AppTheme.onSurface)),
                    IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => Navigator.pop(ctx)),
                  ],
                ),
                const SizedBox(height: 14),

                // Child Full Name (Required)
                const Text("Child's Full Name *", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                const SizedBox(height: 6),
                TextField(
                  controller: nameCtrl,
                  decoration: InputDecoration(
                    hintText: 'e.g. Rahul Chakma',
                    prefixIcon: const Icon(Icons.person_outline, size: 20),
                    filled: true,
                    fillColor: AppTheme.surfaceContainerLow,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 12),

                // School Selector (Required)
                const Text('Select School *', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                const SizedBox(height: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  decoration: BoxDecoration(color: AppTheme.surfaceContainerLow, borderRadius: BorderRadius.circular(12)),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String>(
                      isExpanded: true,
                      value: selectedSchoolId,
                      items: schools.map((s) => DropdownMenuItem(value: s.id, child: Text(s.name, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)))).toList(),
                      onChanged: (val) {
                        if (val != null) setDlgState(() => selectedSchoolId = val);
                      },
                    ),
                  ),
                ),
                const SizedBox(height: 12),

                // Class (Required) & Section (Optional)
                Row(
                  children: [
                    Expanded(
                      flex: 5,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Class / Grade *', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                          const SizedBox(height: 6),
                          TextField(
                            controller: classCtrl,
                            decoration: InputDecoration(
                              hintText: 'e.g. Class 5',
                              filled: true,
                              fillColor: AppTheme.surfaceContainerLow,
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      flex: 5,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Section (Optional)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                          const SizedBox(height: 6),
                          TextField(
                            controller: sectionCtrl,
                            decoration: InputDecoration(
                              hintText: 'e.g. Section B',
                              filled: true,
                              fillColor: AppTheme.surfaceContainerLow,
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),

                // Guardian Name & Phone
                const Text('Parent / Guardian Name *', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                const SizedBox(height: 6),
                TextField(
                  controller: guardianCtrl,
                  decoration: InputDecoration(
                    hintText: 'e.g. Rahul Sharma',
                    filled: true,
                    fillColor: AppTheme.surfaceContainerLow,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 12),

                const Text('Guardian Contact Number *', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                const SizedBox(height: 6),
                TextField(
                  controller: phoneCtrl,
                  keyboardType: TextInputType.phone,
                  decoration: InputDecoration(
                    hintText: '+91 98765 43210',
                    filled: true,
                    fillColor: AppTheme.surfaceContainerLow,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 12),

                const Text('Default Home / Pickup Address *', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                const SizedBox(height: 6),
                TextField(
                  controller: pickupCtrl,
                  decoration: InputDecoration(
                    hintText: 'e.g. Flat 402, Civil Lines, Delhi',
                    filled: true,
                    fillColor: AppTheme.surfaceContainerLow,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 12),

                const Text('Special Pickup Instructions (Optional)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                const SizedBox(height: 6),
                TextField(
                  controller: noteCtrl,
                  decoration: InputDecoration(
                    hintText: 'e.g. Wait until security officer accompanies child.',
                    filled: true,
                    fillColor: AppTheme.surfaceContainerLow,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 20),

                ElevatedButton(
                  onPressed: () {
                    if (nameCtrl.text.trim().isEmpty || guardianCtrl.text.trim().isEmpty || phoneCtrl.text.trim().isEmpty) {
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Please enter child name, guardian name and phone.')));
                      return;
                    }

                    final matchedSchool = schools.firstWhere((s) => s.id == selectedSchoolId, orElse: () => schools.first);
                    final newChild = SavedChild(
                      id: child?.id ?? 'ch_${DateTime.now().millisecondsSinceEpoch}',
                      fullName: nameCtrl.text.trim(),
                      schoolId: matchedSchool.id,
                      schoolName: matchedSchool.name,
                      schoolAddress: matchedSchool.address,
                      schoolLat: matchedSchool.latitude,
                      schoolLng: matchedSchool.longitude,
                      gradeClass: classCtrl.text.trim().isNotEmpty ? classCtrl.text.trim() : 'Class 5',
                      section: sectionCtrl.text.trim().isNotEmpty ? sectionCtrl.text.trim() : null,
                      guardianName: guardianCtrl.text.trim(),
                      guardianPhone: phoneCtrl.text.trim(),
                      defaultPickupAddress: pickupCtrl.text.trim().isNotEmpty ? pickupCtrl.text.trim() : 'Home Address',
                      pickupLat: 28.6853,
                      pickupLng: 77.2185,
                      specialInstructions: noteCtrl.text.trim().isNotEmpty ? noteCtrl.text.trim() : null,
                    );

                    if (isEdit) {
                      SchoolChildRepository.instance.updateChild(newChild);
                    } else {
                      SchoolChildRepository.instance.addChild(newChild);
                    }

                    Navigator.pop(ctx);
                    onSaved();
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFFF6D00),
                    foregroundColor: Colors.white,
                    minimumSize: const Size(double.infinity, 50),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                  child: Text(isEdit ? 'Update Child Profile' : 'Save Child Profile', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

