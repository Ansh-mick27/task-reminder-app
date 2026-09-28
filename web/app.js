import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, getDoc, setDoc,
  serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getMessaging, getToken, deleteToken, onMessage, isSupported as messagingSupported,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js";
import { urgencyOf, passedMilestones, DAY, HOUR } from "./urgency.js";

const $ = (id) => document.getElementById(id);
const SPRITE = (n) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/${n}.gif`;

const SECTIONS = [
  { key: "red", title: "Urgent", hint: "less than 3 days", pokemon: 4 },     // Charmander
  { key: "yellow", title: "Coming up", hint: "3–7 days", pokemon: 25 },       // Pikachu
  { key: "green", title: "Later", hint: "more than 7 days", pokemon: 1 },     // Bulbasaur
];

const screens = ["loading", "setup", "login", "main"];
function show(name) {
  for (const s of screens) $(`screen-${s}`).hidden = s !== name;
}

function toast(msg, ms = 2600) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}

// ---------- Firebase setup ----------
const cfg = self.FIREBASE_CONFIG;
if (!cfg || String(cfg.apiKey).startsWith("REPLACE")) {
  show("setup");
  throw new Error("Firebase config missing — edit web/firebase-config.js");
}

const app = initializeApp(cfg);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

let swReg = null;
if ("serviceWorker" in navigator) {
  swReg = navigator.serviceWorker.register("/firebase-messaging-sw.js").catch((e) => {
    console.warn("Service worker registration failed", e);
    return null;
  });
}

let messaging = null;
const messagingReady = messagingSupported().then((ok) => {
  if (!ok) return null;
  messaging = getMessaging(app);
  onMessage(messaging, async (payload) => {
    // App is open: FCM doesn't show a system notification, so show one ourselves.
    const n = payload.notification || {};
    toast(`${n.title || "Reminder"} — ${n.body || ""}`, 5000);
    const reg = await swReg;
    reg?.showNotification(n.title || "Reminder", { body: n.body, icon: "/icons/icon-192.png", badge: "/icons/badge-72.png" });
  });
  return messaging;
}).catch(() => null);

// ---------- State ----------
let user = null;
let tasks = [];
let unsubTasks = null;
let editingId = null;
let doneOpen = false;
const catching = new Set();

// ---------- Auth ----------
getRedirectResult(auth).catch((e) => showLoginError(e));

$("btn-login").addEventListener("click", async () => {
  $("login-error").hidden = true;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-environment"].includes(e.code)) {
      await signInWithRedirect(auth, provider);
    } else if (!["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(e.code)) {
      showLoginError(e);
    }
  }
});

function showLoginError(e) {
  console.error(e);
  $("login-error").textContent = `Couldn't sign in (${e.code || e.message}). Please try again.`;
  $("login-error").hidden = false;
}

$("btn-logout").addEventListener("click", async () => {
  closeSheets();
  try {
    const token = localStorage.getItem("fcmToken");
    if (token && user) await deleteDoc(doc(db, "users", user.uid, "tokens", token));
    if (messaging) await deleteToken(messaging);
  } catch (e) { console.warn(e); }
  try { localStorage.removeItem("fcmToken"); } catch {}
  await signOut(auth);
});

onAuthStateChanged(auth, async (u) => {
  user = u;
  unsubTasks?.();
  unsubTasks = null;
  tasks = [];
  if (!u) {
    show("login");
    return;
  }
  $("user-name").textContent = u.displayName?.split(" ")[0] || "Trainer";
  $("avatar").src = u.photoURL || "/icons/icon-192.png";
  show("main");
  render();

  unsubTasks = onSnapshot(
    query(collection(db, "users", u.uid, "tasks"), orderBy("due", "asc")),
    (snap) => {
      tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    },
    (e) => toast(`Couldn't load tasks: ${e.code || e.message}`, 5000),
  );

  await initUserDoc(u);
  refreshNotifUI();
  // Keep the push token fresh if reminders were already allowed.
  if ("Notification" in window && Notification.permission === "granted") enableNotifications(true);
});

async function initUserDoc(u) {
  const ref = doc(db, "users", u.uid);
  try {
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    const summaryHour = typeof data.summaryHour === "number" ? data.summaryHour : 8;
    await setDoc(ref, {
      name: u.displayName || "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      summaryHour,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    $("summary-hour").value = String(summaryHour);
  } catch (e) {
    console.warn("user doc", e);
  }
}

// ---------- Notifications ----------
// Rejects if a step hangs (e.g. a permission prompt that never answers), so
// the button always ends with a result instead of silently doing nothing.
function withTimeout(promise, ms, what) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms)),
  ]);
}

