import 'package:latlong2/latlong.dart';

/// Visibility toggles for Botswana map overlays (legend on sightings page).
class MoremiMapLayerVisibility {
  MoremiMapLayerVisibility({
    this.roadsEnabled = true,
    this.roadScale1 = true,
    this.roadScale2 = true,
    this.roadScale3 = true,
    this.natParksEnabled = true,
    this.restaurantsEnabled = false,
    Map<String, bool>? accommodationTypes,
  }) : accommodationTypes = accommodationTypes ?? {};

  bool roadsEnabled;
  bool roadScale1;
  bool roadScale2;
  bool roadScale3;
  bool natParksEnabled;
  bool restaurantsEnabled;
  final Map<String, bool> accommodationTypes;

  MoremiMapLayerVisibility copyWith({
    bool? roadsEnabled,
    bool? roadScale1,
    bool? roadScale2,
    bool? roadScale3,
    bool? natParksEnabled,
    bool? restaurantsEnabled,
    Map<String, bool>? accommodationTypes,
  }) {
    return MoremiMapLayerVisibility(
      roadsEnabled: roadsEnabled ?? this.roadsEnabled,
      roadScale1: roadScale1 ?? this.roadScale1,
      roadScale2: roadScale2 ?? this.roadScale2,
      roadScale3: roadScale3 ?? this.roadScale3,
      natParksEnabled: natParksEnabled ?? this.natParksEnabled,
      restaurantsEnabled: restaurantsEnabled ?? this.restaurantsEnabled,
      accommodationTypes: accommodationTypes ?? Map.from(this.accommodationTypes),
    );
  }
}

class BotsRoadPolyline {
  const BotsRoadPolyline({
    required this.points,
    required this.scale,
    this.fclass,
  });

  final List<LatLng> points;
  final int scale;
  final String? fclass;
}

class BotsPoi {
  const BotsPoi({
    required this.point,
    required this.name,
    required this.category,
    required this.subtype,
    required this.properties,
    required this.svgAsset,
    required this.isRestaurant,
  });

  final LatLng point;
  final String name;
  /// `accommodation` or `restaurant`.
  final String category;
  final String subtype;
  final Map<String, dynamic> properties;
  final String? svgAsset;
  final bool isRestaurant;
}

class NatParkRegion {
  const NatParkRegion({
    required this.name,
    required this.rings,
  });

  final String name;
  /// Each entry is one closed polygon ring.
  final List<List<LatLng>> rings;

  LatLng get labelPoint {
    if (rings.isEmpty || rings.first.isEmpty) {
      return const LatLng(0, 0);
    }
    var lat = 0.0;
    var lon = 0.0;
    var n = 0;
    for (final ring in rings) {
      for (final p in ring) {
        lat += p.latitude;
        lon += p.longitude;
        n++;
      }
    }
    if (n == 0) return rings.first.first;
    return LatLng(lat / n, lon / n);
  }
}

const double kRoadScale2MinZoom = 11.0;
const double kRoadScale3MinZoom = 13.5;
const double kNatParkLabelMinZoom = 11.5;

List<LatLng> _coordsToPoints(List<dynamic> coords) {
  final out = <LatLng>[];
  for (final c in coords) {
    if (c is! List || c.length < 2) continue;
    final lon = (c[0] as num).toDouble();
    final lat = (c[1] as num).toDouble();
    out.add(LatLng(lat, lon));
  }
  return out;
}

/// Maps OSM fclass to road scale (1 = major, 2 = regional, 3 = local).
int _fclassToScale(String? fclass) {
  switch (fclass?.toLowerCase()) {
    case 'motorway':
    case 'motorway_link':
    case 'trunk':
    case 'trunk_link':
    case 'primary':
    case 'primary_link':
      return 1;
    case 'secondary':
    case 'secondary_link':
    case 'tertiary':
    case 'tertiary_link':
      return 2;
    default:
      return 3;
  }
}

List<BotsRoadPolyline> parseBotsRoads(Map<String, dynamic> geojson) {
  final out = <BotsRoadPolyline>[];
  final features = geojson['features'] as List<dynamic>? ?? [];
  for (final raw in features) {
    if (raw is! Map<String, dynamic>) continue;
    final props = raw['properties'] as Map<String, dynamic>? ?? {};
    final fclass = props['fclass']?.toString();
    // Derive scale from fclass if no explicit scale field exists.
    final scale = (props['scale'] as num?)?.toInt() ?? _fclassToScale(fclass);
    final geom = raw['geometry'] as Map<String, dynamic>?;
    if (geom == null) continue;
    final type = geom['type'] as String? ?? '';
    final coords = geom['coordinates'];
    final lineStrings = <List<dynamic>>[];
    if (type == 'LineString' && coords is List) {
      lineStrings.add(coords);
    } else if (type == 'MultiLineString' && coords is List) {
      for (final ls in coords) {
        if (ls is List) lineStrings.add(ls);
      }
    }
    for (final ls in lineStrings) {
      final pts = _coordsToPoints(ls);
      if (pts.length >= 2) {
        out.add(BotsRoadPolyline(points: pts, scale: scale, fclass: fclass));
      }
    }
  }
  return out;
}

String _poiName(Map<String, dynamic> props) {
  for (final k in ['name', 'Name', 'Camps', 'title', 'label']) {
    final v = props[k]?.toString().trim();
    if (v != null && v.isNotEmpty) return v;
  }
  return 'Place';
}

String? _poiLink(Map<String, dynamic> props) {
  for (final k in ['link', 'Link', 'website', 'Website', 'url', 'URL']) {
    final v = props[k]?.toString().trim();
    if (v != null && v.isNotEmpty) return v;
  }
  return null;
}

