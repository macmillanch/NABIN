import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/nabin_palette.dart';

/// Customer Ride receipt. Built ONLY from fields that actually exist at the end
/// of the WS-driven ride (booking id, vehicle, upfront fare). It does not compute
/// a tax/fee breakdown, does not claim an online payment occurred, and does not
/// fabricate a rating submission — none of those have a verified customer
/// backend. Reached once from ActiveRideScreen on TRIP_COMPLETED.
class RideReceiptScreen extends StatelessWidget {
  const RideReceiptScreen({
    super.key,
    required this.jobId,
    required this.fare,
    required this.vehicleType,
    required this.vehicleName,
  });

  final String? jobId;
  final String fare;
  final String vehicleType;
  final String vehicleName;

  @override
  Widget build(BuildContext context) {
    final p = NabinPalette.of(context);
    return Scaffold(
      backgroundColor: p.canvas,
      appBar: AppBar(
        backgroundColor: p.surface,
        foregroundColor: p.onSurface,
        title: const Text('Trip receipt', style: TextStyle(fontWeight: FontWeight.w700)),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                Icon(Icons.check_circle_rounded, color: p.success, size: 28),
                const SizedBox(width: 10),
                Text('Trip completed',
                    style: TextStyle(color: p.onSurface, fontSize: 20, fontWeight: FontWeight.w700)),
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
                  _row(p, 'Vehicle', '$vehicleName · $vehicleType', accent: false),
                  // An absent fare renders as a dash, not `₹0.00` — the latter is a number
                  // the platform never set.
                  _row(p, 'Upfront fare', fare.isEmpty ? '—' : fare, accent: true),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'Fare shown is the upfront fare recorded at booking. No online payment, '
              'tax breakdown or refund is processed here. Full trip details are in Activity.',
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
          Text(label, style: TextStyle(color: p.onSurfaceMuted)),
          Text(
            value,
            style: TextStyle(
              color: accent ? p.brand : p.onSurface,
              fontWeight: accent ? FontWeight.w700 : FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
