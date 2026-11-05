// staff.js - the worker portal and the admin portal.
// Reference photos are NEVER used here: staff screens do not call getPhoto().
 
let workerTxnId = sessionStorage.getItem("ruWorkerTxn") || null;
let justCompletedId = null;          // lets the success screen show only once, right after finishing
let scanMsg = "";
let reqTab = "give", reqQ = "", reqOutcome = "all";
let actQ = "";
let bagF = { q: "", status: "all", service: "all" };
let bagDetailId = "";
let histTab = "give", histQ = "", histResult = "all", histDetailId = "";
let compF = { q: "", status: "all", category: "all" };
let complaintOpenId = "";
let studentMsg = "";
 
renderers["w-dashboard"] = renderWorkerDashboard;
renderers["w-verify"] = renderWorkerVerify;
renderers["w-mywork"] = renderMyWork;
renderers["w-requests"] = renderWorkerRequests;
renderers["w-activity"] = renderWorkerActivity;
renderers["a-dashboard"] = renderAdminDashboard;
renderers["a-bags"] = renderAdminBags;
renderers["a-students"] = renderAdminStudents;
renderers["a-history"] = renderAdminHistory;
renderers["a-complaints"] = renderAdminComplaints;
document.addEventListener("DOMContentLoaded", bindStaffEvents);
 
// ======================================================
//  SMALL HELPERS
// ======================================================
 
function tableHTML(headers, rows, emptyMsg) {
  if (rows.length === 0) return emptyHTML(emptyMsg);
  return '<div class="table-wrap"><table><thead><tr>' + headers.map(function (h) { return "<th>" + h + "</th>"; }).join("") +
    "</tr></thead><tbody>" + rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>";
}
 
function optionsHTML(list, selected) {
  return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === selected ? " selected" : "") + ">" + o[1] + "</option>"; }).join("");
}
 
function statCard(value, label, attrs) {
  if (attrs) return '<button class="stat" ' + attrs + "><b>" + value + "</b><span>" + label + "</span></button>";
  return '<div class="stat"><b>' + value + "</b><span>" + label + "</span></div>";
}
 
function sameDay(iso) { return new Date(iso).toDateString() === new Date().toDateString(); }
function studentName(id) { const s = studentById(id); return s ? s.name : id; }
 
function givesBy(workerId) {
  return db.transactions.filter(function (t) { return t.type === "give" && t.status === "completed" && t.workerId === workerId; })
    .sort(function (a, b) { return b.completedAt.localeCompare(a.completedAt); });
}
function handoversBy(workerId) {
  return db.transactions.filter(function (t) { return t.type === "take" && t.status === "completed" && t.handoverBy === workerId; })
    .sort(function (a, b) { return b.completedAt.localeCompare(a.completedAt); });
}
 
function outcomeKey(t) { return isActive(t) ? "waiting" : t.status; }
const OUTCOME_OPTIONS = [["all", "All outcomes"], ["waiting", "In progress"], ["completed", "Completed"], ["expired", "Expired"], ["cancelled", "Cancelled"]];
 
// ======================================================
//  EVENT BINDING
// ======================================================
 
function bindStaffEvents() {
  // ----- worker -----
  $("page-w-dashboard").addEventListener("click", onWorkerDashClick);
  $("page-w-dashboard").addEventListener("keydown", function (e) { if (e.target.id === "scanCode" && e.key === "Enter") openCode(); });
  $("page-w-verify").addEventListener("click", onVerifyClick);
 
  $("page-w-requests").addEventListener("click", function (e) {
    const tab = e.target.closest("[data-tab]");
    if (tab) { reqTab = tab.getAttribute("data-tab"); renderWorkerRequests(); }
  });
  $("page-w-requests").addEventListener("input", function (e) { if (e.target.id === "reqQ") { reqQ = e.target.value; renderReqList(); } });
  $("page-w-requests").addEventListener("change", function (e) { if (e.target.id === "reqOutcome") { reqOutcome = e.target.value; renderReqList(); } });
  $("page-w-activity").addEventListener("input", function (e) { if (e.target.id === "actQ") { actQ = e.target.value; renderActList(); } });
 
  // ----- admin -----
  $("page-a-dashboard").addEventListener("click", onAdminDashClick);
 
  $("page-a-bags").addEventListener("input", function (e) { if (e.target.id === "bagQ") { bagF.q = e.target.value; renderBagList(); } });
  $("page-a-bags").addEventListener("change", function (e) {
    if (e.target.id === "bagStatus") { bagF.status = e.target.value; renderBagList(); }
    if (e.target.id === "bagService") { bagF.service = e.target.value; renderBagList(); }
  });
  $("page-a-bags").addEventListener("click", function (e) {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.getAttribute("data-act");
    if (act === "bag-detail") { bagDetailId = btn.getAttribute("data-bag"); renderBagDetail(); window.scrollTo(0, 0); }
    if (act === "bag-close") { bagDetailId = ""; renderBagDetail(); }
    if (act === "bag-clear") { bagF = { q: "", status: "all", service: "all" }; renderAdminBags(); }
  });
 
  $("page-a-students").addEventListener("click", function (e) { if (e.target.closest("[data-act='add-student']")) addStudent(); });
 
  $("page-a-history").addEventListener("click", function (e) {
    const tab = e.target.closest("[data-tab]");
    if (tab) { histTab = tab.getAttribute("data-tab"); histDetailId = ""; renderAdminHistory(); return; }
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.getAttribute("data-act");
    if (act === "hist-detail") { histDetailId = btn.getAttribute("data-id"); renderHistDetail(); window.scrollTo(0, 0); }
    if (act === "hist-close") { histDetailId = ""; renderHistDetail(); }
  });
  $("page-a-history").addEventListener("input", function (e) { if (e.target.id === "histQ") { histQ = e.target.value; renderHistList(); } });
  $("page-a-history").addEventListener("change", function (e) { if (e.target.id === "histResult") { histResult = e.target.value; renderHistList(); } });
 
  $("page-a-complaints").addEventListener("input", function (e) { if (e.target.id === "compQ") { compF.q = e.target.value; renderCompList(); } });
  $("page-a-complaints").addEventListener("change", function (e) {
    if (e.target.id === "compStatus") { compF.status = e.target.value; renderCompList(); }
    if (e.target.id === "compCat") { compF.category = e.target.value; renderCompList(); }
  });
  $("page-a-complaints").addEventListener("click", function (e) {
    const btn = e.target.closest("[data-act='complaint-save']");
    if (btn) saveComplaint(btn.getAttribute("data-id"));
  });
  $("page-a-complaints").addEventListener("toggle", function (e) {
    if (e.target.tagName === "DETAILS" && e.target.open) complaintOpenId = e.target.getAttribute("data-id");
  }, true);
}
 
