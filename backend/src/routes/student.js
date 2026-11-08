// routes/student.js
// -----------------
// Everything the student portal can do. Only signed in students get in.
// The student is always the one who is signed in (req.user), so a student
// can never read or change another student's data.
//
// GET  /api/student/dashboard
// POST /api/student/give-requests              { quantity, photoDataUrl? }
// GET  /api/student/give-requests/:id
// GET  /api/student/give-requests/:id/qr
// POST /api/student/give-requests/:id/qr/renew
// POST /api/student/take-requests
// GET  /api/student/take-requests/:id
// GET  /api/student/take-requests/:id/qr
// POST /api/student/take-requests/:id/verify
// GET  /api/student/history                    ?search&type&dateFrom&dateTo&sort
// GET  /api/student/history/:type/:id
// GET  /api/student/transactions
// GET  /api/student/photos/:photoId
// GET  /api/student/complaints                 ?search&category&status&dateFrom&dateTo&sort
// POST /api/student/complaints                 { category, description, transactionId?, transactionLabel?, evidenceDataUrl? }
// GET  /api/student/complaints/:ref
// GET  /api/student/complaints/:ref/evidence
// GET  /api/student/notifications
// POST /api/student/notifications/:id/read
// GET  /api/student/profile

import express from "express";
import { query, queryOne } from "../db.js";
import { requireRole } from "../auth.js";
import { ApiError } from "../errors.js";
import { getCounterInfo } from "../counter.js";
import { findBagOfStudent } from "../bags.js";
import { logActivity } from "../activity.js";
import { qrAnswer, newShortCode } from "../qr.js";
import { savePhoto } from "../photos.js";
import { giveRows, takeRows } from "../history.js";
import { addUpdates, findComplaint, CATEGORY_LABELS } from "../complaints.js";
import { bySearch, byValue, byDate, byDateOrder } from "../filters.js";
import { makeId, minutesFromNow } from "../time.js";
import { GIVE_QR_MINUTES, TAKE_QR_MINUTES, MAX_CLOTHES } from "../config.js";

const router = express.Router();

// Every route below is for students only.
router.use(requireRole("STUDENT"));

/** The service the student picked. "ironing" means ironing only, no washing. */
function readService(service, ironing) {
  if (service === "urgent" || service === "ironing") return service;
  return "regular";
}

/** Is the one-day urgent service switched on? */
async function urgentIsOn() {
  const settings = await queryOne("SELECT urgent_enabled FROM settings WHERE id = 1");
  return settings ? settings.urgentEnabled : true;
}

/* ------------------------------------------------------------------------ */
/* Dashboard                                                                 */
/* ------------------------------------------------------------------------ */

router.get("/dashboard", async (req, res) => {
  const student = req.user;

  const bag = await findBagOfStudent(student.id);
  if (!bag) throw new ApiError(404, "No bag is assigned to this student yet.");

  const counter = await getCounterInfo();

  const activeGive = await queryOne(
    "SELECT * FROM give_requests WHERE student_id = $1 AND status = 'PENDING'",
    [student.id],
  );
  const activeTake = await queryOne(
    "SELECT * FROM take_requests WHERE student_id = $1 AND status IN ('PENDING', 'SCANNED', 'VERIFIED')",
    [student.id],
  );
  const recentActivity = await query(
    "SELECT * FROM activity WHERE student_id = $1 ORDER BY at DESC LIMIT 8",
    [student.id],
  );

  res.json({
    student: { name: student.name, studentId: student.id, bagNumber: bag.bagNumber },
    bag: bag,
    counter: counter,
    recentActivity: recentActivity,
    activeGive: activeGive,
    activeTake: activeTake,
    canGive: counter.isOpen && bag.status === "NOT_GIVEN",
    canTake: counter.isOpen && bag.status === "AT_COUNTER",
  });
});

/* ------------------------------------------------------------------------ */
/* Give Clothes                                                              */
/* ------------------------------------------------------------------------ */

