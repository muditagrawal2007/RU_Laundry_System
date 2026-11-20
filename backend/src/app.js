// app.js
// ------
// Builds the Express app: settings, then the routes of each area.
//
//   /api/auth/...     login, logout, who am I
//   /api/student/...  the student portal   (students only)
//   /api/worker/...   the worker app       (workers only)
//   /api/admin/...    the admin dashboard  (admins only)

import express from "express";
import cors from "cors";
import { FRONTEND_URLS } from "./config.js";
import { handleErrors } from "./errors.js";
import { expireOldRequests } from "./expire.js";
import { serveFrontend } from "./frontend.js";
import authRoutes from "./routes/auth.js";
import studentRoutes from "./routes/student.js";
import workerRoutes from "./routes/worker.js";
import adminRoutes from "./routes/admin.js";

const app = express();

// Let the frontend (another address) call this API.
// The page that this server sends out is on the same address, so it never needs
// this, but a frontend that runs somewhere else does.
app.use(
  cors({
    origin: (origin, callback) => {
      // No origin: the call did not come from a browser (curl, a health check).
      if (!origin || FRONTEND_URLS.includes(origin)) return callback(null, true);
      // Not on the list: no permission header is sent, so the browser stops it.
      callback(null, false);
    }
  })
);

// Read JSON request bodies. The limit is big enough for one photo.
app.use(express.json({ limit: "8mb" }));

// A quick "is the server alive?" check.
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// Before every request: mark QR codes that ran out of time as expired.
app.use("/api", async (req, res, next) => {
  await expireOldRequests();
  next();
});

app.use("/api/auth", authRoutes);
app.use("/api/student", studentRoutes);
app.use("/api/worker", workerRoutes);
app.use("/api/admin", adminRoutes);

// The frontend files, so the whole app is on one address.
serveFrontend(app);

// Any other address.
app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

// Must be last: turns errors into { error: "message" } answers.
app.use(handleErrors);

export default app;
