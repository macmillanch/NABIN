import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/models/passenger_booking_info.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/network/nabin_ws_service.dart';
import '../../../../core/network/session_manager.dart';
import '../../../../core/theme/app_theme.dart';

/// Follows one ride by reading its trip row back from the platform.
///
/// The screen used to own the lifecycle: an `int _tripStage` walked forward through
/// invented titles, and it printed a driver from a hard-coded roster ('Rajesh Kumar',
/// 'Vikram Singh', 'Amitabh Sen' with plates, ratings and dialable phone numbers), a
/// start PIN of `7729`, an ETA, a remaining distance, a speed, a per-vehicle-class
/// cancellation fee table (2W Rs 20 / 3W Rs 30 / 4W Rs 50), a mid-trip early-stop with a
/// minimum-50% fare rule, an instant-refund-to-wallet claim, and a rating bar that sent
/// nothing. None of it had a source.
///
/// What actually exists for a customer and a job:
/// - `GET /api/tracking/:jobId` — the trip row: `status`, `driver {id,name,phone}`,
///   `location`, `pickup`, `drop`. Nothing else.
/// - `DRIVER_ASSIGNED` on the customer socket — the only message that carries a vehicle
///   plate and the trip-start code. It is a signal, so it is used as one: the push is
///   captured and the row is re-read. There is no driver rating in it, and there isn't
///   going to be one while `drivers.rating` is a `DEFAULT 5.00` column with no reviews
///   table behind it (see docs/CUSTOMER_SCREEN_CONTRACT_AUDIT.md §6).
/// - `POST /api/rides/:id/cancel` — the only customer write a job has. Its response
///   carries the real `cancellationFee`, `driverCompensation`, `refundAmount` and
///   `refundStatus`, which are printed exactly as returned.
///
/// The rest of what this screen used to assert has no route on the platform: no
/// early-stop or end-trip write, no customer rating write, no trip-adjustment write, no
/// server-side ETA or distance-covered, no per-vehicle fee table. Those gaps are stated
/// in the copy rather than filled with a simulation.
class ActiveRideScreen extends StatefulWidget {
  final String vehicleType;
  final String vehicleName;

  /// The quote the booking handed over. It is a booking value, not a trip row value —
  /// `GET /api/tracking/:jobId` reports no fare, so this screen labels it as such.
  final String fare;
  final PassengerBookingInfo? passengerInfo;
  final String? jobId;

  const ActiveRideScreen({
    super.key,
    this.vehicleType = '3W',
    this.vehicleName = 'Auto',
    this.fare = '',
    this.passengerInfo,
    this.jobId,
  });

  @override
  State<ActiveRideScreen> createState() => _ActiveRideScreenState();
}

class _ActiveRideScreenState extends State<ActiveRideScreen> {
  static const Duration _pollEvery = Duration(seconds: 10);

  /// A mirror of the ride half of `VALID_JOB_TRANSITIONS`
  /// (`backend/src/repositories/JobRepository.js:5-23`). It is a list of what the
  /// platform can write, not a script this screen performs.
  static const List<Map<String, dynamic>> _ladder = <Map<String, dynamic>>[
    <String, dynamic>{
      'state': 'REQUESTED',
      'title': 'Request placed',
      'copy': 'Your request is on the platform. No driver has been chosen for it yet.',
      'icon': Icons.receipt_long_rounded,
    },
    <String, dynamic>{
      'state': 'SEARCHING',
      'title': 'Looking for a driver',
      'copy': 'The platform is matching your request to a driver.',
      'icon': Icons.radar_rounded,
    },
    <String, dynamic>{
      'state': 'ASSIGNED',
      'title': 'Driver assigned',
      'copy': 'A driver has taken the trip.',
      'icon': Icons.assignment_turned_in_rounded,
    },
    <String, dynamic>{
      'state': 'DRIVER_ARRIVING',
      'title': 'Driver on the way',
      'copy': 'The driver is heading to your pickup point.',
      'icon': Icons.route_rounded,
    },
    <String, dynamic>{
      'state': 'DRIVER_ARRIVED',
      'title': 'Driver at the pickup point',
      'copy': 'The driver has reached the pickup point and is waiting for you.',
      'icon': Icons.pin_drop_rounded,
    },
    <String, dynamic>{
      'state': 'IN_TRANSIT',
      'title': 'Trip in progress',
      'copy': 'The driver started the trip after verifying your code.',
      'icon': Icons.navigation_rounded,
    },
    <String, dynamic>{
      'state': 'COMPLETED',
      'title': 'Trip completed',
      'copy': 'The driver closed the trip.',
      'icon': Icons.flag_circle_rounded,
    },
  ];

  /// CANCELLED has no outgoing edge in the transition table, so the row cannot move
  /// again. Nothing here claims what happened to the money — the settlement figures come
  /// from the cancel write's own response, never from this table.
  static const Map<String, Map<String, String>> _stoppedStates =
      <String, Map<String, String>>{
    'CANCELLED': <String, String>{
      'title': 'Cancelled',
      'copy': 'This trip was cancelled and will not move again.',
    },
  };

  /// ACCEPTED is a distinct stored status that means the same thing to a passenger as
  /// ASSIGNED, so it reads as that step rather than as an unknown stage.
  static const Map<String, String> _stateAliases = <String, String>{
    'ACCEPTED': 'ASSIGNED',
  };

  /// The six states `CANCELLED` is reachable from (`JobRepository.js:22`). Offering a
  /// cancellation anywhere else would offer a write the platform refuses.
  static const List<String> _cancellableStates = <String>[
    'REQUESTED',
    'SEARCHING',
    'ASSIGNED',
    'ACCEPTED',
    'DRIVER_ARRIVING',
    'DRIVER_ARRIVED',
  ];

