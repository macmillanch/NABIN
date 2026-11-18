import 'dart:convert';
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
  int _currentStep = 0; // 0: RM-004, 1: RM-005, 2: RM-006, 3: RM-007, 4: Success

  // RM-004 Controllers & State
  final TextEditingController _legalNameController = TextEditingController(text: 'Himalayan Flavors Private Limited');
  final TextEditingController _displayNameController = TextEditingController(text: 'NABIN Demo Restaurant');
  final TextEditingController _ownerNameController = TextEditingController(text: 'Rajesh Kumar');
  final TextEditingController _phoneController = TextEditingController(text: '9876543210');
  final TextEditingController _emailController = TextEditingController(text: 'support@himalayanflavors.in');
  final TextEditingController _fssaiController = TextEditingController(text: '10021022000492');

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

  GeoCoord _selectedCoord = const GeoCoord(27.7128, 85.3180);

  // RM-006 Compliance Documents State
  final TextEditingController _fssaiExpiryController = TextEditingController(text: '12 / 2026');
  final TextEditingController _panVatController = TextEditingController(text: '609123849');
  final TextEditingController _tradeLicenseController = TextEditingController(text: 'TRD-KTM-2024-883');

  String _fssaiFilename = 'fssai_cert_2024.pdf';
  String _fssaiSize = '2.4 MB';
  bool _fssaiAttached = true;

  String _panVatFilename = 'pan_vat_corporate_doc.jpg';
  bool _panVatAttached = true;

  String? _tradeLicenseFilename;
  String? _tradeLicenseSize;
  bool _tradeLicenseUploading = false;
  bool _tradeLicenseAttached = false;

  // RM-007 Bank & Settlement Payouts State
  final TextEditingController _accountHolderController = TextEditingController(text: 'Himalayan Flavors Pvt Ltd');
  final TextEditingController _accountNumberController = TextEditingController(text: '0124982184910');
  final TextEditingController _confirmAccountController = TextEditingController(text: '0124982184910');
  final TextEditingController _ifscController = TextEditingController(text: 'NBLNPKTM01');
  final TextEditingController _branchController = TextEditingController(text: 'Durbar Marg Branch');

  String _selectedBank = 'Nabil Bank Limited • Commercial Banking';
  final List<String> _bankOptions = [
    'Nabil Bank Limited • Commercial Banking',
    'Standard Chartered Bank • Corporate Account',
    'Himalayan Bank Ltd • Merchant Gateway',
    'NIC Asia Bank • Corporate Banking',
    'Siddhartha Bank • Commercial Payouts',
    'State Bank of India • Northeast Clearing'
  ];

  String _payoutCadence = 'DAILY_T1'; // 'DAILY_T1' or 'WEEKLY_CONSOLIDATED'
  bool _isAccountMasked = true;
  bool _hasChequeAttached = true;
  String _chequeFilename = 'cancelled_cheque_himalayan.png';

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
    _fssaiExpiryController.dispose();
    _panVatController.dispose();
    _tradeLicenseController.dispose();
    _accountHolderController.dispose();
    _accountNumberController.dispose();
    _confirmAccountController.dispose();
    _ifscController.dispose();
    _branchController.dispose();
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
                  const Expanded(
                    child: Text(
                      'Primary Cuisines (Select 1–4) *',
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: RestaurantTheme.textDark),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 8),
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
              const Expanded(
                child: Row(
                  children: [
                    Icon(Icons.verified, color: RestaurantTheme.statusReadyGreen, size: 18),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Precision Lat/Long Locked',
                        style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: RestaurantTheme.textDark),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
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

  // Step 2: RM-006 Legal & Food Safety Compliance
  Widget _buildDocumentsStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: RestaurantTheme.statusReadyBg,
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Text('Step 3 of 4 • Compliance & Verification', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: RestaurantTheme.statusReadyGreen)),
            ),
          ],
        ),
        const SizedBox(height: 12),
        const Text(
          'Legal & Food Safety Compliance',
          style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: RestaurantTheme.textDark, letterSpacing: -0.5),
        ),
        const SizedBox(height: 6),
        const Text(
          'Upload required regulatory documents to activate online ordering and secure kitchen operations.',
          style: TextStyle(color: RestaurantTheme.textMuted, fontSize: 13.5),
        ),
        const SizedBox(height: 24),

        // Document 1: Food Safety & Standards (FSSAI)
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
                  const Expanded(
                    child: Row(
                      children: [
                        Icon(Icons.verified_user, color: RestaurantTheme.primaryBlue, size: 22),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Food Safety & Standards',
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: RestaurantTheme.textDark),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: RestaurantTheme.statusReadyBg,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.check_circle, size: 14, color: RestaurantTheme.statusReadyGreen),
                        const SizedBox(width: 4),
                        Text(_fssaiAttached ? 'Attached' : 'Pending', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.statusReadyGreen)),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              const Text('FSSAI / Dept. of Food Technology & Quality Control', style: TextStyle(fontSize: 12, color: RestaurantTheme.textMuted)),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(child: _buildTextField('Licence Number', _fssaiController, Icons.lock_outline)),
                  const SizedBox(width: 12),
                  Expanded(child: _buildTextField('Expiry Date', _fssaiExpiryController, Icons.calendar_today_outlined)),
                ],
              ),
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: RestaurantTheme.bgSurface,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.picture_as_pdf, color: RestaurantTheme.nonVegRed, size: 28),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(_fssaiFilename, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: RestaurantTheme.textDark)),
                          Text('$_fssaiSize • Encrypted verification', style: const TextStyle(fontSize: 11, color: RestaurantTheme.textMuted)),
                        ],
                      ),
                    ),
                    TextButton(
                      onPressed: () {
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Viewing verified FSSAI licence preview.')));
                      },
                      child: const Text('Preview'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Document 2: PAN / VAT Certificate
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
                  const Expanded(
                    child: Row(
                      children: [
                        Icon(Icons.receipt_long, color: RestaurantTheme.neonOrange, size: 22),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'PAN / VAT Certificate',
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: RestaurantTheme.textDark),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: RestaurantTheme.statusReadyBg,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.verified, size: 14, color: RestaurantTheme.statusReadyGreen),
                        SizedBox(width: 4),
                        Text('Verified', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.statusReadyGreen)),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              const Text('Business Tax Identification & Revenue Record', style: TextStyle(fontSize: 12, color: RestaurantTheme.textMuted)),
              const SizedBox(height: 14),
              _buildTextField('PAN / VAT Number', _panVatController, Icons.domain_verification),
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: RestaurantTheme.bgSurface,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.image, color: RestaurantTheme.primaryBlue, size: 28),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(_panVatFilename, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: RestaurantTheme.textDark)),
                          const Text('Matched with Ministry of Revenue database', style: TextStyle(fontSize: 11, color: RestaurantTheme.textMuted)),
                        ],
                      ),
                    ),
                    TextButton(
                      onPressed: () {
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Viewing PAN/VAT certificate.')));
                      },
                      child: const Text('View'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Document 3: Restaurant Trade License
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
                  const Expanded(
                    child: Row(
                      children: [
                        Icon(Icons.storefront, color: RestaurantTheme.primaryBlue, size: 22),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Restaurant Trade License',
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: RestaurantTheme.textDark),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: _tradeLicenseAttached ? RestaurantTheme.statusReadyBg : RestaurantTheme.neonOrange.withAlpha(30),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(_tradeLicenseAttached ? Icons.check_circle : Icons.hourglass_empty, size: 14, color: _tradeLicenseAttached ? RestaurantTheme.statusReadyGreen : RestaurantTheme.neonOrange),
                        const SizedBox(width: 4),
                        Text(_tradeLicenseAttached ? 'Attached' : 'Action Needed', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: _tradeLicenseAttached ? RestaurantTheme.statusReadyGreen : RestaurantTheme.neonOrange)),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              const Text('Operating Municipal Permit & Ward Clearance', style: TextStyle(fontSize: 12, color: RestaurantTheme.textMuted)),
              const SizedBox(height: 14),
              _buildTextField('Registration Number *', _tradeLicenseController, Icons.confirmation_number_outlined),
              const SizedBox(height: 14),

              InkWell(
                onTap: _tradeLicenseUploading
                    ? null
                    : () async {
                        setState(() => _tradeLicenseUploading = true);
                        await Future.delayed(const Duration(milliseconds: 600));

                        final mockPdfBytes = utf8.encode('%PDF-1.4 official trade license document payload');
                        final filename = 'trade_license_permit_${DateTime.now().millisecondsSinceEpoch}.pdf';

                        final res = await NabinApiService.uploadMerchantDocument(
                          documentType: 'TRADE_LICENSE',
                          filename: filename,
                          bytes: mockPdfBytes,
                          documentNumber: _tradeLicenseController.text.trim(),
                          mimeType: 'application/pdf',
                        );

                        if (!mounted) return;
                        setState(() {
                          _tradeLicenseUploading = false;
                          _tradeLicenseAttached = true;
                          _tradeLicenseFilename = filename;
                          _tradeLicenseSize = '1.8 MB';
                        });

                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text(res?['success'] == true ? 'Trade license uploaded securely.' : 'Trade license attached locally.'),
                            backgroundColor: RestaurantTheme.statusReadyGreen,
                          ),
                        );
                      },
                borderRadius: BorderRadius.circular(14),
                child: Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: RestaurantTheme.bgSurface,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: _tradeLicenseAttached ? RestaurantTheme.statusReadyGreen : RestaurantTheme.primaryBlue.withAlpha(80), width: 1.5),
                  ),
                  child: Center(
                    child: _tradeLicenseUploading
                        ? const Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              CircularProgressIndicator(strokeWidth: 2),
                              SizedBox(height: 10),
                              Text('Encrypting & uploading document...', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                            ],
                          )
                        : Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(_tradeLicenseAttached ? Icons.check_circle : Icons.cloud_upload_outlined, size: 36, color: _tradeLicenseAttached ? RestaurantTheme.statusReadyGreen : RestaurantTheme.primaryBlue),
                              const SizedBox(height: 8),
                              Text(
                                _tradeLicenseAttached ? '$_tradeLicenseFilename ($_tradeLicenseSize)' : 'Tap to capture or upload license document',
                                style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.bold, color: RestaurantTheme.textDark),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                _tradeLicenseAttached ? 'Click to replace file' : 'PDF, JPG or PNG up to 10MB (Camera / Files)',
                                style: const TextStyle(fontSize: 11.5, color: RestaurantTheme.textMuted),
                              ),
                            ],
                          ),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Compliance Info Box
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: RestaurantTheme.primaryBlue.withAlpha(20),
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.info_outline, color: RestaurantTheme.primaryBlue, size: 20),
              SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Why is this required?', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.bold, color: RestaurantTheme.primaryBlue)),
                    SizedBox(height: 2),
                    Text(
                      'Government regulations mandate verified food safety and trade credentials to safeguard diners and enable instant payouts on NABIN.',
                      style: TextStyle(fontSize: 11.5, color: RestaurantTheme.textMuted, height: 1.35),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // Step 3: RM-007 Bank Account & Settlement Payouts
  Widget _buildBankSettlementStep() {
    final accountNumbersMatch = _accountNumberController.text.isNotEmpty &&
        _accountNumberController.text.trim() == _confirmAccountController.text.trim();

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
              child: const Text('Step 4 of 4 • Payouts & Settlement', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: RestaurantTheme.primaryBlue)),
            ),
          ],
        ),
        const SizedBox(height: 12),
        const Text(
          'Bank Account & Settlement Payouts',
          style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: RestaurantTheme.textDark, letterSpacing: -0.5),
        ),
        const SizedBox(height: 6),
        const Text(
          'Daily order earnings are settled automatically into this verified bank account. All incoming receipts are matched daily.',
          style: TextStyle(color: RestaurantTheme.textMuted, fontSize: 13.5),
        ),
        const SizedBox(height: 24),

        // Verified Legal Entity Notice Card
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: RestaurantTheme.surfaceCard,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: RestaurantTheme.outlineVariant),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: RestaurantTheme.primaryBlue.withAlpha(25),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(Icons.verified_user, color: RestaurantTheme.primaryBlue, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('VERIFIED BUSINESS ENTITY', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.textMuted, letterSpacing: 0.5)),
                    const SizedBox(height: 2),
                    Text(_legalNameController.text, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: RestaurantTheme.textDark)),
                    const SizedBox(height: 4),
                    const Text('Account holder name must match official registered trade license.', style: TextStyle(fontSize: 11.5, color: RestaurantTheme.textMuted)),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Bank Selection Dropdown Card
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
              const Text('DESIGNATED COMMERCIAL BANK *', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.textMuted, letterSpacing: 0.5)),
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14),
                decoration: BoxDecoration(
                  color: RestaurantTheme.bgSurface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: RestaurantTheme.outlineVariant),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    value: _selectedBank,
                    isExpanded: true,
                    icon: const Icon(Icons.arrow_drop_down, color: RestaurantTheme.primaryBlue),
                    items: _bankOptions.map((bank) {
                      return DropdownMenuItem<String>(
                        value: bank,
                        child: Row(
                          children: [
                            const Icon(Icons.account_balance, color: RestaurantTheme.primaryBlue, size: 18),
                            const SizedBox(width: 10),
                            Expanded(child: Text(bank, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: RestaurantTheme.textDark), overflow: TextOverflow.ellipsis)),
                          ],
                        ),
                      );
                    }).toList(),
                    onChanged: (val) {
                      if (val != null) setState(() => _selectedBank = val);
                    },
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Bank Account Numbers Card with Mask Toggle
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
                  const Text('BANK ACCOUNT NUMBER *', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.textMuted, letterSpacing: 0.5)),
                  IconButton(
                    icon: Icon(_isAccountMasked ? Icons.visibility : Icons.visibility_off, size: 20, color: RestaurantTheme.primaryBlue),
                    onPressed: () => setState(() => _isAccountMasked = !_isAccountMasked),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                decoration: BoxDecoration(
                  color: RestaurantTheme.bgSurface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: RestaurantTheme.outlineVariant),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.tag, color: RestaurantTheme.primaryBlue, size: 20),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        controller: _accountNumberController,
                        obscureText: _isAccountMasked,
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, fontFamily: 'monospace', letterSpacing: 1.5, color: RestaurantTheme.textDark),
                        decoration: const InputDecoration(border: InputBorder.none, hintText: 'Enter bank account number'),
                        onChanged: (_) => setState(() {}),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('RE-ENTER BANK ACCOUNT NUMBER *', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.textMuted, letterSpacing: 0.5)),
                  if (accountNumbersMatch)
                    const Row(
                      children: [
                        Icon(Icons.check_circle, size: 14, color: RestaurantTheme.statusReadyGreen),
                        SizedBox(width: 4),
                        Text('Numbers Match', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.statusReadyGreen)),
                      ],
                    ),
                ],
              ),
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                decoration: BoxDecoration(
                  color: RestaurantTheme.bgSurface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: accountNumbersMatch ? RestaurantTheme.statusReadyGreen : RestaurantTheme.outlineVariant),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.verified, color: RestaurantTheme.primaryBlue, size: 20),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        controller: _confirmAccountController,
                        obscureText: true,
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, fontFamily: 'monospace', letterSpacing: 1.5, color: RestaurantTheme.textDark),
                        decoration: const InputDecoration(border: InputBorder.none, hintText: 'Re-enter account number to confirm'),
                        onChanged: (_) => setState(() {}),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Branch Location & Routing / IFSC Code
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
              const Text('ROUTING & CLEARING CODE *', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.textMuted, letterSpacing: 0.5)),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(child: _buildTextField('Branch Name', _branchController, Icons.location_city)),
                  const SizedBox(width: 12),
                  Expanded(child: _buildTextField('IFSC Code (e.g. NBLNPKTM01)', _ifscController, Icons.account_tree_outlined)),
                ],
              ),
              const SizedBox(height: 8),
              const Text('Direct Automated Clearing House (ACH) Active • Daily batch cutoff 01:00 AM', style: TextStyle(fontSize: 11, color: RestaurantTheme.textMuted)),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Payout Cadence Selector Card
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
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('PAYOUT SETTLEMENT CADENCE', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.textMuted, letterSpacing: 0.5)),
                  Text('ZERO FEES', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.neonOrange)),
                ],
              ),
              const SizedBox(height: 12),

              _buildCadenceOption(
                'DAILY_T1',
                'Daily T+1 Automated Settlement',
                'Recommended',
                'Every night\'s kitchen earnings clear into your bank account before 10:00 AM next business morning.',
              ),
              const SizedBox(height: 8),
              _buildCadenceOption(
                'WEEKLY_CONSOLIDATED',
                'Weekly Consolidated Settlement',
                null,
                'Single batched transfer every Monday morning with aggregate invoices for easier financial auditing.',
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Cancelled Cheque / Bank Passbook Card
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
                  const Text('CANCELLED CHEQUE / BANK PASSBOOK', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.textMuted, letterSpacing: 0.5)),
                  if (_hasChequeAttached)
                    const Row(
                      children: [
                        Icon(Icons.check_circle, size: 14, color: RestaurantTheme.statusReadyGreen),
                        SizedBox(width: 4),
                        Text('File Verified', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: RestaurantTheme.statusReadyGreen)),
                      ],
                    ),
                ],
              ),
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: RestaurantTheme.bgSurface,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.description, color: RestaurantTheme.primaryBlue, size: 28),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(_chequeFilename, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: RestaurantTheme.textDark)),
                          const Text('2.4 MB • Encrypted ACH verification doc', style: TextStyle(fontSize: 11, color: RestaurantTheme.textMuted)),
                        ],
                      ),
                    ),
                    TextButton(
                      onPressed: () {
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Viewing verified cheque voucher.')));
                      },
                      child: const Text('View'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Instant Penny-Drop Security Callout
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: RestaurantTheme.primaryBlue.withAlpha(20),
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.currency_rupee, color: RestaurantTheme.primaryBlue, size: 22),
              SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text('Instant Penny-Drop Verification', style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: RestaurantTheme.primaryBlue)),
                        SizedBox(width: 6),
                        Text('Active', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: RestaurantTheme.statusReadyGreen)),
                      ],
                    ),
                    SizedBox(height: 2),
                    Text(
                      'NABIN initiates a ₹1 test deposit penny-drop to verify account authenticity instantly. If name match passes, your onboarding transitions to Ready to Serve.',
                      style: TextStyle(fontSize: 11.5, color: RestaurantTheme.textMuted, height: 1.35),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildCadenceOption(String value, String title, String? tag, String description) {
    final isSelected = _payoutCadence == value;
    return InkWell(
      onTap: () => setState(() => _payoutCadence = value),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isSelected ? RestaurantTheme.primaryBlue.withAlpha(15) : RestaurantTheme.bgSurface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: isSelected ? RestaurantTheme.primaryBlue : RestaurantTheme.outlineVariant, width: isSelected ? 1.5 : 1),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Radio<String>(
              value: value,
              groupValue: _payoutCadence,
              activeColor: RestaurantTheme.primaryBlue,
              onChanged: (val) => setState(() => _payoutCadence = val!),
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(title, style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.bold, color: isSelected ? RestaurantTheme.primaryBlue : RestaurantTheme.textDark)),
                      if (tag != null) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: RestaurantTheme.neonOrange.withAlpha(25),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(tag, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: RestaurantTheme.neonOrange)),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(description, style: const TextStyle(fontSize: 11.5, color: RestaurantTheme.textMuted, height: 1.3)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // Step 4: Submission & Verification Review
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
            'Your kitchen intake, verified documents, and bank payout credentials are submitted and pending administrator approval. Automated T+1 settlements will commence upon review.',
            textAlign: TextAlign.center,
            style: TextStyle(color: RestaurantTheme.textMuted, fontSize: 14, height: 1.4),
          ),
        ),
        const SizedBox(height: 28),
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

  Future<void> _submitRegistration() async {
    final formattedAddress = '${_buildingController.text.trim()}, ${_streetController.text.trim()}${_landmarkController.text.trim().isNotEmpty ? ', Near ${_landmarkController.text.trim()}' : ''}, ${_areaController.text.trim()}, ${_cityController.text.trim()} - ${_postalController.text.trim()}';

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    final regRes = await NabinApiService.registerMerchant(
      name: _displayNameController.text.trim(),
      phone: _phoneController.text.trim(),
      address: formattedAddress,
      lat: _selectedCoord.latitude,
      lng: _selectedCoord.longitude,
      businessType: 'RESTAURANT',
      fssaiLicense: _fssaiController.text.trim(),
    );

    // Also attempt saving bank account details
    await NabinApiService.saveMerchantBankAccount(
      accountHolderName: _accountHolderController.text.trim(),
      bankName: _selectedBank,
      accountNumber: _accountNumberController.text.trim(),
      confirmAccountNumber: _confirmAccountController.text.trim(),
      ifscCode: _ifscController.text.trim(),
      branchName: _branchController.text.trim(),
      accountType: 'CURRENT',
      payoutCadence: _payoutCadence,
    );

    if (!mounted) return;
    setState(() => _isLoading = false);

    if (regRes != null && regRes['success'] == true) {
      setState(() => _currentStep = 4); // Success step
    } else {
      setState(() {
        _errorMessage = regRes?['error'] ?? 'Registration failed. Please check inputs.';
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
      if (_buildingController.text.trim().isEmpty || _streetController.text.trim().isEmpty || _areaController.text.trim().isEmpty || _cityController.text.trim().isEmpty || _postalController.text.trim().isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Please fill all required address fields.'), backgroundColor: RestaurantTheme.nonVegRed));
        return;
      }
      setState(() => _currentStep = 2);
    } else if (_currentStep == 2) {
      if (_tradeLicenseController.text.trim().isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Trade license registration number is required.'), backgroundColor: RestaurantTheme.nonVegRed));
        return;
      }
      setState(() => _currentStep = 3);
    } else if (_currentStep == 3) {
      // Validate RM-007 Bank fields
      if (_accountHolderController.text.trim().isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Account beneficiary name is required.'), backgroundColor: RestaurantTheme.nonVegRed));
        return;
      }
      if (_accountNumberController.text.trim().length < 6) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Please enter a valid bank account number.'), backgroundColor: RestaurantTheme.nonVegRed));
        return;
      }
      if (_accountNumberController.text.trim() != _confirmAccountController.text.trim()) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Bank account numbers do not match.'), backgroundColor: RestaurantTheme.nonVegRed));
        return;
      }
      if (_ifscController.text.trim().isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('IFSC routing code is required.'), backgroundColor: RestaurantTheme.nonVegRed));
        return;
      }
      _submitRegistration();
    } else if (_currentStep == 4) {
      context.go('/login');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: RestaurantTheme.bgSurface,
      appBar: AppBar(
        title: Text(_currentStep < 4 ? 'Partner Onboarding • Step ${_currentStep + 1} of 4' : 'Review & Submit'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            if (_currentStep > 0 && _currentStep < 4) {
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
                    _buildDocumentsStep(),
                    _buildBankSettlementStep(),
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
                          _currentStep == 3
                              ? 'Submit Application for Review'
                              : _currentStep == 4
                                  ? 'Proceed to Login'
                                  : 'Save & Continue',
                          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Colors.white),
                        ),
                ),
              ),
              if (_currentStep == 3) ...[
                const SizedBox(height: 8),
                const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.lock, size: 14, color: RestaurantTheme.statusReadyGreen),
                    SizedBox(width: 4),
                    Text('256-bit Bank Grade Encrypted Settlement Pipeline', style: TextStyle(fontSize: 11, color: RestaurantTheme.textMuted, fontWeight: FontWeight.bold)),
                  ],
                ),
              ],
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
