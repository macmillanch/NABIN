import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/grocery/presentation/screens/grocery_app_shell.dart';
import 'package:mobile/features/grocery/presentation/screens/grocery_deals_screen.dart';
import 'package:mobile/features/grocery/presentation/widgets/grocery_product_tile.dart';

import 'support/http_stub.dart';

// The five-tab grocery shell, and the account tab it carries.
//
// IndexedStack builds all five children at once, so mounting this shell is the
// heaviest read the browsing flow performs — and the account tab is the screen
// that used to be entirely invented: 'Rahul Sharma' with a verified badge, an
// 'M3 GROCERY WALLET' holding ₹450.00 whose '+ Add Cash' button moved no money,
// two orders no store held, a saved-address tile whose handler was `() {}`, and
// an HDFC card ending 8888. This file pins what replaced it: the shell reads the
// endpoints its tabs actually use, the account tab prints only what `GET
// /auth/me` returned, and every string the removed version claimed stays removed.

Map<String, dynamic> _row({
  required String id,
  required String name,
  required String category,
  required String emoji,
  required double price,
  required double mrp,
}) =>
    <String, dynamic>{
      'id': id,
      'name': name,
      'category': category,
      'emoji': emoji,
      'currentPrice': price,
      'mrp': mrp,
      'isAvailable': true,
      'stockQty': 30,
      'unit': 'kg',
      'packSize': '1kg',
      'merchantId': 'str_test_store',
      'merchantName': 'Test Store',
    };

final List<Map<String, dynamic>> _catalogue = <Map<String, dynamic>>[
  _row(id: 'p1', name: 'Seaul Flattene rice', category: 'Staples', emoji: '🍚', price: 160, mrp: 180),
  _row(id: 'p5', name: 'Banana', category: 'Fruits', emoji: '🍌', price: 60, mrp: 80),
];

/// `user` is what this account's own read returns; `null` stands for no profile
/// served, and a map with no `walletBalance` for a field the row does not carry.
void serveShell({Map<String, dynamic>? user, bool accountFails = false}) {
  stubHandler = (method, url, _) {
    if (url.path.contains('/grocery/products')) {
      return (200, jsonEncode({'success': true, 'products': _catalogue}));
    }
    if (url.path.contains('/advertisements')) {
      return (200, '{"success":true,"advertisements":[]}');
    }
    if (url.path.contains('/auth/me')) {
      if (accountFails) {
        return (500, '{"success":false,"error":"NABIN could not read your account right now."}');
      }
      return (200, jsonEncode({'success': true, 'user': user ?? <String, dynamic>{}}));
    }
    return (200, '{"success":true}');
  };
}

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 14; i++) {
    await tester.pump(const Duration(milliseconds: 40));
  }
}

Future<void> pumpShell(
  WidgetTester tester, {
  Size logicalSize = const Size(393, 852),
}) async {
  tester.view.physicalSize = logicalSize * 3;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  appRouter.go('/');
  await tester.pumpWidget(
    ProviderScope(child: MaterialApp.router(routerConfig: appRouter)),
  );
  await settle(tester);
  stubSeen.clear();
  appRouter.go('/grocery-home');
  await settle(tester);
}

/// Tapping a destination by its label — the label is the contract, not the index.
/// Scoped to the bar because a tab word can also be a tile word on a page.
Future<void> openTab(WidgetTester tester, String label) async {
  await tester.tap(
    find.descendant(of: find.byType(NavigationBar), matching: find.text(label)),
  );
  await tester.pumpAndSettle();
  await settle(tester);
}

int selectedTab(WidgetTester tester) =>
    tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex;

/// Adds the Banana row from the Deals tab. Scoped twice — every tab is mounted at
/// once, so 'ADD' and 'Banana' each name widgets on several screens.
Future<void> addBananaFromDeals(WidgetTester tester) async {
  final Finder bananaCard = find.descendant(
    of: find.byType(GroceryDealsScreen),
    matching: find.ancestor(
      of: find.text('Banana'),
      matching: find.byType(GroceryProductTile),
    ),
  );
  await tester.tap(find.descendant(of: bananaCard, matching: find.text('ADD')));
  await settle(tester);
}

