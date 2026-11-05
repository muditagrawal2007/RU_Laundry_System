// student.js - everything the student portal does.
 
let giveQty = 1;              // quantity chosen on the Give Clothes form (1 to 10)
let givePhoto = null;         // optional reference photo (kept in memory until the QR is created)
let giveService = "regular";   // regular, urgent or ironing
let giveIroning = false;      // "also add ironing"
let historyTab = "all";
let historySort = "new";
let complaintFormOpen = false;
let complaintMsg = "";
 
renderers["s-dashboard"] = renderStudentDashboard;
renderers["s-laundry"] = renderLaundry;
renderers["s-history"] = renderHistory;
renderers["s-complaints"] = renderComplaints;
renderers["s-notifications"] = renderStudentNotifications;
renderers["s-profile"] = renderProfile;
document.addEventListener("DOMContentLoaded", bindStudentEvents);
 
function bindStudentEvents() {
  $("page-s-laundry").addEventListener("click", onLaundryClick);
  $("page-s-laundry").addEventListener("change", function (e) {
    if (e.target.id === "photoInput") handlePhotoFile(e.target.files[0]);
    if (e.target.id === "ironingChk") { giveIroning = e.target.checked; renderLaundry(); }
  });
 
  $("page-s-history").addEventListener("click", function (e) {
    const tab = e.target.closest("[data-tab]");
    if (tab) { historyTab = tab.getAttribute("data-tab"); renderHistory(); }
  });
  $("page-s-history").addEventListener("change", function (e) {
    if (e.target.id === "historySort") { historySort = e.target.value; renderHistory(); }
  });
 
  $("page-s-complaints").addEventListener("click", function (e) {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.getAttribute("data-act");
    if (act === "complaint-open") { complaintFormOpen = true; complaintMsg = ""; renderComplaints(); }
    if (act === "complaint-cancel") { complaintFormOpen = false; renderComplaints(); }
    if (act === "complaint-submit") submitComplaint();
  });
 
  $("page-s-notifications").addEventListener("click", function (e) {
    if (!e.target.closest("[data-act='mark-read']")) return;
    const s = currentUser();
    db = loadData();
    db.notifications.forEach(function (n) { if (n.studentId === s.id) n.read = true; });
    saveData(db);
    renderCurrent();
  });
 
  $("page-s-profile").addEventListener("click", function (e) {
    if (e.target.closest("[data-act='logout']")) confirmLogout();
  });
}
 
function backLink() { return '<button class="back" data-go="s-dashboard">&larr; Back to Dashboard</button>'; }
 
// ======================================================
//  DASHBOARD
// ======================================================
 
