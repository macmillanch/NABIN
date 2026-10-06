import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/core/models/child_model.dart';
import 'package:mobile/core/models/school_child_repository.dart';
import 'package:mobile/core/models/school_model.dart';

import 'support/http_stub.dart';

// `SchoolChildRepository` used to be an in-memory list seeded with a sample child and
// two schools whose `latitude`/`longitude` were Delhi numbers wearing Aizawl names
// (28.6139/77.2090 for "BCM Aizawl", 28.5921/77.2325 for "Delhi Public Aizawl"). Every
// Save and Delete in Profile mutated that process copy while
// `GET/POST/PUT/DELETE /api/schools` and `/api/children` — real authenticated CRUD that
// mints the id and enforces the owner — sat unused. A parent could delete a child, see
// it back after a reboot, and book a school ride whose drop was 1,400 km from the school
// they named.
//
// These tests hold the repository to the wire: what it asks NABIN to store is the place
// the customer chose, the row it shows afterwards is the one the server returned rather
// than the draft it sent, and nothing is believed until the request appears in
// `stubSeen`.

/// The pair the old seeds carried, and the pair `POST /api/customer/book-ride`
/// substitutes when a booking arrives without a coordinate.
const double _delhiLat = 28.6853;
const double _delhiLng = 77.2185;

/// Aizawl — where NABIN actually runs.
const double _aizawlLat = 23.3595;
const double _aizawlLng = 92.9376;

final Map<String, Map<String, dynamic>> _schoolRows = <String, Map<String, dynamic>>{};
final Map<String, Map<String, dynamic>> _childRows = <String, Map<String, dynamic>>{};

int _schoolMinted = 0;
int _childMinted = 0;
bool _rejectWrites = false;
String? _rejectPath;

/// Installs the fake `/api/schools` + `/api/children` CRUD handler.
///
/// Clears the request log (and, with [clearRows], the stored rows) first, so a test can
/// call it again mid-way to read only the requests its next tap made while the platform
/// keeps the rows it already accepted — the way a second visit to Profile does not empty
/// the account.
void serve({bool clearRows = false, bool rejectWrites = false, String? onlyPath}) {
  stubReset();
  if (clearRows) {
    _schoolRows.clear();
    _childRows.clear();
    _schoolMinted = 0;
    _childMinted = 0;
  }
  _rejectWrites = rejectWrites;
  _rejectPath = onlyPath;

  stubHandler = (method, url, body) {
    final String path = url.path;
    final int schoolAt = path.indexOf('/schools');
    final int childAt = path.indexOf('/children');
    if (schoolAt < 0 && childAt < 0) return (404, '{"success":false,"error":"no route"}');

    final bool isSchool = schoolAt >= 0;
    final Map<String, Map<String, dynamic>> rows = isSchool ? _schoolRows : _childRows;
    final String relative = path.substring(isSchool ? schoolAt : childAt);
    final String collection = isSchool ? '/schools' : '/children';
    final String rowKey = isSchool ? 'school' : 'child';
    final String listKey = isSchool ? 'schools' : 'children';

    if (method == 'GET') {
      return (200, jsonEncode(<String, dynamic>{
        'success': true,
        listKey: rows.values.toList(),
      }));
    }
    if (_rejectWrites && (_rejectPath == null || relative == _rejectPath)) {
      return (400, jsonEncode(<String, dynamic>{
        'success': false,
        'error': isSchool
            ? 'Pick the school on the map before saving it.'
            : 'Pick the pickup place on the map before saving the child.',
      }));
    }

    final Map<String, dynamic> sent = body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(body) as Map<String, dynamic>;
    // The server owns the id: POST mints one, PUT keeps the row under the id in the
    // path. So the repository can never be asserting on a name it gave itself.
    // Two counters, one per collection — a shared one would hand the child the id the
    // school took first, and a delete-by-id test would pass on the wrong row.
    final String id = method == 'POST'
        ? (isSchool ? 'sch_${++_schoolMinted}' : 'chd_${++_childMinted}')
        : relative.substring(collection.length + 1);

    if (method == 'DELETE') {
      rows.remove(id);
      return (200, jsonEncode(<String, dynamic>{'success': true}));
    }

    final Map<String, dynamic> stored = <String, dynamic>{...sent, 'id': id};
    rows[id] = stored;
    return (200, jsonEncode(<String, dynamic>{
      'success': true,
      rowKey: stored,
    }));
  };
}

SavedSchool _schoolDraft({
  String id = '',
  double lat = _aizawlLat,
  double lng = _aizawlLng,
}) {
  return SavedSchool(
    id: id,
    name: 'St. Paul School',
    address: 'Fatehape, Aizawl',
    latitude: lat,
    longitude: lng,
    customDayTimings: SavedSchool.defaultWeeklySchedule(),
  );
}

