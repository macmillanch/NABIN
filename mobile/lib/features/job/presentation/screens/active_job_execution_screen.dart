import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../core/theme/driver_theme.dart';
import '../../../../core/widgets/driver_button.dart';
import '../../../../core/widgets/driver_card.dart';
import '../../../../core/widgets/driver_map_view.dart';

class ActiveJobExecutionScreen extends StatefulWidget {
  final Map<String, dynamic>? jobData;
  const ActiveJobExecutionScreen({super.key, this.jobData});

  @override
  State<ActiveJobExecutionScreen> createState() => _ActiveJobExecutionScreenState();
}

class _ActiveJobExecutionScreenState extends State<ActiveJobExecutionScreen> {
  int _stage = 0; // 0: Nav to Pickup, 1: Arrived & Pickup Verification/OTP, 2: Active Transit, 3: Arrived at Drop & Delivery OTP, 4: Complete & Receipt
  final TextEditingController _otpController = TextEditingController(text: '7729');

  Future<void> _launchPhoneCall(String phoneNumber) async {
    final Uri launchUri = Uri(scheme: 'tel', path: phoneNumber);
    try {
      if (await canLaunchUrl(launchUri)) {
        await launchUrl(launchUri, mode: LaunchMode.externalApplication);
      } else {
        await launchUrl(launchUri);
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Opening Phone Dialer with $phoneNumber...')),
        );
      }
    }
  }

  Map<String, dynamic> get job {
    return widget.jobData ?? {
      'type': 'RIDE',
      'title': 'Passenger Ride (3W Auto)',
      'pickup': 'Flat 402, Civil Lines, Delhi',
      'drop': 'ABC Public School, Kamalanagar',
      'distance': '3.8 km (11 mins)',
      'fare': '₹85.00',
      'customer': 'Rahul Sharma (Guardian)',
      'customerPhone': '+919876543210',
      'color': DriverTheme.rideBadge,
      'icon': Icons.person_pin_circle,
      'isForSomeoneElse': true,
      'isSchoolChild': true,
      'childName': 'Rahul Chakma',
      'childPhoto': 'https://images.unsplash.com/photo-1543332164-6e82f355badc?w=200',
      'schoolName': 'ABC Public School',
      'gradeClass': 'Class 5',
      'section': 'Section B',
      'specialInstructions': 'Please verify with security guard at Gate 2.',
    };
  }

  String get jobType => job['type'] as String? ?? 'RIDE';
  bool get isForSomeoneElse => job['isForSomeoneElse'] as bool? ?? true;
  bool get isSchoolChild => job['isSchoolChild'] as bool? ?? true;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DriverTheme.bgLight,
      body: Stack(
        children: [
          // 1. Vector Map Viewport showing active route
          Positioned.fill(
            child: DriverMapView(
              vehicleType: '3W',
              showRoute: true,
              pickupLabel: job['pickup'] as String?,
              dropLabel: job['drop'] as String?,
            ),
          ),

          // 2. Top Header Bar with Emergency SOS & Passenger Tag
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: DriverTheme.borderLight),
                          boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 8)],
                        ),
                        child: Row(
                          children: [
                            Icon(job['icon'] as IconData, color: job['color'] as Color, size: 18),
                            const SizedBox(width: 8),
                            Text(
                              job['title'] as String,
                              style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: DriverTheme.textDark),
                            ),
                          ],
                        ),
                      ),

                      // Emergency SOS Button
                      GestureDetector(
                        onTap: () {
                          showDialog(
                            context: context,
                            builder: (ctx) => AlertDialog(
                              title: const Row(
                                children: [
                                  Icon(Icons.shield, color: DriverTheme.alertRed),
                                  SizedBox(width: 8),
                                  Text('Emergency SOS'),
                                ],
                              ),
                              content: const Text('Connecting to 24/7 Police Dispatch (112) & NABIN Driver Safety Control Room.'),
                              actions: [
                                TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
                                ElevatedButton(
                                  onPressed: () {
                                    Navigator.pop(ctx);
                                    _launchPhoneCall('112');
                                  },
                                  style: ElevatedButton.styleFrom(backgroundColor: DriverTheme.alertRed),
                                  child: const Text('Dial Police (112)', style: TextStyle(color: Colors.white)),
                                ),
                              ],
                            ),
                          );
                        },
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(
                            color: DriverTheme.alertRed,
                            borderRadius: BorderRadius.circular(18),
                            boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 8)],
                          ),
                          child: const Row(
                            children: [
                              Icon(Icons.warning, color: Colors.white, size: 16),
                              SizedBox(width: 4),
                              Text('SOS', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 12)),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),

                  // Prominent Banner for "Booked for Someone Else / School Child"
                  if (isForSomeoneElse) ...[
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: isSchoolChild ? const Color(0xFFFF6D00) : DriverTheme.primaryBlue,
                        borderRadius: BorderRadius.circular(12),
                        boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 6)],
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(isSchoolChild ? Icons.school_rounded : Icons.person_rounded, color: Colors.white, size: 14),
                          const SizedBox(width: 6),
                          Text(
                            isSchoolChild
                                ? 'BOOKED FOR SOMEONE ELSE: SCHOOL CHILD PASSENGER'
                                : 'BOOKED FOR SOMEONE ELSE',
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 11, letterSpacing: 0.5),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),

          // 3. Dynamic Bottom Navigation Sheet
          Positioned(
            left: 16,
            right: 16,
            bottom: 20,
            child: _buildStageBottomSheet(),
          ),
        ],
      ),
    );
  }

  Widget _buildStageBottomSheet() {
    // Stage 0: Navigating to Pickup Point
    if (_stage == 0) {
      return DriverCard(
        padding: const EdgeInsets.all(20),
        borderRadius: 24,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('NAVIGATING TO PICKUP', style: TextStyle(color: DriverTheme.primaryBlue, fontWeight: FontWeight.w900, fontSize: 12, letterSpacing: 0.8)),
                Text(job['fare'] as String, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: DriverTheme.textDark)),
              ],
            ),
            const SizedBox(height: 10),

            // School Child Comprehensive Identification & School Info Card
            if (isSchoolChild) ...[
              _buildSchoolChildInfoCard(),
              const SizedBox(height: 10),
            ],

            Row(
              children: [
                const Icon(Icons.radio_button_checked, color: DriverTheme.onlineGreen, size: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    job['pickup'] as String,
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: DriverTheme.textDark),
                  ),
                ),
              ],
            ),
            if (job['specialInstructions'] != null) ...[
              const SizedBox(height: 4),
              Text(
                'Note: ${job['specialInstructions']}',
                style: const TextStyle(fontSize: 11, fontStyle: FontStyle.italic, color: DriverTheme.textMuted),
              ),
            ],
            const SizedBox(height: 6),
            InkWell(
              onTap: () => _launchPhoneCall(job['customerPhone'] as String? ?? '+919876543210'),
              borderRadius: BorderRadius.circular(8),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    const Icon(Icons.phone_outlined, size: 14, color: DriverTheme.primaryBlue),
                    const SizedBox(width: 6),
                    Text(
                      'Booking Person / Guardian: ${job['customer']}',
                      style: const TextStyle(color: DriverTheme.primaryBlue, fontWeight: FontWeight.bold, fontSize: 12),
                    ),
                    const SizedBox(width: 4),
                    const Text('• Tap to Call', style: TextStyle(color: DriverTheme.textMuted, fontSize: 11)),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),
            DriverButton(
              text: jobType == 'FOOD' ? 'Arrived at Restaurant Kitchen' : (jobType == 'PARCEL' ? 'Arrived at Sender Pickup' : (isSchoolChild ? 'Arrived at Child Pickup Location' : 'Arrived at Passenger Location')),
              color: DriverTheme.primaryBlue,
              onPressed: () => setState(() => _stage = 1),
            ),
          ],
        ),
      );
    }

    // Stage 1: Arrived at Pickup (Enter Start/Pickup OTP)
    if (_stage == 1) {
      return DriverCard(
        padding: const EdgeInsets.all(20),
        borderRadius: 24,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              jobType == 'FOOD'
                  ? 'KITCHEN ORDER VERIFICATION'
                  : (jobType == 'PARCEL' ? 'ENTER SENDER PICKUP OTP' : (isSchoolChild ? 'GUARDIAN PICKUP VERIFICATION OTP' : 'ENTER PASSENGER START OTP')),
              style: const TextStyle(color: DriverTheme.roadGold, fontWeight: FontWeight.w900, fontSize: 12, letterSpacing: 0.8),
            ),
            const SizedBox(height: 10),
            if (isSchoolChild) ...[
              const Text(
                'Identify child with school uniform & guardian. Verify 4-digit OTP provided by booking person/guardian:',
                style: TextStyle(color: DriverTheme.textMuted, fontSize: 12),
              ),
            ] else ...[
              Text(
                jobType == 'PARCEL' ? 'Ask sender for 4-digit Pickup OTP' : 'Ask passenger for 4-digit Ride Start OTP',
                style: const TextStyle(color: DriverTheme.textMuted, fontSize: 13),
              ),
            ],
            const SizedBox(height: 12),
            TextField(
              controller: _otpController,
              keyboardType: TextInputType.number,
              maxLength: 4,
              style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w900, color: DriverTheme.primaryBlue, letterSpacing: 8),
              decoration: InputDecoration(
                hintText: '••••',
                filled: true,
                fillColor: const Color(0xFFF1F5F9),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
                counterText: '',
              ),
            ),
            const SizedBox(height: 14),
            DriverButton(
              text: isSchoolChild ? 'Verify OTP & Start School Transit' : (jobType == 'PARCEL' ? 'Verify OTP & Collect Parcel' : 'Verify OTP & Start Ride'),
              color: DriverTheme.onlineGreen,
              textColor: Colors.black,
              onPressed: () => setState(() => _stage = 2),
            ),
          ],
        ),
      );
    }

    // Stage 2: Active Transit (Heading to Drop Location)
    if (_stage == 2) {
      return DriverCard(
        padding: const EdgeInsets.all(20),
        borderRadius: 24,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  isSchoolChild ? 'SCHOOL TRANSIT IN PROGRESS' : 'TRIP IN TRANSIT',
                  style: const TextStyle(color: DriverTheme.onlineGreen, fontWeight: FontWeight.w900, fontSize: 12, letterSpacing: 0.8),
                ),
                Text(job['fare'] as String, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18, color: DriverTheme.textDark)),
              ],
            ),
            const SizedBox(height: 10),
            // School Child Details in Transit
            if (isSchoolChild) ...[
              _buildSchoolChildInfoCard(),
              const SizedBox(height: 10),
            ],

            Row(
              children: [
                const Icon(Icons.location_on, color: DriverTheme.alertRed, size: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    job['drop'] as String,
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: DriverTheme.textDark),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              '${job['distance']} remaining • Live GPS Telemetry broadcasting to Guardian',
              style: const TextStyle(color: DriverTheme.textMuted, fontSize: 11.5),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  flex: 6,
                  child: DriverButton(
                    text: isSchoolChild ? 'Arrived at Gate' : 'Arrived at Drop',
                    color: DriverTheme.primaryBlue,
                    onPressed: () => setState(() => _stage = 3),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 4,
                  child: OutlinedButton(
                    onPressed: () {
                      showDialog(
                        context: context,
                        builder: (ctx) => AlertDialog(
                          title: const Row(
                            children: [
                              Icon(Icons.pan_tool_rounded, color: Color(0xFFFF6D00), size: 20),
                              SizedBox(width: 8),
                              Text('Early Stop Requested', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                            ],
                          ),
                          content: const Text(
                            'Passenger requested to end the ride early at current location.\n\nRule: Guaranteed minimum 50% fare or distance covered fare applies to driver earnings.',
                            style: TextStyle(fontSize: 12),
                          ),
                          actions: [
                            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
                            ElevatedButton(
                              onPressed: () {
                                Navigator.pop(ctx);
                                setState(() => _stage = 4);
                              },
                              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFFF6D00)),
                              child: const Text('End Trip & Collect Fare', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                            ),
                          ],
                        ),
                      );
                    },
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: Color(0xFFFF6D00)),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    child: const Text('Early Stop', style: TextStyle(color: Color(0xFFFF6D00), fontWeight: FontWeight.bold, fontSize: 12)),
                  ),
                ),
              ],
            ),
          ],
        ),
      );
    }

    // Stage 3: Arrived at Drop & Delivery/Dropoff Handover
    if (_stage == 3) {
      return DriverCard(
        padding: const EdgeInsets.all(20),
        borderRadius: 24,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              isSchoolChild ? 'SAFE SCHOOL GATE HANDOVER' : 'TRIP COMPLETION',
              style: const TextStyle(color: DriverTheme.roadGold, fontWeight: FontWeight.w900, fontSize: 12, letterSpacing: 0.8),
            ),
            const SizedBox(height: 10),
            if (isSchoolChild) ...[
              _buildSchoolChildInfoCard(),
              const SizedBox(height: 10),
            ],
            Text(
              isSchoolChild
                  ? 'Safely assist ${job['childName'] ?? "passenger"} to the school entrance gate / security guard.'
                  : 'Arrived at destination. Collect payment or confirm online auto-debit.',
              style: const TextStyle(color: DriverTheme.textMuted, fontSize: 13),
            ),
            const SizedBox(height: 14),
            DriverButton(
              text: isSchoolChild ? 'Confirm School Dropoff & Complete Ride' : 'Complete Trip & Collect Fare',
              color: DriverTheme.onlineGreen,
              textColor: Colors.black,
              onPressed: () => setState(() => _stage = 4),
            ),
          ],
        ),
      );
    }

    // Stage 4: Completed & Summary
    return DriverCard(
      padding: const EdgeInsets.all(20),
      borderRadius: 24,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.check_circle, color: DriverTheme.onlineGreen, size: 24),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Trip Completed Successfully!', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: DriverTheme.textDark)),
                    Text('Earned ${job['fare']} • Added to Driver Wallet', style: const TextStyle(color: DriverTheme.textMuted, fontSize: 12)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          DriverButton(
            text: 'Back to Driver Console',
            color: DriverTheme.primaryBlue,
            onPressed: () => context.pop(),
          ),
        ],
      ),
    );
  }

  Widget _buildSchoolChildInfoCard() {
    final childName = job['childName'] as String? ?? 'Rahul Chakma';
    final schoolName = job['schoolName'] as String? ?? 'ABC Public School';
    final gradeClass = job['gradeClass'] as String? ?? 'Class 5';
    final section = job['section'] as String?;
    final guardianName = job['customer'] as String? ?? 'Rahul Sharma (Guardian)';
    final guardianPhone = job['customerPhone'] as String? ?? '+919876543210';
    final instructions = job['specialInstructions'] as String? ?? 'Wait with security guard at Gate 2.';

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF8F1),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFFFCC80), width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: const BoxDecoration(
                  gradient: LinearGradient(colors: [Color(0xFFFF6D00), Color(0xFFFF9E80)]),
                  shape: BoxShape.circle,
                ),
                child: const Center(
                  child: Icon(Icons.school_rounded, color: Colors.white, size: 22),
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
                          childName,
                          style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: DriverTheme.textDark),
                        ),
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFF6D00),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            '$gradeClass${section != null && section.isNotEmpty ? " ($section)" : ""}',
                            style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.white),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '🏫 $schoolName',
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFFE65100)),
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.phone_in_talk_rounded, color: Color(0xFF00C853), size: 22),
                tooltip: 'Call Guardian',
                onPressed: () => _launchPhoneCall(guardianPhone),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: const Color(0xFFFFE0B2)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.info_outline_rounded, size: 13, color: Color(0xFFE65100)),
                    const SizedBox(width: 4),
                    Text(
                      'Guardian: $guardianName',
                      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFFE65100)),
                    ),
                  ],
                ),
                if (instructions.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    'Instructions: $instructions',
                    style: const TextStyle(fontSize: 11, color: DriverTheme.textDark),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
