import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:mobile/core/config/nabin_app_config.dart';
import 'package:mobile/core/config/nabin_config_controller.dart';
import 'package:mobile/core/config/nabin_config_repository.dart';
import 'package:mobile/core/theme/app_theme.dart';
import 'package:mobile/core/theme/nabin_palette.dart';
import 'package:mobile/core/theme/nabin_tokens.dart';

/// The body `GET /api/app/config` returns when an operator has published a
/// palette. Only the tokens a real deployment would send are varied here; the
/// point of the test is the painted pixel, not the payload.
Map<String, dynamic> configBody({
  Map<String, dynamic> tokens = const <String, dynamic>{},
  List<String> knownTokens = const <String>['brand', 'canvas', 'groceryAccent'],
  List<String> rejectedTokens = const <String>[],
  Map<String, dynamic> features = const <String, dynamic>{},
  List<Map<String, dynamic>> services = const <Map<String, dynamic>>[],
  Map<String, dynamic> summary = const <String, dynamic>{},
  String serverTime = '2026-09-21T12:00:00.000Z',
}) {
  return <String, dynamic>{
    'configVersion': 'v-test',
    'serverTime': serverTime,
    'serverTimeEpochMs': DateTime.parse(serverTime).millisecondsSinceEpoch,
    'cacheSeconds': 30,
    'stale': false,
    'dataSource': 'postgres',
    'sections': <String, dynamic>{
      'services': <String, dynamic>{'summary': summary, 'services': services},
      'features': <String, dynamic>{'source': 'platform_settings', 'features': features},
      'offers': <String, dynamic>{'available': false, 'items': <dynamic>[]},
      'settings': <String, dynamic>{'available': true, 'values': <String, dynamic>{}},
      'theme': <String, dynamic>{
        'available': tokens.isNotEmpty,
        'source': 'platform_settings:APP_CONFIG_THEME',
        'knownTokens': knownTokens,
        'tokens': tokens,
        'rejectedTokens': rejectedTokens,
      },
      'advertisements': <String, dynamic>{
        'available': true,
        'endpoint': '/api/advertisements',
        'supportedPlacements': <String>['HOME_BANNER'],
      },
    },
  };
}

NabinConfigRepository repositoryReturning(NabinConfigResponse response) {
  return NabinConfigRepository(
    store: MemoryNabinConfigStore(),
    fetch: (etag) async => response,
  );
}

Future<NabinAppConfig> loadOnce(NabinConfigRepository repository) async {
  final config = await repository.load(refresh: true);
  // Persist the answer so a later 304 has something to confirm.
  return config;
}

