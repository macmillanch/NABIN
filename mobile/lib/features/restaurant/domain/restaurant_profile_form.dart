/// Client-side mirror of the restaurant discovery-profile contract.
///
/// The authority for these rules is `backend/src/services/restaurantProfileDomain.js`
/// and the column CHECKs in `supabase/migrations/034_restaurant_discovery_metadata.sql`.
/// This file does not replace that validation — the `PATCH /api/merchant/:id/profile`
/// route still runs the server copy and its answer is the one the merchant acts on. What
/// it does is refuse, before a round trip, a value the platform is certain to reject, so
/// a merchant typing `190` into the delivery box sees the reason here rather than after a
/// write that never lands.
///
/// The two must not drift, so every constant below names the backend rule it copies.
/// If the server range or the URL scheme changes, change it here too.
library;

// Copied from restaurantProfileDomain.js — keep in lockstep with the server.
const int kCuisineMaxCount = 12; // CUISINE_MAX_COUNT
const int kCuisineMaxLength = 40; // CUISINE_MAX_LENGTH
const int kCoverUrlMaxLength = 2048; // COVER_URL_MAX_LENGTH
const int kDeliveryMinutesMin = 5; // DELIVERY_MINUTES_MIN
const int kDeliveryMinutesMax = 180; // DELIVERY_MINUTES_MAX

/// The result of validating a form before it is sent: either a human-readable
/// `error` (nothing is sent) or the `body` to PATCH (already trimmed/cleaned).
class ProfileValidation {
  final String? error;
  final Map<String, dynamic>? body;

  const ProfileValidation._(this.error, this.body);
  const ProfileValidation.failure(String message) : this._(message, null);
  const ProfileValidation.success(Map<String, dynamic> requestBody) : this._(null, requestBody);

  bool get isValid => error == null;
}

/// Validates one candidate cuisine against the list already declared, using the same
/// trim / blank / length / case-insensitive-duplicate rules the server applies. Returns
/// a message when the entry would be refused, or `null` when it may be added.
String? cuisineAddError(List<String> existing, String candidate) {
  if (existing.length >= kCuisineMaxCount) {
    return 'You can declare at most $kCuisineMaxCount cuisines.';
  }
  final name = candidate.trim();
  if (name.isEmpty) {
    return 'Enter a cuisine name first.';
  }
  if (name.length > kCuisineMaxLength) {
    return 'A cuisine name is at most $kCuisineMaxLength characters.';
  }
  final lower = name.toLowerCase();
  if (existing.any((c) => c.trim().toLowerCase() == lower)) {
    return '"$name" is already declared.';
  }
  return null;
}

/// Whether a cover-image URL text is acceptable as-is (used for inline hints). Empty is
/// acceptable — it means "no banner" and clears the column on save.
String? coverUrlError(String raw) {
  final value = raw.trim();
  if (value.isEmpty) return null;
  if (value.length > kCoverUrlMaxLength) {
    return 'The image URL is too long (max $kCoverUrlMaxLength characters).';
  }
  if (RegExp(r'\s').hasMatch(value)) {
    return 'The image URL cannot contain spaces.';
  }
  final uri = Uri.tryParse(value);
  final scheme = uri?.scheme ?? '';
  final host = uri?.host ?? '';
  if (uri == null || (scheme != 'http' && scheme != 'https')) {
    return 'Use a full web address starting with http:// or https://.';
  }
  if (host.isEmpty) {
    return 'The image URL must name a website (no host found).';
  }
  return null;
}

/// Whether a delivery-minutes text is acceptable as-is (used for inline hints). Empty is
/// acceptable — it clears the window. Mirrors the server's `^\d{1,3}$` then 5–180 check.
String? deliveryMinutesError(String raw) {
  final value = raw.trim();
  if (value.isEmpty) return null;
  if (!RegExp(r'^\d{1,3}$').hasMatch(value)) {
    return 'Enter a whole number of minutes.';
  }
  final minutes = int.tryParse(value);
  if (minutes == null || minutes < kDeliveryMinutesMin || minutes > kDeliveryMinutesMax) {
    return 'Delivery time must be between $kDeliveryMinutesMin and $kDeliveryMinutesMax minutes.';
  }
  return null;
}

/// Builds the PATCH body from the three current form fields, validating each.
///
/// All three keys are always sent. The form shows the merchant's stored values, so what
/// is on screen IS the profile the merchant wants: an emptied cover field sends `null`
/// (clear), an emptied delivery field sends `null` (clear), and an empty cuisine list
/// sends `[]` (no declaration). `undefined` (leave-a-column-alone) is a partial-update
/// affordance this whole-form screen never needs, so it is never emitted here.
ProfileValidation buildProfilePatchBody({
  required List<String> cuisines,
  required String coverUrl,
  required String deliveryMinutes,
}) {
  if (cuisines.length > kCuisineMaxCount) {
    return const ProfileValidation.failure('You can declare at most $kCuisineMaxCount cuisines.');
  }
  final cleaned = <String>[];
  final seen = <String>{};
  for (final entry in cuisines) {
    final name = entry.trim();
    if (name.isEmpty) {
      return const ProfileValidation.failure('A cuisine name cannot be blank.');
    }
    if (name.length > kCuisineMaxLength) {
      return ProfileValidation.failure(
        'Each cuisine name is at most $kCuisineMaxLength characters ("$name" is longer).',
      );
    }
    final lower = name.toLowerCase();
    if (seen.contains(lower)) {
      return ProfileValidation.failure('"$name" is declared twice.');
    }
    seen.add(lower);
    cleaned.add(name);
  }

  final coverProblem = coverUrlError(coverUrl);
  if (coverProblem != null) return ProfileValidation.failure(coverProblem);

  final deliveryProblem = deliveryMinutesError(deliveryMinutes);
  if (deliveryProblem != null) return ProfileValidation.failure(deliveryProblem);

  final trimmedCover = coverUrl.trim();
  final trimmedDelivery = deliveryMinutes.trim();

  return ProfileValidation.success(<String, dynamic>{
    'cuisines': cleaned,
    'coverImageUrl': trimmedCover.isEmpty ? null : trimmedCover,
    'standardDeliveryMinutes': trimmedDelivery.isEmpty ? null : int.parse(trimmedDelivery),
  });
}