// ======================================================
//  WORKER: DASHBOARD
// ======================================================
 
function isLastStage(bag) {
  const stages = processStages(bag);
  return stages.indexOf(bag.progress) >= stages.length - 1;
}
 
function advanceLabel(bag) {
  const stages = processStages(bag);
  const i = Math.max(0, stages.indexOf(bag.progress));
  return i >= stages.length - 1 ? "Return to Counter" : "Mark: " + stages[i + 1];
}
 
function processRow(bag) {
  const late = isOverdue(bag);
  return '<div class="row-card"><div class="row-top"><span><b>' + bag.number + "</b> - " + esc(bag.studentId) + " - " + bag.quantity + " clothes</span><span>" +
    servicePill(bag) + ' <span class="pill pill-amber">' + esc(bag.progress || "Bag received") + "</span></span></div>" +
    '<div class="muted small">' + serviceText(bag) + " - received " + fmt(bag.receivedAt) + " - due <span class=\"" + (late ? "late" : "") + "\">" + dueText(bag.dueAt) + "</span></div>" +
    '<div class="actions"><button class="btn btn-small" data-act="advance" data-bag="' + bag.number + '">' + advanceLabel(bag) + "</button></div></div>";
}
 
function renderWorkerDashboard() {
  if (currentRole() !== "worker") return;
  const w = currentUser();
  if (!w) return;
 
  const recv = givesBy(w.id), hand = handoversBy(w.id);
  const pendingGive = db.transactions.filter(function (t) { return t.type === "give" && isActive(t); }).length;
  const pendingTake = db.transactions.filter(function (t) { return t.type === "take" && isActive(t); }).length;
  const inProcess = db.bags.filter(function (b) { return b.status === BAG_IN_PROCESS; })
    .sort(function (a, b) {
      if ((a.service === "urgent") !== (b.service === "urgent")) return a.service === "urgent" ? -1 : 1;
      return String(a.dueAt).localeCompare(String(b.dueAt));
    });
  const urgent = inProcess.filter(function (b) { return b.service === "urgent"; });
  const regular = inProcess.filter(function (b) { return b.service !== "urgent"; });
 
  let html = '<h1 class="page-title">Welcome, ' + esc(w.name) + '</h1><p class="page-sub">Scan a student\'s QR code, then move their bag through the laundry steps.</p>';
 
  html += '<div class="stat-grid">' +
    statCard(recv.length, "Bags I received", 'data-go="w-mywork"') + statCard(hand.length, "Bags I handed over", 'data-go="w-mywork"') +
    statCard(pendingGive, "Pending Give requests", 'data-go="w-requests" data-param="give"') + statCard(pendingTake, "Pending Take requests", 'data-go="w-requests" data-param="take"') +
    statCard(urgent.length, "Urgent bags in process") + "</div>";
 
  html += '<div class="card qr-card"><h3>Scan QR Code</h3><p class="muted">Place the student\'s QR code inside the box.</p>' +
    '<div class="scan-frame">' + icon("scan", 72) + "</div>" +
    '<p class="muted small">This demo has no camera. Type the code printed under the student\'s QR code.</p>' +
    '<div class="filters" style="justify-content:center;margin:0"><input id="scanCode" class="input" style="max-width:280px;text-align:center" placeholder="e.g. G-AB12CD" autocomplete="off" autocapitalize="characters">' +
    '<button class="btn" data-act="open-code">Open request</button></div><p class="error">' + esc(scanMsg) + "</p></div>";
 
  html += '<h2 class="section-title">Urgent bags (do these first)</h2>';
  html += urgent.length ? urgent.map(processRow).join("") : emptyHTML("No urgent bags right now.");
  html += '<h2 class="section-title">Regular bags in process</h2>';
  html += regular.length ? regular.map(processRow).join("") : emptyHTML("No regular bags in process.");
 
  $("page-w-dashboard").innerHTML = html;
}
 
function onWorkerDashClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.getAttribute("data-act");
  if (act === "open-code") openCode();
  if (act === "advance") {
    const num = btn.getAttribute("data-bag");
    const bag = db.bags.find(function (b) { return b.number === num; });
    if (!bag) return;
    if (isLastStage(bag)) {
      askConfirm({ title: "Return bag to counter?", text: "Bag " + num + " will be marked 'Bag at counter' and the student will be told their clothes are ready.", yes: "Mark Returned" },
        function () { advanceProgress(num); });
    } else {
      advanceProgress(num);
    }
  }
}
 
// moves a bag to its next step (Washing -> Ironing -> returned to the counter)
function advanceProgress(bagNumber) {
  db = loadData();
  const w = currentUser();
  const bag = db.bags.find(function (b) { return b.number === bagNumber; });
  if (!bag || bag.status !== BAG_IN_PROCESS) { showToast("This bag is not in process.", true); renderCurrent(); return; }
  const stages = processStages(bag);
  const i = Math.max(0, stages.indexOf(bag.progress));
  const now = nowIso();
 
  if (i < stages.length - 1) {
    bag.progress = stages[i + 1];
    notifyStudent(bag.studentId, "Your laundry update: " + bag.progress + ".");
    logActivity("Progress: " + bag.progress, bag.studentId, bag.number, w.id);
    showToast(bag.number + ": " + bag.progress);
  } else {
    bag.status = BAG_AT_COUNTER;
    bag.progress = null;
    bag.returnedAt = now;
    bag.returnedBy = w.id;
    notifyStudent(bag.studentId, "Your clothes are ready for collection.");
    logActivity("Bag returned to counter", bag.studentId, bag.number, w.id);
    showToast(bag.number + " is now at the counter.");
  }
  bag.updatedBy = w.id;
  bag.updatedAt = now;
  saveData(db);
  renderCurrent();
}
 
