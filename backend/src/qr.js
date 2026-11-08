// qr.js
// -----
// Makes the text that goes inside a QR code, and reads it back.
//
// The text looks like this:   RU1.<data>.<signature>
//
// The signature is made from the data and QR_SECRET (a password only the server
// knows). If anybody changes even one letter of the data, the signature no longer
// matches and the code is refused. The data also says when the code expires.

import crypto from "node:crypto";
import { QR_SECRET } from "./config.js";

/** Makes the signature of some text with the server's secret (HMAC-SHA256). */
function makeSignature(text) {
  return crypto.createHmac("sha256", QR_SECRET).update(text).digest("base64url");
}

/** Makes the QR text for a request. kind is "give" or "take". */
export function createQrToken(kind, request) {
  const payload = {
    kind: kind,
    requestId: request.id,
    studentId: request.studentId,
    bagNumber: request.bagNumber,
    expiresAt: new Date(request.qrExpiresAt).getTime(),
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return "RU1." + data + "." + makeSignature(data);
}

/** Reads a scanned QR text. Returns the payload, or null if it is fake or expired. */
export function readQrToken(text) {
  const parts = String(text || "").trim().split(".");
  if (parts.length !== 3 || parts[0] !== "RU1") return null;

  const data = parts[1];
  const signature = parts[2];
  if (makeSignature(data) !== signature) return null; // fake or changed

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (payload.expiresAt < Date.now()) return null; // expired
    return payload;
  } catch {
    return null; // not readable
  }
}

/** What the student screens expect after making a QR: { request, qrText, qrExpiresAt }. */
export function qrAnswer(kind, request) {
  return {
    request: request,
    qrText: createQrToken(kind, request),
    qrExpiresAt: request.qrExpiresAt,
  };
}

/**
 * Makes the short code the student shows and the worker types in.
 *
 * It looks like "G-4KP7XZ". The letters that look like numbers (0, 1, I, O) are left
 * out, so the code is easy to read out loud and hard to guess.
 */
export function newShortCode(prefix) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${code}`;
}
