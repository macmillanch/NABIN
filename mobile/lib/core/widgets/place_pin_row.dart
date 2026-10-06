import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';

import '../theme/app_theme.dart';

/// The line under an address field that says whether that end of the trip has a
/// place at all: it names the coordinate that will be sent, or admits there is none.
///
/// `POST /api/customer/book-ride` and `/book-parcel` both refuse an end that was
/// typed but never placed (`400 PLACE_REQUIRED`), because the platform has no
/// geocoder and would otherwise have to invent the point it prices and drives to.
/// This row is the customer-facing half of that refusal: a label alone is visibly
/// incomplete, and picking puts a real coordinate on it.
class PlacePinRow extends StatelessWidget {
  const PlacePinRow({
    super.key,
    required this.missing,
    required this.point,
    required this.onPick,
  });

  /// What to say while no point exists, in the screen's own words.
  final String missing;
  final LatLng? point;
  final VoidCallback onPick;

  @override
  Widget build(BuildContext context) {
    final color = point == null ? AppTheme.warning : AppTheme.success;
    return InkWell(
      onTap: onPick,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: color.withValues(alpha: 0.45)),
        ),
        child: Row(
          children: [
            Icon(
              point == null
                  ? Icons.add_location_alt_rounded
                  : Icons.place_rounded,
              size: 16,
              color: color,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                point == null
                    ? missing
                    : 'Placed at ${point!.latitude.toStringAsFixed(5)}, ${point!.longitude.toStringAsFixed(5)}',
                style: TextStyle(
                    fontSize: 11, fontWeight: FontWeight.bold, color: color),
              ),
            ),
            Text(
              point == null ? 'Choose' : 'Move',
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: color),
            ),
          ],
        ),
      ),
    );
  }
}
