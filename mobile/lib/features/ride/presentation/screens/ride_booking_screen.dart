import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/driver_map_view.dart';
import '../../../../core/models/school_model.dart';
import '../../../../core/models/child_model.dart';
import '../../../../core/models/passenger_booking_info.dart';
import '../../../../core/models/school_child_repository.dart';

class RideBookingScreen extends StatefulWidget {
  const RideBookingScreen({super.key});

  @override
  State<RideBookingScreen> createState() => _RideBookingScreenState();
}

class _RideBookingScreenState extends State<RideBookingScreen> {
  int _selectedVehicleIndex = 1; // 0: 2W, 1: 3W, 2: 4W

  // Booking Type: 'FOR_ME' vs 'FOR_SOMEONE_ELSE'
  String _bookingType = 'FOR_ME';
  String _passengerCategory = 'SCHOOL_CHILD'; // 'SCHOOL_CHILD', 'ADULT', 'ELDERLY', 'OTHER'

  // School Child Selected Profile & School
  SavedChild? _selectedChild;
  SavedSchool? _selectedSchool;

  // Active Ride Overrides (Defaults populated from selected child/school)
  String _childName = 'Rahul Chakma';
  String _schoolName = 'ABC Public School';
  String _gradeClass = 'Class 5';
  String? _section = 'Section B'; // Strictly optional
  String _guardianName = 'Rahul Sharma (Father)';
  String _guardianPhone = '+91 98765 43210';
  String _pickupAddress = 'Flat 402, Civil Lines, Delhi';
  String _destinationAddress = 'ABC Public School, Kamalanagar';
  String _specialInstructions = 'Please verify with security guard at Gate 2.';
  
  // School Timing & Ride Offsets
  String _schoolTimingSummary = '8:30 AM – 2:30 PM • Mon–Fri';
  String _morningPickupTime = '07:45 AM';
  String _schoolArrivalTime = '08:15 AM';
  String _afternoonPickupTime = '02:30 PM';
  String _homeArrivalTime = '03:00 PM';

  final List<Map<String, dynamic>> _vehicles = [
    {
      'name': 'Bike',
      'desc': 'Nearest: 360m away • 2 mins ETA',
      'capacity': '1 Person',
      'fare': '₹45.00',
      'icon': Icons.two_wheeler_rounded,
      'color': AppTheme.serviceRide,
    },
    {
      'name': 'Auto',
      'desc': 'Nearest: 310m away • 2 mins ETA',
      'capacity': '3 Persons',
      'fare': '₹85.00',
      'icon': Icons.electric_rickshaw_rounded,
      'color': AppTheme.serviceRide,
    },
    {
      'name': 'Car',
      'desc': 'Nearest: 580m away • 4 mins ETA',
      'capacity': '4 Persons',
      'fare': '₹160.00',
      'icon': Icons.local_taxi_rounded,
      'color': AppTheme.serviceRide,
    },
  ];

  @override
  void initState() {
    super.initState();
    _initDefaults();
  }

  void _initDefaults() {
    final repo = SchoolChildRepository.instance;
    if (repo.children.isNotEmpty) {
      _selectedChild = repo.children.first;
      _childName = _selectedChild!.fullName;
      _gradeClass = _selectedChild!.gradeClass;
      _section = _selectedChild!.section;
      _guardianName = _selectedChild!.guardianName;
      _guardianPhone = _selectedChild!.guardianPhone;
      _pickupAddress = _selectedChild!.defaultPickupAddress;
      _specialInstructions = _selectedChild!.specialInstructions ?? _specialInstructions;
    }
    if (repo.schools.isNotEmpty) {
      _selectedSchool = repo.schools.first;
      _schoolName = _selectedSchool!.name;
      _destinationAddress = '${_selectedSchool!.name}, ${_selectedSchool!.address}';
      _schoolTimingSummary = _selectedSchool!.generalTimingSummary;
    }
  }

