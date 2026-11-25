// An in-memory D1 for the tests: node:sqlite behind D1's prepare/bind/run/all/first/batch,
// with every migration applied in order.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function database() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"));
  }
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    async all() { return { results: db.prepare(sql).all(...args).map((row) => ({ ...row })) }; },
    async first() { return db.prepare(sql).get(...args) ?? null; },
  });
  return { prepare: (sql) => statement(sql), batch: async (list) => Promise.all(list.map((s) => s.run())), raw: db };
}
