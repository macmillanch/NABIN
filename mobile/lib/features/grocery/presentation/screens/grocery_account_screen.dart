import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../theme/grocery_theme.dart';

// This tab used to be entirely invented. It opened on 'Rahul Sharma' with a
// verified badge and '+91 98765 43210 • rahul.sharma@example.com', an
// 'M3 GROCERY WALLET' holding ₹450.00 whose '+ Add Cash' button answered
// 'Added ₹500 to Grocery Wallet!' to a tap that moved no money, two orders
// ('M3-882910', 'Delivered in 8 mins') that no store holds, a 'Saved Delivery
// Addresses — Civil Lines, Connaught Place' tile whose handler was `() {}`,
// 'Saved Payment Methods — UPI, HDFC Visa Card **** 8888', and a support sheet
// promising a 24/7 express team. The M3 name and the ten-minute promise are not
// NABIN claims either.
//
// What is real: `GET /api/auth/me` answers this account's own name, phone and
// wallet balance, and `/support`, `/wallet`, `/activity` are live screens. What
// has no route — saved addresses, stored instruments, wallet top-up, a grocery
// delivery-time guarantee — is stated as absent instead of drawn as a tile.
class GroceryAccountScreen extends StatefulWidget {
  const GroceryAccountScreen({super.key});

  @override
  State<GroceryAccountScreen> createState() => _GroceryAccountScreenState();
}

