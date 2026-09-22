import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:mobile/core/config/nabin_app_config.dart';
import 'package:mobile/core/theme/nabin_palette.dart';

// Reused rather than copied: `configBody` is the published contract and
// `pumpHome` is the real screen these assertions have to be made against.
import 'remote_config_test.dart' as feed;
import 'customer_home_config_test.dart' as home;

/// A campaign row in the shape `sections.campaigns` actually publishes.
///
/// The windows are fixed instants around the fixture's `serverTime`
/// (2026-09-21T12:00Z), so "live" and "over" are properties of the payload
/// rather than of the wall clock the test happens to run under.
Map<String, dynamic> campaign(
  String code, {
  String name = 'Christmas 2026',
  int priority = 100,
  List<String> serviceTypes = const <String>[],
  String startsAt = '2026-09-21T11:00:00.000Z',
  String endsAt = '2026-09-21T13:00:00.000Z',
  Map<String, dynamic> palette = const <String, dynamic>{},
  Object? logoUrl,
  Object? wordmarkUrl,
  Object? splashUrl,
  List<Map<String, dynamic>> banners = const <Map<String, dynamic>>[],
  List<Map<String, dynamic>> offers = const <Map<String, dynamic>>[],
  List<Map<String, dynamic>> messages = const <Map<String, dynamic>>[],
}) {
  return <String, dynamic>{
    'id': 'campaign-$code',
    'code': code,
    'name': name,
    'priority': priority,
    'serviceTypes': serviceTypes,
    'startsAt': startsAt,
    'endsAt': endsAt,
    'theme': palette.isEmpty && logoUrl == null && wordmarkUrl == null && splashUrl == null
        ? null
        : <String, dynamic>{
            'palette': palette,
            'logoUrl': logoUrl,
            'wordmarkUrl': wordmarkUrl,
            'splashUrl': splashUrl,
          },
    'banners': banners,
    'offers': offers,
    'messages': messages,
  };
}

Map<String, dynamic> banner(String url, {String kind = 'BANNER', String? altText, String? locale}) {
  return <String, dynamic>{
    'kind': kind,
    'url': url,
    'altText': altText,
    'locale': locale,
    'priority': 0,
  };
}

Map<String, dynamic> offer(
  String serviceType, {
  String? copy,
  String? couponCode,
  String? discountType,
  num? discountValue,
}) {
  return <String, dynamic>{
    'serviceType': serviceType,
    'copy': copy,
    'couponCode': couponCode,
    'discountType': discountType,
    'discountValue': discountValue,
  };
}

Map<String, dynamic> message(
  String kind, {
  String? title,
  String? body,
  String? surface,
  String? triggerEvent,
  bool dismissible = true,
  bool showOnce = false,
  String? locale,
}) {
  return <String, dynamic>{
    'kind': kind,
    'title': title,
    'body': body,
    'surface': surface,
    'triggerEvent': triggerEvent,
    'dismissible': dismissible,
    'showOnce': showOnce,
    'locale': locale,
    'priority': 0,
  };
}

NabinAppConfig parsed(
  List<Map<String, dynamic>> campaigns, {
  Map<String, dynamic> tokens = const <String, dynamic>{},
}) {
  return NabinAppConfig.fromJson(
    feed.configBody(campaigns: campaigns, tokens: tokens),
    source: NabinConfigSource.remote,
    // Stamped with this instant, the way the repository stamps a live answer, so
    // `serverNowUtc` sits at the fixture's server time and the windows below are
    // properties of the payload rather than of when the test runs.
    fetchedAt: DateTime.now().toUtc(),
  );
}

/// A campaign palette the fixture can also paint with: `#0B3D91` reads as
/// `Color(0xFF0B3D91)`.
const Color _pine = Color(0xFF0B3D91);
const Color _candy = Color(0xFFB71C1C);

