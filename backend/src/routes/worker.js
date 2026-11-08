// routes/worker.js
// ----------------
// Everything the worker app can do. Only signed in workers get in.
//
// GET  /api/worker/dashboard
// POST /api/worker/qr/scan                          { text }
// POST /api/worker/give-requests/:id/verify         { confirmedQuantity? }
// POST /api/worker/give-requests/:id/return-to-counter
// POST /api/worker/take-requests/:id/scan
// POST /api/worker/take-requests/:id/handover
// POST /api/worker/manual-handover                  { studentId, reason }
// POST /api/worker/status-corrections               { studentId, toStatus, reason }
// GET  /api/worker/give-requests                    ?search&outcome&dateFrom&dateTo&sort
// GET  /api/worker/take-requests                    ?search&outcome&dateFrom&dateTo&sort
// GET  /api/worker/activity                         ?search&action&dateFrom&dateTo
// GET  /api/worker/students                         ?q=
//
// Two rules that must never break:
//   * Scanning a QR code is NOT a handover. The bag only moves when the worker
//     confirms the physical handover.
//   * The student's reference photo is private. No worker answer contains it.
//
// Many UPDATEs below have "AND status = '...'" in the WHERE. That way, if two
// workers press the same button at the same moment, only the first one works.

import express from "express";
import { query, queryOne } from "../db.js";
import { requireRole } from "../auth.js";
import { ApiError } from "../errors.js";
import { getCounterInfo } from "../counter.js";
import { findBagOfStudent, findBagByNumber, getAllBags } from "../bags.js";
import { logActivity, notifyStudent } from "../activity.js";
import { readQrToken } from "../qr.js";
import { giveRows, takeRows } from "../history.js";
import { bySearch, byValue, byDate, byDateOrder } from "../filters.js";
import { minutesFromNow } from "../time.js";
import { VERIFY_WINDOW_MINUTES, MAX_CLOTHES } from "../config.js";

const router = express.Router();

// Every route below is for workers only.
router.use(requireRole("WORKER"));

const BAD_QR = "This QR code cannot be used. Ask the student to generate a new QR code.";
const BAG_STATUSES = ["NOT_GIVEN", "IN_PROCESS", "AT_COUNTER"];

/** A give request without the photo id: workers never see the private photo. */
function hidePhoto(request) {
  return { ...request, photoId: undefined };
}

/** Finds one request, either a submission or a collection. */
async function findRequestById(kind, id) {
  if (kind === "give") return queryOne("SELECT * FROM give_requests WHERE id = $1", [id]);
  return queryOne("SELECT * FROM take_requests WHERE id = $1", [id]);
}

/** How many days a service takes. */
function daysFor(service) {
  if (service === "regular") return 3;
  return 1; // urgent and ironing are ready in one day
}

/* ------------------------------------------------------------------------ */
/* Dashboard                                                                 */
/* ------------------------------------------------------------------------ */

router.get("/dashboard", async (req, res) => {
  const gives = await queryOne("SELECT COUNT(*) AS count FROM give_requests WHERE status = 'PENDING'");
  const takes = await queryOne(
    "SELECT COUNT(*) AS count FROM take_requests WHERE status IN ('SCANNED', 'VERIFIED')",
  );
  const recentHandovers = await query(
    `SELECT * FROM activity
     WHERE action IN ('Clothes collected successfully', 'Manual handover completed')
     ORDER BY at DESC LIMIT 5`,
  );

  res.json({
    worker: { name: req.user.name, workerId: req.user.id },
    pendingGiveCount: Number(gives.count),
    pendingTakeCount: Number(takes.count),
    recentHandovers: recentHandovers,
    counter: await getCounterInfo(),
  });
});

/* ------------------------------------------------------------------------ */
/* Scanning a QR code                                                        */
/* ------------------------------------------------------------------------ */

