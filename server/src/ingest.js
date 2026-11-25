// skoro-stats: takes anonymous usage events from the apps and keeps only what
// each app's schema allows. Nothing that names a person, a device or a network is stored.

import { apps } from "#apps";

export const schemas = Object.fromEntries(Object.entries(apps).map(([name, app]) => [name, app.schema]));

const MAX_BODY = 16 * 1024;
const MAX_EVENTS = 50;
const KEEP_DAYS = 395;
// "*" in a schema: a value from a fixed list in the app's code (paywall contexts, features).
// Case is kept: feature names are camelCase ("feature.lineComments").
const TOKEN = /^[A-Za-z0-9_.]{1,64}$/;
const FIELDS = {
  v: /^[0-9][0-9.]{0,15}$/,
  build: /^[0-9][0-9.]{0,15}$/,
  os: /^[0-9]{1,3}$/,
  lang: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/,
  // "none": an app with nothing to buy.
  pro: /^(free|trial|pro|legacy|none)$/,
  session: /^[0-9A-Fa-f-]{36}$/,
};

// Older app versions don't send it.
const DEVICE = /^(iphone|ipad|other|android|android_tablet)$/;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      const keys = parseKeys(env);
      return json(200, { ok: true, configured: Object.keys(keys).length > 0 });
    }
    if (url.pathname !== "/v1/events") return json(404, { error: "not_found" });
    if (request.method !== "POST") return json(405, { error: "method" });
    return ingest(request, env, Date.now());
  },

  async scheduled(_event, env) {
    await prune(env, Date.now());
  },
};

function parseKeys(env) {
  try { return JSON.parse(env.APP_KEYS || "{}"); } catch { return {}; }
}

export async function ingest(request, env, now) {
  // Abuse limit per address; the address goes to the limiter only, never to the database.
  if (env.LIMITER) {
    const address = request.headers.get("cf-connecting-ip") || "unknown";
    const { success } = await env.LIMITER.limit({ key: address });
    if (!success) return json(429, { error: "slow_down" });
  }
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY) return json(413, { error: "too_large" });
  const text = await request.text();
  if (text.length > MAX_BODY) return json(413, { error: "too_large" });
  let body;
  try { body = JSON.parse(text); } catch { return json(400, { error: "json" }); }
  if (!body || typeof body !== "object") return json(400, { error: "json" });

  const schema = schemas[body.app];
  if (!schema) return json(400, { error: "app" });
  const keys = parseKeys(env);
  if (!keys[body.app] || request.headers.get("x-stats-key") !== keys[body.app]) return json(401, { error: "key" });
  for (const [field, pattern] of Object.entries(FIELDS)) {
    if (typeof body[field] !== "string" || !pattern.test(body[field])) return json(400, { error: field });
  }
  const device = typeof body.device === "string" && DEVICE.test(body.device) ? body.device : "unknown";
  if (body.device !== undefined && device === "unknown") return json(400, { error: "device" });
  if (!Array.isArray(body.events) || body.events.length > MAX_EVENTS) return json(400, { error: "events" });

  const rows = body.events.map((event) => clean(event, schema)).filter(Boolean);
  if (rows.length > 0) {
    const country = /^[A-Z]{2}$/.test(request.cf?.country ?? "") ? request.cf.country : "XX";
    const day = new Date(now).toISOString().slice(0, 10);
    const insert = env.DB.prepare(
      "INSERT INTO events (ts, day, app, version, build, os, lang, country, pro, device, session, name, props, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const session = body.session.toLowerCase();
    // The batch's session, once: what the dashboard counts sessions from.
    const seen = env.DB.prepare(
      `INSERT INTO sessions (app, day, session, version, os, device, country, pro, first_run) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO UPDATE SET first_run = MAX(first_run, excluded.first_run)`)
      .bind(body.app, day, session, body.v, body.os, device, country, body.pro, rows.some((row) => row.name === "first_run") ? 1 : 0);
    await env.DB.batch([...rows.map((row) => insert.bind(now, day, body.app, body.v, body.build, body.os, body.lang, country,
                                                         body.pro, device, session, row.name, row.props, row.at)), seen]);
  }
  return new Response(null, { status: 204 });
}

/// The event as stored, or null when its name isn't in the schema. Properties the schema
/// doesn't name, or values it doesn't allow, are dropped quietly.
export function clean(event, schema) {
  if (!event || typeof event !== "object" || typeof event.n !== "string") return null;
  const allowed = schema[event.n];
  if (!allowed) return null;
  const props = {};
  const given = event.p && typeof event.p === "object" ? event.p : {};
  for (const [key, values] of Object.entries(allowed)) {
    const value = given[key];
    if (typeof value !== "string") continue;
    if (values === "*" ? TOKEN.test(value) : values.includes(value)) props[key] = value;
  }
  const at = Number.isInteger(event.t) && event.t >= 0 && event.t <= 7 * 86_400_000 ? event.t : 0;
  return { name: event.n, props: JSON.stringify(props), at };
}

/// Raw events, and the sessions counted from them, are kept 13 months. Ids grow with time, so
/// the first id to keep is found by walking from the oldest event and the rest is a range of
/// ids: only the events that go are read, not the whole table. Sessions go by (app, day),
/// the start of their key. The demo keeps fewer days.
export async function prune(env, now, keepDays = KEEP_DAYS) {
  const cutoff = now - keepDays * 86_400_000;
  const names = Object.keys(apps);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM events WHERE id < (SELECT id FROM events WHERE ts >= ? ORDER BY id LIMIT 1)").bind(cutoff),
    env.DB.prepare(`DELETE FROM sessions WHERE app IN (${names.map(() => "?").join(", ")}) AND day < ?`)
      .bind(...names, new Date(cutoff).toISOString().slice(0, 10)),
  ]);
}
