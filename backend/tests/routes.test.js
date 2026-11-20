// tests/routes.test.js
// --------------------
// Checks the parts the journey test does not walk through: cancelling a request,
// the activity lines (who did it, which request they belong to), the counter
// notifications and the numbers of the dashboards.

import { test, before, after } from "node:test";
import assert from "node:assert";
import { startApi, stopApi, call, signIn } from "./helpers.js";
import { query, closeDb } from "../src/db.js";

let student, otherStudent, worker, admin;

before(async () => {
  await startApi();
  student = await signIn("student", "RU2026CS001", "ru@2026");
  otherStudent = await signIn("student", "RU2026CS002", "ru@2026");
  worker = await signIn("worker", "W-001", "worker@ru");
  admin = await signIn("admin", "admin", "admin@ru");
  await call(admin, "POST", "/admin/counter/open");
});

after(async () => {
  await stopApi();
  await closeDb();
});

test("opening the counter tells every student and is written to the history", async () => {
  const students = await query("SELECT id FROM users WHERE role = 'STUDENT'");
  const bells = await query(
    "SELECT DISTINCT student_id FROM notifications WHERE title = 'The laundry counter is now open.'",
  );
  assert.strictEqual(bells.length, students.length);

  const [line] = await query("SELECT * FROM activity WHERE action = 'Counter opened'");
  assert.strictEqual(line.actorRole, "ADMIN");
  assert.strictEqual(line.studentId, "-");
});

test("a student can cancel an open request, and only their own", async () => {
  const created = await call(student, "POST", "/student/give-requests", { quantity: 3 });
  assert.strictEqual(created.status, 201);
  const id = created.body.request.id;

  const stranger = await call(otherStudent, "POST", `/student/give-requests/${id}/cancel`);
  assert.strictEqual(stranger.status, 404);

  const cancelled = await call(student, "POST", `/student/give-requests/${id}/cancel`);
  assert.strictEqual(cancelled.status, 200);
  assert.strictEqual(cancelled.body.status, "CANCELLED");

  const again = await call(student, "POST", `/student/give-requests/${id}/cancel`);
  assert.strictEqual(again.status, 409);

  // Both lines belong to the request, so they are in its timeline.
  const history = await call(student, "GET", `/student/history/give/${id}`);
  const actions = history.body.row.timeline.map((e) => e.action);
  assert.ok(actions.includes("Give Clothes request created"));
  assert.ok(actions.includes("Request cancelled by the student"));
  const [line] = await query("SELECT * FROM activity WHERE ref_id = $1 AND result = 'Cancelled'", [id]);
  assert.strictEqual(line.actorRole, "STUDENT");
  assert.strictEqual(line.refType, "give");
});

test("the dashboards and the profile answer with numbers", async () => {
  const w = await call(worker, "GET", "/worker/dashboard");
  assert.strictEqual(typeof w.body.pendingGiveCount, "number");
  assert.strictEqual(typeof w.body.pendingTakeCount, "number");

  const a = await call(admin, "GET", "/admin/dashboard");
  for (const key of ["pendingGiveCount", "pendingTakeCount", "recentHandoverCount", "openComplaintCount"]) {
    assert.strictEqual(typeof a.body[key], "number", key);
  }

  const p = await call(student, "GET", "/student/profile");
  assert.strictEqual(typeof p.body.stats.giveCount, "number");
  assert.ok(p.body.stats.giveCount >= 1);
});

test("an expired QR code is written to the history by the system", async () => {
  const created = await call(student, "POST", "/student/give-requests", { quantity: 2 });
  assert.strictEqual(created.status, 201);
  await query("UPDATE give_requests SET qr_expires_at = now() - interval '1 minute' WHERE id = $1", [
    created.body.request.id,
  ]);
  await call(student, "GET", "/student/dashboard"); // any request runs the expiry
  const [line] = await query("SELECT * FROM activity WHERE action = 'Submission QR expired'");
  assert.strictEqual(line.actorRole, "SYSTEM");
});
