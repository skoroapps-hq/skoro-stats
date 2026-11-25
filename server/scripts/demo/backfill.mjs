// The hosted demo's first 60 days, as SQL to load once into its empty database:
//   node --conditions=skoro-demo scripts/demo/backfill.mjs > backfill.sql
//   npx wrangler d1 execute DB --remote --file backfill.sql -c scripts/demo/wrangler.toml
// It stops at the start of this hour; the demo's hourly job adds the rest and grows it to 90 days.
// 60 days, not 90: each event is two writes (its row and its index), and D1's free plan takes
// 100,000 writes a day. Enough for the 30-day view and the period before it.
import { database } from "../../test/db.js";
import { demoKeys, fill } from "./data.js";

const DAY = 86_400_000, HOUR = 3_600_000, DAYS = 60;
const now = Date.now();
const env = { DB: database(), APP_KEYS: demoKeys() };
await fill(env, now, Math.floor(now / DAY) * DAY - (DAYS - 1) * DAY, Math.floor(now / HOUR) * HOUR);

const quote = (value) => typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
for (const table of ["events", "sessions"]) {
  // Events in id order: the hourly prune finds the oldest to keep by walking the ids.
  const rows = env.DB.raw.prepare(table === "events" ? "SELECT * FROM events ORDER BY id" : "SELECT * FROM sessions").all();
  const columns = Object.keys(rows[0]);
  for (let i = 0; i < rows.length; i += 100) {
    const values = rows.slice(i, i + 100).map((row) => `(${columns.map((c) => quote(row[c])).join(", ")})`).join(",\n");
    console.log(`INSERT INTO ${table} (${columns.join(", ")}) VALUES\n${values};`);
  }
  console.error(`${table}: ${rows.length} rows`);
}
const count = (table) => env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
console.error(`D1 writes: about ${2 * count("events") + count("sessions")} (the free plan takes 100,000 a day)`);