function renderStudentDashboard() {
  if (currentRole() !== "student") return;
  const s = currentUser();
  if (!s) return;
  const bag = bagOfStudent(s.id);
  const active = activeTxn(s.id);
  const pending = unseenResult(s.id);
 
  let html = '<h1 class="page-title">Welcome, ' + esc(s.name) + '</h1><p class="page-sub">Here is your laundry at a glance.</p>';
 
  if (!bag) {
    html += emptyHTML("No bag is assigned to you yet. Please contact the laundry desk.");
    $("page-s-dashboard").innerHTML = html;
    return;
  }
 
  // student information (bag number is read-only)
  html += '<div class="card">' + infoGrid([["Student name", esc(s.name)], ["Student ID", esc(s.id)], ["Your assigned bag", "<b>" + bag.number + "</b>"]]) +
    '<p class="muted small" style="margin:14px 0 0">Your bag number is fixed. It cannot be changed here.</p></div>';
 
  // counter status
  html += '<div class="card"><div class="row-top"><h3>Counter Status: ' + (db.counterOpen ? "OPEN" : "CLOSED") + "</h3>" + counterPill() + "</div>" +
    "<p class=\"muted\" style=\"margin:8px 0 0\">" + (db.counterOpen ? "New laundry submissions and collections are currently available."
      : "The counter is closed. You can still view your bag status and history.") + "</p></div>";
 
  // my bag
  let note = "Your bag is with you.";
  if (bag.status === BAG_IN_PROCESS) note = "Your clothes have been received by the laundry team.";
  if (bag.status === BAG_AT_COUNTER) note = "Your clothes are ready for collection at the counter.";
  let extra = "";
  if (bag.status === BAG_IN_PROCESS) {
    extra = infoGrid([["Service", serviceText(bag) + " " + servicePill(bag)], ["Clothes", bag.quantity], ["Expected ready by", dueText(bag.dueAt)]]) + progressHTML(bag);
  }
  if (bag.status === BAG_AT_COUNTER) extra = infoGrid([["Service", serviceText(bag)], ["Clothes", bag.quantity]]);
  let button = "";
  if (active) button = '<button class="btn" data-go="s-laundry">Continue your request</button>';
  else if (pending) button = '<button class="btn" data-go="s-laundry">View result</button>';
  else if (db.counterOpen && bag.status === BAG_NOT_GIVEN) button = '<button class="btn" data-go="s-laundry">Give Clothes</button>';
  else if (db.counterOpen && bag.status === BAG_AT_COUNTER) button = '<button class="btn" data-go="s-laundry">Take Clothes</button>';
 
  html += '<div class="card"><h3>Your Bag: ' + bag.status + "</h3><p style=\"margin:6px 0 10px\">" + bagPill(bag.status) + "</p><p class=\"muted\">" + note + "</p>" + extra +
    '<p class="muted small" style="margin-top:12px">Latest update: ' + fmt(bag.updatedAt) + "</p>" + (button ? '<div class="actions">' + button + "</div>" : "") + "</div>";
 
  // recent activity (only this student's bag)
  const recent = db.activity.filter(function (a) { return a.studentId === s.id; }).slice(0, 5);
  html += '<div class="card"><h3>Recent activity</h3>';
  if (recent.length === 0) html += '<p class="muted">Nothing yet. Your laundry activity will appear here.</p>';
  else html += eventsHTML(recent.map(function (a) { return { time: a.time, text: a.text, by: "" }; }));
  html += "</div>";
 
  // quick links
  html += '<div class="actions"><button class="btn btn-outline btn-small" data-go="s-history" data-param="give">Give Clothes History</button>' +
    '<button class="btn btn-outline btn-small" data-go="s-history" data-param="take">Take Clothes History</button>' +
    '<button class="btn btn-outline btn-small" data-go="s-complaints">My Complaints</button>' +
    '<button class="btn btn-outline btn-small" data-go="s-history" data-param="all">All History</button></div>';
 
  $("page-s-dashboard").innerHTML = html;
}
 
// ======================================================
//  MY LAUNDRY (Give Clothes and Take Clothes)
// ======================================================
 
function renderLaundry() {
  if (currentRole() !== "student") return;
  const s = currentUser();
  if (!s) return;
  const bag = bagOfStudent(s.id);
  const active = activeTxn(s.id);
  let html = "";
  if (!bag) html = emptyHTML("No bag is assigned to you yet. Please contact the laundry desk.");
  else if (active) html = activeView(active, s, bag);
  else {
    const result = unseenResult(s.id);
    html = result ? resultView(result, s, bag) : idleView(s, bag);
  }
  $("page-s-laundry").innerHTML = html;
  if (active && active.status === "qr_generated") drawQR("qrBox", "RU-LAUNDRY|" + active.code);
  updateCountdowns();
}
 
function photoCard(giveTxnId) {
  const photo = giveTxnId ? getPhoto(giveTxnId) : null;
  if (!photo) return "";
  return '<div class="card"><h3>Your Reference Photo</h3><p class="muted">Compare your clothes with this photo before accepting your bag. Only you can see it.</p>' +
    '<img class="photo" src="' + photo + '" alt="Your reference photo"></div>';
}
 