class _GroceryAccountScreenState extends State<GroceryAccountScreen> {
  Map<String, dynamic>? _user;
  bool _loading = true;
  bool _failed = false;
  String? _failure;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _failed = false;
      _failure = null;
    });
    final res = await NabinApiService.getProfile();
    if (!mounted) return;
    final Map<String, dynamic>? user = (res?['user'] as Map?)?.cast<String, dynamic>();
    final bool usable = res?['success'] == true && user != null;
    setState(() {
      _user = usable ? user : null;
      _failed = !usable;
      _failure = usable
          ? null
          : (res?['error'] as String?) ??
              'NABIN could not read your account. Check the connection and try again.';
      _loading = false;
    });
  }

  String _value(String key) => _user?[key]?.toString().trim() ?? '';

  String get _initials {
    final words = _value('name').split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
    if (words.isEmpty) return '·';
    if (words.length == 1) return words.first.substring(0, 1).toUpperCase();
    return (words.first.substring(0, 1) + words.last.substring(0, 1)).toUpperCase();
  }

  /// Null means the balance was never read, which is not the same fact as zero.
  double? get _balance {
    final raw = _user?['walletBalance'];
    return raw is num ? raw.toDouble() : null;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: GroceryTheme.bgOffWhite,
      appBar: AppBar(
        title: const Text(
          'Grocery Account',
          style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: GroceryTheme.textDark),
        ),
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (_loading)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 48),
                  child: Center(child: CircularProgressIndicator(strokeWidth: 2.4)),
                )
              else if (_failed)
                _AccountUnavailable(message: _failure!, onRetry: _load)
              else ...[
                _buildHeaderCard(),
                const SizedBox(height: 14),
                _buildWalletCard(),
              ],
              const SizedBox(height: 20),
              const Text(
                'Orders and help',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: GroceryTheme.textDark),
              ),
              const SizedBox(height: 10),
              _buildTile(
                Icons.receipt_long_outlined,
                'Your NABIN orders',
                _loading || _failed ? 'Reading from NABIN' : 'Ride, food, grocery and parcel, from your own account',
                () => context.push('/activity'),
              ),
              _buildTile(
                Icons.support_agent_rounded,
                'Get help with an order',
                'Opens a ticket NABIN answers in the app',
                () => context.push('/support'),
              ),
              const SizedBox(height: 12),
              // The tiles this screen used to carry — saved addresses, saved cards —
              // named data no route serves: NABIN stores the address typed at
              // checkout on the order itself, and the app holds no instrument.
              Text(
                _loading
                    ? 'Reading your account from NABIN…'
                    : 'NABIN does not keep a saved-address book or saved cards for this '
                        'account yet: the address you type at checkout is the one the order '
                        'stores, and you pay for each order when you place it.',
                style: const TextStyle(
                  fontSize: 11.5,
                  color: GroceryTheme.textMuted,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeaderCard() {
    final name = _value('name');
    final phone = _value('phone');
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: GroceryTheme.surfaceWhite,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: GroceryTheme.borderLight),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 8, offset: const Offset(0, 3)),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 54,
            height: 54,
            decoration: const BoxDecoration(
              color: GroceryTheme.primaryGreenLight,
              shape: BoxShape.circle,
            ),
            child: Center(
              child: Text(
                _initials,
                style: const TextStyle(
                  fontWeight: FontWeight.w900,
                  fontSize: 18,
                  color: GroceryTheme.primaryGreenDark,
                ),
              ),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name.isEmpty ? 'No name on this account' : name,
                  style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: GroceryTheme.textDark),
                ),
                const SizedBox(height: 2),
                Text(
                  phone.isEmpty ? 'NABIN gave no phone number with this account' : phone,
                  style: const TextStyle(fontSize: 11.5, color: GroceryTheme.textMuted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWalletCard() {
    final balance = _balance;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () => context.push('/wallet'),
        borderRadius: BorderRadius.circular(18),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [GroceryTheme.headerBand, GroceryTheme.primaryAction],
            ),
            borderRadius: BorderRadius.circular(18),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              // The label gives way, the amount does not: an unreadable balance
              // is a wider string than a number, and squeezing the number is how
              // a wallet card ends up clipped at phone width.
              const Expanded(
                child: Row(
                  children: [
                    Icon(Icons.account_balance_wallet_rounded, color: Colors.white, size: 22),
                    SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'NABIN WALLET',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w900, color: Colors.white70),
                          ),
                          Text(
                            'Your balance, as NABIN holds it',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 10.5, color: Colors.white70),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    balance == null ? 'Not readable' : '₹${balance.toStringAsFixed(2)}',
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: Colors.white),
                  ),
                  const Text('Open →', style: TextStyle(fontSize: 10.5, color: Colors.white70)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTile(IconData icon, String title, String subtitle, VoidCallback onTap) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: const BorderSide(color: GroceryTheme.borderLight),
        ),
        tileColor: GroceryTheme.surfaceWhite,
        leading: Icon(icon, color: GroceryTheme.primaryGreenDark, size: 22),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: GroceryTheme.textDark)),
        subtitle: Text(subtitle, style: const TextStyle(fontSize: 11, color: GroceryTheme.textMuted)),
        trailing: const Icon(Icons.arrow_forward_ios_rounded, size: 14, color: GroceryTheme.textMuted),
      ),
    );
  }
}

class _AccountUnavailable extends StatelessWidget {
  const _AccountUnavailable({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: GroceryTheme.surfaceWhite,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: GroceryTheme.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.wifi_tethering_error_rounded, color: GroceryTheme.accentRose, size: 22),
              SizedBox(width: 10),
              Text(
                'NABIN did not answer',
                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: GroceryTheme.textDark),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            message,
            style: const TextStyle(fontSize: 12.5, color: GroceryTheme.textMuted, height: 1.4),
          ),
          const SizedBox(height: 4),
          const Text(
            'Nothing on this page is filled in from a sample account while your own '
            'details are unreadable.',
            style: TextStyle(fontSize: 11.5, color: GroceryTheme.textMuted, height: 1.4),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.replay_rounded, size: 16),
            label: const Text('Try again'),
            style: OutlinedButton.styleFrom(
              foregroundColor: GroceryTheme.primaryAction,
              side: const BorderSide(color: GroceryTheme.primaryAction),
            ),
          ),
        ],
      ),
    );
  }
}
