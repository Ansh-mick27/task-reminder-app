// Urgency rules shared by the web app and the reminder job (scripts/).
// red: due in less than 3 days (or overdue)
// yellow: 3–7 days away
// green: more than 7 days away

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
export const RED_WITHIN = 3 * DAY;
export const YELLOW_WITHIN = 7 * DAY;

export function urgencyOf(dueMs, now = Date.now()) {
  const left = dueMs - now;
  if (left < RED_WITHIN) return "red";
  if (left <= YELLOW_WITHIN) return "yellow";
  return "green";
}

// Which reminder milestones have already passed for a due time. Used when a
// task is created or edited so the reminder job doesn't send stale alerts
// (e.g. "turned red" for a task that was created already red).
export function passedMilestones(dueMs, now = Date.now()) {
  const left = dueMs - now;
  return {
    red: left < RED_WITHIN,
    dayBefore: left <= DAY,
    due: left <= 0,
  };
}
