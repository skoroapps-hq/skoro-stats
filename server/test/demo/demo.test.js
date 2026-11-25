// The hosted demo (scripts/demo/worker.js), with the demo's apps (run with --conditions=skoro-demo).
import assert from "node:assert/strict";
import { test } from "node:test";
import demo from "../../scripts/demo/worker.js";
import dashboard from "../../src/dashboard.js";
import { database } from "../db.js";

const DAY = 86_400_000, HOUR = 3_600_000;
const count = (env, sql = "SELECT COUNT(*) AS n FROM events") => env.DB.raw.prepare(sql).get().n;
const get = (env, path) => demo.fetch(new Request("https://demo.skorostats.com" + path), env);

test("demo: open to every visitor, without a password", async () => {
  const env = { DB: database() };
  const page = await get(env, "/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /App Statistics/);
  const api = await get(env, "/api/overview?days=7");
  assert.equal(api.status, 200);
  assert.ok(Array.isArray((await api.json()).apps));
});

test("demo: only reads; sign-in, sign-out and any other write go back to the page", async () => {
  const env = { DB: database() };
  for (const path of ["/login", "/logout", "/v1/events", "/api/summary"]) {
    const response = await demo.fetch(new Request("https://demo.skorostats.com" + path, { method: "POST", body: "password=x" }), env);
    assert.equal(response.status, 303, path);
    assert.equal(response.headers.get("location"), "/");
    assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.equal(count(env), 0);
});

test("demo: the hourly job adds that hour's sessions and keeps 90 days", async () => {
  const env = { DB: database() };
  const now = Date.UTC(2026, 10, 25, 14, 59);
  // An event from 100 days ago: the job deletes it.
  env.DB.raw.prepare(`INSERT INTO events (ts, day, app, version, build, os, lang, country, pro, device, session, name, props, at)
    VALUES (?, '2026-08-17', 'example', '1.3', '1', '18', 'en', 'US', 'free', 'iphone', '6f1c2b3a-1111-4222-8333-444455556666', 'session_start', '{}', 0)`)
    .run(now - 100 * DAY);
  await demo.scheduled({ scheduledTime: now }, env);
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM events WHERE ts < " + (now - 90 * DAY)), 0, "older than 90 days");
  const hour = Math.floor(now / HOUR) * HOUR;
  assert.ok(count(env) > 0, "this hour's sessions");
  assert.equal(count(env, `SELECT COUNT(*) AS n FROM events WHERE ts < ${hour} OR ts >= ${hour + HOUR}`), 0, "all within the hour");
  const summary = await (await get(env, "/api/summary?app=example&days=1")).json();
  assert.equal(summary.app, "example");
});

test("demo: the real dashboard still asks for a login", async () => {
  const env = { DB: database(), DASHBOARD_PASSWORD: "a-long-enough-password" };
  const page = await dashboard.fetch(new Request("https://stats.example.com/"), env);
  assert.doesNotMatch(await page.text(), /id="panels"/);
  assert.equal((await dashboard.fetch(new Request("https://stats.example.com/api/overview"), env)).status, 401);
});
