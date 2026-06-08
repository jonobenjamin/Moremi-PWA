'use strict';
const MANIFEST = 'flutter-app-manifest';
const TEMP = 'flutter-temp-cache';
const CACHE_NAME = 'flutter-app-cache';

const RESOURCES = {"flutter_bootstrap.js": "e554499f394d8c1b673d8dfeb0d9bcb7",
"auth-ui.js": "dd641d7f13591576a61c22e5f1beebec",
"version.json": "b359803206879e1d7961102c7506ac90",
"moremi-scoped-storage.js": "c2d4f6b1e74de57e46212c7332c74f3b",
"index.html": "f9bbfcb196ce0ae861652309b30edb29",
"/": "f9bbfcb196ce0ae861652309b30edb29",
"auth-service.js": "a25ccd5e721998e5d14cf07edac1bebe",
"main.dart.js": "2bc8977efbfe440fa36301020be6c62d",
"flutter.js": "24bc71911b75b5f8135c949e27a2984e",
"auth-controller.js": "cc2a3cd079b8649efe6e8bc99333ca8a",
"favicon.png": "5dcef449791fa27946b3d35ad8803796",
"index.custom.html": "cd848fbffa8cded29cf544ccb66a762f",
"moremi_build.json": "826cebc32ea63336bc6f68b33dc55ee2",
"icons/Icon-192.png": "0658615ef1bdea8a662d5bb1c68d97b6",
"icons/Icon-maskable-192.png": "0658615ef1bdea8a662d5bb1c68d97b6",
"icons/KPR_logo.png": "f70391debeb086a102e3f8fe1a447937",
"icons/Logo_icon.png": "319134ea387aa3f5cbf0f4599dc40eab",
"icons/Icon-maskable-512.png": "f47886b0a99aeb0b6fc9ee305d3b4975",
"icons/KPR_icon.png": "893ac2e2763c1ad90322d3bf662fc931",
"icons/Icon-512.png": "f47886b0a99aeb0b6fc9ee305d3b4975",
"app-update.js": "a4affabcd17d4f14e8c2e428a251ae0b",
"moremi-storage.js": "be0335e7f0ebb3941d66be372b859e82",
"manifest.json": "5c5b07b7c9b1cb74210f81ac30130da7",
"firebase-config.js": "5648325c2bf95eb98cb955eff80be4d9",
"assets/AssetManifest.json": "925fb9ab63aff81cc8d7dbd457441512",
"assets/NOTICES": "0db2229f6edb34188fc05945620ac405",
"assets/KPR.svg": "36a2ad74d4133532d672f08066458352",
"assets/FontManifest.json": "dc3d03800ccca4601324923c0b1d6d57",
"assets/AssetManifest.bin.json": "925fb9ab63aff81cc8d7dbd457441512",
"assets/packages/cupertino_icons/assets/CupertinoIcons.ttf": "33b7d9392238c04c131b6ce224e13711",
"assets/packages/flutter_map/lib/assets/flutter_map_logo.png": "208d63cc917af9713fc9572bd5c09362",
"assets/shaders/ink_sparkle.frag": "ecc85a2e95f5e9f53123dcaf8cb9b6ce",
"assets/shaders/stretch_effect.frag": "40d68efbbf360632f614c731219e95f0",
"assets/AssetManifest.bin": "0f9f2c521ad7d0a0f6f36680f2e1fb57",
"assets/fonts/MaterialIcons-Regular.otf": "cf8b511a44c24f97118261f9086829a7",
"assets/assets/camp.svg": "41c88676ab517d43f611890327b0fd5c",
"assets/assets/lodge.svg": "f6ee6ce79b0b21805dcd95ffed24677f",
"assets/assets/bots_pois.geojson": "0d40658a09e2bf2fe91380f49846e8f2",
"assets/assets/magnifying.svg": "fa9172f7d39a95582c93a702a75dc86d",
"assets/assets/gate.svg": "3984de2c6d9dc77a8bcc03281dc906c2",
"assets/assets/Camps.geojson": "c94d53128caaceb8ee80cc9b99c27e0b",
"assets/assets/Moremi_roads.geojson": "dc097ba77813390cee7aa02cd5187441",
"assets/assets/bots_roads.geojson": "b11e40cdd0901d22bb7c529d28b5709d",
"assets/assets/pangolin_loading.svg": "c855c65681b73b9916fc3ac4b57abe4d",
"assets/assets/Moremi_boundary.geojson": "305cf978681b9325e08175952572a75b",
"assets/assets/bots_roads.qmd": "6cbfff70a3ef84cd7443a8ec3d2caa78",
"assets/assets/nat_parks.geojson": "626ddd895d7516261bdbf1eab541b43d",
"assets/assets/nat_parks.qmd": "6cbfff70a3ef84cd7443a8ec3d2caa78",
"assets/assets/binoculars.svg": "c02c790dab7bbf98db3a3fe9c5fd4a53",
"pwa-install.js": "7031d42e3d7dd5a0fd1d9360d2a22095",
"canvaskit/skwasm.js": "8060d46e9a4901ca9991edd3a26be4f0",
"canvaskit/skwasm_heavy.js": "740d43a6b8240ef9e23eed8c48840da4",
"canvaskit/skwasm.js.symbols": "3a4aadf4e8141f284bd524976b1d6bdc",
"canvaskit/canvaskit.js.symbols": "a3c9f77715b642d0437d9c275caba91e",
"canvaskit/skwasm_heavy.js.symbols": "0755b4fb399918388d71b59ad390b055",
"canvaskit/skwasm.wasm": "7e5f3afdd3b0747a1fd4517cea239898",
"canvaskit/chromium/canvaskit.js.symbols": "e2d09f0e434bc118bf67dae526737d07",
"canvaskit/chromium/canvaskit.js": "a80c765aaa8af8645c9fb1aae53f9abf",
"canvaskit/chromium/canvaskit.wasm": "a726e3f75a84fcdf495a15817c63a35d",
"canvaskit/canvaskit.js": "8331fe38e66b3a898c4f37648aaf7ee2",
"canvaskit/canvaskit.wasm": "9b6a7830bf26959b200594729d73538e",
"canvaskit/skwasm_heavy.wasm": "b0be7910760d205ea4e011458df6ee01"};
// The application shell files that are downloaded before a service worker can
// start.
const CORE = ["main.dart.js",
"index.html",
"flutter_bootstrap.js",
"assets/AssetManifest.bin.json",
"assets/FontManifest.json"];

