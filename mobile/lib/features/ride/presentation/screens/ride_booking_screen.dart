import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/map_pin_picker.dart';
import '../../../../core/widgets/place_map_preview.dart';
import '../../../../core/widgets/place_pin_row.dart';
import '../../../../core/models/school_model.dart';
import '../../../../core/models/child_model.dart';
import '../../../../core/models/passenger_booking_info.dart';
import '../../../../core/models/school_child_repository.dart';

class RideBookingScreen extends StatefulWidget {
  /// `placePicker` is swappable so a test can place a point without rendering the
  /// tile-backed map; the shipped default is the map sheet itself.
  const RideBookingScreen({
    super.key,
    this.initialChildId,
    this.initialSchoolId,
    this.placePicker = MapPinPickerSheet.show,
  });

  /// The row the customer tapped to get here. Home's place chips name a saved
  /// child or school, and a chip that names a place has to book from it — so the
  /// id travels with the route and this screen selects that row rather than
  /// whatever the account happens to hold first. An id the account no longer has
  /// is ignored: the rows are deletable between the tap and this build.
  final String? initialChildId;
  final String? initialSchoolId;
  final PlacePinPicker placePicker;

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

  // The trip details for this booking. Every one of these used to ship as a literal
  // this screen made up — 'Rahul Chakma', 'Class 5', 'Flat 402, Tuikual, Aizawl',
  // '07:45 AM', a gate-2 instruction — and all of it rode to a real driver on the
  // tracking screen. They start empty and are filled only from the customer's own
  // saved rows, from a place they put on the map, or from what they type.
  String _childName = '';
  String _schoolName = '';
  String _gradeClass = '';
  String? _section; // Strictly optional
  String _guardianName = '';
  String _guardianPhone = '';
  String _pickupAddress = '';
  String _destinationAddress = '';
  String _specialInstructions = '';

  // School Timing & Ride Offsets. The summary is the school row's own; the two times
  // are only ever what the customer typed for this trip — the platform has no
  // scheduling column for them, so they stay in the booking's passenger details.
  String _schoolTimingSummary = '';
  String _morningPickupTime = '';
  String _schoolArrivalTime = '';

  /// Where this ride actually starts and ends, in degrees. The platform prices and
  /// dispatches from these numbers and refuses a booking whose end has none
  /// (`400 PLACE_REQUIRED`) — there is no geocoder here, so the only honest sources
  /// are a saved child/school row or a pin the customer placed on the map.
  LatLng? _pickupPoint;
  LatLng? _dropPoint;

  /// Set once the first settled read of the account's schools and children has been
  /// applied, so a later refresh cannot overwrite what the customer chose.
  bool _defaultsApplied = false;

  bool _submitting = false;

  // The vehicle list carries only what the platform defines: a name, the service
  // type the fare engine keys on, and a seat count. The fares and the "Nearest:
  // 360m away • 2 mins ETA" lines this used to show were typed into the screen —
  // there is no nearby-driver read and no quote this screen asks for. NABIN sets
  // the fare when the ride is confirmed, and the active-ride screen shows that one.
  final List<Map<String, dynamic>> _vehicles = [
    {'type': '2W', 'name': 'Bike', 'capacity': '1 Person', 'icon': Icons.two_wheeler_rounded},
    {'type': '3W', 'name': 'Auto', 'capacity': '3 Persons', 'icon': Icons.electric_rickshaw_rounded},
    {'type': '4W', 'name': 'Car', 'capacity': '4 Persons', 'icon': Icons.local_taxi_rounded},
  ];

  @override
  void initState() {
    super.initState();
    // A school ride can only be booked for a child this account actually has, so
    // the screen asks NABIN for the saved rows like every other list it reads.
    SchoolChildRepository.instance.addListener(_onRepositoryChanged);
    _applyRepositoryDefaults();
  }

  @override
  void dispose() {
    SchoolChildRepository.instance.removeListener(_onRepositoryChanged);
    super.dispose();
  }