router.post("/give-requests", async (req, res) => {
  const student = req.user;
  const quantity = Number(req.body.quantity);
  const photoDataUrl = req.body.photoDataUrl;

  const bag = await findBagOfStudent(student.id);
  if (!bag) throw new ApiError(404, "No bag is assigned to this student yet.");

  const counter = await getCounterInfo();
  if (!counter.isOpen) {
    throw new ApiError(409, "The counter is closed. You can still view your bag status and history.");
  }
  if (bag.status !== "NOT_GIVEN") {
    throw new ApiError(409, "Your bag is not available for a new submission right now.");
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CLOTHES) {
    throw new ApiError(400, `Choose between 1 and ${MAX_CLOTHES} clothes.`);
  }

  // Only one open request at a time.
  const existing = await queryOne(
    "SELECT id FROM give_requests WHERE student_id = $1 AND status = 'PENDING'",
    [student.id],
  );
  if (existing) throw new ApiError(409, "You already have an open Give Clothes request.");

  // The optional private reference photo.
  let photoId = null;
  if (photoDataUrl) photoId = await savePhoto(student.id, "REFERENCE", photoDataUrl);

  // Which service the student picked.
  const service = readService(req.body.service, req.body.ironing);
  if (service === "urgent" && !(await urgentIsOn())) {
    throw new ApiError(409, "The one-day urgent service is switched off right now.");
  }

  const request = await queryOne(
    `INSERT INTO give_requests (id, student_id, student_name, bag_number, quantity, photo_id,
       service, ironing, code, qr_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      makeId("give"),
      student.id,
      student.name,
      bag.bagNumber,
      quantity,
      photoId,
      service,
      Boolean(req.body.ironing),
      newShortCode("G"),
      minutesFromNow(GIVE_QR_MINUTES),
    ],
  );

  await logActivity({
    action: "Give Clothes request created",
    actorName: student.name,
    actorRole: "STUDENT",
    studentId: student.id,
    studentName: student.name,
    bagNumber: bag.bagNumber,
    result: "Waiting for worker verification",
    kind: "GIVE",
    refType: "give",
    refId: request.id,
  });

  res.status(201).json(qrAnswer("give", request));
});

router.get("/give-requests/:id", async (req, res) => {
  const request = await queryOne(
    "SELECT * FROM give_requests WHERE id = $1 AND student_id = $2",
    [req.params.id, req.user.id],
  );
  if (!request) throw new ApiError(404, "Request not found.");
  res.json(request);
});

// Shows the QR code again (for example after a page refresh). Writes nothing.
router.get("/give-requests/:id/qr", async (req, res) => {
  const request = await queryOne(
    "SELECT * FROM give_requests WHERE id = $1 AND student_id = $2",
    [req.params.id, req.user.id],
  );
  if (!request) throw new ApiError(404, "Request not found.");
  if (request.status !== "PENDING") throw new ApiError(409, "This request is no longer waiting.");
  res.json(qrAnswer("give", request));
});

// Makes a new QR code when the old one expired.
router.post("/give-requests/:id/qr/renew", async (req, res) => {
  const student = req.user;
  const old = await queryOne(
    "SELECT * FROM give_requests WHERE id = $1 AND student_id = $2",
    [req.params.id, student.id],
  );
  if (!old) throw new ApiError(404, "Request not found.");
  if (old.status === "RECEIVED") throw new ApiError(409, "This request is already complete.");

  const bag = await findBagOfStudent(student.id);
  if (bag.status !== "NOT_GIVEN") {
    throw new ApiError(409, "Your bag is not available for a new submission right now.");
  }

  // A new code can be scanned again, so scanned_at is cleared.
  const request = await queryOne(
    `UPDATE give_requests SET status = 'PENDING', qr_expires_at = $1, scanned_at = NULL
     WHERE id = $2
     RETURNING *`,
    [minutesFromNow(GIVE_QR_MINUTES), old.id],
  );

  await logActivity({
    action: "New QR code generated",
    actorName: student.name,
    actorRole: "STUDENT",
    studentId: student.id,
    studentName: student.name,
    bagNumber: request.bagNumber,
    result: "QR renewed",
    kind: "GIVE",
    refType: "give",
    refId: request.id,
  });

  res.json(qrAnswer("give", request));
});

/* ------------------------------------------------------------------------ */
/* Take Clothes                                                              */
/* ------------------------------------------------------------------------ */

router.post("/take-requests", async (req, res) => {
  const student = req.user;

  const bag = await findBagOfStudent(student.id);
  if (!bag) throw new ApiError(404, "No bag is assigned to this student yet.");

  const counter = await getCounterInfo();
  if (!counter.isOpen) {
    throw new ApiError(409, "The counter is closed. You can still view your bag status and history.");
  }
  if (bag.status !== "AT_COUNTER") {
    throw new ApiError(409, "Your bag is not ready for collection yet.");
  }

  const existing = await queryOne(
    "SELECT id FROM take_requests WHERE student_id = $1 AND status IN ('PENDING', 'SCANNED', 'VERIFIED')",
    [student.id],
  );
  if (existing) throw new ApiError(409, "You already have an open collection request.");

  const request = await queryOne(
    `INSERT INTO take_requests (id, student_id, student_name, bag_number, quantity,
       service, ironing, code, give_request_id, qr_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      makeId("take"),
      student.id,
      student.name,
      bag.bagNumber,
      bag.quantity,
      bag.service || "regular",
      Boolean(bag.ironing),
      newShortCode("T"),
      req.body.giveRequestId || null,
      minutesFromNow(TAKE_QR_MINUTES),
    ],
  );

  await logActivity({
    action: "Collection request created",
    actorName: student.name,
    actorRole: "STUDENT",
    studentId: student.id,
    studentName: student.name,
    bagNumber: bag.bagNumber,
    result: "Waiting for worker scan",
    kind: "TAKE",
    refType: "take",
    refId: request.id,
  });

  res.status(201).json(qrAnswer("take", request));
});