// Reads a scanned code and returns the request it belongs to.
// A fake, expired or already used code is refused. Nothing is handed over here.
//
// Two kinds of code work:
//   - the signed text of a QR code (what the phone shows)
//   - the short code under it, like "G-4KP7XZ" (what the worker types in)
router.post("/qr/scan", async (req, res) => {
  const text = String(req.body.text || "").trim();

  // The short code first: it is what the worker types in. The QR text may have
  // "RU-LAUNDRY|" in front of it, so we keep only the last part.
  const short = text.toUpperCase().split("|").pop().trim();
  const byCode = await queryOne(
    `SELECT id, 'give' AS kind FROM give_requests WHERE code = $1
     UNION ALL
     SELECT id, 'take' AS kind FROM take_requests WHERE code = $1`,
    [short],
  );
  if (byCode) {
    const request = await findRequestById(byCode.kind, byCode.id);
    if (!request) throw new ApiError(409, BAD_QR);
    return res.json({ kind: byCode.kind, request: byCode.kind === "give" ? hidePhoto(request) : request });
  }

  const payload = readQrToken(text);
  if (!payload) {
    throw new ApiError(
      400,
      "This QR code cannot be used. Ask the student to generate a new QR code or check the request details.",
    );
  }

  if (payload.kind === "give") {
    // A submission code works for one scan only (scanned_at must still be empty).
    const request = await queryOne(
      `UPDATE give_requests SET scanned_at = now()
       WHERE id = $1 AND status = 'PENDING' AND scanned_at IS NULL
       RETURNING *`,
      [payload.requestId],
    );
    if (!request) throw new ApiError(409, BAD_QR);
    return res.json({ kind: "give", request: hidePhoto(request) });
  }

  if (payload.kind === "take") {
    const request = await queryOne("SELECT * FROM take_requests WHERE id = $1", [payload.requestId]);
    if (!request || request.status !== "PENDING") throw new ApiError(409, BAD_QR);
    return res.json({ kind: "take", request: request });
  }

  throw new ApiError(400, BAD_QR);
});

/* ------------------------------------------------------------------------ */
/* Give Clothes: receive the bag, then return it to the counter              */
/* ------------------------------------------------------------------------ */

// The worker has the physical bag and confirms it: NOT_GIVEN -> IN_PROCESS.
router.post("/give-requests/:id/verify", async (req, res) => {
  const worker = req.user;
  const request = await queryOne("SELECT * FROM give_requests WHERE id = $1", [req.params.id]);
  if (!request) throw new ApiError(404, "Request not found.");
  if (request.status !== "PENDING") throw new ApiError(409, "This request has already been handled.");

  const bag = await findBagOfStudent(request.studentId);
  if (bag.status !== "NOT_GIVEN") throw new ApiError(409, "This bag is not waiting for a submission.");

  // The worker can correct the number of clothes after counting them.
  let quantity = request.quantity;
  if (req.body.confirmedQuantity !== undefined) quantity = Number(req.body.confirmedQuantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CLOTHES) {
    throw new ApiError(400, `The number of clothes must be between 1 and ${MAX_CLOTHES}.`);
  }

  const updated = await queryOne(
    `UPDATE give_requests
     SET status = 'RECEIVED', confirmed_quantity = $1, received_at = now(), worker_id = $2
     WHERE id = $3 AND status = 'PENDING'
     RETURNING *`,
    [quantity, worker.id, request.id],
  );
  if (!updated) throw new ApiError(409, "This request has already been handled.");

  // The bag now has the service the student chose, and it is due in a few days.
  const service = request.service || "regular";
  const dueAt = new Date(Date.now() + daysFor(service) * 86400000);

  await query(
    `UPDATE bags
     SET status = 'IN_PROCESS', quantity = $1, service = $2, ironing = $3,
         progress = $4, due_at = $5, received_at = now(), returned_at = NULL,
         collected_at = NULL, received_by = $6, returned_by = NULL,
         updated_by = $7, updated_at = now()
     WHERE bag_number = $8`,
    [
      quantity,
      service,
      request.ironing,
      service === "ironing" ? "Ironing in Progress" : "Bag received",
      dueAt,
      worker.id,
      worker.name,
      bag.bagNumber,
    ],
  );

  await logActivity({
    action: "Bag received by worker",
    actorName: worker.name,
    actorRole: "WORKER",
    studentId: request.studentId,
    studentName: request.studentName,
    bagNumber: request.bagNumber,
    fromStatus: "NOT_GIVEN",
    toStatus: "IN_PROCESS",
    result: "Bag received",
    kind: "GIVE",
    refType: "give",
    refId: request.id,
  });
  await notifyStudent(
    request.studentId,
    "Your bag has been received by the laundry worker.",
    "The laundry team has received your clothes.",
    "/student",
  );

  res.json(hidePhoto(updated));
});

