import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/restaurant_theme.dart';
import '../../../../core/network/nabin_api_service.dart';
import '../../../../core/widgets/map_pin_picker.dart';
import '../../../../core/models/geo_coord.dart';

class RestaurantRegistrationScreen extends StatefulWidget {
  const RestaurantRegistrationScreen({super.key});

  @override
  State<RestaurantRegistrationScreen> createState() => _RestaurantRegistrationScreenState();
}

class _RestaurantRegistrationScreenState extends State<RestaurantRegistrationScreen> {
  int _currentStep = 0; // 0: RM-004 Business Details, 1: RM-005 Address & Location, 2: Documents & Submission, 3: Success

  // RM-004 Controllers & State
  final TextEditingController _legalNameController = TextEditingController(text: 'Himalayan Flavors Private Limited');
  final TextEditingController _displayNameController = TextEditingController(text: 'NABIN Demo Restaurant');
  final TextEditingController _ownerNameController = TextEditingController(text: 'Rajesh Kumar');
  final TextEditingController _phoneController = TextEditingController(text: '9876543210');
  final TextEditingController _emailController = TextEditingController(text: 'support@himalayanflavors.in');
  final TextEditingController _fssaiController = TextEditingController(text: '10021031000123');

  String _selectedEstablishmentType = 'dine-in';
  final List<String> _selectedCuisines = ['Nepali Traditional', 'North Indian', 'Tibetan / Momos'];
  final List<String> _availableCuisines = [
    'Nepali Traditional',
    'North Indian',
    'Tibetan / Momos',
    'Continental',
    'Chinese',
    'Fast Food',
    'South Indian',
    'Bakery & Cafe'
  ];

  // RM-005 Address & Location Controllers & State
  final TextEditingController _buildingController = TextEditingController(text: 'Shop #4B, Ground Floor, City Center Mall');
  final TextEditingController _streetController = TextEditingController(text: 'Durbar Marg Commercial Avenue');
  final TextEditingController _landmarkController = TextEditingController(text: 'Opposite Royal Clock Tower');
  final TextEditingController _areaController = TextEditingController(text: 'Thamel / Durbar Marg Zone');
  final TextEditingController _cityController = TextEditingController(text: 'Kathmandu Metropolitan');
  final TextEditingController _postalController = TextEditingController(text: '44600');

  GeoCoord _selectedCoord = const GeoCoord(27.7128, 85.3180); // Default coordinates
  bool _isLoading = false;
  String? _errorMessage;

  @override
  void dispose() {
    _legalNameController.dispose();
    _displayNameController.dispose();
    _ownerNameController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    _fssaiController.dispose();
    _buildingController.dispose();
    _streetController.dispose();
    _landmarkController.dispose();
    _areaController.dispose();
    _cityController.dispose();
    _postalController.dispose();
    super.dispose();
  }

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

