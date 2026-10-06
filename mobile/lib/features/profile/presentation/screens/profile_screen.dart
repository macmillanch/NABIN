import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/network/session_manager.dart';
import '../../../../core/config/nabin_build_env.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/models/school_model.dart';
import '../../../../core/models/child_model.dart';
import '../../../../core/models/school_child_repository.dart';
import '../../../../core/widgets/map_pin_picker.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  /// null on every field below means "the read has not landed, or was refused", which is
  /// a different sentence from a customer whose account really has no email. The screen
  /// used to hardcode all of it — name, phone, email, initials, a 42/18/4.98 stat row.
  Map<String, dynamic>? _user;
  int? _ridesPlaced;
  int? _foodOrdersPlaced;
  bool _loadingProfile = true;
  bool _profileFailed = false;

  @override
  void initState() {
    super.initState();
    _loadProfile();
    _loadCounts();
  }

  Future<void> _loadProfile() async {
    setState(() {
      _loadingProfile = true;
      _profileFailed = false;
    });
    final res = await NabinApiService.getProfile();
    if (!mounted) return;
    final Map<String, dynamic>? user = (res?['user'] as Map?)?.cast<String, dynamic>();
    final usable = res?['success'] == true && user != null;
    setState(() {
      _user = usable ? user : null;
      _profileFailed = !usable;
      _loadingProfile = false;
    });
  }

  /// Both counts come from the customer's own job and order rows; the screen has no
  /// other source that could say what this person has done on NABIN.
  Future<void> _loadCounts() async {
    final res = await NabinApiService.getCustomerActivity();
    if (!mounted) return;
    final usable = res != null && res['success'] == true;
    final items = (res?['items'] as List? ?? const <dynamic>[])
        .whereType<Map<dynamic, dynamic>>();
    setState(() {
      _ridesPlaced = usable
          ? items.where((e) => e['service'] == 'RIDE').length
          : null;
      _foodOrdersPlaced = usable
          ? items.where((e) => e['service'] == 'FOOD').length
          : null;
    });
  }

  /// Signing the user out means both halves: the backend is told the token is done, and
  /// this process stops holding it. Navigating alone left the bearer token attached to
  /// every later request and the session still marked authenticated.
  Future<void> _logOut() async {
    await NabinApiService.logout();
    // The local session goes whatever the network answered — a logout that kept signing
    // requests because the server was unreachable is the worse failure.
    SessionManager.instance.clearSession();
    // The saved schools and children belong to the account that just signed out.
    SchoolChildRepository.instance.clear();
    if (!mounted) return;
    context.go('/');
  }

  String _initials(String name) {
    final words = name.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
    if (words.isEmpty) return '·';
    if (words.length == 1) return words.first.characters.take(2).toString().toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

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
                    if (_loadingProfile)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 26),
                        child: Center(child: CircularProgressIndicator()),
                      )
                    else if (_profileFailed)
                      _buildProfileUnavailable()
                    else ...<Widget>[
                      _buildIdentityRow(),
                      const SizedBox(height: 18),
                      const Divider(color: AppTheme.outlineVariant, height: 1),
                      const SizedBox(height: 14),
                      _buildStatsRow(),
                    ],
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
                Icons.location_on_outlined,
                'Saved Addresses',
                'Nothing stored on your account yet',
                onTap: () => _showSavedAddressesNote(context),
              ),
              _buildTile(
                Icons.notifications_outlined,
                'Push Notification Preferences',
                'Choose what NABIN tells you about',
                color: AppTheme.primary,
                onTap: () => _showNotificationPreferences(context),
              ),
              _buildTile(
                Icons.support_agent_rounded,
                '24/7 NABIN Support & Disputes',
                'Help center, tickets, and safety assistance',
                color: AppTheme.primary,
                onTap: () => context.push('/support'),
              ),
              // The two partner-mode tiles open Customer-app simulators of the Driver and
              // Restaurant consoles, painted from sample data. Same gate as their routes:
              // a build for real users neither shows the tiles nor answers the locations.
              if (NabinBuildEnv.allowsDemoConvenience) ...[
                const SizedBox(height: 20),

                const Text('Partner Ecosystem', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: AppTheme.onSurface)),
                const SizedBox(height: 4),
                const Text(
                  'Demo simulators of the partner apps. They show sample data, not a real '
                  'partner account.',
                  style: TextStyle(fontSize: 11.5, color: AppTheme.onSurfaceVariant, height: 1.3),
                ),
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
              ],
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
                            unawaited(_logOut());
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

  Widget _buildIdentityRow() {
    final Map<String, dynamic> user = _user ?? const <String, dynamic>{};
    final String? name = user['name']?.toString();
    final String? phone = user['phone']?.toString();
    final String? email = user['email']?.toString();
    return Row(
      children: [
        Container(
          width: 60,
          height: 60,
          decoration: BoxDecoration(
            gradient: const LinearGradient(colors: [AppTheme.primary, AppTheme.primaryContainer]),
            shape: BoxShape.circle,
            boxShadow: [BoxShadow(color: AppTheme.primary.withValues(alpha: 0.3), blurRadius: 8)],
          ),
          child: Center(
            child: Text(_initials(name ?? ''), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20, color: Colors.white)),
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                (name == null || name.isEmpty) ? 'Name not on file' : name,
                style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: AppTheme.onSurface),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              if (phone != null) ...<Widget>[
                const SizedBox(height: 2),
                Text(phone, style: const TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 13)),
              ],
              if (email != null) ...<Widget>[
                const SizedBox(height: 2),
                Text(email, style: const TextStyle(color: AppTheme.primary, fontSize: 12, fontWeight: FontWeight.bold)),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildStatsRow() {
    // A dash is the honest placeholder while a read is in flight or refused; the row used
    // to print 42 / 18 / 4.98 for a customer the app had never asked about.
    //
    // The third slot that row had — "User Rating" — is gone rather than dashed. It read
    // `_user['rating']`, and that field is `users.rating NUMERIC(3,2) DEFAULT 5.00`
    // (001_central_schema.sql:22) with no reviews or ratings table in this schema, so the
    // only number it could ever hold is the column default. A permanent '—' would still
    // claim NABIN scores its customers; it does not.
    // Expanded halves, not spaceAround: the labels need their own width before any gap, so
    // an unbounded Row overflowed on a 390px phone.
    return Row(
      children: [
        Expanded(child: _buildStatItem(_ridesPlaced?.toString() ?? '—', 'Rides Taken')),
        Expanded(child: _buildStatItem(_foodOrdersPlaced?.toString() ?? '—', 'Food Orders')),
      ],
    );
  }

  Widget _buildProfileUnavailable() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.error_outline_rounded, color: AppTheme.onSurfaceVariant, size: 20),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  "Couldn't load your profile.",
                  style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: AppTheme.onSurface),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          const Text(
            'Your name, number and history stay hidden while the account read is unavailable.',
            style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 13),
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: () {
                _loadProfile();
                _loadCounts();
              },
              icon: const Icon(Icons.refresh_rounded, size: 18),
              label: const Text('Retry'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primary,
                foregroundColor: Colors.white,
                minimumSize: const Size(double.infinity, 46),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
            ),
          ),
        ],
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

  /// The schema has a `user_saved_locations` table, but no route in the API reads or
  /// writes it and this app reaches data only through that API, so there is no list to
  /// show. The tile used to print two addresses the client invented.
  void _showSavedAddressesNote(BuildContext context) {
    _showModal(
      context,
      'Saved Addresses',
      'NABIN does not keep saved addresses on your account yet, so there is nothing to '
      'list here.\n\nWhen a trip or a delivery needs an address you type it in at that '
      'moment, and it is used for that booking only.',
    );
  }

  void _showNotificationPreferences(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      backgroundColor: AppTheme.surfaceContainerLowest,
      builder: (_) => const _NotificationPreferencesSheet(),
    );
  }

  Widget _busyState() => const Center(child: CircularProgressIndicator());

  Widget _emptyState(IconData icon, String message) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 48, color: AppTheme.onSurfaceVariant.withValues(alpha: 0.5)),
          const SizedBox(height: 10),
          Text(message,
              style: const TextStyle(
                  fontWeight: FontWeight.bold, color: AppTheme.onSurfaceVariant)),
        ],
      ),
    );
  }

  /// A failed read is shown as a failure with a way to try again. It used to fall
  /// through to the empty state, which told the customer they had no saved schools
  /// when the real answer was that NABIN could not be reached.
  Widget _loadFailedState(String message, Future<void> Function() onRetry) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.cloud_off_rounded, size: 40, color: AppTheme.onSurfaceVariant),
          const SizedBox(height: 10),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 28),
            child: Text(message,
                textAlign: TextAlign.center,
                style: const TextStyle(
                    fontWeight: FontWeight.bold, color: AppTheme.onSurfaceVariant)),
          ),
          const SizedBox(height: 12),
          TextButton.icon(
            onPressed: () => onRetry(),
            icon: const Icon(Icons.refresh_rounded, size: 16),
            label: const Text('Try again',
                style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  void _showFormNotice(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  /// A write either lands on the platform or the platform's own refusal is read
  /// out. Mutating the list locally and closing the form was the old behaviour,
  /// and it looked exactly like a save that never happened.
  Future<void> _submitWrite(Future<String?> Function() write,
      {required VoidCallback onDone}) async {
    final message = await write();
    onDone();
    if (message != null) _showFormNotice(message);
  }

  // --- SAVED SCHOOLS MANAGEMENT SHEET ---
  void _showSavedSchoolsSheet(BuildContext context) {
    // The list a customer manages is the rows their account has on NABIN, so the
    // sheet reads them from the platform instead of trusting what this process
    // happened to be holding.
    SchoolChildRepository.instance.load();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setSheetState) {
          final repo = SchoolChildRepository.instance;

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
                  child: ListenableBuilder(
                    listenable: repo,
                    builder: (context, _) {
                      final schools = repo.schools;
                      if (repo.isLoading) return _busyState();
                      if (repo.status == SchoolChildLoadStatus.failed) {
                        return _loadFailedState(
                          repo.error ??
                              'Could not read your saved schools from NABIN.',
                          () => repo.load(force: true),
                        );
                      }
                      if (schools.isEmpty) {
                        return _emptyState(Icons.school_outlined,
                            'No saved schools on your account yet');
                      }
                      return ListView.builder(
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
                                        onPressed: () => _submitWrite(
                                          () => repo.toggleFavoriteSchool(school.id),
                                          onDone: () => setSheetState(() {}),
                                        ),
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
                                        onPressed: () => _submitWrite(
                                          () => repo.removeSchool(school.id),
                                          onDone: () => setSheetState(() {}),
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            );
                          },
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

  // Sheet to Add or Edit a School (with day-by-day timing customizer)
  void _showAddEditSchoolDialog(BuildContext context, {SavedSchool? school, required VoidCallback onSaved}) {
    final isEdit = school != null;
    final nameCtrl = TextEditingController(text: school?.name ?? '');
    final addrCtrl = TextEditingController(text: school?.address ?? '');
    final noteCtrl = TextEditingController(text: school?.instructions ?? '');
    String startTiming = '08:30 AM';
    String endTiming = '02:30 PM';
    bool saturdayOpen = isEdit ? (school.customDayTimings.firstWhere((d) => d.dayName == 'Saturday', orElse: () => const SchoolTimingDay(dayName: 'Saturday', isOpen: true)).isOpen) : true;
    String satEndTiming = '12:30 PM';
    // A new school has no place until the customer puts one on the map. Editing
    // starts from the coordinates the stored row already carries.
    LatLng? place =
        school == null ? null : LatLng(school.latitude, school.longitude);
    bool saving = false;

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
                    hintText: 'e.g. Gate 2 turnaround, near the security cabin',
                    prefixIcon: const Icon(Icons.location_on_outlined, size: 20),
                    filled: true,
                    fillColor: AppTheme.surfaceContainerLow,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 12),

                // The place the customer taps is the only source of the
                // coordinates this form sends.
                InkWell(
                  onTap: saving
                      ? null
                      : () async {
                          final chosen = await MapPinPickerSheet.show(
                            context,
                            initial: place,
                            title: 'Where is the school?',
                            hint:
                                'Move the map and tap the spot the pickup gate '
                                'stands at. The booking needs the place itself, '
                                'so nothing is filled in for you.',
                          );
                          if (chosen != null) setDlgState(() => place = chosen);
                        },
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: place == null
                          ? const Color(0xFFFFF3E0)
                          : const Color(0xFFE8F5E9),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                          color: place == null
                              ? const Color(0xFFFFCC80)
                              : const Color(0xFFA5D6A7)),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          place == null
                              ? Icons.pin_drop_outlined
                              : Icons.pin_drop_rounded,
                          size: 20,
                          color: place == null
                              ? const Color(0xFFE65100)
                              : const Color(0xFF2E7D32),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            place == null
                                ? 'Tap to place the school on the map.'
                                : 'Pinned at ${place!.latitude.toStringAsFixed(5)}, '
                                    '${place!.longitude.toStringAsFixed(5)}. Tap to move it.',
                            style: TextStyle(
                              fontSize: 11,
                              color: place == null
                                  ? const Color(0xFFBF360C)
                                  : const Color(0xFF1B5E20),
                            ),
                          ),
                        ),
                      ],
                    ),
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
                  onPressed: saving
                      ? null
                      : () async {
                          final name = nameCtrl.text.trim();
                          final address = addrCtrl.text.trim();
                          final pinned = place;
                          if (name.isEmpty || address.isEmpty) {
                            _showFormNotice('Enter the school name and address.');
                            return;
                          }
                          if (pinned == null) {
                            _showFormNotice(
                                'Place the school on the map first — the save needs '
                                'its coordinates and none is filled in for you.');
                            return;
                          }
                          setDlgState(() => saving = true);
                          final message = await SchoolChildRepository.instance
                              .saveSchool(SavedSchool(
                            id: school?.id ?? '',
                            name: name,
                            address: address,
                            latitude: pinned.latitude,
                            longitude: pinned.longitude,
                            instructions: noteCtrl.text.trim().isEmpty
                                ? null
                                : noteCtrl.text.trim(),
                            isFavorite: school?.isFavorite ?? false,
                            generalTimingSummary:
                                '$startTiming – $endTiming • Mon–Fri',
                            customDayTimings:
                                SavedSchool.defaultWeeklySchedule(
                              start: startTiming,
                              end: endTiming,
                              satOpen: saturdayOpen,
                              satEnd: satEndTiming,
                            ),
                          ));
                          setDlgState(() => saving = false);
                          if (message != null) return;
                          if (!ctx.mounted) return;
                          Navigator.pop(ctx);
                          onSaved();
                        },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primaryContainer,
                    foregroundColor: Colors.white,
                    disabledBackgroundColor: AppTheme.surfaceContainerHigh,
                    disabledForegroundColor: AppTheme.onSurfaceVariant,
                    minimumSize: const Size(double.infinity, 50),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                  child: Text(saving
                      ? 'Saving…'
                      : isEdit
                          ? 'Update School'
                          : 'Save School',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
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
    // Children and their schools are read together, because the form needs the
    // school rows to offer a school to link.
    SchoolChildRepository.instance.load();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setSheetState) {
          final repo = SchoolChildRepository.instance;

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
                  child: ListenableBuilder(
                    listenable: repo,
                    builder: (context, _) {
                      final children = repo.children;
                      if (repo.isLoading) return _busyState();
                      if (repo.status == SchoolChildLoadStatus.failed) {
                        return _loadFailedState(
                          repo.error ??
                              'Could not read your child profiles from NABIN.',
                          () => repo.load(force: true),
                        );
                      }
                      if (children.isEmpty) {
                        return _emptyState(Icons.child_care_outlined,
                            'No child profiles saved yet');
                      }
                      return ListView.builder(
                          itemCount: children.length,
                          itemBuilder: (context, idx) {
                            final child = children[idx];
                            final school = repo.schoolFor(child);
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
                                              '${child.schoolName ?? 'No school linked'} • ${child.gradeClass}${child.section != null && child.section!.isNotEmpty ? ' (${child.section})' : ''}',
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
                                  // The school's own row is the source of its
                                  // address; a linked school the customer has
                                  // since deleted is said out loud, not hidden.
                                  if (child.schoolId != null && school == null)
                                    const Text('The school this child was linked to is no longer saved.',
                                        style: TextStyle(
                                            fontSize: 10.5,
                                            fontStyle: FontStyle.italic,
                                            color: AppTheme.error)),
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
                                        onPressed: () => _submitWrite(
                                          () => repo.removeChild(child.id),
                                          onDone: () => setSheetState(() {}),
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            );
                          },
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

  // Sheet to Add or Edit Child Profile
  void _showAddEditChildDialog(BuildContext context, {SavedChild? child, required VoidCallback onSaved}) {
    final isEdit = child != null;
    // Every field starts empty. They used to start pre-filled with a sample
    // child's class, guardian, phone and address, so pressing Save sent details
    // of a person this customer never typed.
    final nameCtrl = TextEditingController(text: child?.fullName ?? '');
    final classCtrl = TextEditingController(text: child?.gradeClass ?? '');
    final sectionCtrl = TextEditingController(text: child?.section ?? '');
    final guardianCtrl = TextEditingController(text: child?.guardianName ?? '');
    final phoneCtrl = TextEditingController(text: child?.guardianPhone ?? '');
    final pickupCtrl = TextEditingController(text: child?.defaultPickupAddress ?? '');
    final noteCtrl = TextEditingController(text: child?.specialInstructions ?? '');

    final schools = SchoolChildRepository.instance.schools;
    // Only an id that is still in the customer's own list can be the starting
    // selection — the write checks it against their schools and 400s otherwise.
    String selectedSchoolId = schools.any((s) => s.id == child?.schoolId)
        ? child!.schoolId!
        : (schools.isNotEmpty ? schools.first.id : '');
    LatLng? place = child == null
        ? null
        : LatLng(child.pickupLat, child.pickupLng);
    bool saving = false;

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
                    hintText: 'The name on the child’s school bag',
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
                if (schools.isEmpty)
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppTheme.surfaceContainerLow,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppTheme.outlineVariant),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.school_outlined, size: 20, color: AppTheme.onSurfaceVariant),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text('Save a school first — a child profile is linked to one of your saved schools.',
                              style: TextStyle(fontSize: 11.5, color: AppTheme.onSurfaceVariant)),
                        ),
                      ],
                    ),
                  )
                else
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
                    hintText: 'e.g. Lalthanmawli (Mother)',
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
                    hintText: '+91 98XXX XXXXX',
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
                    hintText: 'House / flat, lane and locality',
                    filled: true,
                    fillColor: AppTheme.surfaceContainerLow,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 12),

                // The pickup coordinates the save requires can only come from a
                // place the customer chose.
                InkWell(
                  onTap: saving
                      ? null
                      : () async {
                          final chosen = await MapPinPickerSheet.show(
                            context,
                            initial: place,
                            title: 'Where is the pickup point?',
                            hint:
                                'Tap the map at the exact spot the driver should '
                                'wait. The ride starts from this place.',
                          );
                          if (chosen != null) setDlgState(() => place = chosen);
                        },
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: place == null
                          ? const Color(0xFFFFF3E0)
                          : const Color(0xFFE8F5E9),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                          color: place == null
                              ? const Color(0xFFFFCC80)
                              : const Color(0xFFA5D6A7)),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          place == null
                              ? Icons.pin_drop_outlined
                              : Icons.pin_drop_rounded,
                          size: 20,
                          color: place == null
                              ? const Color(0xFFE65100)
                              : const Color(0xFF2E7D32),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            place == null
                                ? 'Tap to place the pickup point on the map.'
                                : 'Pinned at ${place!.latitude.toStringAsFixed(5)}, '
                                    '${place!.longitude.toStringAsFixed(5)}. Tap to move it.',
                            style: TextStyle(
                              fontSize: 11,
                              color: place == null
                                  ? const Color(0xFFBF360C)
                                  : const Color(0xFF1B5E20),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),

                const Text('Special Pickup Instructions (Optional)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                const SizedBox(height: 6),
                TextField(
                  controller: noteCtrl,
                  decoration: InputDecoration(
                    hintText: 'e.g. Wait until the security officer accompanies the child.',
                    filled: true,
                    fillColor: AppTheme.surfaceContainerLow,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 20),

                ElevatedButton(
                  onPressed: saving || schools.isEmpty
                      ? null
                      : () async {
                          final fullName = nameCtrl.text.trim();
                          final gradeClass = classCtrl.text.trim();
                          final guardianName = guardianCtrl.text.trim();
                          final guardianPhone = phoneCtrl.text.trim();
                          final pickupAddress = pickupCtrl.text.trim();
                          final pinned = place;
                          final schoolId = selectedSchoolId;
                          if (fullName.isEmpty || gradeClass.isEmpty ||
                              guardianName.isEmpty || guardianPhone.isEmpty ||
                              pickupAddress.isEmpty) {
                            _showFormNotice(
                                'Fill in the child’s name, class, guardian name, '
                                'phone and pickup address.');
                            return;
                          }
                          if (schoolId.isEmpty) {
                            _showFormNotice('Save a school first.');
                            return;
                          }
                          if (pinned == null) {
                            _showFormNotice(
                                'Place the pickup point on the map first — the '
                                'save needs its coordinates.');
                            return;
                          }
                          final section = sectionCtrl.text.trim();
                          final note = noteCtrl.text.trim();
                          setDlgState(() => saving = true);
                          final message =
                              await SchoolChildRepository.instance.saveChild(
                            SavedChild(
                              id: child?.id ?? '',
                              fullName: fullName,
                              schoolId: schoolId,
                              schoolName:
                                  SchoolChildRepository.instance
                                      .schoolById(schoolId)
                                      ?.name,
                              gradeClass: gradeClass,
                              section: section.isEmpty ? null : section,
                              guardianName: guardianName,
                              guardianPhone: guardianPhone,
                              defaultPickupAddress: pickupAddress,
                              pickupLat: pinned.latitude,
                              pickupLng: pinned.longitude,
                              specialInstructions:
                                  note.isEmpty ? null : note,
                            ),
                          );
                          setDlgState(() => saving = false);
                          if (message != null) return;
                          if (!ctx.mounted) return;
                          Navigator.pop(ctx);
                          onSaved();
                        },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFFF6D00),
                    foregroundColor: Colors.white,
                    disabledBackgroundColor: AppTheme.surfaceContainerHigh,
                    disabledForegroundColor: AppTheme.onSurfaceVariant,
                    minimumSize: const Size(double.infinity, 50),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                  child: Text(saving
                      ? 'Saving…'
                      : isEdit
                          ? 'Update Child Profile'
                          : 'Save Child Profile',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The nine subjects and four channels the `notification_preferences` row actually
/// holds. A toggle here is a write to that row through PUT /api/notifications/preferences;
/// nothing on this sheet is client-side state, because the backend owns the answer.
class _NotificationPreferencesSheet extends StatefulWidget {
  const _NotificationPreferencesSheet();

  @override
  State<_NotificationPreferencesSheet> createState() =>
      _NotificationPreferencesSheetState();
}

class _NotificationPreferencesSheetState
    extends State<_NotificationPreferencesSheet> {
  static const List<MapEntry<String, String>> _subjects =
      <MapEntry<String, String>>[
    MapEntry('ridesEnabled', 'Rides'),
    MapEntry('driverUpdatesEnabled', 'Driver updates'),
    MapEntry('parcelEnabled', 'Parcel deliveries'),
    MapEntry('foodEnabled', 'Food orders'),
    MapEntry('groceryEnabled', 'Grocery orders'),
    MapEntry('paymentsEnabled', 'Payments and refunds'),
    MapEntry('promotionsEnabled', 'Offers and promotions'),
    MapEntry('supportEnabled', 'Support replies'),
    MapEntry('systemEnabled', 'Account and system alerts'),
  ];

  static const List<MapEntry<String, String>> _channels =
      <MapEntry<String, String>>[
    MapEntry('pushEnabled', 'Push notifications'),
    MapEntry('inAppEnabled', 'In-app inbox'),
    MapEntry('smsEnabled', 'SMS'),
    MapEntry('emailEnabled', 'Email'),
  ];

  Map<String, bool>? _prefs;
  bool _loading = true;
  bool _failed = false;
  String? _savingKey;
  String? _saveError;

  @override
  void initState() {
    super.initState();
    _load();
  }

  /// null means the row did not carry all thirteen booleans, so the sheet cannot claim a
  /// state for any of them.
  static Map<String, bool>? _boolsFrom(Map<String, dynamic> row) {
    final out = <String, bool>{};
    for (final entry in <MapEntry<String, String>>[..._subjects, ..._channels]) {
      final value = row[entry.key];
      if (value is! bool) return null;
      out[entry.key] = value;
    }
    return out;
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _failed = false;
    });
    final res = await NabinApiService.getNotificationPreferences();
    if (!mounted) return;
    final row = (res?['preferences'] as Map?)?.cast<String, dynamic>();
    final parsed = res?['success'] == true && row != null ? _boolsFrom(row) : null;
    setState(() {
      _prefs = parsed;
      _failed = parsed == null;
      _loading = false;
    });
  }

  Future<void> _toggle(String key, bool value) async {
    if (_savingKey != null || _prefs == null) return;
    setState(() {
      _prefs![key] = value;
      _savingKey = key;
      _saveError = null;
    });
    final res = await NabinApiService.updateNotificationPreferences({key: value});
    if (!mounted) return;
    final row = (res?['preferences'] as Map?)?.cast<String, dynamic>();
    final returned = res?['success'] == true && row != null ? _boolsFrom(row) : null;
    setState(() {
      if (returned != null) {
        _prefs = returned;
      } else {
        _prefs![key] = !value;
        _saveError = 'That change was not saved. Everything else is as it was.';
      }
      _savingKey = null;
    });
  }

  Widget _buildRow(String key, String label) {
    final saving = _savingKey == key;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.outlineVariant),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: AppTheme.onSurface,
              ),
            ),
          ),
          if (saving)
            const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: AppTheme.primary,
              ),
            )
          else
            Switch(
              key: ValueKey('notification-pref-$key'),
              value: _prefs?[key] ?? true,
              activeThumbColor: AppTheme.primary,
              onChanged: (val) => _toggle(key, val),
            ),
        ],
      ),
    );
  }

  Widget _buildSection(String title, List<MapEntry<String, String>> entries) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w900,
            color: AppTheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 10),
        for (final entry in entries) _buildRow(entry.key, entry.value),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.82,
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Expanded(
                    child: Text(
                      'Push Notification Preferences',
                      style: TextStyle(
                        fontWeight: FontWeight.w900,
                        fontSize: 18,
                        color: AppTheme.onSurface,
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close_rounded),
                    onPressed: () => Navigator.pop(context),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              if (_loading)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 48),
                  child: Center(
                    child: CircularProgressIndicator(color: AppTheme.primary),
                  ),
                )
              else if (_failed)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        "NABIN couldn't load your notification preferences right now.",
                        style: TextStyle(
                          color: AppTheme.onSurfaceVariant,
                          fontSize: 14,
                          height: 1.5,
                        ),
                      ),
                      const SizedBox(height: 16),
                      OutlinedButton(
                        onPressed: _load,
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppTheme.primary,
                          minimumSize: const Size(double.infinity, 48),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                )
              else
                Flexible(
                  child: SingleChildScrollView(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _buildSection('What we tell you about', _subjects),
                        const SizedBox(height: 18),
                        _buildSection('How we reach you', _channels),
                        if (_saveError != null) ...[
                          const SizedBox(height: 12),
                          Text(
                            _saveError!,
                            style: const TextStyle(
                              color: AppTheme.error,
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