// a request is in progress: show the QR or the next step
function activeView(t, s, bag) {
  let html = backLink();
 
  if (t.type === "give") {   // status is always qr_generated for give requests
    html += '<h1 class="page-title">Your Submission QR Code</h1>';
    html += '<div class="card qr-card"><div id="qrBox" class="qr"></div>' +
      '<p class="muted small" style="margin:0">Code (if the scanner cannot read the QR)</p><p class="code-text">' + t.code + "</p>" +
      infoGrid([["Bag number", bag.number], ["Service", serviceText(t) + " " + servicePill(t)], ["Clothes", t.quantity], ["Requested", fmt(t.createdAt)], ["QR expires in", countdownHTML(t.expiresAt)]]) +
      '<p class="step-pill">Waiting for Worker Verification</p><p class="muted">Show this QR code to the laundry worker.</p>' +
      '<div class="actions" style="justify-content:center"><button class="btn btn-outline btn-small" data-go="s-dashboard">Back to Dashboard</button>' +
      '<button class="btn btn-outline btn-small" data-act="cancel-txn" data-id="' + t.id + '">Cancel request</button></div></div>';
    return html;
  }
 
  if (t.status === "qr_generated") {
    html += '<h1 class="page-title">Your Collection QR Code</h1>';
    html += '<div class="card qr-card"><div id="qrBox" class="qr"></div>' +
      '<p class="muted small" style="margin:0">Code (if the scanner cannot read the QR)</p><p class="code-text">' + t.code + "</p>" +
      infoGrid([["Bag number", bag.number], ["Service", serviceText(t)], ["Clothes recorded", t.quantity], ["Requested", fmt(t.createdAt)], ["QR expires in", countdownHTML(t.expiresAt)]]) +
      '<p class="step-pill">Waiting for Worker Scan</p><p class="muted">Show this QR code to the laundry worker.</p>' +
      '<div class="actions" style="justify-content:center"><button class="btn btn-outline btn-small" data-go="s-dashboard">Back to Dashboard</button>' +
      '<button class="btn btn-outline btn-small" data-act="cancel-txn" data-id="' + t.id + '">Cancel request</button></div></div>' + photoCard(t.giveTxnId);
    return html;
  }
 
  if (t.status === "scanned") {
    html += '<h1 class="page-title">Your Bag Is Ready for Verification</h1>';
    html += '<div class="card">' + infoGrid([["Bag number", bag.number], ["Clothes recorded", t.quantity], ["Verify within", countdownHTML(t.verifyExpiresAt)]]) +
      '<p class="muted" style="margin-top:14px">Check the bag details and your reference photo. Confirm when you are ready to receive your clothes.</p>' +
      '<div class="actions"><button class="btn" data-act="verify-collection" data-id="' + t.id + '">Verify Collection</button></div></div>' + photoCard(t.giveTxnId);
    return html;
  }
 
  // student_verified: waiting for the worker to hand over the bag
  html += '<h1 class="page-title">Collection Verified</h1>';
  html += '<div class="card qr-card"><p>Your verification is complete. Please wait while the worker hands over your bag.</p>' +
    infoGrid([["Bag number", bag.number], ["Clothes recorded", t.quantity], ["You verified at", fmt(t.studentVerifiedAt)]]) +
    '<p class="step-pill">Waiting for Worker Handover</p></div>';
  return html;
}
 
// a request just finished or expired: show the result once
function resultView(t, s, bag) {
  let html = "";
  if (t.status === "completed") {
    const isGive = t.type === "give";
    html += '<div class="card qr-card"><div class="success-mark">&#10003;</div>' +
      "<h1 class=\"page-title\">" + (isGive ? "Bag Received Successfully" : "Clothes Collected Successfully") + "</h1>" +
      "<p class=\"muted\">" + (isGive ? "The laundry team has received your clothes." : "You have collected your clothes.") + "</p>" +
      infoGrid([["Bag number", t.bag], [isGive ? "Recorded clothes" : "Clothes collected", t.quantity], ["Service", serviceText(t)],
        [isGive ? "Received at" : "Collected at", fmt(t.completedAt)], ["Bag status now", bagPill(bag.status)]].concat(isGive ? [["Expected ready by", dueText(bag.dueAt)]] : [])) +
      '<div class="actions" style="justify-content:center"><button class="btn" data-act="ack">Back to Dashboard</button></div></div>';
    return html;
  }
 
  // expired
  let title = t.type === "give" ? "Submission QR Expired" : "Collection QR Expired";
  let text = "Your QR code has expired. Generate a new one to continue.";
  if (t.verifyExpiresAt) { title = "Verification Session Expired"; text = "Your collection session has expired. Generate a new QR code to continue."; }
  html += '<div class="card qr-card"><div class="success-mark warn-mark">!</div><h1 class="page-title">' + title + "</h1><p class=\"muted\">" + text + "</p>" +
    infoGrid([["Bag number", t.bag], ["Clothes", t.quantity]]) +
    '<div class="actions" style="justify-content:center"><button class="btn" data-act="regen" data-id="' + t.id + '">Generate New QR</button>' +
    '<button class="btn btn-outline" data-act="ack">Back to Dashboard</button></div></div>';
  return html;
}
 
