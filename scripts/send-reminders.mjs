// Sends push reminders. Run every ~10 minutes by .github/workflows/reminders.yml.
//
// For each open task it sends one notification when the task:
//   - turns red (less than 3 days left)
//   - is 1 day away
//   - is due
// and, once a day at each user's chosen hour, a summary of their red tasks.
//
// Needs GOOGLE_APPLICATION_CREDENTIALS pointing at a Firebase service
// account key, and APP_URL (where notification taps should open).
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { urgencyOf, passedMilestones } from "../web/urgency.js";

const APP_URL = process.env.APP_URL;
const DRY_RUN = process.env.DRY_RUN === "1";

initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const messaging = getMessaging();

const now = Date.now();
let sent = 0;

function whenText(dueMs) {
  return new Date(dueMs).toLocaleString("en-US", {
    weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
    timeZone: currentTz,
  });
}
let currentTz = "UTC";

async function notify(uid, tokens, title, body, tag) {
  if (!tokens.length) return;
  if (DRY_RUN) {
    console.log(`[dry-run] ${uid}: ${title} — ${body}`);
    return;
  }
  const res = await messaging.sendEachForMulticast({
    tokens,
    webpush: {
      notification: { title, body, icon: "/icons/icon-192.png", badge: "/icons/badge-72.png", tag, renotify: true },
      fcmOptions: APP_URL ? { link: APP_URL } : undefined,
    },
  });
  sent += res.successCount;
  // Remove tokens for devices that uninstalled / revoked permission.
  await Promise.all(res.responses.map((r, i) => {
    const code = r.error?.code;
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token" || code === "messaging/invalid-argument") {
      console.log(`removing stale token for ${uid}`);
      return db.doc(`users/${uid}/tokens/${tokens[i]}`).delete();
    }
    if (r.error) console.warn(`send failed for ${uid}: ${code}`);
  }));
}

function localParts(tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

async function processUser(userDoc) {
  const uid = userDoc.id;
  const user = userDoc.data();
  currentTz = user.timezone || "UTC";
  try { new Intl.DateTimeFormat("en-US", { timeZone: currentTz }); } catch { currentTz = "UTC"; }

  const tokens = (await db.collection(`users/${uid}/tokens`).get()).docs.map((d) => d.id);
  if (!tokens.length) return;

  const tasksSnap = await db.collection(`users/${uid}/tasks`).where("completed", "==", false).get();
  const open = tasksSnap.docs.map((d) => ({ ref: d.ref, ...d.data() })).filter((t) => t.due);

  for (const t of open) {
    const dueMs = t.due.toMillis();
    const passed = passedMilestones(dueMs, now);
    const already = t.notified || {};
    const newly = Object.keys(passed).filter((k) => passed[k] && !already[k]);
    if (!newly.length) continue;

    // Only send the most urgent newly-reached milestone.
    let title, body;
    if (newly.includes("due")) {
      title = `⏰ Due now: ${t.title}`;
      body = "Time to catch this one!";
    } else if (newly.includes("dayBefore")) {
      title = `🔥 Due tomorrow: ${t.title}`;
      body = `Due ${whenText(dueMs)}`;
    } else {
      title = `🔴 Now urgent: ${t.title}`;
      body = `Less than 3 days left — due ${whenText(dueMs)}`;
    }
    await notify(uid, tokens, title, body, `task-${t.ref.id}`);
    if (!DRY_RUN) await t.ref.update({ notified: passed });
  }

  // Daily summary of red tasks
  const hour = typeof user.summaryHour === "number" ? user.summaryHour : 8;
  if (hour >= 0) {
    const local = localParts(currentTz);
    if (local.hour >= hour && user.lastSummaryDate !== local.date) {
      const red = open
        .filter((t) => urgencyOf(t.due.toMillis(), now) === "red")
        .sort((a, b) => a.due.toMillis() - b.due.toMillis());
      if (red.length) {
        const names = red.slice(0, 4).map((t) => t.title).join(", ");
        const more = red.length > 4 ? ` +${red.length - 4} more` : "";
        await notify(uid, tokens, `☀️ ${red.length} urgent task${red.length === 1 ? "" : "s"} today`, names + more, "daily-summary");
      }
      if (!DRY_RUN) await userDoc.ref.update({ lastSummaryDate: local.date, lastSummaryAt: FieldValue.serverTimestamp() });
    }
  }
}

const users = await db.collection("users").get();
for (const u of users.docs) {
  try {
    await processUser(u);
  } catch (e) {
    console.error(`user ${u.id} failed:`, e);
    process.exitCode = 1;
  }
}
console.log(`checked ${users.size} user(s), sent ${sent} notification(s)`);