// The clothes are back at the counter: IN_PROCESS -> AT_COUNTER.
// The :id can be a give request id, a bag number or a student id.
router.post("/give-requests/:id/return-to-counter", async (req, res) => {
  const worker = req.user;
  const target = req.params.id;

  let bag = null;
  const request = await queryOne("SELECT student_id FROM give_requests WHERE id = $1", [target]);
  if (request) bag = await findBagOfStudent(request.studentId);
  if (!bag) bag = await findBagByNumber(target);
  if (!bag) bag = await findBagOfStudent(target);
  if (!bag) throw new ApiError(404, "Bag not found.");

  const updated = await queryOne(
    `UPDATE bags
     SET status = 'AT_COUNTER', progress = NULL, returned_at = now(), returned_by = $1,
         updated_by = $2, updated_at = now()
     WHERE bag_number = $3 AND status = 'IN_PROCESS'
     RETURNING *`,
    [worker.id, worker.name, bag.bagNumber],
  );
  if (!updated) throw new ApiError(409, "This bag is not in process.");

  await logActivity({
    action: "Bag returned to counter",
    actorName: worker.name,
    actorRole: "WORKER",
    studentId: bag.studentId,
    studentName: bag.studentName,
    bagNumber: bag.bagNumber,
    fromStatus: "IN_PROCESS",
    toStatus: "AT_COUNTER",
    result: "Ready for collection",
    kind: "BAG",
  });
  await notifyStudent(
    bag.studentId,
    "Your clothes are ready for collection.",
    "Your clothes are ready for collection at the counter.",
    "/student/take",
  );

  res.json(await findBagByNumber(bag.bagNumber));
});

// The worker moves the bag on to the next step: washing, then ironing.
router.post("/bags/:bagNumber/progress", async (req, res) => {
  const worker = req.user;
  const bag = await findBagByNumber(req.params.bagNumber);
  if (!bag) throw new ApiError(404, "Bag not found.");
  if (bag.status !== "IN_PROCESS") throw new ApiError(409, "This bag is not being washed.");

  const progress = String(req.body.progress || "");
  const allowed = ["Bag received", "Washing in Progress", "Ironing in Progress"];
  if (!allowed.includes(progress)) throw new ApiError(400, "That is not a step of the washing.");

  const updated = await queryOne(
    `UPDATE bags SET progress = $1, updated_by = $2, updated_at = now()
     WHERE bag_number = $3
     RETURNING *`,
    [progress, worker.name, bag.bagNumber],
  );

  await logActivity({
    action: "Progress: " + progress,
    actorName: worker.name,
    actorRole: "WORKER",
    studentId: bag.studentId,
    studentName: bag.studentName,
    bagNumber: bag.bagNumber,
    result: progress,
    kind: "BAG",
  });
  await notifyStudent(
    bag.studentId,
    "Your laundry update: " + progress + ".",
    "Your laundry update: " + progress + ".",
    "/student",
  );

  res.json(updated);
});

/* ------------------------------------------------------------------------ */
/* Take Clothes: scan -> student verifies -> worker hands over               */
/* ------------------------------------------------------------------------ */