// no request in progress: show the form that fits the bag status
function idleView(s, bag) {
  let html = backLink();
 
  if (bag.status === BAG_IN_PROCESS) {
    return html + '<h1 class="page-title">My Laundry</h1><div class="card"><h3>Your Bag: ' + bag.status + "</h3><p style=\"margin:6px 0 10px\">" + bagPill(bag.status) + " " + servicePill(bag) + "</p>" +
      infoGrid([["Service", serviceText(bag)], ["Clothes", bag.quantity], ["Received", fmt(bag.receivedAt)], ["Expected ready by", dueText(bag.dueAt)]]) +
      '<h3 style="margin-top:18px">Progress</h3>' + progressHTML(bag) +
      '<p class="muted" style="margin-top:12px">You can take your clothes once the bag is at the counter.</p></div>';
  }
 
  if (!db.counterOpen) {
    return html + '<h1 class="page-title">My Laundry</h1><div class="card"><div class="row-top"><h3>Counter Status: CLOSED</h3>' + counterPill() + "</div>" +
      '<p class="muted">The counter is closed. You can still view your bag status and history.</p><p>' + bagPill(bag.status) + "</p></div>";
  }
 
  if (bag.status === BAG_NOT_GIVEN) {
    if (giveService === "urgent" && !urgentOn()) giveService = "regular";
    const chosen = { service: giveService, ironing: giveService === "ironing" ? true : giveIroning };
    const days = daysFor(giveService);
 
    html += '<h1 class="page-title">Give Clothes</h1><p class="page-sub">Choose a service, enter the quantity and generate your submission QR code.</p>';
    html += '<div class="card">' + infoGrid([["Student ID", esc(s.id)], ["Student name", esc(s.name)], ["Bag number", "<b>" + bag.number + "</b>"]]) + "</div>";
 
    html += '<div class="card"><h3>Choose a service</h3><div class="service-grid">' +
      ["regular", "urgent", "ironing"].map(function (k) {
        const off = (k === "urgent" && !urgentOn());
        return '<button class="service-card' + (giveService === k ? " active" : "") + '" data-act="svc" data-svc="' + k + '"' + (off ? " disabled" : "") + "><b>" +
          SERVICES[k].label + "</b><span>" + (off ? "Currently unavailable" : SERVICES[k].note) + "</span></button>";
      }).join("") + "</div>";
    if (giveService !== "ironing") {
      html += '<label class="check-label"><input type="checkbox" id="ironingChk"' + (giveIroning ? " checked" : "") + "> Also add ironing</label>";
    }
    html += "</div>";
 
    html += '<div class="card"><h3>How many clothes are you giving?</h3><div class="stepper"><button data-act="qty-minus" aria-label="One less">&minus;</button>' +
      "<span>" + giveQty + '</span><button data-act="qty-plus" aria-label="One more">+</button></div><p class="muted small">Choose between 1 and 10 clothes.</p></div>';
 
    html += '<div class="card"><h3>Add a Reference Photo (Optional)</h3><p class="muted">Upload a photo of your clothes so you can compare them when collecting your bag. Only you can view this photo.</p>';
    if (givePhoto) {
      html += '<img class="photo" src="' + givePhoto + '" alt="Preview of your photo"><div class="actions"><button class="btn btn-outline btn-small" data-act="pick-photo">Replace Photo</button>' +
        '<button class="btn btn-outline btn-small" data-act="remove-photo">Remove Photo</button></div>';
    } else {
      html += '<button class="btn btn-outline btn-small" data-act="pick-photo">Upload Photo</button>';
    }
    html += '<input type="file" id="photoInput" accept="image/*" class="hidden"></div>';
 
    html += '<div class="card"><h3>Submission summary</h3>' + infoGrid([["Student ID", esc(s.id)], ["Assigned bag", bag.number], ["Service", serviceText(chosen)],
      ["Clothes", giveQty], ["Ready in", days + (days === 1 ? " day" : " days") + " after the worker receives your bag"], ["Reference photo", givePhoto ? "Added" : "Not added"]]) + "</div>";
    html += '<div class="actions"><button class="btn" data-act="generate-give">Confirm and Generate QR</button><button class="btn btn-outline" data-go="s-dashboard">Cancel</button></div>';
    return html;
  }
 
  // bag at counter: Take Clothes details
  const g = lastGiveTxn(s.id);
  html += '<h1 class="page-title">Take Clothes</h1><p class="page-sub">Review your recorded clothes details before requesting collection.</p>';
  html += '<div class="card">' + infoGrid([["Student ID", esc(s.id)], ["Student name", esc(s.name)], ["Bag number", "<b>" + bag.number + "</b>"],
    ["Service", serviceText(bag)], ["Clothes recorded", bag.quantity], ["Submitted on", g ? fmt(g.completedAt) : fmt(bag.receivedAt)]]) + "</div>";
  html += photoCard(g ? g.id : null);
  html += '<div class="actions"><button class="btn" data-act="take-start">Take Clothes</button></div>';
  return html;
}
 