// "scan" a QR code by typing its code
function openCode() {
  db = loadData();
  expireTransactions();
  const w = currentUser();
  const code = normalizeCode($("scanCode").value);
  if (!code) { scanMsg = "Enter the code shown under the student's QR code."; renderWorkerDashboard(); return; }
  scanMsg = "";
 
  const t = db.transactions.find(function (x) { return x.code === code; });
  if (!t) {
    workerTxnId = "INVALID";
  } else {
    workerTxnId = t.id;
    if (t.type === "take" && t.status === "qr_generated") {   // scanning a collection QR starts the verification session
      const now = new Date();
      t.status = "scanned";
      t.scannedAt = now.toISOString();
      t.verifyExpiresAt = new Date(now.getTime() + VERIFY_MINUTES * 60000).toISOString();
      t.workerId = w.id;
      addEvent(t, "QR scanned by worker", w.id);
      logActivity("Collection QR scanned", t.studentId, t.bag, w.id);
      saveData(db);
    }
  }
  sessionStorage.setItem("ruWorkerTxn", workerTxnId);
  showPage("w-verify");
}
 
// ======================================================
//  WORKER: VERIFY SCREENS (no reference photo anywhere)
// ======================================================
 
function invalidView() {
  return '<div class="card qr-card"><div class="success-mark warn-mark">!</div><h1 class="page-title">QR code cannot be used</h1>' +
    '<p class="muted">This QR code cannot be used. Ask the student to generate a new QR code or check the request details.</p>' +
    '<div class="actions" style="justify-content:center"><button class="btn" data-go="w-dashboard">Back to Scanner</button></div></div>';
}
 
function renderWorkerVerify() {
  if (currentRole() !== "worker") return;
  const t = workerTxnId && workerTxnId !== "INVALID" ? db.transactions.find(function (x) { return x.id === workerTxnId; }) : null;
  const w = currentUser();
  let html = '<button class="back" data-go="w-dashboard">&larr; Back to Scanner</button>';
 
  if (!t) { $("page-w-verify").innerHTML = html + invalidView(); return; }
 
  const learner = [["Student ID", esc(t.studentId)], ["Student name", esc(studentName(t.studentId))], ["Bag number", t.bag]];
  const justDone = t.id === justCompletedId;
  const bag = db.bags.find(function (b) { return b.number === t.bag; });
 
  if (t.type === "give") {
    if (t.status === "qr_generated") {
      html += '<h1 class="page-title">Verify Bag Submission</h1><div class="card">' +
        infoGrid(learner.concat([["Service", serviceText(t) + " " + servicePill(t)], ["Declared clothes", t.quantity], ["Request time", fmt(t.createdAt)], ["QR valid for", countdownHTML(t.expiresAt)]])) +
        '<p class="muted" style="margin-top:14px">Check the bag and the quantity before confirming.</p><div class="actions"><button class="btn" data-act="verify-bag" data-id="' + t.id + '">Verify Bag</button></div></div>';
    } else if (t.status === "completed" && justDone) {
      html += '<div class="card qr-card"><div class="success-mark">&#10003;</div><h1 class="page-title">Bag Received Successfully</h1>' +
        infoGrid(learner.concat([["Confirmed clothes", t.confirmedQuantity || t.quantity], ["Service", serviceText(t)], ["Receipt time", fmt(t.completedAt)],
          ["Expected ready by", dueText(bag ? bag.dueAt : null)], ["Bag status now", bagPill(BAG_IN_PROCESS)]])) +
        '<div class="actions" style="justify-content:center"><button class="btn" data-go="w-dashboard">Back to Scanner</button></div></div>';
    } else {
      html += invalidView();
    }
  } else {
    if (t.status === "scanned") {
      html += '<h1 class="page-title">Verify Collection Request</h1><div class="card qr-card">' +
        infoGrid(learner.concat([["Service", serviceText(t)], ["Recorded clothes", t.quantity], ["Request time", fmt(t.createdAt)]])) +
        '<p class="step-pill">Waiting for Student Verification</p>' +
        '<p class="muted">The QR code has been scanned. Ask the student to review their details and confirm the collection.</p>' +
        '<p class="muted small">Session ends in ' + countdownHTML(t.verifyExpiresAt) + "</p></div>";
    } else if (t.status === "student_verified") {
      html += '<h1 class="page-title">Student Verified - Ready for Handover</h1><div class="card">' +
        infoGrid(learner.concat([["Recorded clothes", t.quantity], ["Student verified at", fmt(t.studentVerifiedAt)]])) +
        '<div class="actions"><button class="btn" data-act="handover" data-id="' + t.id + '">Confirm Bag Handover</button></div></div>';
    } else if (t.status === "completed" && justDone) {
      html += '<div class="card qr-card"><div class="success-mark">&#10003;</div><h1 class="page-title">Handover Completed Successfully</h1>' +
        infoGrid(learner.concat([["Recorded clothes", t.quantity], ["Worker ID", esc(t.handoverBy)], ["Handover time", fmt(t.completedAt)], ["Bag status now", bagPill(BAG_NOT_GIVEN)]])) +
        '<div class="actions" style="justify-content:center"><button class="btn" data-go="w-dashboard">Back to Scanner</button></div></div>';
    } else if (t.status === "expired" && t.verifyExpiresAt) {
      html += '<div class="card qr-card"><div class="success-mark warn-mark">!</div><h1 class="page-title">Collection Session Expired</h1>' +
        '<p class="muted">The student did not verify within the allowed time. A new collection QR is required.</p>' +
        '<div class="actions" style="justify-content:center"><button class="btn" data-go="w-dashboard">Back to Scanner</button></div></div>';
    } else {
      html += invalidView();
    }
  }
  $("page-w-verify").innerHTML = html;
  updateCountdowns();
}
 
function onVerifyClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.getAttribute("data-act");
  const id = btn.getAttribute("data-id");
  if (act === "verify-bag") {
    askConfirm({ title: "Confirm Receipt", text: "Confirm that you have physically received this bag?", yes: "Confirm Receipt" }, function () { completeGive(id); });
  }
  if (act === "handover") {
    askConfirm({ title: "Confirm Handover", text: "Have you physically handed this bag to the student?", yes: "Confirm Handover" }, function () { completeTake(id); });
  }
}
 
