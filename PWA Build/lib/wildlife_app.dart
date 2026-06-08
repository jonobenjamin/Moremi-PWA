import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_geojson/flutter_map_geojson.dart';
import 'package:geolocator/geolocator.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:latlong2/latlong.dart';

import 'map_screen.dart';
import 'moremi_map_data.dart';
import 'moremi_map_legend.dart';
import 'moremi_firebase_session.dart';
import 'moremi_firestore_service.dart';
import 'moremi_nav_icons.dart';
import 'moremi_svg_widgets.dart';
import 'moremi_password_change_card.dart';
import 'moremi_theme.dart';
import 'moremi_profile_editor.dart';
import 'moremi_species.dart';
import 'web_compat.dart';

const String _okavangoWaterLatest =
    'https://okavango-delta-water-default-rtdb.firebaseio.com/okavango/water/latest.json';

bool _moremiLegacyAuthUid(String uid) =>
    uid.startsWith('uname_') ||
    uid.startsWith('email_') ||
    uid.startsWith('phone_');

/// Hive queue uses [saved_at_ms]; Firestore/API use ISO in `timestamp` for display only.
DateTime moremiRowTime(Map<dynamic, dynamic> row) {
  final ms = row['saved_at_ms'];
  if (ms is int) return DateTime.fromMillisecondsSinceEpoch(ms);
  if (ms is num) return DateTime.fromMillisecondsSinceEpoch(ms.toInt());
  return DateTime.tryParse(row['timestamp']?.toString() ?? '') ??
      DateTime.fromMillisecondsSinceEpoch(0);
}

/// Firebase Auth uid for storage keys and queue ownership (not custom ids).
String? moremiAuthUid() {
  final fbUid = FirebaseAuth.instance.currentUser?.uid;
  if (fbUid != null) {
    if (_moremiLegacyAuthUid(fbUid)) return null;
    return fbUid;
  }
  final lsUid = localStorageGet('firebaseUid');
  if (lsUid != null && _moremiLegacyAuthUid(lsUid)) {
    localStorageClearMoremiAuthKeys();
    return null;
  }
  return lsUid;
}

/// Fetch current [moremi_build.json] id, store ack, then [triggerForceAppUpdate] (clears SW + reload).
Future<void> moremiAckAndForceAppUpdate() async {
  if (kIsWeb) {
    final url = moremiBuildJsonUrl();
    if (url != null) {
      try {
        final res = await http
            .get(Uri.parse('$url?t=${DateTime.now().millisecondsSinceEpoch}'))
            .timeout(const Duration(seconds: 8));
        if (res.statusCode == 200) {
          final decoded = jsonDecode(res.body);
          if (decoded is Map) {
            final id = decoded['id']?.toString();
            if (id != null && id.isNotEmpty) {
              localStorageSet('ackRemoteBuildId', id);
            }
          }
        }
      } catch (_) {}
    }
  }
  triggerForceAppUpdate();
}

class WildlifeAppRoot extends StatelessWidget {
  const WildlifeAppRoot({super.key, required this.home});

  final Widget home;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Moremi Wildlife Sightings',
      theme: moremiAppTheme(),
      // Web + custom hostElement: ensure the subtree sees a bounded expand constraint.
      builder: (context, child) {
        if (child == null) return const SizedBox.shrink();
        return SizedBox.expand(child: child);
      },
      home: home,
    );
  }
}

/// Map / home tab for [MoremiAppShell] (shared sightings). Naming is legacy; all data is Moremi Firestore + API.
class WildlifeHomePage extends StatefulWidget {
  const WildlifeHomePage({
    super.key,
    this.showProfileShortcut = true,
    this.onSightingsChanged,
  });

  /// When false (e.g. main nav uses a Profile tab), hide the map header profile shortcut.
  final bool showProfileShortcut;

  /// Called after a sighting is saved locally and after cloud sync so Profile / Groups can refresh.
  final VoidCallback? onSightingsChanged;

  @override
  WildlifeHomePageState createState() => WildlifeHomePageState();
}

class WildlifeHomePageState extends State<WildlifeHomePage> {
  final Box _offline = Hive.box('offlineData');
  final MapController _homeMapController = MapController();

  List<Map<String, dynamic>> _sightings = [];
  List<Polygon> _waterPolygons = [];
  bool _waterEnabled = false;
  bool _loadingSightings = false;
  LatLng? _pin;
  /// When true, the next sighting uses [_pin]; otherwise coordinates come from GPS.
  bool _useMapPinForLocation = false;
  String? _sightingsError;

  MoremiMapLayerVisibility _mapLayerVisibility = MoremiMapLayerVisibility();
  List<String> _accommodationSubtypes = [];
  bool _mapLegendExpanded = false;

  Timer? _refreshTicker;

  DateTime get _sevenDaysAgo => DateTime.now().subtract(const Duration(days: 7));

  bool get _online => kIsWeb ? navigatorOnLine() : true;