  void _onRepositoryChanged() {
    if (!mounted) return;
    _applyRepositoryDefaults();
    setState(() {});
  }

  /// Applies the account's own child and school once, as soon as the read settles.
  /// A failed read settles too: the customer can still book for themselves and
  /// place both ends of the trip on the map.
  void _applyRepositoryDefaults() {
    if (_defaultsApplied) return;
    final repo = SchoolChildRepository.instance;
    if (repo.status != SchoolChildLoadStatus.ready && repo.status != SchoolChildLoadStatus.failed) return;
    _defaultsApplied = true;

    SavedChild? wantedChild;
    for (final child in repo.children) {
      if (widget.initialChildId != null && child.id == widget.initialChildId) {
        wantedChild = child;
      }
    }
    SavedSchool? wantedSchool;
    for (final school in repo.schools) {
      if (widget.initialSchoolId != null && school.id == widget.initialSchoolId) {
        wantedSchool = school;
      }
    }

    if (wantedChild != null) {
      _selectChild(wantedChild);
    } else if (wantedSchool != null) {
      _selectSchool(wantedSchool);
    } else if (repo.children.isNotEmpty) {
      _selectChild(repo.children.first);
    } else if (repo.schools.isNotEmpty) {
      _selectSchool(repo.schools.first);
    }
  }

  void _selectChild(SavedChild child) {
    _selectedChild = child;
    _childName = child.fullName;
    _gradeClass = child.gradeClass;
    _section = child.section;
    _guardianName = child.guardianName;
    _guardianPhone = child.guardianPhone;
    _pickupAddress = child.defaultPickupAddress;
    _pickupPoint = LatLng(child.pickupLat, child.pickupLng);
    if (child.specialInstructions != null && child.specialInstructions!.isNotEmpty) {
      _specialInstructions = child.specialInstructions!;
    }

    // The school comes from the child's own link. `schoolFor` reads it out of the
    // rows the account has, so a child whose school was deleted keeps the name that
    // row carried and no coordinates — the drop then has to be placed before booking.
    final school = SchoolChildRepository.instance.schoolFor(child);
    if (school != null) {
      _selectSchool(school);
    } else {
      _selectedSchool = null;
      _schoolName = child.schoolName ?? '';
      _destinationAddress = child.schoolName ?? '';
      _schoolTimingSummary = '';
      _dropPoint = null;
    }
  }

  void _selectSchool(SavedSchool school) {
    _selectedSchool = school;
    _schoolName = school.name;
    _destinationAddress = '${school.name}, ${school.address}';
    _schoolTimingSummary = school.generalTimingSummary;
    _dropPoint = LatLng(school.latitude, school.longitude);
  }

  void _onSelectChild(SavedChild child) => setState(() => _selectChild(child));

  void _onSelectSchool(SavedSchool school) => setState(() => _selectSchool(school));

  /// A stale selection is no selection: the ids come from rows the account can delete
  /// between visits, and a `DropdownButton` whose value is not in its items throws.
  String? get _selectedChildId {
    final id = _selectedChild?.id;
    if (id == null) return null;
    return SchoolChildRepository.instance.children.any((c) => c.id == id) ? id : null;
  }

