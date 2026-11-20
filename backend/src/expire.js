// expire.js
// ---------
// Marks old requests as EXPIRED.
//
// This runs before every API request (see app.js), so a QR code that timed out
// is never accepted, even if the worker scans it a minute later.
//
// "RETURNING *" gives back the rows the UPDATE changed, so we can write one
// history line for each of them.

import { query } from "./db.js";
import { logActivity, notifyStudent, SYSTEM } from "./activity.js";

export async function expireOldRequests() {
  // 1. Give Clothes codes that were never verified.
  const expiredGives = await query(
    `UPDATE give_requests SET status = 'EXPIRED'
     WHERE status = 'PENDING' AND qr_expires_at < now()
     RETURNING *`,
  );
  for (const request of expiredGives) {
    await logActivity(SYSTEM, request, {
      action: "Submission QR expired",
      result: "QR expired",
      kind: "GIVE",
      refId: request.id,
    });
    await notifyStudent(
      request.studentId,
      "Your submission QR code has expired.",
      "Your QR code has expired. Generate a new one to continue.",
      "/student/give",
    );
  }

  // 2. Take Clothes codes that the worker never scanned.
  await query(
    `UPDATE take_requests SET status = 'EXPIRED'
     WHERE status = 'PENDING' AND qr_expires_at < now()`,
  );

  // 3. Collections where the student did not verify in time.
  const expiredTakes = await query(
    `UPDATE take_requests SET status = 'EXPIRED'
     WHERE status = 'SCANNED' AND session_expires_at < now()
     RETURNING *`,
  );
  for (const request of expiredTakes) {
    await logActivity(SYSTEM, request, {
      action: "Collection session expired",
      result: "Session expired",
      kind: "TAKE",
      refId: request.id,
    });
    await notifyStudent(
      request.studentId,
      "Your collection session has expired. Generate a new QR.",
      "Your collection session has expired. Generate a new QR code to continue.",
      "/student/take",
    );
  }
}
