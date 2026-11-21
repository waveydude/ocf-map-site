/* Only public Fair map resources participate in the offline pack. */
const VERSION = "ocf-v10-fair-pack";
const DATA_V = "2026-3";
const MAP_YEAR = 2026;
const BASE_URL = self.registration.scope;
const BASE = new URL(BASE_URL).pathname;
const archive = new URL(`datasets/${MAP_YEAR}/bootstrap.json`, BASE_URL).href;
const bootstrap = new URL("bootstrap.json", BASE_URL).href;
const shellAssets = ["manifest.json", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
const mapAssets = [
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
].map((path) => new URL(path, BASE_URL).href);

function shellResources(html) {
  const urls = [...html.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)]
    .map((match) => new URL(match[1], BASE_URL))
    .filter((url) => url.origin === self.location.origin &&
      url.pathname.startsWith(`${BASE}_next/static/`) && /\.(js|css|woff2?)$/.test(url.pathname));
  if (!urls.some((url) => url.pathname.endsWith(".js")) || !urls.some((url) => url.pathname.endsWith(".css"))) {
    throw new Error("Incomplete app shell");
  }
  return [...new Set([...urls.map((url) => url.href), ...shellAssets.map((path) => new URL(path, BASE_URL).href)])];
}

async function valid(response, url) {
  if (!response?.ok) return false;
  const { pathname } = new URL(url);
  try {
    if (url === BASE_URL) {
      shellResources(await response.clone().text());
    } else if (url === bootstrap || url === archive) {
      const body = await response.clone().json();
      return body.year === MAP_YEAR && Array.isArray(body.categories) && body.categories.length > 0 &&
        Array.isArray(body.locations) && body.locations.length > 0 &&
        body.locations.every((place) => typeof place?.name === "string" &&
          Array.isArray(place.categories) && Array.isArray(place.events) &&
          Number.isFinite(place.lng) && Number.isFinite(place.lat));
    } else if (pathname.endsWith(".geojson")) {
      const body = await response.clone().json();
      return body.type === "FeatureCollection" && Array.isArray(body.features);
    } else if (pathname.endsWith("routing-graph.json")) {
      const body = await response.clone().json();
      const nodes = new Set(body.nodes.map((node) => node.id));
      return nodes.size === body.nodes.length && nodes.size > 0 &&
        body.nodes.every((node) => node.lngLat?.length === 2 && node.lngLat.every(Number.isFinite)) &&
        body.edges.length > 0 && body.edges.every((edge) =>
          nodes.has(edge.a) && nodes.has(edge.b) && edge.a !== edge.b && Number.isFinite(edge.meters) && edge.meters > 0);
    } else {
      const type = response.headers.get("content-type") ?? "";
      if (type.includes("text/html") || response.headers.get("content-length") === "0") return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function download(url) {
  return fetch(url, { cache: "reload", signal: AbortSignal.timeout(12_000) });
}

async function ensureResource(cache, url, repair) {
  const existing = await cache.match(url);
  if (await valid(existing, url)) return;
  if (!repair) throw new Error(`Missing offline map resource: ${url}`);
  const response = await download(url);
  if (!(await valid(response, url))) throw new Error(`Invalid offline map resource: ${url}`);
  await cache.put(url, response);
}

async function saveShell(cache, response) {
  if (!(await valid(response, BASE_URL))) throw new Error("Invalid Fair map shell");
  const resources = shellResources(await response.clone().text());
  await Promise.all(resources.map((url) => ensureResource(cache, url, true)));
  // Publish HTML only after every asset it references is available.
  await cache.put(BASE_URL, response);
}

async function saveBootstrap(cache) {
  for (const url of [bootstrap, archive]) {
    try {
      const response = await download(url);
      if (await valid(response, url)) {
        await cache.put(bootstrap, response);
        return;
      }
    } catch (error) {
      console.warn("Offline Fair snapshot unavailable", url, error);
    }
  }
  throw new Error("No valid Fair snapshot");
}

async function auditPack(repair) {
  const cache = await caches.open(VERSION);
  const page = await cache.match(BASE_URL);
  const snapshot = await cache.match(bootstrap);
  await Promise.all([
    (async () => {
      if (!(await valid(page, BASE_URL))) {
        if (!repair) throw new Error("Fair app shell is missing");
        await saveShell(cache, await download(BASE_URL));
      } else {
        const urls = shellResources(await page.text());
        await Promise.all(urls.map((url) => ensureResource(cache, url, repair)));
      }
    })(),
    (async () => {
      if (await valid(snapshot, bootstrap)) return;
      if (!repair) throw new Error("Fair places are missing");
      await saveBootstrap(cache);
    })(),
    ...mapAssets.map((url) => ensureResource(cache, url, repair)),
  ]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(auditPack(true).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const port = event.ports[0];
  const type = event.data?.type;
  if (!port || !["check-offline-map", "repair-offline-map"].includes(type)) return;
  event.waitUntil(auditPack(type === "repair-offline-map").then(
    () => port.postMessage({ ready: true }),
    () => port.postMessage({ ready: false }),
  ));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  const isShell = event.request.mode === "navigate" && url.pathname === BASE;
  const isBootstrap = url.href === bootstrap || url.href === archive ||
    (url.pathname === `${BASE}api/bootstrap` && (!url.searchParams.has("year") || url.searchParams.get("year") === String(MAP_YEAR)));
  const isAsset = mapAssets.includes(url.href) || url.pathname.startsWith(`${BASE}_next/static/`);
  if (!isShell && !isBootstrap && !isAsset) return;

  const cache = caches.open(VERSION);
  const key = isShell ? BASE_URL : isBootstrap ? bootstrap : url.href;
  // Schedule any background work while the event can legally be extended.
  const hit = cache.then(async (store) => {
    const response = await store.match(key);
    return (isShell || isBootstrap || url.pathname.endsWith("routing-graph.json") || url.pathname.endsWith(".geojson"))
      ? (await valid(response, key) ? response : undefined) : response;
  });
  const update = (async () => {
    const previous = await hit;
    if (previous && isAsset) return previous;
    try {
      const response = await download(event.request.url);
      const store = await cache;
      if (isShell) {
        await saveShell(store, response.clone());
      } else if (await valid(response, key)) {
        await store.put(key, response.clone());
      } else if (isBootstrap && !previous) {
        await saveBootstrap(store);
        return store.match(bootstrap);
      }
      return response;
    } catch {
      return previous;
    }
  })();
  event.waitUntil(update.then(() => undefined));
  event.respondWith((async () => (await hit) ?? (await update) ?? new Response(
    isShell ? "The offline map download is incomplete. Reconnect and reopen OCF Map." : "Offline map resource unavailable.",
    { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
  ))());
});
