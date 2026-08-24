import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/driver_map_view.dart';
import '../../../../core/models/passenger_booking_info.dart';
import '../../../../core/network/nabin_ws_service.dart';

class ActiveRideScreen extends StatefulWidget {
  final String vehicleType;
  final String vehicleName;
  final String fare;
  final PassengerBookingInfo? passengerInfo;

  const ActiveRideScreen({
    super.key,
    this.vehicleType = '3W',
    this.vehicleName = 'Auto',
    this.fare = '₹85.00',
    this.passengerInfo,
  });

  @override
  State<ActiveRideScreen> createState() => _ActiveRideScreenState();
}

class _ActiveRideScreenState extends State<ActiveRideScreen> {
  // 0: Driver En Route to Pickup, 1: On Trip to Destination, 2: Completed
  int _tripStage = 0;
  int _rating = 5;

  StreamSubscription? _tripSub;
  StreamSubscription? _locationSub;

  @override
  void initState() {
    super.initState();
    _connectCustomerWs();
  }

  void _connectCustomerWs() {
    NabinWsService.instance.connect(role: 'customer', userId: 'cust_active');
    _tripSub = NabinWsService.instance.onTripUpdate.listen((msg) {
      if (!mounted) return;
      final type = msg['type'] as String?;
      if (type == 'TRIP_STARTED') {
        setState(() => _tripStage = 1);
      } else if (type == 'TRIP_COMPLETED') {
        setState(() => _tripStage = 2);
      }
    });
  }

  @override
  void dispose() {
    _tripSub?.cancel();
    _locationSub?.cancel();
    super.dispose();
  }

  PassengerBookingInfo get passenger => widget.passengerInfo ?? const PassengerBookingInfo();

  Map<String, dynamic> get _driverInfo {
    switch (widget.vehicleType) {
      case '2W':
        return {
          'name': 'Vikram Singh',
          'initials': 'VS',
          'rating': '4.95',
          'trips': '2,800+',
          'model': 'Honda Activa 6G • Matte Black',
          'plate': 'DL 5S AA 1294',
          'phone': '+919811029384',
        };
      case '4W':
        return {
          'name': 'Amitabh Sen',
          'initials': 'AS',
          'rating': '4.98',
          'trips': '6,200+',
          'model': 'Maruti Dzire Sedan • Pearl White',
          'plate': 'DL 3C AB 9021',
          'phone': '+919899123456',
        };
      case '3W':
      default:
        return {
          'name': 'Rajesh Kumar',
          'initials': 'RK',
          'rating': '4.90',
          'trips': '4,500+',
          'model': 'Bajaj RE EV Auto • Yellow/Green',
          'plate': 'DL 1RA 4892',
          'phone': '+919876512345',
        };
    }
  }

