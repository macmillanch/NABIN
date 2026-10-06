/// The backend returns text columns as `''` when unset; the models keep null for
/// "the customer never wrote this" so a screen can tell the two apart.
String? _blankToNull(Object? raw) {
  final text = raw?.toString().trim();
  return (text == null || text.isEmpty) ? null : text;
}

class SchoolTimingDay {
  final String dayName;
  final bool isOpen;
  final String startTime;
  final String endTime;

  const SchoolTimingDay({
    required this.dayName,
    this.isOpen = true,
    this.startTime = '08:30 AM',
    this.endTime = '02:30 PM',
  });

  SchoolTimingDay copyWith({
    String? dayName,
    bool? isOpen,
    String? startTime,
    String? endTime,
  }) {
    return SchoolTimingDay(
      dayName: dayName ?? this.dayName,
      isOpen: isOpen ?? this.isOpen,
      startTime: startTime ?? this.startTime,
      endTime: endTime ?? this.endTime,
    );
  }

  Map<String, dynamic> toJson() => {
    'dayName': dayName,
    'isOpen': isOpen,
    'startTime': startTime,
    'endTime': endTime,
  };

  factory SchoolTimingDay.fromJson(Map<String, dynamic> json) => SchoolTimingDay(
    dayName: json['dayName'] as String? ?? 'Monday',
    isOpen: json['isOpen'] as bool? ?? true,
    startTime: json['startTime'] as String? ?? '08:30 AM',
    endTime: json['endTime'] as String? ?? '02:30 PM',
  );
}

class SavedSchool {
  final String id;
  final String name;
  final String address;
  final double latitude;
  final double longitude;
  final String? photoUrl;
  final String? instructions;
  final bool isFavorite;
  final String generalTimingSummary;
  final List<SchoolTimingDay> customDayTimings;

  const SavedSchool({
    required this.id,
    required this.name,
    required this.address,
    required this.latitude,
    required this.longitude,
    this.photoUrl,
    this.instructions,
    this.isFavorite = false,
    this.generalTimingSummary = '8:30 AM – 2:30 PM • Mon–Fri',
    required this.customDayTimings,
  });

  SavedSchool copyWith({
    String? id,
    String? name,
    String? address,
    double? latitude,
    double? longitude,
    String? photoUrl,
    String? instructions,
    bool? isFavorite,
    String? generalTimingSummary,
    List<SchoolTimingDay>? customDayTimings,
  }) {
    return SavedSchool(
      id: id ?? this.id,
      name: name ?? this.name,
      address: address ?? this.address,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      photoUrl: photoUrl ?? this.photoUrl,
      instructions: instructions ?? this.instructions,
      isFavorite: isFavorite ?? this.isFavorite,
      generalTimingSummary: generalTimingSummary ?? this.generalTimingSummary,
      customDayTimings: customDayTimings ?? this.customDayTimings,
    );
  }

  static List<SchoolTimingDay> defaultWeeklySchedule({
    String start = '08:30 AM',
    String end = '02:30 PM',
    bool satOpen = true,
    String satEnd = '12:30 PM',
  }) {
    return [
      SchoolTimingDay(dayName: 'Monday', isOpen: true, startTime: start, endTime: end),
      SchoolTimingDay(dayName: 'Tuesday', isOpen: true, startTime: start, endTime: end),
      SchoolTimingDay(dayName: 'Wednesday', isOpen: true, startTime: start, endTime: end),
      SchoolTimingDay(dayName: 'Thursday', isOpen: true, startTime: start, endTime: end),
      SchoolTimingDay(dayName: 'Friday', isOpen: true, startTime: start, endTime: end),
      SchoolTimingDay(dayName: 'Saturday', isOpen: satOpen, startTime: start, endTime: satEnd),
      const SchoolTimingDay(dayName: 'Sunday', isOpen: false, startTime: '', endTime: ''),
    ];
  }

  /// `mapRowToSchool` in the backend returns exactly these camelCase keys, with
  /// latitude/longitude parsed to numbers. They are read strictly on purpose: the
  /// write endpoint requires both, so a row that arrives without one means the
  /// contract broke, and the load has to surface that instead of drawing a
  /// substitute location the customer never chose.
  factory SavedSchool.fromJson(Map<String, dynamic> json) {
    final timings = json['customDayTimings'];
    return SavedSchool(
      id: json['id'].toString(),
      name: json['name'] as String,
      address: json['address'] as String,
      latitude: (json['latitude'] as num).toDouble(),
      longitude: (json['longitude'] as num).toDouble(),
      photoUrl: json['photoUrl'] as String?,
      instructions: _blankToNull(json['instructions']),
      isFavorite: json['isFavorite'] == true,
      generalTimingSummary:
          json['generalTimingSummary'] as String? ?? 'Timings not set',
      customDayTimings: timings is List
          ? timings
              .whereType<Map<String, dynamic>>()
              .map(SchoolTimingDay.fromJson)
              .toList()
          : const <SchoolTimingDay>[],
    );
  }

  /// The `POST`/`PUT /api/schools` body. `name`, `address`, `latitude` and
  /// `longitude` are the four fields the route validates; the rest are stored as
  /// sent. No id is included — the server mints it and owns the row.
  Map<String, dynamic> toJson() => <String, dynamic>{
        'name': name,
        'address': address,
        'latitude': latitude,
        'longitude': longitude,
        if (photoUrl != null) 'photoUrl': photoUrl,
        'instructions': instructions ?? '',
        'isFavorite': isFavorite,
        'generalTimingSummary': generalTimingSummary,
        'customDayTimings': customDayTimings.map((d) => d.toJson()).toList(),
      };
}
