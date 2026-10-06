import 'package:flutter/foundation.dart';
import '../network/nabin_api_service.dart';
import 'school_model.dart';
import 'child_model.dart';

enum SchoolChildLoadStatus { idle, loading, ready, failed }

/// Saved schools and saved children, read from and written to the platform.
///
/// This used to be an in-memory list seeded with one sample child and two
/// schools whose lat/long were Delhi coordinates labelled with Aizawl names, and
/// every "Save" in Profile only mutated this process. The backend has real
/// authenticated CRUD for both (`GET/POST/PUT/DELETE /api/schools`,
/// `/api/children`), so nothing is stored here that the server did not return.
class SchoolChildRepository extends ChangeNotifier {
  static final SchoolChildRepository instance = SchoolChildRepository._internal();

  SchoolChildRepository._internal();

  List<SavedSchool> _schools = <SavedSchool>[];
  List<SavedChild> _children = <SavedChild>[];
  SchoolChildLoadStatus _status = SchoolChildLoadStatus.idle;
  String? _error;
  int _loadToken = 0;

  List<SavedSchool> get schools => List.unmodifiable(_schools);
  List<SavedChild> get children => List.unmodifiable(_children);
  SchoolChildLoadStatus get status => _status;
  String? get error => _error;

  bool get isLoading => _status == SchoolChildLoadStatus.loading;

  /// The school a child is tied to, or null when the child has no saved school.
  /// The child row stores only `schoolId`/`schoolName`, so the address and the
  /// coordinates always come from the school row it belongs to.
  SavedSchool? schoolFor(SavedChild child) {
    final id = child.schoolId;
    if (id == null) return null;
    for (final school in _schools) {
      if (school.id == id) return school;
    }
    return null;
  }

  SavedSchool? schoolById(String? id) {
    if (id == null) return null;
    for (final school in _schools) {
      if (school.id == id) return school;
    }
    return null;
  }

  /// Reads both lists from the platform. Called on the screens that show them;
  /// a second call while one is in flight is ignored so a rebuild cannot stamp
  /// duplicate requests.
  Future<void> load({bool force = false}) async {
    if (!force &&
        (_status == SchoolChildLoadStatus.loading ||
            _status == SchoolChildLoadStatus.ready)) {
      return;
    }
    final token = ++_loadToken;
    _status = SchoolChildLoadStatus.loading;
    _error = null;
    notifyListeners();

    final results = await Future.wait(<Future<Map<String, dynamic>?>>[
      NabinApiService.getSavedSchools(),
      NabinApiService.getSavedChildren(),
    ]);

    // A newer load (or a logout) already replaced this one.
    if (token != _loadToken) return;

    final schoolsRes = results[0];
    final childrenRes = results[1];

    if (schoolsRes?['success'] != true || childrenRes?['success'] != true) {
      _status = SchoolChildLoadStatus.failed;
      _error = schoolsRes?['error']?.toString() ??
          childrenRes?['error']?.toString() ??
          'Could not reach NABIN.';
      notifyListeners();
      return;
    }

    try {
      _schools = _rows(schoolsRes?['schools']).map(SavedSchool.fromJson).toList();
      _children = _rows(childrenRes?['children']).map(SavedChild.fromJson).toList();
    } catch (_) {
      // A row that does not match the contract is reported, not skied over with
      // a made-up value. `Object` rather than `Exception` on purpose: the models
      // read their coordinates with `as num`, and a missing column throws a
      // TypeError, which is an Error — so the narrow catch let a malformed row
      // escape into the calling screen instead of reaching this failure state.
      _status = SchoolChildLoadStatus.failed;
      _error = 'NABIN returned a saved school or child this app cannot read.';
      notifyListeners();
      return;
    }

    _status = SchoolChildLoadStatus.ready;
    _error = null;
    notifyListeners();
  }

  List<Map<String, dynamic>> _rows(Object? raw) => raw is List
      ? raw.whereType<Map<String, dynamic>>().toList()
      : const <Map<String, dynamic>>[];

  /// Writes a school. A draft with an empty id is created; anything else updates
  /// that row. Returns null on success, or the message to show the customer —
  /// including when the platform refused the write.
  Future<String?> saveSchool(SavedSchool draft) async {
    final res = draft.id.isEmpty
        ? await NabinApiService.createSavedSchool(draft.toJson())
        : await NabinApiService.updateSavedSchool(draft.id, draft.toJson());

    if (res?['success'] != true || res?['school'] is! Map<String, dynamic>) {
      return _failure(res, 'NABIN did not save the school.');
    }
    final saved = SavedSchool.fromJson(res!['school'] as Map<String, dynamic>);
    _schools = <SavedSchool>[
      for (final s in _schools)
        if (s.id == saved.id) saved else s,
      if (!_schools.any((s) => s.id == saved.id)) saved,
    ];
    notifyListeners();
    return null;
  }

  Future<String?> removeSchool(String schoolId) async {
    final res = await NabinApiService.deleteSavedSchool(schoolId);
    if (res?['success'] != true) {
      return _failure(res, 'NABIN did not remove the school.');
    }
    _schools = _schools.where((s) => s.id != schoolId).toList();
    notifyListeners();
    return null;
  }

  /// The favourite flag is a column on the school row, so toggling it is a write
  /// like any other — an offline toggle would be lost on the next read.
  Future<String?> toggleFavoriteSchool(String schoolId) async {
    final current = schoolById(schoolId);
    if (current == null) return 'That school is no longer in your list.';
    return saveSchool(current.copyWith(isFavorite: !current.isFavorite));
  }

  Future<String?> saveChild(SavedChild draft) async {
    final res = draft.id.isEmpty
        ? await NabinApiService.createSavedChild(draft.toJson())
        : await NabinApiService.updateSavedChild(draft.id, draft.toJson());

    if (res?['success'] != true || res?['child'] is! Map<String, dynamic>) {
      return _failure(res, 'NABIN did not save the child.');
    }
    final saved = SavedChild.fromJson(res!['child'] as Map<String, dynamic>);
    _children = <SavedChild>[
      for (final c in _children)
        if (c.id == saved.id) saved else c,
      if (!_children.any((c) => c.id == saved.id)) saved,
    ];
    notifyListeners();
    return null;
  }

  Future<String?> removeChild(String childId) async {
    final res = await NabinApiService.deleteSavedChild(childId);
    if (res?['success'] != true) {
      return _failure(res, 'NABIN did not remove the child.');
    }
    _children = _children.where((c) => c.id != childId).toList();
    notifyListeners();
    return null;
  }

  String? _failure(Map<String, dynamic>? res, String fallback) {
    final message = res?['error']?.toString();
    _error = message;
    return (message == null || message.isEmpty) ? fallback : message;
  }

  /// Called when the session ends: the next customer must not see this one's
  /// schools and children.
  void clear() {
    _loadToken++;
    _schools = <SavedSchool>[];
    _children = <SavedChild>[];
    _status = SchoolChildLoadStatus.idle;
    _error = null;
    notifyListeners();
  }
}