function completeGive(id) {
  db = loadData();
  expireTransactions();
  const w = currentUser();
  const t = db.transactions.find(function (x) { return x.id === id; });
  if (!t || t.type !== "give" || t.status !== "qr_generated") { showToast("This QR code can no longer be used.", true); renderCurrent(); return; }
  const bag = db.bags.find(function (b) { return b.number === t.bag; });
  if (!bag || bag.status !== BAG_NOT_GIVEN) { showToast("This bag is not marked as 'Bag not given'.", true); renderCurrent(); return; }
 
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  t.status = "completed"; t.completedAt = now; t.workerId = w.id; t.confirmedQuantity = t.quantity; t.seen = false;
  addEvent(t, "Worker verified the bag", w.id);
  addEvent(t, "Bag received by worker", w.id);
 
  bag.status = BAG_IN_PROCESS;
  bag.quantity = t.quantity; bag.service = t.service; bag.ironing = t.ironing;
  bag.progress = processStages(t)[0];
  bag.receivedAt = now; bag.returnedAt = null; bag.collectedAt = null;
  bag.dueAt = new Date(nowMs + daysFor(t.service) * 86400000).toISOString();   // 3 days regular, 1 day urgent / ironing
  bag.receivedBy = w.id; bag.returnedBy = null; bag.updatedBy = w.id; bag.updatedAt = now;
 
  notifyStudent(t.studentId, "Your bag has been received by the laundry worker. Expected ready by " + fmt(bag.dueAt) + ".");
  logActivity("Bag received by worker", t.studentId, t.bag, w.id);
  justCompletedId = t.id;
  saveData(db);
  renderCurrent();
  showToast("Bag " + t.bag + " received.");
}
 
function completeTake(id) {
  db = loadData();
  expireTransactions();
  const w = currentUser();
  const t = db.transactions.find(function (x) { return x.id === id; });
  if (!t || t.type !== "take" || t.status !== "student_verified") { showToast("This collection can no longer be completed.", true); renderCurrent(); return; }
  const bag = db.bags.find(function (b) { return b.number === t.bag; });
 
  const now = nowIso();
  t.status = "completed"; t.completedAt = now; t.handoverBy = w.id; t.workerId = t.workerId || w.id; t.seen = false;
  addEvent(t, "Physical handover confirmed", w.id);
 
  if (bag) {
    bag.status = BAG_NOT_GIVEN; bag.collectedAt = now; bag.quantity = null; bag.service = null; bag.ironing = false;
    bag.progress = null; bag.dueAt = null; bag.updatedBy = w.id; bag.updatedAt = now;
  }
  notifyStudent(t.studentId, "Your clothes have been collected successfully.");
  logActivity("Physical handover confirmed", t.studentId, t.bag, w.id);
  justCompletedId = t.id;
  saveData(db);
  renderCurrent();
  showToast("Handover completed.");
}
 
// ======================================================
//  WORKER: MY WORK (what I received and handed over)
// ======================================================
 
function renderMyWork() {
  if (currentRole() !== "worker") return;
  const w = currentUser();
  if (!w) return;
  const recv = givesBy(w.id), hand = handoversBy(w.id);
 
  let html = '<h1 class="page-title">My Work</h1><p class="page-sub">Every bag you received and every bag you handed back, with the student.</p>';
  html += '<div class="stat-grid">' + statCard(recv.length, "Bags I received") + statCard(recv.filter(function (t) { return sameDay(t.completedAt); }).length, "Received today") +
    statCard(hand.length, "Bags I handed over") + statCard(hand.filter(function (t) { return sameDay(t.completedAt); }).length, "Handed over today") + "</div>";
 
  html += '<h2 class="section-title">Bags I received</h2>';
  html += tableHTML(["Time", "Bag", "Student ID", "Student", "Clothes", "Service", "Where is it now?"], recv.map(function (t) {
    const collected = db.transactions.some(function (x) { return x.type === "take" && x.status === "completed" && x.studentId === t.studentId && x.completedAt > t.completedAt; });
    const bag = db.bags.find(function (b) { return b.number === t.bag; });
    const now = collected ? '<span class="pill pill-green">Collected by student</span>' : (bag ? bagPill(bag.status) : "-");
    return [fmt(t.completedAt), t.bag, esc(t.studentId), esc(studentName(t.studentId)), t.quantity, serviceText(t) + " " + servicePill(t), now];
  }), "You have not received any bags yet.");
 
  html += '<h2 class="section-title">Bags I handed over</h2>';
  html += tableHTML(["Time", "Bag", "Handed to (Student ID)", "Student", "Clothes", "Service"], hand.map(function (t) {
    return [fmt(t.completedAt), t.bag, esc(t.studentId), esc(studentName(t.studentId)), t.quantity, serviceText(t)];
  }), "You have not handed over any bags yet.");
 
  $("page-w-mywork").innerHTML = html;
}
 
// ======================================================
//  WORKER: REQUESTS AND ACTIVITY
// ======================================================
 
function renderWorkerRequests(param) {
  if (currentRole() !== "worker") return;
  if (param === "give" || param === "take") reqTab = param;
  let html = '<h1 class="page-title">Requests</h1><p class="page-sub">Urgent requests are always listed first.</p>';
  html += '<div class="tabs"><button class="tab' + (reqTab === "give" ? " active" : "") + '" data-tab="give">Give Clothes Requests</button>' +
    '<button class="tab' + (reqTab === "take" ? " active" : "") + '" data-tab="take">Take Clothes Requests</button></div>';
  html += '<div class="filters"><input id="reqQ" class="input" placeholder="Search student ID or bag number" value="' + esc(reqQ) + '">' +
    '<select id="reqOutcome">' + optionsHTML(OUTCOME_OPTIONS, reqOutcome) + "</select></div><div id=\"reqList\"></div>";
  $("page-w-requests").innerHTML = html;
  renderReqList();
}
 
function renderReqList() {
  const q = reqQ.trim().toLowerCase();
  let list = db.transactions.filter(function (t) { return t.type === reqTab; });
  if (q) list = list.filter(function (t) { return t.studentId.toLowerCase().indexOf(q) !== -1 || t.bag.toLowerCase().indexOf(q) !== -1; });
  if (reqOutcome !== "all") list = list.filter(function (t) { return outcomeKey(t) === reqOutcome; });
  list.sort(function (a, b) {
    const wa = isActive(a) ? 0 : 1, wb = isActive(b) ? 0 : 1;
    if (wa !== wb) return wa - wb;
    const ua = a.service === "urgent" ? 0 : 1, ub = b.service === "urgent" ? 0 : 1;
    if (ua !== ub) return ua - ub;
    return b.createdAt.localeCompare(a.createdAt);
  });
 
  $("reqList").innerHTML = list.length === 0 ? emptyHTML("No requests match.") : list.map(function (t) {
    return '<div class="row-card"><div class="row-top"><span><b>' + esc(t.studentId) + "</b> - " + t.bag + " - " + t.quantity + " clothes</span><span>" +
      servicePill(t) + " " + outcomePill(t) + '</span></div><div class="muted small">' + serviceText(t) + " - requested " + fmt(t.createdAt) + "</div></div>";
  }).join("");
}
 
