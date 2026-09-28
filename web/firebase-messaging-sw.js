// Service worker: receives push reminders (Firebase Cloud Messaging) and
// caches the app shell so the app opens quickly and works offline.
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");
importScripts("/firebase-config.js");

if (self.FIREBASE_CONFIG && !String(self.FIREBASE_CONFIG.apiKey).startsWith("REPLACE")) {
  firebase.initializeApp(self.FIREBASE_CONFIG);
  // Messages that carry a `notification` payload are shown automatically
  // when the app is in the background.
  firebase.messaging();
}

const CACHE = "task-reminder-v1";
const SHELL = [
  "/", "/index.html", "/styles.css", "/app.js", "/urgency.js", "/firebase-config.js",
  "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== "sprites-v1").map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Pokémon sprites never change: cache first so they show up offline too.
const SPRITES = "https://raw.githubusercontent.com/PokeAPI/sprites/";
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !event.request.url.startsWith(SPRITES)) return;
  event.respondWith(
    caches.open("sprites-v1").then(async (c) => {
      const hit = await c.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok || res.type === "opaque") c.put(event.request, res.clone());
      return res;
    }),
  );
});

// Network first for our own files (so updates show up right away),
// falling back to the cache when offline. Everything else passes through.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/__/")) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match("/index.html"))),
  );
});

// Tapping a notification focuses the open app, or opens it.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) if ("focus" in w) return w.focus();
      return self.clients.openWindow("/");
    }),
  );
});
