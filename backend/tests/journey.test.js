// tests/journey.test.js
// ---------------------
// Walks through the whole laundry journey against a real (test) database and
// checks the rules that must never break:
//   * a bag only moves to IN_PROCESS when the worker verifies it
//   * scanning a QR code is never a handover
//   * the private photo can only be read by its owner
//   * the counter stays closed when the admin closes it
//   * a complaint keeps all of its updates
//   * the activity history cannot be deleted

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
});

after(async () => {
  await stopApi();
  await closeDb();
});

test("a wrong password is refused", async () => {
  const answer = await call("", "POST", "/auth/login", { portal: "student", identifier: "RU2026CS001", password: "nope" });
  assert.equal(answer.status, 401);
});

test("an ID is locked after 5 wrong passwords", async () => {
  const wrong = { portal: "worker", identifier: "W-002", password: "wrong" };
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await call("", "POST", "/auth/login", wrong)).status, 401);
  }
  // Now even the right password is refused for a few minutes.
  const right = { portal: "worker", identifier: "W-002", password: "worker@ru" };
  assert.equal((await call("", "POST", "/auth/login", right)).status, 429);
});

test("the database keeps only a hash of the login token", async () => {
  const sessions = await query("SELECT token_hash FROM sessions");
  const stored = sessions.map((s) => s.tokenHash);
  assert.ok(stored.length > 0);
  assert.ok(!stored.includes(student), "the real token must not be in the database");
});

test("each area only lets its own role in", async () => {
  assert.equal((await call(student, "GET", "/worker/dashboard")).status, 403);
  assert.equal((await call(worker, "GET", "/admin/dashboard")).status, 403);
  assert.equal((await call("", "GET", "/student/dashboard")).status, 401);
});

test("the full give and take journey", async () => {
  // 1. The student gives 5 clothes with a private photo.
  const give = await call(student, "POST", "/student/give-requests", {
    quantity: 5,
    photoDataUrl: "data:image/png;base64,AAAA",
  });
  assert.equal(give.status, 201);
  const photoId = give.body.request.photoId;
  const giveId = give.body.request.id;

  // 2. The worker scans the code. The bag has not moved yet.
  const scan = await call(worker, "POST", "/worker/qr/scan", { text: give.body.qrText });
  assert.equal(scan.status, 200);
  assert.equal(scan.body.request.photoId, undefined, "the worker must not see the photo id");
  let dashboard = await call(student, "GET", "/student/dashboard");
  assert.equal(dashboard.body.bag.status, "NOT_GIVEN");

  // The same code cannot be scanned twice.
  assert.equal((await call(worker, "POST", "/worker/qr/scan", { text: give.body.qrText })).status, 409);

  // 3. The worker verifies the bag -> IN_PROCESS.
  await call(worker, "POST", `/worker/give-requests/${give.body.request.id}/verify`, { confirmedQuantity: 5 });
  dashboard = await call(student, "GET", "/student/dashboard");
  assert.equal(dashboard.body.bag.status, "IN_PROCESS");
  assert.equal(dashboard.body.bag.quantity, 5);

  // 4. Back at the counter -> AT_COUNTER.
  await call(worker, "POST", "/worker/give-requests/B-001/return-to-counter");

  // 5. The student asks to collect, the worker scans.
  const take = await call(student, "POST", "/student/take-requests");
  assert.equal(take.status, 201);
  const takeId = take.body.request.id;
  await call(worker, "POST", `/worker/take-requests/${takeId}/scan`);

  // Scanning is not a handover: the worker cannot hand over before the student verifies.
  assert.equal((await call(worker, "POST", `/worker/take-requests/${takeId}/handover`)).status, 409);
  dashboard = await call(student, "GET", "/student/dashboard");
  assert.equal(dashboard.body.bag.status, "AT_COUNTER");

  // 6. The student verifies, the worker hands over -> NOT_GIVEN again.
  await call(student, "POST", `/student/take-requests/${takeId}/verify`);
  const handover = await call(worker, "POST", `/worker/take-requests/${takeId}/handover`);
  assert.equal(handover.status, 200);
  dashboard = await call(student, "GET", "/student/dashboard");
  assert.equal(dashboard.body.bag.status, "NOT_GIVEN");

  // The private photo: the owner can read it, nobody else can.
  assert.equal((await call(student, "GET", `/student/photos/${photoId}`)).status, 200);
  assert.equal((await call(otherStudent, "GET", `/student/photos/${photoId}`)).status, 404);
  assert.equal((await call(worker, "GET", `/student/photos/${photoId}`)).status, 403);

  // Both records of this journey are in the history (the demo data has an older
  // collection for this student as well, so we look for the two we made).
  const history = await call(student, "GET", "/student/history");
  const ids = history.body.map((row) => row.id);
  assert.ok(ids.includes(giveId), "the submission is in the history");
  assert.ok(ids.includes(takeId), "the collection is in the history");
});

test("a fake QR code is refused", async () => {
  const answer = await call(worker, "POST", "/worker/qr/scan", { text: "RU1.abc.def" });
  assert.equal(answer.status, 400);
});

test("the student cannot give more than 15 clothes", async () => {
  const answer = await call(student, "POST", "/student/give-requests", { quantity: 16 });
  assert.equal(answer.status, 400);
});

test("when the admin closes the counter, students cannot give clothes", async () => {
  await call(admin, "POST", "/admin/counter/close");
  const answer = await call(student, "POST", "/student/give-requests", { quantity: 2 });
  assert.equal(answer.status, 409);
  await call(admin, "POST", "/admin/counter/open");
});

test("a complaint keeps every update", async () => {
  const created = await call(student, "POST", "/student/complaints", {
    category: "DELAY",
    description: "My bag is late.",
  });
  const ref = created.body.ref;

  await call(admin, "PATCH", `/admin/complaints/${ref}`, { status: "IN_REVIEW", response: "Checking." });
  await call(admin, "PATCH", `/admin/complaints/${ref}`, { resolution: "Found it." });

  const complaint = await call(student, "GET", `/student/complaints/${ref}`);
  assert.equal(complaint.body.status, "RESOLVED");
  assert.equal(complaint.body.updates.length, 2);

  // Another student cannot open it.
  assert.equal((await call(otherStudent, "GET", `/student/complaints/${ref}`)).status, 404);
});

test("the activity history cannot be deleted", async () => {
  const before = await query("SELECT COUNT(*) AS count FROM activity");
  await query("DELETE FROM activity");
  const afterDelete = await query("SELECT COUNT(*) AS count FROM activity");
  assert.equal(afterDelete[0].count, before[0].count);
});
