import 'dart:convert';

import 'package:flutter/foundation.dart' show compute;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

import 'moremi_map_data.dart';
import 'moremi_svg_widgets.dart';
import 'park_labels_layer.dart';

class MapScreen extends StatefulWidget {
  final Function(LatLng)? onMapTap;
  final LatLng? selectedPoint;
  final bool embedded;
  final List<Marker> extraMarkers;
  final List<Polygon> extraPolygons;
  final MapController? mapController;
  final MoremiMapLayerVisibility layerVisibility;
  final void Function(List<String> accommodationSubtypes)? onAccommodationTypesReady;

  MapScreen({
    super.key,
    this.onMapTap,
    this.selectedPoint,
    this.embedded = false,
    this.extraMarkers = const [],
    this.extraPolygons = const [],
    this.mapController,
    MoremiMapLayerVisibility? layerVisibility,
    this.onAccommodationTypesReady,
  }) : layerVisibility = layerVisibility ?? MoremiMapLayerVisibility();

  @override
  State<MapScreen> createState() => _MapScreenState();
}

// Top-level functions required by compute() — must not be closures.
List<BotsRoadPolyline> _parseRoadsIsolate(String json) =>
    parseBotsRoads(jsonDecode(json) as Map<String, dynamic>);

List<NatParkRegion> _parseParksIsolate(String json) =>
    parseNatParks(jsonDecode(json) as Map<String, dynamic>);

List<BotsPoi> _parsePoisIsolate(String json) =>
    parseBotsPois(jsonDecode(json) as Map<String, dynamic>);

class _MapScreenState extends State<MapScreen> {
  late MapController _mapController;
  bool _ownMapController = false;
  List<BotsRoadPolyline> _roads = [];
  List<NatParkRegion> _natParks = [];
  List<BotsPoi> _pois = [];
  Position? _currentPosition;
  bool _isLoading = true;
  String? _errorMessage;
  double _zoom = 10.0;

  final LatLng _concessionCenter = const LatLng(-18.95, 23.7);
  final double _initialZoom = 10.0;

  @override
  void initState() {
    super.initState();
    if (widget.mapController != null) {
      _mapController = widget.mapController!;
    } else {
      _mapController = MapController();
      _ownMapController = true;
    }
    _zoom = _initialZoom;
    _loadMapData();
    _getCurrentLocation();
  }

  @override
  void dispose() {
    if (_ownMapController) {
      _mapController.dispose();
    }
    super.dispose();
  }

  Future<void> _loadMapData() async {
    // Show the map immediately; layers will appear as they finish loading.
    if (!mounted) return;
    setState(() {
      _isLoading = false;
      _errorMessage = null;
    });

    try {
      // Load and parse heavy GeoJSON off the main thread via compute().
      final roadsRaw = await rootBundle.loadString('assets/bots_roads.geojson');
      final parksRaw = await rootBundle.loadString('assets/nat_parks.geojson');

      final results = await Future.wait([
        compute(_parseRoadsIsolate, roadsRaw),
        compute(_parseParksIsolate, parksRaw),
      ]);

      if (!mounted) return;
      setState(() {
        _roads = results[0] as List<BotsRoadPolyline>;
        _natParks = results[1] as List<NatParkRegion>;
      });

      try {
        final poisRaw = await rootBundle.loadString('assets/bots_pois.geojson');
        final pois = await compute(_parsePoisIsolate, poisRaw);
        if (!mounted) return;
        setState(() => _pois = pois);
      } catch (_) {}

      final subtypes = accommodationSubtypesFromPois(_pois);
      widget.onAccommodationTypesReady?.call(subtypes);
    } catch (e) {
      if (!mounted) return;
      setState(() => _errorMessage = 'Failed to load map data: $e');
    }
  }

