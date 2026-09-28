import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/network/nabin_ws_service.dart';
import '../../../../core/theme/driver_theme.dart';
import '../../../../core/widgets/driver_button.dart';
import '../../../../core/widgets/driver_card.dart';

/// Executing one trip, stage by stage, as the platform has it.
///
/// The whole screen used to be a local counter. Four buttons advanced `_stage` from 0 to 4:
/// "Arrived", "Start Trip", "Complete" each changed an int, the OTP field was pre-filled with
/// `7729` so the code was always right, and finishing the job showed a payment summary the
/// device had worked out itself. Nothing was ever sent, so a partner could tap through a trip
/// that never happened and be paid for nothing, or finish a real trip and have the platform
/// still show it running.
///
/// Now every transition is a request and every label on screen is the answer:
/// * arrival is `POST /api/driver/arrived`,
/// * starting and finishing are `POST /api/driver/verify-otp` with a code the customer speaks
///   and the server checks — never a value this app already knows,
/// * the stage shown is the job's status as the platform holds it, re-read on entry and on
///   push, so an app killed mid-trip, a phone that roamed, and a duplicate tap all end up
///   looking at the same truth.
class ActiveJobExecutionScreen extends StatefulWidget {
  final Map<String, dynamic>? jobData;
  const ActiveJobExecutionScreen({super.key, this.jobData});

  @override
  State<ActiveJobExecutionScreen> createState() => _ActiveJobExecutionScreenState();
}

/// The job exactly as the server described it. Nothing here is computed on the device.
class _JobView {
  const _JobView({
    required this.ref,
    required this.status,
    required this.serviceType,
    required this.pickup,
    required this.drop,
    required this.fare,
    required this.driverEarnings,
  });

  final String ref;
  final String status;
  final String serviceType;
  final String? pickup;
  final String? drop;
  final double? fare;
  final double? driverEarnings;

  static _JobView? fromJson(Map json) {
    final ref = (json['jobNumber'] as String?) ?? (json['id'] as String?);
    if (ref == null) return null;
    num? read(String key) {
      final raw = json[key];
      if (raw is num) return raw;
      if (raw == null) return null;
      return num.tryParse('$raw');
    }

    return _JobView(
      ref: ref,
      status: (json['status'] as String?) ?? '',
      serviceType: (json['serviceType'] as String?) ?? 'RIDE',
      pickup: json['pickupAddress'] as String?,
      drop: json['dropAddress'] as String?,
      fare: read('fare')?.toDouble(),
      driverEarnings: read('driverEarnings')?.toDouble(),
    );
  }

  bool get isPickupFlow => serviceType == 'RIDE';
  bool get settled => status == 'COMPLETED';
  bool get cancelled => status == 'CANCELLED';

  /// The code this stage of the trip actually needs.
  ///
  /// The names are the platform's own — `START` proves the passenger or sender handed over a
  /// code, `DELIVERY` proves receipt at the far end. A ride and a parcel differ only in what
  /// the partner calls it, so the labels split here while the transition stays the server's.
  String? get otpStage {
    switch (status) {
      case 'DRIVER_ARRIVED':
      case 'ACCEPTED':
      case 'ASSIGNED':
      case 'DRIVER_ARRIVING':
        return 'START';
      case 'IN_TRANSIT':
      case 'OUT_FOR_DELIVERY':
        return 'DELIVERY';
      default:
        return null;
    }
  }

  String get otpPromptLabel => isPickupFlow
      ? (otpStage == 'DELIVERY' ? 'Ask the passenger for their OTP to finish the trip' : 'Ask the passenger for their OTP to start the trip')
      : (otpStage == 'DELIVERY' ? 'Ask the recipient for the delivery OTP' : 'Enter the pickup OTP from the sender');
}

enum _View { loading, ready, failed, notFound }

class _ActiveJobExecutionScreenState extends State<ActiveJobExecutionScreen> {
  _View _view = _View.loading;
  _JobView? _job;
  String? _failureMessage;
  final TextEditingController _otpController = TextEditingController();
  bool _busy = false;
  String? _actionError;
  StreamSubscription<Map<String, dynamic>>? _tripFeed;

  String? get _seedRef {
    final data = widget.jobData;
    if (data == null) return null;
    return (data['jobId'] as String?) ?? (data['id'] as String?) ?? (data['jobNumber'] as String?);
  }

  @override
  void initState() {
    super.initState();
    _refresh();
    // The platform is the authority on the stage, so anything it pushes about this trip is a
    // reason to read it again rather than to edit the screen.
    _tripFeed = NabinWsService.instance.onTripUpdate.listen((_) {
      if (mounted) unawaited(_refresh(silent: true));
    });
  }

  @override
  void dispose() {
    _tripFeed?.cancel();
    _otpController.dispose();
    super.dispose();
  }

