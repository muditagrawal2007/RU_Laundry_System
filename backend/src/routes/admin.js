// routes/admin.js
// ---------------
// Everything the admin dashboard can do. Only signed in admins get in.
//
// GET    /api/admin/dashboard
// POST   /api/admin/counter/open
// POST   /api/admin/counter/close
// POST   /api/admin/counter/auto            (let the weekly schedule decide again)
// GET    /api/admin/counter/settings
// PUT    /api/admin/counter/schedule        [ { day, isOpen, openTime, closeTime }, ... ]
// POST   /api/admin/counter/closures        { type, date, startTime?, endTime?, reason }
// DELETE /api/admin/counter/closures/:id
// GET    /api/admin/bags                    ?search&status&dateFrom&dateTo&sort
// GET    /api/admin/bags/:bagNumber
// GET    /api/admin/assignments
// GET    /api/admin/available-bags
// POST   /api/admin/assignments             { studentId, bagNumber }
// GET    /api/admin/history                 ?tab=give|take|activity&search&worker&result&dateFrom&dateTo&sort
// GET    /api/admin/history/:type/:id
// GET    /api/admin/students
// POST   /api/admin/students                { studentId, name, password }
// GET    /api/admin/students/:studentId
// POST   /api/admin/workers                 { workerId, name, password }
// GET    /api/admin/complaints              ?search&category&status&assignedTo&dateFrom&dateTo&sort
// GET    /api/admin/complaints/:ref
// PATCH  /api/admin/complaints/:ref         { status?, assignedTo?, response?, resolution? }
// GET    /api/admin/complaints/:ref/evidence
// GET    /api/admin/audit                   ?search&action&worker&dateFrom&dateTo
// GET    /api/admin/reports                 ?dateFrom&dateTo
// GET    /api/admin/reports/export.csv
// POST   /api/admin/reset-demo              (only when ALLOW_DEMO_RESET=true)
//
// There is NO admin route for the student's private reference photo.

import express from "express";
import bcrypt from "bcryptjs";
import { query, queryOne } from "../db.js";
import { requireRole } from "../auth.js";
import { ApiError } from "../errors.js";
import { getCounter } from "../counter.js";
import { findBagOfStudent, findBagByNumber, getAllBags } from "../bags.js";
import { logActivity, notifyStudent, notifyAllStudents } from "../activity.js";
import { giveRows, takeRows } from "../history.js";
import { addUpdates, findComplaint, COMPLAINT_STATUSES } from "../complaints.js";
import { bySearch, byValue, byDate, byDateOrder } from "../filters.js";
import { ALLOW_DEMO_RESET } from "../config.js";
import { resetDatabase } from "../../database/reset.js";

const router = express.Router();

// Every route below is for admins only.
router.use(requireRole("ADMIN"));

const TIME_FORMAT = /^\d{2}:\d{2}$/; // "08:00"
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/; // "2026-11-02"

/* ------------------------------------------------------------------------ */
/* Dashboard                                                                 */
/* ------------------------------------------------------------------------ */

router.get("/dashboard", async (req, res) => {
  const counter = await getCounter();

  const bags = await query("SELECT status FROM bags");
  const bagCounts = { NOT_GIVEN: 0, IN_PROCESS: 0, AT_COUNTER: 0 };
  for (const bag of bags) bagCounts[bag.status] += 1;

  const gives = await queryOne("SELECT COUNT(*) AS count FROM give_requests WHERE status = 'PENDING'");
  const takes = await queryOne(
    "SELECT COUNT(*) AS count FROM take_requests WHERE status IN ('SCANNED', 'VERIFIED')",
  );
  const handovers = await queryOne(
    "SELECT COUNT(*) AS count FROM activity WHERE action = 'Clothes collected successfully'",
  );
  const complaints = await queryOne("SELECT COUNT(*) AS count FROM complaints WHERE status <> 'RESOLVED'");
  const recentActivity = await query("SELECT * FROM activity ORDER BY at DESC LIMIT 12");

  res.json({
    adminName: req.user.name,
    counter: counter,
    bagCounts: bagCounts,
    pendingGiveCount: Number(gives.count),
    pendingTakeCount: Number(takes.count),
    recentHandoverCount: Number(handovers.count),
    openComplaintCount: Number(complaints.count),
    recentActivity: recentActivity,
  });
});

/* ------------------------------------------------------------------------ */
/* The counter                                                               */
/* ------------------------------------------------------------------------ */

