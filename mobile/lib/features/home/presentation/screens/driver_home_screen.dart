import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/driver_theme.dart';
import '../../../../core/widgets/driver_button.dart';
import '../../../../core/widgets/driver_card.dart';
import '../../../../core/widgets/driver_map_view.dart';

class DriverHomeScreen extends StatefulWidget {
  const DriverHomeScreen({super.key});

  @override
  State<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

class _DriverHomeScreenState extends State<DriverHomeScreen> {
  int _navIndex = 0; // 0: Home, 1: Earnings, 2: Account
  bool _isOnline = true;
  final String _activeVehicle = '3W'; // '2W', '3W', '4W'

  // Service Preferences Filter
  bool _allowRides = true;
  bool _allowParcels = true;
  bool _allowFood = true;

  // Incoming Job Radar State
  bool _showIncomingJob = false;
  int _countdown = 15;
  Timer? _timer;
  Map<String, dynamic>? _incomingJob;

  void _triggerJob(String type) {
    if (!_isOnline) return;

    if (type == 'RIDE') {
      _incomingJob = {
        'type': 'RIDE',
        'title': 'Passenger Ride ($activeVehicleName)',
        'pickup': 'Civil Lines Metro Gate 2',
        'drop': 'Connaught Place Inner Circle',
        'distance': '4.2 km (12 mins)',
        'fare': '₹85.00',
        'customer': 'Rahul Sharma (4.9 ★)',
        'color': DriverTheme.rideBadge,
        'icon': Icons.person_pin_circle,
      };
    } else if (type == 'PARCEL') {
      _incomingJob = {
        'type': 'PARCEL',
        'title': 'Instant Parcel Courier (Dual-OTP)',
        'pickup': 'Kamla Nagar Market (Sender)',
        'drop': 'Karol Bagh Electronics Hub (Recipient)',
        'distance': '6.1 km (18 mins)',
        'fare': '₹60.00',
        'customer': 'Amit Traders (Dual-OTP Guaranteed)',
        'color': DriverTheme.parcelBadge,
        'icon': Icons.inventory_2,
      };
    } else {
      _incomingJob = {
        'type': 'FOOD',
        'title': 'Restaurant Food Delivery',
        'pickup': 'Dilli Darbar Mughlai Kitchen',
        'drop': 'North Campus Hostel Block C',
        'distance': '3.0 km (10 mins)',
        'fare': '₹55.00',
        'customer': 'Order #ORD-9824 (2 items)',
        'color': DriverTheme.foodBadge,
        'icon': Icons.restaurant,
      };
    }

    setState(() {
      _showIncomingJob = true;
      _countdown = 15;
    });

    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_countdown > 1) {
        setState(() => _countdown--);
      } else {
        timer.cancel();
        setState(() => _showIncomingJob = false);
      }
    });
  }

  String get activeVehicleName {
    switch (_activeVehicle) {
      case '2W':
        return '2W Bike';
      case '4W':
        return '4W Cab';
      case '3W':
      default:
        return '3W Auto';
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DriverTheme.bgLight,
      body: Stack(
        children: [
          // 1. Fullscreen Vector Map Viewport
          Positioned.fill(
            child: DriverMapView(
              vehicleType: _activeVehicle,
              showRoute: false,
            ),
          ),

          // 2. Top App Bar & Online Toggle Banner
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Column(
                children: [
                  // Top Header Card
                  DriverCard(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    borderRadius: 22,
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(8),
                              decoration: const BoxDecoration(
                                color: DriverTheme.primaryBlue,
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.local_taxi, color: Colors.white, size: 18),
                            ),
                            const SizedBox(width: 10),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('NABIN DRIVER', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: DriverTheme.primaryBlue, letterSpacing: 0.5)),
                                Row(
                                  children: [
                                    Text(activeVehicleName, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: DriverTheme.textDark)),
                                    const Text(' • DL 1RA 4892', style: TextStyle(fontSize: 11, color: DriverTheme.textMuted)),
                                  ],
                                ),
                              ],
                            ),
                          ],
                        ),
                        // Online / Offline Switch
                        Row(
                          children: [
                            Container(
                              width: 10,
                              height: 10,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: _isOnline ? DriverTheme.onlineGreen : DriverTheme.offlineGrey,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Text(
                              _isOnline ? 'ONLINE' : 'OFFLINE',
                              style: TextStyle(
                                fontWeight: FontWeight.w900,
                                fontSize: 12,
                                color: _isOnline ? DriverTheme.onlineGreen : DriverTheme.offlineGrey,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Switch(
                              value: _isOnline,
                              activeThumbColor: DriverTheme.onlineGreen,
                              onChanged: (val) => setState(() => _isOnline = val),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),

                  // Service Preferences Chips (Passenger / Parcel / Food)
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        _buildServiceChip('Rides', _allowRides, DriverTheme.rideBadge, () => setState(() => _allowRides = !_allowRides)),
                        const SizedBox(width: 8),
                        _buildServiceChip('Parcels', _allowParcels, DriverTheme.parcelBadge, () => setState(() => _allowParcels = !_allowParcels)),
                        const SizedBox(width: 8),
                        _buildServiceChip('Food', _allowFood, DriverTheme.foodBadge, () => setState(() => _allowFood = !_allowFood)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),

          // 3. Bottom Shift Metrics Dashboard
          Positioned(
            left: 16,
            right: 16,
            bottom: 84,
            child: DriverCard(
              padding: const EdgeInsets.all(18),
              borderRadius: 24,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text("TODAY'S EARNINGS", style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: DriverTheme.textMuted, letterSpacing: 0.8)),
                          SizedBox(height: 2),
                          Text('₹1,420.00', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
                        ],
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF1F5F9),
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: const Row(
                          children: [
                            Icon(Icons.check_circle, color: DriverTheme.onlineGreen, size: 16),
                            SizedBox(width: 6),
                            Text('8 Trips Done', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: DriverTheme.textDark)),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  const Divider(color: DriverTheme.borderLight, height: 1),
                  const SizedBox(height: 12),

                  // Simulator Trigger Buttons (For easy instant testing of all 3 job types)
                  Row(
                    children: [
                      Expanded(
                        child: _buildJobSimulatorBtn('Ride (2W/3W/4W)', DriverTheme.rideBadge, () => _triggerJob('RIDE')),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: _buildJobSimulatorBtn('Parcel (Dual-OTP)', DriverTheme.parcelBadge, () => _triggerJob('PARCEL')),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: _buildJobSimulatorBtn('Food (KDS)', DriverTheme.foodBadge, () => _triggerJob('FOOD')),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),

          // 4. Incoming Job Request Radar Modal
          if (_showIncomingJob && _incomingJob != null)
            Container(
              color: Colors.black54,
              child: Center(
                child: Container(
                  margin: const EdgeInsets.all(20),
                  padding: const EdgeInsets.all(22),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(28),
                    boxShadow: const [
                      BoxShadow(color: Colors.black26, blurRadius: 30, offset: Offset(0, 10)),
                    ],
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                            decoration: BoxDecoration(
                              color: (_incomingJob!['color'] as Color).withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Row(
                              children: [
                                Icon(_incomingJob!['icon'] as IconData, size: 16, color: _incomingJob!['color'] as Color),
                                const SizedBox(width: 6),
                                Text(
                                  _incomingJob!['title'] as String,
                                  style: TextStyle(color: _incomingJob!['color'] as Color, fontWeight: FontWeight.w900, fontSize: 11),
                                ),
                              ],
                            ),
                          ),
                          // Countdown circle
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(
                              color: DriverTheme.warningAmber.withValues(alpha: 0.2),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Text(
                              '${_countdown}s',
                              style: const TextStyle(fontWeight: FontWeight.w900, color: DriverTheme.roadGold, fontSize: 12),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 18),

                      Text(_incomingJob!['fare'] as String, style: const TextStyle(fontSize: 36, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
                      Text('Estimated Net Earnings • ${_incomingJob!['distance']}', style: const TextStyle(color: DriverTheme.textMuted, fontSize: 13, fontWeight: FontWeight.w600)),
                      const SizedBox(height: 18),

                      const Divider(color: DriverTheme.borderLight),
                      const SizedBox(height: 12),

                      Row(
                        children: [
                          const Icon(Icons.radio_button_checked, color: DriverTheme.onlineGreen, size: 18),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Pickup: ${_incomingJob!['pickup']}',
                              style: const TextStyle(fontWeight: FontWeight.bold, color: DriverTheme.textDark, fontSize: 13),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          const Icon(Icons.location_on, color: DriverTheme.alertRed, size: 18),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Drop: ${_incomingJob!['drop']}',
                              style: const TextStyle(fontWeight: FontWeight.bold, color: DriverTheme.textDark, fontSize: 13),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 22),

                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton(
                              onPressed: () {
                                _timer?.cancel();
                                setState(() => _showIncomingJob = false);
                              },
                              style: OutlinedButton.styleFrom(
                                side: const BorderSide(color: DriverTheme.borderLight),
                                padding: const EdgeInsets.symmetric(vertical: 16),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                              ),
                              child: const Text('Decline', style: TextStyle(color: DriverTheme.textMuted, fontWeight: FontWeight.bold)),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: DriverButton(
                              text: 'ACCEPT JOB',
                              color: DriverTheme.onlineGreen,
                              textColor: Colors.black,
                              onPressed: () {
                                _timer?.cancel();
                                setState(() => _showIncomingJob = false);
                                context.push('/active-job', extra: _incomingJob);
                              },
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: DriverTheme.borderLight)),
        ),
        child: BottomNavigationBar(
          currentIndex: _navIndex,
          onTap: (idx) {
            setState(() => _navIndex = idx);
            if (idx == 1) context.push('/earnings');
            if (idx == 2) context.push('/account');
          },
          backgroundColor: Colors.white,
          selectedItemColor: DriverTheme.primaryBlue,
          unselectedItemColor: DriverTheme.textMuted,
          items: const [
            BottomNavigationBarItem(icon: Icon(Icons.map_rounded), label: 'Home Map'),
            BottomNavigationBarItem(icon: Icon(Icons.account_balance_wallet_rounded), label: 'Earnings'),
            BottomNavigationBarItem(icon: Icon(Icons.person_rounded), label: 'Account'),
          ],
        ),
      ),
    );
  }

  Widget _buildServiceChip(String label, bool isEnabled, Color color, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: isEnabled ? color : Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: isEnabled ? color : DriverTheme.borderLight),
          boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 4, offset: Offset(0, 2))],
        ),
        child: Text(
          '$label ${isEnabled ? "ON" : "OFF"}',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w900,
            color: isEnabled ? Colors.white : DriverTheme.textMuted,
          ),
        ),
      ),
    );
  }

  Widget _buildJobSimulatorBtn(String text, Color color, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: color.withValues(alpha: 0.3)),
        ),
        child: Center(
          child: Text(
            text,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: color),
          ),
        ),
      ),
    );
  }
}