  /// Re-read the console and take this trip's state from it.
  ///
  /// Deliberately not a job-by-id endpoint: `/api/driver/home` only ever returns the trip
  /// belonging to the token that asked, which is what makes a stale or hand-edited job id on
  /// this screen unable to open somebody else's trip.
  Future<void> _refresh({bool silent = false}) async {
    if (!silent) setState(() => _view = _View.loading);
    final home = await NabinApiService.getDriverHome();
    if (!mounted) return;

    if (home == null || home['success'] != true) {
      setState(() {
        _view = _View.failed;
        _failureMessage = home == null
            ? 'No connection to NABIN. The trip has not changed — its stage is stored on the platform, not here.'
            : (home['error'] as String?) ?? 'Could not load this trip.';
      });
      return;
    }

    final active = home['activeJob'];
    if (active is Map) {
      final parsed = _JobView.fromJson(active);
      if (parsed != null) {
        setState(() {
          _job = parsed;
          _view = _View.ready;
          _failureMessage = null;
        });
        return;
      }
    }

    // No active assignment. That is either a trip already settled — whose money lives in the
    // earnings ledger — or one that was never this partner's. Neither is a reason to draw a
    // blank execution screen.
    final settledRef = _seedRef;
    setState(() {
      _job = null;
      _view = _View.notFound;
      _failureMessage = settledRef == null
          ? 'You are not on a trip right now.'
          : '$settledRef is not one of your active trips. It may already be completed, cancelled, or assigned to another partner.';
    });
  }

  Future<void> _markArrived() async {
    final job = _job;
    if (job == null || _busy) return;
    setState(() {
      _busy = true;
      _actionError = null;
    });
    final res = await NabinApiService.driverArrived(jobId: job.ref);
    if (!mounted) return;
    setState(() => _busy = false);
    await _afterAction(res, 'NABIN could not record your arrival.');
  }

  Future<void> _submitOtp() async {
    final job = _job;
    final stage = job?.otpStage;
    if (job == null || stage == null || _busy) return;
    final code = _otpController.text.trim();
    if (code.length < 4) {
      setState(() => _actionError = 'Enter the complete code the customer gave you.');
      return;
    }
    setState(() {
      _busy = true;
      _actionError = null;
    });
    final res = await NabinApiService.submitTripOtp(jobId: job.ref, otp: code, otpType: stage);
    if (!mounted) return;
    setState(() => _busy = false);

    final ok = res != null && res['success'] == true && res['verified'] == true;
    if (ok) _otpController.clear();
    await _afterAction(res, ok ? null : 'NABIN refused that code.');
  }

