import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:mobile/core/config/nabin_app_config.dart';
import 'package:mobile/core/config/nabin_config_controller.dart';
import 'package:mobile/core/config/nabin_config_repository.dart';
import 'package:mobile/core/models/nabin_advertisements.dart';
import 'package:mobile/core/theme/app_theme.dart';
import 'package:mobile/features/home/presentation/screens/customer_home_screen.dart';

// Reused rather than copied: the payload shape is already the contract this
// screen is written against, and two builders of it would drift.
import 'remote_config_test.dart' as feed;

/// A campaign row as the home screen receives it.
NabinAdvertisement campaign(
  String id, {
  required String title,
  DateTime? endsAt,
  DateTime? startsAt,
}) {
  return NabinAdvertisement(
    id: id,
    title: title,
    placement: kHomeBannerPlacement,
    startsAt: startsAt,
    endsAt: endsAt,
  );
}

/// Pumps the real customer home against a published configuration, so these
/// assertions are about what a customer sees when an operator pauses a service
/// or publishes a campaign — not about a helper function's return value.
Future<void> pumpHome(
  WidgetTester tester, {
  required Map<String, dynamic> body,
  List<NabinAdvertisement> advertisements = const <NabinAdvertisement>[],
  Object? advertisementFailure,
}) async {
  final repository = feed.repositoryReturning(
    NabinConfigResponse(status: 200, body: body),
  );
  final container = ProviderContainer(
    overrides: [
      nabinConfigRepositoryProvider.overrideWithValue(repository),
      if (advertisementFailure != null)
        nabinAdvertisementsProvider.overrideWith(
          (ref, placement) async => throw advertisementFailure,
        )
      else
        nabinAdvertisementsProvider.overrideWith(
          (ref, placement) async => NabinAdvertisementFeed(
            placement: placement,
            items: advertisements,
            dataSource: 'postgres',
          ),
        ),
    ],
  );
  addTearDown(container.dispose);
  await container.read(nabinConfigProvider.notifier).refresh();

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: Consumer(
        builder: (context, ref, _) => MaterialApp(
          theme: AppTheme.customerTheme(palette: nabinPaletteOf(ref)),
          home: const CustomerHomeScreen(),
        ),
      ),
    ),
  );
  await tester.pump();
}

const List<Map<String, dynamic>> allServicesActive = <Map<String, dynamic>>[
  <String, dynamic>{'id': 'rides', 'name': 'NABIN Mobility & Rides', 'status': 'ACTIVE'},
  <String, dynamic>{'id': 'food', 'name': 'NABIN Food', 'status': 'ACTIVE'},
  <String, dynamic>{'id': 'grocery', 'name': 'NABIN Grocery', 'status': 'ACTIVE'},
  <String, dynamic>{'id': 'parcel', 'name': 'NABIN Parcel', 'status': 'ACTIVE'},
];