// ---------- actions on the My Laundry page ----------
 
function onLaundryClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.getAttribute("data-act");
  const id = btn.getAttribute("data-id");
 
  if (act === "qty-minus") { if (giveQty > 1) giveQty--; renderLaundry(); }
  if (act === "qty-plus") { if (giveQty < 10) giveQty++; renderLaundry(); }
  if (act === "svc") { giveService = btn.getAttribute("data-svc"); renderLaundry(); }
  if (act === "pick-photo") $("photoInput").click();
  if (act === "remove-photo") { givePhoto = null; renderLaundry(); }
  if (act === "generate-give") generateGive();
  if (act === "take-start") {
    askConfirm({ title: "Request Your Clothes?", text: "Generate a time-limited collection QR code for your assigned bag?", yes: "Generate Collection QR" }, createTake);
  }
  if (act === "verify-collection") verifyCollection(id);
  if (act === "cancel-txn") {
    askConfirm({ title: "Cancel this request?", text: "The QR code will stop working.", yes: "Cancel request" }, function () { cancelTxn(id); });
  }
  if (act === "ack") { acknowledgeResults(); showPage("s-dashboard"); }
  if (act === "regen") regenerate(id);
}
 
function handlePhotoFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) { showToast("Please choose an image file.", true); return; }
  const reader = new FileReader();
  reader.onload = function () {
    const img = new Image();
    img.onload = function () {
      const max = 700;   // shrink the photo so it fits in browser storage
      let w = img.width, h = img.height;
      if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      givePhoto = canvas.toDataURL("image/jpeg", 0.7);
      renderLaundry();
    };
    img.onerror = function () { showToast("That image could not be read.", true); };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}
 
function createTxn(type, s, bag, quantity, photo, giveTxnId, opts) {
  const now = new Date();
  const t = {
    id: "TX" + Date.now() + Math.floor(Math.random() * 1000), type: type, studentId: s.id, bag: bag.number, quantity: quantity, service: opts.service, ironing: opts.ironing,
    status: "qr_generated", code: newCode(type === "give" ? "G" : "T"), createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + QR_MINUTES * 60000).toISOString(), seen: false, giveTxnId: giveTxnId || null, events: []
  };
  addEvent(t, (type === "give" ? "Give Clothes request created" : "Collection request created") + " (" + serviceText(opts) + ")", s.id);
  addEvent(t, "QR code generated", s.id);
  db.transactions.push(t);
  if (photo) setPhoto(t.id, photo);
  logActivity(type === "give" ? "Give Clothes request created" : "Collection request created", s.id, bag.number, s.id);
  return t;
}
 