router.post("/counter/open", async (req, res) => {
  const admin = req.user;
  await query(
    "UPDATE counter_state SET manual_state = 'OPEN', opened_at = now(), closed_at = NULL, updated_by = $1 WHERE id = 1",
    [admin.name],
  );
  await logActivity({
    action: "Counter opened",
    actorName: admin.name,
    actorRole: "ADMIN",
    studentId: "-",
    studentName: "-",
    bagNumber: "-",
    result: "Laundry counter is now OPEN.",
    kind: "COUNTER",
  });
  await notifyAllStudents(
    "The laundry counter is now open.",
    "New laundry submissions and collections are currently available.",
    "/student",
  );
  res.json(await getCounter());
});

router.post("/counter/close", async (req, res) => {
  const admin = req.user;
  await query(
    "UPDATE counter_state SET manual_state = 'CLOSED', closed_at = now(), updated_by = $1 WHERE id = 1",
    [admin.name],
  );
  await logActivity({
    action: "Counter closed",
    actorName: admin.name,
    actorRole: "ADMIN",
    studentId: "-",
    studentName: "-",
    bagNumber: "-",
    result: "Laundry counter is now CLOSED.",
    kind: "COUNTER",
  });
  await notifyAllStudents(
    "The laundry counter is now closed.",
    "You can still view your bag status and history.",
    "/student",
  );
  res.json(await getCounter());
});

// Forget the button press: the weekly schedule and closures decide again.
router.post("/counter/auto", async (req, res) => {
  const admin = req.user;
  await query("UPDATE counter_state SET manual_state = NULL, updated_by = $1 WHERE id = 1", [admin.name]);
  await logActivity({
    action: "Counter set to follow the schedule",
    actorName: admin.name,
    actorRole: "ADMIN",
    studentId: "-",
    studentName: "-",
    bagNumber: "-",
    result: "The weekly schedule decides when the counter is open.",
    kind: "COUNTER",
  });
  res.json(await getCounter());
});

router.get("/counter/settings", async (req, res) => {
  res.json(await getCounter());
});

// Is the one-day urgent service switched on?
router.get("/settings", async (req, res) => {
  const settings = await queryOne("SELECT urgent_enabled FROM settings WHERE id = 1");
  res.json({ urgentEnabled: settings ? settings.urgentEnabled : true });
});

// Switch the one-day urgent service on or off.
router.put("/settings", async (req, res) => {
  const urgentEnabled = Boolean(req.body.urgentEnabled);
  await query(
    `INSERT INTO settings (id, urgent_enabled) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET urgent_enabled = $1`,
    [urgentEnabled],
  );
  await logActivity({
    action: "One-Day Urgent service turned " + (urgentEnabled ? "on" : "off"),
    actorName: req.user.name,
    actorRole: "ADMIN",
    studentId: "-",
    studentName: "-",
    bagNumber: "-",
    result: urgentEnabled ? "ON" : "OFF",
    kind: "COUNTER",
  });
  res.json({ urgentEnabled });
});

router.put("/counter/schedule", async (req, res) => {
  const schedule = req.body;
  if (!Array.isArray(schedule)) throw new ApiError(400, "Send the list of days.");

  for (const day of schedule) {
    if (!TIME_FORMAT.test(day.openTime) || !TIME_FORMAT.test(day.closeTime)) {
      throw new ApiError(400, `Times for ${day.day} must look like 08:00.`);
    }
    if (day.isOpen && day.openTime >= day.closeTime) {
      throw new ApiError(400, `On ${day.day} the closing time must be after the opening time.`);
    }
  }

  for (const day of schedule) {
    await query(
      "UPDATE counter_schedule SET is_open = $1, open_time = $2, close_time = $3 WHERE day = $4",
      [Boolean(day.isOpen), day.openTime, day.closeTime, day.day],
    );
  }

  const counter = await getCounter();
  res.json(counter.schedule);
});

