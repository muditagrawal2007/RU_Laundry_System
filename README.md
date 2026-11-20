# RU Laundry System

The laundry system of Rishihood University, Sonipat. Three areas: the **student portal**,
the **worker application** and the **admin dashboard**.

All the data lives in the PostgreSQL database of the **backend** in
[`backend/`](backend/). The page that talks to it is in [`frontend/`](frontend/).

## Repository layout

```
frontend/     the page (HTML, CSS, JavaScript), served by the backend
backend/      the API, the database scripts and the tests
docs/         the database guide and the frontend guide
render.yaml   the Render hosting blueprint
```

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

```

The backend sends the frontend out as well, so the whole app is on
<http://localhost:4000>. That is the easiest way to work on it.

To work on the frontend with a live reload, serve it yourself as well:

```bash
cd frontend
python3 -m http.server 5500   # then open http://localhost:5500
```

The backend only allows the frontend addresses that are written in
`FRONTEND_URL` in `backend/.env`. If you serve the frontend on a different port,
add that address there and restart the backend.

## Host it on Render (free)

The page and the API are one service, so the hosted app gets one address.

1. **The database.** Make a free PostgreSQL at <https://neon.com> (sign up, then
   "New project", then copy the connection string). The free Render Postgres
   works too, but it is deleted 30 days after it is made.
2. **The service.** In the [Render dashboard](https://dashboard.render.com) pick
   "New" -> "Blueprint", choose this repository and apply it. Render asks for
   the `DATABASE_URL` (the connection string from step 1) and fills in the rest
   itself: the QR secret, the Node version and the region.
3. **The data.** The server creates the tables and loads the demo data by itself
   the first time it starts on an empty database. A database that already has
   tables is never touched. To wipe it and start again by hand:
   ```bash
   cd backend
   DATABASE_URL="<the connection string>" npm run db:setup
   ```
4. **The address.** Render shows the address of the service at the top of its
   page, for example `https://ru-laundry.onrender.com`. Open it and sign in.

The free service sleeps after 15 minutes without traffic, so the first request
after a pause takes about a minute. `ALLOW_DEMO_RESET` is on for the demo
server, so an admin can wipe the demo data with the "reset demo" button.

### Demo accounts

| Area | ID | Password |
|---|---|---|
| Student | `RU2026CS001` (bag not given), `RU2026CS002` (in process), `RU2026CS003` (at the counter) | `ru@2026` |
| Worker | `W-001`, `W-002` | `worker@ru` |
| Admin | `admin` | `admin@ru` |

## How the frontend is put together

```
frontend/
  index.html      the page, with the three areas
  css/style.css   how it looks
  assets/logo.png the university logo
  js/
    api.js        the only file that talks to the server
    main.js       the server data, the sign in, the navigation, the rules of the three areas
    student.js    the student portal
    staff.js      the worker application and the admin dashboard
```

`api.js` is the one place that calls the server. It sends the token of the signed in role
with every request, so the server always knows who is asking. The screens never call
`fetch()` themselves, they use the functions in `api.js`.

`api.js` asks the API on the same address as the page. When the page is served by
another address (the `python3 -m http.server 5500` way of working), it asks
`http://localhost:4000/api` instead.

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
[`docs/DATABASE.md`](docs/DATABASE.md) for the database. The frontend guide is
[`docs/FOR_FRONTEND.md`](docs/FOR_FRONTEND.md).

The tests of the backend:

```bash
cd backend
createdb ru_laundry_test
npm test
```
