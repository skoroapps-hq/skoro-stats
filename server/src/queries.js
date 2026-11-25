// What the dashboard shows, one query each, for an app and a number of days back: the
// sections every app has, then the panels the app declares in apps.js. With `day` set, every
// section but the daily list counts only that day; the daily list keeps the whole period so
// another day can be picked. `filters` (column → value, columns from FILTERS) narrow every
// section, daily list included, except a breakdown by that same column, so another value can be picked.
// `previous` holds the tiles' totals for the period just before (or, with a day picked, the
// same weekday a week earlier), so the page can show the change.

import { apps } from "#apps";
import { common } from "./schema.js";

/// The buckets of session_start's `days` (days since install), in order.
export const DAYS_SINCE_INSTALL = common.session_start.days;

/// Session columns the dashboard can filter by; only these names are ever spliced into SQL.
/// `system` is the platform and its major version together ("iOS 27", "Android 16"): the apps send the
/// version alone in `os`, so iOS 16 and Android 16 would otherwise share a row.
export const FILTERS = ["version", "system", "country", "pro", "device"];

/// SQL for a filter column (a real column, or `system`'s expression). Events from before the
/// `device` field (unknown) came from iPhone and iPad apps only.
const SQL_COLUMNS = {
  system: "((CASE WHEN device IN ('android', 'android_tablet') THEN 'Android ' ELSE 'iOS ' END) || os)",
};
const sqlColumn = (column) => SQL_COLUMNS[column] ?? column;

/// The ones the all-apps view takes: a version number means something else in each app.
export const SHARED_FILTERS = FILTERS.filter((column) => column !== "version");

const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results;

const since = (now, days) => new Date(now - (days - 1) * 86_400_000).toISOString().slice(0, 10);
const shift = (day, days) => new Date(Date.parse(day + "T00:00:00Z") - days * 86_400_000).toISOString().slice(0, 10);

/// What the period to compare with covers: the same number of days just before `from`, or
/// with a day picked, that weekday a week earlier. SQL for `day` and its arguments.
const before = (from, days, day) => {
  if (day) { const d = shift(day, 7); return { sql: "day = ?", args: [d], label: d, start: d, has: (x) => x === d }; }
  const start = shift(from, days);
  return { sql: "day >= ? AND day < ?", args: [start, from], label: start, start, has: (x) => x >= start && x < from };
};

/// The chosen filters as [column, value], and `narrow(except)`: their SQL and arguments,
/// leaving out `except` so its own breakdown still lists the other values.
function filtering(filters, columns) {
  const picked = columns.filter((column) => filters[column] != null).map((column) => [column, String(filters[column])]);
  const narrow = (except) => {
    const kept = picked.filter(([column]) => column !== except);
    return { sql: kept.map(([column]) => ` AND ${sqlColumn(column)} = ?`).join(""), args: kept.map(([, value]) => value) };
  };
  // The same in JavaScript, for the rows of sessionRows.
  const matches = (except) => (row) => picked.every(([column, value]) => column === except || String(row[column]) === value);
  return { picked, narrow, matches };
}

/// The sessions table where `where` holds: one row per session and day with what the
/// dashboard filters and breaks down by. Every section that counts sessions is worked out
/// from these in JavaScript instead of a query of its own over the period's events (D1's free
/// tier counts rows read). A session whose attributes changed on the way (`pro` after a
/// purchase) has a row for each, so it counts under both values.
const sessionRows = (env, where, args) => all(env, `SELECT app, session, day, version, ${sqlColumn("system")} AS system,
                                                    country, pro, device, first_run AS firstRun
                                             FROM sessions WHERE ${where}`, ...args);

/// Distinct sessions (and first runs) of `rows` by `keyOf(row)`.
function sessionsBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    let group = groups.get(key);
    if (!group) groups.set(key, group = { sessions: new Set(), firstRuns: new Set() });
    const id = row.app + " " + row.session;
    group.sessions.add(id);
    if (row.firstRun) group.firstRuns.add(id);
  }
  return groups;
}

/// Sessions and first runs by day, oldest first, with `fields(row)` kept alongside.
const byDay = (rows, keyOf = (row) => row.day, fields = (row) => ({ day: row.day })) => {
  const firsts = new Map(rows.map((row) => [keyOf(row), row]));
  return [...sessionsBy(rows, keyOf)].map(([key, group]) => ({ ...fields(firsts.get(key)), sessions: group.sessions.size, firstRuns: group.firstRuns.size }))
    .sort((a, b) => a.day.localeCompare(b.day));
};

/// The earliest of some days (YYYY-MM-DD).
const earliest = (...days) => days.sort()[0];