// The worker scanned the collection code. This does NOT hand over the bag.
// The student now has a few minutes to check and confirm on their phone.
router.post("/take-requests/:id/scan", async (req, res) => {
  const worker = req.user;
  const request = await queryOne(
    `UPDATE take_requests
     SET status = 'SCANNED', scanned_at = now(), worker_id = $1, session_expires_at = $2
     WHERE id = $3 AND status = 'PENDING'
     RETURNING *`,
    [worker.id, minutesFromNow(VERIFY_WINDOW_MINUTES), req.params.id],
  );
  if (!request) throw new ApiError(409, "This collection request has already been handled.");

  await logActivity({
    action: "Collection QR scanned",
    actorName: worker.name,
    actorRole: "WORKER",
    studentId: request.studentId,
    studentName: request.studentName,
    bagNumber: request.bagNumber,
    result: "Waiting for student verification",
    kind: "TAKE",
    refType: "take",
    refId: request.id,
  });
  await notifyStudent(
    request.studentId,
    "Your bag is ready for verification.",
    "The worker scanned your code. Please check your bag details and confirm.",
    "/student/take/verify",
  );

  res.json(request);
});

// The worker physically gives the bag back: AT_COUNTER -> NOT_GIVEN.
// Only allowed after the student verified.
router.post("/take-requests/:id/handover", async (req, res) => {
  const worker = req.user;
  const request = await queryOne(
    `UPDATE take_requests SET status = 'COMPLETED', handed_over_at = now(), handover_by = $1
     WHERE id = $2 AND status = 'VERIFIED'
     RETURNING *`,
    [worker.id, req.params.id],
  );
  if (!request) throw new ApiError(409, "The student has not verified the bag yet.");

  await query(
    `UPDATE bags
     SET status = 'NOT_GIVEN', quantity = 0, service = 'regular', ironing = false,
         progress = NULL, due_at = NULL, collected_at = now(), returned_at = NULL,
         updated_by = $1, updated_at = now()
     WHERE bag_number = $2`,
    [worker.name, request.bagNumber],
  );

  await logActivity({
    action: "Clothes collected successfully",
    actorName: worker.name,
    actorRole: "WORKER",
    studentId: request.studentId,
    studentName: request.studentName,
    bagNumber: request.bagNumber,
    fromStatus: "AT_COUNTER",
    toStatus: "NOT_GIVEN",
    result: "Collected",
    kind: "TAKE",
    refType: "take",
    refId: request.id,
  });
  await notifyStudent(
    request.studentId,
    "Your clothes have been collected successfully.",
    `Bag ${request.bagNumber} was handed over to you.`,
    "/student",
  );

  res.json(request);
});

/* ------------------------------------------------------------------------ */
/* Exceptions: manual handover and status correction (reason required)      */
/* ------------------------------------------------------------------------ */

// The bag is handed over without the normal QR steps (an approved exception).
router.post("/manual-handover", async (req, res) => {
  const worker = req.user;
  const reason = String(req.body.reason || "").trim();
  if (!reason) throw new ApiError(400, "Please choose a reason for the manual handover.");

  const bag = await findBagOfStudent(req.body.studentId);
  if (!bag) throw new ApiError(404, "Student or bag not found.");
  if (bag.status === "NOT_GIVEN") throw new ApiError(409, "This bag has nothing to hand over.");

  await query(
    `UPDATE bags
     SET status = 'NOT_GIVEN', quantity = 0, collected_at = now(), returned_at = NULL,
         updated_by = $1, updated_at = now()
     WHERE bag_number = $2`,
    [worker.name, bag.bagNumber],
  );

  // Any open collection request is no longer needed.
  await query(
    `UPDATE take_requests SET status = 'EXPIRED'
     WHERE student_id = $1 AND status IN ('PENDING', 'SCANNED', 'VERIFIED')`,
    [bag.studentId],
  );

  await logActivity({
    action: "Manual handover completed",
    actorName: worker.name,
    actorRole: "WORKER",
    studentId: bag.studentId,
    studentName: bag.studentName,
    bagNumber: bag.bagNumber,
    fromStatus: bag.status,
    toStatus: "NOT_GIVEN",
    reason: reason,
    result: "Manual handover recorded",
    kind: "BAG",
  });
  await notifyStudent(
    bag.studentId,
    "Your bag was handed over to you.",
    "A staff member completed a manual handover for your bag.",
    "/student",
  );

  const updatedBag = await findBagByNumber(bag.bagNumber);
  res.json({ bag: updatedBag, at: updatedBag.updatedAt });
});

