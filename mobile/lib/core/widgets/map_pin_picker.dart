import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../theme/app_theme.dart';

/// The shape [MapPinPickerSheet.show] has, declared so a booking screen can take
/// it as an injected dependency. A test that holds this can place a point without
/// rendering the tile-backed map, which is the only way its placement gate — an
/// unplaced end is not bookable, and a placed one travels as the exact coordinate
/// it was placed at — becomes a measurable claim rather than a reviewed one.
typedef PlacePinPicker = Future<LatLng?> Function(
  BuildContext context, {
  LatLng? initial,
  required String title,
  required String hint,
});

/// Tap-to-place map picker used by the saved-school and saved-child forms.
///
/// `POST /api/schools` and `/api/children` both require numeric latitude and
/// longitude, and the platform has no geocoder — so a form that only collected an
/// address text had nothing honest to send. Before this sheet the Profile forms
/// filled in Delhi coordinates for a school typed in Aizawl, which is the kind of
/// value that ends up driving a ride to the wrong city.
///
/// The point the customer places is the point returned. Nothing is guessed: until
/// one is placed, the confirm button does nothing and the sheet says so.
class MapPinPickerSheet extends StatefulWidget {
  const MapPinPickerSheet({
    super.key,
    this.initial,
    required this.title,
    required this.hint,
  });

  final LatLng? initial;
  final String title;
  final String hint;

  static Future<LatLng?> show(
    BuildContext context, {
    LatLng? initial,
    required String title,
    required String hint,
  }) {
    return showModalBottomSheet<LatLng>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => MapPinPickerSheet(
        initial: initial,
        title: title,
        hint: hint,
      ),
    );
  }

  @override
  State<MapPinPickerSheet> createState() => _MapPinPickerSheetState();
}

class _MapPinPickerSheetState extends State<MapPinPickerSheet> {
  // The city NABIN operates in; only a viewport default, never a stored location.
  static const LatLng _aizawl = LatLng(23.3595, 92.9376);

  late LatLng? _point = widget.initial;
  late final MapController _controller = MapController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _choose(LatLng point) {
    setState(() => _point = point);
  }

  @override
  Widget build(BuildContext context) {
    final point = _point;
    return Padding(
      padding: const EdgeInsets.fromLTRB(0, 0, 0, 8),
      child: DraggableScrollableSheet(
        initialChildSize: 0.86,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        builder: (context, scrollController) => Container(
          decoration: const BoxDecoration(
            color: AppTheme.surfaceContainerLowest,
            borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
          ),
          child: SingleChildScrollView(
            controller: scrollController,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(widget.title,
                        style: const TextStyle(
                            fontWeight: FontWeight.w900,
                            fontSize: 17,
                            color: AppTheme.onSurface)),
                    const SizedBox(height: 4),
                    Text(widget.hint,
                        style: const TextStyle(
                            fontSize: 12,
                            color: AppTheme.onSurfaceVariant,
                            height: 1.35)),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                height: 300,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(18),
                    child: FlutterMap(
                      mapController: _controller,
                      options: MapOptions(
                        initialCenter: point ?? _aizawl,
                        initialZoom: 14.0,
                        minZoom: 4.0,
                        maxZoom: 18.0,
                        onTap: (_, point) => _choose(point),
                        interactionOptions: const InteractionOptions(
                          flags: InteractiveFlag.drag |
                              InteractiveFlag.flingAnimation |
                              InteractiveFlag.pinchZoom |
                              InteractiveFlag.doubleTapZoom,
                        ),
                      ),
                      children: [
                        TileLayer(
                          urlTemplate:
                              'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
                          subdomains: const ['a', 'b', 'c', 'd'],
                          fallbackUrl:
                              'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                          userAgentPackageName: 'com.nabin.mobile',
                          maxZoom: 20,
                        ),
                        if (point != null)
                          MarkerLayer(
                            markers: [
                              Marker(
                                point: point,
                                width: 48,
                                height: 48,
                                child: const Icon(Icons.location_pin,
                                    color: AppTheme.error, size: 40),
                              ),
                            ],
                          ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Text(
                  point == null
                      ? 'No place chosen yet.'
                      : 'Chosen: ${point.latitude.toStringAsFixed(5)}, '
                          '${point.longitude.toStringAsFixed(5)}',
                  style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: AppTheme.onSurface),
                ),
              ),
              const SizedBox(height: 16),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: ElevatedButton(
                  onPressed: point == null ? null : () => context.pop(point),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primaryContainer,
                    foregroundColor: Colors.white,
                    disabledBackgroundColor: AppTheme.surfaceContainerHigh,
                    disabledForegroundColor: AppTheme.onSurfaceVariant,
                    minimumSize: const Size(double.infinity, 52),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16)),
                  ),
                  child: Text(point == null
                      ? 'Tap the map to place the pin'
                      : 'Use this place'),
                ),
              ),
            ],
          ),
          ),
        ),
      ),
    );
  }
}
