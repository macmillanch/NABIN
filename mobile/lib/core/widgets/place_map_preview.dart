import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

/// The map behind a booking: the places the customer actually placed, painted at
/// the coordinates they were placed at.
///
/// The Driver app's `DriverMapView` used to sit here, and it draws a route through
/// Delhi between two pins hard-coded to Delhi coordinates, with a fleet of eight
/// invented drivers scattered around Civil Lines. Whatever Aizawl place was chosen,
/// the map said Delhi. That is a claim about the world the platform cannot support,
/// so the Customer booking screen no longer uses it.
///
/// Deliberately missing, because nothing here can source them: a route line (NABIN
/// has no road geometry, only the two ends of the trip), and nearby vehicles (there
/// is no fleet read for a customer to see).
class PlaceMapPreview extends StatefulWidget {
  const PlaceMapPreview({
    super.key,
    this.pickup,
    this.drop,
    this.pickupLabel,
    this.dropLabel,
  });

  final LatLng? pickup;
  final LatLng? drop;

  /// The words the customer typed or the saved place they picked. A label with no
  /// point is not drawn — an address this app cannot place is not a location.
  final String? pickupLabel;
  final String? dropLabel;

  @override
  State<PlaceMapPreview> createState() => _PlaceMapPreviewState();
}

class _PlaceMapPreviewState extends State<PlaceMapPreview> {
  // The city NABIN operates in. Only a viewport for a ride that has no place on it
  // yet; never a location that gets stored or sent anywhere.
  static const LatLng _aizawl = LatLng(23.3595, 92.9376);

  final MapController _controller = MapController();

  LatLng get _center {
    final pickup = widget.pickup;
    final drop = widget.drop;
    if (pickup != null && drop != null) {
      return LatLng(
        (pickup.latitude + drop.latitude) / 2,
        (pickup.longitude + drop.longitude) / 2,
      );
    }
    return pickup ?? drop ?? _aizawl;
  }

  double get _zoom =>
      (widget.pickup != null && widget.drop != null) ? 12.8 : 14.0;

  @override
  void didUpdateWidget(PlaceMapPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.pickup != widget.pickup || oldWidget.drop != widget.drop) {
      _controller.move(_center, _zoom);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pickup = widget.pickup;
    final drop = widget.drop;
    return FlutterMap(
      mapController: _controller,
      options: MapOptions(
        initialCenter: _center,
        initialZoom: _zoom,
        minZoom: 4.0,
        maxZoom: 18.0,
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
          fallbackUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          userAgentPackageName: 'com.nabin.mobile',
          maxZoom: 20,
        ),
        MarkerLayer(
          markers: [
            if (pickup != null)
              Marker(
                point: pickup,
                width: 168,
                height: 72,
                alignment: Alignment.topCenter,
                child: _Pin(
                  color: const Color(0xFF00A859),
                  icon: Icons.my_location_rounded,
                  label: widget.pickupLabel,
                ),
              ),
            if (drop != null)
              Marker(
                point: drop,
                width: 168,
                height: 72,
                alignment: Alignment.topCenter,
                child: _Pin(
                  color: const Color(0xFFE8590C),
                  icon: Icons.location_on_rounded,
                  label: widget.dropLabel,
                ),
              ),
          ],
        ),
      ],
    );
  }
}

/// The label and the pin together need the marker's full 72 px, and `topCenter`
/// puts the marker's bottom edge on the coordinate — so the column packs downward
/// and the pin's tip is the thing that touches the place, with the label floating
/// above it. A `start` alignment would leave the tip short of the point.
class _Pin extends StatelessWidget {
  const _Pin({required this.color, required this.icon, this.label});

  final Color color;
  final IconData icon;
  final String? label;

  @override
  Widget build(BuildContext context) {
    final text = label?.trim() ?? '';
    return Column(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        if (text.isNotEmpty)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.94),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: color, width: 1.2),
              boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 6)],
            ),
            child: Text(
              text,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 10.5,
                height: 1.25,
                fontWeight: FontWeight.w800,
                color: Color(0xFF16233A),
              ),
            ),
          ),
        const SizedBox(height: 2),
        Icon(Icons.push_pin_rounded, color: color, size: 30),
      ],
    );
  }
}
