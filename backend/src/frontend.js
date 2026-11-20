// frontend.js
// ----------
// Serves the frontend (the `frontend/` folder in the root of the repository)
// from the API server. That way the whole app lives on one address, which is
// what the hosted version needs: one Render service, one URL, no CORS to think
// about.
//
// Only the `frontend/` folder is served. The backend folder (its source and
// its .env file) is never sent to the browser.

import fs from "node:fs";
import path from "node:path";
import express from "express";

/** The folder with the frontend files: `frontend/` in the root of the repository. */
export function frontendFolder() {
  return path.resolve(import.meta.dirname, "..", "..", "frontend");
}

/** Adds the frontend routes to the Express app. */
export function serveFrontend(app) {
  const folder = frontendFolder();
  if (!fs.existsSync(path.join(folder, "index.html"))) {
    console.warn(`No frontend found in ${folder}. The API works, the page does not.`);
    return;
  }

  // Dotfiles are never sent, and /api/* is handled before this runs.
  app.use(express.static(folder, { index: "index.html", dotfiles: "ignore" }));
}
