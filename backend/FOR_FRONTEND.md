# How the frontend talks to this backend

This is the short version for whoever is building the frontend. The full list of endpoints is in
[`README.md`](README.md).

## 1. The address

The API runs on **http://localhost:4000** and everything lives under `/api`.

```bash
cd backend
npm install
cp .env.example .env       # fill in QR_SECRET (see the file)
createdb ru_laundry
npm run db:setup           # creates the tables and the demo data
npm run dev
```

Check it is alive: <http://localhost:4000/api/health> should answer `{"ok":true}`.

Put the address in one place in the frontend, for example:

```ts
// src/lib/config.ts
export const API_URL = "http://localhost:4000/api";
```

## 2. Sign in

```http
POST /api/auth/login
Content-Type: application/json

{ "portal": "student", "identifier": "RU2026CS001", "password": "ru@2026" }
```

`portal` is `"student"`, `"worker"` or `"admin"`. The answer is:

```json
{
  "token": "64 random characters",
  "user": { "id": "RU2026CS001", "role": "STUDENT", "name": "Aarav Sharma", "studentId": "RU2026CS001", "bagNumber": "B-001" }
}
```

**Keep the token.** Send it with every other request in the `Authorization` header:

```http
Authorization: Bearer <token>
```

Each role gets its own key in `localStorage`, so a student, a worker and an admin can be signed
in at the same time in one browser (this is what the demo does, and the Playwright test needs it):

```ts
const key = `ru_laundry_session_${role.toLowerCase()}`;   // student | worker | admin
localStorage.setItem(key, token);
```

To find out who is signed in later, call `GET /api/auth/session`. It answers
`{ "user": {...} }`, or `{ "user": null }` when nobody is signed in.

To sign out: `POST /api/auth/logout`.

## 3. A small fetch helper

Put this in `src/lib/api.ts` and build every call on it:

```ts
const API_URL = "http://localhost:4000/api";

export class ApiError extends Error {}

/** Calls the API and throws ApiError with the message the server sent. */
async function request(method: string, path: string, role?: "STUDENT" | "WORKER" | "ADMIN", body?: unknown) {
  const token = role ? localStorage.getItem(`ru_laundry_session_${role.toLowerCase()}`) : null;
  const response = await fetch(API_URL + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error || "Something went wrong. Please try again.");
  return data;
}
```

Then each function in `api.ts` becomes one line. For example, `getStudentDashboard`:

```ts
// before: the answer came from fake-db.ts
// after:
export async function getStudentDashboard(): Promise<StudentDashboard> {
  return request("GET", "/student/dashboard", "STUDENT");
}
```

**The student, worker or admin is never sent by the frontend.** The server takes it from the
token, so a student cannot read another student's data by changing a value in the request.
That means every function that used to take a `studentId` or `workerId` argument now takes
nothing:

| Before (demo) | Now |
|---|---|
| `getStudentDashboard(studentId)` | `getStudentDashboard()` |
| `createGiveRequest(studentId, input)` | `createGiveRequest(input)` |
| `verifyGiveRequest(workerId, id, qty)` | `verifyGiveRequest(id, qty)` |
| `scanQrCode(workerId, text)` | `scanQrCode(text)` |
| `getStudentComplaints(studentId, filters)` | `getStudentComplaints(filters)` |
| `getAllComplaints(filters)` (admin) | `getAllComplaints(filters)` |

The screens themselves do not need to change. Only `api.ts` does.

## 4. Errors

Every failure comes back the same way:

```json
{ "error": "Your bag is not ready for collection yet." }
```

with a 4xx or 5xx status. So in the screens:

```ts
try {
  await createGiveRequest({ quantity: 5 });
} catch (error) {
  if (error instanceof ApiError) showMessage(error.message);   // the exact text to show
}
```

The messages are written for students, so they can be shown as they are.

## 5. Two answers that changed shape

These two used to return a plain string and now return an object:

| Function | Before | Now |
|---|---|---|
| `getStudentPhoto` | a data URL string | `{ dataUrl: "data:image/png;base64,..." }` |
| `getComplaintEvidence` | a data URL string | `{ dataUrl: "data:image/png;base64,..." }` |

So the screen that shows the photo changes from:

```ts
const photo = await getStudentPhoto(studentId, photoId);   // string
```
to:
```ts
const { dataUrl: photo } = await getStudentPhoto(photoId);
```

## 6. The endpoints, area by area

The full table with the body of each call is in [`README.md`](README.md). The short version:

### Auth
| Method | Path | Body |
|---|---|---|
| POST | `/api/auth/login` | `{ portal, identifier, password }` |
| POST | `/api/auth/logout` | – |
| GET | `/api/auth/session` | – |

### Student (`Authorization` header with the student token)
| Method | Path | Body |
|---|---|---|
| GET | `/api/student/dashboard` | – |
| POST | `/api/student/give-requests` | `{ quantity, photoDataUrl? }` |
| GET | `/api/student/give-requests/:id` | – |
| GET | `/api/student/give-requests/:id/qr` | – |
| POST | `/api/student/give-requests/:id/qr/renew` | – |
| POST | `/api/student/take-requests` | – |
| GET | `/api/student/take-requests/:id` | – |
| GET | `/api/student/take-requests/:id/qr` | – |
| POST | `/api/student/take-requests/:id/verify` | – |
| GET | `/api/student/history` | `?search&type&dateFrom&dateTo&sort` |
| GET | `/api/student/history/:type/:id` | – |
| GET | `/api/student/transactions` | – |
| GET | `/api/student/photos/:photoId` | – |
| GET | `/api/student/complaints` | `?search&category&status&dateFrom&dateTo&sort` |
| POST | `/api/student/complaints` | `{ category, description, transactionId?, transactionLabel?, evidenceDataUrl? }` |
| GET | `/api/student/complaints/:ref` | – |
| GET | `/api/student/complaints/:ref/evidence` | – |
| GET | `/api/student/notifications` | – |
| POST | `/api/student/notifications/:id/read` | – |
| GET | `/api/student/profile` | – |