router.get("/take-requests/:id", async (req, res) => {
  const request = await queryOne(
    "SELECT * FROM take_requests WHERE id = $1 AND student_id = $2",
    [req.params.id, req.user.id],
  );
  if (!request) throw new ApiError(404, "Request not found.");
  res.json(request);
});

router.get("/take-requests/:id/qr", async (req, res) => {
  const request = await queryOne(
    "SELECT * FROM take_requests WHERE id = $1 AND student_id = $2",
    [req.params.id, req.user.id],
  );
  if (!request) throw new ApiError(404, "Request not found.");
  if (request.status !== "PENDING") throw new ApiError(409, "This request is no longer waiting.");
  res.json(qrAnswer("take", request));
});

// The student cancels a request that nobody has looked at yet.
// Once the worker has scanned the code it is too late to cancel.
router.post("/take-requests/:id/cancel", async (req, res) => {
  const student = req.user;
  const request = await queryOne(
    "SELECT * FROM take_requests WHERE id = $1 AND student_id = $2",
    [req.params.id, student.id],
  );
  if (!request) throw new ApiError(404, "Request not found.");
  if (request.status !== "PENDING") {
    throw new ApiError(409, "This request can no longer be cancelled.");
  }

  const updated = await queryOne(
    "UPDATE take_requests SET status = 'CANCELLED', seen = true WHERE id = $1 RETURNING *",
    [request.id],
  );

  await logActivity({
    action: "Request cancelled by the student",
    actorName: student.name,
    actorRole: "STUDENT",
    studentId: student.id,
    studentName: student.name,
    bagNumber: request.bagNumber,
    result: "Cancelled",
    kind: "TAKE",
    refType: "take",
    refId: request.id,
  });

  res.json(updated);
});

router.post("/give-requests/:id/cancel", async (req, res) => {
  const student = req.user;
  const request = await queryOne(
    "SELECT * FROM give_requests WHERE id = $1 AND student_id = $2",
    [req.params.id, student.id],
  );
  if (!request) throw new ApiError(404, "Request not found.");
  if (request.status !== "PENDING") {
    throw new ApiError(409, "This request can no longer be cancelled.");
  }

  const updated = await queryOne(
    "UPDATE give_requests SET status = 'CANCELLED', seen = true WHERE id = $1 RETURNING *",
    [request.id],
  );

  await logActivity({
    action: "Request cancelled by the student",
    actorName: student.name,
    actorRole: "STUDENT",
    studentId: student.id,
    studentName: student.name,
    bagNumber: request.bagNumber,
    result: "Cancelled",
    kind: "GIVE",
    refType: "give",
    refId: request.id,
  });

  res.json(updated);
});

// The student has seen the results of their finished requests.
router.post("/acknowledge", async (req, res) => {
  const student = req.user;
  await query(
    `UPDATE give_requests SET seen = true
     WHERE student_id = $1 AND status <> 'PENDING' AND seen = false`,
    [student.id],
  );
  await query(
    `UPDATE take_requests SET seen = true
     WHERE student_id = $1 AND status NOT IN ('PENDING', 'SCANNED', 'VERIFIED') AND seen = false`,
    [student.id],
  );
  res.json({ ok: true });
});

