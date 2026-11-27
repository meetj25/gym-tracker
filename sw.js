/* Gym Tracker offline support.
   The app page is served from a copy saved on the phone, so it opens instantly and works with no signal.
   Each time the app opens, the saved copy is checked against the server in the background (a tiny request when nothing
   changed, thanks to the ETag). When a new version was downloaded, the page shows "New version ready · Reload".
   Only the app page itself is handled here: Supabase, videos and images go straight to the network as before.
   Emergency switch: open the app with ?nosw in the address to remove this service worker and its cache. */
const CACHE = "gym-app-v1";
const SCOPE = self.registration.scope;              // e.g. https://meetj25.github.io/gym-tracker/
const isAppPage = u => { const p = u.origin + u.pathname; return p === SCOPE || p === SCOPE + "index.html"; };

/* a clean copy of a response: no redirect flag (Safari refuses redirected responses for page loads) */
async function clean(res){ const body = await res.blob(); return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers }); }
const sig = r => (r.headers.get("etag") || "") + "|" + (r.headers.get("last-modified") || "");

let running = null;
function refresh(){ return running || (running = (async () => {
  try {
    const res = await fetch(SCOPE, { cache: "no-cache", credentials: "same-origin" });
    if (!res.ok || res.type !== "basic") throw new Error("bad response " + res.status);
    const fresh = await clean(res); const cache = await caches.open(CACHE); const old = await cache.match(SCOPE);
    /* the headers say whether it changed; a difference is confirmed on the content, so a CDN quirk never shows a false update */
    const changed = !old || (sig(old) !== sig(fresh) && (await old.clone().text()) !== (await fresh.clone().text()));
    if (changed) await cache.put(SCOPE, fresh.clone());
    if (changed && old) { const cs = await self.clients.matchAll({ type: "window" }); cs.forEach(c => c.postMessage({ type: "app-updated" })); }
    return fresh;
  } finally { running = null; }
})()); }

self.addEventListener("install", e => { e.waitUntil(refresh().catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("gym-app-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET" || r.mode !== "navigate") return;
  const u = new URL(r.url); if (u.origin !== self.location.origin || !isAppPage(u) || u.searchParams.has("nosw")) return;
  const update = refresh(); e.waitUntil(update.catch(() => {}));
  e.respondWith(caches.open(CACHE).then(c => c.match(SCOPE)).then(hit => hit || update.then(x => x.clone()).catch(() => fetch(r))));
});