function renderWorkerActivity() {
  if (currentRole() !== "worker") return;
  $("page-w-activity").innerHTML = '<h1 class="page-title">Activity History</h1><p class="page-sub">What you have recorded in the system.</p>' +
    '<div class="filters"><input id="actQ" class="input" placeholder="Search student ID, bag or action" value="' + esc(actQ) + '"></div><div id="actList"></div>';
  renderActList();
}
 
function renderActList() {
  const w = currentUser();
  const q = actQ.trim().toLowerCase();
  let list = db.activity.filter(function (a) { return a.by === w.id; });
  if (q) list = list.filter(function (a) { return (a.studentId + " " + a.bag + " " + a.text).toLowerCase().indexOf(q) !== -1; });
  $("actList").innerHTML = tableHTML(["Time", "Student ID", "Bag", "Action"], list.map(function (a) {
    return [fmt(a.time), esc(a.studentId || "-"), a.bag || "-", esc(a.text)];
  }), "No activity yet.");
}
 
// ======================================================
//  ADMIN: DASHBOARD
// ======================================================
 
function avgResolutionText(list) {
  const times = list.filter(function (c) { return c.resolvedAt; }).map(function (c) { return Date.parse(c.resolvedAt) - Date.parse(c.createdAt); });
  if (times.length === 0) return "-";
  const avg = times.reduce(function (a, b) { return a + b; }, 0) / times.length;
  const hours = avg / 3600000;
  if (hours < 1) return Math.max(1, Math.round(avg / 60000)) + " min";
  if (hours < 48) return Math.round(hours) + " hours";
  return (hours / 24).toFixed(1) + " days";
}
 
// how many complaints came in and how many this admin resolved
function complaintStatsHTML(admin) {
  const all = db.complaints;
  const resolved = all.filter(function (c) { return c.status === "Resolved"; });
  const open = all.filter(function (c) { return c.status === "Open"; }).length;
  const review = all.filter(function (c) { return c.status === "Under review"; }).length;
  const mine = resolved.filter(function (c) { return c.resolvedBy === admin.id; }).length;
  const rate = all.length ? Math.round(resolved.length / all.length * 100) : 0;
  return '<div class="stat-grid">' + statCard(all.length, "Complaints received") + statCard(open, "Open - waiting for a reply") + statCard(review, "Under review") +
    statCard(resolved.length, "Resolved (all admins)") + statCard(mine, "Resolved by you") + statCard(rate + "%", "Resolution rate") +
    statCard(avgResolutionText(resolved), "Average time to resolve") + "</div>";
}
 
function renderAdminDashboard() {
  if (currentRole() !== "admin") return;
  const a = currentUser();
  if (!a) return;
  const owned = db.bags.filter(function (b) { return b.studentId; });
  function countStatus(st) { return owned.filter(function (b) { return b.status === st; }).length; }
 
  const overdue = owned.filter(isOverdue).length;
  const urgentIn = owned.filter(function (b) { return b.status === BAG_IN_PROCESS && b.service === "urgent"; }).length;
  const openComplaints = db.complaints.filter(function (c) { return c.status === "Open"; }).length;
  const pendingGive = db.transactions.filter(function (t) { return t.type === "give" && isActive(t); }).length;
  const pendingTake = db.transactions.filter(function (t) { return t.type === "take" && isActive(t); }).length;
  const dayAgo = Date.now() - 86400000;
  const recentHandovers = db.transactions.filter(function (t) { return t.type === "take" && t.status === "completed" && Date.parse(t.completedAt) > dayAgo; }).length;
 
  let html = '<h1 class="page-title">RU Laundry Administration</h1><p class="page-sub">' + esc(a.name) + " - " + new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }) + "</p>";
 
  // counter controls
  html += '<div class="card"><div class="row-top"><h3>Counter is ' + (db.counterOpen ? "OPEN" : "CLOSED") + "</h3>" + counterPill() + "</div>" +
    '<p class="muted">' + (db.counterOpen ? "Students can start Give Clothes and Take Clothes requests." : "Students cannot start new requests. Existing records stay visible.") + "</p>" +
    '<div class="actions"><button class="btn" data-act="toggle-counter">' + (db.counterOpen ? "CLOSE COUNTER" : "OPEN COUNTER") + "</button></div>" +
    '<div class="toggle-row" style="margin-top:18px"><span><b>One-Day Urgent service:</b> ' + (urgentOn() ? "ON" : "OFF (students cannot book it)") + "</span>" +
    '<button class="btn btn-outline btn-small" data-act="toggle-urgent">' + (urgentOn() ? "Turn off" : "Turn on") + "</button></div></div>";
 
  // needs attention
  html += '<h2 class="section-title">Needs your attention</h2><div class="stat-grid">' +
    statCard(openComplaints, "Complaints waiting for a reply", 'data-act="goto-complaints" data-status="Open"') +
    statCard(overdue, "Bags running late", 'data-act="goto-bags" data-status="overdue" data-service="all"') +
    statCard(urgentIn, "Urgent bags in process", 'data-act="goto-bags" data-status="' + BAG_IN_PROCESS + '" data-service="urgent"') +
    statCard(countStatus(BAG_AT_COUNTER), "Bags waiting for pickup", 'data-act="goto-bags" data-status="' + BAG_AT_COUNTER + '" data-service="all"') + "</div>";
 
  // bag status overview
  html += '<h2 class="section-title">Bag status</h2><div class="stat-grid">' +
    statCard(countStatus(BAG_NOT_GIVEN), BAG_NOT_GIVEN, 'data-act="goto-bags" data-status="' + BAG_NOT_GIVEN + '" data-service="all"') +
    statCard(countStatus(BAG_IN_PROCESS), BAG_IN_PROCESS, 'data-act="goto-bags" data-status="' + BAG_IN_PROCESS + '" data-service="all"') +
    statCard(countStatus(BAG_AT_COUNTER), BAG_AT_COUNTER, 'data-act="goto-bags" data-status="' + BAG_AT_COUNTER + '" data-service="all"') + "</div>";
 
  // complaints
  html += '<h2 class="section-title">Complaints</h2>' + complaintStatsHTML(a);
 
  // requests + services
  const gives = db.transactions.filter(function (t) { return t.type === "give" && t.status === "completed"; });
  html += '<h2 class="section-title">Requests and services</h2><div class="stat-grid">' +
    statCard(pendingGive, "Pending Give requests") + statCard(pendingTake, "Pending Take requests") + statCard(recentHandovers, "Handovers in last 24 hours") +
    statCard(gives.filter(function (t) { return t.service === "regular"; }).length, "Regular laundry orders") +
    statCard(gives.filter(function (t) { return t.service === "urgent"; }).length, "One-day urgent orders") +
    statCard(gives.filter(function (t) { return t.service === "ironing"; }).length, "Ironing-only orders") +
    statCard(gives.filter(function (t) { return t.ironing && t.service !== "ironing"; }).length, "Laundry + ironing orders") + "</div>";
 
  // team workload
  html += '<h2 class="section-title">Laundry team</h2>' + tableHTML(["Worker", "Bags received", "Bags handed over", "Bags in process now"], db.workers.map(function (w) {
    const inProc = owned.filter(function (b) { return b.status === BAG_IN_PROCESS && b.receivedBy === w.id; }).length;
    return [esc(w.name) + " (" + esc(w.id) + ")", givesBy(w.id).length, handoversBy(w.id).length, inProc];
  }), "No workers.");
 
  // recent activity
  html += '<h2 class="section-title">Recent activity</h2><div class="card">';
  const recent = db.activity.slice(0, 8);
  html += recent.length === 0 ? '<p class="muted">Nothing yet.</p>' : eventsHTML(recent.map(function (x) {
    return { time: x.time, text: x.text + (x.studentId ? " - " + x.studentId : "") + (x.bag ? " (" + x.bag + ")" : ""), by: x.by ? personName(x.by) : "" };
  }));
  html += "</div>";
 
  $("page-a-dashboard").innerHTML = html;
}
 
function onAdminDashClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.getAttribute("data-act");
  if (act === "toggle-counter") toggleCounter();
  if (act === "toggle-urgent") toggleUrgent();
  if (act === "goto-bags") {
    bagF = { q: "", status: btn.getAttribute("data-status"), service: btn.getAttribute("data-service") || "all" };
    showPage("a-bags");
  }
  if (act === "goto-complaints") {
    compF = { q: "", status: btn.getAttribute("data-status") || "all", category: "all" };
    showPage("a-complaints");
  }
}
 
function toggleCounter() {
  const opening = !db.counterOpen;
  const opts = opening
    ? { title: "Open the counter?", text: "Open the laundry counter now? Students will be able to start permitted laundry requests and collections.", yes: "Confirm Open" }
    : { title: "Close the counter?", text: "Close the laundry counter now? Students will no longer be able to start new Give Clothes or Take Clothes requests.", yes: "Confirm Close" };
  askConfirm(opts, function () {
    db = loadData();
    db.counterOpen = opening;
    logActivity(opening ? "Counter opened" : "Counter closed", "", "", currentUser().id);
    db.students.forEach(function (s) { notifyStudent(s.id, opening ? "The laundry counter is now open." : "The laundry counter is now closed."); });
    saveData(db);
    renderCurrent();
    showToast("Laundry counter is now " + (opening ? "OPEN." : "CLOSED."));
  });
}
 
function toggleUrgent() {
  const turnOn = !urgentOn();
  askConfirm({ title: turnOn ? "Turn on urgent service?" : "Turn off urgent service?",
    text: turnOn ? "Students will be able to book One-Day Urgent Laundry again." : "Students will not be able to book One-Day Urgent Laundry. Bags already received are not affected.",
    yes: turnOn ? "Turn on" : "Turn off" }, function () {
    db = loadData();
    db.settings = db.settings || {};
    db.settings.urgentEnabled = turnOn;
    logActivity("One-Day Urgent service turned " + (turnOn ? "on" : "off"), "", "", currentUser().id);
    saveData(db);
    renderCurrent();
    showToast("One-Day Urgent service is " + (turnOn ? "ON." : "OFF."));
  });
}
 
// ======================================================
//  ADMIN: BAG REGISTER
// ======================================================
 
function renderAdminBags() {
  if (currentRole() !== "admin") return;
  const statusOpts = [["all", "All statuses"], [BAG_NOT_GIVEN, BAG_NOT_GIVEN], [BAG_IN_PROCESS, BAG_IN_PROCESS], [BAG_AT_COUNTER, BAG_AT_COUNTER], ["overdue", "Running late"]];
  const serviceOpts = [["all", "All services"], ["regular", "Regular Laundry"], ["urgent", "One-Day Urgent"], ["ironing", "Ironing Only"]];
  $("page-a-bags").innerHTML = '<h1 class="page-title">Bag Register</h1><p class="page-sub">Every assigned bag and where it is right now.</p>' +
    '<div class="filters"><input id="bagQ" class="input" placeholder="Search student ID, name or bag number" value="' + esc(bagF.q) + '">' +
    '<select id="bagStatus">' + optionsHTML(statusOpts, bagF.status) + '</select><select id="bagService">' + optionsHTML(serviceOpts, bagF.service) + "</select>" +
    '<button class="btn btn-outline btn-small" data-act="bag-clear">Clear Filters</button></div><div id="bagDetail"></div><div id="bagList"></div>';
  renderBagDetail();
  renderBagList();
}
 
function renderBagList() {
  const q = bagF.q.trim().toLowerCase();
  const list = db.bags.filter(function (b) {
    if (!b.studentId) return false;
    if (q && (b.studentId + " " + studentName(b.studentId) + " " + b.number).toLowerCase().indexOf(q) === -1) return false;
    if (bagF.status === "overdue" && !isOverdue(b)) return false;
    if (bagF.status !== "all" && bagF.status !== "overdue" && b.status !== bagF.status) return false;
    if (bagF.service !== "all" && b.service !== bagF.service) return false;
    return true;
  }).sort(function (x, y) { return (y.updatedAt || "").localeCompare(x.updatedAt || ""); });
 
  $("bagList").innerHTML = tableHTML(["Student ID", "Student", "Bag", "Clothes", "Status", "Service", "Progress / due", "Received", "Returned", "Collected", "Updated by", "Updated", ""],
    list.map(function (b) {
      const late = isOverdue(b);
      const progress = b.status === BAG_IN_PROCESS ? esc(b.progress || "") + "<br><span class=\"" + (late ? "late" : "muted small") + "\">due " + fmt(b.dueAt) + (late ? " (late)" : "") + "</span>" : "-";
      return [esc(b.studentId), esc(studentName(b.studentId)), b.number, b.quantity == null ? "-" : b.quantity, bagPill(b.status),
        b.service ? serviceText(b) + " " + servicePill(b) : "-", progress, fmt(b.receivedAt), fmt(b.returnedAt), fmt(b.collectedAt),
        b.updatedBy ? esc(personName(b.updatedBy)) : "-", fmt(b.updatedAt),
        '<button class="btn btn-outline btn-small" data-act="bag-detail" data-bag="' + b.number + '">Details</button>'];
    }), "No bags match these filters.");
}
 