  List<Map<String, dynamic>> get _sightingsForMap {
    final cutoff = _sevenDaysAgo;
    final uid = moremiAuthUid();
    final fromApi = _sightings.where((s) {
      final t = DateTime.tryParse(s['timestamp']?.toString() ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0);
      return !t.isBefore(cutoff);
    }).toList();
    final pendingLocal = <Map<String, dynamic>>[];
    for (final k in _offline.keys) {
      final raw = _offline.get(k);
      if (raw is! Map) continue;
      if (raw['category'] != 'Sighting') continue;
      if (raw['synced'] == true) continue;
      if (uid != null && raw['owner_uid']?.toString() != uid) continue;
      final m = Map<String, dynamic>.from(raw);
      m['_localPending'] = true;
      m['_hiveKey'] = k.toString();
      final t = moremiRowTime(m);
      if (!t.isBefore(cutoff)) {
        pendingLocal.add(m);
      }
    }
    return [...pendingLocal, ...fromApi];
  }

  @override
  void initState() {
    super.initState();
    _purgeStaleOfflineForOtherUsers();
    scheduleMicrotask(_refreshSightings);
    _refreshTicker = Timer.periodic(const Duration(minutes: 3), (_) => _refreshSightings());
    if (kIsWeb) {
      listenOnline(() {
        if (!mounted) return;
        scheduleMicrotask(() async {
          await _syncOfflineNow();
          await _refreshSightings();
        });
      });
    }
  }

  /// Called from [MoremiAppShell] after group join / sync.
  void refreshSightingsPublic() => _refreshSightings();

  Future<void> syncOfflinePublic() => _syncOfflineNow();

  @override
  void dispose() {
    _refreshTicker?.cancel();
    _homeMapController.dispose();
    super.dispose();
  }

  void _purgeStaleOfflineForOtherUsers() {
    final uid = moremiAuthUid();
    if (uid == null) return;
    final removeKeys = <dynamic>[];
    for (final k in _offline.keys) {
      final raw = _offline.get(k);
      if (raw is Map && raw['category'] == 'Sighting' && raw['synced'] != true) {
        final o = raw['owner_uid']?.toString();
        if (o != null && o != uid) removeKeys.add(k);
      }
    }
    for (final k in removeKeys) {
      _offline.delete(k);
    }
  }

  String? _bearer() {
    final t = localStorageGet('firebaseIdToken');
    if (t == null || t.isEmpty) return null;
    return t;
  }

