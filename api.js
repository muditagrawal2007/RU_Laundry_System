// api.js - the one place that talks to the laundry server.
//
// Everything the app needs is in the PostgreSQL database on the server. This file
// asks the server for the data and sends the changes back. The screens never
// call fetch() themselves.
//
// How a sign in works:
//   1. login() asks the server for a token and keeps it in sessionStorage.
//   2. Every call sends that token back in the "Authorization" header.
//   3. The server works out who is calling from the token, so the app never
//      sends a student id or a worker id of its own.
//
// The server answers with JSON. The names here are the ones the screens use.

const API_URL = "http://localhost:4000/api";
const TOKEN_KEY = "ruLaundryToken";

// ================= THE BASICS =================

function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
}

function setToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch (e) { /* no storage, the app still works in one tab */ }
}

/** Thrown when the server says no. The message is meant to be shown to the user. */
function ApiError(message, status) {
  this.name = "ApiError";
  this.message = message;
  this.status = status || 500;
}
ApiError.prototype = Object.create(Error.prototype);

/** Calls the server and answers with the JSON it sent. */
async function call(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = "Bearer " + token;

  let response;
  try {
    response = await fetch(API_URL + path, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (e) {
    throw new ApiError("Cannot reach the laundry server. Please try again in a moment.", 0);
  }

  if (response.status === 401) {
    setToken(null);
    throw new ApiError("Your sign in has run out. Please sign in again.", 401);
  }

  const data = await response.json().catch(function () { return {}; });
  if (!response.ok) throw new ApiError(data.error || "Something went wrong. Please try again.", response.status);
  return data;
}

// ================= THE WORDS THE SCREENS SHOW =================

// The bag statuses of the database, as the screens write them.
const BAG_STATUS = {
  NOT_GIVEN: "Bag not given",
  IN_PROCESS: "Bag in process",
  AT_COUNTER: "Bag at counter"
};

// The request statuses of the database, as the screens write them.
const REQ_STATUS = {
  PENDING: "qr_generated",
  RECEIVED: "completed",
  SCANNED: "scanned",
  VERIFIED: "student_verified",
  COMPLETED: "completed",
  EXPIRED: "expired",
  CANCELLED: "cancelled"
};

// The complaint categories of the database, as the screens write them.
const CATEGORY_TO_SCREEN = {
  MISSING_CLOTHES: "Missing clothes",
  DAMAGED_CLOTHES: "Damaged clothes",
  INCORRECT_QUANTITY: "Incorrect quantity",
  WRONG_BAG: "Wrong bag received",
  DELAY: "Delay in returning clothes",
  OTHER: "Other"
};
const CATEGORY_FROM_SCREEN = {
  "Missing clothes": "MISSING_CLOTHES",
  "Damaged clothes": "DAMAGED_CLOTHES",
  "Incorrect quantity": "INCORRECT_QUANTITY",
  "Wrong bag received": "WRONG_BAG",
  "Delay in returning clothes": "DELAY",
  "Other": "OTHER"
};

// The complaint statuses of the database, as the screens write them.
const COMPLAINT_STATUS_TO_SCREEN = {
  SUBMITTED: "Open",
  IN_REVIEW: "Under review",
  IN_PROGRESS: "Under review",
  RESOLVED: "Resolved"
};
const COMPLAINT_STATUS_FROM_SCREEN = {
  "Open": "SUBMITTED",
  "Under review": "IN_REVIEW",
  "Resolved": "RESOLVED"
};

// ================= SHAPING THE ANSWERS =================

/** A bag of the database, as the screens expect it. */
function toBag(row) {
  return {
    number: row.bagNumber,
    studentId: row.studentId,
    status: BAG_STATUS[row.status] || row.status,
    quantity: row.quantity === 0 ? null : row.quantity,
    service: row.service || null,
    ironing: Boolean(row.ironing),
    progress: row.progress || null,
    dueAt: row.dueAt || null,
    receivedAt: row.receivedAt || null,
    returnedAt: row.returnedAt || null,
    collectedAt: row.collectedAt || null,
    receivedBy: row.receivedBy || null,
    returnedBy: row.returnedBy || null,
    updatedBy: row.updatedBy || null,
    updatedAt: row.updatedAt || null
  };
}

/** A request of the database, as the screens expect it. */
function toTxn(row, events) {
  return {
    id: row.id,
    type: row.type,
    studentId: row.studentId,
    bag: row.bagNumber,
    quantity: row.quantity,
    service: row.service || "regular",
    ironing: Boolean(row.ironing),
    status: REQ_STATUS[row.status] || row.status,
    code: row.code || "",
    createdAt: row.createdAt,
    expiresAt: row.qrExpiresAt,
    verifyExpiresAt: row.sessionExpiresAt || null,
    completedAt: row.receivedAt || row.handedOverAt || null,
    scannedAt: row.scannedAt || null,
    studentVerifiedAt: row.studentVerifiedAt || null,
    handoverBy: row.handoverBy || null,
    workerId: row.workerId || null,
    confirmedQuantity: row.confirmedQuantity,
    seen: Boolean(row.seen),
    giveTxnId: row.giveRequestId || null,
    events: events || []
  };
}

/** One complaint of the database, as the screens expect it. */
function toComplaint(row) {
  return {
    id: row.ref,
    studentId: row.studentId,
    bag: row.bagNumber,
    txnId: row.transactionId || null,
    category: CATEGORY_TO_SCREEN[row.category] || row.category,
    description: row.description,
    status: COMPLAINT_STATUS_TO_SCREEN[row.status] || row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt || null,
    resolvedBy: row.assignedTo || null,
    handledBy: row.assignedTo || null,
    updates: (row.updates || []).map(function (u) {
      return { time: u.at, by: u.authorName, text: u.body, status: u.body };
    })
  };
}

/** One history line of the database, as the screens expect it. */
function toActivity(row) {
  return {
    time: row.at,
    text: row.action,
    studentId: row.studentId,
    bag: row.bagNumber,
    by: row.actorName
  };
}

/** One notification of the database, as the screens expect it. */
function toNotification(row) {
  return {
    id: String(row.id),
    studentId: row.studentId,
    text: row.title + " " + row.body,
    time: row.at,
    read: Boolean(row.read)
  };
}

// ================= SIGN IN =================

/** Signs in and keeps the token. Answers with the user. */
async function login(portal, identifier, password) {
  const answer = await call("POST", "/auth/login", { portal: portal, identifier: identifier, password: password });
  setToken(answer.token);
  return answer.user;
}

/** Signs out and forgets the token. */
async function logout() {
  try { await call("POST", "/auth/logout"); } catch (e) { /* the token may already be gone */ }
  setToken(null);
}

/** Who is signed in right now, or null. */
async function whoAmI() {
  if (!getToken()) return null;
  try {
    const answer = await call("GET", "/auth/session");
    return answer.user;
  } catch (e) {
    setToken(null);
    return null;
  }
}

// ================= READING =================

/** The counter: is it open right now? */
async function loadCounter() {
  const answer = await call("GET", "/student/dashboard");
  return answer.counter;
}

/** Everything the student screens show. */
async function loadStudentData() {
  const data = { students: [], workers: [], admins: [], bags: [], transactions: [], complaints: [], notifications: [], activity: [], counterOpen: true, settings: { urgentEnabled: true } };

  const dashboard = await call("GET", "/student/dashboard");
  data.students.push({ id: dashboard.student.studentId, name: dashboard.student.name, bag: dashboard.student.bagNumber });
  data.bags.push(toBag(dashboard.bag));
  data.counterOpen = dashboard.counter.isOpen;

  const history = await call("GET", "/student/history");
  data.transactions = history.map(function (row) {
    return toTxn({
      id: row.id,
      type: row.type.toLowerCase(),
      studentId: row.studentId,
      bagNumber: row.bagNumber,
      quantity: row.quantity,
      status: row.status,
      service: row.service,
      ironing: row.ironing,
      code: row.code,
      seen: row.seen,
      qrExpiresAt: row.qrExpiresAt,
      giveRequestId: row.giveRequestId,
      sessionExpiresAt: row.sessionExpiresAt,
      createdAt: row.requestAt,
      workerId: row.workerId,
      confirmedQuantity: row.confirmedQuantity,
      receivedAt: row.receivedAt,
      scannedAt: row.scannedAt,
      studentVerifiedAt: row.studentVerifiedAt,
      handedOverAt: row.handedOverAt,
      handoverBy: row.handoverBy
    }, row.timeline);
  });

  const complaints = await call("GET", "/student/complaints");
  data.complaints = complaints.map(toComplaint);

  const notifications = await call("GET", "/student/notifications");
  data.notifications = notifications.map(toNotification);

  return data;
}

/** The reference photos of the student, by the id of the submission they belong to. */
async function loadStudentPhotos() {
  return call("GET", "/student/photos");
}

/** Everything the worker screens show. */
async function loadWorkerData() {
  const data = { students: [], workers: [], admins: [], bags: [], transactions: [], complaints: [], notifications: [], activity: [], counterOpen: true, settings: { urgentEnabled: true } };

  const me = await whoAmI();
  if (me) data.workers.push({ id: me.id, name: me.name });

  const give = await call("GET", "/worker/give-requests");
  const take = await call("GET", "/worker/take-requests");
  data.transactions = give.concat(take).map(function (row) {
    return toTxn({
      id: row.id,
      type: row.type.toLowerCase(),
      studentId: row.studentId,
      bagNumber: row.bagNumber,
      quantity: row.quantity,
      status: row.status,
      service: row.service,
      ironing: row.ironing,
      code: row.code,
      seen: row.seen,
      qrExpiresAt: row.qrExpiresAt,
      giveRequestId: row.giveRequestId,
      sessionExpiresAt: row.sessionExpiresAt,
      createdAt: row.requestAt,
      workerId: row.workerId,
      confirmedQuantity: row.confirmedQuantity,
      receivedAt: row.receivedAt,
      scannedAt: row.scannedAt,
      studentVerifiedAt: row.studentVerifiedAt,
      handedOverAt: row.handedOverAt,
      handoverBy: row.handoverBy
    }, row.timeline);
  });

  const students = await call("GET", "/worker/students");
  data.bags = students.map(toBag);
  data.students = students.map(function (bag) {
    return { id: bag.studentId, name: bag.studentName || bag.studentId, bag: bag.number };
  });

  const activity = await call("GET", "/worker/activity");
  data.activity = activity.map(toActivity);

  const dashboard = await call("GET", "/worker/dashboard");
  data.counterOpen = dashboard.counter.isOpen;

  return data;
}

/** Everything the admin screens show. */
async function loadAdminData() {
  const data = { students: [], workers: [], admins: [], bags: [], transactions: [], complaints: [], notifications: [], activity: [], counterOpen: true, settings: { urgentEnabled: true } };

  const me = await whoAmI();
  if (me) data.admins.push({ id: me.id, name: me.name });

  const bags = await call("GET", "/admin/bags");
  data.bags = bags.rows.map(toBag);

  const students = await call("GET", "/admin/students");
  data.students = students.map(function (s) {
    return { id: s.studentId, name: s.name, bag: s.bagNumber };
  });

  const give = await call("GET", "/admin/history?tab=give");
  const take = await call("GET", "/admin/history?tab=take");
  data.transactions = give.concat(take).map(function (row) {
    return toTxn({
      id: row.id,
      type: row.type.toLowerCase(),
      studentId: row.studentId,
      bagNumber: row.bagNumber,
      quantity: row.quantity,
      status: row.status,
      service: row.service,
      ironing: row.ironing,
      code: row.code,
      seen: row.seen,
      qrExpiresAt: row.qrExpiresAt,
      giveRequestId: row.giveRequestId,
      sessionExpiresAt: row.sessionExpiresAt,
      createdAt: row.requestAt,
      workerId: row.workerId,
      confirmedQuantity: row.confirmedQuantity,
      receivedAt: row.receivedAt,
      scannedAt: row.scannedAt,
      studentVerifiedAt: row.studentVerifiedAt,
      handedOverAt: row.handedOverAt,
      handoverBy: row.handoverBy
    }, row.timeline);
  });

  const complaints = await call("GET", "/admin/complaints");
  data.complaints = complaints.map(toComplaint);

  const audit = await call("GET", "/admin/audit");
  data.activity = audit.map(toActivity);

  const dashboard = await call("GET", "/admin/dashboard");
  data.counterOpen = dashboard.counter.isOpen;

  const settings = await call("GET", "/admin/settings");
  data.settings.urgentEnabled = settings.urgentEnabled;

  return data;
}

// ================= WRITING =================

/** The student gives clothes. Answers with the request and its QR code. */
async function createGiveRequest(studentId, quantity, service, ironing, photoDataUrl) {
  return call("POST", "/student/give-requests", {
    quantity: quantity,
    service: service,
    ironing: ironing,
    photoDataUrl: photoDataUrl || null
  });
}

/** The student asks to collect. */
async function createTakeRequest(studentId, giveTxnId) {
  return call("POST", "/student/take-requests", { giveRequestId: giveTxnId || null });
}

/** The student confirms the bag details. This is NOT the handover. */
async function verifyTakeRequest(studentId, requestId) {
  return call("POST", "/student/take-requests/" + requestId + "/verify");
}

/** The student cancels a request nobody has looked at yet. */
async function cancelRequest(studentId, requestId, type) {
  const path = type === "take" ? "/student/take-requests/" : "/student/give-requests/";
  return call("POST", path + requestId + "/cancel");
}

/** The student has seen the results of their finished requests. */
async function acknowledgeResults(studentId) {
  return call("POST", "/student/acknowledge");
}

/** The worker reads a code and finds the request behind it. */
async function scanCode(text) {
  return call("POST", "/worker/qr/scan", { text: text });
}

/** The worker has the bag and confirms it. */
async function verifyGiveRequest(workerId, requestId, confirmedQuantity) {
  return call("POST", "/worker/give-requests/" + requestId + "/verify", { confirmedQuantity: confirmedQuantity });
}

/** The worker scanned the collection code. */
async function scanTakeRequest(workerId, requestId) {
  return call("POST", "/worker/take-requests/" + requestId + "/scan");
}

/** The worker hands the bag back to the student. */
async function confirmHandover(workerId, requestId) {
  return call("POST", "/worker/take-requests/" + requestId + "/handover");
}

/** The clothes are back at the counter. */
async function returnToCounter(workerId, target) {
  return call("POST", "/worker/give-requests/" + target + "/return-to-counter");
}

/** The worker moves the bag on to the next step of the washing. */
async function setProgress(workerId, bagNumber, progress) {
  return call("POST", "/worker/bags/" + bagNumber + "/progress", { progress: progress });
}

/** The bag is handed over without the QR steps. */
async function manualHandover(workerId, studentId, reason) {
  return call("POST", "/worker/manual-handover", { studentId: studentId, reason: reason });
}

/** A bag status that was wrong is corrected. */
async function correctStatus(workerId, studentId, toStatus, reason) {
  const screenStatus = BAG_STATUS[toStatus] || toStatus;
  return call("POST", "/worker/status-corrections", {
    studentId: studentId,
    toStatus: screenStatus,
    reason: reason
  });
}

/** The administrator opens or closes the counter. */
async function setCounterOpen(adminName, opening) {
  return call("POST", opening ? "/admin/counter/open" : "/admin/counter/close");
}

/** The administrator switches the one-day urgent service on or off. */
async function setUrgentService(adminName, urgentEnabled) {
  return call("PUT", "/admin/settings", { urgentEnabled: urgentEnabled });
}

/** Is the one-day urgent service switched on? */
async function getUrgentService() {
  const answer = await call("GET", "/admin/settings");
  return answer.urgentEnabled;
}

/** The administrator answers a complaint. */
async function updateComplaint(adminName, ref, status, response, assignedTo, resolution) {
  return call("PATCH", "/admin/complaints/" + ref, {
    status: COMPLAINT_STATUS_FROM_SCREEN[status] || status,
    response: response || null,
    assignedTo: assignedTo || null,
    resolution: resolution || null
  });
}

/** The student raises a complaint. */
async function createComplaint(studentId, category, description, transactionId, evidenceDataUrl) {
  return call("POST", "/student/complaints", {
    category: CATEGORY_FROM_SCREEN[category] || "OTHER",
    description: description,
    transactionId: transactionId || null,
    evidenceDataUrl: evidenceDataUrl || null
  });
}

/** The administrator adds a student and gives them a bag. */
async function addStudent(adminName, studentId, name, password, bagNumber) {
  await call("POST", "/admin/students", { studentId: studentId, name: name, password: password });
  if (bagNumber) return call("POST", "/admin/assignments", { studentId: studentId, bagNumber: bagNumber });
  return null;
}

/** The bag numbers that nobody has yet. */
async function getAvailableBags() {
  return call("GET", "/admin/available-bags");
}

/** The student marks their notifications as read. */
async function markNotificationsRead(studentId) {
  const list = await call("GET", "/student/notifications");
  for (const one of list) {
    await call("POST", "/student/notifications/" + one.id + "/read");
  }
}

// ================= EVERYTHING THE SCREENS USE =================

// The screens call api.something(). This is the one list of what they can use.
const api = {
  login: login,
  logout: logout,
  whoAmI: whoAmI,
  setToken: setToken,

  loadStudentData: loadStudentData,
  loadStudentPhotos: loadStudentPhotos,
  loadWorkerData: loadWorkerData,
  loadAdminData: loadAdminData,

  createGiveRequest: createGiveRequest,
  createTakeRequest: createTakeRequest,
  verifyTakeRequest: verifyTakeRequest,
  cancelRequest: cancelRequest,
  acknowledgeResults: acknowledgeResults,
  createComplaint: createComplaint,
  markNotificationsRead: markNotificationsRead,

  scanCode: scanCode,
  verifyGiveRequest: verifyGiveRequest,
  scanTakeRequest: scanTakeRequest,
  confirmHandover: confirmHandover,
  returnToCounter: returnToCounter,
  setProgress: setProgress,
  manualHandover: manualHandover,
  correctStatus: correctStatus,

  setCounterOpen: setCounterOpen,
  setUrgentService: setUrgentService,
  getUrgentService: getUrgentService,
  updateComplaint: updateComplaint,
  addStudent: addStudent,
  getAvailableBags: getAvailableBags
};
