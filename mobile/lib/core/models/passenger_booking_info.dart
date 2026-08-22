class PassengerBookingInfo {
  final String bookingType; // 'FOR_ME' or 'FOR_SOMEONE_ELSE'
  final String passengerCategory; // 'ADULT', 'SCHOOL_CHILD', 'ELDERLY', 'OTHER'
  
  // Passenger / Child Profile details
  final String? passengerName;
  final String? passengerPhoto;
  final String? schoolName;
  final String? gradeClass; // e.g. "Class 5"
  final String? section;    // Strictly Optional! e.g. "Section B"
  final String? guardianName;
  final String? guardianPhone;
  final String? pickupAddress;
  final String? dropAddress;
  final String? specialInstructions;
  
  // School timing snapshot
  final String? schoolTimingSummary; // e.g. "8:30 AM – 2:30 PM • Mon–Fri"
  final String? morningPickupTime;  // e.g. "7:45 AM"
  final String? schoolArrivalTime;   // e.g. "8:15 AM"
  final String? afternoonPickupTime; // e.g. "2:30 PM"
  final String? homeArrivalTime;    // e.g. "3:00 PM"
  
  final String startOtp; // e.g. "7729"

  const PassengerBookingInfo({
    this.bookingType = 'FOR_ME',
    this.passengerCategory = 'ADULT',
    this.passengerName,
    this.passengerPhoto,
    this.schoolName,
    this.gradeClass,
    this.section,
    this.guardianName,
    this.guardianPhone,
    this.pickupAddress,
    this.dropAddress,
    this.specialInstructions,
    this.schoolTimingSummary,
    this.morningPickupTime,
    this.schoolArrivalTime,
    this.afternoonPickupTime,
    this.homeArrivalTime,
    this.startOtp = '7729',
  });

  bool get isForSomeoneElse => bookingType == 'FOR_SOMEONE_ELSE';
  bool get isSchoolChild => isForSomeoneElse && passengerCategory == 'SCHOOL_CHILD';

  Map<String, dynamic> toJson() => {
    'bookingType': bookingType,
    'passengerCategory': passengerCategory,
    'passengerName': passengerName,
    'passengerPhoto': passengerPhoto,
    'schoolName': schoolName,
    'gradeClass': gradeClass,
    'section': section,
    'guardianName': guardianName,
    'guardianPhone': guardianPhone,
    'pickupAddress': pickupAddress,
    'dropAddress': dropAddress,
    'specialInstructions': specialInstructions,
    'schoolTimingSummary': schoolTimingSummary,
    'morningPickupTime': morningPickupTime,
    'schoolArrivalTime': schoolArrivalTime,
    'afternoonPickupTime': afternoonPickupTime,
    'homeArrivalTime': homeArrivalTime,
    'startOtp': startOtp,
  };

  factory PassengerBookingInfo.fromJson(Map<String, dynamic> json) => PassengerBookingInfo(
    bookingType: json['bookingType'] as String? ?? 'FOR_ME',
    passengerCategory: json['passengerCategory'] as String? ?? 'ADULT',
    passengerName: json['passengerName'] as String?,
    passengerPhoto: json['passengerPhoto'] as String?,
    schoolName: json['schoolName'] as String?,
    gradeClass: json['gradeClass'] as String?,
    section: json['section'] as String?,
    guardianName: json['guardianName'] as String?,
    guardianPhone: json['guardianPhone'] as String?,
    pickupAddress: json['pickupAddress'] as String?,
    dropAddress: json['dropAddress'] as String?,
    specialInstructions: json['specialInstructions'] as String?,
    schoolTimingSummary: json['schoolTimingSummary'] as String?,
    morningPickupTime: json['morningPickupTime'] as String?,
    schoolArrivalTime: json['schoolArrivalTime'] as String?,
    afternoonPickupTime: json['afternoonPickupTime'] as String?,
    homeArrivalTime: json['homeArrivalTime'] as String?,
    startOtp: json['startOtp'] as String? ?? '7729',
  );
}
