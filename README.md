# RU Laundry System

The laundry system of Rishihood University, Sonipat. Three areas: the **student portal**,
the **worker application** and the **admin dashboard**.

All the data lives in the PostgreSQL database of the **backend** in
[`backend/`](backend/). This folder holds the frontend that talks to it.

## Run it

You need Node.js 22 or newer and PostgreSQL.

```bash
# 1. the backend (the database and the API)
cd backend
npm install
cp .env.example .env          # fill in QR_SECRET (the file explains how)
createdb ru_laundry
npm run db:setup              # creates the tables and the demo data
npm run dev                    # http://localhost:4000

# 2. the frontend (this folder)
cd ..
python3 -m http.server 5500   # any static server will do
```

Then open <http://localhost:5500>.

The backend only allows the frontend address that is written in `FRONTEND_URL` in
`backend/.env`. If you serve the frontend on a different port, change that value and
restart the backend.

### Demo accounts

| Area | ID | Password |
|---|---|---|
| Student | `RU2026CS001` (bag not given), `RU2026CS002` (in process), `RU2026CS003` (at the counter) | `ru@2026` |
| Worker | `W-001`, `W-002` | `worker@ru` |
| Admin | `admin` | `admin@ru` |

## How the frontend is put together

```
index.html      the page, with the three areas
style.css       how it looks
api.js          the only file that talks to the server
main.js         the server data, the sign in, the navigation, the rules of the three areas
student.js      the student portal
staff.js        the worker application and the admin dashboard
```

`api.js` is the one place that calls the server. It sends the token of the signed in role
with every request, so the server always knows who is asking. The screens never call
`fetch()` themselves, they use the functions in `api.js`.

Each area keeps its own sign in (in `sessionStorage`), so a student, a worker and an
administrator can be signed in at the same time in three tabs.

## The rules of the laundry

The server keeps them, not the browser:

- there are only three bag statuses: **Bag not given**, **Bag in process**, **Bag at counter**
- every student has one permanent bag, and it is never typed in by hand
- the reference photo of a student is private: only the student can read it
- scanning a QR code is not a handover; the worker has to confirm the bag
- every change to a bag is written to the history and nothing is ever deleted
- the counter has to be open before a student can give clothes or collect them

## The backend

Read [`backend/README.md`](backend/README.md) for the API and
[`backend/database/DATABASE.md`](backend/database/DATABASE.md) for the database.

The tests of the backend:

```bash
cd backend
createdb ru_laundry_test
npm test
```