  Future<void> _getCurrentLocation() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return;

      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
        if (permission == LocationPermission.denied) return;
      }
      if (permission == LocationPermission.deniedForever) return;

      final position = await Geolocator.getCurrentPosition();
      if (!mounted) return;
      setState(() => _currentPosition = position);

      if (_isWithinConcessionBounds(position.latitude, position.longitude)) {
        _mapController.move(LatLng(position.latitude, position.longitude), 13.0);
      }
    } catch (_) {}
  }

  bool _isWithinConcessionBounds(double lat, double lon) {
    return lat >= -19.2 && lat <= -18.7 && lon >= 23.5 && lon <= 23.9;
  }

  void _onMapTap(LatLng point) {
    if (widget.layerVisibility.natParksEnabled &&
        _zoom < kNatParkLabelMinZoom) {
      final park = findNatParkAtPoint(point, _natParks);
      if (park != null) {
        _showPlaceDetails(
          context,
          name: park.name,
          properties: const {},
          link: null,
        );
        return;
      }
    }
    widget.onMapTap?.call(point);
  }

  void _showPlaceDetails(
    BuildContext context, {
    required String name,
    required Map<String, dynamic> properties,
    String? link,
  }) {
    final entries = properties.entries
        .where((e) {
          final k = e.key.toLowerCase();
          return k != 'link' &&
              k != 'website' &&
              k != 'url' &&
              k != 'name';
        })
        .toList()
      ..sort((a, b) => a.key.toLowerCase().compareTo(b.key.toLowerCase()));

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(name, style: Theme.of(ctx).textTheme.titleLarge),
                const SizedBox(height: 16),
                if (entries.isNotEmpty)
                  ConstrainedBox(
                    constraints: BoxConstraints(
                      maxHeight: MediaQuery.sizeOf(ctx).height * 0.5,
                    ),
                    child: ListView(
                      shrinkWrap: true,
                      children: [
                        for (final e in entries)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  e.key,
                                  style: Theme.of(ctx)
                                      .textTheme
                                      .labelMedium
                                      ?.copyWith(color: Colors.grey),
                                ),
                                const SizedBox(height: 4),
                                SelectableText(
                                  e.value == null ||
                                          e.value.toString().isEmpty
                                      ? '—'
                                      : e.value.toString(),
                                  style: Theme.of(ctx).textTheme.bodyLarge,
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                if (link != null && link.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: FilledButton.icon(
                      onPressed: () async {
                        final uri = Uri.tryParse(link);
                        if (uri == null) return;
                        final ok = await launchUrl(
                          uri,
                          mode: LaunchMode.externalApplication,
                        );
                        if (!ok && ctx.mounted) {
                          ScaffoldMessenger.of(ctx).showSnackBar(
                            const SnackBar(content: Text('Could not open link')),
                          );
                        }
                      },
                      icon: const Icon(Icons.open_in_new, size: 18),
                      label: const Text('Open website'),
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  List<Polyline> _visibleRoadPolylines() {
    if (!widget.layerVisibility.roadsEnabled) return [];
    final out = <Polyline>[];
    for (final road in _roads) {
      if (road.scale == 2 && _zoom < kRoadScale2MinZoom) continue;
      if (road.scale == 3 && _zoom < kRoadScale3MinZoom) continue;
      if (road.scale > 3) continue;
      final color = road.scale == 1
          ? Colors.black87
          : road.scale == 2
              ? const Color(0xFF424242)
              : const Color(0xFF757575);
      final width = road.scale == 1 ? 2.5 : road.scale == 2 ? 1.8 : 1.2;
      out.add(Polyline(
        points: road.points,
        color: color,
        strokeWidth: width,
      ));
    }
    return out;
  }

  List<Polygon> _natParkPolygons() {
    if (!widget.layerVisibility.natParksEnabled) return [];
    final out = <Polygon>[];
    for (final park in _natParks) {
      for (final ring in park.rings) {
        out.add(Polygon(
          points: ring,
          color: const Color(0x552E7D32),
          borderColor: const Color(0xAA2E7D32),
          borderStrokeWidth: 1.5,
        ));
      }
    }
    return out;
  }

  List<Marker> _poiMarkers() {
    final v = widget.layerVisibility;
    final out = <Marker>[];
    for (final poi in _pois) {
      if (poi.isRestaurant) {
        if (!v.restaurantsEnabled) continue;
      } else {
        if (!(v.accommodationTypes[poi.subtype] ?? false)) continue;
      }
      out.add(Marker(
        point: poi.point,
        width: 32,
        height: 32,
        alignment: Alignment.bottomCenter,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: () => _showPlaceDetails(
              context,
              name: poi.name,
              properties: poi.properties,
              link: poi.properties['link']?.toString(),
            ),
            customBorder: const CircleBorder(),
            child: poi.isRestaurant
                ? Icon(Icons.restaurant, color: Colors.orange.shade800, size: 28)
                : SvgPicture.asset(
                    poi.svgAsset ?? 'assets/camp.svg',
                    width: 32,
                    height: 32,
                    fit: BoxFit.contain,
                  ),
          ),
        ),
      ));
    }
    return out;
  }

  void _centerOnLocation() {
    if (_currentPosition != null) {
      _mapController.move(
        LatLng(_currentPosition!.latitude, _currentPosition!.longitude),
        13.0,
      );
    }
  }

  void _centerOnConcession() {
    _mapController.move(_concessionCenter, _initialZoom);
  }

  void _dropPinAtCurrentLocation() {
    if (_currentPosition != null && widget.onMapTap != null) {
      widget.onMapTap!(
        LatLng(_currentPosition!.latitude, _currentPosition!.longitude),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final roadPolylines = _visibleRoadPolylines();
    final parkPolygons = _natParkPolygons();
    final poiMarkers = _poiMarkers();

    final stack = Stack(
      fit: StackFit.expand,
      children: [
        Positioned.fill(
          child: LayoutBuilder(
            builder: (context, constraints) {
              final mq = MediaQuery.sizeOf(context);
              final w =
                  constraints.maxWidth > 0 ? constraints.maxWidth : mq.width;
              final h =
                  constraints.maxHeight > 0 ? constraints.maxHeight : mq.height;
              if (w <= 0 || h <= 0) return const SizedBox.shrink();
              return ColoredBox(
                // Earthy parchment background — visible with no tile layer.
                color: const Color(0xFFEDE8E0),
                child: SizedBox(
                width: w,
                height: h,
                child: FlutterMap(
                  mapController: _mapController,
                  options: MapOptions(
                    initialCenter: _concessionCenter,
                    initialZoom: _initialZoom,
                    minZoom: 8.0,
                    maxZoom: 18.0,
                    onTap: (_, point) => _onMapTap(point),
                    onPositionChanged: (pos, _) {
                      final z = pos.zoom;
                      if (z == null || !mounted) return;
                      if ((z - _zoom).abs() > 0.05) {
                        setState(() => _zoom = z);
                      }
                    },
                  ),
                  children: [
                    if (parkPolygons.isNotEmpty)
                      PolygonLayer(polygons: parkPolygons),
                    if (widget.layerVisibility.natParksEnabled &&
                        _natParks.isNotEmpty)
                      ParkLabelsLayer(parks: _natParks),
                    if (roadPolylines.isNotEmpty)
                      PolylineLayer(polylines: roadPolylines),
                    if (poiMarkers.isNotEmpty)
                      MarkerLayer(
                        alignment: Alignment.bottomCenter,
                        markers: poiMarkers,
                      ),
                    if (_currentPosition != null)
                      MarkerLayer(
                        markers: [
                          Marker(
                            point: LatLng(
                              _currentPosition!.latitude,
                              _currentPosition!.longitude,
                            ),
                            child: Container(
                              decoration: BoxDecoration(
                                color: Colors.blue.withValues(alpha: 0.8),
                                shape: BoxShape.circle,
                                border:
                                    Border.all(color: Colors.white, width: 2),
                              ),
                              child: const Icon(
                                Icons.my_location,
                                color: Colors.white,
                                size: 20,
                              ),
                            ),
                          ),
                        ],
                      ),
                    if (widget.selectedPoint != null)
                      MarkerLayer(
                        markers: [
                          Marker(
                            point: widget.selectedPoint!,
                            child: const Icon(
                              Icons.location_pin,
                              color: Colors.red,
                              size: 40,
                            ),
                          ),
                        ],
                      ),
                    if (widget.extraPolygons.isNotEmpty)
                      PolygonLayer(polygons: widget.extraPolygons),
                    if (widget.extraMarkers.isNotEmpty)
                      MarkerLayer(
                        alignment: Alignment.center,
                        markers: widget.extraMarkers,
                      ),
                  ],
                ),
              ),
              );
            },
          ),
        ),
        // Small corner spinner while layers stream in — map is always visible.
        if (_isLoading)
          const Positioned(
            top: 12,
            right: 12,
            child: MoremiPangolinLoadingIndicator(size: 32),
          ),
        if (_errorMessage != null)
          Positioned.fill(
            child: Container(
              color: Colors.black.withValues(alpha: 0.8),
              padding: const EdgeInsets.all(16),
              alignment: Alignment.center,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.error, color: Colors.red, size: 48),
                  const SizedBox(height: 16),
                  Text(
                    _errorMessage!,
                    style: const TextStyle(color: Colors.white),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: _loadMapData,
                    child: const Text('Retry'),
                  ),
                ],
              ),
            ),
          ),
      ],
    );

    if (widget.embedded) return stack;

    return Scaffold(
      appBar: AppBar(title: const Text('Concession Map')),
      body: stack,
      floatingActionButton: Column(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          SizedBox(
            width: 48,
            height: 48,
            child: FloatingActionButton(
              heroTag: 'zoom_concession',
              onPressed: _centerOnConcession,
              tooltip: 'Zoom to concession',
              child: const Icon(Icons.home),
            ),
          ),
          const SizedBox(height: 8),
          if (_currentPosition != null) ...[
            SizedBox(
              width: 48,
              height: 48,
              child: FloatingActionButton(
                heroTag: 'zoom_me',
                onPressed: _centerOnLocation,
                tooltip: 'Zoom to me',
                child: const Icon(Icons.search),
              ),
            ),
            const SizedBox(height: 8),
            SizedBox(
              width: 48,
              height: 48,
              child: FloatingActionButton(
                heroTag: 'drop_pin',
                onPressed: _dropPinAtCurrentLocation,
                tooltip: 'Drop pin at my location',
                child: const Icon(Icons.location_on),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