// Fixes a bag status that is wrong.
router.post("/status-corrections", async (req, res) => {
  const worker = req.user;
  const toStatus = req.body.toStatus;
  const reason = String(req.body.reason || "").trim();

  if (!BAG_STATUSES.includes(toStatus)) throw new ApiError(400, "Choose a valid bag status.");
  if (!reason) throw new ApiError(400, "Please write a reason for the correction.");

  const bag = await findBagOfStudent(req.body.studentId);
  if (!bag) throw new ApiError(404, "Bag not found.");
  if (bag.status === toStatus) throw new ApiError(409, "The bag already has this status.");

  await query("UPDATE bags SET status = $1, updated_by = $2, updated_at = now() WHERE bag_number = $3", [
    toStatus,
    worker.name,
    bag.bagNumber,
  ]);

  // Open requests were made for the old status, so they are closed.
  await query("UPDATE give_requests SET status = 'EXPIRED' WHERE student_id = $1 AND status = 'PENDING'", [
    bag.studentId,
  ]);
  await query(
    `UPDATE take_requests SET status = 'EXPIRED'
     WHERE student_id = $1 AND status IN ('PENDING', 'SCANNED', 'VERIFIED')`,
    [bag.studentId],
  );

  await logActivity({
    action: "Status correction recorded",
    actorName: worker.name,
    actorRole: "WORKER",
    studentId: bag.studentId,
    studentName: bag.studentName,
    bagNumber: bag.bagNumber,
    fromStatus: bag.status,
    toStatus: toStatus,
    reason: reason,
    result: "Correction recorded",
    kind: "BAG",
  });

  res.json(await findBagByNumber(bag.bagNumber));
});

/* ------------------------------------------------------------------------ */
/* Lists                                                                     */
/* ------------------------------------------------------------------------ */

router.get("/give-requests", async (req, res) => {
  const requests = await query("SELECT * FROM give_requests");
  let rows = await giveRows(requests);
  rows = bySearch(rows, req.query.search, ["studentId", "bagNumber"]);
  rows = byValue(rows, "status", req.query.outcome);
  rows = byDate(rows, "requestAt", req.query.dateFrom, req.query.dateTo);
  res.json(byDateOrder(rows, "requestAt", req.query.sort));
});

router.get("/take-requests", async (req, res) => {
  const requests = await query("SELECT * FROM take_requests");
  let rows = await takeRows(requests);
  rows = bySearch(rows, req.query.search, ["studentId", "bagNumber"]);
  rows = byValue(rows, "status", req.query.outcome);
  rows = byDate(rows, "requestAt", req.query.dateFrom, req.query.dateTo);
  res.json(byDateOrder(rows, "requestAt", req.query.sort));
});

// One submission on its own. The worker screens need the full record (the QR
// expiry time, the received time) and not just the row of the list.
// The photo of the student is never part of the answer.
router.get("/give-requests/:id", async (req, res) => {
  const request = await queryOne("SELECT * FROM give_requests WHERE id = $1", [req.params.id]);
  if (!request) throw new ApiError(404, "Request not found.");
  res.json(hidePhoto(request));
});

// One collection on its own.
router.get("/take-requests/:id", async (req, res) => {
  const request = await queryOne("SELECT * FROM take_requests WHERE id = $1", [req.params.id]);
  if (!request) throw new ApiError(404, "Request not found.");
  res.json(request);
});

router.get("/activity", async (req, res) => {
  let rows = await query("SELECT * FROM activity ORDER BY at DESC");
  rows = bySearch(rows, req.query.search, ["studentId", "bagNumber"]);
  rows = byValue(rows, "action", req.query.action);
  rows = byDate(rows, "at", req.query.dateFrom, req.query.dateTo);
  res.json(rows.slice(0, 100));
});

// Used by the manual handover screen to find the right student.
router.get("/students", async (req, res) => {
  let bags = await getAllBags();
  bags = bySearch(bags, req.query.q, ["studentId", "studentName", "bagNumber"]);
  res.json(bags.slice(0, 8));
});

export default router;
