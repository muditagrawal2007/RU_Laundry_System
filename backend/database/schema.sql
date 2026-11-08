-- schema.sql
-- ----------
-- Every table of the RU Laundry System.
-- Run it with:  npm run db:setup   (it also loads the demo data)
--
-- Running this file again deletes everything and starts fresh.

DROP TABLE IF EXISTS sessions, notifications, complaint_updates, complaints, activity,
  take_requests, give_requests, photos, bags, users, counter_state, counter_schedule,
  counter_closures, settings CASCADE;
DROP SEQUENCE IF EXISTS complaint_number;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

-- One row per person. The id is what they type on the login screen:
--   student -> "RU2026CS001", worker -> "W-001", admin -> "admin"
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  role          TEXT NOT NULL CHECK (role IN ('STUDENT', 'WORKER', 'ADMIN')),
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A signed in user. The frontend sends the token with every request.
-- Only the SHA-256 hash of the token is stored, never the token itself.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------------------
-- Bags
-- ---------------------------------------------------------------------------

-- One permanent bag per student (student_id is UNIQUE).
-- Only three statuses exist. There is no washing / drying / ironing.
CREATE TABLE bags (
  bag_number   TEXT PRIMARY KEY,
  student_id   TEXT NOT NULL UNIQUE REFERENCES users(id),
  status       TEXT NOT NULL DEFAULT 'NOT_GIVEN'
               CHECK (status IN ('NOT_GIVEN', 'IN_PROCESS', 'AT_COUNTER')),
  quantity     INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  -- Which service the student chose. "ironing" means ironing only, no washing.
  service      TEXT NOT NULL DEFAULT 'regular'
               CHECK (service IN ('regular', 'urgent', 'ironing')),
  -- True when the student wants the clothes ironed as well.
  ironing      BOOLEAN NOT NULL DEFAULT false,
  -- The step the bag is at while it is being washed ("Washing in Progress").
  progress     TEXT,
  -- When the clothes should be ready at the counter.
  due_at       TIMESTAMPTZ,
  received_at  TIMESTAMPTZ,
  returned_at  TIMESTAMPTZ,
  collected_at TIMESTAMPTZ,
  received_by  TEXT REFERENCES users(id),
  returned_by  TEXT REFERENCES users(id),
  updated_by   TEXT NOT NULL DEFAULT 'System',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Photos uploaded by students, kept as data URLs ("data:image/jpeg;base64,...").
--   REFERENCE           -> private. Only the student who uploaded it can read it.
--   COMPLAINT_EVIDENCE  -> the student and the admins can read it.
CREATE TABLE photos (
  id         TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL CHECK (kind IN ('REFERENCE', 'COMPLAINT_EVIDENCE')),
  data_url   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Give Clothes and Take Clothes requests
-- ---------------------------------------------------------------------------

-- "I am giving my clothes." Created by the student, verified by a worker.
CREATE TABLE give_requests (
  id                 TEXT PRIMARY KEY,
  student_id         TEXT NOT NULL REFERENCES users(id),
  student_name       TEXT NOT NULL,
  bag_number         TEXT NOT NULL REFERENCES bags(bag_number),
  quantity           INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 15),
  photo_id           TEXT REFERENCES photos(id),
  -- Which service the student chose.
  service            TEXT NOT NULL DEFAULT 'regular'
                     CHECK (service IN ('regular', 'urgent', 'ironing')),
  ironing            BOOLEAN NOT NULL DEFAULT false,
  -- The short code the student shows and the worker types in.
  code               TEXT UNIQUE,
  -- True once the student has seen the result of this request.
  seen               BOOLEAN NOT NULL DEFAULT false,
  status             TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING', 'RECEIVED', 'EXPIRED', 'CANCELLED')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  qr_expires_at      TIMESTAMPTZ NOT NULL,
  scanned_at         TIMESTAMPTZ,
  worker_id          TEXT REFERENCES users(id),
  confirmed_quantity INTEGER CHECK (confirmed_quantity >= 0),
  received_at        TIMESTAMPTZ
);

-- "I want to collect my clothes."
-- PENDING -> SCANNED (worker scanned) -> VERIFIED (student checked) -> COMPLETED (handed over)
CREATE TABLE take_requests (
  id                  TEXT PRIMARY KEY,
  student_id          TEXT NOT NULL REFERENCES users(id),
  student_name        TEXT NOT NULL,
  bag_number          TEXT NOT NULL REFERENCES bags(bag_number),
  quantity            INTEGER NOT NULL DEFAULT 0,
  -- Which service the student chose.
  service             TEXT NOT NULL DEFAULT 'regular'
                      CHECK (service IN ('regular', 'urgent', 'ironing')),
  ironing             BOOLEAN NOT NULL DEFAULT false,
  -- The short code the student shows and the worker types in.
  code                TEXT UNIQUE,
  -- True once the student has seen the result of this request.
  seen                BOOLEAN NOT NULL DEFAULT false,
  -- The submission this collection belongs to.
  give_request_id     TEXT REFERENCES give_requests(id),
  status              TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'SCANNED', 'VERIFIED', 'COMPLETED', 'EXPIRED', 'CANCELLED')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  qr_expires_at       TIMESTAMPTZ NOT NULL,
  session_expires_at  TIMESTAMPTZ,
  worker_id           TEXT REFERENCES users(id),
  scanned_at          TIMESTAMPTZ,
  student_verified_at TIMESTAMPTZ,
  handed_over_at      TIMESTAMPTZ,
  handover_by         TEXT REFERENCES users(id)
);

