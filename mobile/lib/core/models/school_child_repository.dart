import 'package:flutter/foundation.dart';
import 'school_model.dart';
import 'child_model.dart';

class SchoolChildRepository extends ChangeNotifier {
  static final SchoolChildRepository instance = SchoolChildRepository._internal();

  SchoolChildRepository._internal() {
    _initSeeds();
  }

  final List<SavedSchool> _schools = [];
  final List<SavedChild> _children = [];

  List<SavedSchool> get schools => List.unmodifiable(_schools);
  List<SavedChild> get children => List.unmodifiable(_children);

  void _initSeeds() {
    // Seed Sample Schools
    _schools.addAll([
      SavedSchool(
        id: 'sch_1',
        name: 'ABC Public School',
        address: 'Kamalanagar, Main Road',
        latitude: 28.6912,
        longitude: 77.2114,
        isFavorite: true,
        generalTimingSummary: '8:30 AM – 2:30 PM • Mon–Fri',
        instructions: 'Gate 2 pickup zone near security guard cabin',
        customDayTimings: [
          const SchoolTimingDay(dayName: 'Monday', isOpen: true, startTime: '08:30 AM', endTime: '02:30 PM'),
          const SchoolTimingDay(dayName: 'Tuesday', isOpen: true, startTime: '08:30 AM', endTime: '02:30 PM'),
          const SchoolTimingDay(dayName: 'Wednesday', isOpen: true, startTime: '08:30 AM', endTime: '02:30 PM'),
          const SchoolTimingDay(dayName: 'Thursday', isOpen: true, startTime: '08:30 AM', endTime: '02:30 PM'),
          const SchoolTimingDay(dayName: 'Friday', isOpen: true, startTime: '08:30 AM', endTime: '02:30 PM'),
          const SchoolTimingDay(dayName: 'Saturday', isOpen: true, startTime: '08:30 AM', endTime: '12:30 PM'),
          const SchoolTimingDay(dayName: 'Sunday', isOpen: false, startTime: '', endTime: ''),
        ],
      ),
      SavedSchool(
        id: 'sch_2',
        name: 'Government High School',
        address: 'Chawngte, Sector 4',
        latitude: 28.6740,
        longitude: 77.2280,
        isFavorite: false,
        generalTimingSummary: '9:00 AM – 3:00 PM • Mon–Fri',
        instructions: 'Main school bus turnaround area',
        customDayTimings: [
          const SchoolTimingDay(dayName: 'Monday', isOpen: true, startTime: '09:00 AM', endTime: '03:00 PM'),
          const SchoolTimingDay(dayName: 'Tuesday', isOpen: true, startTime: '09:00 AM', endTime: '03:00 PM'),
          const SchoolTimingDay(dayName: 'Wednesday', isOpen: true, startTime: '09:00 AM', endTime: '03:00 PM'),
          const SchoolTimingDay(dayName: 'Thursday', isOpen: true, startTime: '09:00 AM', endTime: '03:00 PM'),
          const SchoolTimingDay(dayName: 'Friday', isOpen: true, startTime: '09:00 AM', endTime: '03:00 PM'),
          const SchoolTimingDay(dayName: 'Saturday', isOpen: false, startTime: '', endTime: ''),
          const SchoolTimingDay(dayName: 'Sunday', isOpen: false, startTime: '', endTime: ''),
        ],
      ),
    ]);

    // Seed Sample Child Profile
    _children.addAll([
      const SavedChild(
        id: 'ch_1',
        fullName: 'Rahul Chakma',
        photoUrl: 'https://images.unsplash.com/photo-1543332164-6e82f355badc?w=200',
        schoolId: 'sch_1',
        schoolName: 'ABC Public School',
        schoolAddress: 'Kamalanagar, Main Road',
        schoolLat: 28.6912,
        schoolLng: 77.2114,
        gradeClass: 'Class 5',
        section: 'Section B',
        guardianName: 'Rahul Sharma (Father)',
        guardianPhone: '+91 98765 43210',
        defaultPickupAddress: 'Flat 402, Civil Lines, Delhi',
        pickupLat: 28.6853,
        pickupLng: 77.2185,
        specialInstructions: 'Please wait until security officer walks him to vehicle.',
      ),
    ]);
  }

  // School CRUD
  void addSchool(SavedSchool school) {
    _schools.add(school);
    notifyListeners();
  }

  void updateSchool(SavedSchool school) {
    final idx = _schools.indexWhere((s) => s.id == school.id);
    if (idx != -1) {
      _schools[idx] = school;
      notifyListeners();
    }
  }

  void deleteSchool(String schoolId) {
    _schools.removeWhere((s) => s.id == schoolId);
    notifyListeners();
  }

  void toggleFavoriteSchool(String schoolId) {
    final idx = _schools.indexWhere((s) => s.id == schoolId);
    if (idx != -1) {
      final s = _schools[idx];
      _schools[idx] = s.copyWith(isFavorite: !s.isFavorite);
      notifyListeners();
    }
  }

  // Child CRUD
  void addChild(SavedChild child) {
    _children.add(child);
    notifyListeners();
  }

  void updateChild(SavedChild child) {
    final idx = _children.indexWhere((c) => c.id == child.id);
    if (idx != -1) {
      _children[idx] = child;
      notifyListeners();
    }
  }

  void deleteChild(String childId) {
    _children.removeWhere((c) => c.id == childId);
    notifyListeners();
  }
}
