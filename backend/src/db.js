// db.js
// -----
// The connection to PostgreSQL.
//
// Use it like this:
//     const bags = await query("SELECT * FROM bags");
//     const bag  = await queryOne("SELECT * FROM bags WHERE bag_number = $1", ["B-001"]);
//
// $1, $2 ... are filled in from the list. Never put user input straight into the SQL text.
//
// The database uses names like "student_id". The frontend wants "studentId",
// so every row is changed to that style before we return it.

import pg from "pg";
import { DATABASE_URL } from "./config.js";

const pool = new pg.Pool({ connectionString: DATABASE_URL });

/** "student_id" -> "studentId" for every column of one row. */
function toCamelCase(row) {
  const result = {};
  for (const key in row) {
    const newKey = key.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());
    result[newKey] = row[key];
  }
  return result;
}

/** Runs SQL and returns all the rows. */
export async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows.map(toCamelCase);
}

/** Runs SQL and returns the first row, or null when there is none. */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/** Runs "SELECT COUNT(*) ..." and returns the number (pg sends COUNT as text). */
export async function count(sql, params = []) {
  const row = await queryOne(sql, params);
  return Number(row.count);
}

/** Runs a whole .sql file with many statements (used to create the tables). */
export async function runSqlScript(sql) {
  await pool.query(sql);
}

/** Closes the connection (used by the tests and the setup script). */
export async function closeDb() {
  await pool.end();
}
