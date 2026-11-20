// config.js
// ---------
// All the settings of the backend in one place.
// The values come from the .env file (see .env.example).

export const PORT = Number(process.env.PORT ?? 4000);
export const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://localhost:5432/ru_laundry";

// The addresses of the frontend that are allowed to call this API.
// More than one is allowed: FRONTEND_URL="https://one.com,https://two.com".
// On Render the address of the service itself is used (RENDER_EXTERNAL_URL),
// so nothing has to be set there.
export const FRONTEND_URLS = (
  process.env.FRONTEND_URL ??
  (process.env.RENDER_EXTERNAL_URL
    ? (process.env.RENDER_EXTERNAL_URL.startsWith("http")
        ? process.env.RENDER_EXTERNAL_URL
        : "https://" + process.env.RENDER_EXTERNAL_URL)
    : "http://localhost:3000")
)
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

export const FRONTEND_URL = FRONTEND_URLS[0];
// There is no default on purpose: server.js refuses to start without a real secret.
export const QR_SECRET = process.env.QR_SECRET;
export const TIMEZONE = process.env.TIMEZONE ?? "Asia/Kolkata";
export const ALLOW_DEMO_RESET = process.env.ALLOW_DEMO_RESET === "true";

// How long a "Give Clothes" QR code stays valid.
export const GIVE_QR_MINUTES = 10;
// How long a "Take Clothes" QR code stays valid.
export const TAKE_QR_MINUTES = 10;
// How long the student has to verify after the worker scans the collection code.
export const VERIFY_WINDOW_MINUTES = 5;
// How long a login lasts.
export const SESSION_DAYS = 7;
// After this many wrong passwords, the ID is locked for a while.
export const LOGIN_MAX_TRIES = 5;
export const LOGIN_LOCK_MINUTES = 5;
// The most clothes one bag can hold.
export const MAX_CLOTHES = 15;
// The biggest photo we accept, in characters of the data URL (about 4 MB of image).
export const MAX_PHOTO_LENGTH = 6000000;
