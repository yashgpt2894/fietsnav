/* FietsNav service worker
   - App shell + Leaflet: stale-while-revalidate (fast open, auto-updates next load).
   - Map tiles: cache-first with a size cap (fast revisits + partial offline).
   - Routing / search / POIs (BRouter, Photon, Overpass): always network (live data). */
const SHELL = 'fietsnav-shell-v5';
const TILES = 'fietsnav-tiles-v1';
const TILE_CAP = 250;   // tiles are cross-origin/opaque; each inflates quota (~MBs), so cap low
const LOCAL = ['./', './index.html', './app.js', './scenic.brf', './smart.brf', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const CDN = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];
const DATA = /brouter\.de|photon\.komoot|overpass-api/;                       // live, never cache
const TILE = /tile-cyclosm|basemaps\.cartocdn|tile\.openstreetmap|waymarkedtrails|\.tile\./; // cacheable imagery

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    try { await c.addAll(LOCAL); } catch (err) {}
    await Promise.allSettled(CDN.map(u => c.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== SHELL && k !== TILES).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function trimCache(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  if (keys.length <= max) return;
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;

  if (DATA.test(url)) return;                                  // live data → straight to network

  if (TILE.test(url)) {                                        // tiles → cache-first, capped
    e.respondWith((async () => {
      const c = await caches.open(TILES);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const resp = await fetch(req);
        // tiles are loaded by <img> (no-cors) → opaque responses (status 0, ok false); cache those too
        if (resp && (resp.ok || resp.type === 'opaque')) { c.put(req, resp.clone()); trimCache(TILES, TILE_CAP); }
        return resp;
      } catch (err) {
        return hit || Response.error();
      }
    })());
    return;
  }

  // app shell + CDN → stale-while-revalidate
  e.respondWith((async () => {
    const c = await caches.open(SHELL);
    const cached = await c.match(req);
    const fetching = fetch(req).then(resp => {
      if (resp && resp.ok && (url.startsWith(self.location.origin) || CDN.some(u => url.startsWith(u.split('/dist')[0])))) {
        c.put(req, resp.clone());
      }
      return resp;
    }).catch(() => null);
    return cached || (await fetching) || caches.match('./index.html');
  })());
});
