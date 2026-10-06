import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/features/payment/presentation/screens/payment_screen.dart';

// The payment lifecycle in this screen is real — it defers the terminal state to a
// caller-supplied backend call instead of a timer — but its method list and its copy were
// invented: 'NABIN Wallet — Balance ₹1,250', 'UPI · Google Pay — nabin.user@okhdfcbank',
// 'Card · Visa •••• 4291 — Expires 09/27', a refund stage that minted its own reference
// ('Refund NAB-RF · …') and SLA ('3–5 working days'), a 'Download receipt' button wired to
// `() {}`, and a failure message that testified '${amount} was not charged'.
//
// What the backend actually knows: checkouts.payment_method is constrained to
// CASH | WALLET | RAZORPAY | EXTERNAL_GATEWAY (013_checkout_domain.sql), so every one of
// those strings is *recordable* — but the customer payment routes are create-order /
// verify-checkout / session/:orderId, and none of them returns a saved instrument, a
// refund id or a receipt file, and none debits a wallet balance. The only refund route
// is admin-scoped POST /api/admin/finance/refund. So the screen may name the *kind* of
// payment it can actually take money under, and nothing more specific than that: WALLET
// is recordable but not spendable, so the "offers only the kinds a checkout can actually
// be recorded under" test forbids that tile as well.

Future<void> pump(WidgetTester tester, {PaymentStage? stage, Future<PaymentOutcome> Function()? authorize}) async {
  await tester.pumpWidget(MaterialApp(
    home: PaymentScreen(
      // A second pump() in the same test would otherwise reuse the live State — the
      // screen holds its stage in a `late` field seeded from `startStage`, so the new
      // startStage would be ignored and the old stage would still be on screen.
      key: UniqueKey(),
      amount: '₹160',
      serviceName: 'Food order',
      referenceId: 'NAB-TEST-1',
      startStage: stage ?? PaymentStage.method,
      authorize: authorize,
    ),
  ));
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

void main() {
  group('method list', () {
    testWidgets('offers only the kinds a checkout can actually be recorded under',
        (tester) async {
      await pump(tester);

      for (final String kind in <String>['UPI', 'Card', 'Cash on delivery']) {
        expect(find.textContaining(kind), findsWidgets);
      }
      // 'NABIN Wallet' used to be the first tile, subtitled "Debits the balance on your
      // NABIN account". The balance is a real read (Wallet gets it from /auth/me), but no
      // route debits it: there is no wallet endpoint, `orders.payment_method` merely
      // DEFAULTs to 'WALLET' (001:162) and grocery checkout stamps 'WALLET' on any non-CASH
      // call (server.js:6989) without moving a rupee. A method that spends money nobody can
      // spend is a financial claim, so the tile is gone rather than relabelled.
      expect(find.textContaining('NABIN Wallet'), findsNothing);
      expect(find.textContaining('Debits the balance'), findsNothing);
    });

    testWidgets('names no card number, expiry, UPI id, app or wallet figure', (tester) async {
      await pump(tester);

      for (final String claim in <String>[
        '4291',
        '09/27',
        'okhdfcbank',
        'Google Pay',
        '₹1,250',
        'Visa',
      ]) {
        expect(find.textContaining(claim), findsNothing,
            reason: '$claim described an instrument no endpoint returns');
      }
    });
  });

  group('refund and receipt', () {
    testWidgets('the receipt offers no self-service refund and no dead download button', (tester) async {
      await pump(tester, stage: PaymentStage.receipt);

      expect(find.text('Request refund'), findsNothing);
      expect(find.text('Download receipt'), findsNothing);
      // What the receipt is allowed to repeat is what the caller handed it.
      expect(find.text('Food order'), findsWidgets);
      expect(find.text('NAB-TEST-1'), findsWidgets);
      expect(find.text('₹160'), findsWidgets);
      // 'Completed' testified that the money settled. The most this screen can say is
      // what its own stage is: an order call that came back ok.
      expect(find.text('Completed'), findsNothing);
      expect(find.textContaining('Order confirmed'), findsOneWidget);
    });

    testWidgets('the reference row says where the id came from', (tester) async {
      // Started straight at the receipt, so no authorize call ever ran and no backend id
      // exists: the row must label the caller's own order id as such, not present it as a
      // gateway confirmation.
      await pump(tester, stage: PaymentStage.receipt);

      expect(find.text('Reference (from this order)'), findsOneWidget);

      await pump(
        tester,
        authorize: () async => (ok: true, pending: false, reference: 'ord_backend_9'),
      );
      await tester.tap(find.text('Pay ₹160'));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }
      await tester.tap(find.text('View receipt'));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(find.text('ord_backend_9'), findsOneWidget);
      expect(find.text('Reference (returned by the order call)'), findsOneWidget);
    });

    testWidgets('no stage mints a refund reference or a settlement window', (tester) async {
      await pump(tester);

      expect(find.textContaining('NAB-RF'), findsNothing);
      expect(find.textContaining('3–5 working days'), findsNothing);
    });
  });

  group('outcomes', () {
    testWidgets('an unwired payment holds at pending instead of claiming success', (tester) async {
      await pump(tester);
      await tester.tap(find.text('Pay ₹160'));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      // The bar title repeats the stage title, so findsWithWidgets, not findsOneWidget.
      expect(find.text('Payment pending'), findsWidgets);
      expect(find.text('Payment successful'), findsNothing);
    });

    testWidgets('pending does not promise an automatic update nobody sends', (tester) async {
      await pump(tester, stage: PaymentStage.pending);

      expect(find.textContaining('update you automatically'), findsNothing);
    });

    testWidgets('failure does not testify that no charge was made', (tester) async {
      await pump(tester, stage: PaymentStage.failed);

      expect(find.textContaining('was not charged'), findsNothing);
      expect(find.textContaining('Payment failed'), findsWidgets);
    });

    testWidgets('the caller\'s backend result decides the terminal state', (tester) async {
      await pump(
        tester,
        authorize: () async => (ok: true, pending: false, reference: 'ord_backend_9'),
      );
      await tester.tap(find.text('Pay ₹160'));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(find.text('Payment successful'), findsWidgets);
    });

    testWidgets('cash on delivery resolves without a gateway', (tester) async {
      await pump(tester);
      await tester.tap(find.text('Cash on delivery'));
      await tester.pump(const Duration(milliseconds: 40));
      await tester.tap(find.text('Pay ₹160'));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(find.text('Payment successful'), findsWidgets);
      // Cash on delivery has collected nothing. "₹160 paid via Cash on delivery" was a
      // receipt for money that arrives later, if at all.
      expect(find.textContaining('paid via Cash on delivery'), findsNothing);
      expect(find.textContaining('collect ₹160 in cash'), findsOneWidget);
    });

    testWidgets('a confirmed order call is called confirmed, not paid', (tester) async {
      // `authorize` is the order call, not a settlement notice: an ok result means the
      // backend accepted the order under that method.
      await pump(
        tester,
        authorize: () async => (ok: true, pending: false, reference: 'ord_backend_9'),
      );
      await tester.tap(find.text('Pay ₹160'));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(find.textContaining('₹160 confirmed for Food order'), findsOneWidget);
      expect(find.textContaining('paid via'), findsNothing);
    });
  });

  group('phone layout', () {
    testWidgets('the method list survives 390 px without a paint failure', (tester) async {
      tester.view.physicalSize = const Size(390 * 3, 844 * 3);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await pump(tester, stage: PaymentStage.receipt);

      expect(tester.takeException(), isNull);
    });
  });
}