  void _onSelectChild(SavedChild child) {
    setState(() {
      _selectedChild = child;
      _childName = child.fullName;
      _gradeClass = child.gradeClass;
      _section = child.section;
      _guardianName = child.guardianName;
      _guardianPhone = child.guardianPhone;
      _pickupAddress = child.defaultPickupAddress;
      if (child.specialInstructions != null && child.specialInstructions!.isNotEmpty) {
        _specialInstructions = child.specialInstructions!;
      }

      // If child's school is available in repo, auto-select it
      final repo = SchoolChildRepository.instance;
      final matchedSchool = repo.schools.firstWhere((s) => s.id == child.schoolId, orElse: () => repo.schools.first);
      _selectedSchool = matchedSchool;
      _schoolName = matchedSchool.name;
      _destinationAddress = '${matchedSchool.name}, ${matchedSchool.address}';
      _schoolTimingSummary = matchedSchool.generalTimingSummary;
    });
  }

  void _onSelectSchool(SavedSchool school) {
    setState(() {
      _selectedSchool = school;
      _schoolName = school.name;
      _destinationAddress = '${school.name}, ${school.address}';
      _schoolTimingSummary = school.generalTimingSummary;
    });
  }

  void _showOverrideDetailsModal(BuildContext context) {
    final nameCtrl = TextEditingController(text: _childName);
    final schoolCtrl = TextEditingController(text: _schoolName);
    final classCtrl = TextEditingController(text: _gradeClass);
    final sectionCtrl = TextEditingController(text: _section ?? '');
    final guardianCtrl = TextEditingController(text: _guardianName);
    final phoneCtrl = TextEditingController(text: _guardianPhone);
    final pickupCtrl = TextEditingController(text: _pickupAddress);
    final destCtrl = TextEditingController(text: _destinationAddress);
    final noteCtrl = TextEditingController(text: _specialInstructions);
    final morningPickupCtrl = TextEditingController(text: _morningPickupTime);
    final schoolArrivalCtrl = TextEditingController(text: _schoolArrivalTime);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) => Container(
          height: MediaQuery.of(context).size.height * 0.9,
          decoration: const BoxDecoration(
            color: AppTheme.surfaceContainerLowest,
            borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
          ),
          padding: EdgeInsets.fromLTRB(20, 16, 20, MediaQuery.of(context).viewInsets.bottom + 20),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.edit_note_rounded, color: AppTheme.primary, size: 24),
                        SizedBox(width: 8),
                        Text('Edit Ride Details for this Trip', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: AppTheme.onSurface)),
                      ],
                    ),
                    IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => Navigator.pop(ctx)),
                  ],
                ),
                const Text('Customize details for this single booking without modifying your saved template.', style: TextStyle(fontSize: 11.5, color: AppTheme.onSurfaceVariant)),
                const SizedBox(height: 14),

                // Child Name
                const Text("Child's Full Name *", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                const SizedBox(height: 4),
                TextField(
                  controller: nameCtrl,
                  decoration: InputDecoration(
                    prefixIcon: const Icon(Icons.person_outline, size: 18),
                    filled: true,
                    fillColor: AppTheme.surfaceContainerLow,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 10),

                // School Name
                const Text("Destination School *", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                const SizedBox(height: 4),
                TextField(
                  controller: schoolCtrl,
                  decoration: InputDecoration(
                    prefixIcon: const Icon(Icons.school_outlined, size: 18),
                    filled: true,
                    fillColor: AppTheme.surfaceContainerLow,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 10),

                // Class & Section
                Row(
                  children: [
                    Expanded(
                      flex: 5,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Class *', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                          const SizedBox(height: 4),
                          TextField(
                            controller: classCtrl,
                            decoration: InputDecoration(
                              filled: true,
                              fillColor: AppTheme.surfaceContainerLow,
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      flex: 5,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Section (Optional)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                          const SizedBox(height: 4),
                          TextField(
                            controller: sectionCtrl,
                            decoration: InputDecoration(
                              hintText: 'e.g. Section B',
                              filled: true,
                              fillColor: AppTheme.surfaceContainerLow,
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),

                // Pickup & Destination
                const Text('Pickup Location *', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                const SizedBox(height: 4),
                TextField(
                  controller: pickupCtrl,
                  decoration: InputDecoration(
                    prefixIcon: const Icon(Icons.radio_button_checked, color: Color(0xFF00C853), size: 18),
                    filled: true,
                    fillColor: AppTheme.surfaceContainerLow,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 10),

                const Text('Destination / Drop Gate *', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                const SizedBox(height: 4),
                TextField(
                  controller: destCtrl,
                  decoration: InputDecoration(
                    prefixIcon: const Icon(Icons.location_on_rounded, color: Color(0xFFFF3D00), size: 18),
                    filled: true,
                    fillColor: AppTheme.surfaceContainerLow,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 10),

                // Ride Timings
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Home Pickup Time', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                          const SizedBox(height: 4),
                          TextField(
                            controller: morningPickupCtrl,
                            decoration: InputDecoration(
                              filled: true,
                              fillColor: AppTheme.surfaceContainerLow,
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('School Arrival Time', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                          const SizedBox(height: 4),
                          TextField(
                            controller: schoolArrivalCtrl,
                            decoration: InputDecoration(
                              filled: true,
                              fillColor: AppTheme.surfaceContainerLow,
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),

                // Guardian Details
                const Text('Parent / Guardian Name & Phone *', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: guardianCtrl,
                        decoration: InputDecoration(
                          hintText: 'Guardian Name',
                          filled: true,
                          fillColor: AppTheme.surfaceContainerLow,
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: phoneCtrl,
                        keyboardType: TextInputType.phone,
                        decoration: InputDecoration(
                          hintText: 'Phone',
                          filled: true,
                          fillColor: AppTheme.surfaceContainerLow,
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),

                // Special Instructions
                const Text('Special Pickup Instructions (Optional)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                const SizedBox(height: 4),
                TextField(
                  controller: noteCtrl,
                  decoration: InputDecoration(
                    hintText: 'e.g. Wait at security guard station near gate 2',
                    filled: true,
                    fillColor: AppTheme.surfaceContainerLow,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 18),

                ElevatedButton(
                  onPressed: () {
                    setState(() {
                      _childName = nameCtrl.text.trim();
                      _schoolName = schoolCtrl.text.trim();
                      _gradeClass = classCtrl.text.trim();
                      _section = sectionCtrl.text.trim().isNotEmpty ? sectionCtrl.text.trim() : null;
                      _guardianName = guardianCtrl.text.trim();
                      _guardianPhone = phoneCtrl.text.trim();
                      _pickupAddress = pickupCtrl.text.trim();
                      _destinationAddress = destCtrl.text.trim();
                      _specialInstructions = noteCtrl.text.trim();
                      _morningPickupTime = morningPickupCtrl.text.trim();
                      _schoolArrivalTime = schoolArrivalCtrl.text.trim();
                    });
                    Navigator.pop(ctx);
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Trip details customized for this booking!')),
                    );
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primaryContainer,
                    foregroundColor: Colors.white,
                    minimumSize: const Size(double.infinity, 50),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                  child: const Text('Apply Changes to this Ride', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _openLocationSearchSheet({required bool isPickup}) {
    final List<Map<String, dynamic>> presetLocations = [
      {'name': 'Flat 402, Civil Lines, Delhi', 'sub': 'Home • North Delhi', 'icon': Icons.home_rounded, 'tag': 'Home'},
      {'name': 'ABC Public School, Kamalanagar', 'sub': 'Kamalanagar Main Road, Gate 2', 'icon': Icons.school_rounded, 'tag': 'School'},
      {'name': 'DPS RK Puram, Sector 12', 'sub': 'Kaifi Azmi Marg, New Delhi', 'icon': Icons.school_rounded, 'tag': 'School'},
      {'name': 'Connaught Place Inner Circle', 'sub': 'Block B, Rajiv Chowk, New Delhi', 'icon': Icons.business_center_rounded, 'tag': 'Transit'},
      {'name': 'Delhi University (North Campus)', 'sub': 'Vishwavidyalaya Marg, Delhi', 'icon': Icons.account_balance_rounded, 'tag': 'University'},
      {'name': 'Indira Gandhi Int\'l Airport (T3)', 'sub': 'Departures Forecourt, New Delhi', 'icon': Icons.flight_takeoff_rounded, 'tag': 'Airport'},
      {'name': 'AIIMS Hospital Ansari Nagar', 'sub': 'Sri Aurobindo Marg, New Delhi', 'icon': Icons.local_hospital_rounded, 'tag': 'Hospital'},
      {'name': 'Select Citywalk Mall Saket', 'sub': 'A-3 District Centre, Saket', 'icon': Icons.shopping_bag_rounded, 'tag': 'Mall'},
      {'name': 'Cyber Hub DLF Phase 2', 'sub': 'NH-8, Gurugram, Haryana', 'icon': Icons.apartment_rounded, 'tag': 'Business'},
      {'name': 'Karol Bagh Metro Station', 'sub': 'Pusa Road, Karol Bagh, Delhi', 'icon': Icons.train_rounded, 'tag': 'Metro'},
      {'name': 'Chandni Chowk / Red Fort', 'sub': 'Netaji Subhash Marg, Old Delhi', 'icon': Icons.attractions_rounded, 'tag': 'Landmark'},
    ];

    String searchQuery = '';

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) {
          final filtered = presetLocations.where((loc) {
            final name = loc['name'].toString().toLowerCase();
            final sub = loc['sub'].toString().toLowerCase();
            final tag = loc['tag'].toString().toLowerCase();
            final q = searchQuery.toLowerCase();
            return name.contains(q) || sub.contains(q) || tag.contains(q);
          }).toList();

          return Container(
            height: MediaQuery.of(context).size.height * 0.78,
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
            ),
            padding: EdgeInsets.only(
              left: 20,
              right: 20,
              top: 14,
              bottom: MediaQuery.of(context).viewInsets.bottom + 20,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 44,
                    height: 5,
                    decoration: BoxDecoration(
                      color: Colors.grey.shade300,
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: isPickup ? const Color(0xFFE8F5E9) : const Color(0xFFFFEBEE),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        isPickup ? Icons.radio_button_checked : Icons.location_on_rounded,
                        color: isPickup ? const Color(0xFF00C853) : const Color(0xFFFF3D00),
                        size: 20,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Text(
                      isPickup ? 'Search Pickup Location' : 'Search Drop Location',
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppTheme.onSurface),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                TextField(
                  autofocus: true,
                  onChanged: (val) => setModalState(() => searchQuery = val),
                  decoration: InputDecoration(
                    hintText: isPickup ? 'Enter pickup landmark or address...' : 'Enter destination or landmark...',
                    prefixIcon: const Icon(Icons.search_rounded, color: AppTheme.primary),
                    suffixIcon: searchQuery.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear_rounded),
                            onPressed: () => setModalState(() => searchQuery = ''),
                          )
                        : null,
                    filled: true,
                    fillColor: AppTheme.surfaceContainerLow,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(16),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                const Text('Suggested Landmarks & Recent Places',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.onSurfaceVariant)),
                const SizedBox(height: 8),
                Expanded(
                  child: filtered.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const Icon(Icons.location_off_rounded, size: 40, color: Colors.grey),
                              const SizedBox(height: 8),
                              Text('No places found for "$searchQuery"', style: const TextStyle(color: Colors.grey)),
                              const SizedBox(height: 12),
                              if (searchQuery.trim().isNotEmpty)
                                ElevatedButton(
                                  onPressed: () {
                                    setState(() {
                                      if (isPickup) {
                                        _pickupAddress = searchQuery.trim();
                                      } else {
                                        _destinationAddress = searchQuery.trim();
                                      }
                                    });
                                    Navigator.pop(ctx);
                                  },
                                  child: Text('Use "$searchQuery"'),
                                ),
                            ],
                          ),
                        )
                      : ListView.separated(
                          itemCount: filtered.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (context, i) {
                            final item = filtered[i];
                            return ListTile(
                              leading: Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: AppTheme.surfaceContainerLow,
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Icon(item['icon'] as IconData, color: AppTheme.primary, size: 20),
                              ),
                              title: Text(item['name'] as String, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13.5)),
                              subtitle: Text(item['sub'] as String, style: const TextStyle(fontSize: 11, color: AppTheme.onSurfaceVariant)),
                              trailing: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: AppTheme.surfaceContainerLow,
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text(item['tag'] as String, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppTheme.primary)),
                              ),
                              onTap: () {
                                setState(() {
                                  if (isPickup) {
                                    _pickupAddress = item['name'] as String;
                                  } else {
                                    _destinationAddress = item['name'] as String;
                                  }
                                });
                                Navigator.pop(ctx);
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                    content: Text('${isPickup ? 'Pickup' : 'Drop'} set to: ${item['name']}'),
                                    duration: const Duration(seconds: 2),
                                  ),
                                );
                              },
                            );
                          },
                        ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final repo = SchoolChildRepository.instance;
    final schools = repo.schools;
    final children = repo.children;

    final isForSomeoneElse = _bookingType == 'FOR_SOMEONE_ELSE';
    final isSchoolChild = isForSomeoneElse && _passengerCategory == 'SCHOOL_CHILD';

    return Scaffold(
      backgroundColor: AppTheme.background,
      body: Stack(
        children: [
          // 1. Vector Daylight Map Viewport (Updates with selected pickup & drop)
          Positioned.fill(
            child: DriverMapView(
              vehicleType: _selectedVehicleIndex == 0 ? '2W' : (_selectedVehicleIndex == 1 ? '3W' : '4W'),
              showRoute: true,
              showNearbyDrivers: true,
              pickupLabel: _pickupAddress,
              dropLabel: _destinationAddress,
            ),
          ),

          // 2. Top Header & Booking Options HUD
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      GestureDetector(
                        onTap: () => context.pop(),
                        child: Container(
                          padding: const EdgeInsets.all(10),
                          decoration: const BoxDecoration(
                            color: AppTheme.surfaceContainerLowest,
                            shape: BoxShape.circle,
                            boxShadow: [BoxShadow(color: Colors.black12, blurRadius: 8)],
                          ),
                          child: const Icon(Icons.arrow_back_ios_new_rounded, color: AppTheme.onSurface, size: 20),
                        ),
                      ),

                      // "Who is riding?" Pill Toggle
                      Container(
                        padding: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          color: AppTheme.surfaceContainerLowest,
                          borderRadius: BorderRadius.circular(24),
                          boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 8)],
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            GestureDetector(
                              onTap: () => setState(() => _bookingType = 'FOR_ME'),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                                decoration: BoxDecoration(
                                  color: !isForSomeoneElse ? AppTheme.primary : Colors.transparent,
                                  borderRadius: BorderRadius.circular(18),
                                ),
                                child: Text(
                                  'For Me',
                                  style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.bold,
                                    color: !isForSomeoneElse ? Colors.white : AppTheme.onSurface,
                                  ),
                                ),
                              ),
                            ),
                            GestureDetector(
                              onTap: () => setState(() => _bookingType = 'FOR_SOMEONE_ELSE'),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                                decoration: BoxDecoration(
                                  color: isForSomeoneElse ? const Color(0xFFFF6D00) : Colors.transparent,
                                  borderRadius: BorderRadius.circular(18),
                                ),
                                child: Text(
                                  'For Someone Else',
                                  style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.bold,
                                    color: isForSomeoneElse ? Colors.white : AppTheme.onSurface,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),

                  // For Someone Else: Passenger Category Selector Bar
                  if (isForSomeoneElse) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      decoration: BoxDecoration(
                        color: AppTheme.surfaceContainerLowest,
                        borderRadius: BorderRadius.circular(18),
                        boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 8)],
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceAround,
                        children: [
                          _buildCategoryChip('SCHOOL_CHILD', '🎒 School Child', const Color(0xFFFF6D00)),
                          _buildCategoryChip('ADULT', '👤 Adult', AppTheme.primary),
                          _buildCategoryChip('ELDERLY', '👵 Elderly', const Color(0xFF7B1FA2)),
                          _buildCategoryChip('OTHER', '📦 Other', const Color(0xFF00796B)),
                        ],
                      ),
                    ),
                    const SizedBox(height: 8),
                  ],

                  // Floating Pickup/Drop & Child Card
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: AppTheme.surfaceContainerLowest,
                      borderRadius: BorderRadius.circular(18),
                      boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 10, offset: Offset(0, 4))],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // If School Child, show Saved Child & School Pickers
                        if (isSchoolChild) ...[
                          Row(
                            children: [
                              Container(
                                width: 36,
                                height: 36,
                                decoration: const BoxDecoration(
                                  gradient: LinearGradient(colors: [Color(0xFFFF6D00), Color(0xFFFF9E80)]),
                                  shape: BoxShape.circle,
                                ),
                                child: const Center(
                                  child: Icon(Icons.school_rounded, color: Colors.white, size: 18),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      '$_childName • $_gradeClass${_section != null && _section!.isNotEmpty ? ' ($_section)' : ''}',
                                      style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: AppTheme.onSurface),
                                    ),
                                    Text(
                                      '$_schoolName • $_schoolTimingSummary',
                                      style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.bold, color: AppTheme.primary),
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ],
                                ),
                              ),
                              IconButton(
                                icon: const Icon(Icons.edit_note_rounded, color: AppTheme.primary, size: 22),
                                tooltip: 'Edit Ride Details',
                                onPressed: () => _showOverrideDetailsModal(context),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          // Quick Selector Row for Saved Child & School
                          Row(
                            children: [
                              // Child Dropdown
                              Expanded(
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: AppTheme.surfaceContainerLow,
                                    borderRadius: BorderRadius.circular(10),
                                    border: Border.all(color: AppTheme.outlineVariant.withValues(alpha: 0.5)),
                                  ),
                                  child: DropdownButtonHideUnderline(
                                    child: DropdownButton<String>(
                                      isExpanded: true,
                                      value: _selectedChild?.id ?? (children.isNotEmpty ? children.first.id : null),
                                      hint: const Text('Child', style: TextStyle(fontSize: 11)),
                                      items: children.map((c) => DropdownMenuItem(value: c.id, child: Text(c.fullName, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold)))).toList(),
                                      onChanged: (val) {
                                        if (val != null) {
                                          final c = children.firstWhere((element) => element.id == val);
                                          _onSelectChild(c);
                                        }
                                      },
                                    ),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              // School Dropdown
                              Expanded(
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: AppTheme.surfaceContainerLow,
                                    borderRadius: BorderRadius.circular(10),
                                    border: Border.all(color: AppTheme.outlineVariant.withValues(alpha: 0.5)),
                                  ),
                                  child: DropdownButtonHideUnderline(
                                    child: DropdownButton<String>(
                                      isExpanded: true,
                                      value: _selectedSchool?.id ?? (schools.isNotEmpty ? schools.first.id : null),
                                      hint: const Text('School', style: TextStyle(fontSize: 11)),
                                      items: schools.map((s) => DropdownMenuItem(value: s.id, child: Text(s.name, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold)))).toList(),
                                      onChanged: (val) {
                                        if (val != null) {
                                          final s = schools.firstWhere((element) => element.id == val);
                                          _onSelectSchool(s);
                                        }
                                      },
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          const Divider(height: 1, color: AppTheme.outlineVariant),
                          const SizedBox(height: 8),
                        ],

                        // Pickup Address Box (Clickable Search)
                        InkWell(
                          onTap: () => _openLocationSearchSheet(isPickup: true),
                          borderRadius: BorderRadius.circular(10),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                            decoration: BoxDecoration(
                              color: AppTheme.surfaceContainerLow,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: AppTheme.outlineVariant.withValues(alpha: 0.5)),
                            ),
                            child: Row(
                              children: [
                                const Icon(Icons.radio_button_checked, color: Color(0xFF00C853), size: 16),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      const Text('PICKUP LOCATION', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w900, color: Color(0xFF00C853), letterSpacing: 0.5)),
                                      Text(
                                        _pickupAddress,
                                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.onSurface),
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ],
                                  ),
                                ),
                                const Icon(Icons.search_rounded, color: AppTheme.primary, size: 16),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 6),

                        // Destination Address Box (Clickable Search)
                        InkWell(
                          onTap: () => _openLocationSearchSheet(isPickup: false),
                          borderRadius: BorderRadius.circular(10),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                            decoration: BoxDecoration(
                              color: AppTheme.surfaceContainerLow,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: AppTheme.primary, width: 1.5),
                            ),
                            child: Row(
                              children: [
                                const Icon(Icons.location_on_rounded, color: Color(0xFFFF3D00), size: 16),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      const Text('DROP DESTINATION', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w900, color: Color(0xFFFF3D00), letterSpacing: 0.5)),
                                      Text(
                                        _destinationAddress,
                                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: AppTheme.onSurface),
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ],
                                  ),
                                ),
                                const Icon(Icons.search_rounded, color: AppTheme.primary, size: 16),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),

          // 3. Bottom Vehicle Selection Sheet
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Container(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
              decoration: const BoxDecoration(
                color: AppTheme.surfaceContainerLowest,
                borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                boxShadow: [
                  BoxShadow(color: Colors.black12, blurRadius: 20, offset: Offset(0, -4)),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppTheme.outlineVariant,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        isSchoolChild ? 'School Ride • Safe Guardian Mode' : 'Choose a Ride',
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: AppTheme.onSurface),
                      ),
                      const Row(
                        children: [
                          Icon(Icons.shield_outlined, size: 14, color: AppTheme.primary),
                          SizedBox(width: 4),
                          Text('NABIN SafeRide', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.primary)),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),

                  // Vehicle List
                  ...List.generate(_vehicles.length, (idx) {
                    final vehicle = _vehicles[idx];
                    final isSelected = _selectedVehicleIndex == idx;
                    return GestureDetector(
                      onTap: () => setState(() => _selectedVehicleIndex = idx),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: isSelected ? AppTheme.primary.withValues(alpha: 0.06) : AppTheme.surfaceContainerLowest,
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(
                            color: isSelected ? AppTheme.primary : AppTheme.outlineVariant.withValues(alpha: 0.6),
                            width: isSelected ? 2 : 1,
                          ),
                          boxShadow: isSelected
                              ? [BoxShadow(color: AppTheme.primary.withValues(alpha: 0.15), blurRadius: 8, offset: const Offset(0, 2))]
                              : null,
                        ),
                        child: Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: isSelected ? AppTheme.primary : AppTheme.surfaceContainer,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Icon(vehicle['icon'] as IconData, color: isSelected ? Colors.white : AppTheme.onSurfaceVariant, size: 22),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Text(vehicle['name'] as String, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13.5, color: AppTheme.onSurface)),
                                      const SizedBox(width: 6),
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                                        decoration: BoxDecoration(
                                          color: AppTheme.surfaceContainerLow,
                                          borderRadius: BorderRadius.circular(6),
                                        ),
                                        child: Text(vehicle['capacity'] as String, style: const TextStyle(fontSize: 8.5, fontWeight: FontWeight.bold, color: AppTheme.onSurfaceVariant)),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 1),
                                  Text(vehicle['desc'] as String, style: const TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 10.5)),
                                ],
                              ),
                            ),
                            Text(
                              vehicle['fare'] as String,
                              style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: AppTheme.onSurface),
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                  const SizedBox(height: 12),

                  // Confirm Button
                  ElevatedButton(
                    onPressed: () {
                      final selected = _vehicles[_selectedVehicleIndex];
                      final type = _selectedVehicleIndex == 0 ? '2W' : (_selectedVehicleIndex == 1 ? '3W' : '4W');
                      
                      final passengerInfo = PassengerBookingInfo(
                        bookingType: _bookingType,
                        passengerCategory: _passengerCategory,
                        passengerName: isSchoolChild ? _childName : (isForSomeoneElse ? 'Marcus T (Adult)' : 'Rahul Sharma'),
                        passengerPhoto: isSchoolChild ? 'https://images.unsplash.com/photo-1543332164-6e82f355badc?w=200' : null,
                        schoolName: isSchoolChild ? _schoolName : null,
                        gradeClass: isSchoolChild ? _gradeClass : null,
                        section: isSchoolChild ? _section : null,
                        guardianName: isSchoolChild ? _guardianName : null,
                        guardianPhone: isSchoolChild ? _guardianPhone : null,
                        pickupAddress: _pickupAddress,
                        dropAddress: _destinationAddress,
                        specialInstructions: _specialInstructions,
                        schoolTimingSummary: _schoolTimingSummary,
                        morningPickupTime: _morningPickupTime,
                        schoolArrivalTime: _schoolArrivalTime,
                        afternoonPickupTime: _afternoonPickupTime,
                        homeArrivalTime: _homeArrivalTime,
                        startOtp: '7729',
                      );

                      context.push('/active-ride', extra: {
                        'vehicleType': type,
                        'vehicleName': selected['name'],
                        'fare': selected['fare'],
                        'passengerInfo': passengerInfo,
                      });
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: isSchoolChild ? const Color(0xFFFF6D00) : AppTheme.primaryContainer,
                      foregroundColor: AppTheme.onPrimary,
                      minimumSize: const Size(double.infinity, 54),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                      elevation: 2,
                      shadowColor: AppTheme.primary.withValues(alpha: 0.35),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          isSchoolChild
                              ? 'Book School Ride • ${_vehicles[_selectedVehicleIndex]['name']}'
                              : 'Confirm ${_vehicles[_selectedVehicleIndex]['name']}',
                          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900),
                        ),
                        const SizedBox(width: 8),
                        const Icon(Icons.arrow_forward_rounded, size: 18),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCategoryChip(String category, String label, Color activeColor) {
    final isSelected = _passengerCategory == category;
    return GestureDetector(
      onTap: () => setState(() => _passengerCategory = category),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: isSelected ? activeColor : AppTheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.bold,
            color: isSelected ? Colors.white : AppTheme.onSurfaceVariant,
          ),
        ),
      ),
    );
  }
}