  static const List<String> _cancelReasons = <String>[
    'Change of plans / no longer needed',
    'Booked the wrong vehicle',
    'Driver is taking too long to arrive',
    'Cannot reach the driver',
    'Incorrect pickup or drop location',
  ];

  /// Quoted from `cancel_ride_atomic` (migration 016:308-343). That is the whole rule —
  /// there is no per-vehicle-class fee table anywhere in the platform.
  static const List<String> _cancelRules = <String>[
    'If no driver is attached to the trip, there is no fee.',
    'Once a driver is attached, cancelling more than 2 minutes after that assignment '
        'costs a flat Rs 50.00.',
    '40.00 of that fee goes to the driver and 10.00 to the platform.',
    'A refund is made against whatever was actually captured as payment, so a trip that '
        'was never paid has nothing to refund.',
  ];

  Map<String, dynamic>? _tracking;

  /// Captured from the `DRIVER_ASSIGNED` push — the only source of a plate and the
  /// trip-start code. Never invented when it has not arrived.
  Map<String, dynamic>? _assigned;

  /// The cancel write's response, kept so the money the platform settled stays on screen.
  Map<String, dynamic>? _settlement;

  bool _loading = true;
  bool _failed = false;
  bool _cancelling = false;
  DateTime? _lastReadAt;
  Timer? _poll;
  StreamSubscription<Map<String, dynamic>>? _tripSub;

  @override
  void initState() {
    super.initState();
    _load();
    if (_jobId.isNotEmpty) {
      // A re-read of the same row, never a local guess about what happened next.
      _poll = Timer.periodic(_pollEvery, (_) => _load(silent: true));
    }
    _connectCustomerWs();
  }

  @override
  void dispose() {
    _poll?.cancel();
    _tripSub?.cancel();
    super.dispose();
  }

  void _connectCustomerWs() {
    final userId = SessionManager.instance.currentUser?['id']?.toString();
    if (userId == null || userId.isEmpty) return;
    NabinWsService.instance.connect(role: 'customer', userId: userId);
    _tripSub = NabinWsService.instance.onTripUpdate.listen(_onTripUpdate);
  }

  void _onTripUpdate(Map<String, dynamic> msg) {
    if (!mounted) return;
    final fromMessage = msg['jobId']?.toString();
    final tracked = _tracking?['jobId']?.toString();
    if (fromMessage != null && tracked != null && fromMessage != tracked) return;

    if (msg['type'] == 'DRIVER_ASSIGNED' && msg['driver'] is Map) {
      _assigned = Map<String, dynamic>.from(msg['driver'] as Map);
    }
    // The message says something changed; the row says what. Re-read rather than
    // presenting the push as the trip's state.
    _load(silent: true);
  }

  Future<void> _load({bool silent = false}) async {
    if (_jobId.isEmpty) {
      setState(() {
        _loading = false;
        _failed = false;
      });
      return;
    }
    if (!silent) setState(() => _loading = true);

    final res = await NabinApiService.getJobTracking(_jobId);

    if (!mounted) return;
    setState(() {
      _loading = false;
      if (res != null && res['success'] == true) {
        _tracking = res;
        _lastReadAt = DateTime.now();
        _failed = false;
        if (_isCompleted || _isStopped) _poll?.cancel();
      } else if (!silent) {
        _failed = true;
      }
      // A silent re-read that fails keeps the last row on screen rather than blanking
      // a status the customer was already reading.
    });
  }

  // ── Derived from the read ──────────────────────────────────────────────────────

  String get _jobId => widget.jobId ?? '';

  PassengerBookingInfo get passenger =>
      widget.passengerInfo ?? const PassengerBookingInfo();

  String get _status => (_tracking?['status'] ?? '').toString();

  String get _effectiveStatus => _stateAliases[_status] ?? _status;

  int get _ladderIndex {
    for (var i = 0; i < _ladder.length; i++) {
      if (_ladder[i]['state'] == _effectiveStatus) return i;
    }
    return -1;
  }

  bool get _isStopped => _stoppedStates.containsKey(_status);

  bool get _isCompleted => _status == 'COMPLETED';

  bool get _canCancel =>
      _cancellableStates.contains(_status) && _settlement == null;

  Map<String, dynamic> get _driver {
    final raw = _tracking?['driver'];
    return raw is Map
        ? Map<String, dynamic>.from(raw)
        : const <String, dynamic>{};
  }

  String get _driverName {
    final fromRow = (_driver['name'] ?? '').toString();
    return fromRow.isNotEmpty ? fromRow : (_assigned?['name'] ?? '').toString();
  }

  String get _driverPhone => (_driver['phone'] ?? '').toString();

  String get _driverPlate => (_assigned?['vehiclePlate'] ?? '').toString();

  // There is deliberately no rating reader here. `drivers.rating NUMERIC(3,2) DEFAULT 5.00`
  // (001_central_schema.sql:58) is a column default and no reviews or ratings table exists in this
  // schema, so the server no longer puts a `rating` on the `DRIVER_ASSIGNED` payload at all — the
  // same ruling migration 034 made for `merchants.rating`. Reading the field "defensively" would be
  // a standing invitation to put a default on screen as a score.

  Map<String, dynamic> get _location {
    final raw = _tracking?['location'];
    return raw is Map
        ? Map<String, dynamic>.from(raw)
        : const <String, dynamic>{};
  }

  /// The trip-start code exists in exactly one place a customer can see it: the
  /// `DRIVER_ASSIGNED` payload. No customer read returns it, so when that message has not
  /// arrived this card is not shown at all. Once the trip is moving the code has been
  /// verified, so it stops being useful.
  String get _startCode {
    final code = (_assigned?['startOtp'] ?? '').toString();
    if (code.isEmpty) return '';
    if (_ladderIndex >= _ladder.length - 2) return '';
    return code;
  }