void main() {
  setUp(() {
    // Popup memory is best-effort on-device storage. Mocking it keeps the
    // assertions about what the campaign published, not about a missing plugin.
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  group('campaign parsing', () {
    test('a live campaign overrides the published theme', () {
      final config = parsed(
        <Map<String, dynamic>>[
          campaign('XMAS-2026', palette: <String, dynamic>{'brand': '#0B3D91'}),
        ],
        tokens: <String, dynamic>{'brand': '#B71C1C', 'canvas': '#FAFAFA'},
      );

      expect(config.theme['brand'], _candy, reason: 'the platform theme is still published');
      expect(config.effectiveTheme['brand'], _pine);
      expect(config.effectiveTheme['canvas'], const Color(0xFFFAFAFA));
      expect(config.themeCampaignName, 'Christmas 2026');
      expect(config.hasRemoteTheme, isTrue);
    });

    test('campaign colours are validated, and offenders are named', () {
      final config = parsed(
        <Map<String, dynamic>>[
          campaign(
            'BAD-TOKENS',
            palette: <String, dynamic>{
              'brand': '#0B3D91',
              'festivalGlow': '#0B3D91',
              'canvas': 'not-a-colour',
            },
          ),
        ],
      );

      expect(config.effectiveTheme['brand'], _pine);
      expect(config.effectiveTheme.containsKey('festivalGlow'), isFalse);
      expect(config.effectiveTheme.containsKey('canvas'), isFalse);
      expect(
        config.rejected,
        containsAll(<String>[
          'campaign.BAD-TOKENS.theme.festivalGlow(unknown token)',
          'campaign.BAD-TOKENS.theme.canvas(not-a-colour)',
        ]),
      );
    });

    test('a creative that is not an http(s) URL never reaches an image widget', () {
      final config = parsed(
        <Map<String, dynamic>>[
          campaign(
            'BAD-URLS',
            wordmarkUrl: 'javascript:alert(1)',
            banners: <Map<String, dynamic>>[
              banner('file:///C:/Windows/win.ini'),
              banner('https://cdn.example.test/christmas.png', altText: 'Christmas banner'),
              banner('/relative/only.png'),
            ],
          ),
        ],
      );

      final live = config.campaignFor(null)!;
      expect(live.theme.wordmarkUrl, isNull);
      expect(live.creatives.map((creative) => creative.url), <String>[
        'https://cdn.example.test/christmas.png',
      ]);
      expect(live.creatives.single.altText, 'Christmas banner');
      expect(config.rejected, containsAll(<String>[
        'campaign.BAD-URLS.wordmarkUrl(javascript)',
        'campaign.BAD-URLS.banner(file)',
        'campaign.BAD-URLS.banner(no scheme)',
      ]));
    });

    test('the server clock decides whether a listed campaign is live', () {
      // The publication resolved against PostgreSQL's clock when it was built; a
      // cached copy must not keep selling a festival that has ended, and a wrong
      // device date must not extend one.
      final ended = parsed(
        <Map<String, dynamic>>[
          campaign('OVER', endsAt: '2026-09-21T11:30:00.000Z'),
        ],
      );
      final upcoming = parsed(
        <Map<String, dynamic>>[
          campaign('NEXT', startsAt: '2026-09-22T11:00:00.000Z'),
        ],
      );
      final running = parsed(
        <Map<String, dynamic>>[campaign('RUNNING')],
      );

      expect(ended.campaignFor(null), isNull);
      expect(upcoming.campaignFor(null), isNull);
      expect(running.campaignFor(null)!.code, 'RUNNING');
    });

    test('priority order is kept and service targeting decides who wins', () {
      final config = parsed(
        <Map<String, dynamic>>[
          campaign('DIWALI', priority: 200, serviceTypes: <String>['FOOD']),
          campaign('PLATFORM-WIDE', priority: 50),
        ],
      );

      expect(config.campaignFor('RIDE')!.code, 'PLATFORM-WIDE');
      expect(config.campaignFor('FOOD')!.code, 'DIWALI');
      // The look is platform-wide: the highest-priority campaign that published
      // colours owns it, whichever services its discounts target.
      expect(config.themeCampaign, isNull, reason: 'neither published a palette');
    });

    test('an offer says what the coupon says, in the customer units', () {
      final config = parsed(
        <Map<String, dynamic>>[
          campaign(
            'OFFERS',
            offers: <Map<String, dynamic>>[
              offer('RIDE', discountType: 'PERCENTAGE', discountValue: 10),
              offer('PARCEL', discountType: 'FLAT', discountValue: 30),
              offer('FOOD', discountType: 'MYSTERY', discountValue: 5),
              offer('GROCERY', copy: 'Festival groceries, less', couponCode: 'XMAS10'),
              <String, dynamic>{'copy': 'no service named'},
            ],
          ),
        ],
      );

      final live = config.campaignFor('RIDE')!;
      expect(live.offerFor('RIDE')!.savingsText, '10% OFF');
      expect(live.offerFor('PARCEL')!.savingsText, '₹30 OFF');
      expect(live.offerFor('FOOD')!.savingsText, isNull, reason: 'unknown discount grammar');
      expect(live.offerFor('GROCERY')!.hasCoupon, isTrue);
      expect(live.offers.length, 4);
      expect(config.rejected, contains('campaign.OFFERS.offer(missing serviceType)'));
    });

    test('a degraded campaign section is labelled and changes nothing', () {
      final config = NabinAppConfig.fromJson(
        feed.configBody(campaignsDegraded: true),
        source: NabinConfigSource.remote,
        fetchedAt: DateTime.utc(2026, 9, 21, 12),
      );

      expect(config.campaigns, isEmpty);
      expect(config.campaignsDegraded, isTrue);
      expect(config.liveCampaigns, isEmpty);
    });
  });

  group('palette rendering from a campaign', () {
    test('the winning campaign is named on the palette that paints', () {
      final config = parsed(
        <Map<String, dynamic>>[
          campaign('XMAS', palette: <String, dynamic>{'brand': '#0B3D91'}),
        ],
      );
      final palette = NabinPalette.from(config);

      expect(palette.brand, _pine);
      expect(palette.isRemote, isTrue);
      expect(palette.campaignName, 'Christmas 2026');
      expect(palette.publishedTokens, contains('brand'));
    });

    test('a campaign with no colours leaves the published theme alone', () {
      final config = parsed(
        <Map<String, dynamic>>[campaign('NO-LOOK')],
        tokens: <String, dynamic>{'brand': '#B71C1C'},
      );

      expect(NabinPalette.from(config).brand, _candy);
      expect(NabinPalette.from(config).campaignName, isNull);
    });
  });

  group('the customer home follows the campaign', () {
    Future<void> pump(WidgetTester tester, List<Map<String, dynamic>> campaigns) async {
      await home.pumpHome(
        tester,
        body: feed.configBody(campaigns: campaigns),
      );
      await tester.pump();
    }

    /// Let the async paths a campaign uses settle — the storage read behind a
    /// popup, the failed image fetch behind a wordmark — without asserting on
    /// how many frames each one happens to take.
    Future<void> settle(WidgetTester tester, Finder finder) async {
      for (var attempt = 0; attempt < 8 && finder.evaluate().isEmpty; attempt++) {
        await tester.pump(const Duration(milliseconds: 25));
      }
    }

    testWidgets('a live campaign paints its creatives, discounts and copy', (tester) async {
      await pump(
        tester,
        <Map<String, dynamic>>[
          campaign(
            'XMAS-HOME',
            banners: <Map<String, dynamic>>[
              banner('https://cdn.example.test/christmas-banner.png'),
            ],
            offers: <Map<String, dynamic>>[
              offer('RIDE', discountType: 'PERCENTAGE', discountValue: 10, couponCode: 'XMASRIDE'),
            ],
            messages: <Map<String, dynamic>>[
              message('ANNOUNCEMENT',
                  title: 'Merry NABIN', body: 'Festive fares all week.', surface: 'CUSTOMER_HOME'),
            ],
          ),
        ],
      );

      expect(find.text('Merry NABIN'), findsOneWidget);
      expect(find.text('Festive fares all week.'), findsOneWidget);
      // The campaign names its own creative: it is not tagged as a promoted ad.
      expect(find.text('Christmas 2026'), findsWidgets);
      expect(find.text('Promoted'), findsNothing);
      expect(find.textContaining('10% OFF'), findsOneWidget);
      expect(find.text('XMASRIDE'), findsOneWidget);
    });

    testWidgets('a campaign outside its window leaves the home as it was', (tester) async {
      await pump(
        tester,
        <Map<String, dynamic>>[
          campaign(
            'XMAS-OVER',
            endsAt: '2026-09-21T11:30:00.000Z',
            banners: <Map<String, dynamic>>[
              banner('https://cdn.example.test/christmas-banner.png'),
            ],
            messages: <Map<String, dynamic>>[
              message('ANNOUNCEMENT', title: 'Merry NABIN', surface: 'CUSTOMER_HOME'),
            ],
          ),
        ],
      );

      expect(find.text('Merry NABIN'), findsNothing);
      expect(find.text('Christmas 2026'), findsNothing);
      // The screen itself is unaffected: an ended campaign is not a broken app.
      expect(find.text('Our Services'), findsOneWidget);
    });

    testWidgets('copy written for checkout stays off the home surface', (tester) async {
      await pump(
        tester,
        <Map<String, dynamic>>[
          campaign(
            'CHECKOUT-ONLY',
            messages: <Map<String, dynamic>>[
              message('ANNOUNCEMENT', title: 'Apply XMAS at checkout', surface: 'CHECKOUT'),
              message('POPUP', title: 'Only after a trip', triggerEvent: 'POST_TRIP'),
            ],
          ),
        ],
      );

      expect(find.text('Apply XMAS at checkout'), findsNothing);
      expect(find.text('Only after a trip'), findsNothing);
    });

    testWidgets('a popup campaign asks once and remembers the answer', (tester) async {
      await pump(
        tester,
        <Map<String, dynamic>>[
          campaign(
            'XMAS-POPUP',
            messages: <Map<String, dynamic>>[
              message('POPUP',
                  title: 'Christmas is here',
                  body: 'Flat fares all week.',
                  surface: 'CUSTOMER_HOME',
                  triggerEvent: 'APP_OPEN'),
            ],
          ),
        ],
      );

      await settle(tester, find.text('Christmas is here'));
      expect(find.text('Christmas is here'), findsOneWidget);
      expect(find.text('Flat fares all week.'), findsOneWidget);

      await tester.tap(find.text('Maybe later'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('Christmas is here'), findsNothing);
    });

    testWidgets('the festival logo replaces the built-in wordmark', (tester) async {
      await pump(
        tester,
        <Map<String, dynamic>>[
          campaign('XMAS-LOGO', wordmarkUrl: 'https://cdn.example.test/christmas-wordmark.png'),
        ],
      );
      // The test HTTP client fails every image request, which is the path that
      // proves the widget committed to the campaign rather than to the fallback.
      await settle(tester, find.byIcon(Icons.image_not_supported_outlined));

      expect(find.text('NABIN'), findsNothing);
      expect(find.byIcon(Icons.image_not_supported_outlined), findsOneWidget);
    });

    testWidgets('a campaign that published no logo keeps the built-in wordmark',
        (tester) async {
      await pump(
        tester,
        <Map<String, dynamic>>[
          campaign(
            'XMAS-NOLOGO',
            messages: <Map<String, dynamic>>[
              message('ANNOUNCEMENT', title: 'Festive fares', surface: 'CUSTOMER_HOME'),
            ],
          ),
        ],
      );

      expect(find.text('NABIN'), findsOneWidget);
      expect(find.text('Festive fares'), findsOneWidget);
    });
  });
}