  /// Reports the platform's answer and then re-reads it, so the screen can never be left
  /// showing a stage the server did not confirm.
  Future<void> _afterAction(Map<String, dynamic>? res, String? fallbackError) async {
    final accepted = res != null && res['success'] == true;
    if (!accepted) {
      final message = res?['error'] as String? ?? fallbackError ?? 'NABIN did not accept that action.';
      setState(() => _actionError = message);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message), backgroundColor: Colors.red.shade700),
      );
    }
    // Re-read even on failure: a refusal often means the trip already moved without this
    // device knowing, and the correct screen then is the new stage, not the old one.
    await _refresh(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DriverTheme.bgLight,
      appBar: AppBar(
        title: const Text('Trip Execution'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          // `go`, not `pop`: leaving and returning must re-read the platform rather than
          // resume whatever stage this screen last believed it was on.
          onPressed: () => context.go('/home'),
        ),
        actions: [
          IconButton(
            onPressed: _view == _View.loading ? null : _refresh,
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Re-read from NABIN',
          ),
        ],
      ),
      body: SafeArea(
        child: switch (_view) {
          _View.loading => const Center(child: CircularProgressIndicator()),
          _View.failed => _buildMessage(
              icon: Icons.cloud_off_rounded,
              title: 'Could not load this trip',
              body: _failureMessage ?? 'Nothing about the trip has changed.',
              retry: true,
            ),
          _View.notFound => _buildMessage(
              icon: Icons.info_outline,
              title: 'No trip to execute',
              body: _failureMessage ?? 'You are not on a trip right now.',
            ),
          _View.ready => _buildExecution(),
        },
      ),
    );
  }

  Widget _buildMessage({
    required IconData icon,
    required String title,
    required String body,
    bool retry = false,
  }) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 54, color: DriverTheme.textMuted),
            const SizedBox(height: 14),
            Text(title, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17, color: DriverTheme.textDark)),
            const SizedBox(height: 6),
            Text(body, textAlign: TextAlign.center, style: const TextStyle(color: DriverTheme.textMuted, fontSize: 13)),
            const SizedBox(height: 18),
            if (retry)
              ElevatedButton.icon(
                onPressed: _refresh,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Retry'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: DriverTheme.primaryBlue,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
              ),
            ElevatedButton.icon(
              onPressed: () => context.go('/home'),
              icon: const Icon(Icons.map_rounded),
              label: const Text('Back to console'),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.white,
                foregroundColor: DriverTheme.textDark,
                side: const BorderSide(color: DriverTheme.borderLight),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildExecution() {
    final job = _job;
    if (job == null) return const SizedBox.shrink();

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Stage banner — the platform's word, not this screen's progress bar.
          DriverCard(
            padding: const EdgeInsets.all(16),
            borderRadius: 20,
            backgroundColor: job.settled ? DriverTheme.onlineGreen : DriverTheme.primaryBlue,
            borderColor: job.settled ? DriverTheme.onlineGreen : DriverTheme.primaryBlueDark,
            child: Row(
              children: [
                Icon(job.settled ? Icons.task_alt : Icons.flag_outlined, color: Colors.white, size: 22),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(job.ref,
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 15)),
                      Text('Status on NABIN: ${job.status.isEmpty ? 'unknown' : job.status}',
                          style: const TextStyle(color: Colors.white70, fontSize: 12)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          DriverCard(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _line(Icons.radio_button_checked, DriverTheme.onlineGreen, 'Pickup', job.pickup ?? 'Unavailable'),
                const Divider(color: DriverTheme.borderLight, height: 24),
                _line(Icons.location_on, DriverTheme.alertRed, 'Drop', job.drop ?? 'Unavailable'),
                const Divider(color: DriverTheme.borderLight, height: 24),
                // The earning is the platform's figure from the job row. The old screen
                // computed a 10% commission here in Dart; the platform charges what the row
                // says, and this only repeats that.
                Text(
                  job.driverEarnings == null
                      ? 'Earning not reported for this trip'
                      : 'You earn ₹${job.driverEarnings!.toStringAsFixed(2)}'
                          '${job.fare == null ? '' : '  ·  trip fare ₹${job.fare!.toStringAsFixed(2)}'}',
                  style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, color: DriverTheme.onlineGreen),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),

          if (job.settled)
            DriverCard(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Trip settled',
                      style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: DriverTheme.textDark)),
                  const SizedBox(height: 6),
                  const Text('NABIN has recorded this trip as completed and booked your earning. '
                      'It is on your earnings ledger now.',
                      style: TextStyle(fontSize: 13, color: DriverTheme.textMuted, height: 1.4)),
                  const SizedBox(height: 14),
                  DriverButton(
                    text: 'View earnings',
                    height: 48,
                    onPressed: () => context.go('/earnings'),
                  ),
                ],
              ),
            )
          else if (job.cancelled)
            const DriverCard(
              padding: EdgeInsets.all(16),
              child: Text('This trip was cancelled on the platform. Nothing further is required of you.',
                  style: TextStyle(fontSize: 13, color: DriverTheme.textMuted, height: 1.4)),
            )
          else ...[
            if (job.status == 'ASSIGNED' || job.status == 'ACCEPTED' || job.status == 'DRIVER_ARRIVING')
              DriverCard(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Reach the pickup point',
                        style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: DriverTheme.textDark)),
                    const SizedBox(height: 6),
                    const Text('Tell NABIN when you are there. The platform records the arrival; this screen only asks.',
                        style: TextStyle(fontSize: 13, color: DriverTheme.textMuted, height: 1.4)),
                    const SizedBox(height: 14),
                    DriverButton(
                      text: 'I have arrived',
                      color: DriverTheme.primaryBlue,
                      height: 48,
                      isLoading: _busy,
                      onPressed: _markArrived,
                    ),
                  ],
                ),
              ),
            if (job.otpStage != null) ...[
              const SizedBox(height: 14),
              DriverCard(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(job.otpPromptLabel,
                        style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15, color: DriverTheme.textDark)),
                    const SizedBox(height: 6),
                    const Text('The code comes from the customer. NABIN checks it — this app never knows it in advance.',
                        style: TextStyle(fontSize: 12, color: DriverTheme.textMuted, height: 1.4)),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _otpController,
                      keyboardType: TextInputType.number,
                      maxLength: 6,
                      textAlign: TextAlign.center,
                      enabled: !_busy,
                      style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w900, letterSpacing: 10),
                      decoration: const InputDecoration(
                        hintText: '••••',
                        counterText: '',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    if (_actionError != null) ...[
                      const SizedBox(height: 8),
                      Text(_actionError!, style: const TextStyle(color: DriverTheme.alertRed, fontSize: 12)),
                    ],
                    const SizedBox(height: 14),
                    DriverButton(
                      text: job.otpStage == 'DELIVERY' ? 'Complete trip' : 'Verify and start',
                      color: job.otpStage == 'DELIVERY' ? DriverTheme.onlineGreen : DriverTheme.primaryBlue,
                      textColor: job.otpStage == 'DELIVERY' ? Colors.black : Colors.white,
                      height: 48,
                      isLoading: _busy,
                      onPressed: _submitOtp,
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 14),
            Center(
              child: TextButton.icon(
                onPressed: _busy ? null : () => _refresh(silent: true),
                icon: const Icon(Icons.sync_rounded, size: 18),
                label: const Text('Re-read this trip from NABIN'),
              ),
            ),
          ],
          const SizedBox(height: 40),
        ],
      ),
    );
  }

  Widget _line(IconData icon, Color color, String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: color, size: 18),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label.toUpperCase(),
                  style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: DriverTheme.textMuted)),
              const SizedBox(height: 2),
              Text(value, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: DriverTheme.textDark)),
            ],
          ),
        ),
      ],
    );
  }
}