/// The tiles' session counts: sessions summed by day.
const sessionTotals = (rows) => byDay(rows).reduce((t, row) => ({ sessions: t.sessions + row.sessions, firstRuns: t.firstRuns + row.firstRuns }),
                                                    { sessions: 0, firstRuns: 0 });

/// Sessions by the value of `column`, most first, at most 50.
const breakdown = (rows, column) => [...sessionsBy(rows, (row) => row[column])]
  .map(([value, group]) => ({ value, sessions: group.sessions.size }))
  .sort((a, b) => b.sessions - a.sessions || String(a.value).localeCompare(String(b.value)))
  .slice(0, 50);

/// The events named `names` where `where` holds, with their properties parsed: every section
/// but the session counts is worked out from these in JavaScript. One plain read of each row:
/// D1 counts the sort behind a GROUP BY or COUNT(DISTINCT) as a second read of every row, and
/// several sections and panels read the same event.
async function eventRows(env, where, args, names) {
  const wanted = [...new Set(names)];
  if (!wanted.length) return [];
  const rows = await all(env, `SELECT app, session, name, props FROM events
                               WHERE ${where} AND name IN (${wanted.map(() => "?").join(", ")})`, ...args, ...wanted);
  return rows.map((row) => ({ app: row.app, session: row.app + " " + row.session, name: row.name, p: JSON.parse(row.props) }));
}

/// The events every view reads, besides its panels'.
const PAYWALL_EVENTS = ["onboarding_step", "paywall_shown", "purchase"];

const named = (rows, name) => rows.filter((row) => row.name === name);
const purchased = (row) => row.name === "purchase" && row.p.outcome === "purchased";

/// Events and distinct sessions by `keyOf(row)`, in the order first seen; `first` is the
/// group's first row.
function tally(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    let group = groups.get(key);
    if (!group) groups.set(key, group = { first: row, count: 0, sessions: new Set() });
    group.count++;
    group.sessions.add(row.session);
  }
  return [...groups.values()];
}

/// Sessions whose first-run paywall came up without a paywall_shown (an app that logs the step but not the paywall):
/// the onboarding step stands in for it. By app.
function unloggedPaywalls(rows) {
  const stepped = new Map(), logged = new Set();
  for (const row of rows) {
    if (row.name === "onboarding_step" && row.p.step === "paywall") stepped.set(row.session, row.app);
    if (row.name === "paywall_shown" && row.p.context === "onboarding") logged.add(row.session);
  }
  const byApp = {};
  for (const [session, app] of stepped) if (!logged.has(session)) byApp[app] = (byApp[app] ?? 0) + 1;
  return byApp;
}

/// The tiles' paywalls and purchases by app: paywalls including the unlogged first-run ones,
/// purchases that went through. Sessions come from sessionTotals.
function moneyByApp(rows) {
  const byApp = {};
  const item = (app) => (byApp[app] ??= { shown: 0, purchased: 0 });
  for (const row of rows) {
    if (row.name === "paywall_shown") item(row.app).shown++;
    if (purchased(row)) item(row.app).purchased++;
  }
  for (const [app, n] of Object.entries(unloggedPaywalls(rows))) item(app).shown += n;
  return byApp;
}
const moneyTotals = (rows) => Object.values(moneyByApp(rows))
  .reduce((t, m) => ({ shown: t.shown + m.shown, purchased: t.purchased + m.purchased }), { shown: 0, purchased: 0 });

/// Sessions by days since install (session_start's `days`), every bucket in order; empty
/// when no session_start carried it.
function returning(rows) {
  const groups = tally(named(rows, "session_start"), (row) => row.p.days ?? null);
  if (!groups.some((group) => DAYS_SINCE_INSTALL.includes(group.first.p.days))) return [];
  return DAYS_SINCE_INSTALL.map((value) => ({ value, sessions: groups.find((group) => group.first.p.days === value)?.sessions.size ?? 0 }));
}

const newestFirst = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
};

/// Sessions by day and version: the four newest versions by name, the rest as "older".
export function adoption(rows, keep = 4) {
  const versions = [...new Set(rows.map((row) => row.version))].sort(newestFirst);
  const kept = versions.slice(0, keep);
  const days = new Map();
  for (const row of rows) {
    const item = days.get(row.day) ?? { day: row.day, total: 0, versions: {} };
    const key = kept.includes(row.version) ? row.version : "older";
    item.versions[key] = (item.versions[key] ?? 0) + row.sessions;
    item.total += row.sessions;
    days.set(row.day, item);
  }
  return { versions: versions.length > keep ? [...kept, "older"] : kept, days: [...days.values()] };
}

/// The events a panel reads.
const panelEvents = (definition) => definition.events ?? [definition.event];

