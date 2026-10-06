import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/network/session_manager.dart';
import '../../../../core/theme/app_theme.dart';

class PersonalizationScreen extends StatefulWidget {
  const PersonalizationScreen({super.key});

  @override
  State<PersonalizationScreen> createState() => _PersonalizationScreenState();
}

class _PersonalizationScreenState extends State<PersonalizationScreen> {
  // This step used to open already filled in — 'Rahul Sharma',
  // 'rahul.sharma@example.com' — and 'Get Moving' spun for 600 ms and moved on having
  // written nothing. Both fields were editable, so a customer could rewrite their own
  // name here and NABIN would never hear about it. There is no route this app may call
  // to change them: `POST /api/auth/verify-otp` takes only phone/otp/role/purpose,
  // `GET /api/auth/me` is a read, and no other customer write exists. So the account's
  // own values are shown as what they are — read-only — and the button below does only
  // the one thing it can do, which is continue.
  String _sessionValue(String key) =>
      SessionManager.instance.currentUser?[key]?.toString().trim() ?? '';

  /// The monogram may carry only initials the account's own name supplies. The old
  /// screen painted 'RS' for a customer whose name was never Rahul Sharma.
  String get _initials {
    final words = _sessionValue('name')
        .split(RegExp(r'\s+'))
        .where((w) => w.isNotEmpty)
        .toList();
    if (words.isEmpty) return '';
    final first = words.first;
    if (words.length == 1) return first.substring(0, 1).toUpperCase();
    return (first.substring(0, 1) + words.last.substring(0, 1)).toUpperCase();
  }

  /// A stored account value, displayed rather than edited. It keeps the card the form
  /// used to have so the screen still reads as the design, minus the input affordance:
  /// a field you can type into promises a write that no route here performs.
  Widget _buildAccountRow({
    required IconData icon,
    required String label,
    required String value,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.outlineVariant),
        boxShadow: const [
          BoxShadow(color: Colors.black12, blurRadius: 4, offset: Offset(0, 2)),
        ],
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: AppTheme.primary, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    color: AppTheme.onSurfaceVariant,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  value.isEmpty ? 'Not on your NABIN account' : value,
                  style: TextStyle(
                    color: value.isEmpty ? AppTheme.onSurfaceVariant : AppTheme.onSurface,
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _finishSetup() {
    // No spinner and no delay: nothing here is being saved, so the step cannot act as
    // if it were. The identity form ahead is the first thing in this journey that has a
    // route behind it.
    context.go('/identity-verification-submit');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, color: AppTheme.onSurface, size: 20),
          onPressed: () => context.canPop() ? context.pop() : context.go('/otp-verification'),
        ),
        title: const Text('NABIN', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 20, color: AppTheme.primary, letterSpacing: 0.5)),
        centerTitle: true,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 12),
              const Text(
                'Complete your profile',
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: AppTheme.onSurface, letterSpacing: -0.5),
              ),
              const SizedBox(height: 6),
              const Text(
                'Personalize your super-app experience for rides, dining, and parcels.',
                style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 14),
              ),
              const SizedBox(height: 28),

              // Avatar monogram. The camera badge that used to sit on this circle
              // answered 'Avatar updated' without choosing, reading or sending a
              // picture. `POST /api/customer/profile/photo` is a real route, but this
              // app has no image picker dependency, so there is nothing to upload and
              // no affordance is offered for it.
              Center(
                child: Container(
                  width: 100,
                  height: 100,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [AppTheme.primary, AppTheme.primaryContainer],
                    ),
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: AppTheme.primary.withValues(alpha: 0.3),
                        blurRadius: 16,
                        offset: const Offset(0, 6),
                      ),
                    ],
                  ),
                  child: _initials.isEmpty
                      ? const Icon(Icons.person_rounded, size: 44, color: Colors.white)
                      : Center(
                          child: Text(
                            _initials,
                            style: const TextStyle(
                              fontSize: 32,
                              fontWeight: FontWeight.w900,
                              color: Colors.white,
                            ),
                          ),
                        ),
                ),
              ),
              const SizedBox(height: 32),

              // The two values NABIN holds for this account, shown as records rather
              // than as inputs: no route this app can call writes either of them.
              _buildAccountRow(
                icon: Icons.person_outline,
                label: 'Full Name',
                value: _sessionValue('name'),
              ),
              const SizedBox(height: 16),
              _buildAccountRow(
                icon: Icons.email_outlined,
                label: 'Email Address',
                value: _sessionValue('email'),
              ),
              const SizedBox(height: 12),
              const Text(
                'These are the details on your NABIN account. This app has no way to '
                'change them, so they are shown for you to check before the identity '
                'step — speak to NABIN if either one is wrong.',
                style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 11.5, height: 1.35),
              ),
              const SizedBox(height: 24),

              // App language
              const Text('App Language', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: AppTheme.onSurface)),
              const SizedBox(height: 10),
              // This used to be a four-chip selector — English, Mizo, Hindi, Bengali —
              // where tapping a chip only changed the chip's own colour. The app carries
              // no localization delegates, so every string on screen stayed English no
              // matter which chip was picked, and the pick was stored nowhere. What the
              // customer app actually speaks is shown instead of a control that cannot
              // speak anything else.
              Wrap(
                spacing: 10,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    decoration: BoxDecoration(
                      color: AppTheme.primary,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppTheme.primary),
                    ),
                    child: const Text(
                      'English',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              const Text(
                'Mizo, Hindi and Bengali are not translated into yet, so there is nothing '
                'to switch to. Tell NABIN which language you want the app in.',
                style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 11.5, height: 1.35),
              ),
              const SizedBox(height: 28),

              ElevatedButton(
                onPressed: _finishSetup,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.primaryContainer,
                  foregroundColor: Colors.white,
                  minimumSize: const Size(double.infinity, 56),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  elevation: 2,
                  shadowColor: AppTheme.primary.withValues(alpha: 0.35),
                ),
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text('Get Moving', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                    SizedBox(width: 8),
                    Icon(Icons.arrow_forward, size: 18),
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
