import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/restaurant_theme.dart';

class RestaurantRegistrationScreen extends StatefulWidget {
  const RestaurantRegistrationScreen({super.key});

  @override
  State<RestaurantRegistrationScreen> createState() => _RestaurantRegistrationScreenState();
}

class _RestaurantRegistrationScreenState extends State<RestaurantRegistrationScreen> {
  int _currentStep = 0; // 0: Restaurant Info, 1: Location & Owner, 2: Documents & Bank, 3: Approval Status

  final TextEditingController _restNameController = TextEditingController(text: 'Dilli Darbar Mughlai Kitchen');
  final TextEditingController _cuisineController = TextEditingController(text: 'North Indian, Mughlai, Biryani');
  final TextEditingController _addressController = TextEditingController(text: 'Shop 14, Ring Road Market, Civil Lines, Delhi');
  final TextEditingController _ownerNameController = TextEditingController(text: 'Vikram Sethi');
  final TextEditingController _fssaiController = TextEditingController(text: '1002001928491');
  final TextEditingController _gstController = TextEditingController(text: '07AAGCD1294F1Z8');
  final TextEditingController _bankAccountController = TextEditingController(text: '50200049281092');
  final TextEditingController _ifscController = TextEditingController(text: 'HDFC0001092');
  final TextEditingController _upiController = TextEditingController(text: 'dillidarbar@okhdfcbank');

  Widget _buildStepIndicator() {
    return Row(
      children: List.generate(4, (index) {
        final isActive = index <= _currentStep;
        return Expanded(
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 3),
            height: 4,
            decoration: BoxDecoration(
              color: isActive ? RestaurantTheme.primaryBlue : RestaurantTheme.borderLight,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        );
      }),
    );
  }

