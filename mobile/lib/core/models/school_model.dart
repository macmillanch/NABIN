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
}