  Future<void> _launchPhoneCall(BuildContext context, String phoneNumber) async {
    final Uri launchUri = Uri(scheme: 'tel', path: phoneNumber);
    try {
      if (await canLaunchUrl(launchUri)) {
        await launchUrl(launchUri, mode: LaunchMode.externalApplication);
      } else {
        await launchUrl(launchUri);
      }
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Opening native phone dialer with $phoneNumber...')),
        );
      }
    }
  }

  Future<void> _launchSms(BuildContext context, String phoneNumber, String message) async {
    final Uri launchUri = Uri(
      scheme: 'sms',
      path: phoneNumber,
      queryParameters: <String, String>{'body': message},
    );
    try {
      if (await canLaunchUrl(launchUri)) {
        await launchUrl(launchUri, mode: LaunchMode.externalApplication);
      } else {
        await launchUrl(launchUri);
      }
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Opening native SMS app with message to $phoneNumber...')),
        );
      }
    }
  }

  void _showSafetyModal(BuildContext context) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      backgroundColor: AppTheme.surfaceContainerLowest,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Row(
                  children: [
                    Icon(Icons.shield_rounded, color: Color(0xFFD50000), size: 24),
                    SizedBox(width: 8),
                    Text('NABIN Safety Toolkit', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: AppTheme.onSurface)),
                  ],
                ),
                IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => Navigator.pop(ctx)),
              ],
            ),
            const SizedBox(height: 14),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: const Color(0xFFFFEBEE), borderRadius: BorderRadius.circular(12)),
                child: const Icon(Icons.sos_rounded, color: Color(0xFFD50000), size: 22),
              ),
              title: const Text('Emergency Police Hotline (112)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
              subtitle: const Text('Dial 112 directly on phone with live GPS coordinates', style: TextStyle(fontSize: 11)),
              onTap: () {
                Navigator.pop(ctx);
                _launchPhoneCall(context, '112');
              },
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: AppTheme.primary.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
                child: const Icon(Icons.share_location_rounded, color: AppTheme.primary, size: 22),
              ),
              title: const Text('Share Live Trip via SMS', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
              subtitle: const Text('Send live GPS tracking link to family and trusted contacts', style: TextStyle(fontSize: 11)),
              onTap: () {
                Navigator.pop(ctx);
                final dest = passenger.dropAddress ?? 'Destination';
                _launchSms(context, '', 'Live tracking for ${passenger.passengerName ?? "NABIN Ride"} to $dest: https://nabin.app/track/7729 (Driver: ${_driverInfo['name']}, ${_driverInfo['plate']})');
              },
            ),
            const SizedBox(height: 10),
          ],
        ),
      ),
    );
  }

  bool _isEarlyDropoff = false;
  double _earlyDropoffFare = 0.0;
  double _earlyDropoffRefund = 0.0;

  double get _numericFare {
    final clean = widget.fare.replaceAll(RegExp(r'[^0-9.]'), '');
    return double.tryParse(clean) ?? 85.0;
  }

  double get _standardCancelFee {
    switch (widget.vehicleType) {
      case '2W':
        return 20.0;
      case '4W':
        return 50.0;
      case '3W':
      default:
        return 30.0;
    }
  }

  void _showCancellationPolicyModal(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        decoration: const BoxDecoration(
          color: AppTheme.surfaceContainerLowest,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(color: AppTheme.outlineVariant, borderRadius: BorderRadius.circular(2)),
              ),
            ),
            const SizedBox(height: 14),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Row(
                  children: [
                    Icon(Icons.rule_rounded, color: AppTheme.primary, size: 22),
                    SizedBox(width: 8),
                    Text('NABIN Cancellation Rules', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: AppTheme.onSurface)),
                  ],
                ),
                IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => Navigator.pop(ctx)),
              ],
            ),
            const SizedBox(height: 10),
            _buildPolicyRuleItem(
              '⏱️ 2-Minute Free Grace Period',
              'Cancel within 2 minutes of booking for a 100% full refund with zero fees.',
              const Color(0xFF00C853),
            ),
            _buildPolicyRuleItem(
              '🛡️ Driver Delay Exception (>5 Mins)',
              'If the driver is delayed by more than 5 minutes past estimated arrival, the cancellation fee is 100% waived.',
              const Color(0xFF0052CC),
            ),
            _buildPolicyRuleItem(
              '📞 Driver Unresponsive / Asked to Cancel',
              'If the driver asks you to cancel or cannot be reached, zero cancellation fee is charged.',
              const Color(0xFF00897B),
            ),
            _buildPolicyRuleItem(
              '🛺 Driver Dispatch Compensation (After 2 Mins)',
              'If cancelled after 2 mins while driver is en route:\n• 2W Bike: ₹20.00\n• 3W Auto: ₹30.00\n• 4W Car: ₹50.00\nCompensates driver for fuel and time.',
              const Color(0xFFFF6D00),
            ),
            _buildPolicyRuleItem(
              '🛑 Mid-Trip Early Stop (Post-OTP Rule)',
              'Once OTP is verified, the ride cannot be cancelled. You can request an Early Stop with a minimum 50% fare or distance-based fare.',
              const Color(0xFFD50000),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primary,
                foregroundColor: Colors.white,
                minimumSize: const Size(double.infinity, 46),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              child: const Text('Understood', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPolicyRuleItem(String title, String desc, Color accent) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: accent.withValues(alpha: 0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: TextStyle(fontWeight: FontWeight.w900, fontSize: 12.5, color: accent)),
          const SizedBox(height: 3),
          Text(desc, style: const TextStyle(fontSize: 11, color: AppTheme.onSurface, height: 1.3)),
        ],
      ),
    );
  }

  void _showCancelBottomSheet(BuildContext context) {
    int selectedReasonIndex = 0;
    final List<Map<String, dynamic>> reasons = [
      {
        'title': 'Driver is taking too long to arrive (>5 mins)',
        'isDriverFault': true,
      },
      {
        'title': 'Driver asked to cancel / Unable to reach driver',
        'isDriverFault': true,
      },
      {
        'title': 'Change of plans / No longer needed',
        'isDriverFault': false,
      },
      {
        'title': 'Incorrect pickup or drop location',
        'isDriverFault': false,
      },
      {
        'title': 'Booked wrong vehicle / Found alternate transit',
        'isDriverFault': false,
      },
    ];

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) {
          final isDriverFault = reasons[selectedReasonIndex]['isDriverFault'] == true;
          final double cancelFee = isDriverFault ? 0.0 : _standardCancelFee;
          final double refundAmount = (_numericFare - cancelFee).clamp(0.0, _numericFare);

          return Container(
            decoration: const BoxDecoration(
              color: AppTheme.surfaceContainerLowest,
              borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
            ),
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 36,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppTheme.outlineVariant,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.cancel_rounded, color: Color(0xFFD50000), size: 24),
                        SizedBox(width: 8),
                        Text('Cancel Ride', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: AppTheme.onSurface)),
                      ],
                    ),
                    IconButton(
                      icon: const Icon(Icons.close_rounded),
                      onPressed: () => Navigator.pop(ctx),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Select reason for cancellation:', style: TextStyle(fontSize: 12, color: AppTheme.onSurfaceVariant)),
                    InkWell(
                      onTap: () => _showCancellationPolicyModal(context),
                      child: const Text('View Rules ℹ️', style: TextStyle(fontSize: 11.5, color: AppTheme.primary, fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
                const SizedBox(height: 12),

                ...List.generate(reasons.length, (idx) {
                  final isSelected = selectedReasonIndex == idx;
                  return InkWell(
                    onTap: () => setModalState(() => selectedReasonIndex = idx),
                    borderRadius: BorderRadius.circular(12),
                    child: Container(
                      margin: const EdgeInsets.only(bottom: 6),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(
                        color: isSelected ? AppTheme.primary.withValues(alpha: 0.08) : Colors.transparent,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: isSelected ? AppTheme.primary : AppTheme.outlineVariant.withValues(alpha: 0.5),
                          width: isSelected ? 1.5 : 1,
                        ),
                      ),
                      child: Row(
                        children: [
                          Icon(
                            isSelected ? Icons.radio_button_checked : Icons.radio_button_off,
                            color: isSelected ? AppTheme.primary : AppTheme.outline,
                            size: 18,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              reasons[idx]['title'] as String,
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                                color: isSelected ? AppTheme.primary : AppTheme.onSurface,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                }),
                const SizedBox(height: 12),

                // Dynamic Cancellation Fee Breakdown Card
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: cancelFee == 0 ? const Color(0xFFE8F5E9) : const Color(0xFFFFF3E0),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: cancelFee == 0 ? const Color(0xFFA5D6A7) : const Color(0xFFFFB74D)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(
                            cancelFee == 0 ? Icons.verified_rounded : Icons.info_outline_rounded,
                            color: cancelFee == 0 ? const Color(0xFF2E7D32) : const Color(0xFFE65100),
                            size: 20,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            cancelFee == 0 ? '₹0.00 Cancellation Fee (Waived)' : '₹${cancelFee.toStringAsFixed(2)} Driver Compensation Fee',
                            style: TextStyle(
                              fontWeight: FontWeight.w900,
                              fontSize: 12.5,
                              color: cancelFee == 0 ? const Color(0xFF1B5E20) : const Color(0xFFE65100),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        cancelFee == 0
                            ? '100% full refund of ${widget.fare} will be restored to your NABIN Wallet immediately.'
                            : 'Upfront Fare: ${widget.fare} • Fee: -₹${cancelFee.toStringAsFixed(2)}\nNet Instant Wallet Refund: ₹${refundAmount.toStringAsFixed(2)}',
                        style: TextStyle(fontSize: 11, color: cancelFee == 0 ? const Color(0xFF2E7D32) : const Color(0xFFBF360C), height: 1.25),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),

                Row(
                  children: [
                    Expanded(
                      flex: 5,
                      child: OutlinedButton(
                        onPressed: () {
                          Navigator.pop(ctx);
                          context.go('/home');
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text(
                                cancelFee == 0
                                    ? 'Ride cancelled. Full refund of ${widget.fare} credited to your Wallet.'
                                    : 'Ride cancelled. ₹${refundAmount.toStringAsFixed(2)} refunded to Wallet (₹${cancelFee.toStringAsFixed(2)} cancellation fee applied).',
                              ),
                              backgroundColor: const Color(0xFFD50000),
                              duration: const Duration(seconds: 4),
                            ),
                          );
                        },
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: Color(0xFFD50000)),
                          foregroundColor: const Color(0xFFD50000),
                          padding: const EdgeInsets.symmetric(vertical: 13),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                        ),
                        child: Text('Confirm Cancel (₹${cancelFee.toInt()} Fee)', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      flex: 6,
                      child: ElevatedButton(
                        onPressed: () => Navigator.pop(ctx),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppTheme.primaryContainer,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 13),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          elevation: 2,
                        ),
                        child: const Text('Keep My Ride', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  void _showEarlyDropoffModal(BuildContext context) {
    final double totalFare = _numericFare;
    final double min50Percent = totalFare * 0.50;
    // Simulate distance traveled (e.g. 1.8 km out of 4.2 km ~ 43% covered)
    final double distanceCoveredFare = totalFare * 0.45;
    // Rule: Maximum of 50% or distance-based fare
    final double payableFare = min50Percent > distanceCoveredFare ? min50Percent : distanceCoveredFare;
    final double refundToWallet = (totalFare - payableFare).clamp(0.0, totalFare);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        decoration: const BoxDecoration(
          color: AppTheme.surfaceContainerLowest,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: AppTheme.outlineVariant,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 14),
            const Row(
              children: [
                Icon(Icons.pan_tool_rounded, color: Color(0xFFFF6D00), size: 24),
                SizedBox(width: 8),
                Text('Ask Driver to Stop Here', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: AppTheme.onSurface)),
              ],
            ),
            const SizedBox(height: 6),
            const Text(
              'Trip is currently active with verified OTP. Cancellation is locked, but you can end the ride early at your current location.',
              style: TextStyle(fontSize: 12, color: AppTheme.onSurfaceVariant, height: 1.3),
            ),
            const SizedBox(height: 14),

            // 50% Minimum / Distance Rule Box
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF8F1),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFFFCC80)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.rule_folder_rounded, color: Color(0xFFE65100), size: 18),
                      SizedBox(width: 6),
                      Text('MID-TRIP EARLY STOP POLICY', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: Color(0xFFE65100), letterSpacing: 0.5)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  _buildFareSummaryRow('Upfront Booked Fare', '₹${totalFare.toStringAsFixed(2)}'),
                  _buildFareSummaryRow('Distance Covered (1.8 km / 4.2 km)', '₹${distanceCoveredFare.toStringAsFixed(2)}'),
                  _buildFareSummaryRow('Minimum 50% Threshold Rule', '₹${min50Percent.toStringAsFixed(2)}'),
                  const Divider(height: 14),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Final Early Stop Fare (Max of 50% or Distance)', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: AppTheme.onSurface)),
                      Text('₹${payableFare.toStringAsFixed(2)}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: Color(0xFFE65100))),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Instant Refund to Wallet: ₹${refundToWallet.toStringAsFixed(2)}',
                    style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold, color: Color(0xFF2E7D32)),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            Row(
              children: [
                Expanded(
                  flex: 5,
                  child: ElevatedButton(
                    onPressed: () {
                      Navigator.pop(ctx);
                      setState(() {
                        _isEarlyDropoff = true;
                        _earlyDropoffFare = payableFare;
                        _earlyDropoffRefund = refundToWallet;
                        _tripStage = 2; // Jump to completed receipt
                      });
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text('Trip ended early at current stop. ₹${refundToWallet.toStringAsFixed(2)} refunded to Wallet.'),
                          backgroundColor: const Color(0xFF00C853),
                        ),
                      );
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFFFF6D00),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 13),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      elevation: 2,
                    ),
                    child: Text('Stop Here (₹${payableFare.toStringAsFixed(0)})', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  flex: 6,
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(ctx),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 13),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    child: const Text('Continue Trip', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFareSummaryRow(String label, String amount) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 11, color: AppTheme.onSurfaceVariant)),
          Text(amount, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.onSurface)),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final driver = _driverInfo;
    final p = passenger;
    final isChild = p.isSchoolChild;
    final isSomeoneElse = p.isForSomeoneElse;

    final pickup = p.pickupAddress ?? 'Civil Lines Metro Gate 2';
    final drop = p.dropAddress ?? (isChild ? 'ABC Public School' : 'Connaught Place');

    return Scaffold(
      backgroundColor: AppTheme.background,
      body: Stack(
        children: [
          // 1. Vector Map Viewport
          Positioned.fill(
            child: DriverMapView(
              vehicleType: widget.vehicleType,
              showRoute: true,
              isBookingConfirmed: true,
              tripStage: _tripStage,
              pickupLabel: pickup,
              dropLabel: drop,
            ),
          ),

          // 2. Top Floating Status Bar
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(24),
                    border: Border.all(
                      color: _tripStage == 0
                          ? const Color(0xFF00C853)
                          : (_tripStage == 1 ? (isChild ? const Color(0xFFFF6D00) : AppTheme.primary) : const Color(0xFF00C853)),
                      width: 1.5,
                    ),
                    boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 10, offset: Offset(0, 3))],
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.circle,
                        color: _tripStage == 2
                            ? const Color(0xFF00C853)
                            : (_tripStage == 1 ? (isChild ? const Color(0xFFFF6D00) : AppTheme.primary) : const Color(0xFF00C853)),
                        size: 10,
                      ),
                      const SizedBox(width: 8),
                      Flexible(
                        child: Text(
                          _tripStage == 0
                              ? 'Driver En Route to Pickup • Arriving in 2 mins'
                              : (_tripStage == 1
                                  ? (isChild ? 'School Ride in Progress • Safe Transit to ${p.schoolName ?? "School"}' : 'En Route to $drop • 11 mins')
                                  : 'Trip Completed • Safely Dropped'),
                          style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 12.5, color: AppTheme.onSurface),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),

          // 3. Bottom Floating Trip HUD Card
          Positioned(
            left: 14,
            right: 14,
            bottom: 14,
            child: SafeArea(
              top: false,
              child: Container(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(24),
                  boxShadow: const [
                    BoxShadow(color: Colors.black26, blurRadius: 20, spreadRadius: 2, offset: Offset(0, 6)),
                  ],
                  border: Border.all(color: AppTheme.outlineVariant.withValues(alpha: 0.6)),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Passenger Information Banner / Card (if booked for someone else / school child)
                    if (isSomeoneElse) ...[
                      Container(
                        margin: const EdgeInsets.only(bottom: 10),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          color: isChild ? const Color(0xFFFFF3E0) : AppTheme.surfaceContainerLow,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                            color: isChild ? const Color(0xFFFFB74D) : AppTheme.outlineVariant.withValues(alpha: 0.6),
                          ),
                        ),
                        child: Row(
                          children: [
                            Container(
                              width: 38,
                              height: 38,
                              decoration: BoxDecoration(
                                gradient: LinearGradient(
                                  colors: isChild
                                      ? [const Color(0xFFFF6D00), const Color(0xFFFF9E80)]
                                      : [AppTheme.primary, AppTheme.primaryContainer],
                                ),
                                shape: BoxShape.circle,
                              ),
                              child: Center(
                                child: Text(
                                  (p.passengerName != null && p.passengerName!.isNotEmpty) ? p.passengerName!.substring(0, 1) : 'P',
                                  style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 16),
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Text(
                                        isChild ? '🎒 SCHOOL CHILD PASSENGER' : '👤 BOOKED FOR SOMEONE ELSE',
                                        style: TextStyle(
                                          fontSize: 9,
                                          fontWeight: FontWeight.w900,
                                          color: isChild ? const Color(0xFFE65100) : AppTheme.primary,
                                          letterSpacing: 0.5,
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 1),
                                  Text(
                                    p.passengerName ?? 'Passenger',
                                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: AppTheme.onSurface),
                                  ),
                                  if (isChild) ...[
                                    Text(
                                      '${p.schoolName ?? "School"} • ${p.gradeClass ?? "Class 5"}${p.section != null && p.section!.isNotEmpty ? " (${p.section})" : ""}',
                                      style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.bold, color: AppTheme.primary),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                            if (isChild && p.guardianPhone != null) ...[
                              IconButton(
                                icon: const Icon(Icons.call_rounded, color: Color(0xFFFF6D00), size: 20),
                                tooltip: 'Call Guardian',
                                onPressed: () => _launchPhoneCall(context, p.guardianPhone!),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],

                    if (_tripStage == 0) ...[
                      // Stage 0: Driver Arriving & Start PIN
                      Row(
                        children: [
                          Container(
                            width: 42,
                            height: 42,
                            decoration: BoxDecoration(
                              gradient: const LinearGradient(colors: [AppTheme.primary, AppTheme.primaryContainer]),
                              shape: BoxShape.circle,
                              boxShadow: [BoxShadow(color: AppTheme.primary.withValues(alpha: 0.25), blurRadius: 6)],
                            ),
                            child: Center(
                              child: Text(driver['initials'] as String, style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 15)),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Flexible(
                                      child: Text(
                                        driver['name'] as String,
                                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: AppTheme.onSurface),
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    Text('⭐ ${driver['rating']}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.primary)),
                                  ],
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  '${driver['model']} • ${driver['plate']}',
                                  style: const TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 11, fontWeight: FontWeight.w600),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                            decoration: BoxDecoration(
                              color: AppTheme.primary.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(widget.fare, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: AppTheme.primary)),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),

                      // Start PIN Card for Booking Person (Passenger needs no phone/app)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF0F4FF),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: AppTheme.primary.withValues(alpha: 0.3)),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    isChild ? 'PICKUP VERIFICATION OTP (FOR GUARDIAN)' : 'START PIN (SHARE WITH DRIVER)',
                                    style: const TextStyle(fontSize: 8.5, fontWeight: FontWeight.w900, color: AppTheme.primary, letterSpacing: 0.5),
                                  ),
                                  const SizedBox(height: 1),
                                  Text(
                                    isChild
                                        ? 'Passenger needs no phone. Guardian confirms OTP with driver.'
                                        : 'Driver will verify this code to start ride',
                                    style: const TextStyle(fontSize: 9.5, color: AppTheme.onSurfaceVariant),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 8),
                            GestureDetector(
                              onTap: () {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(content: Text('Start PIN 7729 copied to clipboard!')),
                                );
                              },
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(color: AppTheme.primary, width: 1.5),
                                  boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 4)],
                                ),
                                child: const Row(
                                  children: [
                                    Text('7729', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: AppTheme.primary, letterSpacing: 2.5)),
                                    SizedBox(width: 4),
                                    Icon(Icons.copy_rounded, size: 12, color: AppTheme.primary),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 10),

                      // Action Buttons: Message, Call Driver
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: () => _launchSms(
                                context,
                                driver['phone'] as String,
                                isChild
                                    ? 'Hi ${driver['name']}, I booked a school ride for ${p.passengerName}. Pickup is at $pickup.'
                                    : 'Hi ${driver['name']}, I am waiting at the pickup point ($pickup).',
                              ),
                              icon: const Icon(Icons.chat_bubble_outline_rounded, size: 15, color: AppTheme.primary),
                              label: const Text('Message', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.primary, fontSize: 12)),
                              style: OutlinedButton.styleFrom(
                                side: const BorderSide(color: AppTheme.primaryFixed),
                                backgroundColor: AppTheme.surfaceContainerLow,
                                padding: const EdgeInsets.symmetric(vertical: 10),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: ElevatedButton.icon(
                              onPressed: () => _launchPhoneCall(context, driver['phone'] as String),
                              icon: const Icon(Icons.phone_rounded, size: 15, color: Colors.white),
                              label: const Text('Call Driver', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 12)),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: AppTheme.primaryContainer,
                                padding: const EdgeInsets.symmetric(vertical: 10),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                elevation: 2,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),

                      // Driver Verifies OTP & Starts Trip
                      ElevatedButton.icon(
                        onPressed: () {
                          setState(() => _tripStage = 1);
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text('✅ Driver ${driver['name']} verified Start PIN 7729! Safe transit started to $drop.'),
                              backgroundColor: const Color(0xFF00C853),
                            ),
                          );
                        },
                        icon: const Icon(Icons.verified_user_rounded, size: 16, color: Colors.white),
                        label: Text(
                          isChild ? 'Passenger Picked Up → Start School Transit' : 'Driver Verifies OTP (7729) & Starts Ride',
                          style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 12),
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF00C853),
                          foregroundColor: Colors.white,
                          minimumSize: const Size(double.infinity, 42),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                      ),
                      const SizedBox(height: 4),

                      Center(
                        child: TextButton(
                          onPressed: () => _showCancelBottomSheet(context),
                          style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 2), minimumSize: const Size(50, 24)),
                          child: const Text('Cancel Ride', style: TextStyle(color: Color(0xFFD50000), fontWeight: FontWeight.bold, fontSize: 11)),
                        ),
                      ),
                    ] else if (_tripStage == 1) ...[
                      // Stage 1: Active In-Transit View
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              color: const Color(0xFF00C853).withValues(alpha: 0.15),
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(Icons.navigation_rounded, color: Color(0xFF00C853), size: 18),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  isChild ? 'Safe Transit to ${p.schoolName ?? drop}' : 'Heading to $drop',
                                  style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: AppTheme.onSurface),
                                  overflow: TextOverflow.ellipsis,
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  isChild ? 'Live GPS Guard Active • Est. Arrival: 08:15 AM' : 'Est. Arrival: 11:58 AM • 3.2 km remaining',
                                  style: const TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 11),
                                ),
                              ],
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: AppTheme.primary.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: const Text('38 km/h', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 11, color: AppTheme.primary)),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: () => _launchPhoneCall(context, driver['phone'] as String),
                              icon: const Icon(Icons.phone_rounded, size: 14, color: AppTheme.primary),
                              label: const Text('Call Driver', style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.primary, fontSize: 12)),
                              style: OutlinedButton.styleFrom(
                                padding: const EdgeInsets.symmetric(vertical: 10),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: ElevatedButton.icon(
                              onPressed: () => _showSafetyModal(context),
                              icon: const Icon(Icons.shield_rounded, size: 14, color: Colors.white),
                              label: const Text('Safety Toolkit (SOS)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFFD50000),
                                foregroundColor: Colors.white,
                                padding: const EdgeInsets.symmetric(vertical: 10),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            flex: 6,
                            child: OutlinedButton.icon(
                              onPressed: () => _showEarlyDropoffModal(context),
                              icon: const Icon(Icons.pan_tool_rounded, size: 14, color: Color(0xFFFF6D00)),
                              label: const Text('Ask Driver to Stop Here', style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFFFF6D00), fontSize: 11.5)),
                              style: OutlinedButton.styleFrom(
                                side: const BorderSide(color: Color(0xFFFF6D00)),
                                padding: const EdgeInsets.symmetric(vertical: 9),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            flex: 5,
                            child: OutlinedButton(
                              onPressed: () => setState(() => _tripStage = 2),
                              style: OutlinedButton.styleFrom(
                                padding: const EdgeInsets.symmetric(vertical: 9),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                              ),
                              child: Text(
                                isChild ? 'Reaching Gate' : 'Simulate Drop',
                                style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ] else ...[
                      // Stage 2: Trip Completed & Receipt Card
                      Row(
                        children: [
                          Icon(
                            _isEarlyDropoff ? Icons.check_circle_outline_rounded : Icons.check_circle_rounded,
                            color: const Color(0xFF2E7D32),
                            size: 22,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  _isEarlyDropoff
                                      ? '🛑 Trip Ended Early (Mid-Trip Drop)'
                                      : (isChild ? 'Safely Arrived at ${p.schoolName ?? "School Gate"}' : 'Trip Completed Successfully!'),
                                  style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: Color(0xFF1B5E20)),
                                ),
                                Text(
                                  _isEarlyDropoff
                                      ? 'Paid ₹${_earlyDropoffFare.toStringAsFixed(2)} (Min 50% Rule) • ₹${_earlyDropoffRefund.toStringAsFixed(2)} Refunded'
                                      : (isChild ? 'Passenger safely handed over to school entrance' : 'Paid ${widget.fare} via NABIN Wallet (Autopay)'),
                                  style: const TextStyle(fontSize: 11, color: Color(0xFF2E7D32)),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),

                      // Rating Bar
                      Center(
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: List.generate(5, (idx) {
                            return IconButton(
                              padding: const EdgeInsets.symmetric(horizontal: 2),
                              constraints: const BoxConstraints(),
                              icon: Icon(
                                idx < _rating ? Icons.star_rounded : Icons.star_outline_rounded,
                                color: const Color(0xFFFFB300),
                                size: 24,
                              ),
                              onPressed: () => setState(() => _rating = idx + 1),
                            );
                          }),
                        ),
                      ),
                      const SizedBox(height: 8),

                      ElevatedButton(
                        onPressed: () => context.go('/home'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppTheme.primaryContainer,
                          foregroundColor: Colors.white,
                          minimumSize: const Size(double.infinity, 44),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          elevation: 2,
                        ),
                        child: const Text('Back to Home', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