export async function summary(env, app, days, now = Date.now(), day = null, filters = {}) {
  const from = since(now, days);
  const { picked, narrow, matches } = filtering(filters, FILTERS);
  const f = narrow(null);
  const scope = (day ? "app = ? AND day = ?" : "app = ? AND day >= ?") + f.sql;
  const p = [app, day ?? from, ...f.args];
  const config = apps[app] ?? { panels: [] };
  const earlier = before(from, days, day);

  const [rows, earlierEvents, events] = await Promise.all([
    sessionRows(env, "app = ? AND day >= ?", [app, earliest(from, earlier.start, day ?? from)]),
    eventRows(env, `app = ? AND ${earlier.sql}${f.sql}`, [app, ...earlier.args, ...f.args], PAYWALL_EVENTS),
    eventRows(env, scope, p, [...PAYWALL_EVENTS, "paywall_closed", "locked_tap", "session_start", ...config.panels.flatMap(panelEvents)]),
  ]);
  const bought = new Set(events.filter(purchased).map((row) => row.session));

  const paywalls = {};
  const paywall = (context) => (paywalls[context] ??= { context, shown: 0, closed: 0, purchased: 0, seconds: {} });
  for (const row of events) {
    if (row.name === "paywall_shown") paywall(row.p.context ?? null).shown++;
    if (row.name === "paywall_closed") {
      const item = paywall(row.p.context ?? null);
      item.closed++;
      const seconds = row.p.seconds ?? "?";
      item.seconds[seconds] = (item.seconds[seconds] ?? 0) + 1;
    }
    if (purchased(row)) paywall(row.p.context ?? null).purchased++;
  }
  const unlogged = unloggedPaywalls(events)[app] ?? 0;
  if (unlogged) paywall("onboarding").shown += unlogged;

  const steps = tally(named(events, "onboarding_step"), (row) => row.p.step ?? null)
    .map((group) => ({ step: group.first.p.step ?? null, sessions: group.sessions.size }))
    .sort((a, b) => b.sessions - a.sessions || String(a.step).localeCompare(String(b.step)));
  const funnelSteps = config.onboarding
    ? config.onboarding.map((step) => ({ step, sessions: steps.find((row) => row.step === step)?.sessions ?? 0 }))
    : steps;
  const onboardingBought = new Set(events.filter((row) => purchased(row) && row.p.context === "onboarding").map((row) => row.session));
  const products = tally(named(events, "purchase"), (row) => JSON.stringify([row.p.product ?? null, row.p.outcome ?? null]))
    .map((group) => ({ product: group.first.p.product ?? null, outcome: group.first.p.outcome ?? null, count: group.count }));
  const locked = tally(named(events, "locked_tap"), (row) => row.p.feature ?? null)
    .map((group) => ({ feature: group.first.p.feature ?? null, taps: group.count, boughtSessions: [...group.sessions].filter((s) => bought.has(s)).length }))
    .sort((a, b) => b.taps - a.taps || String(a.feature).localeCompare(String(b.feature)));

  const inPeriod = rows.filter((row) => row.day >= from);
  const counted = rows.filter((row) => (day ? row.day === day : row.day >= from));
  const dimension = (column) => breakdown(counted.filter(matches(column)), column);
  const previous = { ...moneyTotals(earlierEvents), ...sessionTotals(rows.filter((row) => earlier.has(row.day)).filter(matches(null))) };
  // The whole period, like the daily list, and not narrowed by a version filter.
  const versionDays = byDay(inPeriod.filter(matches("version")), (row) => row.day + " " + row.version,
                            (row) => ({ day: row.day, version: row.version })).map(({ firstRuns, ...row }) => row);
  return {
    app, days, from, day, filters: Object.fromEntries(picked),
    apps: Object.keys(apps),
    previous: { ...previous, from: earlier.label },
    daily: byDay(inPeriod.filter(matches(null))),
    adoption: adoption(versionDays),
    returning: returning(events),
    funnel: { steps: funnelSteps, purchased: onboardingBought.size },
    paywalls: Object.values(paywalls).sort((a, b) => b.shown - a.shown),
    products,
    locked,
    breakdown: { versions: dimension("version"), systems: dimension("system"), countries: dimension("country"),
                 pro: dimension("pro"), devices: dimension("device") },
    panels: config.panels.map((definition) => panel(definition, events, bought)),
  };
}

