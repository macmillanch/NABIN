import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/network/session_manager.dart';
import '../../../../core/widgets/map_pin_picker.dart';
import '../../../../core/widgets/place_pin_row.dart';

class ParcelBookingScreen extends StatefulWidget {
  /// `placePicker` is swappable so a test can place a point without rendering the
  /// tile-backed map; the shipped default is the map sheet itself.
  const ParcelBookingScreen({super.key, this.placePicker = MapPinPickerSheet.show});

  final PlacePinPicker placePicker;

  @override
  State<ParcelBookingScreen> createState() => _ParcelBookingScreenState();
}

class _ParcelBookingScreenState extends State<ParcelBookingScreen> {
  int _weightTier = 0; // 0: Up to 5kg, 1: 5-10kg, 2: 10-20kg
  bool _isBooking = false;

  // The two ends of the trip, as places rather than as words. The route refuses an
  // end that has no point (`400 PLACE_REQUIRED`), because the platform runs no
  // geocoder: a typed label is not something it could price a distance from, and
  // filling one in itself would put a place on the record the customer never chose.
  LatLng? _senderPoint;
  LatLng? _recipientPoint;

  // `POST /api/customer/book-parcel` reads `senderDetails` / `recipientDetails` and
  // needs both halves of the trip, so both are typed here. No saved-address read
  // path exists, so nothing is offered as saved that was never stored.
  final TextEditingController _senderAddressController = TextEditingController();
  final TextEditingController _recipientAddressController =
      TextEditingController();
  final TextEditingController _recipientContactController =
      TextEditingController();
  // What the customer says is in the box. The booking record used to carry
  // "Electronics Box (1.4 kg, Fragile)" written by the platform, which a courier
  // then read as instructions about somebody else's parcel; an empty answer now
  // stays empty rather than being completed.
  final TextEditingController _packageDetailsController =
      TextEditingController();

  @override
  void dispose() {
    _senderAddressController.dispose();
    _recipientAddressController.dispose();
    _recipientContactController.dispose();
    _packageDetailsController.dispose();
    super.dispose();
  }

  String get _senderAddress => _senderAddressController.text.trim();
  String get _recipientAddress => _recipientAddressController.text.trim();
  String get _recipientContact => _recipientContactController.text.trim();
  String get _packageDetails => _packageDetailsController.text.trim();

  bool get _canBook =>
      _senderAddress.isNotEmpty &&
      _recipientAddress.isNotEmpty &&
      _recipientContact.isNotEmpty &&
      _senderPoint != null &&
      _recipientPoint != null;

  /// Opens the pin picker for one end of the trip and, when the customer places a
  /// point, makes it that end. The typed label travels with it; the coordinate
  /// comes only from the pin.
  Future<void> _applyMapPlace({required bool isSender}) async {
    final controller =
        isSender ? _senderAddressController : _recipientAddressController;
    final point = await widget.placePicker(
      context,
      initial: isSender ? _senderPoint : _recipientPoint,
      title: isSender
          ? 'Where should the parcel be collected?'
          : 'Where should the parcel be delivered?',
      hint: 'Tap the map to drop the pin on the exact point. NABIN measures the trip '
          'and prices the parcel from here.',
    );
    if (point == null || !mounted) return;
    final label = controller.text.trim();
    if (label.isEmpty) {
      controller.text =
          'Pinned at ${point.latitude.toStringAsFixed(5)}, ${point.longitude.toStringAsFixed(5)}';
    }
    setState(() {
      if (isSender) {
        _senderPoint = point;
      } else {
        _recipientPoint = point;
      }
    });
  }

  /// The sender is whoever owns this session — a real read, never a sample name.
  Map<String, dynamic> _senderDetails() {
    final Map<String, dynamic>? user = SessionManager.instance.currentUser;
    final point = _senderPoint;
    return <String, dynamic>{
      'address': _senderAddress,
      if (point != null) 'lat': point.latitude,
      if (point != null) 'lng': point.longitude,
      if (user?['name']?.toString().trim() != null &&
          user!['name'].toString().trim().isNotEmpty)
        'name': user['name'].toString().trim(),
      if (user?['phone']?.toString().trim() != null &&
          user!['phone'].toString().trim().isNotEmpty)
        'phone': user['phone'].toString().trim(),
    };
  }

  /// The drop-off end: the label the customer typed, the point they placed, and who
  /// receives it. The point is included only when one exists — the route answers an
  /// end without one with `400 PLACE_REQUIRED` instead of choosing a place itself.
  Map<String, dynamic> _recipientDetails() {
    final point = _recipientPoint;
    return <String, dynamic>{
      'address': _recipientAddress,
      'name': _recipientContact,
      if (point != null) 'lat': point.latitude,
      if (point != null) 'lng': point.longitude,
    };
  }

