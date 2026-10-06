import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/nabin_palette.dart';

/// Shared NABIN payment lifecycle used by Ride, Food, Grocery and Parcel.
///
/// It renders the visual + state flow — method → processing → success /
/// failed / pending → receipt, plus cancellation — against the NABIN token theme.
/// Terminal state comes from the caller-supplied [PaymentScreen.authorize] (the real
/// backend call, e.g. bookFood / validateGroceryCheckout); with no gateway wired it
/// stays pending rather than fabricating success, and no live credentials are ever
/// touched. There is deliberately no refund stage: the only refund route is
/// admin-scoped POST /api/admin/finance/refund, so a customer-facing screen cannot
/// initiate one or quote a reference for it.

/// Result of an authoritative payment attempt from the backend — a real status,
/// not a timer. `ok` = terminal success, `pending` = awaiting confirmation,
/// `reference` = the order/transaction id the backend assigned.
typedef PaymentOutcome = ({bool ok, bool pending, String? reference});

enum PaymentStage {
  method,
  processing,
  success,
  failed,
  pending,
  receipt,
  cancelled,
}

enum PaymentMethodKind { upi, card, cashOnDelivery }

class PaymentScreen extends StatefulWidget {
  const PaymentScreen({
    super.key,
    required this.amount,
    required this.serviceName,
    required this.referenceId,
    this.startStage = PaymentStage.method,
    this.authorize,
  });

  /// Rupee display string, e.g. "₹160".
  final String amount;
  final String serviceName;
  final String referenceId;
  final PaymentStage startStage;