void main() {
  group('killswitch reading', () {
    test('a lockdown is read from the published summary', () {
      // The switchboard stops the platform by pausing every service and writing
      // `EMERGENCY_LOCKDOWN`; it never writes an `EMERGENCY_STOP` row, so a
      // client that only looked for that spelling would have a dead gate.
      final lockdown = NabinAppConfig.fromJson(
        feed.configBody(
          services: allServicesActive,
          summary: <String, dynamic>{'platformStatus': 'EMERGENCY_LOCKDOWN'},
        ),
        source: NabinConfigSource.remote,
        fetchedAt: DateTime.utc(2026, 9, 21, 12),
      );
      final normal = NabinAppConfig.fromJson(
        feed.configBody(
          services: allServicesActive,
          summary: <String, dynamic>{'platformStatus': 'OPERATIONAL'},
        ),
        source: NabinConfigSource.remote,
        fetchedAt: DateTime.utc(2026, 9, 21, 12),
      );

      expect(lockdown.emergencyStop, isTrue);
      expect(normal.emergencyStop, isFalse);
    });
  });

  group('service tiles follow the published state', () {
    testWidgets('an operational platform shows no notice and no offline tile', (tester) async {
      await pumpHome(
        tester,
        body: feed.configBody(
          services: allServicesActive,
          summary: <String, dynamic>{'platformStatus': 'OPERATIONAL'},
        ),
      );

      expect(find.text('Our Services'), findsOneWidget);
      expect(find.text('Temporarily offline'), findsNothing);
      expect(find.text('Unavailable'), findsNothing);
    });

    testWidgets('one paused service takes only its own tile offline, in its own words',
        (tester) async {
      await pumpHome(
        tester,
        body: feed.configBody(
          services: <Map<String, dynamic>>[
            <String, dynamic>{'id': 'rides', 'name': 'NABIN Mobility & Rides', 'status': 'ACTIVE'},
            <String, dynamic>{'id': 'food', 'name': 'NABIN Food', 'status': 'ACTIVE'},
            <String, dynamic>{'id': 'parcel', 'name': 'NABIN Parcel', 'status': 'ACTIVE'},
            <String, dynamic>{
              'id': 'grocery',
              'name': 'NABIN Grocery',
              'status': 'PAUSED',
              'broadcastNotice': 'Heavy rainfall: grocery is paused in Delhi NCR',
            },
          ],
          summary: <String, dynamic>{'platformStatus': 'PARTIALLY_DEGRADED'},
        ),
      );

      expect(find.text('NABIN Grocery is paused'), findsOneWidget);
      expect(find.text('Heavy rainfall: grocery is paused in Delhi NCR'), findsOneWidget);
      // No resume time was published, so the app must not invent one.
      expect(find.text('No resume time has been published.'), findsOneWidget);
      // Only the paused service's tile goes dark; the others keep selling.
      expect(find.text('Temporarily offline'), findsOneWidget);
      expect(find.text('Unavailable'), findsNothing);
    });

    testWidgets('a published feature flag switches a tile off even while its service runs',
        (tester) async {
      await pumpHome(
        tester,
        body: feed.configBody(
          services: allServicesActive,
          features: <String, dynamic>{
            'FEATURE_PARCEL': <String, dynamic>{'enabled': false},
          },
        ),
      );

      expect(find.text('Temporarily offline'), findsOneWidget);
    });

    testWidgets('an emergency stop takes every tile offline', (tester) async {
      await pumpHome(
        tester,
        body: feed.configBody(
          services: allServicesActive,
          summary: <String, dynamic>{'platformStatus': 'EMERGENCY_LOCKDOWN'},
        ),
      );

      expect(find.text('NABIN is temporarily stopped'), findsOneWidget);
      // The hero card is the ride tile; the other three are standard cards.
      expect(find.text('Unavailable'), findsOneWidget);
      expect(find.text('Temporarily offline'), findsNWidgets(3));
    });

    testWidgets('a service row the server never listed stays on the flag', (tester) async {
      await pumpHome(tester, body: feed.configBody());

      expect(find.text('Temporarily offline'), findsNothing);
      expect(find.text('Unavailable'), findsNothing);
    });
  });

  group('the banner slot is honest about what is published', () {
    testWidgets('a campaign inside its window paints, an expired one does not', (tester) async {
      final now = DateTime.now().toUtc();
      await pumpHome(
        tester,
        // The window is measured against the server's instant, so the fixture
        // publishes one that matches these campaign dates.
        body: feed.configBody(serverTime: now.toIso8601String()),
        advertisements: <NabinAdvertisement>[
          campaign('live', title: 'Flat fares across the city', endsAt: now.add(const Duration(hours: 2))),
          campaign('over', title: 'Last week\'s campaign', endsAt: now.subtract(const Duration(hours: 2))),
        ],
      );

      expect(find.textContaining('Flat fares across the city'), findsOneWidget);
      expect(find.textContaining('Last week'), findsNothing);
      expect(find.text('Promoted'), findsOneWidget);
    });

    testWidgets('a dead banner feed leaves no placeholder box behind', (tester) async {
      await pumpHome(
        tester,
        body: feed.configBody(),
        advertisementFailure: const NabinAdvertisementsUnavailable('The banner feed did not answer.'),
      );

      expect(find.text('Promoted'), findsNothing);
      // The rest of the home screen still renders — a failed ad slot is not a
      // failed app.
      expect(find.text('Our Services'), findsOneWidget);
    });

    testWidgets('nothing published paints no slot at all', (tester) async {
      await pumpHome(tester, body: feed.configBody());

      expect(find.text('Promoted'), findsNothing);
    });
  });
}
