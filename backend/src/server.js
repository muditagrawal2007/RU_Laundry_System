// server.js
// ---------
// Starts the API.   npm start   (or  npm run dev  to restart on every change)

import app from "./app.js";
import { PORT, QR_SECRET } from "./config.js";
import { queryOne } from "./db.js";
import { resetDatabase } from "../database/reset.js";

// The QR secret signs every QR code. Without a long, private secret anybody could
// make a fake code, so the server will not start.
if (!QR_SECRET || QR_SECRET.length < 32) {
  console.error("QR_SECRET is missing or too short (it needs at least 32 characters).");
  console.error("Make one with:  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
  console.error("and put it in the .env file as  QR_SECRET=...");
  process.exit(1);
}

// A new, empty database (the first start on Render) gets its tables and the demo
// data. A database that already has tables is never touched.
const tables = await queryOne("SELECT to_regclass('public.users') AS users");
if (!tables.users) {
  console.log("The database is empty. Creating the tables and the demo data...");
  await resetDatabase();
}

app.listen(PORT, () => {
  console.log(`RU Laundry API is running on http://localhost:${PORT}`);
});
