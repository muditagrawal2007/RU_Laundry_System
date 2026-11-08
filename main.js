// main.js - the server, login, navigation and the rules shared by all three portals.
//
// All the data is in the PostgreSQL database on the server. api.js is the only
// file that talks to it; this file and the two screen files use the data it
// brings back.

const SESSION_KEY = "ruLaundrySession";   // per tab, so you can test 3 portals in 3 tabs

// The demo accounts of the sign in screen. They are the same accounts the
// server has, so this list only helps the person who is trying the app.
const DEMO_ACCOUNTS = {
  student: [
    { id: "RU2026CS001", name: "Aarav Sharma", password: "ru@2026", bag: "B-001" },
    { id: "RU2026CS002", name: "Ananya Verma", password: "ru@2026", bag: "B-002" },
    { id: "RU2026CS003", name: "Ishaan Kumar", password: "ru@2026", bag: "B-003" }
  ],
  worker: [
    { id: "W-001", name: "Ramesh Yadav", password: "worker@ru" },
    { id: "W-002", name: "Sunita Devi", password: "worker@ru" }
  ],
  admin: [
    { id: "admin", name: "Dr. Priya Menon", password: "admin@ru" }
  ]
};
 
const QR_MINUTES = 10;       // how long a QR code stays valid
const VERIFY_MINUTES = 5;    // how long the student has to verify after the worker scans
 
const BAG_NOT_GIVEN = "Bag not given";
const BAG_IN_PROCESS = "Bag in process";
const BAG_AT_COUNTER = "Bag at counter";
 
const COMPLAINT_CATEGORIES = ["Missing clothes", "Damaged clothes", "Incorrect quantity", "Wrong bag received", "Delay in returning clothes", "Other"];
const COMPLAINT_STATUSES = ["Open", "Under review", "Resolved"];
 
const ROLE_INFO = {
  student: { title: "Student Login", desc: "Manage your laundry in one place.", idLabel: "Student ID", idPlaceholder: "RU2026CS001", headerText: "Rishihood University",
    footer: "For students of Rishihood University. Need help? Contact the laundry desk.", error: "Incorrect Student ID or password. Please try again." },
  worker: { title: "Worker Login", desc: "Scan and verify student laundry requests.", idLabel: "Worker ID", idPlaceholder: "W-001", headerText: "Laundry Staff",
    footer: "Help? Contact the laundry supervisor at the counter.", error: "Incorrect Worker ID or password. Please try again." },
  admin: { title: "Admin Login", desc: "Manage the counter, bags, complaints and history.", idLabel: "Admin username", idPlaceholder: "admin", headerText: "RU Laundry Administration",
    footer: "Administrator access only. All actions are recorded.", error: "Incorrect username or password. Please try again." }
};
 
const NAV = {
  student: [["s-dashboard", "Dashboard", "grid"], ["s-laundry", "My Laundry", "shirt"], ["s-history", "My History", "clock"],
    ["s-complaints", "My Complaints", "clipboard"], ["s-notifications", "Notifications", "bell"], ["s-profile", "Profile", "user"]],
  worker: [["w-dashboard", "Dashboard", "scan"], ["w-mywork", "My Work", "bag"], ["w-requests", "Requests", "list"], ["w-activity", "Activity History", "clock"]],
  admin: [["a-dashboard", "Dashboard", "grid"], ["a-bags", "Bag Register", "bag"], ["a-students", "Students and Bags", "users"],
    ["a-history", "All Laundry History", "clock"], ["a-complaints", "Complaints", "clipboard"]]
};
 
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  shirt: '<path d="M8 3 3 6l2 4 3-1v12h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2.5.6 4 2.3 4 5"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'
};
 
const renderers = {};     // every page registers its own render function here
let db = {                // the data of the server, filled in by loadData()
  students: [], workers: [], admins: [], bags: [], transactions: [],
  complaints: [], notifications: [], activity: [],
  counterOpen: true, settings: { urgentEnabled: true }
};
let loginRole = "student";
let currentPage = "";
let currentParam = "";
let lastSig = "";
let toastTimer = null;
let dialogCallback = null;
 
// ================= THE SERVER =================

// All the data lives in the PostgreSQL database on the server. loadData() asks
// the server for what this area needs, and every change goes back through api.js.
// The screens never call fetch() themselves.

let photos = {};      // the reference photos of the student, by submission id