  Future<void> _refreshSightings() async {
    if (!_online) {
      setState(() => _sightingsError = null);
      return;
    }
    await MoremiFirebaseSession.ensureSignedIn();
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) {
      if (!mounted) return;
      setState(() {
        _loadingSightings = false;
        _sightingsError = 'Sign in to load sightings on the map.';
        _sightings = [];
      });
      return;
    }
    setState(() {
      _loadingSightings = true;
      _sightingsError = null;
    });
    try {
      final list = await MoremiFirestoreService.instance.fetchSightingsForMap(uid);
      if (!mounted) return;
      setState(() {
        _sightings = list;
        _loadingSightings = false;
      });
    } catch (e, st) {
      if (e is FirebaseException) {
        debugPrint(
          '[MoremiMap] refreshSightings path=observations '
          'code=${e.code} message=${e.message}',
        );
      } else {
        debugPrint('[MoremiMap] refreshSightings error=$e');
      }
      debugPrintStack(label: 'refreshSightings', stackTrace: st);
      if (!mounted) return;
      setState(() {
        _loadingSightings = false;
        _sightingsError = 'Could not refresh map ($e)';
      });
    }
  }

  Future<void> _loadWaterIfNeeded() async {
    if (!_waterEnabled || !_online) {
      setState(() => _waterPolygons = []);
      return;
    }
    try {
      final res = await http.get(Uri.parse(_okavangoWaterLatest)).timeout(const Duration(seconds: 25));
      if (res.statusCode != 200) return;
      final decoded = jsonDecode(res.body);
      dynamic geo = decoded;
      if (decoded is Map && decoded['geojson'] != null) {
        final g = decoded['geojson'];
        geo = g is String ? jsonDecode(g) : g;
      }
      if (geo is! Map<String, dynamic>) return;
      final parser = GeoJsonParser();
      parser.parseGeoJson(geo);
      final polys = parser.polygons
          .map(
            (p) => Polygon(
              points: p.points,
              color: const Color(0x7358A6FF),
              borderColor: const Color(0xB358A6FF),
              borderStrokeWidth: 1,
            ),
          )
          .toList();
      if (mounted) setState(() => _waterPolygons = polys);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not load water layer')),
        );
      }
      setState(() {
        _waterPolygons = [];
        _waterEnabled = false;
      });
    }
  }

  Color _markerColor(Map<String, dynamic> s) {
    final h = (s['animal']?.toString() ?? '').hashCode.abs();
    const colors = [
      Color(0xFFC62828),
      Color(0xFF1565C0),
      Color(0xFF6A1B9A),
      Color(0xFFEF6C00),
      Color(0xFF00695C),
    ];
    return colors[h % colors.length];
  }

  List<Marker> _buildSightingMarkers() {
    return _sightingsForMap.map((s) {
      final lat = (s['latitude'] as num?)?.toDouble() ?? 0;
      final lon = (s['longitude'] as num?)?.toDouble() ?? 0;
      final animal = s['animal']?.toString() ?? 'Sighting';
      final n = s['sighting_count'] ?? 1;
      final emoji = speciesEmoji(animal);
      final pending = s['_localPending'] == true;
      return Marker(
        point: LatLng(lat, lon),
        width: 40,
        height: 40,
        child: Tooltip(
          message: pending ? '$animal × $n (not synced yet)' : '$animal × $n',
          child: Container(
            decoration: BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
              border: Border.all(
                color: pending ? Colors.orange : _markerColor(s),
                width: 2,
              ),
              boxShadow: const [
                BoxShadow(color: Color(0x33000000), blurRadius: 3, offset: Offset(0, 1)),
              ],
            ),
            alignment: Alignment.center,
            child: Text(emoji, style: const TextStyle(fontSize: 22)),
          ),
        ),
      );
    }).toList();
  }

  Future<void> _zoomToMyLocation() async {
    try {
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Location permission needed')),
          );
        }
        return;
      }
      final p = await Geolocator.getCurrentPosition();
      _homeMapController.move(LatLng(p.latitude, p.longitude), 14);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Location: $e')));
      }
    }
  }

  void _useGpsForSightingsLocation() {
    setState(() {
      _useMapPinForLocation = false;
      _pin = null;
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Sightings will use your current GPS. Tap the map to drop a pin if you need a different spot.',
        ),
      ),
    );
  }

  Future<void> _openSubmitSheet() async {
    final name = localStorageGet('authenticatedUserName') ?? 'User';
    final uid = moremiAuthUid();
    if (uid == null || _bearer() == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Session missing — sign in again from the home page')),
      );
      return;
    }

    final countCtrl = TextEditingController(text: '1');
    final noteCtrl = TextEditingController();
    final otherSpeciesCtrl = TextEditingController();
    final speciesSelection = <String>[kMoremiSpecies.first];
    Uint8List? imageBytes;
    String? imageName;
    final picker = ImagePicker();

    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
          ),
          child: StatefulBuilder(
            builder: (context, setModal) {
              return SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'Animal sighting',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _useMapPinForLocation && _pin != null
                          ? 'Location: map pin (${_pin!.latitude.toStringAsFixed(5)}, ${_pin!.longitude.toStringAsFixed(5)}). Top bar: GPS button uses phone location for sightings.'
                          : 'Location: your current GPS (refresh by opening the form again). Tap the map to use a map pin instead.',
                      style: TextStyle(color: Colors.grey.shade700, fontSize: 13),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      value: speciesSelection[0],
                      decoration: const InputDecoration(
                        labelText: 'Species',
                        border: OutlineInputBorder(),
                      ),
                      items: kMoremiSpecies
                          .map((e) => DropdownMenuItem<String>(value: e, child: Text('$e ${speciesEmoji(e)}')))
                          .toList(),
                      onChanged: (v) {
                        setModal(() {
                          speciesSelection[0] = v ?? kMoremiSpecies.first;
                        });
                      },
                    ),
                    if (speciesSelection[0] == 'Other') ...[
                      const SizedBox(height: 12),
                      TextField(
                        controller: otherSpeciesCtrl,
                        decoration: const InputDecoration(
                          labelText: 'Other species name',
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ],
                    const SizedBox(height: 12),
                    TextField(
                      controller: countCtrl,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'How many',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: noteCtrl,
                      maxLines: 3,
                      decoration: const InputDecoration(
                        labelText: 'Note (optional)',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        TextButton.icon(
                          onPressed: () async {
                            final x = await picker.pickImage(
                              source: kIsWeb ? ImageSource.gallery : ImageSource.camera,
                              maxWidth: 1600,
                              imageQuality: 82,
                            );
                            if (x != null) {
                              final b = await x.readAsBytes();
                              setModal(() {
                                imageBytes = b;
                                imageName = x.name;
                              });
                            }
                          },
                          icon: const Icon(Icons.photo_camera),
                          label: Text(imageBytes == null ? 'Add photo' : 'Change photo'),
                        ),
                        if (imageBytes != null)
                          Expanded(
                            child: Text(
                              imageName ?? 'Image',
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 12),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    FilledButton(
                      onPressed: () async {
                        final sel = speciesSelection[0];
                        final animal =
                            sel == 'Other' ? otherSpeciesCtrl.text.trim() : sel;
                        if (animal.isEmpty) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Choose a species or enter a name')),
                          );
                          return;
                        }
                        final count = int.tryParse(countCtrl.text.trim()) ?? 1;
                        late double lat;
                        late double lon;
                        if (_useMapPinForLocation && _pin != null) {
                          lat = _pin!.latitude;
                          lon = _pin!.longitude;
                        } else {
                          try {
                            LocationPermission perm = await Geolocator.checkPermission();
                            if (perm == LocationPermission.denied) {
                              perm = await Geolocator.requestPermission();
                            }
                            if (perm == LocationPermission.denied ||
                                perm == LocationPermission.deniedForever) {
                              if (!context.mounted) return;
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(content: Text('Location permission needed')),
                              );
                              return;
                            }
                            final p = await Geolocator.getCurrentPosition();
                            lat = p.latitude;
                            lon = p.longitude;
                          } catch (e) {
                            if (!context.mounted) return;
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text('GPS error: $e')),
                            );
                            return;
                          }
                        }

                        // Online: Firestore `timestamp` must be a Timestamp — use submitSighting (serverTimestamp).
                        if (_online) {
                          await MoremiFirebaseSession.ensureSignedIn();
                          final fbUid = FirebaseAuth.instance.currentUser?.uid;
                          if (fbUid != null) {
                            try {
                              String? noteOut =
                                  noteCtrl.text.trim().isEmpty ? null : noteCtrl.text.trim();
                              if (imageBytes != null) {
                                const extra =
                                    'Photo was attached — not stored in cloud sync.';
                                noteOut = noteOut == null || noteOut.isEmpty
                                    ? extra
                                    : '$noteOut\n$extra';
                              }
                              await MoremiFirestoreService.instance.submitSighting(
                                uid: fbUid,
                                species: animal,
                                count: count.clamp(1, 999),
                                lat: lat,
                                lon: lon,
                                note: noteOut,
                              );
                              if (!context.mounted) return;
                              Navigator.pop(context);
                              setState(() {});
                              widget.onSightingsChanged?.call();
                              await _refreshSightings();
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(content: Text('Sighting saved')),
                                );
                              }
                              return;
                            } catch (e) {
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                    content: Text(
                                      'Could not save to cloud ($e). Queuing on this device…',
                                    ),
                                  ),
                                );
                              }
                            }
                          }
                        }

                        // Offline or cloud failed: local queue only (saved_at_ms — not sent as Firestore timestamp).
                        final payload = <String, dynamic>{
                          'category': 'Sighting',
                          'animal': animal,
                          'sighting_count': count.clamp(1, 999),
                          'saved_at_ms': DateTime.now().millisecondsSinceEpoch,
                          'synced': false,
                          'latitude': lat,
                          'longitude': lon,
                          'user': name,
                          'owner_uid': uid,
                        };
                        if (noteCtrl.text.trim().isNotEmpty) {
                          payload['note'] = noteCtrl.text.trim();
                        }
                        if (imageBytes != null && imageName != null) {
                          payload['sighting_image'] = base64Encode(imageBytes!);
                          payload['sighting_image_name'] = imageName;
                        }
                        await _offline.add(payload);
                        if (!context.mounted) return;
                        Navigator.pop(context);
                        setState(() {});
                        widget.onSightingsChanged?.call();
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text(
                              _online
                                  ? 'Saved on device — open the app online to sync'
                                  : 'Saved offline — will sync when you are online',
                            ),
                          ),
                        );
                        if (_online) {
                          await _syncOfflineNow();
                        }
                      },
                      child: const Text('Save sighting'),
                    ),
                  ],
                ),
              );
            },
          ),
        );
      },
    );

    countCtrl.dispose();
    noteCtrl.dispose();
    otherSpeciesCtrl.dispose();
  }

  Future<void> _syncOfflineNow() async {
    if (!_online) return;
    await MoremiFirebaseSession.ensureSignedIn();
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;

    final syncedKeys = <dynamic>[];

    for (final k in _offline.keys) {
      final item = _offline.get(k);
      if (item is! Map || item['synced'] == true) continue;
      if (item['category'] != 'Sighting') continue;

      try {
        final animal = item['animal']?.toString() ?? 'Sighting';
        final lat = (item['latitude'] as num?)?.toDouble();
        final lon = (item['longitude'] as num?)?.toDouble();
        if (lat == null || lon == null) continue;
        final count = (item['sighting_count'] as num?)?.toInt() ?? 1;
        var note = item['note']?.toString();
        if (item['sighting_image'] != null) {
          final extra = 'Photo was attached — not stored in cloud sync.';
          note = note == null || note.isEmpty ? extra : '$note\n$extra';
        }
        await MoremiFirestoreService.instance.submitSighting(
          uid: uid,
          species: animal,
          count: count,
          lat: lat,
          lon: lon,
          note: note,
        );
        syncedKeys.add(k);
      } catch (_) {}
    }

    for (final k in syncedKeys) {
      await _offline.delete(k);
    }

    if (syncedKeys.isNotEmpty) {
      await _refreshSightings();
      widget.onSightingsChanged?.call();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Synced ${syncedKeys.length} sighting(s)')),
        );
      }
    }
    setState(() {});
  }

  void _openInfo() {
    Navigator.push<void>(
      context,
      MaterialPageRoute(
        builder: (context) => const _InfoPage(),
      ),
    );
  }

  void _openProfile() {
    Navigator.push<void>(
      context,
      MaterialPageRoute(
        builder: (context) => WildlifeProfilePage(
          onSyncRequested: _syncOfflineNow,
          onSignedOut: () {},
          showAppUpdateBadge: false,
        ),
      ),
    ).then((_) {
      _purgeStaleOfflineForOtherUsers();
      _refreshSightings();
      setState(() {});
    });
  }

  @override
  Widget build(BuildContext context) {
    final markers = _buildSightingMarkers();

    return Scaffold(
      resizeToAvoidBottomInset: false,
      body: Stack(
        // Non-positioned SafeArea would shrink the stack to ~one row; expand fills the viewport.
        fit: StackFit.expand,
        children: [
          Positioned.fill(
            child: MapScreen(
              embedded: true,
              mapController: _homeMapController,
              selectedPoint: _pin,
              extraMarkers: markers,
              extraPolygons: _waterPolygons,
              layerVisibility: _mapLayerVisibility,
              onAccommodationTypesReady: (types) {
                if (!mounted) return;
                final acc = Map<String, bool>.from(_mapLayerVisibility.accommodationTypes);
                for (final t in types) {
                  acc.putIfAbsent(t, () => false);
                }
                setState(() {
                  _accommodationSubtypes = types;
                  _mapLayerVisibility = _mapLayerVisibility.copyWith(
                    accommodationTypes: acc,
                  );
                });
              },
              onMapTap: (p) => setState(() {
                _pin = p;
                _useMapPinForLocation = true;
              }),
            ),
          ),
          // All stack children must be positioned so layout never shrinks to one row (web/map sizing bug).
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Material(
                          color: Colors.white.withOpacity(0.92),
                          shape: const CircleBorder(),
                          child: IconButton(
                            icon: const Icon(Icons.info_outline),
                            onPressed: _openInfo,
                            tooltip: 'About',
                          ),
                        ),
                        Material(
                          color: Colors.white.withOpacity(0.92),
                          shape: const CircleBorder(),
                          child: IconButton(
                            icon: const MoremiMagnifierSvgIcon(size: 22),
                            onPressed: _zoomToMyLocation,
                            tooltip: 'Zoom to my location',
                          ),
                        ),
                        Material(
                          color: Colors.white.withOpacity(0.92),
                          shape: const CircleBorder(),
                          child: IconButton(
                            icon: Icon(
                              _useMapPinForLocation ? Icons.gps_fixed : Icons.gps_not_fixed,
                              color: _useMapPinForLocation ? Colors.orange.shade800 : null,
                            ),
                            onPressed: _useGpsForSightingsLocation,
                            tooltip: 'Use GPS for sighting location (clear map pin)',
                          ),
                        ),
                      ],
                    ),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        FilterChip(
                          label: const Text('Water'),
                          selected: _waterEnabled,
                          onSelected: _online
                              ? (v) async {
                                  setState(() => _waterEnabled = v);
                                  await _loadWaterIfNeeded();
                                }
                              : null,
                          tooltip: _online
                              ? 'Latest flood extent (online)'
                              : 'Available when online',
                        ),
                        if (kIsWeb) ...[
                          const SizedBox(width: 6),
                          Material(
                            color: Colors.white.withOpacity(0.92),
                            shape: const CircleBorder(),
                            child: IconButton(
                              icon: const Icon(Icons.system_update),
                              onPressed: () => moremiAckAndForceAppUpdate(),
                              tooltip: 'Update app — clear cache and reload',
                              visualDensity: VisualDensity.compact,
                              padding: const EdgeInsets.all(8),
                              constraints: const BoxConstraints(minWidth: 38, minHeight: 38),
                            ),
                          ),
                        ],
                        if (widget.showProfileShortcut) ...[
                          const SizedBox(width: 8),
                          Material(
                            color: Colors.white.withOpacity(0.92),
                            shape: const CircleBorder(),
                            child: IconButton(
                              icon: const Icon(Icons.person),
                              onPressed: _openProfile,
                              tooltip: 'Profile & history',
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (_loadingSightings)
            Positioned(
              left: 0,
              right: 0,
              bottom: 100,
              child: Center(
                child: Material(
                  elevation: 2,
                  borderRadius: BorderRadius.circular(20),
                  child: const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        SizedBox(
                          width: 22,
                          height: 22,
                          child: MoremiPangolinLoadingIndicator(size: 22),
                        ),
                        SizedBox(width: 8),
                        Text('Updating sightings…'),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          if (_sightingsError != null)
            Positioned(
              left: 12,
              right: 12,
              bottom: 88,
              child: Material(
                color: Colors.red.shade50,
                elevation: 1,
                borderRadius: BorderRadius.circular(8),
                child: Padding(
                  padding: const EdgeInsets.all(8),
                  child: Text(_sightingsError!, style: const TextStyle(fontSize: 13)),
                ),
              ),
            ),
          // Legend panel — floats above the bottom row, anchored right
          if (_mapLegendExpanded)
            Positioned(
              right: 8,
              bottom: 90,
              child: SafeArea(
                child: MoremiMapLegendPanel(
                  visibility: _mapLayerVisibility,
                  accommodationTypes: _accommodationSubtypes,
                  onChanged: (v) => setState(() => _mapLayerVisibility = v),
                ),
              ),
            ),
          // Bottom action row: FAB (centre) + legend toggle (right, same level)
          Positioned(
            left: 0,
            right: 0,
            bottom: 24,
            child: SafeArea(
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  // Spacer to keep FAB centred visually despite the right button
                  const SizedBox(width: 56 + 16),
                  FloatingActionButton(
                    heroTag: 'add_sighting',
                    onPressed: _openSubmitSheet,
                    tooltip: 'Add sighting',
                    child: const Icon(Icons.add),
                  ),
                  const SizedBox(width: 16),
                  FloatingActionButton.small(
                    heroTag: 'legend_toggle',
                    backgroundColor: Colors.white,
                    foregroundColor: Colors.black87,
                    elevation: 2,
                    onPressed: () =>
                        setState(() => _mapLegendExpanded = !_mapLegendExpanded),
                    tooltip:
                        _mapLegendExpanded ? 'Hide layers' : 'Show layers',
                    child: Icon(
                      _mapLegendExpanded
                          ? Icons.layers
                          : Icons.layers_outlined,
                      size: 20,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoPage extends StatelessWidget {
  const _InfoPage();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('About')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text(
            'Moremi Wildlife Sightings',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 12),
          const Text(
            'This app is for recording wildlife sightings in the Moremi area. '
            'The sightings map shows everyone’s logged sightings from the last seven days (older than that roll off). '
            'Sign in to view and add sightings.\n\n'
            'Use Groups to create or join a team via invite code or QR. Your profile still lists your own sightings '
            '(private queue plus any you submitted while in a group).\n\n'
            'Submit queued sightings from your profile when you have signal.\n\n'
            'The Water toggle loads the latest Okavango water outline (internet required).',
            style: TextStyle(fontSize: 16, height: 1.4),
          ),
          const SizedBox(height: 28),
          const Text(
            'Supporting local conservation initiatives',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 10),
          const Text(
            'This app seeks to support local conservation NGOs through fundraising on this platform '
            'and by providing them with context-specific data that also comes through this app.\n\n'
            'If you wish to contribute to these initiatives (all of them, or directly to a particular one), '
            'please use the button below to read more.',
            style: TextStyle(fontSize: 16, height: 1.4),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: () {
              Navigator.push<void>(
                context,
                MaterialPageRoute(
                  builder: (context) => const _ConservationSupportPage(),
                ),
              );
            },
            icon: const Icon(Icons.favorite_outline),
            label: const Text('Read more about supported NGOs'),
          ),
        ],
      ),
    );
  }
}

/// Placeholder page — replace NGO copy and links when your content is ready.
class _ConservationSupportPage extends StatelessWidget {
  const _ConservationSupportPage();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Conservation partners')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: const [
          Text(
            'Local conservation initiatives',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
          ),
          SizedBox(height: 12),
          Text(
            'Moremi Wildlife Sightings partners with NGOs working in and around the Okavango '
            'and Moremi area. Sightings and group data shared through this app can help partners '
            'with monitoring, outreach, and on-the-ground conservation.\n\n'
            'Descriptions of each supported organisation and how to contribute will be added here. '
            'You will be able to donate to the collective fund or choose a specific partner.',
            style: TextStyle(fontSize: 16, height: 1.45),
          ),
          SizedBox(height: 24),
          Text(
            'Coming soon',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          SizedBox(height: 8),
          Text(
            '• Partner organisation profiles\n'
            '• How sighting data supports each NGO\n'
            '• Links to contribute (general or per organisation)',
            style: TextStyle(fontSize: 15, height: 1.5),
          ),
        ],
      ),
    );
  }
}

class WildlifeProfilePage extends StatefulWidget {
  const WildlifeProfilePage({
    super.key,
    required this.onSyncRequested,
    required this.onSignedOut,
    this.onDataChanged,
    this.showAppUpdateBadge = false,
  });

  final Future<void> Function() onSyncRequested;
  final VoidCallback onSignedOut;
  final VoidCallback? onDataChanged;
  final bool showAppUpdateBadge;

  @override
  State<WildlifeProfilePage> createState() => WildlifeProfilePageState();
}

class WildlifeProfilePageState extends State<WildlifeProfilePage> {
  List<Map<String, dynamic>> _mine = [];
  bool _loading = false;
  String? _error;
  DateTime? _filterStart;
  DateTime? _filterEnd;
  StreamSubscription<User?>? _authSub;

  final _offline = Hive.box('offlineData');

  List<Map<String, dynamic>> _localPendingRows() {
    final uid = moremiAuthUid();
    final out = <Map<String, dynamic>>[];
    for (final k in _offline.keys) {
      final raw = _offline.get(k);
      if (raw is! Map) continue;
      if (raw['category'] != 'Sighting' || raw['synced'] == true) continue;
      if (uid != null && raw['owner_uid']?.toString() != uid) continue;
      final m = Map<String, dynamic>.from(raw);
      m['_localPending'] = true;
      out.add(m);
    }
    out.sort((a, b) => moremiRowTime(b).compareTo(moremiRowTime(a)));
    return out;
  }

  List<Map<String, dynamic>> _mergedMine() {
    return [..._localPendingRows(), ..._mine];
  }

  List<Map<String, dynamic>> _filteredMine() {
    var list = _mergedMine();
    if (_filterStart != null) {
      final s = DateTime(_filterStart!.year, _filterStart!.month, _filterStart!.day);
      list = list.where((row) {
        final t = moremiRowTime(row);
        return !t.isBefore(s);
      }).toList();
    }
    if (_filterEnd != null) {
      final e = DateTime(_filterEnd!.year, _filterEnd!.month, _filterEnd!.day)
          .add(const Duration(days: 1));
      list = list.where((row) {
        final t = moremiRowTime(row);
        return t.isBefore(e);
      }).toList();
    }
    list.sort((a, b) => moremiRowTime(b).compareTo(moremiRowTime(a)));
    return list;
  }

  Map<String, int> _speciesTotals(Iterable<Map<String, dynamic>> rows) {
    final m = <String, int>{};
    for (final s in rows) {
      final a = s['animal']?.toString() ?? 'Unknown';
      final c = (s['sighting_count'] as num?)?.toInt() ?? 1;
      m[a] = (m[a] ?? 0) + c;
    }
    final entries = m.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
    return Map.fromEntries(entries);
  }

  Future<void> _pickFilterStart() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: _filterStart ?? now,
      firstDate: DateTime(now.year - 10),
      lastDate: DateTime(now.year + 1),
    );
    if (d != null && mounted) setState(() => _filterStart = d);
  }

  Future<void> _pickFilterEnd() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: _filterEnd ?? now,
      firstDate: DateTime(now.year - 10),
      lastDate: DateTime(now.year + 1),
    );
    if (d != null && mounted) setState(() => _filterEnd = d);
  }

  /// Refresh Activity list and pending outbox (e.g. after map submit or sync).
  void refreshActivityPublic() {
    if (!mounted) return;
    setState(() {});
    _loadMine();
  }

  @override
  void initState() {
    super.initState();
    _authSub = FirebaseAuth.instance.authStateChanges().listen((_) {
      if (!mounted) return;
      setState(() {});
      _loadMine();
    });
    scheduleMicrotask(() async {
      final uid = FirebaseAuth.instance.currentUser?.uid;
      if (uid == null || !mounted) return;
      await MoremiFirestoreService.instance.ensureProfileExists(uid);
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _authSub?.cancel();
    super.dispose();
  }

  Future<void> _loadMine() async {
    await MoremiFirebaseSession.ensureSignedIn();
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) {
      setState(() {
        _error = 'Not signed in';
        _loading = false;
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await MoremiFirestoreService.instance.fetchMySightingsForProfile(uid);
      if (!mounted) return;
      setState(() {
        _mine = rows;
        _loading = false;
      });
      widget.onDataChanged?.call();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = navigatorOnLine()
            ? 'Could not load your sightings ($e)'
            : 'Offline — showing this device’s queued sightings only. Connect to refresh from Firestore.';
      });
    }
  }

  Future<void> _signOut() async {
    try {
      await FirebaseAuth.instance.signOut();
    } catch (_) {}
    signOutMoremi();
    widget.onSignedOut();
  }

  @override
  Widget build(BuildContext context) {
    final uid = moremiAuthUid();
    final pending = _offline.values.where((item) {
      if (item is! Map) return false;
      if (item['category'] != 'Sighting' || item['synced'] == true) return false;
      if (uid != null && item['owner_uid']?.toString() != uid) return false;
      return true;
    }).length;

    final filtered = _filteredMine();
    final totals = _speciesTotals(filtered);

    final scheme = Theme.of(context).colorScheme;

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Builder(
            builder: (context) {
              final u = FirebaseAuth.instance.currentUser;
              if (u == null) {
                return Text(localStorageGet('authenticatedUserName') ?? 'User');
              }
              return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
                stream: MoremiFirestoreService.instance.userProfileStream(u.uid),
                builder: (context, snap) {
                  final fromFs = snap.data?.data()?['username']?.toString().trim();
                  final fromAuth = u.displayName?.trim();
                  final fromSlug = localStorageGet('authenticatedUsername')?.trim();
                  final fromLs = localStorageGet('authenticatedUserName')?.trim();
                  final fromEmail = u.email != null && u.email!.contains('@')
                      ? u.email!.split('@').first.trim()
                      : null;
                  bool ok(String? c) =>
                      c != null &&
                      c.isNotEmpty &&
                      c.toLowerCase() != 'user';
                  String display(String fallback) {
                    for (final c in [fromFs, fromSlug, fromAuth, fromLs, fromEmail]) {
                      if (ok(c)) return c!;
                    }
                    return fallback;
                  }

                  return Text(display('User'));
                },
              );
            },
          ),
          actions: [
            TextButton(
              onPressed: _signOut,
              child: const Text('Sign out', style: TextStyle(color: Colors.white)),
            ),
          ],
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(52),
            child: Material(
              color: scheme.surface,
              elevation: 0,
              child: TabBar(
                indicatorColor: scheme.primary,
                labelColor: scheme.onSurface,
                unselectedLabelColor: scheme.onSurfaceVariant,
                dividerColor: scheme.outlineVariant,
                tabs: [
                  const Tab(text: 'Activity'),
                  Tab(
                    height: 48,
                    child: Badge(
                      isLabelVisible: widget.showAppUpdateBadge && kIsWeb,
                      label: const Text('1'),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'Settings',
                            style: TextStyle(
                              color: scheme.onSurface,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(width: 6),
                          MoremiCogNavIcon(color: scheme.onSurface, size: 22),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        body: TabBarView(
          children: [
            RefreshIndicator(
              onRefresh: () async {
                await _loadMine();
                await widget.onSyncRequested();
              },
              child: CustomScrollView(
                slivers: [
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (FirebaseAuth.instance.currentUser == null) ...[
                            Material(
                              color: Colors.deepOrange.shade50,
                              borderRadius: BorderRadius.circular(12),
                              child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.stretch,
                                  children: [
                                    Text(
                                      'Not signed in',
                                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                                            fontWeight: FontWeight.w700,
                                            color: Colors.deepOrange.shade900,
                                          ),
                                    ),
                                    const SizedBox(height: 6),
                                    Text(
                                      'This device may still show your name, but there is no active Firebase session '
                                      '(common after installing the app or when the session expired). '
                                      'Use Sign out below, then sign in again.',
                                      style: TextStyle(fontSize: 13, color: Colors.grey.shade800),
                                    ),
                                    const SizedBox(height: 10),
                                    OutlinedButton.icon(
                                      onPressed: _signOut,
                                      icon: const Icon(Icons.logout),
                                      label: const Text('Sign out now'),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(height: 16),
                          ],
                          Text(
                            'Offline outbox',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            '$pending unsynced sighting(s) on this device',
                            style: TextStyle(color: Colors.grey.shade700),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Sightings are saved to this device when you are offline, then sent when you tap sync or when you come back online.',
                            style: TextStyle(color: Colors.grey.shade700, fontSize: 13),
                          ),
                          const SizedBox(height: 12),
                          FilledButton.icon(
                            onPressed: navigatorOnLine()
                                ? () async {
                                    await widget.onSyncRequested();
                                    await _loadMine();
                                    if (context.mounted) setState(() {});
                                  }
                                : null,
                            icon: const Icon(Icons.cloud_upload),
                            label: const Text('Submit pending sightings'),
                          ),
                          if (!navigatorOnLine())
                            const Padding(
                              padding: EdgeInsets.only(top: 8),
                              child: Text(
                                'Connect to the internet to sync.',
                                style: TextStyle(fontSize: 13),
                              ),
                            ),
                          const Divider(height: 32),
                          Text(
                            'Filter by date',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              OutlinedButton.icon(
                                onPressed: _pickFilterStart,
                                icon: const Icon(Icons.date_range, size: 18),
                                label: Text(
                                  _filterStart == null
                                      ? 'From (any)'
                                      : '${_filterStart!.year}-${_filterStart!.month.toString().padLeft(2, '0')}-${_filterStart!.day.toString().padLeft(2, '0')}',
                                ),
                              ),
                              OutlinedButton.icon(
                                onPressed: _pickFilterEnd,
                                icon: const Icon(Icons.date_range, size: 18),
                                label: Text(
                                  _filterEnd == null
                                      ? 'To (any)'
                                      : '${_filterEnd!.year}-${_filterEnd!.month.toString().padLeft(2, '0')}-${_filterEnd!.day.toString().padLeft(2, '0')}',
                                ),
                              ),
                              TextButton(
                                onPressed: () => setState(() {
                                  _filterStart = null;
                                  _filterEnd = null;
                                }),
                                child: const Text('Clear dates'),
                              ),
                            ],
                          ),
                          const Divider(height: 32),
                          Text(
                            'Totals by species (filtered)',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          if (totals.isEmpty)
                            Text(
                              'No sightings in this range.',
                              style: TextStyle(color: Colors.grey.shade700),
                            )
                          else
                            ...totals.entries.map(
                              (e) => Padding(
                                padding: const EdgeInsets.symmetric(vertical: 4),
                                child: Row(
                                  children: [
                                    Text(speciesEmoji(e.key), style: const TextStyle(fontSize: 22)),
                                    const SizedBox(width: 8),
                                    Expanded(child: Text(e.key)),
                                    Text(
                                      '${e.value}',
                                      style: const TextStyle(fontWeight: FontWeight.bold),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          const Divider(height: 32),
                          Text(
                            'All your sightings (filtered)',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          if (_error != null)
                            Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Text(_error!, style: TextStyle(color: Colors.red.shade800)),
                            ),
                        ],
                      ),
                    ),
                  ),
                  if (_loading && _mine.isEmpty && _localPendingRows().isEmpty)
                    SliverFillRemaining(
                      hasScrollBody: false,
                      child: Center(
                        child: MoremiPangolinLoadingIndicator(size: 44),
                      ),
                    )
                  else
                    SliverList(
                      delegate: SliverChildBuilderDelegate(
                        (context, i) {
                          final s = filtered[i];
                          final t = moremiRowTime(s).toLocal().toIso8601String();
                          final animal = s['animal']?.toString() ?? '';
                          final n = s['sighting_count'] ?? 1;
                          final pendingRow = s['_localPending'] == true;
                          final legacy = s['_legacyObservation'] == true;
                          return ListTile(
                            leading: Text(speciesEmoji(animal), style: const TextStyle(fontSize: 28)),
                            title: Text(
                              '$animal × $n${pendingRow ? ' (not synced)' : ''}${legacy ? ' (classic app)' : ''}',
                            ),
                            subtitle: Text(t),
                          );
                        },
                        childCount: filtered.length,
                      ),
                    ),
                ],
              ),
            ),
            ListView(
              padding: const EdgeInsets.all(16),
              children: [
                OutlinedButton.icon(
                  onPressed: _signOut,
                  icon: const Icon(Icons.logout),
                  label: const Text('Sign out'),
                  style: OutlinedButton.styleFrom(foregroundColor: Colors.red.shade800),
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 8, bottom: 8),
                  child: Text(
                    'If the app says you are not logged in, sign out here and sign in again '
                    '(same as a full refresh in the browser).',
                    style: TextStyle(fontSize: 13, color: Colors.grey.shade700),
                  ),
                ),
                const Divider(height: 24),
                MoremiProfileEditorCard(
                  onSaved: () {
                    _loadMine();
                    widget.onDataChanged?.call();
                  },
                ),
                const SizedBox(height: 20),
                Text('App updates', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 6),
                Text(
                  'Installs the latest web app from the site (clears the offline cache, then reloads).',
                  style: TextStyle(fontSize: 13, color: Colors.grey.shade700),
                ),
                const SizedBox(height: 10),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Badge(
                    isLabelVisible: widget.showAppUpdateBadge && kIsWeb,
                    label: const Text('1'),
                    child: FilledButton.icon(
                      onPressed: kIsWeb ? () => moremiAckAndForceAppUpdate() : null,
                      icon: const Icon(Icons.system_update),
                      label: const Text('Update app'),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                const MoremiPasswordChangeCard(),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