  String? get _selectedSchoolId {
    final id = _selectedSchool?.id;
    if (id == null) return null;
    return SchoolChildRepository.instance.schools.any((s) => s.id == id) ? id : null;
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
                  children: [
                    // The title gets the width the close button leaves, and scales
                    // into it — clipped or overflowing, it would hide which of the
                    // two sheets this is (this one edits only this trip; the saved
                    // template is edited from Profile).
                    const Expanded(
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerLeft,
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.edit_note_rounded, color: AppTheme.primary, size: 24),
                            SizedBox(width: 8),
                            Text('Edit Ride Details for this Trip', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: AppTheme.onSurface)),
                          ],
                        ),
                      ),
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
                    hintText: _selectedChild == null ? "The name on the child's school bag" : null,
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
                    hintText: 'The school this ride goes to',
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

                // Pickup & Destination. The text field says where in words; the line
                // under each one names the coordinate that will actually be sent. An
                // address this app cannot geocode is not a place the platform can drive
                // to, so retyping an address drops its point until it is placed again.
                const Text('Pickup Location *', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                const SizedBox(height: 4),
                TextField(
                  controller: pickupCtrl,
                  onChanged: (_) => setModalState(() {}),
                  decoration: InputDecoration(
                    hintText: 'House / flat, lane and locality',
                    prefixIcon: const Icon(Icons.radio_button_checked, color: AppTheme.success, size: 18),
                    filled: true,
                    fillColor: AppTheme.surfaceContainerLow,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 6),
                PlacePinRow(
                  missing: 'No pickup place chosen yet',
                  point: _pickupPoint,
                  onPick: () async {
                    final placed = await _applyMapPlace(isPickup: true, controller: pickupCtrl);
                    if (placed != null) setModalState(() {});
                  },
                ),
                const SizedBox(height: 10),

                const Text('Destination / Drop Gate *', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                const SizedBox(height: 4),
                TextField(
                  controller: destCtrl,
                  onChanged: (_) => setModalState(() {}),
                  decoration: InputDecoration(
                    hintText: 'The school or place the ride ends at',
                    prefixIcon: const Icon(Icons.location_on_rounded, color: AppTheme.error, size: 18),
                    filled: true,
                    fillColor: AppTheme.surfaceContainerLow,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
                const SizedBox(height: 6),
                PlacePinRow(
                  missing: 'No drop place chosen yet',
                  point: _dropPoint,
                  onPick: () async {
                    final placed = await _applyMapPlace(isPickup: false, controller: destCtrl);
                    if (placed != null) setModalState(() {});
                  },
                ),
                const SizedBox(height: 10),

                // Ride Timings
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Home Pickup Time (note for this trip)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                          const SizedBox(height: 4),
                          TextField(
                            controller: morningPickupCtrl,
                            decoration: InputDecoration(
                              hintText: 'e.g. 07:15 AM',
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
                          const Text('School Arrival Time (note)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                          const SizedBox(height: 4),
                          TextField(
                            controller: schoolArrivalCtrl,
                            decoration: InputDecoration(
                              hintText: 'e.g. 08:00 AM',
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
                      final newPickup = pickupCtrl.text.trim();
                      final newDrop = destCtrl.text.trim();
                      if (newPickup != _pickupAddress) _pickupPoint = null;
                      if (newDrop != _destinationAddress) _dropPoint = null;
                      _pickupAddress = newPickup;
                      _destinationAddress = newDrop;
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

  void _showNotice(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), duration: const Duration(seconds: 3)),
    );
  }

  /// Opens the pin picker and, when the customer places a point, makes it this
  /// ride's pickup or drop. The typed label travels with it; the coordinate comes
  /// only from the pin.
  ///
  /// `controller` is the field that owns this end's address text, and it is written
  /// as well as the trip state, because the override sheet copies its text fields
  /// back over the trip when it applies: a controller that never saw the pin would
  /// restore the empty field and drop the point the customer just placed. `label` is
  /// for a caller whose text is not that end's address field — the search sheet's
  /// query names the place it is filtering by, and must not be overwritten.
  Future<LatLng?> _applyMapPlace({
    required bool isPickup,
    TextEditingController? controller,
    String? label,
  }) async {
    final point = await widget.placePicker(
      context,
      initial: isPickup ? _pickupPoint : _dropPoint,
      title: isPickup ? 'Where should the ride start?' : 'Where should the ride end?',
      hint: 'Tap the map to drop the pin on the exact point. NABIN prices and sends the ride from here.',
    );
    if (point == null || !mounted) return null;
    final typed = (controller?.text ?? label ?? '').trim();
    final text = typed.isNotEmpty
        ? typed
        : 'Pinned at ${point.latitude.toStringAsFixed(5)}, ${point.longitude.toStringAsFixed(5)}';
    if (typed.isEmpty && controller != null) controller.text = text;
    setState(() {
      if (isPickup) {
        _pickupAddress = text;
        _pickupPoint = point;
      } else {
        _destinationAddress = text;
        _dropPoint = point;
      }
    });
    return point;
  }

  /// The places this sheet can offer are the ones the account actually has: a saved
  /// child's pickup point and a saved school, each with the coordinates NABIN stores
  /// for it. The hard-coded landmark list this replaced carried no coordinates at
  /// all, so picking from it sent a trip whose ends the platform had to guess.
  /// Anything else goes through the map picker, which is the only other honest
  /// source of a place.
  void _openLocationSearchSheet({required bool isPickup}) {
    final repo = SchoolChildRepository.instance;
    final List<Map<String, dynamic>> places = <Map<String, dynamic>>[
      for (final child in repo.children)
        if (child.defaultPickupAddress.isNotEmpty)
          {
            'name': child.defaultPickupAddress,
            'sub': 'Pickup for ${child.fullName}',
            'icon': Icons.home_rounded,
            'tag': 'Saved',
            'point': LatLng(child.pickupLat, child.pickupLng),
          },
      for (final school in repo.schools)
        {
          'name': '${school.name}, ${school.address}',
          'sub': school.generalTimingSummary,
          'icon': Icons.school_rounded,
          'tag': 'School',
          'point': LatLng(school.latitude, school.longitude),
        },
    ];

    String searchQuery = '';

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) {
          final q = searchQuery.toLowerCase();
          final filtered = places.where((p) {
            return (p['name'] as String).toLowerCase().contains(q) ||
                (p['sub'] as String).toLowerCase().contains(q) ||
                (p['tag'] as String).toLowerCase().contains(q);
          }).toList();

          void choose(String label, LatLng point) {
            setState(() {
              if (isPickup) {
                _pickupAddress = label;
                _pickupPoint = point;
              } else {
                _destinationAddress = label;
                _dropPoint = point;
              }
            });
            Navigator.pop(ctx);
            _showNotice('${isPickup ? "Pickup" : "Drop"} set to: $label');
          }

          return Container(
            height: MediaQuery.of(context).size.height * 0.78,
            decoration: const BoxDecoration(
              color: AppTheme.surfaceContainerLowest,
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
                      color: AppTheme.outlineVariant,
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
                        color: isPickup ? AppTheme.success.withValues(alpha: 0.10) : AppTheme.error.withValues(alpha: 0.10),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        isPickup ? Icons.radio_button_checked : Icons.location_on_rounded,
                        color: isPickup ? AppTheme.success : AppTheme.error,
                        size: 20,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Flexible(
                      child: Text(
                        isPickup ? 'Search Pickup Location' : 'Search Drop Location',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppTheme.onSurface),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                TextField(
                  autofocus: true,
                  onChanged: (val) => setModalState(() => searchQuery = val),
                  decoration: InputDecoration(
                    hintText: isPickup ? 'Search your saved pickup places...' : 'Search your saved schools...',
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
                // The map is always available: an address this app cannot geocode is
                // not a place the platform can drive to until the customer points at it.
                InkWell(
                  onTap: () async {
                    final point = await _applyMapPlace(
                      isPickup: isPickup,
                      label: searchQuery.trim().isEmpty ? null : searchQuery.trim(),
                    );
                    if (point != null && ctx.mounted) Navigator.pop(ctx);
                  },
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                    decoration: BoxDecoration(
                      color: AppTheme.primary.withValues(alpha: 0.06),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppTheme.primary.withValues(alpha: 0.35)),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.add_location_alt_rounded, color: AppTheme.primary, size: 20),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Choose on the map',
                                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w900, color: AppTheme.onSurface)),
                              Text(
                                searchQuery.trim().isEmpty
                                    ? 'Drop a pin on the exact point'
                                    : 'Place "${searchQuery.trim()}" on the map',
                                style: const TextStyle(fontSize: 11, color: AppTheme.onSurfaceVariant),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                        const Icon(Icons.chevron_right_rounded, color: AppTheme.primary, size: 20),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  places.isEmpty ? 'No saved places on this account yet' : 'Saved places on your account',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppTheme.onSurfaceVariant),
                ),
                const SizedBox(height: 4),
                Expanded(
                  child: filtered.isEmpty
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 24),
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                const Icon(Icons.location_off_rounded, size: 40, color: AppTheme.onSurfaceVariant),
                                const SizedBox(height: 8),
                                Text(
                                  searchQuery.trim().isEmpty
                                      ? 'Nothing saved to pick from yet.'
                                      : 'No saved place matches "$searchQuery"',
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(color: AppTheme.onSurfaceVariant),
                                ),
                                const SizedBox(height: 6),
                                const Text(
                                  'Use Choose on the map above to place this end of the ride.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(fontSize: 11.5, color: AppTheme.onSurfaceVariant),
                                ),
                              ],
                            ),
                          ),
                        )
                      : ListView.separated(
                          itemCount: filtered.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (context, i) {
                            final item = filtered[i];
                            // Its own Material: the sheet's surface is an opaque
                            // BoxDecoration, and a ListTile paints its splash on the
                            // nearest Material *ancestor* — which is behind that
                            // decoration, so tapping a saved place shows nothing.
                            return Material(
                              type: MaterialType.transparency,
                              child: ListTile(
                                contentPadding: EdgeInsets.zero,
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
                                onTap: () => choose(item['name'] as String, item['point'] as LatLng),
                              ),
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
          // The places this ride has, where they actually are. Until this screen used
          // the Driver app's map widget, which draws a Delhi route between pins
          // hard-coded to Delhi with eight invented drivers around them: whichever
          // Aizawl places were chosen, the map showed a trip through Delhi.
          Positioned.fill(
            child: PlaceMapPreview(
              pickup: _pickupPoint,
              drop: _dropPoint,
              pickupLabel: _pickupAddress.isEmpty ? null : _pickupAddress,
              dropLabel: _destinationAddress.isEmpty ? null : _destinationAddress,
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

                      // "Who is riding?" Pill Toggle. Both labels have to stay
                      // readable, so the toggle takes the remaining width and scales
                      // down inside it — a phone at 360–393 logical px, or a larger
                      // text scale, would otherwise clip 'For Someone Else'.
                      Expanded(
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerRight,
                          child: Container(
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
                                      color: isForSomeoneElse ? AppTheme.primary : Colors.transparent,
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
                      // Four labels in a row is the widest thing on this screen, and
                      // it cannot be allowed to clip: the category decides which
                      // passenger details the driver is sent. Wrapping costs a line of
                      // height; clipping costs the customer a choice.
                      child: Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        alignment: WrapAlignment.center,
                        children: [
                          _buildCategoryChip('SCHOOL_CHILD', '🎒 School Child', AppTheme.primary),
                          _buildCategoryChip('ADULT', '👤 Adult', AppTheme.primary),
                          _buildCategoryChip('ELDERLY', '👵 Elderly', AppTheme.primary),
                          _buildCategoryChip('OTHER', '📦 Other', AppTheme.primary),
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
                                  color: AppTheme.primary,
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
                                      _childName.isEmpty
                                          ? (repo.isLoading ? 'Loading your saved children…' : 'No child chosen yet')
                                          : '$_childName • $_gradeClass${_section != null && _section!.isNotEmpty ? ' ($_section)' : ''}',
                                      style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: AppTheme.onSurface),
                                    ),
                                    // The school line only appears when this account actually has a
                                    // school row (or a child row that names one) to show.
                                    if (_schoolName.isNotEmpty)
                                      Text(
                                        _schoolTimingSummary.isEmpty
                                            ? _schoolName
                                            : '$_schoolName • $_schoolTimingSummary',
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
                          if (repo.status == SchoolChildLoadStatus.failed)
                            const Padding(
                              padding: EdgeInsets.only(bottom: 8),
                              child: Text(
                                'NABIN could not read your saved children. Place both ends of the ride on the map, or reopen this screen from Profile.',
                                style: TextStyle(
                                    fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.warning),
                              ),
                            ),
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
                                      value: _selectedChildId,
                                      hint: Text(
                                          repo.isLoading ? 'Loading children…' : 'Choose child',
                                          style: const TextStyle(fontSize: 11)),
                                      items: children.map((c) => DropdownMenuItem(value: c.id, child: Text(c.fullName, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold)))).toList(),
                                      onChanged: children.isEmpty
                                          ? null
                                          : (val) {
                                              if (val == null) return;
                                              _onSelectChild(children.firstWhere((c) => c.id == val));
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
                                      value: _selectedSchoolId,
                                      hint: Text(
                                          repo.isLoading ? 'Loading schools…' : 'Choose school',
                                          style: const TextStyle(fontSize: 11)),
                                      items: schools.map((s) => DropdownMenuItem(value: s.id, child: Text(s.name, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold)))).toList(),
                                      onChanged: schools.isEmpty
                                          ? null
                                          : (val) {
                                              if (val == null) return;
                                              _onSelectSchool(schools.firstWhere((s) => s.id == val));
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
                                const Icon(Icons.radio_button_checked, color: AppTheme.success, size: 16),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      const Text('PICKUP LOCATION', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w900, color: AppTheme.success, letterSpacing: 0.5)),
                                      Text(
                                        _pickupAddress.isEmpty ? 'Tap to choose the pickup place' : _pickupAddress,
                                        style: TextStyle(
                                          fontWeight: FontWeight.bold,
                                          fontSize: 12,
                                          color: _pickupAddress.isEmpty
                                              ? AppTheme.onSurfaceVariant
                                              : AppTheme.onSurface,
                                        ),
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
                                const Icon(Icons.location_on_rounded, color: AppTheme.error, size: 16),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      const Text('DROP DESTINATION', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w900, color: AppTheme.error, letterSpacing: 0.5)),
                                      Text(
                                        _destinationAddress.isEmpty ? 'Tap to choose the drop place' : _destinationAddress,
                                        style: TextStyle(
                                          fontWeight: FontWeight.bold,
                                          fontSize: 12,
                                          color: _destinationAddress.isEmpty
                                              ? AppTheme.onSurfaceVariant
                                              : AppTheme.onSurface,
                                        ),
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
                        const SizedBox(height: 8),
                        // Both ends need a coordinate before this can be booked, so the
                        // screen says which one is still missing instead of letting the
                        // platform substitute a place in another city.
                        if (_pickupPoint == null || _dropPoint == null)
                          Row(
                            children: [
                              const Icon(Icons.add_location_alt_rounded, size: 14, color: AppTheme.warning),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  '${_pickupPoint == null ? "Pickup" : "Drop"} still needs a place on the map. Tap it and choose the exact point.',
                                  style: const TextStyle(
                                      fontSize: 10.5, fontWeight: FontWeight.bold, color: AppTheme.warning),
                                ),
                              ),
                            ],
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
                    children: [
                      // 'School Ride • Safe Guardian Mode' is the longer of the two
                      // titles and shares this line with the SafeRide mark, so it
                      // scales into the space left rather than pushing that mark off
                      // the edge of a narrow phone.
                      Expanded(
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerLeft,
                          child: Text(
                            isSchoolChild ? 'School Ride • Safe Guardian Mode' : 'Choose a Ride',
                            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: AppTheme.onSurface),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      const Row(
                        mainAxisSize: MainAxisSize.min,
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
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'NABIN sets the fare when it confirms the ride. That is the price the trip screen and the receipt show.',
                      style: TextStyle(fontSize: 10.5, color: AppTheme.onSurfaceVariant, height: 1.3),
                    ),
                  ),
                  const SizedBox(height: 10),

                  // Confirm Button
                  ElevatedButton(
                    onPressed: _submitting ? null : () async {
                      final pickup = _pickupPoint;
                      final drop = _dropPoint;
                      // This payload is the only place the trip's coordinates come from, and
                      // the route refuses an end that has none (`400 PLACE_REQUIRED`) —
                      // so a ride whose ends were only typed is stopped here, not booked.
                      if (pickup == null || drop == null) {
                        _showNotice(pickup == null
                            ? 'Place the pickup on the map first. NABIN prices and dispatches the ride from the place you choose.'
                            : 'Place the drop on the map first. NABIN prices and dispatches the ride from the place you choose.');
                        return;
                      }

                      final selected = _vehicles[_selectedVehicleIndex];
                      final type = selected['type'] as String;

                      final passengerInfo = PassengerBookingInfo(
                        bookingType: _bookingType,
                        passengerCategory: _passengerCategory,
                        // Only what the customer's own saved row or their typing produced.
                        passengerName: isSchoolChild ? _childName : null,
                        // No photo: this app has no stored passenger image to show, and a
                        // stock URL would put a stranger's face on a child's trip.
                        passengerPhoto: null,
                        schoolName: isSchoolChild ? _schoolName : null,
                        gradeClass: isSchoolChild ? _gradeClass : null,
                        section: isSchoolChild ? _section : null,
                        guardianName: isSchoolChild ? _guardianName : null,
                        guardianPhone: isSchoolChild ? _guardianPhone : null,
                        pickupAddress: _pickupAddress,
                        dropAddress: _destinationAddress,
                        specialInstructions: _specialInstructions.isEmpty ? null : _specialInstructions,
                        schoolTimingSummary: _schoolTimingSummary.isEmpty ? null : _schoolTimingSummary,
                        morningPickupTime: _morningPickupTime.isEmpty ? null : _morningPickupTime,
                        schoolArrivalTime: _schoolArrivalTime.isEmpty ? null : _schoolArrivalTime,
                      );

                      // No customerId: `POST /api/customer/book-ride` binds the booking to the
                      // bearer token and rejects a mismatch, so a client-supplied id adds nothing
                      // — and the 'cust_active' this screen used to send is not an account.
                      final payload = {
                        'vehicleType': type,
                        'pickup': {
                          'address': _pickupAddress,
                          'lat': pickup.latitude,
                          'lng': pickup.longitude,
                        },
                        'drop': {
                          'address': _destinationAddress,
                          'lat': drop.latitude,
                          'lng': drop.longitude,
                        },
                        'bookingType': _bookingType,
                        'passengerCategory': _passengerCategory,
                        'passengerInfo': passengerInfo.toJson(),
                      };

                      setState(() => _submitting = true);
                      final res = await NabinApiService.bookRide(payload);
                      if (!mounted || !context.mounted) return;
                      setState(() => _submitting = false);

                      if (res != null && res['success'] == true) {
                        final job = res['job'] is Map
                            ? Map<String, dynamic>.from(res['job'] as Map)
                            : const <String, dynamic>{};
                        context.pushReplacement('/active-ride', extra: {
                          'vehicleType': type,
                          'vehicleName': selected['name'],
                          // The price the platform stored, not the one this screen previewed.
                          'fare': job['fare'],
                          'passengerInfo': passengerInfo,
                          // Without an id the tracking screen has nothing to read, so it gets
                          // the real one rather than the 'TRIP-772' placeholder it used to hand over.
                          'jobId': job['uuid'] ?? job['id'],
                        });
                      } else {
                        _showNotice(res?['error'] ?? 'Ride booking failed');
                      }
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.primary,
                      foregroundColor: AppTheme.onPrimary,
                      minimumSize: const Size(double.infinity, 54),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                      elevation: 2,
                      shadowColor: AppTheme.primary.withValues(alpha: 0.35),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        // The label names the vehicle the customer is booking, so it
                        // shrinks to fit instead of losing the word that says which
                        // ride this is.
                        Flexible(
                          child: FittedBox(
                            fit: BoxFit.scaleDown,
                            child: Text(
                              isSchoolChild
                                  ? 'Book School Ride • ${_vehicles[_selectedVehicleIndex]['name']}'
                                  : 'Confirm ${_vehicles[_selectedVehicleIndex]['name']}',
                              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900),
                            ),
                          ),
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
