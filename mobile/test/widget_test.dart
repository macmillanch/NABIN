import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/main.dart';

void main() {
  testWidgets('NABIN Customer App launches and renders welcome screen', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: NabinCustomerSuperApp(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('NABIN'), findsWidgets);
    expect(find.text('Get Started'), findsOneWidget);
  });
}
