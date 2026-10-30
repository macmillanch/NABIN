import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/widgets/nabin_top_service_switcher.dart';

void main() {
  group('NabinTopServiceSwitcher', () {
    testWidgets('displays Food, Grocery, Ride, Parcel and NEVER Instamart', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: NabinTopServiceSwitcher(
              currentCategory: NabinServiceCategory.ride,
            ),
          ),
        ),
      );

      expect(find.text('Food'), findsOneWidget);
      expect(find.text('Grocery'), findsOneWidget);
      expect(find.text('Ride'), findsOneWidget);
      expect(find.text('Parcel'), findsOneWidget);
      expect(find.text('Instamart'), findsNothing);
    });

    testWidgets('invokes onCategoryChanged when a different category is tapped', (tester) async {
      NabinServiceCategory? selected;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: NabinTopServiceSwitcher(
              currentCategory: NabinServiceCategory.food,
              onCategoryChanged: (cat) => selected = cat,
            ),
          ),
        ),
      );

      await tester.tap(find.text('Grocery'));
      await tester.pumpAndSettle();

      expect(selected, equals(NabinServiceCategory.grocery));
    });
  });
}
