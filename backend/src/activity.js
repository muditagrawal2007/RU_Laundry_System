// activity.js
// -----------
// Writing to the activity history and sending notifications to students.

import { query } from "./db.js";

/** The "actor" of lines written by the server itself (expired QR codes). */
export const SYSTEM = { name: "System", role: "SYSTEM" };

/** The "subject" of lines that are about no student (the counter opening). */
export const NO_STUDENT = { studentId: "-", studentName: "-", bagNumber: "-" };

/**
 * Adds one line to the activity history. Nothing is ever deleted from it.
 *
 *   actor   who did it: req.user (the worker, student or admin) or SYSTEM
 *   subject whose bag it is: anything with studentId, studentName and
 *           bagNumber (a bag, a give/take request, a complaint) or NO_STUDENT
 *   what    { action, result, kind, refId?, fromStatus?, toStatus?, reason? }
 *           kind is GIVE, TAKE, COMPLAINT, BAG or COUNTER. When refId is given,
 *           the line belongs to that request, so the timeline can find it.
 */
export async function logActivity(actor, subject, what) {
  await query(
    `INSERT INTO activity (action, actor_name, actor_role, student_id, student_name, bag_number,
       from_status, to_status, reason, result, kind, ref_type, ref_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      what.action,
      actor.name,
      actor.role,
      subject.studentId,
      subject.studentName,
      subject.bagNumber,
      what.fromStatus || null,
      what.toStatus || null,
      what.reason || null,
      what.result,
      what.kind,
      what.refId ? what.kind.toLowerCase() : null,
      what.refId || null,
    ],
  );
}

/** Puts a message in one student's notification bell. */
export async function notifyStudent(studentId, title, body, link) {
  await query(
    "INSERT INTO notifications (student_id, title, body, link) VALUES ($1, $2, $3, $4)",
    [studentId, title, body, link],
  );
}

/** Puts the same message in every student's bell (when the counter opens or closes). */
export async function notifyAllStudents(title, body, link) {
  await query(
    `INSERT INTO notifications (student_id, title, body, link)
     SELECT id, $1, $2, $3 FROM users WHERE role = 'STUDENT'`,
    [title, body, link],
  );
}
