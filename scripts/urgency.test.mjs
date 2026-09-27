import { test } from "node:test";
import assert from "node:assert/strict";
import { urgencyOf, passedMilestones, DAY, HOUR } from "../web/urgency.js";

const now = Date.UTC(2026, 0, 1);

test("colors by time left", () => {
  assert.equal(urgencyOf(now - HOUR, now), "red");          // overdue
  assert.equal(urgencyOf(now + 2 * DAY, now), "red");
  assert.equal(urgencyOf(now + 3 * DAY - 1, now), "red");
  assert.equal(urgencyOf(now + 3 * DAY, now), "yellow");
  assert.equal(urgencyOf(now + 7 * DAY, now), "yellow");
  assert.equal(urgencyOf(now + 7 * DAY + 1, now), "green");
  assert.equal(urgencyOf(now + 30 * DAY, now), "green");
});

test("milestones already passed", () => {
  assert.deepEqual(passedMilestones(now + 10 * DAY, now), { red: false, dayBefore: false, due: false });
  assert.deepEqual(passedMilestones(now + 2 * DAY, now), { red: true, dayBefore: false, due: false });
  assert.deepEqual(passedMilestones(now + 5 * HOUR, now), { red: true, dayBefore: true, due: false });
  assert.deepEqual(passedMilestones(now - 1, now), { red: true, dayBefore: true, due: true });
});
