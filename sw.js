/* OCF Map service worker — offline-first for the fairground (bad cell service).
 * - map data + routing graph + glyphs: cache-first (immutable per deploy)
 * - bootstrap data: cache-first with background refresh
 * - app shell + static assets: stale-while-revalidate
 * All paths are relative to the SW scope so the app works at any base path
 * (local dev at "/", GitHub Pages at "/ocf-map-site/").
 */
const VERSION = "ocf-v9-first-launch-offline";
const DATA_V = "real-2";
const MAP_CACHE = `${VERSION}-map`;
const DATA_CACHE = `${VERSION}-data`;
const SHELL_CACHE = `${VERSION}-shell`;

const BASE = new URL(self.registration ? self.registration.scope : "./", self.location.href).pathname;
const BASE_URL = new URL(BASE, self.location.origin).href;

async function cacheResponse(cache, request) {
  const response = await fetch(request, { cache: "reload" });
  if (!response.ok) throw new Error(`Could not precache ${request}: ${response.status}`);
  await cache.put(request, response.clone());
  return response;
}

/** Cache the HTML plus every same-origin stylesheet/script it references. */
async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  const page = await cacheResponse(cache, BASE_URL);
  const html = await page.text();
  const assetUrls = [...html.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)]
    .map((match) => new URL(match[1], BASE_URL))
    .filter((url) => url.origin === self.location.origin && url.pathname.startsWith(BASE));
  await Promise.all([...new Set(assetUrls.map((url) => url.href))].map((url) => cacheResponse(cache, url)));
}

async function precacheBootstrap() {
  const cache = await caches.open(DATA_CACHE);
  await cacheResponse(cache, new URL("bootstrap.json", BASE_URL).href);
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    Promise.all([
      caches.open(MAP_CACHE).then((c) =>
        c.addAll([
          `map/forest.geojson?v=${DATA_V}`,
          `map/meadows.geojson?v=${DATA_V}`,
          `map/areas.geojson?v=${DATA_V}`,
          `map/water.geojson?v=${DATA_V}`,
          `map/roads.geojson?v=${DATA_V}`,
          `map/paths.geojson?v=${DATA_V}`,
          `map/booths.geojson?v=${DATA_V}`,
          `map/labels.geojson?v=${DATA_V}`,
          `map/routing-graph.json?v=${DATA_V}`,
          "fonts/Open%20Sans%20Semibold/0-255.pbf",
          "fonts/Open%20Sans%20Semibold/256-511.pbf",
          "fonts/Open%20Sans%20Semibold/8192-8447.pbf",
          "assets/landmarks/main-stage/small.svg",
          "assets/landmarks/main-stage/day.svg",
          "assets/landmarks/main-stage/night.svg",
          "assets/landmarks/blue-moon/small.svg",
          "assets/landmarks/blue-moon/day.svg",
          "assets/landmarks/blue-moon/night.svg",
          "assets/landmarks/spirit-tower/small.svg",
          "assets/landmarks/spirit-tower/day.svg",
          "assets/landmarks/spirit-tower/night.svg",
          "assets/landmarks/dragon-plaza/small.svg",
          "assets/landmarks/dragon-plaza/day.svg",
          "assets/landmarks/dragon-plaza/night.svg",
          "assets/landmarks/spirit-lake/small.svg",
          "assets/landmarks/spirit-lake/day.svg",
          "assets/landmarks/spirit-lake/night.svg",
          "assets/landmarks/dance-pavilion/small.svg",
          "assets/landmarks/dance-pavilion/day.svg",
          "assets/landmarks/dance-pavilion/night.svg",
          "assets/landmarks/community-village/small.svg",
          "assets/landmarks/community-village/day.svg",
          "assets/landmarks/community-village/night.svg",
          "assets/landmarks/caravan/small.svg",
          "assets/landmarks/caravan/day.svg",
          "assets/landmarks/caravan/night.svg",
          "assets/landmarks/wc-fields/small.svg",
          "assets/landmarks/wc-fields/day.svg",
          "assets/landmarks/wc-fields/night.svg",
          "assets/landmarks/energy-park/small.svg",
          "assets/landmarks/energy-park/day.svg",
          "assets/landmarks/energy-park/night.svg",
          "assets/landmarks/front-porch/small.svg",
          "assets/landmarks/front-porch/day.svg",
          "assets/landmarks/front-porch/night.svg",
          "assets/landmarks/hoarse-chorale/small.svg",
          "assets/landmarks/hoarse-chorale/day.svg",
          "assets/landmarks/hoarse-chorale/night.svg",
        ])
      ),
      precacheShell(),
      precacheBootstrap(),
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin !== location.origin) return;

  // map layers + glyphs: cache-first
  if (url.pathname.startsWith(`${BASE}map/`) || url.pathname.startsWith(`${BASE}fonts/`)) {
    e.respondWith(
      caches.open(MAP_CACHE).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      })
    );
    return;
  }

  // Bootstrap is needed before the map can wake up. Return the installed
  // snapshot immediately, then refresh it without blocking weak connections.
  if (url.pathname === `${BASE}api/bootstrap` || url.pathname === `${BASE}bootstrap.json`) {
    e.respondWith(
      caches.open(DATA_CACHE).then(async (c) => {
        // Both the dynamic app and static export ask for the same data through
        // different paths. The installed snapshot is the canonical offline key.
        const snapshotKey = new URL("bootstrap.json", BASE_URL).href;
        const hit = await c.match(snapshotKey, { ignoreSearch: true });
        const refresh = fetch(e.request)
          .then((res) => {
            if (res.ok) c.put(snapshotKey, res.clone());
            return res;
          })
          .catch(() => undefined);
        if (hit) {
          e.waitUntil(refresh);
          return hit;
        }
        const response = await refresh;
        return response ?? new Response(JSON.stringify({ error: "offline, no cached map data" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      })
    );
    return;
  }

  if (url.pathname.startsWith(`${BASE}api/`)) return;

  // shell/static: stale-while-revalidate, navigation falls back to cached base
  e.respondWith(
    caches.open(SHELL_CACHE).then(async (c) => {
      const cacheKey = e.request.mode === "navigate" ? BASE : e.request;
      const hit = await c.match(cacheKey);
      const refresh = fetch(e.request)
        .then((res) => {
          if (res.ok) c.put(cacheKey, res.clone());
          return res;
        })
        .catch(() => hit);
      if (hit) {
        e.waitUntil(refresh);
        return hit;
      }
      const response = await refresh;
      return response ?? new Response("OCF Map is offline and has not finished its first download.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    })
  );
});
