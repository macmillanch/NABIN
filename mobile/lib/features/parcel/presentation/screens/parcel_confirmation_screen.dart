import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/nabin_palette.dart';

/// Customer Parcel booking confirmation. Uses ONLY fields that really exist:
/// the backend job id and the fare the booking record carries. It deliberately
/// does NOT show a driver, vehicle, ETA, live timeline, proof, refund or an
/// online payment result — the customer parcel backend does not expose those.
/// Post-booking status is handled by Activity.
class ParcelConfirmationScreen extends StatelessWidget {
  const ParcelConfirmationScreen({
    super.key,
    required this.jobId,
    required this.fare,
  });

  final String? jobId;

  /// The fare string the booking handed over — the value the job row recorded,
  /// never a price the app guessed from the weight band.
  final String fare;

  @override
  Widget build(BuildContext context) {
    final p = NabinPalette.of(context);
    return Scaffold(
      backgroundColor: p.canvas,
      appBar: AppBar(
        backgroundColor: p.surface,
        foregroundColor: p.onSurface,
        automaticallyImplyLeading: false,
        title: const Text('Parcel booked', style: TextStyle(fontWeight: FontWeight.w700)),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                Icon(Icons.check_circle_rounded, color: p.success, size: 28),
                const SizedBox(width: 10),
                Expanded(
                  child: Text('Booking confirmed',
                      style: TextStyle(
                          color: p.onSurface,
                          fontSize: 20,
                          fontWeight: FontWeight.w700)),
                ),
              ],
            ),
            const SizedBox(height: 20),
            Container(
              decoration: BoxDecoration(
                color: p.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: p.divider),
              ),
              child: Column(
                children: [
                  _row(p, 'Job ID', jobId ?? '—', accent: false),
                  _row(p, 'Fare on the booking', fare, accent: true),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'This is the fare the booking record holds; no online payment was taken here. '
              'Driver assignment and delivery are confirmed by NABIN and reflected in '
              'Activity — a live tracking timeline is not available for parcels yet.',
              style: TextStyle(color: p.onSurfaceMuted, fontSize: 12, height: 1.35),
            ),
            const SizedBox(height: 24),
            SizedBox(
              height: 52,
              child: FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: p.brand,
                  foregroundColor: p.onBrand,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                onPressed: () => context.go('/activity'),
                child: const Text('View in Activity',
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
              ),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => context.go('/home'),
              child: Text('Back to Home', style: TextStyle(color: p.onSurfaceMuted)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _row(NabinPalette p, String label, String value, {required bool accent}) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Flexible, not a bare Text: 'Fare on the booking' beside its amount is
          // wider than a phone at large text scale, and a bill row whose value is
          // clipped states a total the customer cannot read.
          Flexible(child: Text(label, style: TextStyle(color: p.onSurfaceMuted))),
          const SizedBox(width: 8),
          Container(
            padding: accent ? const EdgeInsets.symmetric(horizontal: 10, vertical: 4) : null,
            decoration: accent
                ? BoxDecoration(
                    color: p.parcelAccent.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(999),
                  )
                : null,
            child: Text(
              value,
              style: TextStyle(
                color: accent ? p.parcelAccent : p.onSurface,
                fontWeight: accent ? FontWeight.w700 : FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