SavedChild _childDraft({
  String id = '',
  double lat = _aizawlLat,
  double lng = _aizawlLng,
  String? schoolId,
  String? schoolName,
}) {
  return SavedChild(
    id: id,
    fullName: 'Lianzuali Ralte',
    schoolId: schoolId,
    schoolName: schoolName,
    gradeClass: 'Class 3',
    guardianName: 'Vanlalzama Ralte',
    guardianPhone: '+91 94361 77889',
    defaultPickupAddress: 'Serkawn, Aizawl',
    pickupLat: lat,
    pickupLng: lng,
  );
}

Map<String, dynamic> _bodyFor(String method, String pathFragment) {
  final String? raw = stubBodyFor(method, pathFragment);
  expect(raw, isNotNull, reason: 'no $method request reached $pathFragment');
  return jsonDecode(raw!) as Map<String, dynamic>;
}

void main() {
  late SchoolChildRepository repo;

  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    repo = SchoolChildRepository.instance;
    // A singleton across tests: the rows one test wrote must not satisfy the next.
    repo.clear();
    serve(clearRows: true);
  });

  tearDown(() {
    HttpOverrides.global = null;
    repo.clear();
  });

  group('reads go to NABIN', () {
    test('load() fetches both collections and shows the server rows', () async {
      _schoolRows['sch_seed'] = <String, dynamic>{
        'id': 'sch_seed',
        'name': 'Modern English School',
        'address': 'Bethalen, Aizawl',
        'latitude': 23.7080,
        'longitude': 92.7270,
        'isFavorite': true,
        'generalTimingSummary': '8:00 AM – 2:00 PM • Mon–Fri',
        'customDayTimings': <dynamic>[],
      };
      _childRows['chd_seed'] = <String, dynamic>{
        'id': 'chd_seed',
        'fullName': 'Zoramthanga',
        'gradeClass': 'Class 6',
        'guardianName': 'Laltluanga',
        'guardianPhone': '+91 94360 00000',
        'defaultPickupAddress': 'Tuikuan, Aizawl',
        'pickupLat': 23.3500,
        'pickupLng': 92.9300,
      };

      await repo.load();

      expect(stubSaw('GET', '/schools'), isTrue,
          reason: 'the school list is a read, not a local seed');
      expect(stubSaw('GET', '/children'), isTrue);
      expect(repo.status, SchoolChildLoadStatus.ready);
      expect(repo.schools.single.name, 'Modern English School');
      expect(repo.children.single.fullName, 'Zoramthanga');
      expect(repo.schoolFor(repo.children.single), isNull,
          reason: 'a child with no schoolId is not quietly tied to some other school');
    });

    test('a child row is joined to the school row it names', () async {
      _schoolRows['sch_seed'] = <String, dynamic>{
        'id': 'sch_seed',
        'name': 'Modern English School',
        'address': 'Bethalen, Aizawl',
        'latitude': 23.7080,
        'longitude': 92.7270,
        'isFavorite': false,
        'generalTimingSummary': '8:00 AM – 2:00 PM',
        'customDayTimings': <dynamic>[],
      };
      _childRows['chd_seed'] = <String, dynamic>{
        'id': 'chd_seed',
        'fullName': 'Zoramthanga',
        'schoolId': 'sch_seed',
        'schoolName': 'Modern English School',
        'gradeClass': 'Class 6',
        'guardianName': 'Laltluanga',
        'guardianPhone': '+91 94360 00000',
        'defaultPickupAddress': 'Tuikuan, Aizawl',
        'pickupLat': 23.3500,
        'pickupLng': 92.9300,
      };

      await repo.load();

      // The child row stores no school address or coordinate — those live on the
      // school row, which is where the ride screen gets its drop from.
      expect(repo.schoolFor(repo.children.single)?.latitude, 23.7080);
    });

    test('an unloaded repository holds nothing, so no sample child can appear', () async {
      expect(repo.children, isEmpty);
      expect(repo.schools, isEmpty);
      expect(stubSeen, isEmpty, reason: 'an empty repository has earned nothing');
    });

    test('a failed read is reported as failed instead of falling back to seeds', () async {
      stubHandler = (method, url, body) => (500, '{"success":false,"error":"db down"}');
      await repo.load(force: true);

      expect(repo.status, SchoolChildLoadStatus.failed);
      expect(repo.schools, isEmpty);
      expect(repo.children, isEmpty);
    });

    test('a row this app cannot read fails the load rather than inventing one', () async {
      _schoolRows['sch_bad'] = <String, dynamic>{
        'id': 'sch_bad',
        'name': 'No Coordinates School',
        'address': 'Nowhere',
        // latitude/longitude absent: the write route requires both, so a row without
        // them means the contract broke upstream. The load has to say so.
      };
      await repo.load(force: true);

      expect(repo.status, SchoolChildLoadStatus.failed);
      expect(repo.error, contains('cannot read'));
      expect(repo.schools, isEmpty);
    });
  });

  group('writes go to NABIN', () {
    test('a new school is POSTed with the customer place and the server mints the id', () async {
      expect(await repo.saveSchool(_schoolDraft()), isNull);

      expect(stubSaw('POST', '/schools'), isTrue);
      final Map<String, dynamic> sent = _bodyFor('POST', '/schools');
      expect(sent['latitude'], _aizawlLat);
      expect(sent['longitude'], _aizawlLng);
      expect(sent['name'], 'St. Paul School');
      expect(sent.containsKey('id'), isFalse,
          reason: 'the client does not name the row it is asking to create');

      expect(repo.schools.single.id, 'sch_1',
          reason: 'the row is the one the platform returned, not the draft');
      expect(repo.schools.single.latitude, _aizawlLat);
    });

    test('an existing school is PUT to its own path, not appended to a local list', () async {
      await repo.saveSchool(_schoolDraft());
      serve();

      expect(await repo.saveSchool(_schoolDraft(id: 'sch_1', lat: 23.3621, lng: 92.9312)),
          isNull);

      expect(stubSaw('PUT', '/schools/sch_1'), isTrue);
      expect(stubSaw('POST', '/schools'), isFalse);
      expect(_bodyFor('PUT', '/schools/sch_1')['latitude'], 23.3621);
      expect(repo.schools.single.latitude, 23.3621);
      expect(repo.schools, hasLength(1));
    });

    test('a new child is POSTed with the pickup pin the customer placed', () async {
      expect(await repo.saveChild(_childDraft()), isNull);

      expect(stubSaw('POST', '/children'), isTrue);
      final Map<String, dynamic> sent = _bodyFor('POST', '/children');
      expect(sent['pickupLat'], _aizawlLat);
      expect(sent['pickupLng'], _aizawlLng);
      expect(sent['fullName'], 'Lianzuali Ralte');
      expect(repo.children.single.id, 'chd_1');
      expect(repo.children.single.pickupLat, _aizawlLat);
    });

    test('the favourite flag is a write, so it survives the next read', () async {
      await repo.saveSchool(_schoolDraft());
      serve();

      expect(await repo.toggleFavoriteSchool('sch_1'), isNull);
      expect(stubSaw('PUT', '/schools/sch_1'), isTrue,
          reason: 'an offline toggle would be lost on the next load');
      expect(_bodyFor('PUT', '/schools/sch_1')['isFavorite'], isTrue);
      expect(repo.schools.single.isFavorite, isTrue);
    });

    test('a delete is a DELETE on the row path and drops the row when accepted', () async {
      await repo.saveSchool(_schoolDraft());
      await repo.saveChild(_childDraft());
      serve();

      expect(await repo.removeSchool('sch_1'), isNull);
      expect(stubSaw('DELETE', '/schools/sch_1'), isTrue);
      expect(repo.schools, isEmpty);

      expect(await repo.removeChild('chd_1'), isNull);
      expect(stubSaw('DELETE', '/children/chd_1'), isTrue);
      expect(repo.children, isEmpty);
    });

    test('a rejected write shows the platform message and stores nothing', () async {
      serve(rejectWrites: true, onlyPath: '/children');

      final String? error = await repo.saveChild(_childDraft());

      expect(error, contains('Pick the pickup place on the map'));
      expect(repo.children, isEmpty,
          reason: 'the platform refused the row; the app must not keep it anyway');
    });

    test('no request or row ever carries the Delhi coordinates the old seeds had', () async {
      await repo.saveSchool(_schoolDraft());
      await repo.saveChild(_childDraft(schoolId: 'sch_1', schoolName: 'St. Paul School'));
      await repo.load(force: true);

      expect(stubBodies.join('|').contains('28.6'), isFalse);
      expect(stubBodies.join('|').contains('77.2'), isFalse);
      for (final SavedSchool school in repo.schools) {
        expect(school.latitude, isNot(_delhiLat));
        expect(school.longitude, isNot(_delhiLng));
      }
      for (final SavedChild child in repo.children) {
        expect(child.pickupLat, isNot(_delhiLat));
        expect(child.pickupLng, isNot(_delhiLng));
      }
    });
  });

  group('session boundaries', () {
    test('clear() drops every row so the next customer inherits nothing', () async {
      await repo.saveSchool(_schoolDraft());
      await repo.saveChild(_childDraft());
      expect(repo.schools, hasLength(1));

      repo.clear();

      expect(repo.schools, isEmpty);
      expect(repo.children, isEmpty);
      expect(repo.status, SchoolChildLoadStatus.idle);
    });

    test('a load that finishes after clear() is discarded, not stamped back in', () async {
      final Future<void> pending = repo.load(force: true);
      repo.clear();
      await pending;

      expect(repo.schools, isEmpty);
      expect(repo.children, isEmpty);
    });
  });
}
