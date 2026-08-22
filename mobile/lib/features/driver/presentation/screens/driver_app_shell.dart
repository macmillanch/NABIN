import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart' hide Path;
import '../../../../core/theme/driver_theme.dart';

class DriverAppShell extends StatefulWidget {
  const DriverAppShell({super.key});

  @override
  State<DriverAppShell> createState() => _DriverAppShellState();
}

class _DriverAppShellState extends State<DriverAppShell> with SingleTickerProviderStateMixin {
  // Navigation State
  int _currentTab = 0; // 0: Drive (Map), 1: Earnings, 2: Account
  bool _isOnline = true;
  String _activeVehicleType = '3W'; // '2W', '3W', '4W'
  String _activeVehicleName = 'Bajaj RE Compact CNG';
  String _activeVehiclePlate = 'DL 1RA 4892';

  // Multi-Service Toggles
  bool _allowRides = true;
  bool _allowParcels = true;
  bool _allowFood = true;

  // Earnings State
  double _walletBalance = 1420.0;
  double _todayEarnings = 1420.0;
  int _todayTrips = 8;
  String _selectedEarningsPeriod = 'today'; // 'today', 'week', 'month'

  // Job Dispatch & Execution State
  bool _hasIncomingJob = false;
  Map<String, dynamic>? _incomingJob;
  Timer? _jobCountdownTimer;
  int _jobTimeLeft = 15;

  bool _isJobActive = false;
  Map<String, dynamic>? _activeJob;
  int _jobStage = 0; // 0: Nav to Pickup, 1: Arrived/OTP, 2: In Transit, 3: Arrived Drop/OTP, 4: Settle
  final TextEditingController _otpVerifyController = TextEditingController();

  // Map Controller
  late final MapController _mapController;
  final LatLng _driverLocation = const LatLng(28.6853, 77.2185); // Civil Lines Delhi
  final LatLng _dropLocation = const LatLng(28.6315, 77.2167); // Connaught Place Delhi

  @override
  void initState() {
    super.initState();
    _mapController = MapController();
  }

  @override
  void dispose() {
    _jobCountdownTimer?.cancel();
    _otpVerifyController.dispose();
    super.dispose();
  }

