import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/theme/app_theme.dart';

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  /// Null means "we do not know", which is why it is not the same widget as a
  /// balance of 0.00: the screen used to print a number it had never read.
  double? _balance;
  bool _loading = true;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _loadBalance();
  }

  Future<void> _loadBalance() async {
    setState(() {
      _loading = true;
      _failed = false;
    });
    final res = await NabinApiService.getProfile();
    if (!mounted) return;
    // getProfile returns the parsed body whatever status the store answered with, so
    // the success flag is the only thing that separates an answer from a refusal. The
    // entity is camelCase (`walletBalance`) in both the mirror and the SQL projection.
    final user = (res?['user'] as Map?)?.cast<String, dynamic>();
    final double? balance =
        res?['success'] == true ? (user?['walletBalance'] as num?)?.toDouble() : null;
    setState(() {
      _balance = balance;
      _failed = balance == null;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Text('NABIN Wallet'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppTheme.onSurface),
          onPressed: () => context.canPop() ? context.pop() : context.go('/home'),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (_loading)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 48),
                  child: Center(child: CircularProgressIndicator(strokeWidth: 2.4)),
                )
              else if (_failed)
                _BalanceUnavailable(onRetry: _loadBalance)
              else
                _BalanceCard(balance: _balance!),
              const SizedBox(height: 40),
            ],
          ),
        ),
      ),
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.balance});

  final double balance;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            color: AppTheme.primary,
            borderRadius: BorderRadius.circular(24),
            boxShadow: const [
              BoxShadow(color: Colors.black26, blurRadius: 16, offset: Offset(0, 6)),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'TOTAL WALLET BALANCE',
                style: TextStyle(
                  color: AppTheme.primaryFixed,
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.0,
                ),
              ),
              const SizedBox(height: 6),
              FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  '₹${balance.toStringAsFixed(2)}',
                  style: const TextStyle(
                    fontSize: 34,
                    fontWeight: FontWeight.w900,
                    color: Colors.white,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        const Text(
          "Adding money to your wallet isn't available yet.",
          style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 12),
        ),
      ],
    );
  }
}

class _BalanceUnavailable extends StatelessWidget {
  const _BalanceUnavailable({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppTheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: AppTheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.error_outline, color: AppTheme.onSurfaceVariant, size: 20),
              SizedBox(width: 10),
              Text(
                "Couldn't load your balance.",
                style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: AppTheme.onSurface),
              ),
            ],
          ),
          const SizedBox(height: 8),
          const Text(
            'Your wallet balance is not shown while it cannot be read.',
            style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 12),
          ),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh, size: 18),
            label: const Text('Retry'),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.primary,
              foregroundColor: Colors.white,
              minimumSize: const Size(double.infinity, 44),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
          ),
        ],
      ),
    );
  }
}
