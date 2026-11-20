// frontend.js
// ----------
// Serves the frontend files (the ones in the root of the repository) from the
// API server. That way the whole app lives on one address, which is what the
// hosted version needs: one Render service, one URL, no CORS to think about.
//
// Only the files that belong to the frontend are served. The backend folder
// (its source and its .env file) is never sent to the browser.

import fs from "node:fs";
import path from "node:path";

// The files that make up the frontend page.
const FRONTEND_FILES = [
  "index.html",
  "style.css",
  "api.js",
  "main.js",
  "student.js",
  "staff.js",
  "logo.png"
];

/** The folder with the frontend files: the root of the repository. */
export function frontendFolder() {
  return path.resolve(import.meta.dirname, "..", "..");
}

/** Adds the frontend routes to the Express app. */
export function serveFrontend(app) {
  const folder = frontendFolder();
  if (!fs.existsSync(path.join(folder, "index.html"))) {
    console.warn(`No frontend found in ${folder}. The API works, the page does not.`);
    return;
  }

  app.get("/", (req, res) => res.sendFile(path.join(folder, "index.html")));
  for (const file of FRONTEND_FILES) {
    app.get("/" + file, (req, res) => res.sendFile(path.join(folder, file)));
  }
}