  // --- Dispatch & Simulation Logic ---
  void _triggerSimulatedJob(String type) {
    if (!_isOnline) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please turn switch ONLINE to receive jobs.'),
          backgroundColor: DriverTheme.alertRed,
        ),
      );
      return;
    }

    _jobCountdownTimer?.cancel();
    _jobTimeLeft = 15;

    if (type == 'SCHOOL_CHILD') {
      _incomingJob = {
        'id': 'JOB-7731',
        'type': 'RIDE',
        'isSchoolChild': true,
        'title': '🎒 SCHOOL CHILD PASSENGER',
        'fare': 95.0,
        'distance': '3.8 km (11 mins)',
        'pickup': 'Flat 402, Civil Lines, Delhi',
        'drop': 'ABC Public School, Kamla Nagar (Gate 2)',
        'customerName': 'Rahul Sharma (Guardian)',
        'customerRating': '4.9 ★',
        'customerPhone': '+91 98765 43210',
        'childName': 'Rahul Chakma',
        'schoolName': 'ABC Public School',
        'gradeClass': 'Class 5',
        'section': 'Section B',
        'customerNote': 'Child in school uniform with ID badge. Hand over to Gate 2 guard.',
        'paymentMode': 'Online Auto-Debited',
        'startOtp': '7729',
        'deliveryOtp': null,
      };
    } else if (type == 'RIDE') {
      _incomingJob = {
        'id': 'JOB-9821',
        'type': 'RIDE',
        'title': 'PASSENGER RIDE ($_activeVehicleType AUTO)',
        'fare': 85.0,
        'distance': '4.2 km (14 mins)',
        'pickup': 'Civil Lines Metro Gate 2, Delhi',
        'drop': 'Connaught Place Inner Circle, Block B',
        'customerName': 'Rahul Sharma',
        'customerRating': '4.9 ★',
        'customerNote': 'Near Exit escalator, wearing blue jacket',
        'paymentMode': 'Online UPI',
        'startOtp': '7729',
        'deliveryOtp': null,
      };
    } else if (type == 'PARCEL') {
      _incomingJob = {
        'id': 'JOB-4192',
        'type': 'PARCEL',
        'title': 'DUAL-OTP PARCEL COURIER',
        'fare': 60.0,
        'distance': '6.1 km (18 mins)',
        'pickup': 'Kamla Nagar Market, Block C, Delhi',
        'drop': 'Karol Bagh Electronics Hub, Delhi',
        'customerName': 'Amit Traders (Sender)',
        'customerRating': '4.8 ★',
        'customerNote': 'Dual-OTP Guaranteed Courier (Fragile Box)',
        'paymentMode': 'Online Paid',
        'startOtp': '7729',
        'deliveryOtp': '4892',
      };
    } else {
      _incomingJob = {
        'id': 'JOB-8812',
        'type': 'FOOD',
        'title': 'RESTAURANT FOOD DELIVERY',
        'fare': 55.0,
        'distance': '3.0 km (12 mins)',
        'pickup': 'Dilli Darbar Mughlai Kitchen, Kamla Nagar',
        'drop': 'North Campus Girls Hostel, Block 3',
        'customerName': 'Priya Saxena (Customer)',
        'customerRating': '4.9 ★',
        'customerNote': 'Order #ORD-9824 • Packed & Hot',
        'paymentMode': 'Online Paid',
        'foodItems': ['1x Special Dum Biryani', '2x Butter Naan', '1x Thums Up'],
        'startOtp': null,
        'deliveryOtp': '3184',
      };
    }

    setState(() {
      _hasIncomingJob = true;
    });

    _jobCountdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) return;
      setState(() {
        if (_jobTimeLeft > 0) {
          _jobTimeLeft--;
        } else {
          _declineIncomingJob();
        }
      });
    });
  }

  void _declineIncomingJob() {
    _jobCountdownTimer?.cancel();
    setState(() {
      _hasIncomingJob = false;
      _incomingJob = null;
    });
  }

  void _acceptIncomingJob() {
    _jobCountdownTimer?.cancel();
    setState(() {
      _hasIncomingJob = false;
      _isJobActive = true;
      _activeJob = _incomingJob;
      _jobStage = 0;
      _otpVerifyController.text = _activeJob?['startOtp'] ?? '7729';
    });
  }

  void _advanceJobStage() {
    setState(() {
      if (_jobStage < 3) {
        _jobStage++;
        if (_jobStage == 1) {
          _otpVerifyController.text = _activeJob?['startOtp'] ?? '7729';
        } else if (_jobStage == 3) {
          _otpVerifyController.text = _activeJob?['deliveryOtp'] ?? '4892';
        }
      } else {
        _showPaymentSettlementModal();
      }
    });
  }

  void _showPaymentSettlementModal() {
    final fare = (_activeJob?['fare'] as num?)?.toDouble() ?? 85.0;
    final commission = (fare * 0.1).roundToDouble();
    final netEarn = fare - commission;

    setState(() {
      _walletBalance += netEarn;
      _todayEarnings += netEarn;
      _todayTrips += 1;
    });

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
        backgroundColor: Colors.white,
        contentPadding: const EdgeInsets.all(24),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: Color(0xFFE8F5E9),
              ),
              child: const Icon(Icons.check_circle_rounded, color: Color(0xFF00C853), size: 40),
            ),
            const SizedBox(height: 16),
            const Text(
              'Trip Completed!',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: DriverTheme.textDark),
            ),
            const SizedBox(height: 4),
            Text(
              '₹${fare.toStringAsFixed(2)}',
              style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w900, color: DriverTheme.primaryBlue),
            ),
            const SizedBox(height: 4),
            const Text(
              'Credited directly to Driver Wallet',
              style: TextStyle(fontSize: 12, color: DriverTheme.textMuted),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: DriverTheme.bgLight,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: DriverTheme.borderLight),
              ),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Gross Fare:', style: TextStyle(fontSize: 12, color: DriverTheme.textMuted)),
                      Text('₹${fare.toStringAsFixed(2)}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Platform Fee (10%):', style: TextStyle(fontSize: 12, color: DriverTheme.alertRed)),
                      Text('-₹${commission.toStringAsFixed(2)}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: DriverTheme.alertRed)),
                    ],
                  ),
                  const Divider(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Net Payout:', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: Color(0xFF00C853))),
                      Text('₹${netEarn.toStringAsFixed(2)}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: Color(0xFF00C853))),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: () {
                Navigator.pop(ctx);
                setState(() {
                  _isJobActive = false;
                  _activeJob = null;
                  _jobStage = 0;
                });
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: DriverTheme.primaryBlue,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                minimumSize: const Size(double.infinity, 50),
              ),
              child: const Text('Done & Return to Drive', style: TextStyle(fontWeight: FontWeight.w900)),
            ),
          ],
        ),
      ),
    );
  }

  void _triggerSosEmergency() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF4A0E17),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: Colors.white, size: 28),
            SizedBox(width: 8),
            Text('SAFETY SOS ACTIVE', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 16)),
          ],
        ),
        content: const Text(
          'Live GPS coordinates (28.6853° N, 77.2185° E) are being broadcast to Delhi Police 112 and NABIN 24/7 Safety Command.',
          style: TextStyle(color: Colors.white70, fontSize: 13),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel Alarm', style: TextStyle(color: Colors.white60)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx),
            style: ElevatedButton.styleFrom(backgroundColor: DriverTheme.alertRed, foregroundColor: Colors.white),
            child: const Text('Call Police 112', style: TextStyle(fontWeight: FontWeight.w900)),
          ),
        ],
      ),
    );
  }

  // =========================================================================
  // TAB 1: MASTER DRIVER HOME (MAP-FOCUSED CONSOLE)
  // =========================================================================
  Widget _buildDriverHomeTab() {
    return Stack(
      children: [
        // Live FlutterMap GPS Layer
        FlutterMap(
          mapController: _mapController,
          options: MapOptions(
            initialCenter: _driverLocation,
            initialZoom: 15.0,
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
              subdomains: const ['a', 'b', 'c', 'd'],
              fallbackUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.nabin.driver',
              maxZoom: 20,
            ),
            if (_isJobActive)
              PolylineLayer(
                polylines: [
                  Polyline(
                    points: [_driverLocation, _dropLocation],
                    strokeWidth: 4.5,
                    color: DriverTheme.primaryBlue,
                  ),
                ],
              ),
            MarkerLayer(
              markers: [
                Marker(
                  point: _driverLocation,
                  width: 48,
                  height: 48,
                  child: Container(
                    decoration: BoxDecoration(
                      color: DriverTheme.primaryBlue,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 3),
                      boxShadow: const [
                        BoxShadow(color: Colors.black26, blurRadius: 10, offset: Offset(0, 4)),
                      ],
                    ),
                    child: Center(
                      child: Text(
                        _activeVehicleType == '2W' ? '🛵' : (_activeVehicleType == '4W' ? '🚗' : '🛺'),
                        style: const TextStyle(fontSize: 20),
                      ),
                    ),
                  ),
                ),
                if (_isJobActive)
                  Marker(
                    point: _dropLocation,
                    width: 36,
                    height: 36,
                    child: const Icon(Icons.location_on_rounded, color: DriverTheme.alertRed, size: 36),
                  ),
              ],
            ),
          ],
        ),

        // Top Floating Shift & Service Console
        Positioned(
          top: 12,
          left: 14,
          right: 14,
          child: Column(
            children: [
              // Driver Status Bar
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.96),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: DriverTheme.borderLight),
                  boxShadow: [
                    BoxShadow(color: Colors.black.withOpacity(0.08), blurRadius: 14, offset: const Offset(0, 4)),
                  ],
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 40,
                          height: 40,
                          decoration: BoxDecoration(
                            color: DriverTheme.primaryBlue,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Center(
                            child: Text('RK', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 13)),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Row(
                              children: [
                                Text('Rajesh Kumar', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
                                SizedBox(width: 4),
                                Text('⭐ 4.92', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: DriverTheme.roadGold)),
                              ],
                            ),
                            Text('$_activeVehicleType • $_activeVehiclePlate', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: DriverTheme.textMuted)),
                          ],
                        ),
                      ],
                    ),
                    Row(
                      children: [
                        Text(
                          _isOnline ? 'ONLINE' : 'OFFLINE',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w900,
                            color: _isOnline ? const Color(0xFF00C853) : DriverTheme.textMuted,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Transform.scale(
                          scale: 0.85,
                          child: Switch(
                            value: _isOnline,
                            activeColor: const Color(0xFF00C853),
                            onChanged: (val) => setState(() => _isOnline = val),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 8),

              // Service Preference Chips
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    _buildServiceChip('🛵 Rides', _allowRides, () => setState(() => _allowRides = !_allowRides), DriverTheme.rideBadge),
                    const SizedBox(width: 6),
                    _buildServiceChip('📦 Parcels', _allowParcels, () => setState(() => _allowParcels = !_allowParcels), DriverTheme.parcelBadge),
                    const SizedBox(width: 6),
                    _buildServiceChip('🍽️ Food', _allowFood, () => setState(() => _allowFood = !_allowFood), DriverTheme.foodBadge),
                  ],
                ),
              ),
            ],
          ),
        ),

        // Floating Action Buttons (SOS & Recenter)
        Positioned(
          right: 14,
          bottom: _isJobActive ? 260 : 180,
          child: Column(
            children: [
              FloatingActionButton.small(
                heroTag: 'sos',
                onPressed: _triggerSosEmergency,
                backgroundColor: DriverTheme.alertRed,
                child: const Icon(Icons.sos_rounded, color: Colors.white),
              ),
              const SizedBox(height: 8),
              FloatingActionButton.small(
                heroTag: 'recenter',
                onPressed: () => _mapController.move(_driverLocation, 15.0),
                backgroundColor: Colors.white,
                child: const Icon(Icons.my_location_rounded, color: DriverTheme.textDark),
              ),
            ],
          ),
        ),

        // Bottom Shift Summary / Active Job Floating Card
        Positioned(
          left: 14,
          right: 14,
          bottom: 14,
          child: _isJobActive ? _buildActiveJobCard() : _buildShiftSummaryCard(),
        ),

        // Incoming Job Request Bottom Sheet Modal
        if (_hasIncomingJob && _incomingJob != null)
          _buildIncomingJobModal(),
      ],
    );
  }

  Widget _buildServiceChip(String label, bool isEnabled, VoidCallback onTap, Color activeColor) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: isEnabled ? activeColor : Colors.white.withOpacity(0.9),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: isEnabled ? activeColor : DriverTheme.borderLight),
          boxShadow: [
            BoxShadow(color: Colors.black.withOpacity(0.04), blurRadius: 6),
          ],
        ),
        child: Text(
          '$label ${isEnabled ? "ON" : "OFF"}',
          style: TextStyle(
            color: isEnabled ? Colors.white : DriverTheme.textMuted,
            fontSize: 11,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
    );
  }

  Widget _buildShiftSummaryCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.98),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: DriverTheme.borderLight),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.08), blurRadius: 18, offset: const Offset(0, 4)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text("TODAY'S EARNINGS", style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: DriverTheme.textMuted)),
                  const SizedBox(height: 2),
                  Text("₹${_todayEarnings.toStringAsFixed(2)}", style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: const Color(0xFFE8F5E9),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text('$_todayTrips Trips Done ✓', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF00C853))),
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Divider(height: 1),
          const SizedBox(height: 10),
          const Text('SIMULATE DISPATCH RADAR:', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w900, color: DriverTheme.textMuted)),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _triggerSimulatedJob('RIDE'),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    side: const BorderSide(color: DriverTheme.rideBadge),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  child: const Text('+ Ride', style: TextStyle(color: DriverTheme.rideBadge, fontSize: 10.5, fontWeight: FontWeight.w900)),
                ),
              ),
              const SizedBox(width: 4),
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _triggerSimulatedJob('SCHOOL_CHILD'),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    side: const BorderSide(color: Color(0xFFFF6D00)),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  child: const Text('+ School', style: TextStyle(color: Color(0xFFFF6D00), fontSize: 10.5, fontWeight: FontWeight.w900)),
                ),
              ),
              const SizedBox(width: 4),
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _triggerSimulatedJob('PARCEL'),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    side: const BorderSide(color: DriverTheme.parcelBadge),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  child: const Text('+ Parcel', style: TextStyle(color: DriverTheme.parcelBadge, fontSize: 10.5, fontWeight: FontWeight.w900)),
                ),
              ),
              const SizedBox(width: 4),
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _triggerSimulatedJob('FOOD'),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    side: const BorderSide(color: DriverTheme.foodBadge),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  child: const Text('+ Food', style: TextStyle(color: DriverTheme.foodBadge, fontSize: 10.5, fontWeight: FontWeight.w900)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildActiveJobCard() {
    final job = _activeJob ?? {};
    String stageTitle;
    String locationText;
    String actionBtnText;
    Color btnColor;

    if (_jobStage == 0) {
      stageTitle = job['type'] == 'FOOD' ? 'STAGE 1: NAVIGATING TO RESTAURANT' : 'STAGE 1: NAVIGATING TO PICKUP';
      locationText = job['pickup'] ?? 'Pickup Location';
      actionBtnText = job['type'] == 'FOOD' ? 'I HAVE ARRIVED AT RESTAURANT' : 'I HAVE ARRIVED AT PICKUP POINT';
      btnColor = DriverTheme.primaryBlue;
    } else if (_jobStage == 1) {
      stageTitle = job['type'] == 'FOOD' ? 'STAGE 2: COLLECT PACKED FOOD' : 'STAGE 2: VERIFY START OTP (7729)';
      locationText = job['pickup'] ?? 'Pickup Location';
      actionBtnText = job['type'] == 'FOOD' ? 'CONFIRM FOOD COLLECTED' : 'VERIFY OTP & START TRIP';
      btnColor = const Color(0xFF00C853);
    } else if (_jobStage == 2) {
      stageTitle = 'STAGE 3: ACTIVE TRIP IN TRANSIT';
      locationText = job['drop'] ?? 'Destination Drop';
      actionBtnText = 'I HAVE ARRIVED AT DESTINATION';
      btnColor = DriverTheme.primaryBlue;
    } else {
      stageTitle = job['type'] == 'RIDE' ? 'STAGE 4: COMPLETE PASSENGER TRIP' : 'STAGE 4: ENTER DELIVERY OTP';
      locationText = job['drop'] ?? 'Destination Drop';
      actionBtnText = 'COMPLETE JOB & SETTLE FARE';
      btnColor = const Color(0xFF00C853);
    }

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: DriverTheme.borderLight),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.12), blurRadius: 20, offset: const Offset(0, 4)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(stageTitle, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: DriverTheme.primaryBlue)),
              Text('₹${(job['fare'] as num?)?.toStringAsFixed(2) ?? '85.00'}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w900)),
            ],
          ),
          const SizedBox(height: 6),
          Text(locationText, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: DriverTheme.textDark), maxLines: 1, overflow: TextOverflow.ellipsis),
          Text('Contact: ${job['customerName'] ?? 'Customer'}', style: const TextStyle(fontSize: 12, color: DriverTheme.textMuted)),
          
          if (_jobStage == 1 && job['type'] != 'FOOD' || _jobStage == 3 && job['type'] != 'RIDE') ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _otpVerifyController,
                    keyboardType: TextInputType.number,
                    maxLength: 4,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, letterSpacing: 6),
                    decoration: InputDecoration(
                      counterText: '',
                      contentPadding: const EdgeInsets.symmetric(vertical: 8),
                      hintText: 'OTP',
                      filled: true,
                      fillColor: DriverTheme.bgLight,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                    ),
                  ),
                ),
              ],
            ),
          ],

          const SizedBox(height: 12),
          ElevatedButton(
            onPressed: _advanceJobStage,
            style: ElevatedButton.styleFrom(
              backgroundColor: btnColor,
              foregroundColor: btnColor == const Color(0xFF00C853) ? Colors.black : Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              minimumSize: const Size(double.infinity, 50),
            ),
            child: Text(actionBtnText, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13)),
          ),
        ],
      ),
    );
  }

  Widget _buildIncomingJobModal() {
    final job = _incomingJob ?? {};
    return Container(
      color: Colors.black54,
      alignment: Alignment.bottomCenter,
      padding: const EdgeInsets.all(14),
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(28),
          boxShadow: const [
            BoxShadow(color: Colors.black38, blurRadius: 30, offset: Offset(0, 10)),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: DriverTheme.primaryBlue,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(job['title'] ?? 'INCOMING JOB', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w900)),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF3E0),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.timer_outlined, size: 14, color: DriverTheme.roadGold),
                      const SizedBox(width: 4),
                      Text('$_jobTimeLeft s', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: DriverTheme.roadGold)),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('₹${(job['fare'] as num?)?.toStringAsFixed(2) ?? '85.00'}', style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
                Text(job['distance'] ?? '4.2 km', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: DriverTheme.textMuted)),
              ],
            ),
            const Divider(height: 20),
            Row(
              children: [
                const Icon(Icons.circle, color: Color(0xFF00C853), size: 10),
                const SizedBox(width: 8),
                Expanded(child: Text(job['pickup'] ?? '', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold), maxLines: 1)),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                const Icon(Icons.location_on, color: DriverTheme.alertRed, size: 12),
                const SizedBox(width: 8),
                Expanded(child: Text(job['drop'] ?? '', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold), maxLines: 1)),
              ],
            ),
            const SizedBox(height: 10),
            Text('Customer / Guardian: ${job['customerName']} (${job['customerRating']})', style: const TextStyle(fontSize: 11, color: DriverTheme.textMuted)),
            if (job['isSchoolChild'] == true) ...[
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF3E0),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFFFB74D)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.school_rounded, color: Color(0xFFE65100), size: 16),
                        const SizedBox(width: 6),
                        Text(
                          'PASSENGER: ${job['childName'] ?? "Student"} (${job['gradeClass'] ?? "Class 5"})',
                          style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 11.5, color: Color(0xFFE65100)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'School: ${job['schoolName'] ?? "ABC Public School"}',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 11, color: DriverTheme.textDark),
                    ),
                    if (job['customerNote'] != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        'Note: ${job['customerNote']}',
                        style: const TextStyle(fontSize: 10, color: DriverTheme.textMuted),
                      ),
                    ],
                  ],
                ),
              ),
            ],
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _declineIncomingJob,
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    child: const Text('Decline', style: TextStyle(fontWeight: FontWeight.bold, color: DriverTheme.textDark)),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  flex: 2,
                  child: ElevatedButton(
                    onPressed: _acceptIncomingJob,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF00C853),
                      foregroundColor: Colors.black,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    child: const Text('ACCEPT JOB', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  // =========================================================================
  // TAB 2: EARNINGS & SETTLEMENTS
  // =========================================================================
  Widget _buildEarningsTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          const Text('Earnings & Settlements', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
          const SizedBox(height: 12),

          // Period Filter Tabs
          Container(
            padding: const EdgeInsets.all(4),
            decoration: BoxDecoration(
              color: DriverTheme.borderLight,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              children: [
                _buildPeriodTab('today', 'Today'),
                _buildPeriodTab('week', 'This Week'),
                _buildPeriodTab('month', 'This Month'),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Primary Wallet Card
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [DriverTheme.primaryBlue, Color(0xFF000666)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(24),
              boxShadow: [
                BoxShadow(color: DriverTheme.primaryBlue.withOpacity(0.3), blurRadius: 16, offset: const Offset(0, 6)),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('WITHDRAWABLE WALLET', style: TextStyle(color: DriverTheme.accentCyan, fontSize: 11, fontWeight: FontWeight.w900)),
                    Text('UPI Instant', style: TextStyle(color: Colors.white70, fontSize: 10)),
                  ],
                ),
                const SizedBox(height: 6),
                Text('₹${_walletBalance.toStringAsFixed(2)}', style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w900, color: Colors.white)),
                const SizedBox(height: 2),
                const Text('rajesh.driver@okhdfcbank (HDFC Bank)', style: TextStyle(color: Colors.white70, fontSize: 11)),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: () {
                    if (_walletBalance > 0) {
                      setState(() => _walletBalance = 0.0);
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Instant Payout of ₹1,420 transferred to your HDFC Bank account!'), backgroundColor: Color(0xFF00C853)),
                      );
                    }
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF00C853),
                    foregroundColor: Colors.black,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    minimumSize: const Size(double.infinity, 44),
                  ),
                  child: const Text('Instant Payout (₹0 Fee)', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13)),
                ),
              ],
            ),
          ),

          const SizedBox(height: 16),

          // Breakdown Card
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: DriverTheme.borderLight),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Financial Breakdown', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                SizedBox(height: 10),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Gross Customer Fares:', style: TextStyle(fontSize: 12, color: DriverTheme.textMuted)),
                    Text('₹1,578.00', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                  ],
                ),
                SizedBox(height: 6),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('NABIN Platform Fee (10%):', style: TextStyle(fontSize: 12, color: DriverTheme.alertRed)),
                    Text('-₹158.00', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: DriverTheme.alertRed)),
                  ],
                ),
                SizedBox(height: 6),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Cash Collected:', style: TextStyle(fontSize: 12, color: DriverTheme.textMuted)),
                    Text('₹320.00', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPeriodTab(String key, String label) {
    final isSelected = _selectedEarningsPeriod == key;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _selectedEarningsPeriod = key),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: isSelected ? Colors.white : Colors.transparent,
            borderRadius: BorderRadius.circular(12),
            boxShadow: isSelected ? [BoxShadow(color: Colors.black.withOpacity(0.06), blurRadius: 4)] : null,
          ),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: isSelected ? FontWeight.w900 : FontWeight.bold,
                color: isSelected ? DriverTheme.primaryBlue : DriverTheme.textMuted,
              ),
            ),
          ),
        ),
      ),
    );
  }

  // =========================================================================
  // TAB 3: ACCOUNT, PROFILE & VEHICLE COMPLIANCE
  // =========================================================================
  Widget _buildAccountTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Driver Profile & Compliance', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
          const SizedBox(height: 14),

          // Profile Header
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: DriverTheme.borderLight),
            ),
            child: Row(
              children: [
                Container(
                  width: 54,
                  height: 54,
                  decoration: const BoxDecoration(
                    color: DriverTheme.primaryBlue,
                    shape: BoxShape.circle,
                  ),
                  child: const Center(
                    child: Text('RK', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 18)),
                  ),
                ),
                const SizedBox(width: 14),
                const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Rajesh Kumar', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
                    Text('+91 98765 43210', style: TextStyle(fontSize: 12, color: DriverTheme.textMuted)),
                    SizedBox(height: 2),
                    Text('✓ KYC Approved • ⭐ 4.92 Rating', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF00C853))),
                  ],
                ),
              ],
            ),
          ),

          const SizedBox(height: 14),

          // Vehicle Switcher Card
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: DriverTheme.borderLight),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Active Vehicle', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: DriverTheme.primaryBlue)),
                    TextButton(
                      onPressed: _showVehicleSwitchDialog,
                      child: const Text('Switch Vehicle', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
                Row(
                  children: [
                    Text(_activeVehicleType == '2W' ? '🛵' : (_activeVehicleType == '4W' ? '🚗' : '🛺'), style: const TextStyle(fontSize: 24)),
                    const SizedBox(width: 10),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(_activeVehicleName, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                        Text('Plate: $_activeVehiclePlate', style: const TextStyle(fontSize: 11, color: DriverTheme.textMuted)),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ),

          const SizedBox(height: 14),

          // Documents & Compliance
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: DriverTheme.borderLight),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Compliance Documents', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
                SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Driving Licence (DL):', style: TextStyle(fontSize: 12, color: DriverTheme.textMuted)),
                    Text('Approved ✓', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF00C853))),
                  ],
                ),
                SizedBox(height: 4),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Vehicle Registration (RC):', style: TextStyle(fontSize: 12, color: DriverTheme.textMuted)),
                    Text('Approved ✓', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF00C853))),
                  ],
                ),
                SizedBox(height: 4),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Commercial Insurance:', style: TextStyle(fontSize: 12, color: DriverTheme.textMuted)),
                    Text('Active till 2027 ✓', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF00C853))),
                  ],
                ),
              ],
            ),
          ),

          const SizedBox(height: 14),

          // Safety SOS Trigger
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFFFFF0F0),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0xFFFFCDD2)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('24/7 Police & Safety SOS', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: DriverTheme.alertRed)),
                    Text('Emergency police & safety patrol dispatch', style: TextStyle(fontSize: 11, color: DriverTheme.textMuted)),
                  ],
                ),
                ElevatedButton(
                  onPressed: _triggerSosEmergency,
                  style: ElevatedButton.styleFrom(backgroundColor: DriverTheme.alertRed, foregroundColor: Colors.white),
                  child: const Text('SOS', style: TextStyle(fontWeight: FontWeight.w900)),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // Switch to Customer Super-App
          OutlinedButton(
            onPressed: () => context.go('/home'),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(double.infinity, 50),
              side: const BorderSide(color: DriverTheme.primaryBlue),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            ),
            child: const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.swap_horiz_rounded, color: DriverTheme.primaryBlue),
                SizedBox(width: 8),
                Text('Switch to Customer Super-App', style: TextStyle(fontWeight: FontWeight.bold, color: DriverTheme.primaryBlue)),
              ],
            ),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  void _showVehicleSwitchDialog() {
    showDialog(
      context: context,
      builder: (ctx) => SimpleDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        title: const Text('Switch Active Vehicle', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
        children: [
          SimpleDialogOption(
            onPressed: () {
              setState(() {
                _activeVehicleType = '2W';
                _activeVehicleName = 'Honda Activa 6G';
                _activeVehiclePlate = 'DL 2S 9182';
              });
              Navigator.pop(ctx);
            },
            child: const Text('🛵 2W Bike • Honda Activa (DL 2S 9182)', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
          SimpleDialogOption(
            onPressed: () {
              setState(() {
                _activeVehicleType = '3W';
                _activeVehicleName = 'Bajaj RE Compact CNG';
                _activeVehiclePlate = 'DL 1RA 4892';
              });
              Navigator.pop(ctx);
            },
            child: const Text('🛺 3W Auto • Bajaj RE (DL 1RA 4892)', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
          SimpleDialogOption(
            onPressed: () {
              setState(() {
                _activeVehicleType = '4W';
                _activeVehicleName = 'Maruti Dzire Tour';
                _activeVehiclePlate = 'DL 1ZB 7741';
              });
              Navigator.pop(ctx);
            },
            child: const Text('🚗 4W Cab • Maruti Dzire (DL 1ZB 7741)', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DriverTheme.bgLight,
      body: SafeArea(
        child: IndexedStack(
          index: _currentTab,
          children: [
            _buildDriverHomeTab(),
            _buildEarningsTab(),
            _buildAccountTab(),
          ],
        ),
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentTab,
        onTap: (idx) => setState(() => _currentTab = idx),
        selectedItemColor: DriverTheme.primaryBlue,
        unselectedItemColor: DriverTheme.textMuted,
        selectedLabelStyle: const TextStyle(fontWeight: FontWeight.w900, fontSize: 11),
        unselectedLabelStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 11),
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.map_rounded), label: 'Drive'),
          BottomNavigationBarItem(icon: Icon(Icons.account_balance_wallet_rounded), label: 'Earnings'),
          BottomNavigationBarItem(icon: Icon(Icons.person_rounded), label: 'Account'),
        ],
      ),
    );
  }
}
