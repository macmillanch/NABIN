import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/driver_theme.dart';
import '../../../../core/widgets/driver_button.dart';
import '../../../../core/widgets/driver_card.dart';

/// The four steps a NABIN partner is asked to fill in, kept honest about what this
/// app can do with them.
///
/// Nothing here is submitted. There is no driver-facing KYC intake route: `drivers`
/// is written by the admin fleet routes, and `drivers.kyc_status` — the column that
/// decides whether a partner may drive — is only ever changed by an administrator.
/// The screen used to answer a button press with a green "KYC Document Review
/// Complete / APPROVED" board, which told a partner they had been verified by a
/// review that had not happened.
class DriverKycRegistrationScreen extends StatefulWidget {
  const DriverKycRegistrationScreen({super.key});

  @override
  State<DriverKycRegistrationScreen> createState() => _DriverKycRegistrationScreenState();
}

class _DriverKycRegistrationScreenState extends State<DriverKycRegistrationScreen> {
  // 0: Personal, 1: Vehicle, 2: Documents, 3: Payout.
  int _currentStep = 0;

  /// Null until the partner picks one. The ids are three of the five values
  /// `drivers.vehicle_type` accepts; a pre-selected '3W' would have claimed a
  /// vehicle category the applicant never named.
  String? _selectedVehicle;

  // Every field opens empty. They used to open pre-filled with one invented
  // applicant — a Delhi licence plate, a Delhi registration, and a bank account
  // with an IFSC — in a NABIN build that operates in Aizawl.
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _dlController = TextEditingController();
  final TextEditingController _rcController = TextEditingController();
  final TextEditingController _upiController = TextEditingController();

  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();

  @override
  void dispose() {
    _nameController.dispose();
    _dlController.dispose();
    _rcController.dispose();
    _upiController.dispose();
    super.dispose();
  }

