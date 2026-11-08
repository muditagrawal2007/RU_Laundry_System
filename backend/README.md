# RU Laundry System: backend

The REST API and the database for the RU Laundry System (the
[laundry-system2](https://github.com/muditagrawal2007/laundry-system2) frontend).

It is kept as simple as possible:

- **Node.js + Express**: plain JavaScript, no TypeScript, no build step
- **PostgreSQL** with plain SQL through the `pg` package (no ORM)
- **bcryptjs** for passwords

## Run it

You need Node.js 22 or newer and PostgreSQL.

```bash
cd backend
npm install
cp .env.example .env        # then fill in QR_SECRET (see the comment in the file)
createdb ru_laundry
npm run db:setup            # tables + demo data
npm run dev                 # http://localhost:4000
```

Check that it is running: <http://localhost:4000/api/health>

### Demo accounts

| Area | ID | Password |
|---|---|---|
| Student | `RU2026CS001` (bag not given), `RU2026CS002` (in process), `RU2026CS003` (at counter) | `ru@2026` |
| Worker | `W-001`, `W-002` | `worker@ru` |
| Admin | `admin` | `admin@ru` |

### Tests

```bash
createdb ru_laundry_test    # once
npm test                    # wipes ru_laundry_test and runs every test
```

To use another test database, set `TEST_DATABASE_URL` before running `npm test`.

## The files

```
backend/
  database/
    schema.sql       every table (read DATABASE.md first)
    seed.js          the demo data
    reset.js         wipe + create tables + demo data
    setup.js         npm run db:setup
    DATABASE.md      the database requirements
  src/
    server.js        starts the API
    app.js           Express settings and the four route groups
    config.js        settings from .env and the time limits
    db.js            query() and queryOne()
    errors.js        ApiError and the error answer
    auth.js          login, sessions, requireRole()
    qr.js            signed QR codes (HMAC-SHA256)
    counter.js       is the counter open right now?
    expire.js        marks old QR codes as expired
    activity.js      history lines and notifications
    bags.js          reading bags with the student's name
    history.js       give/take requests -> history rows
    complaints.js    complaints with their replies
    photos.js        saving an uploaded photo
    filters.js       search, filter and sort for the list screens
    time.js          dates in the counter's time zone
    routes/
      auth.js        /api/auth/...
      student.js     /api/student/...
      worker.js      /api/worker/...
      admin.js       /api/admin/...
  tests/
```

## How the frontend talks to it

1. **Sign in**: `POST /api/auth/login` with `{ portal, identifier, password }`.
   The answer is `{ token, user }`. Keep the token in `localStorage`, one key per role
   (`ru_laundry_session_student`, `..._worker`, `..._admin`), the same as the demo does now.
2. **Every other call** sends the token:
   ```
   Authorization: Bearer <token>
   ```
3. **Errors** come back as `{ "error": "message to show" }` with a 4xx or 5xx status.
   Throw `new ApiError(body.error)` in the frontend so the screens keep working.

The student, worker or admin is always taken from the token, so the frontend no longer
sends `studentId` or `workerId` itself.

### From `src/lib/api.ts` to the backend

Every function in the frontend's `api.ts` already names its endpoint. They all exist here:

| `api.ts` function | Endpoint |
|---|---|
| `login` / `logout` / `getLoggedInUser` | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session` |
| `getStudentDashboard` | `GET /api/student/dashboard` |
| `createGiveRequest` / `getGiveRequest` | `POST /api/student/give-requests`, `GET /api/student/give-requests/:id` |
| `getGiveQr` / `renewGiveQr` | `GET /api/student/give-requests/:id/qr`, `POST .../qr/renew` |
| `createTakeRequest` / `getTakeRequest` / `getTakeQr` | `POST /api/student/take-requests`, `GET .../:id`, `GET .../:id/qr` |
| `verifyTakeRequest` | `POST /api/student/take-requests/:id/verify` |
| `getStudentHistory` / `getHistoryDetail` / `getStudentTransactions` | `GET /api/student/history`, `GET /api/student/history/:type/:id`, `GET /api/student/transactions` |
| `getStudentPhoto` | `GET /api/student/photos/:photoId` → `{ dataUrl }` |
| `getStudentComplaints` / `getStudentComplaint` / `createComplaint` | `GET`/`POST /api/student/complaints`, `GET /api/student/complaints/:ref` |
| `getComplaintEvidence` (student screen) | `GET /api/student/complaints/:ref/evidence` → `{ dataUrl }` |
| `getStudentNotifications` / `markNotificationRead` | `GET /api/student/notifications`, `POST /api/student/notifications/:id/read` |
| `getStudentProfile` | `GET /api/student/profile` |
| `cancelRequest` | `POST /api/student/give-requests/:id/cancel`, `POST /api/student/take-requests/:id/cancel` |
| `acknowledgeResults` | `POST /api/student/acknowledge` |
| `loadStudentPhotos` | `GET /api/student/photos` → `{ "<submission id>": "data:..." }` |
| `getWorkerDashboard` | `GET /api/worker/dashboard` |
| `scanQrCode` | `POST /api/worker/qr/scan` with `{ text }` |
| `verifyGiveRequest` / `returnBagToCounter` | `POST /api/worker/give-requests/:id/verify`, `POST .../:id/return-to-counter` |
| `scanTakeRequest` / `confirmHandover` | `POST /api/worker/take-requests/:id/scan`, `POST .../:id/handover` |
| `manualHandover` / `correctStatus` | `POST /api/worker/manual-handover`, `POST /api/worker/status-corrections` |
| `getWorkerGiveRequests` / `getWorkerTakeRequests` / `getWorkerActivity` / `searchStudents` | `GET /api/worker/give-requests`, `/take-requests`, `/activity`, `/students?q=` |
| `getWorkerGiveRequest` / `getWorkerTakeRequest` | `GET /api/worker/give-requests/:id`, `GET /api/worker/take-requests/:id` |
| `setProgress` | `POST /api/worker/bags/:bagNumber/progress` with `{ progress }` |
| `getAdminDashboard` | `GET /api/admin/dashboard` |
| `openCounter` / `closeCounter` | `POST /api/admin/counter/open`, `POST /api/admin/counter/close` |
| `getCounterSettings` / `saveCounterSchedule` / `addClosure` | `GET /api/admin/counter/settings`, `PUT /api/admin/counter/schedule`, `POST /api/admin/counter/closures` |
| `setCounterToSchedule` | `POST /api/admin/counter/auto` |
| `removeClosure` | `DELETE /api/admin/counter/closures/:id` |
| `getUrgentService` / `setUrgentService` | `GET /api/admin/settings`, `PUT /api/admin/settings` with `{ urgentEnabled }` |
| `getBags` / `getBagDetail` | `GET /api/admin/bags`, `GET /api/admin/bags/:bagNumber` |
| `getAssignments` / `getAvailableBags` / `assignBag` | `GET /api/admin/assignments`, `GET /api/admin/available-bags`, `POST /api/admin/assignments` |
| `getAllHistory` / `getAdminHistoryDetail` | `GET /api/admin/history?tab=give\|take\|activity`, `GET /api/admin/history/:type/:id` |
| `getAdminStudents` / `getStudentRecord` | `GET /api/admin/students`, `GET /api/admin/students/:studentId` |
| `getAllComplaints` / `getComplaintDetail` / `updateComplaint` | `GET /api/admin/complaints`, `GET`/`PATCH /api/admin/complaints/:ref` |
| `getComplaintEvidence` (admin screen) | `GET /api/admin/complaints/:ref/evidence` → `{ dataUrl }` |
| `getAudit` / `getReports` / `exportReportsCsv` | `GET /api/admin/audit`, `GET /api/admin/reports`, `GET /api/admin/reports/export.csv` |
| `resetDemoData` | `POST /api/admin/reset-demo` (only when `ALLOW_DEMO_RESET=true`) |

Extra endpoints the demo did not have: `POST /api/admin/counter/auto` (let the weekly schedule
decide again), `DELETE /api/admin/counter/closures/:id`, `POST /api/admin/students` and
`POST /api/admin/workers` (add accounts).

## What is different from the browser demo

These fix small problems in the demo's `fake-db.ts`:

- The counter really checks the **opening hours** and the **times of a temporary closure**,
  in the counter's time zone (`TIMEZONE`, default `Asia/Kolkata`). The demo only checked the day.
- A renewed Give QR code can be scanned again (the demo kept the old "scanned" mark).
- A manual handover writes the bag's real old status into the history, and closes any open
  collection request.
- A status correction closes open requests that were made for the old status.
- A student can only mark **their own** notifications as read.
- The expired-submission notification says "submission QR", not "collection QR".
- Workers never receive the `photoId` of a reference photo.
- The report's average times are measured from the history of each bag, not only from its last cycle.