// The student checks the bag details and confirms.
// This is NOT the handover: the worker still has to give the bag back.
router.post("/take-requests/:id/verify", async (req, res) => {
  const student = req.user;
  const request = await queryOne(
    "SELECT * FROM take_requests WHERE id = $1 AND student_id = $2",
    [req.params.id, student.id],
  );
  if (!request) throw new ApiError(404, "Request not found.");
  if (request.status === "EXPIRED") {
    throw new ApiError(409, "Your collection session has expired. Generate a new QR code to continue.");
  }
  if (request.status !== "SCANNED") {
    throw new ApiError(409, "This collection request is not waiting for your verification.");
  }

  const updated = await queryOne(
    `UPDATE take_requests SET status = 'VERIFIED', student_verified_at = now()
     WHERE id = $1
     RETURNING *`,
    [request.id],
  );

  await logActivity({
    action: "Student verification completed",
    actorName: student.name,
    actorRole: "STUDENT",
    studentId: student.id,
    studentName: student.name,
    bagNumber: request.bagNumber,
    result: "Waiting for worker handover",
    kind: "TAKE",
    refType: "take",
    refId: request.id,
  });

  res.json(updated);
});

/* ------------------------------------------------------------------------ */
/* History                                                                   */
/* ------------------------------------------------------------------------ */

/** All give and take records of one student, filtered and sorted. */
async function getStudentHistory(studentId, filters) {
  const gives = await query("SELECT * FROM give_requests WHERE student_id = $1", [studentId]);
  const takes = await query("SELECT * FROM take_requests WHERE student_id = $1", [studentId]);

  let rows = [...(await giveRows(gives)), ...(await takeRows(takes))];
  rows = byValue(rows, "type", filters.type);
  rows = bySearch(rows, filters.search, ["bagNumber", "studentId", "studentName"]);
  rows = byDate(rows, "requestAt", filters.dateFrom, filters.dateTo);
  return byDateOrder(rows, "requestAt", filters.sort);
}

router.get("/history", async (req, res) => {
  res.json(await getStudentHistory(req.user.id, req.query));
});

// The list the student picks from when raising a complaint.
router.get("/transactions", async (req, res) => {
  res.json(await getStudentHistory(req.user.id, {}));
});

// One record with its timeline, and the id of the private photo (if any).
router.get("/history/:type/:id", async (req, res) => {
  const type = req.params.type.toUpperCase();
  const rows = await getStudentHistory(req.user.id, {});
  const row = rows.find((r) => r.type === type && r.id === req.params.id);
  if (!row) throw new ApiError(404, "Record not found.");

  let photo;
  if (type === "GIVE") {
    photo = await queryOne("SELECT photo_id FROM give_requests WHERE id = $1", [row.id]);
  } else {
    // For a collection, the photo of the submission that came before it.
    photo = await queryOne(
      `SELECT photo_id FROM give_requests
       WHERE student_id = $1 AND status = 'RECEIVED' AND received_at <= $2
       ORDER BY received_at DESC LIMIT 1`,
      [req.user.id, row.requestAt],
    );
  }

  res.json({ row: row, photoId: photo ? photo.photoId : null });
});

// The private photo. Only the student who uploaded it can read it.
router.get("/photos/:photoId", async (req, res) => {
  const photo = await queryOne(
    "SELECT data_url FROM photos WHERE id = $1 AND student_id = $2",
    [req.params.photoId, req.user.id],
  );
  if (!photo) throw new ApiError(404, "Photo not found.");
  res.json({ dataUrl: photo.dataUrl });
});

/* ------------------------------------------------------------------------ */
/* Complaints                                                                */
/* ------------------------------------------------------------------------ */

router.get("/complaints", async (req, res) => {
  let rows = await query(
    "SELECT * FROM complaints WHERE student_id = $1 ORDER BY created_at DESC",
    [req.user.id],
  );
  rows = bySearch(rows, req.query.search, ["ref", "description"]);
  rows = byValue(rows, "category", req.query.category);
  rows = byValue(rows, "status", req.query.status);
  rows = byDate(rows, "createdAt", req.query.dateFrom, req.query.dateTo);
  rows = byDateOrder(rows, "createdAt", req.query.sort);
  res.json(await addUpdates(rows));
});

