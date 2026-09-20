import 'package:flutter/material.dart';
import '../../../../core/theme/driver_theme.dart';

class DriverJobOfferCard extends StatelessWidget {
  final Map<String, dynamic> job;
  final int timeLeft;
  final VoidCallback onAccept;
  final VoidCallback onDecline;

  const DriverJobOfferCard({
    super.key,
    required this.job,
    required this.timeLeft,
    required this.onAccept,
    required this.onDecline,
  });

  @override
  Widget build(BuildContext context) {
    final serviceType = job['service'] ?? 'RIDE';
    final fare = job['fare'] != null ? '₹${job['fare']}' : '₹--';
    final pickup = job['pickup_address'] ?? 'Unknown Pickup';
    final drop = job['drop_address'] ?? 'Unknown Drop';

    return Container(
      padding: const EdgeInsets.all(16),
      margin: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: DriverTheme.surfaceCard,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.1),
            blurRadius: 20,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: DriverTheme.rewardGold.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  serviceType,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    color: DriverTheme.rewardGold,
                  ),
                ),
              ),
              Row(
                children: [
                  const Icon(Icons.timer_outlined, size: 16, color: DriverTheme.alertRed),
                  const SizedBox(width: 4),
                  Text(
                    '${timeLeft}s',
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: DriverTheme.alertRed,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            fare,
            style: const TextStyle(
              fontSize: 32,
              fontWeight: FontWeight.w900,
              color: DriverTheme.textDark,
            ),
          ),
          const SizedBox(height: 16),
          _buildLocationRow(Icons.my_location, pickup, DriverTheme.rewardGold),
          const Padding(
            padding: EdgeInsets.only(left: 8.0, top: 4, bottom: 4),
            child: Align(
              alignment: Alignment.centerLeft,
              child: SizedBox(
                height: 20,
                child: VerticalDivider(
                  color: DriverTheme.borderLight,
                  thickness: 2,
                ),
              ),
            ),
          ),
          _buildLocationRow(Icons.location_on, drop, DriverTheme.alertRed),
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: onDecline,
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    side: const BorderSide(color: DriverTheme.borderLight),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text(
                    'Decline',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: DriverTheme.textMuted,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: ElevatedButton(
                  onPressed: onAccept,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: DriverTheme.rewardGold,
                    foregroundColor: DriverTheme.textDark,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    elevation: 0,
                  ),
                  child: const Text(
                    'Accept',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildLocationRow(IconData icon, String address, Color iconColor) {
    return Row(
      children: [
        Icon(icon, size: 20, color: iconColor),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            address,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w500,
              color: DriverTheme.textDark,
            ),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}