router.post("/counter/closures", async (req, res) => {
  const { type, date, startTime, endTime } = req.body;
  const reason = String(req.body.reason || "").trim();

  if (type !== "HOLIDAY" && type !== "TEMPORARY") throw new ApiError(400, "Choose holiday or temporary.");
  if (!DATE_FORMAT.test(date)) throw new ApiError(400, "The date must look like 2026-11-02.");
  if (!reason) throw new ApiError(400, "Please give a reason.");
  if (type === "TEMPORARY") {
    if (!TIME_FORMAT.test(startTime) || !TIME_FORMAT.test(endTime) || startTime >= endTime) {
      throw new ApiError(400, "A temporary closure needs a start time and a later end time.");
    }
  }

  const closure = await queryOne(
    `INSERT INTO counter_closures (type, date, start_time, end_time, reason)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [type, date, type === "TEMPORARY" ? startTime : null, type === "TEMPORARY" ? endTime : null, reason],
  );
  res.status(201).json(closure);
});

router.delete("/counter/closures/:id", async (req, res) => {
  await query("DELETE FROM counter_closures WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------------ */
/* Bags and bag assignments                                                  */
/* ------------------------------------------------------------------------ */

router.get("/bags", async (req, res) => {
  let rows = await getAllBags();
  rows = rows.map((bag) => ({ ...bag, lastUpdatedBy: bag.updatedBy }));
  rows = bySearch(rows, req.query.search, ["studentId", "studentName", "bagNumber"]);
  rows = byValue(rows, "status", req.query.status);
  rows = byDate(rows, "updatedAt", req.query.dateFrom, req.query.dateTo);
  // sort=bag sorts by bag number (already done by getAllBags), otherwise newest change first.
  if (req.query.sort !== "bag") rows = byDateOrder(rows, "updatedAt", "newest");
  res.json({ rows: rows, total: rows.length });
});

router.get("/bags/:bagNumber", async (req, res) => {
  const bag = await findBagByNumber(req.params.bagNumber);
  if (!bag) throw new ApiError(404, "Bag not found.");
  const history = await query("SELECT * FROM activity WHERE bag_number = $1 ORDER BY at DESC", [
    bag.bagNumber,
  ]);
  res.json({ bag: bag, history: history });
});

router.get("/assignments", async (req, res) => {
  const bags = await getAllBags();
  const rows = bags.map((bag) => ({
    bagNumber: bag.bagNumber,
    studentId: bag.studentId,
    studentName: bag.studentName,
    status: bag.status,
    assignedAt: bag.updatedAt,
  }));
  res.json(rows);
});

// The next 12 free bag numbers (B-001, B-002, ...).
router.get("/available-bags", async (req, res) => {
  const bags = await query("SELECT bag_number FROM bags");
  const used = bags.map((bag) => bag.bagNumber);

  const free = [];
  let number = 1;
  while (free.length < 12) {
    const candidate = "B-" + String(number).padStart(3, "0");
    if (!used.includes(candidate)) free.push(candidate);
    number += 1;
  }
  res.json(free);
});

// Gives a student their one permanent bag.
router.post("/assignments", async (req, res) => {
  const admin = req.user;
  const { studentId, bagNumber } = req.body;

  if (!/^B-\d{3,}$/.test(bagNumber || "")) throw new ApiError(400, "A bag number looks like B-001.");

  const student = await queryOne("SELECT * FROM users WHERE id = $1 AND role = 'STUDENT'", [studentId]);
  if (!student) throw new ApiError(404, "Student not found.");

  const existingBag = await findBagOfStudent(student.id);
  if (existingBag) {
    throw new ApiError(
      409,
      `${student.name} already has bag ${existingBag.bagNumber}. A student can only have one permanent bag.`,
    );
  }

  const bagTaken = await findBagByNumber(bagNumber);
  if (bagTaken) throw new ApiError(409, `Bag ${bagNumber} is already assigned to ${bagTaken.studentName}.`);

  await query("INSERT INTO bags (bag_number, student_id, updated_by) VALUES ($1, $2, $3)", [
    bagNumber,
    student.id,
    admin.name,
  ]);

  await logActivity({
    action: "Bag assigned to student",
    actorName: admin.name,
    actorRole: "ADMIN",
    studentId: student.id,
    studentName: student.name,
    bagNumber: bagNumber,
    result: "Assignment created",
    kind: "BAG",
  });

  res.status(201).json(await findBagByNumber(bagNumber));
});

/* ------------------------------------------------------------------------ */
/* History                                                                   */
/* ------------------------------------------------------------------------ */

/** The give or take history of everybody, filtered and sorted. */
async function getHistory(tab, filters) {
  let rows;
  if (tab === "give") rows = await giveRows(await query("SELECT * FROM give_requests"));
  else rows = await takeRows(await query("SELECT * FROM take_requests"));

  rows = bySearch(rows, filters.search, ["studentId", "studentName", "bagNumber"]);
  rows = byValue(rows, "workerId", filters.worker);
  rows = byValue(rows, "status", filters.result);
  rows = byDate(rows, "requestAt", filters.dateFrom, filters.dateTo);
  return byDateOrder(rows, "requestAt", filters.sort);
}

router.get("/history", async (req, res) => {
  const tab = req.query.tab || "give";

  if (tab === "activity") {
    let events = await query("SELECT * FROM activity");
    events = bySearch(events, req.query.search, ["studentId", "studentName", "bagNumber", "actorName"]);
    events = byValue(events, "actorName", req.query.worker);
    events = byDate(events, "at", req.query.dateFrom, req.query.dateTo);
    return res.json(byDateOrder(events, "at", req.query.sort));
  }

  if (tab !== "give" && tab !== "take") throw new ApiError(400, "tab must be give, take or activity.");
  res.json(await getHistory(tab, req.query));
});

router.get("/history/:type/:id", async (req, res) => {
  const type = req.params.type;
  if (type !== "give" && type !== "take") throw new ApiError(400, "type must be give or take.");
  const rows = await getHistory(type, {});
  const row = rows.find((r) => r.id === req.params.id);
  if (!row) throw new ApiError(404, "Record not found.");
  res.json(row);
});

/* ------------------------------------------------------------------------ */
/* Students and workers                                                      */
/* ------------------------------------------------------------------------ */

router.get("/students", async (req, res) => {
  const students = await query(
    `SELECT users.id, users.name, bags.bag_number, bags.status
     FROM users LEFT JOIN bags ON bags.student_id = users.id
     WHERE users.role = 'STUDENT'
     ORDER BY users.id`,
  );
  const lastActivity = await query(
    "SELECT student_id, MAX(at) AS last_at FROM activity GROUP BY student_id",
  );

  const rows = students.map((s) => {
    const last = lastActivity.find((a) => a.studentId === s.id);
    return {
      name: s.name,
      studentId: s.id,
      bagNumber: s.bagNumber || "-",
      status: s.status || "NOT_GIVEN",
      lastActivityAt: last ? last.lastAt : null,
    };
  });
  res.json(rows);
});

/** Shared by "add student" and "add worker". */
async function createUser(role, id, name, password) {
  id = String(id || "").trim();
  name = String(name || "").trim();
  password = String(password || "");

  if (!id || !name) throw new ApiError(400, "Please fill in the ID and the name.");
  if (password.length < 6) throw new ApiError(400, "The password must have at least 6 characters.");

  const existing = await queryOne("SELECT id FROM users WHERE LOWER(id) = LOWER($1)", [id]);
  if (existing) throw new ApiError(409, `${id} already exists.`);

  const passwordHash = await bcrypt.hash(password, 10);
  await query("INSERT INTO users (id, role, name, password_hash) VALUES ($1, $2, $3, $4)", [
    id,
    role,
    name,
    passwordHash,
  ]);
  return { id: id, role: role, name: name };
}

router.post("/students", async (req, res) => {
  const { studentId, name, password } = req.body;
  res.status(201).json(await createUser("STUDENT", studentId, name, password));
});

router.post("/workers", async (req, res) => {
  const { workerId, name, password } = req.body;
  res.status(201).json(await createUser("WORKER", workerId, name, password));
});

router.get("/students/:studentId", async (req, res) => {
  const student = await queryOne("SELECT * FROM users WHERE id = $1 AND role = 'STUDENT'", [
    req.params.studentId,
  ]);
  if (!student) throw new ApiError(404, "Student not found.");

  const bag = await findBagOfStudent(student.id);
  const gives = await query("SELECT * FROM give_requests WHERE student_id = $1 ORDER BY created_at DESC", [student.id]);
  const takes = await query("SELECT * FROM take_requests WHERE student_id = $1 ORDER BY created_at DESC", [student.id]);
  const complaints = await query("SELECT * FROM complaints WHERE student_id = $1 ORDER BY created_at DESC", [student.id]);
  const activity = await query("SELECT * FROM activity WHERE student_id = $1 ORDER BY at DESC", [student.id]);

  res.json({
    student: { name: student.name, studentId: student.id, bagNumber: bag ? bag.bagNumber : "-" },
    bag: bag,
    lastActivityAt: activity.length > 0 ? activity[0].at : null,
    giveRows: await giveRows(gives),
    takeRows: await takeRows(takes),
    complaints: await addUpdates(complaints),
    activity: activity,
  });
});

/* ------------------------------------------------------------------------ */
/* Complaints                                                                */
/* ------------------------------------------------------------------------ */

router.get("/complaints", async (req, res) => {
  let rows = await query("SELECT * FROM complaints");
  rows = bySearch(rows, req.query.search, ["ref", "studentId", "bagNumber"]);
  rows = byValue(rows, "category", req.query.category);
  rows = byValue(rows, "status", req.query.status);
  rows = byValue(rows, "assignedTo", req.query.assignedTo);
  rows = byDate(rows, "createdAt", req.query.dateFrom, req.query.dateTo);
  rows = byDateOrder(rows, "createdAt", req.query.sort);
  res.json(await addUpdates(rows));
});

router.get("/complaints/:ref", async (req, res) => {
  const complaint = await findComplaint(req.params.ref);
  if (!complaint) throw new ApiError(404, "Complaint not found.");
  res.json(complaint);
});

// The photo a student added as proof. (This is never the private reference photo.)
router.get("/complaints/:ref/evidence", async (req, res) => {
  const complaint = await findComplaint(req.params.ref);
  if (!complaint) throw new ApiError(404, "Complaint not found.");
  if (!complaint.evidenceId) return res.json({ dataUrl: null });

  const photo = await queryOne(
    "SELECT data_url FROM photos WHERE id = $1 AND kind = 'COMPLAINT_EVIDENCE'",
    [complaint.evidenceId],
  );
  res.json({ dataUrl: photo ? photo.dataUrl : null });
});

// Adds a reply, changes the status, assigns someone, or records a resolution.
router.patch("/complaints/:ref", async (req, res) => {
  const admin = req.user;
  const complaint = await findComplaint(req.params.ref);
  if (!complaint) throw new ApiError(404, "Complaint not found.");

  const response = String(req.body.response || "").trim();
  const resolution = String(req.body.resolution || "").trim();

  // Start from the current values and change what was sent.
  let status = complaint.status;
  let assignedTo = complaint.assignedTo;
  let resolutionText = complaint.resolution;
  let resolvedAt = complaint.resolvedAt;

  if (req.body.status !== undefined) {
    if (!COMPLAINT_STATUSES.includes(req.body.status)) throw new ApiError(400, "Choose a valid status.");
    status = req.body.status;
  }
  if (req.body.assignedTo !== undefined) assignedTo = req.body.assignedTo;
  if (resolution) {
    status = "RESOLVED";
    resolutionText = resolution;
    resolvedAt = new Date();
  }

  await query(
    `UPDATE complaints
     SET status = $1, assigned_to = $2, resolution = $3, resolved_at = $4, updated_at = now()
     WHERE ref = $5`,
    [status, assignedTo, resolutionText, resolvedAt, complaint.ref],
  );

  // Every reply is kept. Nothing is ever deleted.
  if (response) {
    await query(
      "INSERT INTO complaint_updates (complaint_ref, author_name, author_role, body) VALUES ($1, $2, 'ADMIN', $3)",
      [complaint.ref, admin.name, response],
    );
  }
  if (resolution) {
    await query(
      "INSERT INTO complaint_updates (complaint_ref, author_name, author_role, body) VALUES ($1, $2, 'ADMIN', $3)",
      [complaint.ref, admin.name, "Resolved: " + resolution],
    );
  }

  await logActivity({
    action: resolution ? "Complaint resolved" : "Complaint updated",
    actorName: admin.name,
    actorRole: "ADMIN",
    studentId: complaint.studentId,
    studentName: complaint.studentName,
    bagNumber: complaint.bagNumber,
    result: status,
    kind: "COMPLAINT",
    refType: "complaint",
    refId: complaint.ref,
  });

  if (resolution) {
    await notifyStudent(complaint.studentId, "Your complaint has been resolved.", resolution,
      `/student/complaints/${complaint.ref}`);
  } else {
    await notifyStudent(complaint.studentId, "Your complaint has been updated.",
      response || "The laundry team added an update to your complaint.",
      `/student/complaints/${complaint.ref}`);
  }

  res.json(await findComplaint(complaint.ref));
});

/* ------------------------------------------------------------------------ */
/* Audit and reports                                                         */
/* ------------------------------------------------------------------------ */

router.get("/audit", async (req, res) => {
  let rows = await query("SELECT * FROM activity ORDER BY at DESC");
  rows = bySearch(rows, req.query.search, ["studentId", "bagNumber", "actorName"]);
  rows = byValue(rows, "action", req.query.action);
  rows = byValue(rows, "actorName", req.query.worker);
  rows = byDate(rows, "at", req.query.dateFrom, req.query.dateTo);
  res.json(rows);
});

/** All the numbers of the reports screen, for a date range (both dates optional). */
async function makeReport(dateFrom, dateTo) {
  const bags = await query("SELECT status FROM bags");
  const gives = byDate(await query("SELECT * FROM give_requests WHERE status = 'RECEIVED'"), "receivedAt", dateFrom, dateTo);
  const takes = byDate(await query("SELECT * FROM take_requests WHERE status = 'COMPLETED'"), "handedOverAt", dateFrom, dateTo);
  const complaints = await query("SELECT status FROM complaints");
  const events = byDate(await query("SELECT * FROM activity ORDER BY at"), "at", dateFrom, dateTo);

  // Walk through the history in time order and measure, for each bag:
  //   received by worker -> returned to counter   (time to counter)
  //   returned to counter -> collected            (time to collection)
  const toCounter = [];
  const toCollection = [];
  const receivedAt = {}; // bag number -> time
  const returnedAt = {}; // bag number -> time
  for (const e of events) {
    if (e.action === "Bag received by worker") {
      receivedAt[e.bagNumber] = e.at;
    }
    if (e.action === "Bag returned to counter" && receivedAt[e.bagNumber]) {
      toCounter.push((e.at - receivedAt[e.bagNumber]) / 60000);
      delete receivedAt[e.bagNumber];
      returnedAt[e.bagNumber] = e.at;
    }
    if ((e.action === "Clothes collected successfully" || e.action === "Manual handover completed")
        && returnedAt[e.bagNumber]) {
      toCollection.push((e.at - returnedAt[e.bagNumber]) / 60000);
      delete returnedAt[e.bagNumber];
    }
  }

  function average(list) {
    if (list.length === 0) return 0;
    let sum = 0;
    for (const value of list) sum += value;
    return Math.round(sum / list.length);
  }

  let totalClothes = 0;
  for (const give of gives) totalClothes += give.confirmedQuantity || give.quantity;

  return {
    totalBags: bags.length,
    inProcess: bags.filter((b) => b.status === "IN_PROCESS").length,
    atCounter: bags.filter((b) => b.status === "AT_COUNTER").length,
    completedSubmissions: gives.length,
    completedCollections: takes.length,
    totalClothes: totalClothes,
    complaintsRequiringAttention: complaints.filter((c) => c.status !== "RESOLVED").length,
    manualHandovers: events.filter((e) => e.action === "Manual handover completed").length,
    statusCorrections: events.filter((e) => e.action === "Status correction recorded").length,
    complaintsSubmitted: complaints.length,
    complaintsResolved: complaints.filter((c) => c.status === "RESOLVED").length,
    averageMinutesToCounter: average(toCounter),
    averageMinutesToCollection: average(toCollection),
  };
}

router.get("/reports", async (req, res) => {
  res.json(await makeReport(req.query.dateFrom, req.query.dateTo));
});

// The same numbers as a CSV file. It never contains any photo information.
router.get("/reports/export.csv", async (req, res) => {
  const report = await makeReport(req.query.dateFrom, req.query.dateTo);
  const lines = [
    "Metric,Value",
    `Total assigned bags,${report.totalBags}`,
    `Bags currently in process,${report.inProcess}`,
    `Bags currently at the counter,${report.atCounter}`,
    `Completed submissions,${report.completedSubmissions}`,
    `Completed collections,${report.completedCollections}`,
    `Total clothes recorded,${report.totalClothes}`,
    `Average minutes from receipt to counter,${report.averageMinutesToCounter}`,
    `Average minutes from counter to collection,${report.averageMinutesToCollection}`,
    `Manual handovers,${report.manualHandovers}`,
    `Status corrections,${report.statusCorrections}`,
    `Complaints submitted,${report.complaintsSubmitted}`,
    `Complaints resolved,${report.complaintsResolved}`,
    `Complaints requiring attention,${report.complaintsRequiringAttention}`,
  ];
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="laundry-report.csv"');
  res.send(lines.join("\n"));
});

/* ------------------------------------------------------------------------ */
/* Demo reset                                                                */
/* ------------------------------------------------------------------------ */

// Wipes everything and loads the demo data again. Off unless ALLOW_DEMO_RESET=true.
router.post("/reset-demo", async (req, res) => {
  if (!ALLOW_DEMO_RESET) throw new ApiError(403, "Demo reset is turned off on this server.");
  await resetDatabase();
  res.json({ ok: true });
});

export default router;
