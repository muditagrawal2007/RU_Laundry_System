// history.js
// ----------
// Turns give requests and take requests into the "history rows" the screens show.
// Each row also gets its timeline: the activity lines that belong to it.

import { query } from "./db.js";

/** The text shown in the "Result" column for a give request. */
export function giveResult(status) {
  if (status === "RECEIVED") return "Bag received";
  if (status === "EXPIRED") return "QR expired";
  return "Waiting for worker verification";
}

/** The text shown in the "Result" column for a take request. */
export function takeResult(status) {
  if (status === "COMPLETED") return "Clothes collected successfully";
  if (status === "VERIFIED") return "Waiting for worker handover";
  if (status === "SCANNED") return "Waiting for student verification";
  if (status === "EXPIRED") return "Session expired";
  return "Waiting for worker scan";
}

/** Give requests -> history rows. */
export async function giveRows(requests) {
  const events = await query("SELECT * FROM activity WHERE ref_type = 'give' ORDER BY at DESC");

  return requests.map((r) => ({
    id: r.id,
    type: "GIVE",
    studentId: r.studentId,
    studentName: r.studentName,
    bagNumber: r.bagNumber,
    quantity: r.quantity,
    service: r.service,
    ironing: r.ironing,
    code: r.code,
    seen: r.seen,
    qrExpiresAt: r.qrExpiresAt,
    requestAt: r.createdAt,
    result: giveResult(r.status),
    status: r.status,
    workerId: r.workerId,
    confirmedQuantity: r.confirmedQuantity,
    receivedAt: r.receivedAt,
    timeline: events.filter((e) => e.refId === r.id),
  }));
}

/** Take requests -> history rows. */
export async function takeRows(requests) {
  const events = await query("SELECT * FROM activity WHERE ref_type = 'take' ORDER BY at DESC");

  return requests.map((r) => ({
    id: r.id,
    type: "TAKE",
    studentId: r.studentId,
    studentName: r.studentName,
    bagNumber: r.bagNumber,
    quantity: r.quantity,
    service: r.service,
    ironing: r.ironing,
    code: r.code,
    seen: r.seen,
    giveRequestId: r.giveRequestId,
    qrExpiresAt: r.qrExpiresAt,
    sessionExpiresAt: r.sessionExpiresAt,
    requestAt: r.createdAt,
    result: takeResult(r.status),
    status: r.status,
    workerId: r.workerId,
    scannedAt: r.scannedAt,
    studentVerifiedAt: r.studentVerifiedAt,
    handedOverAt: r.handedOverAt,
    handoverBy: r.handoverBy,
    timeline: events.filter((e) => e.refId === r.id),
  }));
}