/// All apps side by side: their totals, sessions by day (in total and per app) and the
/// breakdowns every app shares. Each read is over `app IN (…)`, so the number of queries
/// stays the same as apps are added. Totals count like an app's own tiles, so the two views agree.
export async function overview(env, days, now = Date.now(), day = null, filters = {}) {
  const names = Object.keys(apps);
  const from = since(now, days);
  const { picked, narrow, matches } = filtering(filters, SHARED_FILTERS);
  const inApps = `app IN (${names.map(() => "?").join(", ")})`;
  const f = narrow(null);
  const earlier = before(from, days, day);
  const [rows, earlierEvents, events] = await Promise.all([
    sessionRows(env, `${inApps} AND day >= ?`, [...names, earliest(from, earlier.start, day ?? from)]),
    eventRows(env, `${inApps} AND ${earlier.sql}${f.sql}`, [...names, ...earlier.args, ...f.args], PAYWALL_EVENTS),
    eventRows(env, `${inApps} AND ${day ? "day = ?" : "day >= ?"}${f.sql}`, [...names, day ?? from, ...f.args], [...PAYWALL_EVENTS, "session_start"]),
  ]);
  const daily = byDay(rows.filter((row) => row.day >= from).filter(matches(null)), (row) => row.app + " " + row.day,
                      (row) => ({ app: row.app, day: row.day }));
  const inScope = rows.filter((row) => (day ? row.day === day : row.day >= from));
  const dimension = (column) => breakdown(inScope.filter(matches(column)), column);
  const previous = { ...moneyTotals(earlierEvents), ...sessionTotals(rows.filter((row) => earlier.has(row.day)).filter(matches(null))) };

  const money = moneyByApp(events);
  const counted = day ? daily.filter((row) => row.day === day) : daily;
  const perApp = names.map((app) => {
    const rows = counted.filter((row) => row.app === app);
    return {
      app,
      sessions: rows.reduce((s, row) => s + row.sessions, 0),
      firstRuns: rows.reduce((s, row) => s + row.firstRuns, 0),
      shown: money[app]?.shown ?? 0,
      purchased: money[app]?.purchased ?? 0,
    };
  }).sort((a, b) => b.sessions - a.sessions || a.app.localeCompare(b.app));
  const dayItems = new Map();
  for (const row of daily) {
    const item = dayItems.get(row.day) ?? { day: row.day, sessions: 0, firstRuns: 0, apps: {} };
    item.sessions += row.sessions;
    item.firstRuns += row.firstRuns;
    item.apps[row.app] = row.sessions;
    dayItems.set(row.day, item);
  }
  return {
    app: "*", days, from, day, filters: Object.fromEntries(picked),
    apps: names,
    previous: { ...previous, from: earlier.label },
    daily: [...dayItems.values()],
    returning: returning(events),
    perApp,
    breakdown: { systems: dimension("system"), countries: dimension("country"), pro: dimension("pro"), devices: dimension("device") },
  };
}

/// One app-declared section, from the view's events; `bought`: the sessions with a purchase.
function panel(definition, events, bought) {
  const { id, title, type, prefix, labels } = definition;
  return { id, title, type, prefix, labels, rows: panelRows(definition, events, bought) };
}

function panelRows(definition, events, bought) {
  switch (definition.type) {
    case "values": {
      const props = definition.props ?? [definition.prop];
      // `except`: events whose property has this value are left out (a missing property never matches).
      const except = Object.entries(definition.except ?? {});
      const rows = named(events, definition.event).filter((row) => except.every(([prop, value]) => (row.p[prop] ?? "") !== value));
      const values = (row) => props.map((prop) => row.p[prop] ?? null);
      const joined = tally(rows, (row) => JSON.stringify(values(row)))
        .map((group) => ({ values: values(group.first), count: group.count, sessions: group.sessions.size }))
        // Ties by value, so a row limit always keeps the same ones.
        .sort((a, b) => b.count - a.count || JSON.stringify(a.values).localeCompare(JSON.stringify(b.values)))
        .slice(0, definition.limit ?? 30)
        .map(({ values, count, sessions }) => ({
          value: props.length === 1 ? values[0] : values.map((value) => value ?? "(not set)").join(" · "),
          count, sessions,
        }));
      if (!definition.order) return joined;
      const rank = (value) => { const i = definition.order.indexOf(value); return i < 0 ? definition.order.length : i; };
      return joined.sort((a, b) => rank(a.value) - rank(b.value));
    }
    case "counts":
      return tally(events.filter((row) => definition.events.includes(row.name)), (row) => row.name)
        .map((group) => ({ value: group.first.name, count: group.count, boughtSessions: [...group.sessions].filter((s) => bought.has(s)).length }))
        .sort((a, b) => b.count - a.count);
    case "flags": {
      const rows = named(events, definition.event);
      if (!rows.length) return [];
      return definition.props.map((value) => ({ value, count: rows.filter((row) => row.p[value] === "1").length, answers: rows.length }));
    }
    default:
      throw new Error(`unknown panel type ${definition.type}`);
  }
}