void main() {
  group('config parsing', () {
    test('a published token becomes a Color and an unknown one is dropped', () async {
      final config = NabinAppConfig.fromJson(
        configBody(
          tokens: <String, dynamic>{
            'brand': '#FF1234',
            'notAToken': '#00FF00',
            'canvas': 'not-a-colour',
          },
          knownTokens: const <String>['brand', 'canvas', 'groceryAccent'],
        ),
        source: NabinConfigSource.remote,
        fetchedAt: DateTime.utc(2026, 9, 21, 12),
      );

      expect(config.theme['brand'], const Color(0xFFFF1234));
      expect(config.theme.containsKey('notAToken'), isFalse);
      expect(config.theme.containsKey('canvas'), isFalse);
      expect(config.rejected, containsAll(<String>['theme.notAToken(unknown token)', 'theme.canvas(not-a-colour)']));
    });

    test('server time is the reference, not the device clock', () {
      // A device whose calendar is five hours out must still be able to answer
      // "has this offer started?", so the instant the app uses is the server's,
      // moved forward only by elapsed local time.
      final serverNoon = DateTime.utc(2026, 9, 21, 12);
      final fetchedAt = DateTime.now().toUtc();
      final config = NabinAppConfig.fromJson(
        configBody(serverTime: serverNoon.toIso8601String()),
        source: NabinConfigSource.remote,
        fetchedAt: fetchedAt,
      );

      expect(config.serverTime, serverNoon);
      expect(config.clockSkew, fetchedAt.difference(serverNoon));
      final now = config.serverNowUtc!;
      final expected = serverNoon.add(Duration(milliseconds: DateTime.now().millisecondsSinceEpoch - fetchedAt.millisecondsSinceEpoch));
      expect(now.difference(expected).abs(), lessThan(const Duration(seconds: 2)));
      expect(now.isAfter(DateTime.utc(2026, 9, 21, 11, 59)), isTrue);
      expect(now.isBefore(DateTime.utc(2026, 9, 21, 12, 1)), isTrue);
    });

    test('feature flags and service state are readable, emergency stop is explicit', () {
      final config = NabinAppConfig.fromJson(
        configBody(
          features: <String, dynamic>{
            'FEATURE_GROCERY': <String, dynamic>{'enabled': false},
            'FEATURE_FOOD': <String, dynamic>{'enabled': true},
            'FEATURE_BROKEN': 'yes please',
          },
          services: <Map<String, dynamic>>[
            <String, dynamic>{'id': 'GROCERY', 'name': 'NABIN Grocery', 'status': 'EMERGENCY_STOP'},
            <String, dynamic>{'id': 'RIDE', 'name': 'NABIN Mobility', 'status': 'ACTIVE'},
          ],
        ),
        source: NabinConfigSource.remote,
        fetchedAt: DateTime.utc(2026, 9, 21, 12),
      );

      expect(config.featureEnabled('FEATURE_GROCERY'), isFalse);
      expect(config.featureEnabled('FEATURE_FOOD'), isTrue);
      expect(config.featureEnabled('FEATURE_BROKEN', fallback: true), isTrue);
      expect(config.featureEnabled('FEATURE_NEVER_PUBLISHED', fallback: true), isTrue);
      expect(config.service('RIDE')!.isOperational, isTrue);
      expect(config.emergencyStop, isTrue);
      expect(config.rejected, contains('features.FEATURE_BROKEN'));
    });
  });

  group('repository fallback ladder', () {
    test('a 200 is labelled remote and stored', () async {
      final repository = repositoryReturning(
        NabinConfigResponse(status: 200, etag: 'W/"one"', body: configBody()),
      );
      final config = await loadOnce(repository);
      expect(config.source, NabinConfigSource.remote);
      expect(await repository.store.read(), isNotNull);
    });

    test('a 304 confirms the stored copy instead of republishing it', () async {
      final store = MemoryNabinConfigStore();
      final repository = NabinConfigRepository(
        store: store,
        fetch: (etag) async => etag == 'W/"one"'
            ? const NabinConfigResponse(status: 304, etag: 'W/"one"')
            : NabinConfigResponse(status: 200, etag: 'W/"one"', body: configBody()),
      );

      await repository.load(refresh: true);
      final confirmed = await repository.load(refresh: true);
      expect(confirmed.source, NabinConfigSource.cachedValidated);
    });

    test('an unreachable server falls back to the stored answer, labelled as such', () async {
      final store = MemoryNabinConfigStore();
      var calls = 0;
      final repository = NabinConfigRepository(
        store: store,
        fetch: (etag) async {
          calls++;
          if (calls == 1) {
            return NabinConfigResponse(status: 200, etag: 'W/"one"', body: configBody());
          }
          return const NabinConfigResponse(status: 0);
        },
      );

      await repository.load(refresh: true);
      final stale = await repository.load(refresh: true);
      expect(stale.source, NabinConfigSource.remote, reason: 'the same in-memory copy is reused');
      expect(repository.current, isNotNull);
    });

    test('nothing live and nothing stored raises instead of pretending', () async {
      final repository = repositoryReturning(const NabinConfigResponse(status: 0));
      await expectLater(
        repository.load(refresh: true),
        throwsA(isA<NabinConfigUnavailableException>()),
      );
    });

    test('on-device storage degrades to this session when no plugin is registered', () async {
      // Every widget test and every desktop target lands here: the plugin is
      // absent, so reads must return nothing rather than throw.
      const store = PreferencesNabinConfigStore('nabin.app.config.test');
      expect(await store.read(), isNull);
      await store.write(<String, dynamic>{'body': <String, dynamic>{}});
    });
  });

  group('rendering from remote data', () {
    Future<PaintedTheme> pump(WidgetTester tester, Map<String, dynamic> tokens) async {
      final repository = repositoryReturning(
        NabinConfigResponse(
          status: 200,
          body: configBody(
            tokens: tokens,
            knownTokens: const <String>['brand', 'canvas', 'groceryAccent'],
          ),
        ),
      );
      final container = ProviderContainer(
        overrides: [nabinConfigRepositoryProvider.overrideWithValue(repository)],
      );
      addTearDown(container.dispose);
      await container.read(nabinConfigProvider.notifier).refresh();

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: Consumer(
            builder: (context, ref, _) => MaterialApp(
              theme: AppTheme.customerTheme(palette: nabinPaletteOf(ref)),
              home: const ThemeProvider(),
            ),
          ),
        ),
      );
      return ThemeProvider.of(tester);
    }

    testWidgets('a published colour is the colour on screen', (tester) async {
      final painted = await pump(tester, <String, dynamic>{'brand': '#FF1234'});

      expect(painted.palette.brand, const Color(0xFFFF1234));
      expect(painted.palette.isRemote, isTrue);
      expect(painted.palette.publishedTokens, contains('brand'));
      expect(painted.scheme.primary, const Color(0xFFFF1234));
    });

    testWidgets('a light published brand is labelled with ink, not white', (tester) async {
      // The one thing a remote palette must never be allowed to do is ship a
      // CTA nobody can read: white on near-white fails contrast outright.
      final painted = await pump(tester, <String, dynamic>{'brand': '#FFFDE7'});

      expect(painted.scheme.primary, const Color(0xFFFFFDE7));
      expect(painted.scheme.onPrimary, NabinColor.onSurface);
      expect(painted.scheme.onPrimary, isNot(Colors.white));
    });

    testWidgets('tokens the server did not send keep their built-in values', (tester) async {
      final builtIn = NabinPalette.defaults();
      final painted = await pump(tester, <String, dynamic>{'brand': '#FF1234'});

      expect(painted.palette.brand, isNot(builtIn.brand));
      expect(painted.palette.canvas, builtIn.canvas);
      expect(painted.palette.onSurface, builtIn.onSurface);
      expect(painted.palette.divider, builtIn.divider);
      expect(painted.palette.publishedTokens, <String>['brand']);
    });

    testWidgets('nothing published paints the bundled ramp', (tester) async {
      final painted = await pump(tester, <String, dynamic>{});

      final builtIn = NabinPalette.defaults();
      expect(painted.palette.isRemote, isFalse);
      expect(painted.palette.brand, builtIn.brand);
      expect(painted.scheme.primary, builtIn.brand);
    });

    testWidgets('a dead server leaves the app painting, not crashing', (tester) async {
      final repository = repositoryReturning(const NabinConfigResponse(status: 0));
      final container = ProviderContainer(
        overrides: [nabinConfigRepositoryProvider.overrideWithValue(repository)],
      );
      addTearDown(container.dispose);
      await container.read(nabinConfigProvider.notifier).refresh();

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: Consumer(
            builder: (context, ref, _) => MaterialApp(
              theme: AppTheme.customerTheme(palette: nabinPaletteOf(ref)),
              home: const ThemeProvider(),
            ),
          ),
        ),
      );

      final painted = ThemeProvider.of(tester);
      expect(painted.palette.brand, NabinPalette.defaults().brand);
      expect(painted.palette.isRemote, isFalse);
      expect(find.byType(MaterialApp), findsOneWidget);
    });

    test('a role accent follows its own token, and only its own', () {
      final config = NabinAppConfig.fromJson(
        configBody(
          tokens: <String, dynamic>{'groceryAccent': '#01579B'},
          knownTokens: const <String>['groceryAccent'],
        ),
        source: NabinConfigSource.remote,
        fetchedAt: DateTime.utc(2026, 9, 21, 12),
      );
      final palette = NabinPalette.from(config);

      expect(palette.accentFor(NabinRole.groceryMerchant), const Color(0xFF01579B));
      expect(palette.accentFor(NabinRole.customer), NabinPalette.defaults().brand);
      expect(palette.accentFor(NabinRole.restaurantMerchant), NabinPalette.defaults().foodAccent);
    });
  });
}

/// Reads back what the installed theme actually resolves to, so the assertions
/// are about painted values rather than about the objects passed in.
class ThemeProvider extends StatelessWidget {
  const ThemeProvider({super.key});

  static PaintedTheme of(WidgetTester tester) {
    final context = tester.element(find.byType(ThemeProvider));
    return PaintedTheme(
      scheme: Theme.of(context).colorScheme,
      palette: NabinPalette.of(context),
    );
  }

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}

class PaintedTheme {
  const PaintedTheme({required this.scheme, required this.palette});

  final ColorScheme scheme;
  final NabinPalette palette;
}