### Worker (worker token)
| Method | Path | Body |
|---|---|---|
| GET | `/api/worker/dashboard` | – |
| POST | `/api/worker/qr/scan` | `{ text }` (the text of the QR code) |
| POST | `/api/worker/give-requests/:id/verify` | `{ confirmedQuantity? }` |
| POST | `/api/worker/give-requests/:id/return-to-counter` | – |
| POST | `/api/worker/take-requests/:id/scan` | – |
| POST | `/api/worker/take-requests/:id/handover` | – |
| POST | `/api/worker/manual-handover` | `{ studentId, reason }` |
| POST | `/api/worker/status-corrections` | `{ studentId, toStatus, reason }` |
| GET | `/api/worker/give-requests` | `?search&outcome&dateFrom&dateTo&sort` |
| GET | `/api/worker/take-requests` | `?search&outcome&dateFrom&dateTo&sort` |
| GET | `/api/worker/activity` | `?search&action&dateFrom&dateTo` |
| GET | `/api/worker/students` | `?q=` |

### Admin (admin token)
| Method | Path | Body |
|---|---|---|
| GET | `/api/admin/dashboard` | – |
| POST | `/api/admin/counter/open` | – |
| POST | `/api/admin/counter/close` | – |
| POST | `/api/admin/counter/auto` | – |
| GET | `/api/admin/counter/settings` | – |
| PUT | `/api/admin/counter/schedule` | `[{ day, isOpen, openTime, closeTime }]` |
| POST | `/api/admin/counter/closures` | `{ type, date, startTime?, endTime?, reason }` |
| DELETE | `/api/admin/counter/closures/:id` | – |
| GET | `/api/admin/bags` | `?search&status&dateFrom&dateTo&sort` |
| GET | `/api/admin/bags/:bagNumber` | – |
| GET | `/api/admin/assignments` | – |
| GET | `/api/admin/available-bags` | – |
| POST | `/api/admin/assignments` | `{ studentId, bagNumber }` |
| GET | `/api/admin/history` | `?tab=give\|take\|activity&search&worker&result&dateFrom&dateTo&sort` |
| GET | `/api/admin/history/:type/:id` | – |
| GET | `/api/admin/students` | – |
| POST | `/api/admin/students` | `{ studentId, name, password }` |
| GET | `/api/admin/students/:studentId` | – |
| POST | `/api/admin/workers` | `{ workerId, name, password }` |
| GET | `/api/admin/complaints` | `?search&category&status&assignedTo&dateFrom&dateTo&sort` |
| GET | `/api/admin/complaints/:ref` | – |
| PATCH | `/api/admin/complaints/:ref` | `{ status?, assignedTo?, response?, resolution? }` |
| GET | `/api/admin/complaints/:ref/evidence` | – |
| GET | `/api/admin/audit` | `?search&action&worker&dateFrom&dateTo` |
| GET | `/api/admin/reports` | `?dateFrom&dateTo` |
| GET | `/api/admin/reports/export.csv` | – |
| POST | `/api/admin/reset-demo` | – (answers 403 unless the server sets `ALLOW_DEMO_RESET=true`) |

## 7. The QR codes

The server makes the QR text, not the frontend. When the student creates a request, the answer
already contains it:

```json
{
  "request": { "id": "give-...", "status": "PENDING", "qrExpiresAt": "2026-11-07T09:12:00.000Z" },
  "qrText": "RU1.eyJraW5kIjoiZ2l2ZSIs....",
  "qrExpiresAt": "2026-11-07T09:12:00.000Z"
}
```

So the frontend draws `qrText` as a QR code and shows `qrExpiresAt` as the countdown. The worker
sends the scanned text to `POST /api/worker/qr/scan`.

The text is signed by the server with a secret that never leaves it, so a fake code is refused.

## 8. The polling

The student screen waits for the worker to scan. The demo polls; keep that:

```ts
usePoll(() => getStudentDashboard(), 3000);   // every 3 seconds
```

The server marks a QR code as expired when its time is up, so an expired code is never
accepted, even if it is scanned a minute late.

## 9. Demo accounts

| Area | ID | Password |
|---|---|---|
| Student | `RU2026CS001` (bag not given), `RU2026CS002` (in process), `RU2026CS003` (at counter) | `ru@2026` |
| Worker | `W-001`, `W-002` | `worker@ru` |
| Admin | `admin` | `admin@ru` |

## 10. If the frontend cannot reach the backend

The browser blocks a call from `http://localhost:3000` to `http://localhost:4000` if the
server does not say which addresses are allowed. It already does, through `FRONTEND_URL` in
`.env`. If the frontend runs on a different port, change that value and restart the server.

To see what the server answered, open the browser's network tab. Every answer is JSON.
