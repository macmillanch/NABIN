class SavedChild {
  final String id;
  final String fullName;
  final String? photoUrl;
  final String schoolId;
  final String schoolName;
  final String schoolAddress;
  final double schoolLat;
  final double schoolLng;
  final String gradeClass; // e.g. "Class 5"
  final String? section;   // Strictly Optional! e.g. "Section B"
  final String guardianName;
  final String guardianPhone;
  final String defaultPickupAddress;
  final double pickupLat;
  final double pickupLng;
  final String? specialInstructions;

  const SavedChild({
    required this.id,
    required this.fullName,
    this.photoUrl,
    required this.schoolId,
    required this.schoolName,
    required this.schoolAddress,
    required this.schoolLat,
    required this.schoolLng,
    required this.gradeClass,
    this.section,
    required this.guardianName,
    required this.guardianPhone,
    required this.defaultPickupAddress,
    required this.pickupLat,
    required this.pickupLng,
    this.specialInstructions,
  });

  SavedChild copyWith({
    String? id,
    String? fullName,
    String? photoUrl,
    String? schoolId,
    String? schoolName,
    String? schoolAddress,
    double? schoolLat,
    double? schoolLng,
    String? gradeClass,
    String? section,
    String? guardianName,
    String? guardianPhone,
    String? defaultPickupAddress,
    double? pickupLat,
    double? pickupLng,
    String? specialInstructions,
  }) {
    return SavedChild(
      id: id ?? this.id,
      fullName: fullName ?? this.fullName,
      photoUrl: photoUrl ?? this.photoUrl,
      schoolId: schoolId ?? this.schoolId,
      schoolName: schoolName ?? this.schoolName,
      schoolAddress: schoolAddress ?? this.schoolAddress,
      schoolLat: schoolLat ?? this.schoolLat,
      schoolLng: schoolLng ?? this.schoolLng,
      gradeClass: gradeClass ?? this.gradeClass,
      section: section ?? this.section,
      guardianName: guardianName ?? this.guardianName,
      guardianPhone: guardianPhone ?? this.guardianPhone,
      defaultPickupAddress: defaultPickupAddress ?? this.defaultPickupAddress,
      pickupLat: pickupLat ?? this.pickupLat,
      pickupLng: pickupLng ?? this.pickupLng,
      specialInstructions: specialInstructions ?? this.specialInstructions,
    );
  }
}
