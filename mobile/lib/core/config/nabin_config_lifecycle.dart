import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'nabin_config_controller.dart';

/// Keeps the painted configuration honest about time.
///
/// A phone that slept through a service pause — or through an operator pushing a
/// new theme — must not keep selling what the server stopped, so the config is
/// re-read when the app comes back to the foreground.
class NabinConfigLifecycle extends ConsumerStatefulWidget {
  const NabinConfigLifecycle({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<NabinConfigLifecycle> createState() => _NabinConfigLifecycleState();
}

class _NabinConfigLifecycleState extends ConsumerState<NabinConfigLifecycle>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      ref.read(nabinConfigProvider.notifier).refresh();
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