function acknowledgeResults() {
  db = loadData();
  const s = currentUser();
  db.transactions.forEach(function (t) { if (t.studentId === s.id && !isActive(t)) t.seen = true; });
  saveData(db);
}
 
function generateGive() {
  db = loadData();
  const s = currentUser(), bag = bagOfStudent(s.id);
  if (!db.counterOpen) { showToast("The counter is closed right now.", true); renderCurrent(); return; }
  if (bag.status !== BAG_NOT_GIVEN || activeTxn(s.id)) { showToast("You cannot start a new Give Clothes request right now.", true); renderCurrent(); return; }
  if (giveService === "urgent" && !urgentOn()) { showToast("One-day urgent service is switched off right now.", true); renderCurrent(); return; }
  createTxn("give", s, bag, giveQty, givePhoto, null, { service: giveService, ironing: giveService === "ironing" ? true : giveIroning });
  givePhoto = null;
  giveQty = 1;
  giveService = "regular";
  giveIroning = false;
  saveData(db);
  renderCurrent();
  showToast("Your submission QR code is ready.");
}
 
function createTake() {
  db = loadData();
  const s = currentUser(), bag = bagOfStudent(s.id);
  if (!db.counterOpen) { showToast("The counter is closed right now.", true); renderCurrent(); return; }
  if (bag.status !== BAG_AT_COUNTER || activeTxn(s.id)) { showToast("You cannot start a collection right now.", true); renderCurrent(); return; }
  const g = lastGiveTxn(s.id);
  createTxn("take", s, bag, bag.quantity, null, g ? g.id : null, { service: bag.service, ironing: bag.ironing });
  saveData(db);
  renderCurrent();
  showToast("Your collection QR code is ready.");
}
 
function regenerate(oldId) {
  db = loadData();
  const s = currentUser(), bag = bagOfStudent(s.id);
  const old = db.transactions.find(function (t) { return t.id === oldId; });
  if (!old || activeTxn(s.id)) return;
  if (!db.counterOpen) { showToast("The counter is closed right now. Try again when it opens.", true); return; }
 
  if (old.type === "give") {
    if (bag.status !== BAG_NOT_GIVEN) { showToast("Your bag is no longer waiting to be given.", true); return; }
    if (old.service === "urgent" && !urgentOn()) { showToast("One-day urgent service is switched off right now.", true); return; }
    createTxn("give", s, bag, old.quantity, getPhoto(old.id), null, { service: old.service, ironing: old.ironing });
  } else {
    if (bag.status !== BAG_AT_COUNTER) { showToast("Your bag is not at the counter.", true); return; }
    createTxn("take", s, bag, bag.quantity, null, old.giveTxnId, { service: bag.service, ironing: bag.ironing });
  }
  db.transactions.forEach(function (t) { if (t.studentId === s.id && !isActive(t)) t.seen = true; });
  saveData(db);
  renderCurrent();
  showToast("New QR code generated.");
}
 
function verifyCollection(id) {
  db = loadData();
  expireTransactions();
  const t = db.transactions.find(function (x) { return x.id === id; });
  if (!t || t.status !== "scanned") { renderCurrent(); return; }
  t.status = "student_verified";
  t.studentVerifiedAt = nowIso();
  addEvent(t, "Student verified the collection", t.studentId);
  logActivity("Student verification received", t.studentId, t.bag, t.studentId);
  saveData(db);
  renderCurrent();
}
 
function cancelTxn(id) {
  db = loadData();
  const t = db.transactions.find(function (x) { return x.id === id; });
  if (!t || t.status !== "qr_generated") { renderCurrent(); return; }   // too late to cancel once the worker has scanned it
  t.status = "cancelled";
  t.seen = true;
  addEvent(t, "Request cancelled by the student", t.studentId);
  logActivity("Request cancelled by the student", t.studentId, t.bag, t.studentId);
  saveData(db);
  showToast("Request cancelled.");
  showPage("s-dashboard");
}
 