bool _isRestaurantCategory(String category, String subtype) {
  final c = category.toLowerCase();
  final s = subtype.toLowerCase();
  return c.contains('restaurant') ||
      c.contains('food') ||
      s.contains('restaurant') ||
      s == 'restaurant';
}

bool _isAccommodationCategory(String category, String subtype) {
  if (_isRestaurantCategory(category, subtype)) return false;
  final c = category.toLowerCase();
  final s = subtype.toLowerCase();
  return c.contains('accommodation') ||
      c.contains('camp') ||
      c.contains('lodge') ||
      c.contains('hotel') ||
      s.contains('lodge') ||
      s.contains('camp') ||
      s.contains('entrance') ||
      s.contains('gate') ||
      category.isEmpty;
}

String _poiSubtype(Map<String, dynamic> props) {
  for (final k in ['type', 'Type', 'subtype', 'class', 'fclass']) {
    final v = props[k]?.toString().trim();
    if (v != null && v.isNotEmpty) return v;
  }
  return 'Other';
}

String _poiCategory(Map<String, dynamic> props) {
  for (final k in ['category', 'Category', 'poi_type', 'poiType']) {
    final v = props[k]?.toString().trim();
    if (v != null && v.isNotEmpty) return v;
  }
  final subtype = _poiSubtype(props).toLowerCase();
  if (_isRestaurantCategory('', subtype)) return 'restaurant';
  return 'accommodation';
}

String? _svgForAccommodationSubtype(String subtype) {
  final t = subtype.toLowerCase().trim();
  if (t.contains('lodge')) return 'assets/lodge.svg';
  if (t.contains('camp')) return 'assets/camp.svg';
  if (t.contains('entrance') || t.contains('gate')) return 'assets/gate.svg';
  return 'assets/camp.svg';
}

List<BotsPoi> parseBotsPois(Map<String, dynamic> geojson) {
  final out = <BotsPoi>[];
  final features = geojson['features'] as List<dynamic>? ?? [];
  for (final raw in features) {
    if (raw is! Map<String, dynamic>) continue;
    final geom = raw['geometry'] as Map<String, dynamic>?;
    if (geom == null || (geom['type'] as String? ?? '') != 'Point') continue;
    final coords = geom['coordinates'] as List<dynamic>?;
    if (coords == null || coords.length < 2) continue;
    final props = Map<String, dynamic>.from(
      raw['properties'] as Map<String, dynamic>? ?? {},
    );
    final link = _poiLink(props);
    if (link != null) props['link'] = link;
    final subtype = _poiSubtype(props);
    var category = _poiCategory(props);
    final isRestaurant = _isRestaurantCategory(category, subtype);
    if (isRestaurant) {
      category = 'restaurant';
    } else if (!_isAccommodationCategory(category, subtype)) {
      continue;
    } else {
      category = 'accommodation';
    }
    out.add(BotsPoi(
      point: LatLng(
        (coords[1] as num).toDouble(),
        (coords[0] as num).toDouble(),
      ),
      name: _poiName(props),
      category: category,
      subtype: subtype,
      properties: props,
      svgAsset: isRestaurant ? null : _svgForAccommodationSubtype(subtype),
      isRestaurant: isRestaurant,
    ));
  }
  return out;
}

List<String> accommodationSubtypesFromPois(List<BotsPoi> pois) {
  final set = <String>{};
  for (final p in pois) {
    if (p.category == 'accommodation') set.add(p.subtype);
  }
  final list = set.toList()..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
  return list;
}

List<NatParkRegion> parseNatParks(Map<String, dynamic> geojson) {
  final out = <NatParkRegion>[];
  final features = geojson['features'] as List<dynamic>? ?? [];
  for (final raw in features) {
    if (raw is! Map<String, dynamic>) continue;
    final props = raw['properties'] as Map<String, dynamic>? ?? {};
    final name = props['name']?.toString().trim() ??
        props['Name']?.toString().trim() ??
        props['fclass']?.toString().trim() ??
        'Protected area';
    final geom = raw['geometry'] as Map<String, dynamic>?;
    if (geom == null) continue;
    final type = geom['type'] as String? ?? '';
    final coords = geom['coordinates'];
    final rings = <List<LatLng>>[];

    void addRing(List<dynamic> ringCoords) {
      final pts = _coordsToPoints(ringCoords);
      if (pts.length >= 3) rings.add(pts);
    }

    if (type == 'Polygon' && coords is List && coords.isNotEmpty) {
      addRing(coords.first as List<dynamic>);
    } else if (type == 'MultiPolygon' && coords is List) {
      for (final poly in coords) {
        if (poly is List && poly.isNotEmpty) {
          addRing(poly.first as List<dynamic>);
        }
      }
    }
    if (rings.isNotEmpty) {
      out.add(NatParkRegion(name: name, rings: rings));
    }
  }
  return out;
}

bool pointInPolygon(LatLng point, List<LatLng> ring) {
  if (ring.length < 3) return false;
  var inside = false;
  for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    final xi = ring[i].longitude;
    final yi = ring[i].latitude;
    final xj = ring[j].longitude;
    final yj = ring[j].latitude;
    final intersect = ((yi > point.latitude) != (yj > point.latitude)) &&
        (point.longitude <
            (xj - xi) * (point.latitude - yi) / (yj - yi + 0.0) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

NatParkRegion? findNatParkAtPoint(LatLng point, List<NatParkRegion> parks) {
  for (final park in parks) {
    for (final ring in park.rings) {
      if (pointInPolygon(point, ring)) return park;
    }
  }
  return null;
}