let enabling = false;
let lastNotifError = "";
async function enableNotifications(silent = false) {
  if (enabling) return;
  const m = await messagingReady;
  if (!m || !("Notification" in window)) {
    if (!silent) toast("Notifications aren't supported in this browser.");
    return;
  }
  enabling = true;
  const buttons = [$("btn-enable-notif"), $("btn-banner-enable")];
  for (const b of buttons) { b.disabled = true; b.textContent = "Enabling…"; }
  try {
    const perm = silent ? Notification.permission : await withTimeout(Notification.requestPermission(), 60000, "Permission prompt");
    if (perm !== "granted") {
      if (!silent) toast("Notifications are blocked. Allow them in your browser settings.");
      return;
    }
    // Push subscriptions need an active service worker, not just a registered one.
    await withTimeout(swReg, 15000, "Service worker");
    const reg = await withTimeout(navigator.serviceWorker.ready, 15000, "Service worker");
    const token = await withTimeout(
      getToken(m, { vapidKey: self.FIREBASE_VAPID_KEY, serviceWorkerRegistration: reg }), 20000, "Push registration");
    if (!token || !user) return;
    await setDoc(doc(db, "users", user.uid, "tokens", token), {
      createdAt: serverTimestamp(),
      userAgent: navigator.userAgent.slice(0, 200),
    }, { merge: true });
    try { localStorage.setItem("fcmToken", token); } catch {}
    if (!silent) toast("Reminders are on! 🔔");
  } catch (e) {
    console.error(e);
    lastNotifError = `${e.name || ""} ${e.code || ""} ${e.message || ""}`.trim();
    if (silent) return;
    const msg = `${e.code || ""} ${e.message || ""}`;
    if (/permission denied|permission-blocked|NotAllowedError/i.test(msg) && !/firestore/i.test(msg)) {
      // In the Android app, the site's notification setting in Chrome must
      // also be "Allow", separately from the app's own Android permission.
      toast("Chrome is blocking notifications for this app. In Chrome, open task-reminder-f7a06.web.app → tap the icon left of the address → Permissions → Notifications → Allow. Then reopen the app.", 12000);
    } else {
      toast(`Couldn't enable reminders: ${e.code || e.message}`, 8000);
    }
  } finally {
    enabling = false;
    for (const b of buttons) { b.disabled = false; b.textContent = "Enable"; }
    refreshNotifUI();
  }
}

function hasPushToken() {
  try { return !!localStorage.getItem("fcmToken"); } catch { return false; }
}

async function refreshNotifUI() {
  const supported = !!(await messagingReady) && "Notification" in window;
  let perm = supported ? Notification.permission : "unsupported";
  // Permission alone isn't enough: this device must also be registered for push.
  if (perm === "granted" && !hasPushToken()) perm = "unregistered";
  const status = {
    granted: "On — you'll get alerts on this device",
    unregistered: "Allowed, but not set up on this device yet",
    denied: "Blocked — allow notifications in browser settings",
    default: "Off",
    unsupported: "Not supported in this browser",
  }[perm];
  $("notif-status").textContent = status;
  const canEnable = perm === "default" || perm === "unregistered";
  $("btn-enable-notif").hidden = !canEnable;
  $("notif-banner").hidden = !canEnable;
  renderNotifDiag();
}

// What the browser reports about notifications/push on this device, shown
// under Settings → "Reminder details" to help troubleshoot.
async function renderNotifDiag() {
  const q = async (desc) => {
    try { return (await navigator.permissions.query(desc)).state; } catch (e) { return `n/a (${e.name})`; }
  };
  let sw = "none";
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) sw = reg.active ? `active (${reg.active.state})` : reg.installing ? "installing" : reg.waiting ? "waiting" : "registered";
  } catch {}
  let sub = "none";
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.pushManager) sub = (await reg.pushManager.getSubscription()) ? "yes" : "none";
  } catch (e) { sub = `error (${e.name})`; }
  $("notif-diag").textContent = [
    `Notification.permission: ${"Notification" in window ? Notification.permission : "unsupported"}`,
    `notifications permission: ${await q({ name: "notifications" })}`,
    `push permission: ${await q({ name: "push", userVisibleOnly: true })}`,
    `service worker: ${sw}`,
    `push subscription: ${sub}`,
    `saved token on this device: ${hasPushToken() ? "yes" : "no"}`,
    `installed app (standalone): ${matchMedia("(display-mode: standalone)").matches ? "yes" : "no"}`,
    `last error: ${lastNotifError || "none"}`,
    `browser: ${navigator.userAgent}`,
  ].join("\n");
}

$("btn-enable-notif").addEventListener("click", () => enableNotifications());
$("btn-banner-enable").addEventListener("click", () => enableNotifications());

