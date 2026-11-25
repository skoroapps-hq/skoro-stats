// Checks an instance's config the way the dashboard will use it: config.example, and your
// config/ when it's there. Panels may only read allowed events, and every view stays within
// D1's free plan (queries per request, and no query reading a whole table).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { apps } from "#apps";
import { overview, summary } from "../src/queries.js";
import { database } from "./db.js";

const configs = ["../config.example/apps.js", "../config/apps.js"].filter((path) => existsSync(new URL(path, import.meta.url)));

/// The engine reads `apps` from #apps (the test apps here); for one config, swap them in.
async function using(path, check) {
  const saved = { ...apps };
  for (const name of Object.keys(apps)) delete apps[name];
  Object.assign(apps, (await import(path)).apps);
  try { await check(); } finally {
    for (const name of Object.keys(apps)) delete apps[name];
    Object.assign(apps, saved);
  }
}

const TOKEN = /^[a-z][a-z0-9_]{0,31}$/;

for (const path of configs) {
  test(`${path}: app names, events and panels are well formed`, () => using(path, () => {
    assert.ok(Object.keys(apps).length > 0, "at least one app");
    for (const [name, app] of Object.entries(apps)) {
      assert.match(name, TOKEN, `app name ${name}`);
      for (const [event, props] of Object.entries(app.schema)) {
        assert.match(event, TOKEN, `${name}: event ${event}`);
        for (const [prop, values] of Object.entries(props)) {
          assert.ok(values === "*" || (Array.isArray(values) && values.every((v) => typeof v === "string")), `${name}: ${event}.${prop}`);
        }
      }
      const ids = new Set();
      for (const panel of app.panels) {
        assert.ok(!ids.has(panel.id), `${name}: panel id ${panel.id} twice`);
        ids.add(panel.id);
        assert.ok(["values", "counts", "flags"].includes(panel.type), `${name}/${panel.id}: type`);
        for (const event of panel.events ?? [panel.event]) assert.ok(app.schema[event], `${name}/${panel.id}: ${event} isn't in the schema`);
        for (const prop of panel.props ?? (panel.prop ? [panel.prop] : [])) {
          assert.ok(prop in app.schema[panel.event], `${name}/${panel.id}: ${panel.event}.${prop} isn't in the schema`);
        }
      }
    }
  }));

  test(`${path}: every view fits D1's free plan`, () => using(path, async () => {
    const e = { DB: database() };
    let queries = 0;
    const plans = [];
    const prepare = e.DB.prepare;
    e.DB.prepare = (sql) => {
      queries++;
      const statement = prepare(sql);
      return { ...statement, bind: (...args) => {
        plans.push({ sql, plan: e.DB.raw.prepare("EXPLAIN QUERY PLAN " + sql).all(...args).map((row) => row.detail) });
        return statement.bind(...args);
      } };
    };
    const views = [
      ...Object.keys(apps).flatMap((name) => [
        () => summary(e, name, 30, Date.UTC(2026, 10, 2)),
        () => summary(e, name, 30, Date.UTC(2026, 10, 2), "2026-11-02", { country: "US", version: "3.0", system: "iOS 18" }),
      ]),
      () => overview(e, 30, Date.UTC(2026, 10, 2)),
    ];
    for (const view of views) {
      queries = 0;
      await view();
      assert.ok(queries <= 45, `${queries} queries in one view, leave room under D1's 50`);
    }
    for (const { sql, plan } of plans) {
      for (const step of plan) {
        assert.doesNotMatch(step, /^SCAN (events|sessions)\b/, `${step}\n${sql}`);
        if (/\bevents\b/.test(step)) assert.match(step, /USING (COVERING )?INDEX events_app_name_day/, `${step}\n${sql}`);
      }
    }
  }));
}