  // Step 0: RM-004 Restaurant Business Details
  Widget _buildBusinessDetailsStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: RestaurantTheme.neonOrange.withAlpha(40),
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Text('Step 1 of 4 • Business Profile', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: RestaurantTheme.neonOrange)),
            ),
          ],
        ),
        const SizedBox(height: 12),
        const Text(
          'Restaurant & Owner Details',
          style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: RestaurantTheme.textDark, letterSpacing: -0.5),
        ),
        const SizedBox(height: 6),
        const Text(
          'Tell us about your eatery and primary business contact.',
          style: TextStyle(color: RestaurantTheme.textMuted, fontSize: 13.5),
        ),
        const SizedBox(height: 24),

        // Entity Identity Card
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: RestaurantTheme.surfaceCard,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: RestaurantTheme.outlineVariant),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(Icons.badge_outlined, color: RestaurantTheme.primaryBlue, size: 20),
                  SizedBox(width: 8),
                  Text('Entity Identity', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: RestaurantTheme.textDark)),
                ],
              ),
              const SizedBox(height: 16),
              _buildTextField('Restaurant Legal Entity Name (PAN/VAT)', _legalNameController, Icons.store),
              const SizedBox(height: 14),
              _buildTextField('Trade / Display Name (Receipts & KDS)', _displayNameController, Icons.restaurant),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Establishment Type Card
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: RestaurantTheme.surfaceCard,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: RestaurantTheme.outlineVariant),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Establishment Type *', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: RestaurantTheme.textDark)),
              const SizedBox(height: 4),
              const Text('Helps calibrate table layout and dispatch flow.', style: TextStyle(fontSize: 12, color: RestaurantTheme.textMuted)),
              const SizedBox(height: 14),
              _buildRadioOption('Dine-in & Delivery', 'Table ordering, takeout counter & rider pickup', 'dine-in', Icons.table_bar),
              const SizedBox(height: 8),
              _buildRadioOption('Cloud Kitchen / Delivery Only', 'Virtual kitchen, optimized for rapid dispatch', 'cloud-kitchen', Icons.soup_kitchen),
              const SizedBox(height: 8),
              _buildRadioOption('Bakery & Cafe', 'Barista station, pastry cases & walk-up ordering', 'bakery', Icons.bakery_dining),
              const SizedBox(height: 8),
              _buildRadioOption('Quick Service (QSR)', 'High turnaround, kiosk prep & counter billing', 'qsr', Icons.flash_on),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Primary Cuisines Card
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: RestaurantTheme.surfaceCard,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: RestaurantTheme.outlineVariant),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Primary Cuisines (Select 1–4) *', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: RestaurantTheme.textDark)),
                  Text('${_selectedCuisines.length}/4 selected', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: RestaurantTheme.primaryBlue)),
                ],
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _availableCuisines.map((cuisine) {
                  final isSelected = _selectedCuisines.contains(cuisine);
                  return FilterChip(
                    label: Text(cuisine),
                    selected: isSelected,
                    selectedColor: RestaurantTheme.primaryContainer,
                    labelStyle: TextStyle(
                      color: isSelected ? Colors.white : RestaurantTheme.textDark,
                      fontWeight: FontWeight.w700,
                      fontSize: 12.5,
                    ),
                    onSelected: (selected) {
                      setState(() {
                        if (selected) {
                          if (_selectedCuisines.length < 4) {
                            _selectedCuisines.add(cuisine);
                          }
                        } else {
                          if (_selectedCuisines.length > 1) {
                            _selectedCuisines.remove(cuisine);
                          }
                        }
                      });
                    },
                  );
                }).toList(),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Owner Contact Card
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: RestaurantTheme.surfaceCard,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: RestaurantTheme.outlineVariant),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Primary Contact & Compliance', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: RestaurantTheme.textDark)),
              const SizedBox(height: 14),
              _buildTextField('Owner / Manager Name', _ownerNameController, Icons.person_outline),
              const SizedBox(height: 14),
              _buildTextField('Direct Mobile Number', _phoneController, Icons.phone_android),
              const SizedBox(height: 14),
              _buildTextField('Email Address', _emailController, Icons.email_outlined),
              const SizedBox(height: 14),
              _buildTextField('FSSAI Licence Number (14 Digits)', _fssaiController, Icons.verified_user_outlined),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildRadioOption(String title, String subtitle, String value, IconData icon) {
    final isSelected = _selectedEstablishmentType == value;
    return InkWell(
      onTap: () => setState(() => _selectedEstablishmentType = value),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isSelected ? RestaurantTheme.primaryBlue.withAlpha(20) : RestaurantTheme.bgSurface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: isSelected ? RestaurantTheme.primaryBlue : RestaurantTheme.outlineVariant, width: isSelected ? 1.5 : 1),
        ),
        child: Row(
          children: [
            Icon(icon, color: isSelected ? RestaurantTheme.primaryBlue : RestaurantTheme.textMuted, size: 22),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: isSelected ? RestaurantTheme.primaryBlue : RestaurantTheme.textDark)),
                  const SizedBox(height: 2),
                  Text(subtitle, style: const TextStyle(fontSize: 11.5, color: RestaurantTheme.textMuted)),
                ],
              ),
            ),
            Radio<String>(
              value: value,
              groupValue: _selectedEstablishmentType,
              activeColor: RestaurantTheme.primaryBlue,
              onChanged: (val) => setState(() => _selectedEstablishmentType = val!),
            ),
          ],
        ),
      ),
    );
  }

  // Step 1: RM-005 Restaurant Address and Location
  Widget _buildAddressLocationStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: RestaurantTheme.primaryBlue.withAlpha(25),
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Text('Step 2 of 4 • Location & Outlets', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: RestaurantTheme.primaryBlue)),
            ),
          ],
        ),
        const SizedBox(height: 12),
        const Text(
          'Restaurant Location & Delivery Zone',
          style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: RestaurantTheme.textDark, letterSpacing: -0.5),
        ),
        const SizedBox(height: 6),
        const Text(
          'Pinpoint your kitchen so NABIN fleet riders and customers can find you accurately.',
          style: TextStyle(color: RestaurantTheme.textMuted, fontSize: 13.5),
        ),
        const SizedBox(height: 24),

        // Interactive Map Picker Trigger Card
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: RestaurantTheme.surfaceCard,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: RestaurantTheme.outlineVariant),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(Icons.map, color: RestaurantTheme.primaryBlue, size: 20),
                  SizedBox(width: 8),
                  Text('GPS Pinpointer', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: RestaurantTheme.textDark)),
                ],
              ),
              const SizedBox(height: 10),
              const Text('Tap below to open the interactive map and set exact kitchen coordinates.', style: TextStyle(fontSize: 12, color: RestaurantTheme.textMuted)),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: RestaurantTheme.primaryBlue,
                    side: const BorderSide(color: RestaurantTheme.primaryBlue),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  icon: const Icon(Icons.my_location),
                  label: Text('Select Pin on Map (${_selectedCoord.latitude.toString_4()}, ${_selectedCoord.longitude.toString_4()})'),
                  onPressed: () async {
                    final picked = await MapPinPickerSheet.show(
                      context,
                      initial: _selectedCoord.toLatLng(),
                      title: 'Kitchen Location',
                      hint: 'Tap the exact building location for rider pickups.',
                    );
                    if (picked != null) {
                      setState(() {
                        _selectedCoord = GeoCoord.fromLatLng(picked);
                      });
                    }
                  },
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Locked Coordinates Badge
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: RestaurantTheme.surfaceCard,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: RestaurantTheme.outlineVariant),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.verified, color: RestaurantTheme.statusReadyGreen, size: 18),
                  SizedBox(width: 8),
                  Text('Precision Lat/Long Locked', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: RestaurantTheme.textDark)),
                ],
              ),
              Text(
                '${_selectedCoord.latitude.toString_4()}° N, ${_selectedCoord.longitude.toString_4()}° E',
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: RestaurantTheme.primaryBlue, fontFamily: 'monospace'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),

        // Operational Address Form
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: RestaurantTheme.surfaceCard,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: RestaurantTheme.outlineVariant),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Operational Address *', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: RestaurantTheme.textDark)),
              const SizedBox(height: 16),
              _buildTextField('Building / Shop No. & Floor *', _buildingController, Icons.storefront),
              const SizedBox(height: 14),
              _buildTextField('Street / Road Name *', _streetController, Icons.add_road),
              const SizedBox(height: 14),
              _buildTextField('Landmark (Optional)', _landmarkController, Icons.flag_outlined),
              const SizedBox(height: 14),
              _buildTextField('Area / Locality *', _areaController, Icons.location_city),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(child: _buildTextField('City / Municipality *', _cityController, Icons.location_on)),
                  const SizedBox(width: 12),
                  Expanded(child: _buildTextField('Postal Code *', _postalController, Icons.pin_drop)),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  // Step 2: Submission & Verification Step
  Widget _buildSubmissionStep() {
    return Column(
      children: [
        const SizedBox(height: 20),
        Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: RestaurantTheme.primaryBlue.withAlpha(25),
            shape: BoxShape.circle,
            border: Border.all(color: RestaurantTheme.primaryBlue, width: 2),
          ),
          child: const Icon(Icons.cloud_upload_rounded, size: 56, color: RestaurantTheme.primaryBlue),
        ),
        const SizedBox(height: 24),
        const Text(
          'Ready to Register Kitchen',
          style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: RestaurantTheme.textDark),
        ),
        const SizedBox(height: 8),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 16),
          child: Text(
            'Your business details and geocoded location are prepared. Click below to submit your store intake securely to NABIN.',
            textAlign: TextAlign.center,
            style: TextStyle(color: RestaurantTheme.textMuted, fontSize: 13.5, height: 1.4),
          ),
        ),
        const SizedBox(height: 24),

        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: RestaurantTheme.surfaceCard,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: RestaurantTheme.outlineVariant),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Registration Summary', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: RestaurantTheme.textDark)),
              const Divider(height: 20),
              _buildSummaryRow('Legal Name', _legalNameController.text),
              _buildSummaryRow('Display Name', _displayNameController.text),
              _buildSummaryRow('Establishment', _selectedEstablishmentType.toUpperCase()),
              _buildSummaryRow('Cuisines', _selectedCuisines.join(', ')),
              _buildSummaryRow('Phone', _phoneController.text),
              _buildSummaryRow('City', _cityController.text),
            ],
          ),
        ),
      ],
    );
  }

  // Step 3: Success / Approval Status
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
          'Registration Submitted Successfully!',
          style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: RestaurantTheme.textDark),
        ),
        const SizedBox(height: 8),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 20),
          child: Text(
            'Your kitchen intake is pending administrator approval. Once reviewed, your store will be live on NABIN.',
            textAlign: TextAlign.center,
            style: TextStyle(color: RestaurantTheme.textMuted, fontSize: 14, height: 1.4),
          ),
        ),
        const SizedBox(height: 28),
      ],
    );
  }

  Widget _buildSummaryRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: RestaurantTheme.textMuted, fontSize: 12.5)),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5, color: RestaurantTheme.textDark),
            ),
          ),
        ],
      ),
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

  Future<void> _submitRegistration() async {
    // Compose address string from individual components
    final formattedAddress = '${_buildingController.text.trim()}, ${_streetController.text.trim()}${_landmarkController.text.trim().isNotEmpty ? ', Near ${_landmarkController.text.trim()}' : ''}, ${_areaController.text.trim()}, ${_cityController.text.trim()} - ${_postalController.text.trim()}';

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    final res = await NabinApiService.registerMerchant(
      name: _displayNameController.text.trim(), // Trade name mapped to merchant name
      phone: _phoneController.text.trim(),
      address: formattedAddress,
      lat: _selectedCoord.latitude,
      lng: _selectedCoord.longitude,
      businessType: 'RESTAURANT',
      fssaiLicense: _fssaiController.text.trim(),
    );

    if (!mounted) return;
    setState(() => _isLoading = false);

    if (res != null && res['success'] == true) {
      setState(() => _currentStep = 3); // Success step
    } else {
      setState(() {
        _errorMessage = res?['error'] ?? 'Registration failed. Please check inputs.';
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_errorMessage!),
          backgroundColor: RestaurantTheme.nonVegRed,
        ),
      );
    }
  }

  void _nextStep() {
    if (_currentStep == 0) {
      // Validate RM-004 fields
      if (_legalNameController.text.trim().isEmpty || _displayNameController.text.trim().isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Legal name and display name are required.'), backgroundColor: RestaurantTheme.nonVegRed));
        return;
      }
      if (_phoneController.text.trim().length < 10) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Please enter a valid phone number.'), backgroundColor: RestaurantTheme.nonVegRed));
        return;
      }
      if (_selectedCuisines.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Select at least one cuisine.'), backgroundColor: RestaurantTheme.nonVegRed));
        return;
      }
      setState(() => _currentStep = 1);
    } else if (_currentStep == 1) {
      // Validate RM-005 address fields
      if (_buildingController.text.trim().isEmpty || _streetController.text.trim().isEmpty || _areaController.text.trim().isEmpty || _cityController.text.trim().isEmpty || _postalController.text.trim().isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Please fill all required address fields.'), backgroundColor: RestaurantTheme.nonVegRed));
        return;
      }
      setState(() => _currentStep = 2); // Move to review/submit step
    } else if (_currentStep == 2) {
      _submitRegistration();
    } else if (_currentStep == 3) {
      context.go('/login');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: RestaurantTheme.bgSurface,
      appBar: AppBar(
        title: Text(_currentStep < 2 ? 'Partner Onboarding • Step ${_currentStep + 1} of 2' : 'Review & Submit'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            if (_currentStep > 0 && _currentStep < 3) {
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
                    _buildBusinessDetailsStep(),
                    _buildAddressLocationStep(),
                    _buildSubmissionStep(),
                    _buildApprovalStep(),
                  ][_currentStep],
                ),
              ),
              const SizedBox(height: 12),
              if (_errorMessage != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(_errorMessage!, style: const TextStyle(color: RestaurantTheme.nonVegRed, fontSize: 12, fontWeight: FontWeight.bold)),
                ),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: RestaurantTheme.primaryContainer,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  onPressed: _isLoading ? null : _nextStep,
                  child: _isLoading
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                        )
                      : Text(
                          _currentStep == 2
                              ? 'Submit Registration to NABIN'
                              : _currentStep == 3
                                  ? 'Proceed to Login'
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

extension on double {
  String toString_4() => toStringAsFixed(4);
}