  // Step 0: Restaurant Information
  Widget _buildInfoStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          '1. Restaurant Information',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: RestaurantTheme.textDark),
        ),
        const SizedBox(height: 6),
        const Text(
          'Enter public restaurant name and primary food specialty.',
          style: TextStyle(color: RestaurantTheme.textMuted, fontSize: 13),
        ),
        const SizedBox(height: 20),

        _buildTextField('Restaurant Display Name', _restNameController, Icons.storefront),
        const SizedBox(height: 16),
        _buildTextField('Primary Cuisines', _cuisineController, Icons.restaurant_menu),
        const SizedBox(height: 16),

        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: RestaurantTheme.surfaceCard,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: RestaurantTheme.outlineVariant),
          ),
          child: const Row(
            children: [
              Icon(Icons.check_circle, color: RestaurantTheme.statusReadyGreen, size: 20),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Accepting both Veg and Non-Veg menu items',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: RestaurantTheme.textDark),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // Step 1: Location & Owner Details
  Widget _buildLocationStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          '2. Location & Owner Details',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: RestaurantTheme.textDark),
        ),
        const SizedBox(height: 6),
        const Text(
          'Used for delivery driver dispatch and partner contact.',
          style: TextStyle(color: RestaurantTheme.textMuted, fontSize: 13),
        ),
        const SizedBox(height: 20),

        _buildTextField('Full Kitchen Address', _addressController, Icons.location_on_outlined, maxLines: 2),
        const SizedBox(height: 16),
        _buildTextField('Owner / Manager Name', _ownerNameController, Icons.person_outline),
        const SizedBox(height: 16),

        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: RestaurantTheme.surfaceContainer,
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Row(
            children: [
              Icon(Icons.my_location, color: RestaurantTheme.primaryBlue, size: 20),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'GPS Auto-Detected: Civil Lines, New Delhi (28.6853, 77.2185)',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: RestaurantTheme.textDark),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // Step 2: Documents & Bank Details
  Widget _buildDocumentsStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          '3. Compliance & Bank Details',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: RestaurantTheme.textDark),
        ),
        const SizedBox(height: 6),
        const Text(
          'Enter FSSAI Food Licence and payout account information.',
          style: TextStyle(color: RestaurantTheme.textMuted, fontSize: 13),
        ),
        const SizedBox(height: 20),

        _buildTextField('FSSAI Licence Number (14 Digits)', _fssaiController, Icons.verified_user_outlined),
        const SizedBox(height: 16),
        _buildTextField('GSTIN / PAN', _gstController, Icons.receipt_long_outlined),
        const SizedBox(height: 16),
        _buildTextField('Bank Account Number', _bankAccountController, Icons.account_balance_outlined),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(child: _buildTextField('IFSC Code', _ifscController, Icons.business_outlined)),
            const SizedBox(width: 12),
            Expanded(child: _buildTextField('Payout UPI ID', _upiController, Icons.payment_outlined)),
          ],
        ),
      ],
    );
  }

  // Step 3: Approval Status
  Widget _buildApprovalStep() {
    return Column(
      children: [
        const SizedBox(height: 30),
        Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: RestaurantTheme.statusReadyBg,
            shape: BoxShape.circle,
            border: Border.all(color: RestaurantTheme.statusReadyGreen, width: 2),
          ),
          child: const Icon(Icons.check_circle_rounded, size: 64, color: RestaurantTheme.statusReadyGreen),
        ),
        const SizedBox(height: 24),
        const Text(
          'KYC & Partner Verified!',
          style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: RestaurantTheme.textDark),
        ),
        const SizedBox(height: 8),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 20),
          child: Text(
            'Your restaurant account is active and ready to receive live food orders on the Kitchen Display System (KDS).',
            textAlign: TextAlign.center,
            style: TextStyle(color: RestaurantTheme.textMuted, fontSize: 14, height: 1.4),
          ),
        ),
        const SizedBox(height: 28),

        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: RestaurantTheme.surfaceCard,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: RestaurantTheme.outlineVariant),
          ),
          child: const Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Merchant ID', style: TextStyle(color: RestaurantTheme.textMuted, fontSize: 12)),
                  Text('REST-9482', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: RestaurantTheme.textDark)),
                ],
              ),
              Divider(height: 20, color: RestaurantTheme.borderLight),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Payout Schedule', style: TextStyle(color: RestaurantTheme.textMuted, fontSize: 12)),
                  Text('Daily 08:00 AM (Auto-UPI)', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: RestaurantTheme.statusReadyGreen)),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildTextField(String label, TextEditingController controller, IconData icon, {int maxLines = 1}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: RestaurantTheme.textMuted),
        ),
        const SizedBox(height: 6),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
          decoration: BoxDecoration(
            color: RestaurantTheme.surfaceCard,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: RestaurantTheme.outlineVariant),
          ),
          child: Row(
            children: [
              Icon(icon, color: RestaurantTheme.primaryBlue, size: 20),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: controller,
                  maxLines: maxLines,
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: RestaurantTheme.textDark),
                  decoration: const InputDecoration(border: InputBorder.none, isDense: true),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  void _nextStep() {
    if (_currentStep < 3) {
      setState(() => _currentStep++);
    } else {
      context.go('/dashboard');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: RestaurantTheme.bgSurface,
      appBar: AppBar(
        title: const Text('Partner Onboarding & KYC'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            if (_currentStep > 0) {
              setState(() => _currentStep--);
            } else {
              context.pop();
            }
          },
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          child: Column(
            children: [
              _buildStepIndicator(),
              const SizedBox(height: 20),
              Expanded(
                child: SingleChildScrollView(
                  child: [
                    _buildInfoStep(),
                    _buildLocationStep(),
                    _buildDocumentsStep(),
                    _buildApprovalStep(),
                  ][_currentStep],
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: RestaurantTheme.primaryContainer,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  onPressed: _nextStep,
                  child: Text(
                    _currentStep == 2
                        ? 'Submit for Instant Approval'
                        : _currentStep == 3
                            ? 'Enter Kitchen Dashboard'
                            : 'Save & Continue',
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Colors.white),
                  ),
                ),
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
    );
  }
}