// During install, the TEMP cache is populated with the application shell files.
self.addEventListener("install", (event) => {
  self.skipWaiting();
  return event.waitUntil(
    caches.open(TEMP).then((cache) => {
      return cache.addAll(
        CORE.map((value) => new Request(value, {'cache': 'reload'})));
    })
  );
});
// During activate, the cache is populated with the temp files downloaded in
// install. If this service worker is upgrading from one with a saved
// MANIFEST, then use this to retain unchanged resource files.
self.addEventListener("activate", function(event) {
  return event.waitUntil(async function() {
    try {
      var contentCache = await caches.open(CACHE_NAME);
      var tempCache = await caches.open(TEMP);
      var manifestCache = await caches.open(MANIFEST);
      var manifest = await manifestCache.match('manifest');
      // When there is no prior manifest, clear the entire cache.
      if (!manifest) {
        await caches.delete(CACHE_NAME);
        contentCache = await caches.open(CACHE_NAME);
        for (var request of await tempCache.keys()) {
          var response = await tempCache.match(request);
          await contentCache.put(request, response);
        }
        await caches.delete(TEMP);
        // Save the manifest to make future upgrades efficient.
        await manifestCache.put('manifest', new Response(JSON.stringify(RESOURCES)));
        // Claim client to enable caching on first launch
        self.clients.claim();
        return;
      }
      var oldManifest = await manifest.json();
      var origin = self.location.origin;
      for (var request of await contentCache.keys()) {
        var key = request.url.substring(origin.length + 1);
        if (key == "") {
          key = "/";
        }
        // If a resource from the old manifest is not in the new cache, or if
        // the MD5 sum has changed, delete it. Otherwise the resource is left
        // in the cache and can be reused by the new service worker.
        if (!RESOURCES[key] || RESOURCES[key] != oldManifest[key]) {
          await contentCache.delete(request);
        }
      }
      // Populate the cache with the app shell TEMP files, potentially overwriting
      // cache files preserved above.
      for (var request of await tempCache.keys()) {
        var response = await tempCache.match(request);
        await contentCache.put(request, response);
      }
      await caches.delete(TEMP);
      // Save the manifest to make future upgrades efficient.
      await manifestCache.put('manifest', new Response(JSON.stringify(RESOURCES)));
      // Claim client to enable caching on first launch
      self.clients.claim();
      return;
    } catch (err) {
      // On an unhandled exception the state of the cache cannot be guaranteed.
      console.error('Failed to upgrade service worker: ' + err);
      await caches.delete(CACHE_NAME);
      await caches.delete(TEMP);
      await caches.delete(MANIFEST);
    }
  }());
});
// The fetch handler redirects requests for RESOURCE files to the service
// worker cache.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== 'GET') {
    return;
  }
  var origin = self.location.origin;
  var key = event.request.url.substring(origin.length + 1);
  // Redirect URLs to the index.html
  if (key.indexOf('?v=') != -1) {
    key = key.split('?v=')[0];
  }
  if (event.request.url == origin || event.request.url.startsWith(origin + '/#') || key == '') {
    key = '/';
  }
  // If the URL is not the RESOURCE list then return to signal that the
  // browser should take over.
  if (!RESOURCES[key]) {
    return;
  }
  // If the URL is the index.html, perform an online-first request.
  if (key == '/') {
    return onlineFirst(event);
  }
  event.respondWith(caches.open(CACHE_NAME)
    .then((cache) =>  {
      return cache.match(event.request).then((response) => {
        // Either respond with the cached resource, or perform a fetch and
        // lazily populate the cache only if the resource was successfully fetched.
        return response || fetch(event.request).then((response) => {
          if (response && Boolean(response.ok)) {
            cache.put(event.request, response.clone());
          }
          return response;
        });
      })
    })
  );
});
self.addEventListener('message', (event) => {
  // SkipWaiting can be used to immediately activate a waiting service worker.
  // This will also require a page refresh triggered by the main worker.
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
    return;
  }
  if (event.data === 'downloadOffline') {
    downloadOffline();
    return;
  }
});
// Download offline will check the RESOURCES for all files not in the cache
// and populate them.
async function downloadOffline() {
  var resources = [];
  var contentCache = await caches.open(CACHE_NAME);
  var currentContent = {};
  for (var request of await contentCache.keys()) {
    var key = request.url.substring(origin.length + 1);
    if (key == "") {
      key = "/";
    }
    currentContent[key] = true;
  }
  for (var resourceKey of Object.keys(RESOURCES)) {
    if (!currentContent[resourceKey]) {
      resources.push(resourceKey);
    }
  }
  return contentCache.addAll(resources);
}
// Attempt to download the resource online before falling back to
// the offline cache.
function onlineFirst(event) {
  return event.respondWith(
    fetch(event.request).then((response) => {
      return caches.open(CACHE_NAME).then((cache) => {
        cache.put(event.request, response.clone());
        return response;
      });
    }).catch((error) => {
      return caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((response) => {
          if (response != null) {
            return response;
          }
          throw error;
        });
      });
    })
  );
}