-- A student can only have ONE open give request and ONE open take request at a time.
CREATE UNIQUE INDEX one_open_give_per_student ON give_requests (student_id)
  WHERE status = 'PENDING';
CREATE UNIQUE INDEX one_open_take_per_student ON take_requests (student_id)
  WHERE status IN ('PENDING', 'SCANNED', 'VERIFIED');

-- A student's history, already sorted by time.
CREATE INDEX give_requests_by_student ON give_requests (student_id, created_at);
CREATE INDEX take_requests_by_student ON take_requests (student_id, created_at);

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

-- Always exactly one row (id = 1).
CREATE TABLE settings (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  -- False when the one-day urgent service is switched off.
  urgent_enabled  BOOLEAN NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------------
-- Activity history (the audit log)
-- ---------------------------------------------------------------------------

-- Every change to a bag is written here. Rows are never changed or deleted.
-- Names are copied in on purpose: the history must show who it was at the time.
CREATE TABLE activity (
  id           BIGSERIAL PRIMARY KEY,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  action       TEXT NOT NULL,
  actor_name   TEXT NOT NULL,
  actor_role   TEXT NOT NULL CHECK (actor_role IN ('STUDENT', 'WORKER', 'ADMIN', 'SYSTEM')),
  student_id   TEXT NOT NULL,          -- "-" for counter events
  student_name TEXT NOT NULL,
  bag_number   TEXT NOT NULL,
  from_status  TEXT,
  to_status    TEXT,
  reason       TEXT,
  result       TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('GIVE', 'TAKE', 'BAG', 'COMPLAINT', 'COUNTER')),
  ref_type     TEXT CHECK (ref_type IN ('give', 'take', 'complaint')),
  ref_id       TEXT
);

-- The database itself refuses to change or delete history.
CREATE RULE activity_no_update AS ON UPDATE TO activity DO INSTEAD NOTHING;
CREATE RULE activity_no_delete AS ON DELETE TO activity DO INSTEAD NOTHING;

CREATE INDEX activity_by_student ON activity (student_id, at);
CREATE INDEX activity_by_time ON activity (at);
CREATE INDEX activity_by_bag ON activity (bag_number);
CREATE INDEX activity_by_ref ON activity (ref_type, ref_id);

-- ---------------------------------------------------------------------------
-- Complaints (their statuses are separate from the bag statuses)
-- ---------------------------------------------------------------------------

-- Gives the number part of "CMP-2026-0001".
CREATE SEQUENCE complaint_number;

CREATE TABLE complaints (
  ref               TEXT PRIMARY KEY,
  student_id        TEXT NOT NULL REFERENCES users(id),
  student_name      TEXT NOT NULL,
  bag_number        TEXT NOT NULL,
  transaction_id    TEXT,
  transaction_label TEXT,
  evidence_id       TEXT REFERENCES photos(id),
  category          TEXT NOT NULL CHECK (category IN ('MISSING_CLOTHES', 'DAMAGED_CLOTHES',
                      'INCORRECT_QUANTITY', 'WRONG_BAG', 'DELAY', 'OTHER')),
  description       TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'SUBMITTED'
                    CHECK (status IN ('SUBMITTED', 'IN_REVIEW', 'IN_PROGRESS', 'RESOLVED')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_to       TEXT,
  resolution        TEXT,
  resolved_at       TIMESTAMPTZ
);

CREATE INDEX complaints_by_student ON complaints (student_id, created_at);

-- Every reply written on a complaint. Nothing is ever deleted.
CREATE TABLE complaint_updates (
  id            BIGSERIAL PRIMARY KEY,
  complaint_ref TEXT NOT NULL REFERENCES complaints(ref),
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  author_name   TEXT NOT NULL,
  author_role   TEXT NOT NULL CHECK (author_role IN ('STUDENT', 'WORKER', 'ADMIN')),
  body          TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Notifications (the student's bell)
-- ---------------------------------------------------------------------------

CREATE TABLE notifications (
  id         BIGSERIAL PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES users(id),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  link       TEXT,
  read       BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX notifications_by_student ON notifications (student_id, at);

-- ---------------------------------------------------------------------------
-- The laundry counter
-- ---------------------------------------------------------------------------

-- Exactly one row (id = 1).
-- manual_state: 'OPEN' / 'CLOSED' when an admin pressed the button,
--               NULL when the weekly schedule decides.
CREATE TABLE counter_state (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  manual_state TEXT CHECK (manual_state IN ('OPEN', 'CLOSED')),
  opened_at    TIMESTAMPTZ,
  closed_at    TIMESTAMPTZ,
  updated_by   TEXT NOT NULL DEFAULT 'System'
);

-- One row per day of the week. Times look like "08:00".
CREATE TABLE counter_schedule (
  day        TEXT PRIMARY KEY CHECK (day IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday',
               'Friday', 'Saturday', 'Sunday')),
  sort_order INTEGER NOT NULL,
  is_open    BOOLEAN NOT NULL,
  open_time  TEXT NOT NULL,
  close_time TEXT NOT NULL
);

-- Holidays (the whole day) and temporary closures (from start_time to end_time).
CREATE TABLE counter_closures (
  id         BIGSERIAL PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN ('HOLIDAY', 'TEMPORARY')),
  date       TEXT NOT NULL,            -- "2026-11-02"
  start_time TEXT,
  end_time   TEXT,
  reason     TEXT NOT NULL
);