// ======================================================
//  MY HISTORY
// ======================================================
 
function renderHistory(param) {
  if (currentRole() !== "student") return;
  if (param) historyTab = param;
  const s = currentUser();
  if (!s) return;
 
  let list = txnsOf(s.id);
  if (historyTab !== "all") list = list.filter(function (t) { return t.type === historyTab; });
  if (historySort === "old") list.reverse();
 
  const tabs = [["all", "All Laundry History"], ["give", "Give Clothes History"], ["take", "Take Clothes History"]];
  let html = '<h1 class="page-title">My History</h1><p class="page-sub">Only your own laundry records are shown here.</p>';
  html += '<div class="tabs">' + tabs.map(function (t) {
    return '<button class="tab' + (historyTab === t[0] ? " active" : "") + '" data-tab="' + t[0] + '">' + t[1] + "</button>";
  }).join("") + "</div>";
  html += '<div class="filters"><select id="historySort"><option value="new"' + (historySort === "new" ? " selected" : "") + '>Newest first</option><option value="old"' +
    (historySort === "old" ? " selected" : "") + ">Oldest first</option></select></div>";
 
  if (list.length === 0) {
    html += emptyHTML("No laundry history yet.");
  } else {
    html += list.map(function (t) {
      const photo = getPhoto(t.type === "give" ? t.id : t.giveTxnId);
      return '<details class="row-card"><summary><div class="row-top"><span><b>' + (t.type === "give" ? "Give Clothes" : "Take Clothes") + "</b> - " + t.bag +
        " - " + t.quantity + " clothes</span><span>" + servicePill(t) + " " + outcomePill(t) + '</span></div><div class="muted small">' + serviceText(t) + " - " + fmt(t.createdAt) + " (tap for details)</div></summary>" +
        eventsHTML(t.events) + (photo ? '<img class="thumb" src="' + photo + '" alt="Your reference photo">' : "") + "</details>";
    }).join("");
  }
  $("page-s-history").innerHTML = html;
}
 
// ======================================================
//  MY COMPLAINTS
// ======================================================
 
function renderComplaints() {
  if (currentRole() !== "student") return;
  const s = currentUser();
  if (!s) return;
  const mine = db.complaints.filter(function (c) { return c.studentId === s.id; })
    .sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
  const resolved = mine.filter(function (c) { return c.status === "Resolved"; }).length;
 
  let html = '<h1 class="page-title">My Complaints</h1><p class="page-sub">Tell us if something went wrong with your laundry.</p>';
  html += '<div class="stat-grid"><div class="stat"><b>' + mine.length + "</b><span>Total submitted</span></div>" +
    '<div class="stat"><b>' + (mine.length - resolved) + "</b><span>Still being handled</span></div>" +
    '<div class="stat"><b>' + resolved + "</b><span>Resolved</span></div></div>";
 
  if (complaintMsg) {
    const parts = complaintMsg.split("|");
    html += '<div class="card"><div class="success-mark">&#10003;</div><h3 class="center">Complaint Submitted Successfully</h3>' +
      '<p class="center muted">Reference number <b>' + parts[0] + "</b> - " + fmt(parts[1]) + "</p></div>";
  }
 
  if (complaintFormOpen) {
    const txns = txnsOf(s.id);
    html += '<div class="card"><h3>Submit New Complaint</h3>' +
      '<label for="complaintTxn">Related laundry record</label><select id="complaintTxn"><option value="">Not about a specific record</option>' +
      txns.map(function (t) { return '<option value="' + t.id + '">' + (t.type === "give" ? "Give Clothes" : "Take Clothes") + " - " + fmt(t.createdAt) + " (" + txnOutcome(t) + ")</option>"; }).join("") + "</select>" +
      '<label for="complaintCategory">Category</label><select id="complaintCategory">' +
      COMPLAINT_CATEGORIES.map(function (c) { return "<option>" + c + "</option>"; }).join("") + "</select>" +
      '<label for="complaintText">Describe the problem</label><textarea id="complaintText" rows="4" maxlength="500" placeholder="What happened?"></textarea>' +
      '<p id="complaintError" class="error"></p>' +
      '<div class="actions"><button class="btn" data-act="complaint-submit">Submit Complaint</button><button class="btn btn-outline" data-act="complaint-cancel">Cancel</button></div></div>';
  } else {
    html += '<div class="actions" style="margin:0 0 18px"><button class="btn" data-act="complaint-open">Submit New Complaint</button></div>';
  }
 
  if (mine.length === 0) {
    html += emptyHTML("You have not submitted any complaints yet.");
  } else {
    html += mine.map(function (c) {
      const cls = c.status === "Resolved" ? "pill-green" : (c.status === "Under review" ? "pill-amber" : "pill-red");
      return '<details class="row-card"><summary><div class="row-top"><span><b>' + c.id + "</b> - " + esc(c.category) + '</span><span class="pill ' + cls + '">' + c.status +
        '</span></div><div class="muted small">' + fmt(c.createdAt) + " - Bag " + c.bag + " (tap for details)</div></summary><p>" + esc(c.description) + "</p>" +
        eventsHTML(c.updates.map(function (u) { return { time: u.time, text: u.text + " (" + u.status + ")", by: u.by === s.id ? "You" : "Laundry admin" }; })) + "</details>";
    }).join("");
  }
  $("page-s-complaints").innerHTML = html;
}
 