function renderBagDetail() {
  const box = $("bagDetail");
  if (!box) return;
  const b = bagDetailId ? db.bags.find(function (x) { return x.number === bagDetailId; }) : null;
  if (!b) { box.innerHTML = ""; return; }
  const history = db.activity.filter(function (a) { return a.bag === b.number; }).slice(0, 12);
  box.innerHTML = '<div class="card"><div class="row-top"><h3>Bag ' + b.number + "</h3>" + bagPill(b.status) + "</div>" +
    infoGrid([["Student", esc(studentName(b.studentId)) + " (" + esc(b.studentId) + ")"], ["Clothes", b.quantity == null ? "-" : b.quantity],
      ["Service", b.service ? serviceText(b) : "-"], ["Received", fmt(b.receivedAt) + (b.receivedBy ? " by " + esc(personName(b.receivedBy)) : "")],
      ["Expected ready by", b.dueAt ? dueText(b.dueAt) : "-"], ["Returned to counter", fmt(b.returnedAt) + (b.returnedBy ? " by " + esc(personName(b.returnedBy)) : "")],
      ["Collected", fmt(b.collectedAt)], ["Last updated by", b.updatedBy ? esc(personName(b.updatedBy)) : "-"]]) +
    '<h3 style="margin-top:18px">Status history</h3>' +
    (history.length ? eventsHTML(history.map(function (a) { return { time: a.time, text: a.text, by: a.by ? personName(a.by) : "" }; })) : '<p class="muted">No history yet.</p>') +
    '<div class="actions"><button class="btn btn-outline btn-small" data-act="bag-close">Close details</button></div></div>';
}
 
// ======================================================
//  ADMIN: STUDENTS AND BAG ASSIGNMENT
// ======================================================
 
function renderAdminStudents() {
  if (currentRole() !== "admin") return;
  const free = db.bags.filter(function (b) { return !b.studentId; });
  let html = '<h1 class="page-title">Students and Bags</h1><p class="page-sub">Each student has one permanent bag. Students cannot change it themselves.</p>';
  html += tableHTML(["Student ID", "Student", "Assigned bag", "Bag status"], db.students.map(function (s) {
    const bag = bagOfStudent(s.id);
    return [esc(s.id), esc(s.name), bag ? bag.number : "-", bag ? bagPill(bag.status) : "-"];
  }), "No students yet.");
 
  html += '<div class="card"><h3>Add a student and assign a bag</h3>';
  if (studentMsg) html += '<p class="' + (studentMsg.indexOf("added") !== -1 ? "" : "error") + '">' + esc(studentMsg) + "</p>";
  if (free.length === 0) {
    html += '<p class="muted">All bags are assigned. No free bag is available.</p>';
  } else {
    html += '<div class="grid-2"><div><label for="newId">Student ID</label><input id="newId" class="input" placeholder="RU2026CS004"></div>' +
      '<div><label for="newName">Student name</label><input id="newName" class="input" placeholder="Full name"></div>' +
      '<div><label for="newPass">Starting password</label><input id="newPass" class="input" placeholder="ru@2026"></div>' +
      '<div><label for="newBag">Available bag</label><select id="newBag">' + free.map(function (b) { return "<option>" + b.number + "</option>"; }).join("") + "</select></div></div>" +
      '<div class="actions"><button class="btn" data-act="add-student">Confirm Assignment</button></div>';
  }
  html += "</div>";
  $("page-a-students").innerHTML = html;
}
 
function addStudent() {
  db = loadData();
  const id = $("newId").value.trim(), name = $("newName").value.trim(), pass = $("newPass").value.trim(), bagNo = $("newBag").value;
  if (!id || !name || !pass) { studentMsg = "Fill in the student ID, name and password."; renderAdminStudents(); return; }
  if (db.students.some(function (s) { return s.id.toLowerCase() === id.toLowerCase(); })) { studentMsg = "A student with this ID already exists."; renderAdminStudents(); return; }
  const bag = db.bags.find(function (b) { return b.number === bagNo; });
  if (!bag || bag.studentId) { studentMsg = "That bag is already assigned. Choose another bag."; renderAdminStudents(); return; }
 
  db.students.push({ id: id, name: name, password: pass, bag: bag.number });
  bag.studentId = id;
  logActivity("Bag " + bag.number + " assigned to " + name, id, bag.number, currentUser().id);
  saveData(db);
  studentMsg = "Student added and bag " + bag.number + " assigned.";
  renderCurrent();
}
 
// ======================================================
//  ADMIN: ALL LAUNDRY HISTORY
// ======================================================
 
function renderAdminHistory() {
  if (currentRole() !== "admin") return;
  const tabs = [["give", "All Give Clothes History"], ["take", "All Take Clothes History"], ["activity", "All Laundry Activity"]];
  let html = '<h1 class="page-title">All Laundry History</h1><p class="page-sub">Records for every student. Reference photos are never shown here.</p>';
  html += '<div class="tabs">' + tabs.map(function (t) { return '<button class="tab' + (histTab === t[0] ? " active" : "") + '" data-tab="' + t[0] + '">' + t[1] + "</button>"; }).join("") + "</div>";
  html += '<div class="filters"><input id="histQ" class="input" placeholder="Search student ID, name or bag" value="' + esc(histQ) + '">';
  if (histTab !== "activity") html += '<select id="histResult">' + optionsHTML(OUTCOME_OPTIONS, histResult) + "</select>";
  html += '</div><div id="histDetail"></div><div id="histList"></div>';
  $("page-a-history").innerHTML = html;
  renderHistDetail();
  renderHistList();
}
 
function renderHistList() {
  const q = histQ.trim().toLowerCase();
  if (histTab === "activity") {
    const list = db.activity.filter(function (a) { return !q || (a.studentId + " " + studentName(a.studentId) + " " + a.bag + " " + a.text).toLowerCase().indexOf(q) !== -1; });
    $("histList").innerHTML = tableHTML(["Time", "Student ID", "Bag", "Action", "Done by"], list.map(function (a) {
      return [fmt(a.time), esc(a.studentId || "-"), a.bag || "-", esc(a.text), a.by ? esc(personName(a.by)) : "-"];
    }), "No activity matches.");
    return;
  }
  let list = db.transactions.filter(function (t) { return t.type === histTab; });
  if (q) list = list.filter(function (t) { return (t.studentId + " " + studentName(t.studentId) + " " + t.bag).toLowerCase().indexOf(q) !== -1; });
  if (histResult !== "all") list = list.filter(function (t) { return outcomeKey(t) === histResult; });
  list.sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
 
  const workerHead = histTab === "give" ? "Received by" : "Handed over by";
  $("histList").innerHTML = tableHTML(["Requested", "Student ID", "Student", "Bag", "Clothes", "Service", workerHead, "Result", ""], list.map(function (t) {
    const worker = histTab === "give" ? t.workerId : t.handoverBy;
    return [fmt(t.createdAt), esc(t.studentId), esc(studentName(t.studentId)), t.bag, t.quantity, serviceText(t) + " " + servicePill(t),
      worker ? esc(personName(worker)) : "-", outcomePill(t), '<button class="btn btn-outline btn-small" data-act="hist-detail" data-id="' + t.id + '">Timeline</button>'];
  }), "No records match.");
}
 