async function loadData() {
  const role = currentRole();
  if (role === "student") {
    const data = await api.loadStudentData();
    photos = await api.loadStudentPhotos();
    return data;
  }
  if (role === "worker") return api.loadWorkerData();
  if (role === "admin") return api.loadAdminData();
  return { students: [], workers: [], admins: [], bags: [], transactions: [], complaints: [], notifications: [], activity: [] };
}

// The old saveData() is gone: a change is made by calling the server, and then
// the data is read again. So there is nothing to save here any more.
function saveData(data) { return data; }

function resetDemo() {
  askConfirm({ title: "Reset demo data?", text: "All requests, complaints and changes will be deleted and the sample data will come back.", yes: "Reset" }, function () {
    sessionStorage.removeItem(SESSION_KEY);
    api.setToken(null);
    showLanding();
    showToast("Demo data has been reset.");
  });
}

// Reference photos: only the student's own screens ever call getPhoto()
function getPhoto(txnId) { return photos[txnId] || null; }
function setPhoto(txnId, dataUrl) { photos[txnId] = dataUrl; }
 
// ================= SMALL HELPERS =================
 
function $(id) { return document.getElementById(id); }
function esc(text) { return String(text == null ? "" : text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function nowIso() { return new Date().toISOString(); }
function fmt(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
function icon(name, size) {
  const s = size || 22;
  return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + "</svg>";
}
 
function showToast(message, isError) {
  const t = $("toast");
  t.textContent = message;
  t.className = "toast" + (isError ? " toast-error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.add("hidden"); }, 3200);
}
 
// opts = { title, text, yes }
function askConfirm(opts, callback) {
  $("dialogTitle").textContent = opts.title;
  $("dialogText").textContent = opts.text;
  $("dialogYes").textContent = opts.yes || "Confirm";
  dialogCallback = callback;
  $("dialogBox").classList.remove("hidden");
}
 
function getSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
}
function currentRole() { const s = getSession(); return s ? s.role : null; }
function currentUser() {
  const s = getSession();
  if (!s) return null;
  let list = db.admins;
  if (s.role === "student") list = db.students;
  if (s.role === "worker") list = db.workers;
  return list.find(function (u) { return u.id === s.id; }) || null;
}
 
// ================= DOMAIN HELPERS =================
 
const ACTIVE_STATUSES = ["qr_generated", "scanned", "student_verified"];
 
function isActive(t) { return ACTIVE_STATUSES.indexOf(t.status) !== -1; }
function studentById(id) { return db.students.find(function (s) { return s.id === id; }) || null; }
function bagOfStudent(studentId) { return db.bags.find(function (b) { return b.studentId === studentId; }) || null; }
function activeTxn(studentId) {
  return db.transactions.find(function (t) { return t.studentId === studentId && isActive(t); }) || null;
}
function txnsOf(studentId) {
  return db.transactions.filter(function (t) { return t.studentId === studentId; })
    .sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
}
// a finished request the student has not acknowledged yet (so they see the result screen)
function unseenResult(studentId) {
  return txnsOf(studentId).find(function (t) {
    if (t.seen || isActive(t) || (t.status !== "completed" && t.status !== "expired")) return false;
    const last = t.events.length ? t.events[t.events.length - 1].time : t.createdAt;
    return Date.now() - Date.parse(last) < 30 * 60000;   // old results are not shown again days later
  }) || null;
}
// the most recent completed Give Clothes record (its date and photo are shown at collection time)
function lastGiveTxn(studentId) {
  return txnsOf(studentId).find(function (t) { return t.type === "give" && t.status === "completed"; }) || null;
}
function personName(id) {
  const all = db.students.concat(db.workers, db.admins);
  const p = all.find(function (x) { return x.id === id; });
  return p ? p.name : id;
}
 
// The server writes the history lines and the notifications, and it marks the
// old QR codes as expired. So these helpers are not needed in the browser any more.

// The code the worker types in. It can be the whole QR text or just the short
// code under it, like "G-4KP7XZ".
function normalizeCode(raw) {
  const parts = String(raw || "").trim().toUpperCase().split("|");
  return parts[parts.length - 1].trim();
}
 
// words used in lists
function txnOutcome(t) {
  if (t.status === "qr_generated") return "Waiting for worker";
  if (t.status === "scanned") return "Waiting for student verification";
  if (t.status === "student_verified") return "Waiting for worker handover";
  if (t.status === "completed") return t.type === "give" ? "Bag received" : "Collected";
  if (t.status === "expired") return t.verifyExpiresAt ? "Verification expired" : "QR expired";
  return "Cancelled";
}
 
// ================= SERVICES: regular (3 days), one-day urgent, ironing =================
 
const SERVICES = {
  regular: { label: "Regular Laundry", days: 3, note: "Ready in 3 days" },
  urgent: { label: "One-Day Urgent Laundry", days: 1, note: "Priority - ready in 1 day" },
  ironing: { label: "Ironing Only", days: 1, note: "No washing - ready in 1 day" }
};
 
function urgentOn() { return !db.settings || db.settings.urgentEnabled !== false; }
function daysFor(service) { return (SERVICES[service] || SERVICES.regular).days; }
 
// x can be a request or a bag: anything with service + ironing
function serviceText(x) {
  const base = (SERVICES[x.service] || SERVICES.regular).label;
  return (x.ironing && x.service !== "ironing") ? base + " + Ironing" : base;
}
function servicePill(x) { return x.service === "urgent" ? '<span class="pill pill-red">URGENT</span>' : ""; }
 
// the steps a worker moves a bag through while it is "Bag in process"
function processStages(x) {
  const stages = ["Bag received"];
  if (x.service !== "ironing") stages.push("Washing in Progress");
  if (x.ironing || x.service === "ironing") stages.push("Ironing in Progress");
  return stages;
}
 
function progressHTML(bag) {
  const stages = processStages(bag).concat(["Ready at counter"]);
  const cur = Math.max(0, processStages(bag).indexOf(bag.progress));
  return '<ol class="progress">' + stages.map(function (st, i) {
    const cls = i < cur ? "done" : (i === cur ? "current" : "");
    return '<li class="' + cls + '">' + st + "</li>";
  }).join("") + "</ol>";
}
 
function isOverdue(bag) { return bag.status === BAG_IN_PROCESS && bag.dueAt && Date.parse(bag.dueAt) < Date.now(); }
 
function dueText(iso) {
  if (!iso) return "-";
  const left = Date.parse(iso) - Date.now();
  if (left < 0) return fmt(iso) + " (running late)";
  const days = Math.ceil(left / 86400000);
  return fmt(iso) + (days <= 1 ? " (less than 1 day left)" : " (" + days + " days left)");
}
 
// ================= SHARED HTML PIECES =================
 
function bagPill(status) {
  let cls = "pill-grey";
  if (status === BAG_IN_PROCESS) cls = "pill-amber";
  if (status === BAG_AT_COUNTER) cls = "pill-green";
  return '<span class="pill ' + cls + '">' + status + "</span>";
}
 
function outcomePill(t) {
  let cls = "pill-amber";
  if (t.status === "completed") cls = "pill-green";
  if (t.status === "expired" || t.status === "cancelled") cls = "pill-red";
  return '<span class="pill ' + cls + '">' + txnOutcome(t) + "</span>";
}
 
function counterPill() {
  return db.counterOpen ? '<span class="pill pill-green">Counter OPEN</span>' : '<span class="pill pill-red">Counter CLOSED</span>';
}
 
function infoGrid(pairs) {
  return '<div class="info-grid">' + pairs.map(function (p) {
    return '<div><div class="info-label">' + p[0] + '</div><div class="info-value">' + p[1] + "</div></div>";
  }).join("") + "</div>";
}
 
function eventsHTML(events) {
  if (!events || events.length === 0) return "";
  return '<ul class="events">' + events.map(function (e) {
    const who = e.by && e.by !== "system" ? " - " + esc(e.by) : "";
    return "<li>" + esc(e.text) + '<span class="time">' + fmt(e.time) + who + "</span></li>";
  }).join("") + "</ul>";
}
 
function emptyHTML(message) { return '<div class="card empty">' + message + "</div>"; }
 
function countdownHTML(iso) { return '<span class="countdown" data-expires="' + iso + '"></span>'; }
 
function updateCountdowns() {
  document.querySelectorAll(".countdown").forEach(function (el) {
    const left = Date.parse(el.getAttribute("data-expires")) - Date.now();
    if (left <= 0) { el.textContent = "Expired"; return; }
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    el.textContent = m + ":" + (s < 10 ? "0" : "") + s;
  });
}
 
function drawQR(elId, text) {
  const box = $(elId);
  if (!box) return;
  box.innerHTML = "";
  if (typeof QRCode === "undefined") {
    box.innerHTML = '<div class="qr-fallback">The QR image could not load (no internet). Use the code below instead.</div>';
    return;
  }
  new QRCode(box, { text: text, width: 220, height: 220, colorDark: "#1d1a18", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
}
 
// ================= NAVIGATION =================
 
function buildSidebar() {
  let html = "";
  NAV[currentRole()].forEach(function (item) {
    html += '<button class="nav-item" data-page="' + item[0] + '">' + icon(item[2]) + "<span>" + item[1] + "</span></button>";
  });
  $("sidebar").innerHTML = html;
}
 
async function showPage(pageId, param) {
  currentPage = pageId;
  currentParam = param || "";
  document.querySelectorAll(".page").forEach(function (p) { p.classList.add("hidden"); });
  const el = $("page-" + pageId);
  if (!el) return;
  el.classList.remove("hidden");
  const navId = pageId === "w-verify" ? "w-dashboard" : pageId;
  document.querySelectorAll("#sidebar .nav-item").forEach(function (b) {
    b.classList.toggle("active", b.getAttribute("data-page") === navId);
  });
  $("sidebar").classList.remove("open");
  try {
    db = await loadData();
  } catch (err) {
    showToast(err && err.message ? err.message : "Cannot reach the laundry server.", true);
    return;
  }
  renderCurrent();
  window.scrollTo(0, 0);
}
 
function renderCurrent() {
  lastSig = "";
  const fn = renderers[currentPage];
  if (fn) fn(currentParam);
  updateBell();
  updateCountdowns();
}
 
function updateBell() {
  if (currentRole() !== "student") return;
  const user = currentUser();
  if (!user) return;
  const unread = db.notifications.filter(function (n) { return n.studentId === user.id && !n.read; }).length;
  $("bellCount").textContent = unread;
  $("bellCount").classList.toggle("hidden", unread === 0);
}
 
// ================= LOGIN / LOGOUT =================
 
function showLanding() {
  $("appArea").classList.add("hidden");
  $("publicArea").classList.remove("hidden");
  $("landing").classList.remove("hidden");
  $("loginScreen").classList.add("hidden");
  $("headerTools").classList.add("hidden");
  $("menuBtn").classList.add("hidden");
  $("profileMenu").classList.add("hidden");
  $("headerText").textContent = "Rishihood University, Sonipat";
  document.querySelector(".site-header").classList.remove("in-app");
  window.scrollTo(0, 0);
}
 
function openLogin(role) {
  loginRole = role;
  const info = ROLE_INFO[role];
  $("landing").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
  $("loginTitle").textContent = info.title;
  $("loginDesc").textContent = info.desc;
  $("loginIdLabel").textContent = info.idLabel;
  $("loginId").placeholder = info.idPlaceholder;
  $("loginId").value = "";
  $("loginPassword").value = "";
  $("loginPassword").type = "password";
  $("togglePw").textContent = "Show";
  $("loginError").textContent = "";
  $("loginFooter").textContent = info.footer;
  $("headerText").textContent = info.headerText;

  let rows = "";
  DEMO_ACCOUNTS[role].forEach(function (u) {
    rows += demoRow(u.id, u.password, u.name + (u.bag ? " (" + u.bag + ")" : ""));
  });
  $("demoList").innerHTML = rows;
  window.scrollTo(0, 0);
}

function demoRow(id, password, label) {
  return '<button class="demo-row" data-id="' + esc(id) + '" data-pw="' + esc(password) + '"><span>' + esc(label) + "</span><span>" + esc(id) + " / " + esc(password) + "</span></button>";
}

async function doLogin() {
  const id = $("loginId").value.trim();
  const pw = $("loginPassword").value;
  if (id === "" || pw === "") { $("loginError").textContent = "Please enter your ID and password."; return; }

  $("loginBtn").disabled = true;
  $("loginBtn").textContent = "Logging in...";
  try {
    const user = await api.login(loginRole, id, pw);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role: loginRole, id: user.id }));
  } catch (err) {
    $("loginError").textContent = err && err.message ? err.message : ROLE_INFO[loginRole].error;
    $("loginBtn").disabled = false;
    $("loginBtn").textContent = "Login";
    return;
  }
  $("loginBtn").disabled = false;
  $("loginBtn").textContent = "Login";
  startApp();
}

async function startApp() {
  try {
    db = await loadData();
  } catch (err) {
    showLanding();
    showToast(err && err.message ? err.message : "Cannot reach the laundry server.", true);
    return;
  }
  const user = currentUser();
  if (!user) { showLanding(); return; }
  const role = currentRole();
  $("publicArea").classList.add("hidden");
  $("appArea").classList.remove("hidden");
  $("headerTools").classList.remove("hidden");
  $("menuBtn").classList.remove("hidden");
  $("headerText").textContent = ROLE_INFO[role].headerText;
  document.querySelector(".site-header").classList.add("in-app");
  $("bellBtn").classList.toggle("hidden", role !== "student");
  $("avatarLetter").textContent = user.name.charAt(0);
  $("profileName").textContent = user.name;
  $("profileSub").textContent = role === "student" ? user.id + " - " + user.bag : user.id;
  buildSidebar();
  showPage(NAV[role][0][0]);
}
 
function confirmLogout() {
  $("profileMenu").classList.add("hidden");
  askConfirm({ title: "Logout?", text: "Do you want to logout?", yes: "Logout" }, function () {
    sessionStorage.removeItem(SESSION_KEY);
    showLanding();
  });
}
 
// ================= LIVE UPDATES (runs every second) =================

// The server is asked for the data again, so the screens stay up to date when
// somebody else (a worker, for example) does something.
let tickBusy = false;

async function tick() {
  if (!getSession() || tickBusy) return;
  tickBusy = true;
  try {
    const fresh = await loadData();
    const sig = JSON.stringify(fresh.transactions) + JSON.stringify(fresh.notifications) + JSON.stringify(fresh.activity);
    db = fresh;
    if (sig !== lastSig) {
      const el = document.activeElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
      if (!typing) renderCurrent();   // do not wipe what someone is typing
      lastSig = sig;
    }
    updateCountdowns();
    updateBell();
  } catch (err) {
    // The server is not reachable right now. The next tick tries again.
  } finally {
    tickBusy = false;
  }
}
 
// ================= START =================
 
function init() {
  document.querySelectorAll("[data-role]").forEach(function (el) {
    el.addEventListener("click", function () { openLogin(el.getAttribute("data-role")); });
  });
  $("backToPortals").addEventListener("click", showLanding);
  $("loginBtn").addEventListener("click", doLogin);
  $("loginPassword").addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
  $("loginId").addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
  $("togglePw").addEventListener("click", function () {
    const hidden = $("loginPassword").type === "password";
    $("loginPassword").type = hidden ? "text" : "password";
    $("togglePw").textContent = hidden ? "Hide" : "Show";
  });
  $("demoList").addEventListener("click", function (e) {
    const row = e.target.closest(".demo-row");
    if (!row) return;
    $("loginId").value = row.getAttribute("data-id");
    $("loginPassword").value = row.getAttribute("data-pw");
    $("loginError").textContent = "";
  });
  $("resetBtn").addEventListener("click", resetDemo);
 
  $("sidebar").addEventListener("click", function (e) {
    const btn = e.target.closest(".nav-item");
    if (btn) showPage(btn.getAttribute("data-page"));
  });
  $("menuBtn").addEventListener("click", function () { $("sidebar").classList.toggle("open"); });
  $("bellBtn").addEventListener("click", function () { showPage("s-notifications"); });
  $("profileBtn").addEventListener("click", function () { $("profileMenu").classList.toggle("hidden"); });
  $("logoutBtn").addEventListener("click", confirmLogout);
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".profile-wrap")) $("profileMenu").classList.add("hidden");
  });
 
  // any element with data-go="page-id" opens that page
  $("appArea").addEventListener("click", function (e) {
    const go = e.target.closest("[data-go]");
    if (go) showPage(go.getAttribute("data-go"), go.getAttribute("data-param") || "");
  });
 
  $("dialogYes").addEventListener("click", function () {
    $("dialogBox").classList.add("hidden");
    const cb = dialogCallback;
    dialogCallback = null;
    if (cb) cb();
  });
  $("dialogNo").addEventListener("click", function () {
    $("dialogBox").classList.add("hidden");
    dialogCallback = null;
  });
 
  window.addEventListener("storage", function () { tick(); });
  setInterval(tick, 1000);
 
  startApp();   // restores the session after a refresh
}
 
document.addEventListener("DOMContentLoaded", init);
 