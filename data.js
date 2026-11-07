// data.js - SAMPLE DATA ONLY (no app logic here).
// Used the first time the site opens and when "Reset demo data" is clicked.
// Times are created relative to "now" so the demo always looks fresh.
 
function buildSampleData() {
  const now = Date.now();
  function ago(hours) { return new Date(now - hours * 3600000).toISOString(); }
  function later(hours) { return new Date(now + hours * 3600000).toISOString(); }
 
  const data = {
    counterOpen: true,
    settings: { urgentEnabled: true },
 
    students: [
      { id: "RU2026CS001", name: "Aarav Sharma", password: "ru@2026", bag: "B-001" },
      { id: "RU2026CS002", name: "Ananya Verma", password: "ru@2026", bag: "B-002" },
      { id: "RU2026CS003", name: "Ishaan Kumar", password: "ru@2026", bag: "B-003" }
    ],
 
    workers: [
      { id: "W-001", name: "Ramesh Yadav", password: "worker@ru" },
      { id: "W-002", name: "Sunita Devi", password: "worker@ru" }
    ],
 
    admins: [
      { id: "admin", name: "Dr. Priya Menon", password: "admin@ru" }
    ],
 
    bags: [],
    transactions: [],
    complaints: [],
    notifications: [],
    activity: []
  };
 
  // 10 bags: the first three belong to the sample students, the rest are free
  for (let i = 1; i <= 10; i++) {
    const number = "B-" + String(i).padStart(3, "0");
    const owner = data.students.find(function (s) { return s.bag === number; });
    data.bags.push({
      number: number, studentId: owner ? owner.id : null, status: "Bag not given",
      quantity: null, service: null, ironing: false, progress: null, dueAt: null,
      receivedAt: null, returnedAt: null, collectedAt: null,
      receivedBy: null, returnedBy: null, updatedBy: null, updatedAt: null
    });
  }
 
  // Ananya (B-002): regular laundry + ironing, received 20 hours ago, washing in progress
  data.transactions.push({
    id: "TX-SEED-1", type: "give", studentId: "RU2026CS002", bag: "B-002", quantity: 6, service: "regular", ironing: true,
    status: "completed", code: "G-SEED01", createdAt: ago(20.2), expiresAt: ago(20.0), completedAt: ago(20),
    workerId: "W-001", confirmedQuantity: 6, seen: true, giveTxnId: null,
    events: [
      { time: ago(20.2), text: "Give Clothes request created", by: "RU2026CS002" },
      { time: ago(20.2), text: "QR code generated", by: "RU2026CS002" },
      { time: ago(20), text: "Bag received by worker", by: "W-001" }
    ]
  });
  Object.assign(data.bags[1], {
    status: "Bag in process", quantity: 6, service: "regular", ironing: true, progress: "Washing in Progress",
    dueAt: later(52), receivedAt: ago(20), receivedBy: "W-001", updatedBy: "W-001", updatedAt: ago(18)
  });
 
  // Ishaan (B-003): one-day urgent, received 30 hours ago, now at the counter
  data.transactions.push({
    id: "TX-SEED-2", type: "give", studentId: "RU2026CS003", bag: "B-003", quantity: 4, service: "urgent", ironing: false,
    status: "completed", code: "G-SEED02", createdAt: ago(30.2), expiresAt: ago(30.0), completedAt: ago(30),
    workerId: "W-002", confirmedQuantity: 4, seen: true, giveTxnId: null,
    events: [
      { time: ago(30.2), text: "Give Clothes request created", by: "RU2026CS003" },
      { time: ago(30.2), text: "QR code generated", by: "RU2026CS003" },
      { time: ago(30), text: "Bag received by worker", by: "W-002" }
    ]
  });
  Object.assign(data.bags[2], {
    status: "Bag at counter", quantity: 4, service: "urgent", ironing: false, progress: null,
    dueAt: later(-6), receivedAt: ago(30), returnedAt: ago(2), receivedBy: "W-002", returnedBy: "W-002", updatedBy: "W-002", updatedAt: ago(2)
  });
 
  // Aarav (B-001): an older, finished round (received by W-002, handed back by W-001)
  data.transactions.push({
    id: "TX-SEED-3", type: "give", studentId: "RU2026CS001", bag: "B-001", quantity: 5, service: "regular", ironing: false,
    status: "completed", code: "G-SEED03", createdAt: ago(120.2), expiresAt: ago(120.0), completedAt: ago(120),
    workerId: "W-002", confirmedQuantity: 5, seen: true, giveTxnId: null,
    events: [
      { time: ago(120.2), text: "Give Clothes request created", by: "RU2026CS001" },
      { time: ago(120.2), text: "QR code generated", by: "RU2026CS001" },
      { time: ago(120), text: "Bag received by worker", by: "W-002" }
    ]
  });
  data.transactions.push({
    id: "TX-SEED-4", type: "take", studentId: "RU2026CS001", bag: "B-001", quantity: 5, service: "regular", ironing: false,
    status: "completed", code: "T-SEED04", createdAt: ago(50.3), expiresAt: ago(50.1), completedAt: ago(50),
    workerId: "W-001", handoverBy: "W-001", scannedAt: ago(50.2), studentVerifiedAt: ago(50.1), verifyExpiresAt: ago(50.0),
    seen: true, giveTxnId: "TX-SEED-3",
    events: [
      { time: ago(50.3), text: "Collection request created", by: "RU2026CS001" },
      { time: ago(50.2), text: "QR scanned by worker", by: "W-001" },
      { time: ago(50.1), text: "Student verified the collection", by: "RU2026CS001" },
      { time: ago(50), text: "Physical handover confirmed", by: "W-001" }
    ]
  });
  Object.assign(data.bags[0], {
    receivedAt: ago(120), returnedAt: ago(60), collectedAt: ago(50), receivedBy: "W-002", returnedBy: "W-002", updatedBy: "W-001", updatedAt: ago(50)
  });
 
  data.activity.push(
    { time: ago(2), text: "Bag returned to counter", studentId: "RU2026CS003", bag: "B-003", by: "W-002" },
    { time: ago(18), text: "Progress: Washing in Progress", studentId: "RU2026CS002", bag: "B-002", by: "W-001" },
    { time: ago(20), text: "Bag received by worker", studentId: "RU2026CS002", bag: "B-002", by: "W-001" },
    { time: ago(30), text: "Bag received by worker", studentId: "RU2026CS003", bag: "B-003", by: "W-002" },
    { time: ago(50), text: "Physical handover confirmed", studentId: "RU2026CS001", bag: "B-001", by: "W-001" },
    { time: ago(120), text: "Bag received by worker", studentId: "RU2026CS001", bag: "B-001", by: "W-002" }
  );
 
  data.notifications.push(
    { id: "N-SEED-1", studentId: "RU2026CS003", text: "Your clothes are ready for collection.", time: ago(2), read: false },
    { id: "N-SEED-2", studentId: "RU2026CS002", text: "Your laundry update: Washing in Progress.", time: ago(18), read: false }
  );
 
  data.complaints.push(
    {
      id: "C-1000", studentId: "RU2026CS001", bag: "B-001", txnId: "TX-SEED-4", category: "Wrong bag received",
      description: "I think I was given a bag with one extra shirt that is not mine.",
      status: "Resolved", createdAt: ago(48), updatedAt: ago(30), resolvedAt: ago(30), resolvedBy: "admin", handledBy: "admin",
      updates: [
        { time: ago(48), by: "RU2026CS001", text: "Complaint submitted", status: "Open" },
        { time: ago(30), by: "admin", text: "We found the owner of the extra shirt and fixed the record. Sorry for the trouble.", status: "Resolved" }
      ]
    },
    {
      id: "C-1001", studentId: "RU2026CS003", bag: "B-003", txnId: "TX-SEED-2", category: "Incorrect quantity",
      description: "I gave 5 clothes but the record says 4.",
      status: "Under review", createdAt: ago(5), updatedAt: ago(3), handledBy: "admin",
      updates: [
        { time: ago(5), by: "RU2026CS003", text: "Complaint submitted", status: "Open" },
        { time: ago(3), by: "admin", text: "We are checking with the laundry team.", status: "Under review" }
      ]
    }
  );
 
  return data;
}
 