function renderHistDetail() {
  const box = $("histDetail");
  if (!box) return;
  const t = histDetailId ? db.transactions.find(function (x) { return x.id === histDetailId; }) : null;
  if (!t) { box.innerHTML = ""; return; }
  box.innerHTML = '<div class="card"><div class="row-top"><h3>' + (t.type === "give" ? "Give Clothes" : "Take Clothes") + " - " + t.bag + "</h3>" + outcomePill(t) + "</div>" +
    infoGrid([["Student", esc(studentName(t.studentId)) + " (" + esc(t.studentId) + ")"], ["Service", serviceText(t)], ["Clothes", t.quantity], ["Requested", fmt(t.createdAt)]]) +
    '<h3 style="margin-top:18px">Timeline</h3>' + eventsHTML(t.events) +
    '<div class="actions"><button class="btn btn-outline btn-small" data-act="hist-close">Close timeline</button></div></div>';
}
 
// ======================================================
//  ADMIN: COMPLAINTS
// ======================================================
 
function renderAdminComplaints() {
  if (currentRole() !== "admin") return;
  const a = currentUser();
  if (!a) return;
  const statusOpts = [["all", "All statuses"]].concat(COMPLAINT_STATUSES.map(function (s) { return [s, s]; }));
  const catOpts = [["all", "All categories"]].concat(COMPLAINT_CATEGORIES.map(function (c) { return [c, c]; }));
  $("page-a-complaints").innerHTML = '<h1 class="page-title">Complaints</h1><p class="page-sub">Reply to students and mark complaints as resolved.</p>' + complaintStatsHTML(a) +
    '<div class="filters"><input id="compQ" class="input" placeholder="Search reference, student ID or bag" value="' + esc(compF.q) + '">' +
    '<select id="compStatus">' + optionsHTML(statusOpts, compF.status) + '</select><select id="compCat">' + optionsHTML(catOpts, compF.category) + "</select></div><div id=\"compList\"></div>";
  renderCompList();
}
 
function renderCompList() {
  const q = compF.q.trim().toLowerCase();
  const list = db.complaints.filter(function (c) {
    if (q && (c.id + " " + c.studentId + " " + c.bag).toLowerCase().indexOf(q) === -1) return false;
    if (compF.status !== "all" && c.status !== compF.status) return false;
    if (compF.category !== "all" && c.category !== compF.category) return false;
    return true;
  }).sort(function (x, y) { return y.createdAt.localeCompare(x.createdAt); });
 
  if (list.length === 0) { $("compList").innerHTML = emptyHTML("No complaints match."); return; }
 
  $("compList").innerHTML = list.map(function (c) {
    const cls = c.status === "Resolved" ? "pill-green" : (c.status === "Under review" ? "pill-amber" : "pill-red");
    return '<details class="row-card" data-id="' + c.id + '"' + (complaintOpenId === c.id ? " open" : "") + "><summary><div class=\"row-top\"><span><b>" + c.id + "</b> - " + esc(c.category) +
      '</span><span class="pill ' + cls + '">' + c.status + '</span></div><div class="muted small">' + esc(studentName(c.studentId)) + " (" + esc(c.studentId) + ") - Bag " + c.bag + " - " + fmt(c.createdAt) + "</div></summary>" +
      "<p>" + esc(c.description) + "</p>" +
      eventsHTML(c.updates.map(function (u) { return { time: u.time, text: u.text + " (" + u.status + ")", by: personName(u.by) }; })) +
      (c.resolvedAt ? '<p class="muted small" style="margin-top:10px">Resolved ' + fmt(c.resolvedAt) + " by " + esc(personName(c.resolvedBy)) + "</p>" : "") +
      '<label for="cs-' + c.id + '">Set status</label><select id="cs-' + c.id + '">' + COMPLAINT_STATUSES.map(function (s) { return "<option" + (s === c.status ? " selected" : "") + ">" + s + "</option>"; }).join("") + "</select>" +
      '<label for="ct-' + c.id + '">Reply or note for the student</label><textarea id="ct-' + c.id + '" rows="3" maxlength="500"></textarea>' +
      '<div class="actions"><button class="btn btn-small" data-act="complaint-save" data-id="' + c.id + '">Save update</button></div></details>';
  }).join("");
}
 
function saveComplaint(id) {
  const status = $("cs-" + id).value;
  const text = $("ct-" + id).value.trim();
  if (!text) { showToast("Write a reply or note before saving.", true); return; }
  complaintOpenId = id;
  if (status === "Resolved") {
    askConfirm({ title: "Mark as resolved?", text: "The student will be told that complaint " + id + " is resolved.", yes: "Mark Resolved" }, function () { doSaveComplaint(id, status, text); });
  } else {
    doSaveComplaint(id, status, text);
  }
}
 
function doSaveComplaint(id, status, text) {
  db = loadData();
  const a = currentUser();
  const c = db.complaints.find(function (x) { return x.id === id; });
  if (!c) return;
  const now = nowIso();
  c.updates.push({ time: now, by: a.id, text: text, status: status });
  c.status = status;
  c.updatedAt = now;
  c.handledBy = a.id;
  if (status === "Resolved") { c.resolvedAt = now; c.resolvedBy = a.id; }
  else { delete c.resolvedAt; delete c.resolvedBy; }
  notifyStudent(c.studentId, status === "Resolved" ? "Your complaint " + c.id + " has been resolved." : "Your complaint " + c.id + " has been updated.");
  logActivity("Complaint " + c.id + " " + (status === "Resolved" ? "resolved" : "updated (" + status + ")"), c.studentId, c.bag, a.id);
  saveData(db);
  renderCurrent();
  showToast("Complaint " + id + " saved.");
}
 