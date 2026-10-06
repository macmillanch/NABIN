import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/features/restaurant/domain/restaurant_profile_form.dart';

/// Unit coverage for the client mirror of `restaurantProfileDomain.js`. Every case
/// here is the value the merchant typed and the exact reason the platform refuses it
/// — the server runs its own copy, but nothing should leave the device for a write the
/// domain is already certain to reject.
void main() {
  group('cuisineAddError', () {
    test('accepts a fresh, in-range name', () {
      expect(cuisineAddError(['North Indian'], 'Mughlai'), isNull);
    });

    test('refuses the twelfth when twelve are already declared', () {
      final twelve = List<String>.generate(12, (i) => 'Cuisine $i');
      expect(cuisineAddError(twelve, 'Thirteen'), isNotNull);
    });

    test('refuses a blank entry', () {
      expect(cuisineAddError(['Italian'], '   '), isNotNull);
    });

    test('refuses a name longer than the cap', () {
      expect(cuisineAddError([], 'a' * (kCuisineMaxLength + 1)), isNotNull);
    });

    test('refuses a case-insensitive duplicate', () {
      expect(cuisineAddError(['Mughlai'], 'mughlai'), isNotNull);
    });
  });

  group('coverUrlError', () {
    test('empty is valid (it clears the column)', () {
      expect(coverUrlError(''), isNull);
      expect(coverUrlError('   '), isNull);
    });

    test('accepts http and https with a host', () {
      expect(coverUrlError('https://cdn.example.com/banner.jpg'), isNull);
      expect(coverUrlError('http://example.com/a.png'), isNull);
    });

    test('refuses a non-http scheme', () {
      expect(coverUrlError('ftp://example.com/banner.jpg'), isNotNull);
      expect(coverUrlError('example.com/banner.jpg'), isNotNull);
    });

    test('refuses a URL with a space', () {
      expect(coverUrlError('https://example.com/a b.jpg'), isNotNull);
    });

    test('refuses a URL with no host', () {
      expect(coverUrlError('https://'), isNotNull);
    });

    test('refuses an over-long URL', () {
      final huge = 'https://example.com/${'a' * kCoverUrlMaxLength}';
      expect(coverUrlError(huge), isNotNull);
    });
  });

  group('deliveryMinutesError', () {
    test('empty is valid (it clears the column)', () {
      expect(deliveryMinutesError(''), isNull);
    });

    test('accepts the backend range endpoints 5 and 180', () {
      expect(deliveryMinutesError('5'), isNull);
      expect(deliveryMinutesError('180'), isNull);
      expect(deliveryMinutesError('45'), isNull);
    });

    test('refuses below the floor and above the ceiling', () {
      expect(deliveryMinutesError('4'), isNotNull);
      expect(deliveryMinutesError('181'), isNotNull);
    });

    test('refuses a non-integer', () {
      expect(deliveryMinutesError('45.5'), isNotNull);
      expect(deliveryMinutesError('abc'), isNotNull);
    });
  });

  group('buildProfilePatchBody', () {
    test('sends all three keys with a trimmed, de-duplicated clean body', () {
      final v = buildProfilePatchBody(
        cuisines: ['  North Indian ', 'Mughlai'],
        coverUrl: ' https://cdn.example.com/banner.jpg ',
        deliveryMinutes: ' 45 ',
      );
      expect(v.isValid, isTrue);
      expect(v.body, <String, dynamic>{
        'cuisines': ['North Indian', 'Mughlai'],
        'coverImageUrl': 'https://cdn.example.com/banner.jpg',
        'standardDeliveryMinutes': 45,
      });
    });

    test('an emptied cover and delivery send null (clear), not the old value', () {
      final v = buildProfilePatchBody(
        cuisines: const ['Italian'],
        coverUrl: '   ',
        deliveryMinutes: '',
      );
      expect(v.isValid, isTrue);
      expect(v.body!['coverImageUrl'], isNull);
      expect(v.body!['standardDeliveryMinutes'], isNull);
      expect(v.body!['cuisines'], ['Italian']);
    });

    test('an empty cuisine list sends [] (no declaration)', () {
      final v = buildProfilePatchBody(
        cuisines: const [],
        coverUrl: '',
        deliveryMinutes: '',
      );
      expect(v.isValid, isTrue);
      expect(v.body!['cuisines'], <String>[]);
    });

    test('rejects a list over the cap', () {
      final v = buildProfilePatchBody(
        cuisines: List<String>.generate(13, (i) => 'C $i'),
        coverUrl: '',
        deliveryMinutes: '',
      );
      expect(v.isValid, isFalse);
      expect(v.body, isNull);
    });

    test('rejects a blank cuisine in the list', () {
      final v = buildProfilePatchBody(
        cuisines: const ['Indian', '   '],
        coverUrl: '',
        deliveryMinutes: '',
      );
      expect(v.isValid, isFalse);
    });

    test('rejects a duplicate cuisine', () {
      final v = buildProfilePatchBody(
        cuisines: const ['Indian', 'indian'],
        coverUrl: '',
        deliveryMinutes: '',
      );
      expect(v.isValid, isFalse);
    });

    test('rejects an out-of-range delivery time', () {
      final v = buildProfilePatchBody(
        cuisines: const ['Indian'],
        coverUrl: '',
        deliveryMinutes: '190',
      );
      expect(v.isValid, isFalse);
      expect(v.error, contains('180'));
    });

    test('rejects a bad cover URL', () {
      final v = buildProfilePatchBody(
        cuisines: const ['Indian'],
        coverUrl: 'not a url',
        deliveryMinutes: '30',
      );
      expect(v.isValid, isFalse);
    });
  });
}