router.post("/complaints", async (req, res) => {
  const student = req.user;
  const { category, transactionId, transactionLabel, evidenceDataUrl } = req.body;
  const description = String(req.body.description || "").trim();

  if (!CATEGORY_LABELS[category]) throw new ApiError(400, "Please choose a category.");
  if (!description) throw new ApiError(400, "Please describe the problem.");
  if (description.length > 2000) throw new ApiError(400, "Please keep the description under 2000 characters.");

  const bag = await findBagOfStudent(student.id);
  if (!bag) throw new ApiError(404, "Bag not found.");

  // An optional photo as proof.
  let evidenceId = null;
  if (evidenceDataUrl) evidenceId = await savePhoto(student.id, "COMPLAINT_EVIDENCE", evidenceDataUrl);

  // The reference looks like "CMP-2026-0001".
  const next = await queryOne("SELECT nextval('complaint_number') AS number");
  const ref = `CMP-${new Date().getFullYear()}-${String(next.number).padStart(4, "0")}`;

  await query(
    `INSERT INTO complaints (ref, student_id, student_name, bag_number, transaction_id,
       transaction_label, evidence_id, category, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [ref, student.id, student.name, bag.bagNumber, transactionId || null,
      transactionLabel || null, evidenceId, category, description],
  );

  await logActivity({
    action: "Complaint submitted",
    actorName: student.name,
    actorRole: "STUDENT",
    studentId: student.id,
    studentName: student.name,
    bagNumber: bag.bagNumber,
    result: CATEGORY_LABELS[category],
    kind: "COMPLAINT",
    refType: "complaint",
    refId: ref,
  });

  res.status(201).json(await findComplaint(ref));
});

router.get("/complaints/:ref", async (req, res) => {
  const complaint = await findComplaint(req.params.ref);
  if (!complaint || complaint.studentId !== req.user.id) throw new ApiError(404, "Complaint not found.");
  res.json(complaint);
});

router.get("/complaints/:ref/evidence", async (req, res) => {
  const complaint = await findComplaint(req.params.ref);
  if (!complaint || complaint.studentId !== req.user.id) throw new ApiError(404, "Complaint not found.");
  if (!complaint.evidenceId) return res.json({ dataUrl: null });

  const photo = await queryOne("SELECT data_url FROM photos WHERE id = $1", [complaint.evidenceId]);
  res.json({ dataUrl: photo ? photo.dataUrl : null });
});

/* ------------------------------------------------------------------------ */
/* Notifications and profile                                                 */
/* ------------------------------------------------------------------------ */

router.get("/notifications", async (req, res) => {
  const rows = await query(
    "SELECT * FROM notifications WHERE student_id = $1 ORDER BY at DESC LIMIT 30",
    [req.user.id],
  );
  res.json(rows);
});

// All the reference photos of the student, one request for all of them.
// The answer is keyed by the id of the submission the photo belongs to.
router.get("/photos", async (req, res) => {
  const photos = await query(
    `SELECT give_requests.id AS request_id, photos.data_url
     FROM give_requests
     JOIN photos ON photos.id = give_requests.photo_id
     WHERE give_requests.student_id = $1`,
    [req.user.id],
  );
  const result = {};
  for (const photo of photos) result[photo.requestId] = photo.dataUrl;
  res.json(result);
});

router.post("/notifications/:id/read", async (req, res) => {
  // student_id in the WHERE: a student can only mark their own notifications.
  await query("UPDATE notifications SET read = true WHERE id = $1 AND student_id = $2", [
    req.params.id,
    req.user.id,
  ]);
  res.json({ ok: true });
});

router.get("/profile", async (req, res) => {
  const student = req.user;
  const bag = await findBagOfStudent(student.id);

  const gives = await queryOne("SELECT COUNT(*) AS count FROM give_requests WHERE student_id = $1", [student.id]);
  const takes = await queryOne("SELECT COUNT(*) AS count FROM take_requests WHERE student_id = $1", [student.id]);
  const complaints = await queryOne("SELECT COUNT(*) AS count FROM complaints WHERE student_id = $1", [student.id]);

  res.json({
    name: student.name,
    studentId: student.id,
    bagNumber: bag ? bag.bagNumber : "-",
    bagStatus: bag ? bag.status : "NOT_GIVEN",
    stats: {
      // COUNT(*) comes back as text, so turn it into a number.
      giveCount: Number(gives.count),
      takeCount: Number(takes.count),
      complaintCount: Number(complaints.count),
    },
  });
});

export default router;
