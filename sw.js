const CACHE_PREFIX = "ssw-tg2-manufacturing-";
const CACHE_NAME = CACHE_PREFIX + "v1.0.1";
const SHELL = ["./", "./index.html", "./styles-v2.css", "./app-v2.js", "./core-v2.js",
  "./storage-v2.js", "./furigana-v2.js", "./questions.json", "./furigana.json", "./image-furigana.json", "./manifest.json", "./icon-v2.png"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Keep the previous worker and its complete cache until the new shell is ready.
    await cache.addAll(SHELL);
    const questions = await (await cache.match("./questions.json")).json();
    if (!Array.isArray(questions) || questions.length < 30 || questions.some(q => !Array.isArray(q.choices) || q.choices.length !== 4)) throw new Error("Incomplete question data");
    const images = [...new Set(questions.map(question => question.image).filter(Boolean))];
    await Promise.all(images.map(async path => {
      const response = await fetch(new URL(path, self.registration.scope), { cache: "reload" });
      if (!response.ok) throw new Error("Missing offline diagram: " + path);
      await cache.put("./" + path, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) {
        await caches.delete(name);
      }
    }
    await self.clients.claim();
  })());
});

async function networkFirst(request, fallbackKey = request) {
  const cache = await caches.open(CACHE_NAME);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(request, { cache: "no-store", signal: controller.signal });
    if (response.ok) {
      try { await cache.put(fallbackKey, response.clone()); } catch (error) { console.warn("Cache write failed", error); }
      return response;
    }
    return (await cache.match(fallbackKey)) || response;
  } catch {
    return (await cache.match(fallbackKey)) || new Response("Offline resource unavailable", { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "./index.html"));
  } else if (/\.(?:js|css|json)$/.test(url.pathname)) {
    // Updated code and data win online; the matching v2 cache works offline.
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(request)) || networkFirst(request);
    })());
  }
});