  String _addressOf(String which) {
    final fromRow = _asAddress(_tracking?[which]);
    if (fromRow.isNotEmpty) return fromRow;
    return which == 'pickup'
        ? (passenger.pickupAddress ?? '')
        : (passenger.dropAddress ?? '');
  }

  String _asAddress(dynamic raw) {
    if (raw is Map) {
      return (Map<String, dynamic>.from(raw)['address'] ?? '').toString();
    }
    return (raw ?? '').toString();
  }

  // ── Actions ────────────────────────────────────────────────────────────────────

  Future<void> _launch(Uri uri, String fallback) async {
    try {
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened && mounted) {
        _showSnack(fallback);
      }
    } catch (_) {
      if (mounted) _showSnack(fallback);
    }
  }

  void _showSnack(String message, {Color? color}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: color ?? AppTheme.onSurface),
    );
  }

  void _call(String number) {
    _launch(Uri(scheme: 'tel', path: number),
        'NABIN could not open the dialer. Dial $number yourself.');
  }

  void _messageDriver() {
    if (_driverPhone.isEmpty) return;
    final greeting = _driverName.isEmpty ? 'Hi,' : 'Hi $_driverName,';
    final pickup = _addressOf('pickup');
    final waiting = pickup.isEmpty ? '' : ' I am waiting at the pickup point ($pickup).';
    _launch(
      Uri(
        scheme: 'sms',
        path: _driverPhone,
        queryParameters: <String, String>{
          'body': '$greeting this is the customer on your NABIN trip '
              '${_tripNumber()}.$waiting'
        },
      ),
      'NABIN could not open the messaging app.',
    );
  }

  /// Built only from values the platform supplied. The previous version of this message
  /// carried a live-tracking URL that does not exist and a `7729` code that was never
  /// real.
  String _tripSummaryMessage() {
    final parts = <String>[
      'NABIN trip ${_tripNumber()}',
      if (_status.isNotEmpty) 'Stage: $_status',
      if (_driverName.isNotEmpty) 'Driver: $_driverName',
      if (_driverPlate.isNotEmpty) 'Vehicle: $_driverPlate',
      if (_addressOf('pickup').isNotEmpty) 'Pickup: ${_addressOf('pickup')}',
      if (_addressOf('drop').isNotEmpty) 'Drop: ${_addressOf('drop')}',
    ];
    return parts.join(' - ');
  }

  void _showSafetySheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.surfaceContainerLowest,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Row(
                  children: [
                    Icon(Icons.shield_rounded, color: AppTheme.error, size: 22),
                    SizedBox(width: 8),
                    Text('Safety',
                        style: TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 16,
                            color: AppTheme.onSurface)),
                  ],
                ),
                IconButton(
                  icon: const Icon(Icons.close_rounded),
                  onPressed: () => Navigator.pop(ctx),
                ),
              ],
            ),
            const Text(
              'These actions use what the trip row reports. Nothing here reaches NABIN as '
              'an alert, because the platform has no emergency-event write.',
              style: TextStyle(
                  fontSize: 11.5, color: AppTheme.onSurfaceVariant, height: 1.35),
            ),
            const SizedBox(height: 10),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.sos_rounded, color: AppTheme.error),
              title: const Text('Dial 112',
                  style: TextStyle(fontWeight: FontWeight.w700)),
              subtitle: const Text('India\'s emergency number, on your own phone',
                  style: TextStyle(fontSize: 11.5)),
              onTap: () {
                Navigator.pop(ctx);
                _call('112');
              },
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.share_location_rounded,
                  color: AppTheme.primary),
              title: const Text('Send the trip details by SMS',
                  style: TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text(
                _tripSummaryMessage(),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 11.5),
              ),
              onTap: () {
                Navigator.pop(ctx);
                _launch(
                  Uri(
                    scheme: 'sms',
                    queryParameters: <String, String>{
                      'body': _tripSummaryMessage()
                    },
                  ),
                  'NABIN could not open the messaging app.',
                );
              },
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.support_agent_rounded,
                  color: AppTheme.primary),
              title: const Text('Contact Support',
                  style: TextStyle(fontWeight: FontWeight.w700)),
              subtitle: const Text('For anything this screen cannot act on',
                  style: TextStyle(fontSize: 11.5)),
              onTap: () {
                Navigator.pop(ctx);
                context.push('/support');
              },
            ),
          ],
        ),
      ),
    );
  }

  void _showCancelSheet(BuildContext context) {
    var selected = 0;
    var driverLate = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) => Container(
          decoration: const BoxDecoration(
            color: AppTheme.surfaceContainerLowest,
            borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
          ),
          padding: const EdgeInsets.fromLTRB(20, 14, 20, 24),
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
                      Icon(Icons.cancel_rounded,
                          color: AppTheme.error, size: 22),
                      SizedBox(width: 8),
                      Text('Cancel this trip',
                          style: TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 16,
                              color: AppTheme.onSurface)),
                    ],
                  ),
                  IconButton(
                    icon: const Icon(Icons.close_rounded),
                    onPressed: () => Navigator.pop(ctx),
                  ),
                ],
              ),
              Text(
                'Trip ${_tripNumber()} is at: '
                '${_status.isEmpty ? 'not reported' : _status}. Cancelling here writes to '
                'the platform, and the platform settles the money.',
                style: const TextStyle(
                    fontSize: 11.5,
                    color: AppTheme.onSurfaceVariant,
                    height: 1.35),
              ),
              const SizedBox(height: 12),
              ...List.generate(_cancelReasons.length, (idx) {
                final isSelected = selected == idx;
                return InkWell(
                  onTap: () => setModalState(() => selected = idx),
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    margin: const EdgeInsets.only(bottom: 6),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: isSelected
                          ? AppTheme.primary.withValues(alpha: 0.08)
                          : Colors.transparent,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: isSelected
                            ? AppTheme.primary
                            : AppTheme.outlineVariant.withValues(alpha: 0.5),
                        width: isSelected ? 1.5 : 1,
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          isSelected
                              ? Icons.radio_button_checked
                              : Icons.radio_button_off,
                          size: 18,
                          color: isSelected
                              ? AppTheme.primary
                              : AppTheme.outline,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            _cancelReasons[idx],
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: isSelected
                                  ? FontWeight.w700
                                  : FontWeight.w500,
                              color: isSelected
                                  ? AppTheme.primary
                                  : AppTheme.onSurface,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              }),
              // The sheet's own background is a DecoratedBox, which would paint over the
              // tile's ink; Material gives the tile a surface of its own.
              Material(
                type: MaterialType.transparency,
                child: CheckboxListTile(
                  value: driverLate,
                  onChanged: (value) =>
                      setModalState(() => driverLate = value ?? false),
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  activeColor: AppTheme.primary,
                  title: const Text(
                      'The driver has been attached for more than 2 minutes and is late',
                      style: TextStyle(fontSize: 12)),
                  subtitle: const Text(
                    'This is your declaration. The platform records it as '
                    'isDelayedOverride and decides the fee with it.',
                    style: TextStyle(fontSize: 11),
                  ),
                ),
              ),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceContainerLow,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppTheme.outlineVariant),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('How the platform charges a cancellation',
                        style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
                    const SizedBox(height: 6),
                    ..._cancelRules.map(
                      (rule) => Padding(
                        padding: const EdgeInsets.only(bottom: 3),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('•  ',
                                style: TextStyle(
                                    fontSize: 11.5,
                                    color: AppTheme.onSurfaceVariant)),
                            Expanded(
                              child: Text(rule,
                                  style: const TextStyle(
                                      fontSize: 11.5,
                                      color: AppTheme.onSurfaceVariant,
                                      height: 1.3)),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const Text(
                      'The fee is not known until the write returns, so no amount is '
                      'promised here.',
                      style: TextStyle(
                          fontSize: 11, color: AppTheme.onSurface, height: 1.3),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(ctx),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 13),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14)),
                      ),
                      child: const Text('Keep my trip',
                          style: TextStyle(fontWeight: FontWeight.w700)),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      onPressed: _cancelling
                          ? null
                          : () {
                              Navigator.pop(ctx);
                              _cancelTrip(
                                reason: _cancelReasons[selected],
                                driverLate: driverLate,
                              );
                            },
                      style: FilledButton.styleFrom(
                        backgroundColor: AppTheme.error,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 13),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14)),
                      ),
                      child: Text(
                        _cancelling ? 'Cancelling…' : 'Cancel the trip',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _cancelTrip({
    required String reason,
    required bool driverLate,
  }) async {
    setState(() => _cancelling = true);
    final res = await NabinApiService.cancelRide(
      jobId: _jobId,
      reason: reason,
      isDelayedOverride: driverLate,
    );
    if (!mounted) return;
    setState(() {
      _cancelling = false;
      if (res != null && res['success'] == true) {
        _settlement = res;
        _poll?.cancel();
      }
    });
    if (res == null || res['success'] != true) {
      _showSnack(
        'The trip was not cancelled. Nothing changed on the platform.',
        color: AppTheme.error,
      );
      return;
    }
    _load(silent: true);
  }

  // ── Body ───────────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.surface,
      body: SafeArea(bottom: false, child: _buildBody()),
    );
  }

  Widget _buildBody() {
    if (_loading && _tracking == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_failed || _tracking == null) {
      return _buildUnavailable();
    }

    return RefreshIndicator(
      color: AppTheme.primary,
      backgroundColor: AppTheme.surface,
      onRefresh: () => _load(),
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          _buildStatusBand(),
          _buildStageBanner(),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _buildPositionPanel(),
                const SizedBox(height: 14),
                _buildDriverCard(),
                if (_startCode.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  _buildStartCodeCard(),
                ],
                const SizedBox(height: 14),
                _buildTripCard(),
                if (passenger.isForSomeoneElse) ...[
                  const SizedBox(height: 14),
                  _buildPassengerCard(),
                ],
                const SizedBox(height: 14),
                _buildTimeline(),
                const SizedBox(height: 14),
                _buildCancellationCard(),
                const SizedBox(height: 14),
                _buildSafetyRow(),
                const SizedBox(height: 20),
                _buildPrimaryAction(),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildUnavailable() {
    final bool noId = _jobId.isEmpty;
    return Column(
      children: [
        _buildBandChrome(showRefresh: !noId),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  noId ? Icons.local_taxi_rounded : Icons.cloud_off_rounded,
                  size: 40,
                  color: AppTheme.onSurfaceVariant,
                ),
                const SizedBox(height: 12),
                Text(
                  noId
                      ? 'No trip to follow. Book a ride and this screen will track it.'
                      : 'NABIN couldn\'t load this trip right now.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                    color: AppTheme.onSurface,
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Its stage, driver and addresses come from the trip row. Nothing is '
                  'guessed while it cannot be read.',
                  textAlign: TextAlign.center,
                  style:
                      TextStyle(fontSize: 12.5, color: AppTheme.onSurfaceVariant),
                ),
                if (!noId) ...[
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: () => _load(),
                    style: FilledButton.styleFrom(
                      backgroundColor: AppTheme.primary,
                      foregroundColor: Colors.white,
                    ),
                    child: const Text('Retry'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  // ── Status band ────────────────────────────────────────────────────────────────

  Widget _buildStatusBand() {
    final Color band = _isStopped
        ? AppTheme.error
        : (_isCompleted ? AppTheme.success : AppTheme.primary);
    final int index = _ladderIndex;
    final String headline = index >= 0
        ? _ladder[index]['title'] as String
        : (_stoppedStates[_status]?['title'] ?? 'Stage not reported');

    return Container(
      width: double.infinity,
      color: band,
      child: Column(
        children: [
          _buildBandChrome(showRefresh: true),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 18),
            child: Column(
              children: [
                Text(
                  headline,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    height: 1.2,
                  ),
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.16),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    _pill(),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  _tripNumber(),
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.8),
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.4,
                  ),
                ),
                if (!_isCompleted && !_isStopped) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Re-reads every ${_pollEvery.inSeconds} seconds',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.75),
                      fontSize: 10.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBandChrome({required bool showRefresh}) {
    return Column(
      children: [
        Row(
          children: [
            IconButton(
              icon: const Icon(Icons.keyboard_arrow_down_rounded,
                  color: Colors.white, size: 26),
              tooltip: 'Close',
              onPressed: () {
                if (Navigator.of(context).canPop()) {
                  Navigator.of(context).pop();
                } else {
                  context.go('/home');
                }
              },
            ),
            const Spacer(),
            IconButton(
              icon: const Icon(Icons.shield_rounded,
                  color: Colors.white, size: 22),
              tooltip: 'Safety',
              onPressed: () => _showSafetySheet(context),
            ),
            IconButton(
              icon: const Icon(Icons.support_agent_rounded,
                  color: Colors.white, size: 22),
              tooltip: 'Contact support',
              onPressed: () => context.push('/support'),
            ),
          ],
        ),
        if (showRefresh)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text(
                  'Live trip',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1.1,
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.refresh_rounded,
                      color: Colors.white, size: 20),
                  tooltip: 'Read the trip again',
                  onPressed: () => _load(),
                ),
              ],
            ),
          ),
      ],
    );
  }

  String _pill() {
    if (_isStopped) return 'This trip is closed';
    if (_isCompleted) return 'Trip closed by the driver';
    final who = _driverName.isEmpty ? 'Your driver' : _driverName;
    switch (_effectiveStatus) {
      case 'REQUESTED':
        return 'No driver assigned yet';
      case 'SEARCHING':
        return 'Looking for a driver';
      case 'ASSIGNED':
      case 'DRIVER_ARRIVING':
        return '$who is on the way to you';
      case 'DRIVER_ARRIVED':
        return '$who is at the pickup point';
      case 'IN_TRANSIT':
        final drop = _addressOf('drop');
        return drop.isEmpty ? 'Trip in progress' : 'On the way to $drop';
      default:
        return '${widget.vehicleName} • ${widget.vehicleType}';
    }
  }

  // ── Banner line under the band ─────────────────────────────────────────────────

  Widget _buildStageBanner() {
    final int index = _ladderIndex;
    final String copy = index >= 0
        ? _ladder[index]['copy'] as String
        : (_stoppedStates[_status]?['copy'] ??
            (_status.isEmpty
                ? 'The trip row did not report a stage, so nothing is invented for it.'
                : 'The trip row reported the stage "$_status". This app has no view for '
                    'it, so it shows the row as it is.'));
    final IconData icon = index >= 0
        ? _ladder[index]['icon'] as IconData
        : (_isStopped ? Icons.cancel_rounded : Icons.info_outline_rounded);

    return Container(
      width: double.infinity,
      color: AppTheme.surface,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: AppTheme.primary.withValues(alpha: 0.08),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 18, color: AppTheme.primary),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              copy,
              style: const TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                color: AppTheme.onSurface,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── Position ───────────────────────────────────────────────────────────────────

  Widget _buildPositionPanel() {
    final location = _location;
    final lat = location['lat'];
    final lng = location['lng'];
    final bool hasPosition = lat != null && lng != null;
    final speed = _asDouble(location['speed']);
    final heading = _asDouble(location['heading']);
    final bits = <String>[
      '$lat, $lng',
      if (speed > 0) '${speed.toStringAsFixed(1)} km/h',
      if (heading > 0) 'heading ${heading.toStringAsFixed(0)}°',
    ];

    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: const BoxDecoration(
                  color: AppTheme.surfaceContainerLow,
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.location_searching_rounded,
                    size: 20, color: AppTheme.onSurfaceVariant),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Text(
                  'Where the driver is',
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          hasPosition
              ? Text(
                  'Last position the driver\'s app reported: ${bits.join(' • ')}',
                  style: const TextStyle(
                      fontSize: 12, fontWeight: FontWeight.w700, height: 1.4),
                )
              : const Text(
                  'The driver\'s app has not reported a position for this trip yet.',
                  style:
                      TextStyle(fontSize: 12, color: AppTheme.onSurfaceVariant),
                ),
          const SizedBox(height: 6),
          const Text(
            'NABIN publishes no route line, remaining distance or arrival time for a '
            'trip, so none is drawn or counted down here.',
            style: TextStyle(
                fontSize: 11.5,
                color: AppTheme.onSurfaceVariant,
                height: 1.4),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              const Icon(Icons.schedule_rounded,
                  size: 14, color: AppTheme.onSurfaceVariant),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  'Checked ${_checkedAt()} from the trip row',
                  overflow: TextOverflow.ellipsis,
                  maxLines: 1,
                  style: const TextStyle(
                      fontSize: 11.5, color: AppTheme.onSurfaceVariant),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ── Driver ─────────────────────────────────────────────────────────────────────

  Widget _buildDriverCard() {
    final name = _driverName;
    final hasDriver = name.isNotEmpty || _assigned != null;

    if (!hasDriver) {
      return _card(
        child: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('No driver yet',
                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
            SizedBox(height: 6),
            Text(
              'The platform names the driver when one takes the trip, and sends the '
              'plate and start code in that same message. Until it does, this '
              'screen shows none of them.',
              style: TextStyle(
                  fontSize: 12,
                  height: 1.45,
                  color: AppTheme.onSurfaceVariant),
            ),
          ],
        ),
      );
    }

    final details = <String>[
      if (_assigned?['vehicleName'] != null)
        _assigned!['vehicleName'].toString(),
      if (_driverPlate.isNotEmpty) _driverPlate,
    ];

    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: const BoxDecoration(
                  color: AppTheme.primary,
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: Text(
                    _initials(name),
                    style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                        fontSize: 15),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name.isEmpty ? 'Assigned driver' : name,
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                      style: const TextStyle(
                          fontWeight: FontWeight.w800, fontSize: 14),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      details.isEmpty
                          ? 'Vehicle details were not in the assignment message.'
                          : details.join(' • '),
                      style: const TextStyle(
                          fontSize: 11.5, color: AppTheme.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              _fareChip(),
            ],
          ),
          const SizedBox(height: 12),
          if (_driverPhone.isNotEmpty)
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _messageDriver,
                    icon: const Icon(Icons.chat_bubble_outline_rounded, size: 15),
                    label: const Text('Message',
                        style: TextStyle(fontWeight: FontWeight.w700)),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTheme.primary,
                      side: const BorderSide(color: AppTheme.primaryFixed),
                      padding: const EdgeInsets.symmetric(vertical: 11),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => _call(_driverPhone),
                    icon: const Icon(Icons.phone_rounded, size: 15),
                    label: const Text('Call driver',
                        style: TextStyle(fontWeight: FontWeight.w700)),
                    style: FilledButton.styleFrom(
                      backgroundColor: AppTheme.primary,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 11),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                ),
              ],
            )
          else
            const Text(
              'The trip row did not carry a phone number for this driver, so there is '
              'nothing to dial or message from here. Use Support to reach the platform.',
              style: TextStyle(
                  fontSize: 11.5,
                  height: 1.4,
                  color: AppTheme.onSurfaceVariant),
            ),
        ],
      ),
    );
  }

  Widget _buildStartCodeCard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: AppTheme.primary.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.primary.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'START CODE FOR THE DRIVER',
                  style: TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.w900,
                      color: AppTheme.primary,
                      letterSpacing: 0.6),
                ),
                SizedBox(height: 2),
                Text(
                  'The driver enters this on their app to start the trip. It arrived with '
                  'the driver assignment.',
                  style:
                      TextStyle(fontSize: 10.5, color: AppTheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Text(
            _startCode,
            style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w900,
                color: AppTheme.primary,
                letterSpacing: 2),
          ),
        ],
      ),
    );
  }

  // ── Trip ───────────────────────────────────────────────────────────────────────

  Widget _buildTripCard() {
    final pickup = _addressOf('pickup');
    final drop = _addressOf('drop');
    final quote = widget.fare.trim();

    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Trip',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
          const SizedBox(height: 10),
          _buildAddressRow(Icons.trip_origin_rounded,
              pickup.isEmpty ? 'Pickup not recorded on the trip row' : pickup),
          const SizedBox(height: 8),
          _buildAddressRow(Icons.place_outlined,
              drop.isEmpty ? 'Drop not recorded on the trip row' : drop),
          const Divider(height: 20),
          Text(
            quote.isEmpty
                ? 'No fare was carried into this screen.'
                : 'Quote from the booking: $quote',
            style: const TextStyle(
                fontSize: 12, fontWeight: FontWeight.w700, height: 1.35),
          ),
          const SizedBox(height: 4),
          const Text(
            'The trip row read here reports no fare, so nothing on this screen settles, '
            'refunds or adjusts money. Only the cancellation write returns figures, and it '
            'returns the platform\'s own.',
            style: TextStyle(
                fontSize: 11, height: 1.4, color: AppTheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }

  Widget _buildAddressRow(IconData icon, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 15, color: AppTheme.onSurfaceVariant),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(
                fontSize: 12.5, color: AppTheme.onSurface, height: 1.35),
          ),
        ),
      ],
    );
  }

  Widget _fareChip() {
    final label = widget.fare.trim();
    if (label.isEmpty) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: AppTheme.primary.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: const TextStyle(
            fontSize: 12, fontWeight: FontWeight.w800, color: AppTheme.primary),
      ),
    );
  }

  Widget _buildPassengerCard() {
    final p = passenger;
    final isChild = p.isSchoolChild;
    final guardian = (p.guardianPhone ?? '').trim();
    final accent = isChild ? AppTheme.warning : AppTheme.primary;

    return _card(
      borderColor: accent.withValues(alpha: 0.4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            isChild ? 'SCHOOL CHILD PASSENGER' : 'BOOKED FOR SOMEONE ELSE',
            style: TextStyle(
                fontSize: 9.5,
                fontWeight: FontWeight.w900,
                color: accent,
                letterSpacing: 0.6),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      p.passengerName?.isNotEmpty == true
                          ? p.passengerName!
                          : 'Passenger',
                      style: const TextStyle(
                          fontWeight: FontWeight.w800, fontSize: 13.5),
                    ),
                    if (isChild) ...[
                      const SizedBox(height: 2),
                      Text(
                        '${p.schoolName ?? 'School'}'
                        '${p.gradeClass != null && p.gradeClass!.isNotEmpty ? ' • ${p.gradeClass}' : ''}'
                        '${p.section != null && p.section!.isNotEmpty ? ' (${p.section})' : ''}',
                        style: const TextStyle(
                            fontSize: 11.5, color: AppTheme.onSurfaceVariant),
                      ),
                    ],
                  ],
                ),
              ),
              if (isChild && guardian.isNotEmpty)
                IconButton(
                  icon: Icon(Icons.call_rounded, color: accent, size: 20),
                  tooltip: 'Call guardian',
                  onPressed: () => _call(guardian),
                ),
            ],
          ),
          const SizedBox(height: 2),
          const Text(
            'These are the details you entered for the passenger. The platform does not '
            'verify them against a school record.',
            style: TextStyle(
                fontSize: 11, height: 1.4, color: AppTheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }

  // ── Stage ladder ───────────────────────────────────────────────────────────────

  Widget _buildTimeline() {
    final int current = _ladderIndex;

    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Trip stages',
                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
              ),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  current >= 0
                      ? 'Step ${current + 1} of ${_ladder.length}'
                      : (_isStopped
                          ? 'Closed'
                          : (_status.isEmpty
                              ? 'No stage reported'
                              : 'Unrecognised stage')),
                  textAlign: TextAlign.end,
                  overflow: TextOverflow.ellipsis,
                  maxLines: 1,
                  style: const TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: AppTheme.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          const Text(
            'The driver\'s app writes these stages. This screen reads them; it never '
            'advances on its own.',
            style: TextStyle(fontSize: 11.5, color: AppTheme.onSurfaceVariant),
          ),
          const SizedBox(height: 14),
          ...List.generate(_ladder.length, (idx) {
            final stage = _ladder[idx];
            return _buildStep(
              idx,
              stage['title'] as String,
              stage['copy'] as String,
              stage['icon'] as IconData,
              current: current,
              isLast: idx == _ladder.length - 1,
            );
          }),
        ],
      ),
    );
  }

  Widget _buildStep(
    int idx,
    String title,
    String subtitle,
    IconData icon, {
    required int current,
    bool isLast = false,
  }) {
    final bool isDone = current >= 0 && idx <= current;
    final bool isCurrent = current == idx;

    final Color badge = isCurrent
        ? AppTheme.primary
        : (isDone ? AppTheme.success : AppTheme.surface);
    final Color badgeIcon = isDone ? Colors.white : AppTheme.onSurfaceVariant;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Column(
          children: [
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                color: badge,
                shape: BoxShape.circle,
                border: Border.all(
                  color: isDone ? Colors.transparent : AppTheme.outlineVariant,
                ),
              ),
              child: Icon(
                isDone && !isCurrent ? Icons.check_rounded : icon,
                color: badgeIcon,
                size: 14,
              ),
            ),
            if (!isLast)
              Container(
                width: 2,
                height: 22,
                color: isDone ? AppTheme.success : AppTheme.outlineVariant,
              ),
          ],
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: isCurrent
                      ? FontWeight.w800
                      : (isDone ? FontWeight.w700 : FontWeight.w500),
                  color: isCurrent
                      ? AppTheme.primary
                      : (isDone ? AppTheme.onSurface : AppTheme.onSurfaceVariant),
                ),
              ),
              Text(
                subtitle,
                style: const TextStyle(
                    fontSize: 10.5, color: AppTheme.onSurfaceVariant),
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ],
    );
  }

  // ── Cancellation ───────────────────────────────────────────────────────────────

  Widget _buildCancellationCard() {
    if (_settlement != null) return _buildSettlementCard(_settlement!);

    if (_canCancel) {
      return _card(
        borderColor: AppTheme.error.withValues(alpha: 0.3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    _cancelling ? 'Cancelling this trip…' : 'Cancel this trip',
                    style: const TextStyle(
                        fontWeight: FontWeight.w800, fontSize: 13.5),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  _status,
                  style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: AppTheme.onSurfaceVariant),
                ),
              ],
            ),
            const SizedBox(height: 6),
            const Text(
              'This writes to the platform. The fee, the driver compensation and the '
              'refund are whatever the platform returns, and they appear here after it '
              'does.',
              style: TextStyle(
                  fontSize: 11.5,
                  height: 1.4,
                  color: AppTheme.onSurfaceVariant),
            ),
            const SizedBox(height: 10),
            OutlinedButton(
              onPressed:
                  _cancelling ? null : () => _showCancelSheet(context),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppTheme.error,
                side: const BorderSide(color: AppTheme.error),
                minimumSize: const Size(double.infinity, 44),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14)),
              ),
              child: const Text('Cancel trip',
                  style: TextStyle(fontWeight: FontWeight.w700)),
            ),
          ],
        ),
      );
    }

    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Cancellation',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
          const SizedBox(height: 6),
          Text(
            _isCompleted
                ? 'This trip is completed, so it can no longer be cancelled.'
                : (_status.isEmpty
                    ? 'The trip row reported no stage, so this screen does not offer a '
                        'cancellation.'
                    : 'A trip at the stage "$_status" cannot be cancelled — the platform '
                        'accepts a cancellation only before the trip is running.'),
            style: const TextStyle(
                fontSize: 11.5,
                height: 1.4,
                color: AppTheme.onSurfaceVariant),
          ),
          const SizedBox(height: 4),
          const Text(
            'To stop a trip that is already running, tell the driver where to stop and '
            'raise any fare question with Support — there is no customer early-stop or '
            'trip-adjustment write on the platform.',
            style: TextStyle(
                fontSize: 11.5, height: 1.4, color: AppTheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }

  Widget _buildSettlementCard(Map<String, dynamic> res) {
    return _card(
      borderColor: AppTheme.success.withValues(alpha: 0.4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.check_circle_rounded,
                  color: AppTheme.success, size: 20),
              const SizedBox(width: 8),
              const Expanded(
                child: Text('Cancellation settled',
                    style:
                        TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
              ),
              Text(
                (res['status'] ?? 'CANCELLED').toString(),
                style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: AppTheme.onSurfaceVariant),
              ),
            ],
          ),
          const SizedBox(height: 10),
          _buildSummaryRow('Cancellation fee', _rupee(res['cancellationFee'])),
          _buildSummaryRow('Refund', _rupee(res['refundAmount'])),
          _buildSummaryRow(
              'Driver compensation', _rupee(res['driverCompensation'])),
          const SizedBox(height: 8),
          Text(
            _refundLine(res),
            style:
                const TextStyle(fontSize: 11.5, height: 1.4, color: AppTheme.onSurface),
          ),
          const SizedBox(height: 6),
          const Text(
            'These figures are what the platform wrote when it recorded the '
            'cancellation. This screen cannot change them.',
            style: TextStyle(
                fontSize: 11, height: 1.4, color: AppTheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }

  String _refundLine(Map<String, dynamic> res) {
    final status = (res['refundStatus'] ?? '').toString();
    final amount = _rupee(res['refundAmount']);
    switch (status) {
      case 'REFUNDED':
        return 'Refund status: REFUNDED. $amount was returned.';
      case 'PARTIALLY_REFUNDED':
        return 'Refund status: PARTIALLY_REFUNDED. $amount was returned against the '
            'amount that was actually captured as payment.';
      case 'NOT_APPLICABLE':
        return 'Refund status: NOT_APPLICABLE. Nothing was captured as payment for this '
            'trip, so there is nothing to return.';
      case '':
        return 'The platform returned no refund status.';
      default:
        return 'The platform returned refund status: $status.';
    }
  }

  Widget _buildSummaryRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Text(label,
                style: const TextStyle(
                    fontSize: 12, color: AppTheme.onSurfaceVariant)),
          ),
          const SizedBox(width: 8),
          Text(value,
              style:
                  const TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
        ],
      ),
    );
  }

  // ── Safety and primary action ──────────────────────────────────────────────────

  Widget _buildSafetyRow() {
    return Row(
      children: [
        Expanded(
          child: OutlinedButton.icon(
            onPressed: () => _showSafetySheet(context),
            icon: const Icon(Icons.shield_rounded, size: 16),
            label: const Text('Safety',
                style: TextStyle(fontWeight: FontWeight.w700)),
            style: OutlinedButton.styleFrom(
              foregroundColor: AppTheme.error,
              side: const BorderSide(color: AppTheme.error),
              padding: const EdgeInsets.symmetric(vertical: 12),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14)),
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: OutlinedButton.icon(
            onPressed: () => context.push('/support'),
            icon: const Icon(Icons.support_agent_rounded, size: 16),
            label: const Text('Support',
                style: TextStyle(fontWeight: FontWeight.w700)),
            style: OutlinedButton.styleFrom(
              foregroundColor: AppTheme.primary,
              side: const BorderSide(color: AppTheme.primaryFixed),
              padding: const EdgeInsets.symmetric(vertical: 12),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14)),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildPrimaryAction() {
    if (_isCompleted) {
      return FilledButton.icon(
        onPressed: () {
          context.pushReplacement('/ride-receipt', extra: {
            'jobId': _jobId,
            'fare': widget.fare,
            'vehicleType': widget.vehicleType,
            'vehicleName': widget.vehicleName,
          });
        },
        icon: const Icon(Icons.receipt_long_rounded, size: 18),
        label: const Text('View trip receipt',
            style: TextStyle(fontWeight: FontWeight.w700)),
        style: FilledButton.styleFrom(
          backgroundColor: AppTheme.primary,
          foregroundColor: Colors.white,
          minimumSize: const Size(double.infinity, 50),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
      );
    }
    return OutlinedButton(
      onPressed: () => context.go('/home'),
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(double.infinity, 48),
        side: const BorderSide(color: AppTheme.primary),
        foregroundColor: AppTheme.primary,
        shape:
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      child: const Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.home_rounded, size: 18),
          SizedBox(width: 8),
          Text('Back to NABIN', style: TextStyle(fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }

  // ── Shared pieces ──────────────────────────────────────────────────────────────

  Widget _card({required Widget child, Color? borderColor}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceCard,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: borderColor ?? AppTheme.outlineVariant),
      ),
      child: child,
    );
  }

  String _tripNumber() {
    final id = (_tracking?['jobId'] ?? _jobId).toString();
    return id.isEmpty ? 'no trip id' : '#$id';
  }

  String _initials(String name) {
    final parts = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .toList();
    if (parts.isEmpty) return 'D';
    if (parts.length == 1) return parts[0].substring(0, 1).toUpperCase();
    return (parts[0].substring(0, 1) + parts[1].substring(0, 1)).toUpperCase();
  }

  String _checkedAt() {
    final at = _lastReadAt;
    if (at == null) return '—';
    final local = at.toLocal();
    final hour12 = local.hour % 12 == 0 ? 12 : local.hour % 12;
    final suffix = local.hour < 12 ? 'AM' : 'PM';
    return '$hour12:${local.minute.toString().padLeft(2, '0')} $suffix';
  }

  double _asDouble(dynamic raw) {
    if (raw is num) return raw.toDouble();
    return double.tryParse(raw?.toString() ?? '') ?? 0;
  }

  String _rupee(dynamic raw) => '₹${_asDouble(raw).toStringAsFixed(2)}';
}
