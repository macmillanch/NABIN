import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/driver_theme.dart';
import '../../../../core/widgets/driver_button.dart';
import '../../../../core/widgets/driver_card.dart';

class DriverKycRegistrationScreen extends StatefulWidget {
  const DriverKycRegistrationScreen({super.key});

  @override
  State<DriverKycRegistrationScreen> createState() => _DriverKycRegistrationScreenState();
}

class _DriverKycRegistrationScreenState extends State<DriverKycRegistrationScreen> {
  int _currentStep = 0; // 0: Personal, 1: Vehicle 2W/3W/4W, 2: Documents (DL, RC, Ins), 3: Bank/UPI, 4: KYC Review & Status
  String _selectedVehicle = '3W'; // '2W', '3W', '4W'
  bool _isSubmitted = false;

  final TextEditingController _nameController = TextEditingController(text: 'Rajesh Kumar');
  final TextEditingController _dlController = TextEditingController(text: 'DL-14201900192');
  final TextEditingController _rcController = TextEditingController(text: 'DL 1RA 4892');
  final TextEditingController _upiController = TextEditingController(text: 'rajesh.driver@okhdfcbank');

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

  // Step 0: Personal Details & Profile Photo
  Widget _buildPersonalStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('1. Personal Details & Photo', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
        const SizedBox(height: 6),
        const Text('Enter legal name as per government Driving Licence.', style: TextStyle(color: DriverTheme.textMuted, fontSize: 13)),
        const SizedBox(height: 20),

        // Photo Upload Box
        Center(
          child: Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
              border: Border.all(color: DriverTheme.primaryBlue, width: 2),
            ),
            child: const Icon(Icons.add_a_photo, size: 36, color: DriverTheme.primaryBlue),
          ),
        ),
        const SizedBox(height: 8),
        const Center(
          child: Text('Profile Photo (Verified)', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: DriverTheme.onlineGreen)),
        ),
        const SizedBox(height: 24),

        DriverCard(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: TextField(
            controller: _nameController,
            style: const TextStyle(fontWeight: FontWeight.bold, color: DriverTheme.textDark),
            decoration: const InputDecoration(
              labelText: 'Driver Full Name',
              border: InputBorder.none,
            ),
          ),
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

  // Step 2: Documents (Driving Licence, RC, Insurance)
  Widget _buildDocumentsStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('3. Commercial Documents', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
        const SizedBox(height: 6),
        const Text('Upload photos and numbers for automated KYC approval.', style: TextStyle(color: DriverTheme.textMuted, fontSize: 13)),
        const SizedBox(height: 20),

        DriverCard(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: TextField(
            controller: _dlController,
            style: const TextStyle(fontWeight: FontWeight.bold, color: DriverTheme.textDark),
            decoration: const InputDecoration(
              labelText: 'Driving Licence Number',
              border: InputBorder.none,
            ),
          ),
        ),
        const SizedBox(height: 14),

        DriverCard(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: TextField(
            controller: _rcController,
            style: const TextStyle(fontWeight: FontWeight.bold, color: DriverTheme.textDark),
            decoration: const InputDecoration(
              labelText: 'Vehicle Registration (RC Number)',
              border: InputBorder.none,
            ),
          ),
        ),
        const SizedBox(height: 14),

        _buildDocUploadTile('Commercial Insurance Certificate', 'Valid until Nov 2027', Icons.security),
        const SizedBox(height: 10),
        _buildDocUploadTile('Vehicle Fitness Certificate', 'Verified by RTO', Icons.speed),
      ],
    );
  }

  Widget _buildDocUploadTile(String title, String subtitle, IconData icon) {
    return DriverCard(
      padding: const EdgeInsets.all(14),
      child: Row(
        children: [
          Icon(icon, color: DriverTheme.primaryBlue, size: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: DriverTheme.textDark)),
                Text(subtitle, style: const TextStyle(color: DriverTheme.onlineGreen, fontSize: 11, fontWeight: FontWeight.w600)),
              ],
            ),
          ),
          const Icon(Icons.check_circle_outline, color: DriverTheme.onlineGreen, size: 20),
        ],
      ),
    );
  }

  // Step 3: Bank / UPI Details
  Widget _buildBankStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('4. Payout Bank & UPI', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
        const SizedBox(height: 6),
        const Text('Daily instant payouts and earnings will be credited here.', style: TextStyle(color: DriverTheme.textMuted, fontSize: 13)),
        const SizedBox(height: 20),

        DriverCard(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: TextField(
            controller: _upiController,
            style: const TextStyle(fontWeight: FontWeight.bold, color: DriverTheme.textDark),
            decoration: const InputDecoration(
              labelText: 'UPI ID (Google Pay / PhonePe / Paytm)',
              border: InputBorder.none,
            ),
          ),
        ),
        const SizedBox(height: 16),

        const DriverCard(
          padding: EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Linked Settlement Bank', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: DriverTheme.textDark)),
              SizedBox(height: 4),
              Text('HDFC Bank Ltd • A/C **** 4892 • IFSC: HDFC000182', style: TextStyle(color: DriverTheme.textMuted, fontSize: 12)),
            ],
          ),
        ),
      ],
    );
  }

  // Final Screen: Approval Status & Activation
  Widget _buildStatusStep() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.verified, size: 72, color: DriverTheme.onlineGreen),
          const SizedBox(height: 16),
          const Text('KYC Document Review Complete', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: DriverTheme.textDark)),
          const SizedBox(height: 8),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 20),
            child: Text(
              'Your Driving Licence, Vehicle RC & Bank Account are approved. Your account is active and ready to accept jobs!',
              style: TextStyle(color: DriverTheme.textMuted, fontSize: 13, height: 1.4),
              textAlign: TextAlign.center,
            ),
          ),
          const SizedBox(height: 24),
          DriverCard(
            padding: const EdgeInsets.all(16),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildStatusChip('DL', 'APPROVED'),
                _buildStatusChip('RC', 'APPROVED'),
                _buildStatusChip('INSURANCE', 'APPROVED'),
                _buildStatusChip('UPI', 'ACTIVE'),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusChip(String title, String status) {
    return Column(
      children: [
        Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 11, color: DriverTheme.textMuted)),
        const SizedBox(height: 2),
        Text(status, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 11, color: DriverTheme.onlineGreen)),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: DriverTheme.bgLight,
      appBar: AppBar(
        title: const Text('Driver KYC & Vehicle Onboarding'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            if (_currentStep > 0 && !_isSubmitted) {
              setState(() => _currentStep--);
            } else {
              context.pop();
            }
          },
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          child: Column(
            children: [
              if (!_isSubmitted) ...[
                _buildStepIndicator(),
                const SizedBox(height: 20),
              ],
              Expanded(
                child: SingleChildScrollView(
                  child: _isSubmitted
                      ? _buildStatusStep()
                      : (_currentStep == 0
                          ? _buildPersonalStep()
                          : (_currentStep == 1
                              ? _buildVehicleStep()
                              : (_currentStep == 2 ? _buildDocumentsStep() : _buildBankStep()))),
                ),
              ),
              const SizedBox(height: 16),
              DriverButton(
                text: _isSubmitted
                    ? 'Start Driving Now'
                    : (_currentStep == 3 ? 'Submit KYC for Instant Approval' : 'Continue to Next Step'),
                color: _isSubmitted ? DriverTheme.onlineGreen : DriverTheme.primaryBlue,
                textColor: _isSubmitted ? Colors.black : Colors.white,
                onPressed: () {
                  if (_isSubmitted) {
                    context.go('/home');
                  } else if (_currentStep < 3) {
                    setState(() => _currentStep++);
                  } else {
                    setState(() => _isSubmitted = true);
                  }
                },
              ),
              const SizedBox(height: 12),
            ],
          ),
        ),
      ),
    );
  }
}