  /// Who collects the parcel at the pickup end — straight from the session.
  String get _senderContactLabel {
    final Map<String, dynamic>? user = SessionManager.instance.currentUser;
    final String name = user?['name']?.toString().trim() ?? '';
    final String phone = user?['phone']?.toString().trim() ?? '';
    if (name.isNotEmpty && phone.isNotEmpty) return '$name • $phone';
    if (name.isNotEmpty || phone.isNotEmpty) return '$name$phone';
    return 'Add your contact details in your profile';
  }

  // The weight band is the customer's choice; the fare is the platform's to
  // compute (`db.calculateFareEstimate` prices the trip on the server), so no
  // rupee figure is claimed here before the booking is written.
  final List<Map<String, dynamic>> _tiers = [
    {
      'title': 'Small (Up to 5kg)',
      'desc': 'Documents, electronics, keys, medicines',
      'icon': Icons.mail_outline_rounded,
    },
    {
      'title': 'Medium (5 - 10kg)',
      'desc': 'Apparel, shoe boxes, food parcels',
      'icon': Icons.inventory_2_outlined,
    },
    {
      'title': 'Heavy (10 - 20kg)',
      'desc': 'Bulk cargo, cartons, office goods',
      'icon': Icons.local_shipping_outlined,
    },
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Text('Send Instant Parcel'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: AppTheme.onSurface, size: 20),
          onPressed: () => context.pop(),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Handover-code banner. `POST /api/customer/book-parcel` writes one
              // `deliveryOtp` on the job and the courier app refuses completion
              // without it, so the code check is real — but there is no sender
              // code and no loss-free guarantee in the backend.
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppTheme.success.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: AppTheme.success.withValues(alpha: 0.30)),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.verified_user_rounded, color: AppTheme.success, size: 28),
                    SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Code-checked handover', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13, color: AppTheme.onSurface)),
                          SizedBox(height: 2),
                          Text('The booking record keeps a delivery code, and NABIN marks the parcel handed over only when it matches.', style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 11, height: 1.35)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),

              // Connected Sender & Receiver Timeline Card
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceContainerLowest,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: AppTheme.outlineVariant.withValues(alpha: 0.6)),
                  boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 6, offset: Offset(0, 2))],
                ),
                child: Column(
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.radio_button_checked, color: AppTheme.success, size: 18),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('PICKUP FROM (SENDER)', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: AppTheme.onSurfaceVariant, letterSpacing: 0.8)),
                              const SizedBox(height: 4),
                              TextField(
                                controller: _senderAddressController,
                                maxLines: 2,
                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.onSurface),
                                decoration: const InputDecoration(
                                  hintText: 'House / flat, street or area, Aizawl',
                                  hintStyle: TextStyle(fontWeight: FontWeight.w400, fontSize: 12, color: AppTheme.onSurfaceVariant),
                                  border: InputBorder.none,
                                  isDense: true,
                                  contentPadding: EdgeInsets.zero,
                                ),
                                onChanged: (_) => setState(() {}),
                              ),
                              PlacePinRow(
                                missing: 'No pickup place chosen yet',
                                point: _senderPoint,
                                onPick: () => _applyMapPlace(isSender: true),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                _senderContactLabel,
                                style: const TextStyle(fontSize: 11, color: AppTheme.onSurfaceVariant),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const Padding(
                      padding: EdgeInsets.only(left: 8),
                      child: Row(
                        children: [
                          SizedBox(width: 1, height: 24, child: ColoredBox(color: AppTheme.outlineVariant)),
                        ],
                      ),
                    ),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.location_on_rounded, color: AppTheme.error, size: 18),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('DELIVER TO (RECEIVER)', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: AppTheme.onSurfaceVariant, letterSpacing: 0.8)),
                              const SizedBox(height: 4),
                              TextField(
                                controller: _recipientAddressController,
                                maxLines: 2,
                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: AppTheme.onSurface),
                                decoration: const InputDecoration(
                                  hintText: 'House / shop, street or area, Aizawl',
                                  hintStyle: TextStyle(fontWeight: FontWeight.w400, fontSize: 12, color: AppTheme.onSurfaceVariant),
                                  border: InputBorder.none,
                                  isDense: true,
                                  contentPadding: EdgeInsets.zero,
                                ),
                                onChanged: (_) => setState(() {}),
                              ),
                              PlacePinRow(
                                missing: 'No drop-off place chosen yet',
                                point: _recipientPoint,
                                onPick: () => _applyMapPlace(isSender: false),
                              ),
                              const SizedBox(height: 6),
                              TextField(
                                controller: _recipientContactController,
                                style: const TextStyle(fontSize: 12, color: AppTheme.onSurface),
                                decoration: const InputDecoration(
                                  hintText: 'Who receives it, and their +91 number',
                                  hintStyle: TextStyle(fontSize: 12, color: AppTheme.onSurfaceVariant),
                                  border: InputBorder.none,
                                  isDense: true,
                                  contentPadding: EdgeInsets.zero,
                                ),
                                onChanged: (_) => setState(() {}),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              const Text('Select Package Size & Weight', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, color: AppTheme.onSurface)),
              const SizedBox(height: 4),
              const Text(
                'The band is your choice; the fare is the platform\'s to work out '
                'when the parcel is booked, and the confirmation shows what it '
                'recorded.',
                style: TextStyle(fontSize: 11, color: AppTheme.onSurfaceVariant, height: 1.4),
              ),
              const SizedBox(height: 12),

              ...List.generate(_tiers.length, (idx) {
                final tier = _tiers[idx];
                final isSelected = _weightTier == idx;
                return GestureDetector(
                  onTap: () => setState(() => _weightTier = idx),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    margin: const EdgeInsets.only(bottom: 10),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: isSelected ? AppTheme.serviceParcel.withValues(alpha: 0.08) : AppTheme.surfaceContainerLowest,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: isSelected ? AppTheme.serviceParcel : AppTheme.outlineVariant.withValues(alpha: 0.6),
                        width: isSelected ? 2 : 1,
                      ),
                      boxShadow: isSelected ? [BoxShadow(color: AppTheme.serviceParcel.withValues(alpha: 0.2), blurRadius: 8)] : null,
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: isSelected ? AppTheme.serviceParcel : AppTheme.surfaceContainer,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Icon(tier['icon'] as IconData, color: isSelected ? Colors.white : AppTheme.onSurfaceVariant, size: 22),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(tier['title'] as String, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: AppTheme.onSurface)),
                              const SizedBox(height: 2),
                              Text(tier['desc'] as String, style: const TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 11)),
                            ],
                          ),
                        ),
                        const Spacer(),
                        Icon(
                          isSelected ? Icons.check_circle_rounded : Icons.radio_button_unchecked,
                          color: isSelected ? AppTheme.serviceParcel : AppTheme.outlineVariant,
                          size: 22,
                        ),
                      ],
                    ),
                  ),
                );
              }),
              const SizedBox(height: 24),

              // What the customer says about the parcel, sent as they said it. The
              // route stores this string or `null`; it no longer writes a
              // description of the box on the customer's behalf.
              const Text('What is in the box? (optional)',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
              const SizedBox(height: 4),
              TextField(
                controller: _packageDetailsController,
                maxLines: 2,
                style: const TextStyle(fontSize: 13, color: AppTheme.onSurface),
                decoration: InputDecoration(
                  hintText:
                      'Anything the courier should know, in your own words',
                  hintStyle: const TextStyle(
                      fontSize: 12, color: AppTheme.onSurfaceVariant),
                  filled: true,
                  fillColor: AppTheme.surfaceContainerLow,
                  border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide.none),
                ),
              ),
              const SizedBox(height: 24),

              ElevatedButton(
                onPressed: _isBooking || !_canBook
                    ? null
                    : () async {
                        setState(() => _isBooking = true);
                        // `customerId` is deliberately absent: the route binds the
                        // job to the authenticated session and rejects a body id
                        // that names anyone else, so a guessed id is a 403, not a
                        // booking.
                        final payload = <String, dynamic>{
                          'senderDetails': _senderDetails(),
                          'recipientDetails': _recipientDetails(),
                          // The band the customer tapped, in the words they tapped,
                          // and only their own description of the parcel. Neither
                          // price nor travel time is claimed here — the route
                          // measures both from the two points placed above.
                          'weightTier': _tiers[_weightTier]['title'],
                          if (_packageDetails.isNotEmpty)
                            'packageDetails': _packageDetails,
                        };

                        final res = await NabinApiService.bookParcel(payload);

                        if (!context.mounted) return;
                        setState(() => _isBooking = false);

                        if (res != null && res['success'] == true) {
                          final Object? fare = res['job']?['fare'];
                          context.pushReplacement('/parcel-confirmation', extra: {
                            'jobId': res['job']?['id']?.toString(),
                            'fare': fare is num
                                ? '₹${fare.toDouble().toStringAsFixed(2)}'
                                : 'Set by NABIN',
                          });
                        } else {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text(res?['error'] ?? 'Booking failed')),
                          );
                        }
                      },
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.serviceParcel,
                  foregroundColor: Colors.white,
                  disabledBackgroundColor: AppTheme.surfaceContainerHigh,
                  disabledForegroundColor: AppTheme.onSurfaceVariant,
                  minimumSize: const Size(double.infinity, 56),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  elevation: 2,
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (_isBooking)
                      const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                              color: Colors.white, strokeWidth: 2))
                    else ...[
                      Flexible(
                        child: Text(
                          _canBook
                              ? 'Book courier delivery'
                              : 'Type both addresses and place both points on the map',
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                              fontSize: 16, fontWeight: FontWeight.w900),
                        ),
                      ),
                      const SizedBox(width: 8),
                      const Icon(Icons.arrow_forward_rounded, size: 18),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 20),
            ],
          ),
        ),
      ),
    );
  }
}