/// Every string the invented account tab used to print. None of them has a
/// source, so none of them may return.
const List<String> _removedInventions = <String>[
  'Rahul Sharma',
  '98765 43210',
  'rahul.sharma@example.com',
  'M3 GROCERY WALLET',
  '₹450.00',
  '+ Add Cash',
  'Added ₹500 to Grocery Wallet!',
  'M3-882910',
  'Delivered in 8 mins',
  'Civil Lines',
  'Connaught Place',
  'HDFC',
  '**** 8888',
  'Saved Payment Methods',
  'Saved Delivery Addresses',
  '24/7',
];

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    serveShell(user: <String, dynamic>{
      'id': 'usr_test',
      'name': 'Lalthanmangi Ralte',
      'phone': '+91 98622 11223',
      'walletBalance': 240.5,
    });
    SessionManager.instance.saveSession(
      token: 'test-token',
      user: <String, dynamic>{'id': 'usr_test', 'name': 'Lalthanmangi Ralte'},
    );
  });

  tearDown(() {
    HttpOverrides.global = null;
    SessionManager.instance.clearSession();
  });

  testWidgets('the shell offers the five tabs and no sixth', (WidgetTester tester) async {
    await pumpShell(tester);

    final NavigationBar bar = tester.widget<NavigationBar>(find.byType(NavigationBar));
    expect(
      bar.destinations
          .cast<NavigationDestination>()
          .map((NavigationDestination d) => d.label)
          .toList(),
      <String>['Home', 'Categories', 'Deals', 'Cart', 'Account'],
    );
    expect(selectedTab(tester), 0);
    expect(find.byType(GroceryAppShell), findsOneWidget);
  });

  testWidgets('mounting the shell reads only endpoints that exist',
      (WidgetTester tester) async {
    await pumpShell(tester);

    final List<String> paths = stubSeen
        .map((String s) => s.split(' ').last)
        .toList();
    // The catalogue, the filtered list, the promo slot, and this account.
    expect(paths.where((String p) => p.contains('/grocery/products')).length, 2,
        reason: 'one catalogue read and one list read — not one per tab: $paths');
    expect(stubSaw('GET', '/advertisements'), isTrue);
    expect(stubSaw('GET', '/auth/me'), isTrue);
    // Nothing was asked for that the backend has no route for.
    expect(
      paths.any((String p) =>
          p.contains('/grocery/orders') ||
          p.contains('/grocery/address') ||
          p.contains('/grocery/wallet') ||
          p.contains('/grocery/payment-method')),
      isFalse,
      reason: 'those routes do not exist: $paths',
    );
  });

  testWidgets('switching tabs reveals the tab without re-reading it',
      (WidgetTester tester) async {
    await pumpShell(tester);
    final int mark = stubSeen.length;

    await openTab(tester, 'Deals');
    expect(selectedTab(tester), 2);
    await openTab(tester, 'Cart');
    expect(selectedTab(tester), 3);
    await openTab(tester, 'Account');
    expect(selectedTab(tester), 4);

    expect(stubSeen.length, mark, reason: 'a tab switch is not a refresh');
  });

  testWidgets('adding from the deals tab names the cart it went into',
      (WidgetTester tester) async {
    await pumpShell(tester);
    await openTab(tester, 'Deals');
    await addBananaFromDeals(tester);

    expect(find.text('Added "Banana" to Grocery Cart!'), findsOneWidget);
    expect(find.text('1 item in basket'), findsWidgets);
  });

  testWidgets('the account tab prints the profile its own read returned',
      (WidgetTester tester) async {
    await pumpShell(tester);
    await openTab(tester, 'Account');

    expect(find.text('Grocery Account'), findsOneWidget);
    expect(find.text('Lalthanmangi Ralte'), findsWidgets);
    expect(find.text('+91 98622 11223'), findsOneWidget);
    // The balance is the number /auth/me carried, formatted, not a sample.
    expect(find.text('NABIN WALLET'), findsOneWidget);
    expect(find.text('₹240.50'), findsOneWidget);
    // And the things NABIN does not keep are stated as absent.
    expect(
      find.textContaining('NABIN does not keep a saved-address book or saved cards'),
      findsOneWidget,
    );
  });

  testWidgets('none of the invented account returns', (WidgetTester tester) async {
    await pumpShell(tester);
    await openTab(tester, 'Account');

    for (final String ghost in _removedInventions) {
      expect(find.textContaining(ghost), findsNothing, reason: '$ghost has no source');
    }
    // No verified badge, no order rows, no wallet top-up button.
    expect(find.byIcon(Icons.verified_rounded), findsNothing);
    expect(find.textContaining('Your orders'), findsNothing);
  });

  testWidgets('a balance the read did not carry is not zero', (WidgetTester tester) async {
    serveShell(user: <String, dynamic>{'id': 'usr_test', 'name': 'Lalthanmangi Ralte'});
    await pumpShell(tester);
    await openTab(tester, 'Account');

    expect(find.text('Not readable'), findsOneWidget);
    expect(find.text('₹0.00'), findsNothing);
    // A profile with no phone says that, rather than inventing one.
    expect(find.text('NABIN gave no phone number with this account'), findsOneWidget);
  });

  testWidgets('an account that could not be read is a retry, not a sample profile',
      (WidgetTester tester) async {
    serveShell(accountFails: true);
    await pumpShell(tester);
    await openTab(tester, 'Account');

    expect(find.text('NABIN did not answer'), findsOneWidget);
    expect(find.text('NABIN could not read your account right now.'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    expect(
      find.textContaining('Nothing on this page is filled in from a sample account'),
      findsOneWidget,
    );
    // Unreadable means nothing personal is printed, not even a placeholder name.
    expect(find.text('No name on this account'), findsNothing);
    expect(find.text('₹0.00'), findsNothing);
  });

  testWidgets('the cart tab is honest about an empty basket', (WidgetTester tester) async {
    await pumpShell(tester);
    await openTab(tester, 'Cart');

    expect(find.text('Your grocery basket'), findsOneWidget);
    expect(find.text('Nothing selected yet'), findsOneWidget);
    expect(find.text('Your grocery basket is empty'), findsOneWidget);
    expect(
      find.text('Browse the aisles and add what you need — prices come straight from the store.'),
      findsOneWidget,
    );
    // Nothing in it, so nothing to clear, re-check or total.
    expect(find.text('Browse products'), findsOneWidget);
    expect(find.byTooltip('Empty basket'), findsNothing);
    expect(find.byTooltip('Re-check prices with the store'), findsNothing);
    expect(find.textContaining('item(s) •'), findsNothing);
    expect(find.textContaining('Delivered in'), findsNothing);
  });

  testWidgets('a filled basket quotes the store for what it cannot know',
      (WidgetTester tester) async {
    await pumpShell(tester);
    await openTab(tester, 'Deals');
    await addBananaFromDeals(tester);
    await openTab(tester, 'Cart');

    expect(find.text('1 item(s) • ₹60'), findsOneWidget);
    expect(find.text('Basket items'), findsOneWidget);
    expect(find.text('Bill summary'), findsOneWidget);
    expect(find.text('Items subtotal'), findsOneWidget);
    // The three numbers a real grocery checkout cannot answer for are named as
    // the store's, not guessed at.
    expect(find.text('Delivery fee'), findsOneWidget);
    expect(find.text('Set by the store'), findsOneWidget);
    expect(find.text('Platform coupon'), findsOneWidget);
    expect(find.text('Checked at checkout'), findsOneWidget);
    // And the address line says what NABIN does not have.
    expect(find.text('Delivery address'), findsOneWidget);
    expect(
      find.text('Typed at checkout — saved addresses are not available for grocery yet.'),
      findsOneWidget,
    );
    for (final String code in <String>['M3FRESH', 'M3SUPER50', 'NABINFIRST50', 'WELCOME50']) {
      expect(find.textContaining(code), findsNothing, reason: '$code is not product truth');
    }
  });

  testWidgets('the shell holds at phone and tablet widths across every tab',
      (WidgetTester tester) async {
    // IndexedStack lays all five tabs out at once, so this walks the whole
    // surface: a row that cannot fit appears whether or not its tab is showing.
    for (final Size size in <Size>[const Size(393, 852), const Size(834, 1112)]) {
      await pumpShell(tester, logicalSize: size);
      for (final String label in <String>['Home', 'Categories', 'Deals', 'Cart', 'Account']) {
        await openTab(tester, label);
        expect(
          tester.takeException(),
          isNull,
          reason: 'overflow on the $label tab at ${size.width}px wide',
        );
      }
      expect(selectedTab(tester), 4);
      expect(find.byType(GroceryAppShell), findsOneWidget);
    }
  });
}