  void _notice(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text(message),
        behavior: SnackBarBehavior.floating,
        backgroundColor: DriverTheme.textDark,
      ));
  }

  Widget _buildStepIndicator() {
    return Row(
      children: List.generate(4, (index) {
        final isActive = index <= _currentStep;
        return Expanded(
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 3),
            height: 5,
            decoration: BoxDecoration(
              color: isActive ? DriverTheme.primaryBlue : DriverTheme.borderLight,
              borderRadius: BorderRadius.circular(3),
            ),
          ),
        );
      }),
    );
  }

  /// States a capability this app does not have, instead of dressing its absence up
  /// as a completed step.
  Widget _buildLimitationNote(String text) {
    return DriverCard(
      backgroundColor: DriverTheme.bgLight,
      padding: const EdgeInsets.all(14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline, color: DriverTheme.textMuted, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(color: DriverTheme.textMuted, fontSize: 11.5, height: 1.35),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildField({
    required TextEditingController controller,
    required String label,
    required int maxLength,
    TextInputType keyboardType = TextInputType.text,
    bool uppercase = false,
  }) {
    return DriverCard(
      backgroundColor: Colors.white,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: TextFormField(
        controller: controller,
        maxLength: maxLength,
        keyboardType: keyboardType,
        textCapitalization: uppercase ? TextCapitalization.characters : TextCapitalization.words,
        inputFormatters: uppercase ? [UpperCaseFormatter()] : null,
        style: const TextStyle(fontWeight: FontWeight.bold, color: DriverTheme.textDark),
        decoration: InputDecoration(
          labelText: label,
          counterText: '',
          border: InputBorder.none,
        ),
        validator: (value) =>
            (value ?? '').trim().isEmpty ? 'Enter the $label.' : null,
      ),
    );
  }

  // Step 0: Personal Details & Profile Photo
  Widget _buildPersonalStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('1. Personal Details', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
        const SizedBox(height: 6),
        const Text('Enter the legal name on your government Driving Licence.', style: TextStyle(color: DriverTheme.textMuted, fontSize: 13)),
        const SizedBox(height: 20),

        // There is no camera or gallery picker in the NABIN apps, so no photo can be
        // attached from here. The circle used to be captioned 'Profile Photo
        // (Verified)' with nothing behind it.
        Center(
          child: Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
              border: Border.all(color: DriverTheme.borderLight, width: 2),
            ),
            child: const Icon(Icons.add_a_photo, size: 36, color: DriverTheme.textMuted),
          ),
        ),
        const SizedBox(height: 8),
        const Center(
          child: Text('Profile photo — not attached', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: DriverTheme.textMuted)),
        ),
        const SizedBox(height: 24),

        _buildField(
          controller: _nameController,
          label: 'Driver Full Name',
          maxLength: 100,
        ),
      ],
    );
  }

  // Step 1: Vehicle Selection (2W, 3W, 4W)
  Widget _buildVehicleStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('2. Select Vehicle Type', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
        const SizedBox(height: 6),
        const Text('Select which vehicle category you will drive with NABIN.', style: TextStyle(color: DriverTheme.textMuted, fontSize: 13)),
        const SizedBox(height: 20),

        _buildVehicleSelectCard('2W', '2-Wheeler (Bike / Scooter)', 'Passenger rides, small parcels & food delivery', Icons.two_wheeler),
        const SizedBox(height: 12),
        _buildVehicleSelectCard('3W', '3-Wheeler (Auto Rickshaw)', 'Passenger rides & medium parcel delivery', Icons.electric_rickshaw),
        const SizedBox(height: 12),
        _buildVehicleSelectCard('4W', '4-Wheeler (Cab / Taxi / Sedan)', 'Passenger AC taxi rides & large parcel delivery', Icons.local_taxi),
      ],
    );
  }

  Widget _buildVehicleSelectCard(String id, String title, String desc, IconData icon) {
    final isSelected = _selectedVehicle == id;
    return GestureDetector(
      onTap: () => setState(() => _selectedVehicle = id),
      child: DriverCard(
        backgroundColor: isSelected ? const Color(0xFFEEF2FF) : Colors.white,
        borderColor: isSelected ? DriverTheme.primaryBlue : DriverTheme.borderLight,
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: isSelected ? DriverTheme.primaryBlue : const Color(0xFFF1F5F9),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(icon, color: isSelected ? Colors.white : DriverTheme.textDark, size: 26),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: DriverTheme.textDark)),
                  const SizedBox(height: 2),
                  Text(desc, style: const TextStyle(color: DriverTheme.textMuted, fontSize: 11)),
                ],
              ),
            ),
            if (isSelected)
              const Icon(Icons.check_circle, color: DriverTheme.primaryBlue, size: 22),
          ],
        ),
      ),
    );
  }

  // Step 2: Driving Licence & Vehicle Registration numbers
  Widget _buildDocumentsStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('3. Licence & Registration', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
        const SizedBox(height: 6),
        const Text('Enter the numbers exactly as they appear on your documents.', style: TextStyle(color: DriverTheme.textMuted, fontSize: 13)),
        const SizedBox(height: 20),

        _buildField(
          controller: _dlController,
          label: 'Driving Licence Number',
          maxLength: 50,
        ),
        const SizedBox(height: 14),

        _buildField(
          controller: _rcController,
          label: 'Vehicle Registration Number',
          maxLength: 30,
          uppercase: true,
        ),
        const SizedBox(height: 16),

        // Two tiles used to sit here reporting 'Valid until Nov 2027' and 'Verified by
        // RTO' with a green check, for documents nobody had looked at.
        _buildLimitationNote(
          'Document photos cannot be attached from the NABIN Driver app — it has no '
          'camera or gallery picker. Insurance and fitness certificates are not '
          'recorded here, and nothing you type on this screen has been checked '
          'against the real document.',
        ),
      ],
    );
  }

  // Step 3: Payout UPI
  Widget _buildBankStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('4. Payout UPI', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
        const SizedBox(height: 6),
        const Text('The UPI ID you want NABIN payouts sent to.', style: TextStyle(color: DriverTheme.textMuted, fontSize: 13)),
        const SizedBox(height: 20),

        _buildField(
          controller: _upiController,
          label: 'UPI ID (Google Pay / PhonePe / Paytm)',
          maxLength: 100,
          keyboardType: TextInputType.emailAddress,
        ),
        const SizedBox(height: 16),

        // The settlement bank card below it named a bank, a masked account and an IFSC
        // that belong to no one. The one payout-destination route that exists
        // (POST /api/driver/payout-destination/request) needs a driver session and an
        // already-VERIFIED KYC, so it cannot be reached from a pre-sign-in form either.
        _buildLimitationNote(
          'No bank account is linked to this form. NABIN can record a payout UPI for a '
          'driver whose account is already signed in and already verified — not for an '
          'applicant who has not signed in yet.',
        ),
      ],
    );
  }

  void _onPrimaryAction() {
    if (_currentStep < 3) {
      // The step's own fields gate the way forward: an empty form should not advance
      // as though it had been answered.
      if (_currentStep == 1) {
        if (_selectedVehicle == null) {
          _notice('Choose the vehicle category you will drive with.');
          return;
        }
      } else if (!(_formKey.currentState?.validate() ?? false)) {
        return;
      }
      setState(() => _currentStep++);
      return;
    }

    if (!(_formKey.currentState?.validate() ?? false)) return;

    _notice('Nothing was sent. The NABIN Driver app has no KYC intake route yet, so '
        'these details are not recorded, reviewed or approved anywhere. A NABIN '
        'administrator sets a driver\'s KYC status in the fleet directory.');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DriverTheme.bgLight,
      appBar: AppBar(
        title: const Text('Driver KYC & Vehicle Details'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            if (_currentStep > 0) {
              setState(() => _currentStep--);
            } else {
              context.go('/login');
            }
          },
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          child: Form(
            key: _formKey,
            child: Column(
              children: [
                _buildStepIndicator(),
                const SizedBox(height: 20),
                Expanded(
                  child: SingleChildScrollView(
                    child: _currentStep == 0
                        ? _buildPersonalStep()
                        : (_currentStep == 1
                            ? _buildVehicleStep()
                            : (_currentStep == 2 ? _buildDocumentsStep() : _buildBankStep()))),
                ),
                const SizedBox(height: 16),
                DriverButton(
                  text: _currentStep == 3 ? 'Send these details to NABIN' : 'Continue to Next Step',
                  onPressed: _onPrimaryAction,
                ),
                const SizedBox(height: 12),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Keeps a registration number the way a licence reads it, without the field
/// silently changing anything else the partner typed.
class UpperCaseFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    return TextEditingValue(
      text: newValue.text.toUpperCase(),
      selection: newValue.selection,
      composing: TextRange.empty,
    );
  }
}
