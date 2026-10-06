/// Which environment this *build* was made for, and what it is therefore allowed to do.
///
/// NABIN ships two backends: a development/testing one and a production one, each with
/// its own Supabase project. The Flutter apps never hold a Supabase credential — they
/// talk REST and WebSocket to the Node backend — so the whole of the isolation question
/// on this side is *which backend host a build may talk to*, and whether a build made
/// for testing can accidentally be handed to a real user.
///
/// So the environment is declared at build time and checked against the host:
///
///   flutter build apk --dart-define=NABIN_ENV=production \
///     --dart-define=NABIN_API_URL=https://api.nabin.in/api \
///     --dart-define=NABIN_WS_URL=wss://api.nabin.in
///
/// A release build that omits NABIN_ENV is refused rather than assumed, because the
/// assumption that gets made by default is the one that ships test data to real users.
/// Debug builds stay permissive: a developer on `flutter run` against a local server has
/// no environment to declare.
class NabinBuildEnv {
  NabinBuildEnv._();

  static const String _declared = String.fromEnvironment('NABIN_ENV');

  /// True for `dart --release`, i.e. a build a real user could install.
  static const bool isRelease = bool.fromEnvironment('dart.vm.product');

  static const String development = 'development';
  static const String testing = 'testing';
  static const String production = 'production';

  /// The declared environment, or an empty string when a debug build did not declare one.
  static String get name => _declared;

  static bool get isProduction => _declared == production;

  /// Demo affordances — prefilled test phone numbers, "use 123456 for demo" hints —
  /// belong to a build that is not addressed at a real user.
  static bool get allowsDemoConvenience => !isProduction;

  static const List<String> _productionHosts = ['api.nabin.in', 'nabin-backend-prod.onrender.com'];
  static const List<String> _testingHosts = [
    'api-beta.nabin.in',
    'nabin-beta-api.onrender.com',
  ];
  static final RegExp _loopback = RegExp(
    r'^(?:localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.0\.2\.2|::1|0\.0\.0\.0'
    r'|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d+)?$',
  );

  static String hostOf(String url) {
    final uri = Uri.tryParse(url);
    return (uri == null ? '' : uri.host).toLowerCase();
  }

  /// A production build talking to anything but the production API is the accident this
  /// file exists to prevent, so it is a hard stop rather than a warning. A testing build
  /// talking to production is the same accident wearing a different name.
  static String? mismatch(String url, {required String variable}) {
    final host = hostOf(url);
    if (host.isEmpty) return '$variable="$url" is not a usable URL.';

    // Real users' traffic must not ride in the clear.
    if (isProduction && !url.startsWith('https://') && !url.startsWith('wss://')) {
      return '$variable is not served over TLS, but this build declares NABIN_ENV=production.';
    }
    if (isProduction && !_productionHosts.contains(host)) {
      return 'This build declares NABIN_ENV=production but $variable points at $host, '
          'which is not the production API (${_productionHosts.join(', ')}).';
    }
    if (_declared == testing && !_testingHosts.contains(host) && !_isLocalHost(host)) {
      return 'This build declares NABIN_ENV=testing but $variable points at $host, which is '
          'neither the testing API (${_testingHosts.join(', ')}) nor a local server. Naming the '
          'production host here would let a test build read real users\' data.';
    }
    if (!isRelease && _declared.isEmpty) {
      // Debug with no declaration: anything goes, that is what a debug build is for.
      return null;
    }
    if (_declared == development && !_isLocalHost(host)) {
      return 'This build declares NABIN_ENV=development but $variable points at the remote '
          'host $host. Declare testing or production instead.';
    }
    return null;
  }

  static bool _isLocalHost(String host) =>
      _loopback.hasMatch(host) || host == 'host.docker.internal';

  /// Called by the API and WebSocket seams. Throws with the exact flag to set, because
  /// the most likely cause is a build command that left NABIN_ENV out.
  static void validate(String url, {required String variable}) {
    if (isRelease && _declared.isEmpty) {
      throw StateError(
        'NABIN_ENV must be declared for release builds '
        '(--dart-define=NABIN_ENV=production, testing, or development).',
      );
    }
    final problem = mismatch(url, variable: variable);
    if (problem != null) throw StateError(problem);
  }
}