  /// The caller-supplied authoritative payment step (the real backend call, e.g.
  /// `bookFood` / `validateGroceryCheckout`). When null the screen never
  /// fabricates success: a non-COD payment stays pending until a backend result
  /// arrives.
  final Future<PaymentOutcome> Function()? authorize;

  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> {
  late PaymentStage _stage = widget.startStage;
  PaymentMethodKind _method = PaymentMethodKind.upi;
  bool _polling = false;
  String? _serverRef;

  /// The kinds of payment this screen may offer. `checkouts.payment_method` is
  /// constrained to `CASH | WALLET | RAZORPAY | EXTERNAL_GATEWAY`
  /// (013_checkout_domain.sql), so all four strings are *recordable* — but a method is
  /// only offered here when the app has a route that can actually take money under it.
  /// WALLET is not: the balance is readable via `/auth/me`, yet no customer route debits
  /// it, and the checkout paths stamp `'WALLET'` on any non-CASH call
  /// (server.js:6989) without moving a rupee. Nothing here may name an instrument
  /// either: no saved-instruction route exists, so a card number, an expiry, a VPA or a
  /// wallet figure would all be invented.
  static const List<({PaymentMethodKind kind, String label, String sub})>
      _methods = [
    (
      kind: PaymentMethodKind.upi,
      label: 'UPI',
      sub: 'Approved by the payment gateway'
    ),
    (
      kind: PaymentMethodKind.card,
      label: 'Card',
      sub: 'Approved by the payment gateway'
    ),
    (
      kind: PaymentMethodKind.cashOnDelivery,
      label: 'Cash on delivery',
      sub: 'Pay when it arrives'
    ),
  ];

  @override
  void dispose() {
    _polling = false;
    super.dispose();
  }

  Future<void> _confirm() async {
    setState(() {
      _polling = true;
      _stage = PaymentStage.processing;
    });
    final authorize = widget.authorize;
    if (authorize == null) {
      _polling = false;
      // Cash on delivery has no gateway to wait for, so there is no confirmation to
      // invent: the screen's own success state means "the order stands, the money is
      // still to be collected at the door". Every other method holds on *pending*.
      if (_method == PaymentMethodKind.cashOnDelivery) {
        if (mounted) setState(() => _stage = PaymentStage.success);
        return;
      }
      if (mounted) setState(() => _stage = PaymentStage.pending);
      return;
    }
    // With a backend call wired, COD is placed through it like any other method —
    // skipping it would show an order as taken that was never sent.
    try {
      final r = await authorize();
      if (!mounted) return;
      _polling = false;
      setState(() {
        if (r.reference != null) _serverRef = r.reference;
        _stage = r.pending
            ? PaymentStage.pending
            : (r.ok ? PaymentStage.success : PaymentStage.failed);
      });
    } catch (_) {
      _polling = false;
      if (mounted) setState(() => _stage = PaymentStage.failed);
    }
  }

  void _go(PaymentStage stage) => setState(() => _stage = stage);

  @override
  Widget build(BuildContext context) {
    final p = NabinPalette.of(context);
    return Scaffold(
      backgroundColor: p.canvas,
      appBar: AppBar(
        backgroundColor: p.surface,
        foregroundColor: p.onSurface,
        title: Text(_titleFor(_stage),
            style: const TextStyle(fontWeight: FontWeight.w700)),
        automaticallyImplyLeading: _stage != PaymentStage.processing,
      ),
      body: SafeArea(child: _body(p)),
    );
  }

  String _titleFor(PaymentStage s) => switch (s) {
        PaymentStage.method => 'Payment',
        PaymentStage.processing => 'Processing',
        PaymentStage.success => 'Payment successful',
        PaymentStage.failed => 'Payment failed',
        PaymentStage.pending => 'Payment pending',
        PaymentStage.receipt => 'Receipt',
        PaymentStage.cancelled => 'Payment cancelled',
      };

  Widget _body(NabinPalette p) => switch (_stage) {
        PaymentStage.method => _methodView(p),
        PaymentStage.processing => _statusView(
            p,
            icon: Icons.hourglass_top_rounded,
            color: p.brand,
            title: 'Processing ${widget.amount}',
            message: 'Confirming with your bank. Please keep this screen open.',
            spinner: true,
          ),
        PaymentStage.success => _statusView(
            p,
            icon: Icons.check_circle_rounded,
            color: p.success,
            title: 'Payment successful',
            message: _successMessage(),
            trailing: _row([
              _primary(p, 'View receipt', () => _go(PaymentStage.receipt)),
              _textBtn('Done', () => context.pop()),
            ]),
          ),
        PaymentStage.failed => _statusView(
            p,
            icon: Icons.error_rounded,
            color: p.danger,
            title: 'Payment failed',
            // Whether the bank put a hold on the amount is something only the gateway
            // knows, so this reports the one thing this app does know: nothing was
            // confirmed here. It used to testify that the amount "was not charged".
            message:
                '${widget.amount} was not confirmed for your ${widget.serviceName}. '
                'If your bank shows this attempt as taken, contact support.',
            trailing: _row([
              _primary(p, 'Retry payment', () {
                _polling = true;
                _confirm();
              }),
              _textBtn('Change method', () => _go(PaymentStage.method)),
            ]),
          ),
        PaymentStage.pending => _statusView(
            p,
            icon: Icons.schedule_rounded,
            color: p.warning,
            title: 'Payment pending',
            // No "we will update you automatically": nothing polls this order's payment
            // session back to this screen, so the update only happens when asked for.
            message:
                'Waiting for confirmation from your bank. Check the status again in a moment.',
            spinner: _polling,
            trailing: _row([
              _primary(p, 'Check status', () async {
                setState(() => _polling = true);
                await _confirm();
              }),
              _textBtn('Back to checkout', () => context.pop()),
            ]),
          ),
        PaymentStage.receipt => _receiptView(p),
        PaymentStage.cancelled => _statusView(
            p,
            icon: Icons.cancel_rounded,
            color: p.onSurfaceMuted,
            title: 'Payment cancelled',
            message:
                'The payment was not completed. You can try again or return to '
                'checkout.',
            trailing: _row([
              _primary(p, 'Try again', () => _go(PaymentStage.method)),
              _textBtn('Return to checkout', () => context.pop()),
            ]),
          ),
      };

  String _methodLabel() => _methods.firstWhere((m) => m.kind == _method).label;

  /// An ok result from [PaymentScreen.authorize] means the order call came back
  /// accepted under this method — not that the money settled. Cash on delivery is the
  /// clearest case: the amount is collected at the door, so a receipt reading
  /// "₹160 paid via Cash on delivery" documented money that had not moved.
  String _successMessage() =>
      _method == PaymentMethodKind.cashOnDelivery
          ? 'Your ${widget.serviceName} is confirmed. The delivery person will '
              'collect ${widget.amount} in cash.'
          : '${widget.amount} confirmed for ${widget.serviceName}.';

  Widget _methodView(NabinPalette p) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _amountHeader(p),
        const SizedBox(height: 16),
        RadioGroup<PaymentMethodKind>(
          groupValue: _method,
          onChanged: (v) => setState(() => _method = v ?? _method),
          child: Column(
            children: [
              for (final m in _methods)
                RadioListTile<PaymentMethodKind>(
                  value: m.kind,
                  activeColor: p.brand,
                  title: Text(m.label,
                      style: TextStyle(
                          color: p.onSurface, fontWeight: FontWeight.w600)),
                  subtitle:
                      Text(m.sub, style: TextStyle(color: p.onSurfaceMuted)),
                ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _primary(p, 'Pay ${widget.amount}', () => _confirm()),
        TextButton(
          onPressed: () => _go(PaymentStage.cancelled),
          child:
              Text('Cancel payment', style: TextStyle(color: p.onSurfaceMuted)),
        ),
      ],
    );
  }

  Widget _amountHeader(NabinPalette p) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: p.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: p.divider),
        ),
        child: Row(
          children: [
            Icon(Icons.account_balance_wallet_rounded, color: p.brand),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(widget.serviceName,
                      style: TextStyle(color: p.onSurfaceMuted)),
                  Text(widget.amount,
                      style: TextStyle(
                          color: p.onSurface,
                          fontSize: 22,
                          fontWeight: FontWeight.w700)),
                ],
              ),
            ),
          ],
        ),
      );

  Widget _receiptView(NabinPalette p) {
    final serverRef = _serverRef;
    final rows = <(String, String)>[
      ('Service', widget.serviceName),
      // The row says which of the two ids it is holding. A backend id is evidence the
      // order call returned; `referenceId` is only the caller's own string, and an
      // unlabelled "Reference" let a local id read like a gateway confirmation.
      (
        serverRef == null
            ? 'Reference (from this order)'
            : 'Reference (returned by the order call)',
        serverRef ?? widget.referenceId
      ),
      ('Method', _methodLabel()),
      ('Amount', widget.amount),
      // 'Completed' was a settlement claim. The receipt is reached from the success
      // state, whose only evidence is an order call that came back ok — or cash on
      // delivery, where the money has not moved at all — so the row names that state.
      ('Status', 'Order confirmed'),
    ];
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ...rows.map(
          (r) => Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              color: p.surface,
              border: Border(bottom: BorderSide(color: p.divider)),
            ),
            child: Row(
              children: [
                Flexible(
                  child: Text(r.$1, style: TextStyle(color: p.onSurfaceMuted)),
                ),
                const SizedBox(width: 12),
                Flexible(
                  child: Text(r.$2,
                      textAlign: TextAlign.end,
                      style: TextStyle(
                          color: p.onSurface, fontWeight: FontWeight.w600)),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        // No 'Download receipt' — the handler was `() {}`, and no route serves a receipt
        // file. No 'Request refund' either: the only refund route is admin-scoped.
        _textBtn('Done', () => context.pop()),
      ],
    );
  }

  Widget _statusView(NabinPalette p,
      {required IconData icon,
      required Color color,
      required String title,
      required String message,
      bool spinner = false,
      Widget? trailing}) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            spinner
                ? SizedBox(
                    width: 64,
                    height: 64,
                    child:
                        CircularProgressIndicator(color: color, strokeWidth: 4),
                  )
                : Icon(icon, size: 64, color: color),
            const SizedBox(height: 20),
            Text(title,
                textAlign: TextAlign.center,
                style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    color: p.onSurface)),
            const SizedBox(height: 8),
            Text(message,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 15, color: p.onSurfaceMuted)),
            if (trailing != null) ...[const SizedBox(height: 24), trailing],
          ],
        ),
      ),
    );
  }

  Widget _row(List<Widget> children) =>
      Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        children.first,
        for (final extra in children.skip(1))
          Padding(padding: const EdgeInsets.only(top: 8), child: extra),
      ]);

  Widget _primary(NabinPalette p, String label, VoidCallback onTap) => SizedBox(
        height: 52,
        child: FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: p.brand,
            foregroundColor: p.onBrand,
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
          onPressed: onTap,
          child: Text(label,
              style:
                  const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
        ),
      );

  Widget _textBtn(String label, VoidCallback onTap) => TextButton(
        onPressed: onTap,
        child: Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
      );
}