function submitComplaint() {
  db = loadData();
  const s = currentUser(), bag = bagOfStudent(s.id);
  const text = $("complaintText").value.trim();
  if (text.length < 10) { $("complaintError").textContent = "Please describe the problem in at least 10 characters."; return; }
 
  const numbers = db.complaints.map(function (c) { return parseInt(c.id.slice(2), 10); });
  const next = (numbers.length ? Math.max.apply(null, numbers) : 1000) + 1;
  const c = {
    id: "C-" + next, studentId: s.id, bag: bag ? bag.number : "-", txnId: $("complaintTxn").value || null,
    category: $("complaintCategory").value, description: text, status: "Open", createdAt: nowIso(), updatedAt: nowIso(),
    updates: [{ time: nowIso(), by: s.id, text: "Complaint submitted", status: "Open" }]
  };
  db.complaints.push(c);
  logActivity("Complaint " + c.id + " submitted", s.id, c.bag, s.id);
  saveData(db);
  complaintFormOpen = false;
  complaintMsg = c.id + "|" + c.createdAt;
  renderCurrent();
}
 
// ======================================================
//  NOTIFICATIONS AND PROFILE
// ======================================================
 
function renderStudentNotifications() {
  if (currentRole() !== "student") return;
  const s = currentUser();
  if (!s) return;
  const mine = db.notifications.filter(function (n) { return n.studentId === s.id; });
  let html = '<h1 class="page-title">Notifications</h1><p class="page-sub">Updates about your bag and complaints.</p>';
  html += '<div class="actions" style="margin:0 0 16px"><button class="btn btn-outline btn-small" data-act="mark-read">Mark all as read</button></div>';
  if (mine.length === 0) html += emptyHTML("No notifications yet.");
  else html += mine.map(function (n) {
    return '<div class="row-card notif' + (n.read ? "" : " unread") + '">' + esc(n.text) + '<div class="muted small">' + fmt(n.time) + "</div></div>";
  }).join("");
  $("page-s-notifications").innerHTML = html;
}
 
function renderProfile() {
  if (currentRole() !== "student") return;
  const s = currentUser();
  if (!s) return;
  const bag = bagOfStudent(s.id);
  $("page-s-profile").innerHTML = '<h1 class="page-title">Profile</h1><div class="card">' +
    infoGrid([["Student name", esc(s.name)], ["Student ID", esc(s.id)], ["Assigned bag", bag ? bag.number : "-"]]) +
    '<p class="muted small" style="margin-top:14px">Your assigned bag cannot be changed here. Please contact the laundry desk.</p>' +
    '<div class="actions"><button class="btn btn-outline" data-act="logout">Logout</button></div></div>';
}
 