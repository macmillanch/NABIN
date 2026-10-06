class SavedChild {
  final String id;
  final String fullName;
  final String? photoUrl;

  /// The backend stores `school_id` and `school_name` and nothing about the
  /// school's address or coordinates — those belong to the school row. A child
  /// that was saved without a school has a null id, so the screens look the
  /// school up instead of assuming one.
  final String? schoolId;
  final String? schoolName;
  final String gradeClass; // e.g. "Class 5"
  final String? section;   // Strictly Optional! e.g. "Section B"
  final String guardianName;
  final String guardianPhone;
  final String defaultPickupAddress;

  /// Where the pickup actually is, in degrees. The write endpoint rejects a child
  /// without both, so these come from a place the customer chose on the map —
  /// never from a substituted default.
  final double pickupLat;
  final double pickupLng;
  final String? specialInstructions;

  const SavedChild({
    required this.id,
    required this.fullName,
    this.photoUrl,
    this.schoolId,
    this.schoolName,
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

  /// `mapRowToChild` returns these camelCase keys, with `pickupLat`/`pickupLng`
  /// parsed to numbers and the optional text fields arriving as `''`. Read strict
  /// on purpose: a row that cannot be parsed is a contract break the screen has
  /// to report, not one it can paper over with a made-up child.
  factory SavedChild.fromJson(Map<String, dynamic> json) => SavedChild(
        id: json['id'].toString(),
        fullName: json['full_name'] as String? ?? json['fullName'] as String,
        photoUrl: json['photoUrl'] as String?,
        schoolId: json['schoolId']?.toString(),
        schoolName: json['schoolName'] as String?,
        gradeClass: json['gradeClass'] as String,
        section: (json['section'] as String?)?.isEmpty ?? true ? null : json['section'] as String,
        guardianName: json['guardianName'] as String,
        guardianPhone: json['guardianPhone'] as String,
        defaultPickupAddress: json['defaultPickupAddress'] as String,
        pickupLat: (json['pickupLat'] as num).toDouble(),
        pickupLng: (json['pickupLng'] as num).toDouble(),
        specialInstructions:
            (json['specialInstructions'] as String?)?.isEmpty ?? true
                ? null
                : json['specialInstructions'] as String,
      );

  /// The `POST`/`PUT /api/children` body. Seven fields are required by the route;
  /// `schoolId` is checked against the caller's own schools, so a stale id is a
  /// 400 rather than a silent unlink.
  Map<String, dynamic> toJson() => <String, dynamic>{
        'fullName': fullName,
        if (photoUrl != null) 'photoUrl': photoUrl,
        if (schoolId != null) 'schoolId': schoolId,
        if (schoolName != null) 'schoolName': schoolName,
        'gradeClass': gradeClass,
        if (section != null) 'section': section,
        'guardianName': guardianName,
        'guardianPhone': guardianPhone,
        'defaultPickupAddress': defaultPickupAddress,
        'pickupLat': pickupLat,
        'pickupLng': pickupLng,
        if (specialInstructions != null) 'specialInstructions': specialInstructions,
      };
}