// Daily summary hour picker
(function fillSummaryHours() {
  const sel = $("summary-hour");
  sel.add(new Option("Off", "-1"));
  for (let h = 0; h < 24; h++) {
    const label = new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    sel.add(new Option(label, String(h)));
  }
  sel.value = "8";
  sel.addEventListener("change", async () => {
    if (!user) return;
    await setDoc(doc(db, "users", user.uid), { summaryHour: Number(sel.value) }, { merge: true });
    toast(sel.value === "-1" ? "Daily summary off" : "Daily summary time saved");
  });
})();

// ---------- Rendering ----------
function dueMs(t) {
  return t.due?.toMillis ? t.due.toMillis() : 0;
}

function relative(ms, now = Date.now()) {
  const diff = ms - now;
  const abs = Math.abs(diff);
  let s;
  if (abs < HOUR) s = `${Math.max(1, Math.round(abs / 60000))} min`;
  else if (abs < DAY) s = `${Math.round(abs / HOUR)} h`;
  else { const d = Math.round(abs / DAY); s = `${d} day${d === 1 ? "" : "s"}`; }
  return diff < 0 ? `Overdue by ${s}` : `in ${s}`;
}

function absolute(ms) {
  return new Date(ms).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function taskCard(t, color) {
  const card = el("article", `task ${color}${t.completed ? " completed" : ""}`);
  card.dataset.id = t.id;

  const check = el("button", "check");
  check.setAttribute("aria-label", t.completed ? "Mark as not done" : "Mark as done");
  check.addEventListener("click", (e) => {
    e.stopPropagation();
    t.completed ? reopenTask(t) : catchTask(t, card);
  });

  const body = el("div", "t-body");
  body.append(el("div", "t-title", t.title));
  if (t.notes) body.append(el("div", "t-notes", t.notes));
  const due = el("div", "t-due");
  const ms = dueMs(t);
  if (t.completed) due.append(el("span", "pill", "Caught ✓"), el("span", "muted", absolute(ms)));
  else due.append(el("span", "pill", relative(ms)), el("span", "muted", absolute(ms)));
  body.append(due);

  card.append(check, body);
  card.addEventListener("click", () => openTaskSheet(t));
  return card;
}

function sectionHead(title, hint, pokemon, count) {
  const head = el("div", "section-head");
  if (pokemon) {
    const img = el("img");
    img.src = SPRITE(pokemon);
    img.alt = "";
    img.loading = "lazy";
    img.onerror = () => (img.style.visibility = "hidden");
    head.append(img);
  }
  const txt = el("div");
  txt.append(el("h3", null, title));
  if (hint) txt.append(el("div", "muted small", hint));
  head.append(txt, el("span", "count", String(count)));
  return head;
}

function render() {
  const list = $("task-list");
  const now = Date.now();
  const active = tasks.filter((t) => !t.completed && !catching.has(t.id)).sort((a, b) => dueMs(a) - dueMs(b));
  const done = tasks.filter((t) => t.completed)
    .sort((a, b) => (b.completedAt?.toMillis?.() || 0) - (a.completedAt?.toMillis?.() || 0));

  list.replaceChildren();
  // Red first, then yellow, then green — red is always on top.
  for (const s of SECTIONS) {
    const items = active.filter((t) => urgencyOf(dueMs(t), now) === s.key);
    if (!items.length) continue;
    const sec = el("section", `section ${s.key}`);
    sec.append(sectionHead(s.title, s.hint, s.pokemon, items.length));
    for (const t of items) sec.append(taskCard(t, s.key));
    list.append(sec);
  }

  if (done.length) {
    const sec = el("section", `section done${doneOpen ? " open" : ""}`);
    const head = sectionHead("Done", "caught tasks", null, done.length);
    const chev = el("span", "chev", "›");
    head.prepend(chev);
    head.addEventListener("click", () => { doneOpen = !doneOpen; render(); });
    sec.append(head);
    if (doneOpen) for (const t of done) sec.append(taskCard(t, ""));
    list.append(sec);
  }

  $("empty").hidden = active.length > 0 || catching.size > 0;
}

// Colors shift as time passes; re-render every minute.
setInterval(() => { if (user) render(); }, 60 * 1000);

// ---------- Task actions ----------
function tasksCol() {
  return collection(db, "users", user.uid, "tasks");
}

function catchTask(t, card) {
  if (catching.has(t.id)) return;
  catching.add(t.id);
  card.classList.add("catching");

  const overlay = $("catch");
  overlay.hidden = true;
  void overlay.offsetWidth; // restart CSS animations
  overlay.hidden = false;
  if (navigator.vibrate) setTimeout(() => navigator.vibrate([30, 120, 30, 120, 30, 200, 60]), 550);

  updateDoc(doc(tasksCol(), t.id), { completed: true, completedAt: serverTimestamp() })
    .catch((e) => toast(`Couldn't update: ${e.code || e.message}`));

  setTimeout(() => {
    overlay.hidden = true;
    catching.delete(t.id);
    render();
  }, 2600);
}

function reopenTask(t) {
  updateDoc(doc(tasksCol(), t.id), {
    completed: false,
    completedAt: null,
    notified: passedMilestones(dueMs(t)),
  }).catch((e) => toast(`Couldn't update: ${e.code || e.message}`));
}

// ---------- Sheets ----------
function openSheet(id) {
  $(id).hidden = false;
  history.pushState({ sheet: id }, "");
}

function closeSheets(fromPopState = false) {
  const open = ["sheet-task", "sheet-settings"].filter((id) => !$(id).hidden);
  for (const id of open) $(id).hidden = true;
  if (open.length && !fromPopState && history.state?.sheet) history.back();
}

// Android back button closes the sheet instead of leaving the app.
window.addEventListener("popstate", () => closeSheets(true));

for (const b of document.querySelectorAll(".sheet-backdrop")) {
  b.addEventListener("click", (e) => { if (e.target === b) closeSheets(); });
  for (const c of b.querySelectorAll("[data-close]")) c.addEventListener("click", () => closeSheets());
}

const pad = (n) => String(n).padStart(2, "0");
function toDateInput(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function toTimeInput(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

function openTaskSheet(t = null) {
  editingId = t?.id || null;
  $("task-form-title").textContent = t ? "Edit task" : "New task";
  $("btn-delete").hidden = !t;
  const due = t ? new Date(dueMs(t)) : (() => { const d = new Date(Date.now() + DAY); d.setHours(9, 0, 0, 0); return d; })();
  $("f-title").value = t?.title || "";
  $("f-notes").value = t?.notes || "";
  $("f-date").value = toDateInput(due);
  $("f-time").value = toTimeInput(due);
  openSheet("sheet-task");
  if (!t) setTimeout(() => $("f-title").focus(), 250);
}

$("btn-add").addEventListener("click", () => openTaskSheet());
$("btn-settings").addEventListener("click", () => { refreshNotifUI(); openSheet("sheet-settings"); });

$("task-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("f-title").value.trim();
  const notes = $("f-notes").value.trim();
  const due = new Date(`${$("f-date").value}T${$("f-time").value}`);
  if (!title || isNaN(due)) return;
  const dueTs = Timestamp.fromDate(due);
  const editing = editingId && tasks.find((x) => x.id === editingId);
  closeSheets();
  try {
    if (editing) {
      const patch = { title, notes, due: dueTs };
      // New due time → reset which reminders have been sent.
      if (dueMs(editing) !== due.getTime()) patch.notified = passedMilestones(due.getTime());
      await updateDoc(doc(tasksCol(), editing.id), patch);
      toast("Task updated");
    } else {
      await addDoc(tasksCol(), {
        title, notes, due: dueTs, completed: false, completedAt: null,
        createdAt: serverTimestamp(), notified: passedMilestones(due.getTime()),
      });
      toast(`Added to ${SECTIONS.find((s) => s.key === urgencyOf(due.getTime())).title} list`);
    }
  } catch (err) {
    toast(`Couldn't save: ${err.code || err.message}`, 5000);
  }
});

$("btn-delete").addEventListener("click", async () => {
  if (!editingId || !confirm("Delete this task?")) return;
  const id = editingId;
  closeSheets();
  try {
    await deleteDoc(doc(tasksCol(), id));
    toast("Task deleted");
  } catch (err) {
    toast(`Couldn't delete: ${err.code || err.message}`);
  }
});

// ---------- Buddy ----------
const buddyLines = [
  "Squirtle squirt! 💧",
  "Take a deep breath 🌊",
  "You've got this, Trainer!",
  "One task at a time 🐢",
  "Stay hydrated! 💦",
];
$("buddy").addEventListener("click", () => {
  const b = $("buddy");
  const red = tasks.filter((t) => !t.completed && urgencyOf(dueMs(t)) === "red").length;
  const line = red && Math.random() < 0.5
    ? `${red} urgent task${red === 1 ? "" : "s"} — let's go! 🔥`
    : buddyLines[Math.floor(Math.random() * buddyLines.length)];
  b.classList.remove("hop");
  void b.offsetWidth;
  b.classList.add("hop");
  const bubble = $("buddy-bubble");
  bubble.textContent = line;
  bubble.hidden = false;
  clearTimeout(bubble._t);
  bubble._t = setTimeout(() => (bubble.hidden = true), 2500);
});
// Go back to gently bobbing after a hop.
$("buddy").addEventListener("animationend", (e) => {
  if (e.animationName === "hop") $("buddy").classList.remove("hop");
});
