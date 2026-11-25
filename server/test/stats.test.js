import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { generateKeyPairSync, createSign } from "node:crypto";
import worker, { clean, ingest, prune, schemas } from "../src/ingest.js";
import dashboard from "../src/dashboard.js";
import { resetKeysForTests, verify } from "../src/access.js";
import { adoption, overview, summary } from "../src/queries.js";
import { apps } from "#apps";
import { common } from "../src/schema.js";
import { database } from "./db.js";

const KEY = "test-key";
const env = (extra = {}) => ({ DB: database(), APP_KEYS: JSON.stringify({ reader: KEY }), ...extra });
const session = "6f1c2b3a-1111-4222-8333-444455556666";
const base = { app: "reader", v: "3.0", build: "3.0.0", os: "18", lang: "en-US", pro: "free", session };

function post(body, { key = KEY, ip = "203.0.113.9", country = "UA", raw } = {}) {
  const text = raw ?? JSON.stringify(body);
  const request = new Request("https://skoro-stats.example.workers.dev/v1/events", {
    method: "POST", body: text,
    headers: { "content-type": "application/json", "x-stats-key": key, "cf-connecting-ip": ip, "content-length": String(text.length) },
  });
  Object.defineProperty(request, "cf", { value: { country } });
  return request;
}

const rows = (e) => e.DB.raw.prepare("SELECT * FROM events ORDER BY id").all();

test("allowed events are kept with the country, never the address", async () => {
  const e = env();
  const response = await ingest(post({ ...base, events: [
    { n: "paywall_shown", p: { context: "feature.merge" }, t: 1200 },
    { n: "purchase", p: { product: "yearly", context: "feature.merge", outcome: "purchased" }, t: 9000 },
  ] }), e, Date.UTC(2026, 10, 2, 10));
  assert.equal(response.status, 204);
  const stored = rows(e);
  assert.equal(stored.length, 2);
  assert.equal(stored[0].day, "2026-11-02");
  assert.equal(stored[0].country, "UA");
  assert.equal(stored[0].session, session);
  assert.deepEqual(JSON.parse(stored[1].props), { product: "yearly", context: "feature.merge", outcome: "purchased" });
  assert.ok(!JSON.stringify(stored).includes("203.0.113.9"), "the address isn't stored");
});

test("device and file extension are stored; a bad device is refused, a missing one is unknown", async () => {
  const e = env();
  assert.equal((await ingest(post({ ...base, device: "ipad", events: [{ n: "file_read", p: { ext: "swift", name: "Secrets.swift" } }, { n: "file_read", p: { ext: "Not Ok/1" } }] }), e, Date.UTC(2026, 10, 2))).status, 204);
  assert.equal((await ingest(post({ ...base, events: [{ n: "file_read", p: { ext: "json" } }] }), e, Date.UTC(2026, 10, 2))).status, 204);
  assert.equal((await ingest(post({ ...base, device: "toaster", events: [] }), e, Date.UTC(2026, 10, 2))).status, 400);
  assert.equal((await ingest(post({ ...base, device: "android", events: [{ n: "file_read", p: { ext: "kt" } }] }), e, Date.UTC(2026, 10, 2))).status, 204);
  assert.equal((await ingest(post({ ...base, device: "android_tablet", events: [] }), e, Date.UTC(2026, 10, 2))).status, 204);
  const stored = rows(e);
  assert.deepEqual(stored.map((r) => r.device), ["ipad", "ipad", "unknown", "android"]);
  assert.deepEqual(JSON.parse(stored[0].props), { ext: "swift" });
  assert.deepEqual(JSON.parse(stored[1].props), {});
  const s = await summary(e, "reader", 30, Date.UTC(2026, 10, 2));
  assert.deepEqual(s.panels.find((p) => p.id === "extensions").rows.map((x) => [x.value, x.count]).sort(), [["json", 1], ["kt", 1], ["swift", 1], [null, 1]].sort());
  assert.deepEqual(s.breakdown.devices.map((x) => x.value).sort(), ["android", "ipad", "unknown"]);
});

test("the OS breakdown names the platform, so iOS 18 and Android 18 stay apart, and filters on both", async () => {
  const e = env();
  const at = Date.UTC(2026, 10, 2);
  await ingest(post({ ...base, device: "iphone", events: [{ n: "file_read", p: { ext: "swift" } }] }), e, at);
  await ingest(post({ ...base, session: "22222222-2222-2222-2222-222222222222", events: [{ n: "file_read", p: { ext: "md" } }] }), e, at);
  await ingest(post({ ...base, session: "33333333-3333-3333-3333-333333333333", device: "android", events: [{ n: "file_read", p: { ext: "kt" } }] }), e, at);
  const s = await summary(e, "reader", 30, at);
  assert.deepEqual(s.breakdown.systems.map((x) => [x.value, x.sessions]).sort(), [["Android 18", 1], ["iOS 18", 2]]);
  const android = await summary(e, "reader", 30, at, null, { system: "Android 18" });
  assert.deepEqual(android.breakdown.devices.map((x) => x.value), ["android"]);
});

test("file types leave out the Getting Started files; events without the sample flag count as own", async () => {
  const e = env();
  const events = [{ n: "file_read", p: { ext: "md", sample: "1" } }, { n: "file_read", p: { ext: "svg", sample: "1" } },
                  { n: "file_read", p: { ext: "java", sample: "0" } }, { n: "file_read", p: { ext: "rs" } }];
  assert.equal((await ingest(post({ ...base, events }), e, Date.UTC(2026, 10, 12))).status, 204);
  const s = await summary(e, "reader", 30, Date.UTC(2026, 10, 12));
  assert.deepEqual(s.panels.find((p) => p.id === "extensions").rows.map((x) => x.value).sort(), ["java", "rs"]);
  assert.deepEqual(s.panels.find((p) => p.id === "sample").rows.map((x) => [x.value, x.count]).sort(), [["0", 1], ["1", 2], [null, 1]].sort());
});

test("unknown events, properties and values are dropped quietly", () => {
  const schema = schemas.reader;
  assert.equal(clean({ n: "file_opened", p: { name: "Secrets.swift" } }, schema), null);
  const purchase = clean({ n: "purchase", p: { product: "weekly", context: "feature.merge", outcome: "purchased", repo: "acme/app" } }, schema);
  assert.deepEqual(JSON.parse(purchase.props), { context: "feature.merge", outcome: "purchased" });
  const odd = clean({ n: "locked_tap", p: { feature: "Has Spaces/And Slashes" } }, schema);
  assert.deepEqual(JSON.parse(odd.props), {}, "a free value must look like a code token");
  assert.equal(clean({ n: "free_review_used", t: -5 }, schema).at, 0);
});

test("a wrong key, a wrong app or a malformed field is refused", async () => {
  const e = env();
  assert.equal((await ingest(post({ ...base, events: [] }, { key: "nope" }), e, 0)).status, 401);
  assert.equal((await ingest(post({ ...base, app: "other", events: [] }), e, 0)).status, 400);
  assert.equal((await ingest(post({ ...base, lang: "en US", events: [] }), e, 0)).status, 400);
  assert.equal((await ingest(post({ ...base, session: "user@example.com", events: [] }), e, 0)).status, 400);
  assert.equal((await ingest(post(null, { raw: "{" }), e, 0)).status, 400);
  assert.equal(rows(e).length, 0);
});

test("too many events or too large a body is refused", async () => {
  const e = env();
  const many = Array.from({ length: 51 }, () => ({ n: "free_review_used" }));
  assert.equal((await ingest(post({ ...base, events: many }), e, 0)).status, 400);
  const huge = { ...base, events: [{ n: "free_review_used", p: { pad: "x".repeat(20_000) } }] };
  assert.equal((await ingest(post(huge), e, 0)).status, 413);
});

test("the rate limiter turns a flood away before reading it", async () => {
  const e = env({ LIMITER: { limit: async ({ key }) => ({ success: key !== "198.51.100.1" }) } });
  assert.equal((await ingest(post({ ...base, events: [{ n: "free_review_used" }] }, { ip: "198.51.100.1" }), e, 0)).status, 429);
  assert.equal(rows(e).length, 0);
});

test("only POST /v1/events and /health answer", async () => {
  const e = env();
  assert.equal((await worker.fetch(new Request("https://x/v1/events"), e)).status, 405);
  assert.equal((await worker.fetch(new Request("https://x/"), e)).status, 404);
  assert.deepEqual(await (await worker.fetch(new Request("https://x/health"), e)).json(), { ok: true, configured: true });
});

test("events older than 13 months are deleted", async () => {
  const e = env();
  const now = Date.UTC(2026, 10, 2);
  await ingest(post({ ...base, events: [{ n: "free_review_used" }] }), e, now - 400 * 86_400_000);
  await ingest(post({ ...base, events: [{ n: "free_review_used" }] }), e, now - 10 * 86_400_000);
  await prune(e, now);
  assert.equal(rows(e).length, 1);
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 1, "the old day's session goes too");
});

test("the summary counts the funnel, paywalls, locks and purchases", async () => {
  const e = env();
  const now = Date.UTC(2026, 10, 2, 12);
  const other = "7f1c2b3a-1111-4222-8333-444455556666";
  await ingest(post({ ...base, events: [
    { n: "first_run", p: { kind: "onboarding" } },
    ...["welcome", "persona", "value", "github", "paywall"].map((step) => ({ n: "onboarding_step", p: { step } })),
    { n: "persona_selected", p: { read: "0", review: "1", learn: "0" } },
    { n: "paywall_shown", p: { context: "onboarding" } },
    { n: "purchase", p: { product: "yearly", context: "onboarding", outcome: "purchased" } },
  ] }), e, now);
  await ingest(post({ ...base, session: other, events: [
    { n: "first_run", p: { kind: "onboarding" } },
    { n: "onboarding_step", p: { step: "welcome" } },
    { n: "locked_tap", p: { feature: "merge" } },
    { n: "paywall_shown", p: { context: "feature.merge" } },
    { n: "paywall_closed", p: { context: "feature.merge", seconds: "0-3" } },
  ] }), e, now);
  const s = await summary(e, "reader", 30, now);
  assert.deepEqual(s.daily, [{ day: "2026-11-02", sessions: 2, firstRuns: 2 }]);
  // 3.3's promise and choice (none here), welcome … paywall, then `done`, which the 3.0 sessions here never sent.
  assert.deepEqual(s.funnel.steps.map((x) => x.sessions), [0, 0, 2, 1, 1, 1, 1, 0]);
  assert.equal(s.funnel.purchased, 1);
  assert.deepEqual(s.panels.find((p) => p.id === "personas").rows.map((x) => [x.value, x.count, x.answers]), [["read", 0, 1], ["review", 1, 1], ["learn", 0, 1]]);
  assert.deepEqual(s.panels.find((p) => p.id === "free").rows, []);
  const merge = s.paywalls.find((p) => p.context === "feature.merge");
  assert.deepEqual([merge.shown, merge.closed, merge.purchased, merge.seconds["0-3"]], [1, 1, 0, 1]);
  assert.equal(s.paywalls.find((p) => p.context === "onboarding").purchased, 1);
  assert.deepEqual(s.locked, [{ feature: "merge", taps: 1, boughtSessions: 0 }]);
  assert.deepEqual(s.breakdown.countries, [{ value: "UA", sessions: 2 }]);
  assert.deepEqual(s.apps, Object.keys(apps));
});

test("camelCase feature names and contexts are kept", () => {
  const schema = schemas.reader;
  assert.deepEqual(JSON.parse(clean({ n: "locked_tap", p: { feature: "lineComments" } }, schema).props), { feature: "lineComments" });
  assert.deepEqual(JSON.parse(clean({ n: "paywall_shown", p: { context: "feature.lineComments" } }, schema).props), { context: "feature.lineComments" });
  assert.deepEqual(JSON.parse(clean({ n: "locked_tap", p: { feature: "a b/c" } }, schema).props), {});
});

test("a first-run paywall without paywall_shown counts from its onboarding step", async () => {
  const e = env();
  const now = Date.UTC(2026, 10, 2, 12);
  const logged = "7f1c2b3a-1111-4222-8333-444455556666";
  await ingest(post({ ...base, events: [
    { n: "onboarding_step", p: { step: "paywall" } },
    { n: "paywall_closed", p: { context: "onboarding", seconds: "3-10" } },
  ] }), e, now);
  await ingest(post({ ...base, session: logged, events: [
    { n: "onboarding_step", p: { step: "paywall" } },
    { n: "paywall_shown", p: { context: "onboarding" } },
  ] }), e, now);
  const s = await summary(e, "reader", 30, now);
  const onboarding = s.paywalls.find((p) => p.context === "onboarding");
  assert.deepEqual([onboarding.shown, onboarding.closed], [2, 1]);
});

test("values panels combine several properties and keep a fixed order", async () => {
  const e = env();
  const now = Date.UTC(2026, 10, 2, 12);
  await ingest(post({ ...base, events: [
    { n: "import", p: { source: "github", outcome: "done" } },
    { n: "import", p: { source: "github", outcome: "done" } },
    { n: "import", p: { source: "files", outcome: "failed" } },
    { n: "import_failed", p: { source: "link", reason: "not_found", url: "https://example.com/secret.zip" } },
    { n: "account_failed", p: { host: "github", reason: "timeout" } },
    { n: "session_start", p: { days: "8-30", library: "1", github: "1", gitlab: "0", gitlab_server: "0", bitbucket: "0" } },
    { n: "session_start", p: { days: "0", library: "0", github: "0", gitlab: "0", gitlab_server: "0", bitbucket: "0" } },
    { n: "session_start", p: { days: "8-30", library: "6+", github: "1", gitlab: "0", gitlab_server: "1", bitbucket: "0" } },
  ] }), e, now);
  const s = await summary(e, "reader", 30, now);
  const rows = (id) => s.panels.find((p) => p.id === id).rows;
  assert.deepEqual(rows("imports").map((r) => [r.value, r.count]), [["github · done", 2], ["files · failed", 1]]);
  assert.deepEqual(rows("importFailures").map((r) => [r.value, r.count]), [["link · not_found", 1]], "the URL isn't stored");
  assert.deepEqual(rows("accountFailures").map((r) => r.value), ["github · timeout"]);
  assert.deepEqual(s.returning.map((r) => [r.value, r.sessions]), [["0", 1], ["1", 0], ["2-7", 0], ["8-30", 1], ["31+", 0]],
                   "days since install is a section of its own, every bucket in order, counted in sessions");
  assert.deepEqual(rows("accounts").map((r) => [r.value, r.count]), [["github", 2], ["gitlab", 0], ["gitlab_server", 1], ["bitbucket", 0]]);
});

test("panels only read events their app's schema allows", () => {
  for (const [name, app] of Object.entries(apps)) {
    for (const panel of app.panels) {
      for (const event of panel.events ?? [panel.event]) assert.ok(app.schema[event], `${name}/${panel.id}: ${event}`);
      for (const prop of panel.props ?? (panel.prop ? [panel.prop] : [])) assert.ok(prop in app.schema[panel.event], `${name}/${panel.id}: ${prop}`);
    }
  }
});

test("a second app gets the common events, its own, its own key, and stays apart", async () => {
  apps.demo = { schema: { ...common, level_won: { world: ["1", "2"] } }, panels: [{ id: "worlds", title: "Worlds", type: "values", event: "level_won", prop: "world" }] };
  schemas.demo = apps.demo.schema;
  try {
    const e = env({ APP_KEYS: JSON.stringify({ reader: KEY, demo: "demo-key" }) });
    const now = Date.UTC(2026, 10, 2);
    const demo = { ...base, app: "demo", pro: "none" };
    assert.equal((await ingest(post({ ...demo, events: [] }), e, now)).status, 401, "another app's key is refused");
    assert.equal((await ingest(post({ ...demo, events: [
      { n: "level_won", p: { world: "2" } },
      { n: "paywall_shown", p: { context: "shop" } },
      { n: "file_read", p: { ext: "swift" } },
    ] }, { key: "demo-key" }), e, now)).status, 204);
    await ingest(post({ ...base, events: [{ n: "paywall_shown", p: { context: "settings" } }] }), e, now);
    assert.deepEqual(rows(e).filter((r) => r.app === "demo").map((r) => r.name), ["level_won", "paywall_shown"], "reader's own event isn't demo's");
    const s = await summary(e, "demo", 30, now);
    assert.deepEqual(s.paywalls.map((p) => p.context), ["shop"]);
    assert.deepEqual(s.panels[0].rows, [{ value: "2", count: 1, sessions: 1 }]);
    assert.deepEqual(s.funnel.steps, []);
  } finally {
    delete apps.demo;
    delete schemas.demo;
  }
});

// Access: a JWT signed like Cloudflare's, verified against the team's published key.
function accessToken({ aud = "aud-1", iss = "https://team.cloudflareaccess.com", exp = 4_000_000_000, email = "me@example.com" } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256" };
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = enc({ alg: "RS256", kid: "k1" }), body = enc({ aud: [aud], iss, exp, email });
  const signature = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey).toString("base64url");
  const fetchImpl = async () => new Response(JSON.stringify({ keys: [jwk] }));
  return { token: `${head}.${body}.${signature}`, fetchImpl };
}
const accessEnv = { TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: "aud-1" };
const withToken = (token) => new Request("https://dash/", { headers: token ? { "cf-access-jwt-assertion": token } : {} });

test("Access: a valid token passes, others don't", async () => {
  resetKeysForTests();
  const good = accessToken();
  assert.equal(await verify(withToken(good.token), accessEnv, { fetchImpl: good.fetchImpl }), "me@example.com");
  resetKeysForTests();
  const otherAud = accessToken({ aud: "aud-2" });
  assert.equal(await verify(withToken(otherAud.token), accessEnv, { fetchImpl: otherAud.fetchImpl }), null);
  resetKeysForTests();
  const expired = accessToken({ exp: 1 });
  assert.equal(await verify(withToken(expired.token), accessEnv, { fetchImpl: expired.fetchImpl }), null);
  resetKeysForTests();
  const forged = accessToken();
  const [h, b] = forged.token.split(".");
  const tampered = `${h}.${Buffer.from(JSON.stringify({ aud: ["aud-1"], iss: "https://team.cloudflareaccess.com", exp: 4_000_000_000, email: "x@evil" })).toString("base64url")}.${forged.token.split(".")[2]}`;
  assert.equal(await verify(withToken(tampered), accessEnv, { fetchImpl: forged.fetchImpl }), null);
  assert.equal(await verify(withToken(null), accessEnv), null);
  assert.equal(b.length > 0, true);
});

test("the dashboard needs a login set up, then a valid token", async () => {
  const e = env();
  assert.equal((await dashboard.fetch(new Request("https://dash/"), e)).status, 503);
  assert.equal((await dashboard.fetch(new Request("https://dash/"), { ...e, ...accessEnv })).status, 403);
});

test("without Access, a password of 12 characters or more lets you in with a signed cookie", async () => {
  const e = { ...env(), DASHBOARD_PASSWORD: "correct horse battery" };
  assert.equal((await dashboard.fetch(new Request("https://dash/"), { ...e, DASHBOARD_PASSWORD: "short" })).status, 503);
  const home = await dashboard.fetch(new Request("https://dash/"), e);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /action="\/login"/, "the login form, not the numbers");
  assert.equal((await dashboard.fetch(new Request("https://dash/api/summary"), e)).status, 401);
  const tryLogin = (password, extra = {}) => dashboard.fetch(new Request("https://dash/login", {
    method: "POST", body: new URLSearchParams({ password }), headers: { "cf-connecting-ip": "203.0.113.9" } }), { ...e, ...extra });
  assert.equal((await tryLogin("wrong")).status, 401);
  assert.equal((await tryLogin("correct horse battery", { LIMITER: { limit: async () => ({ success: false }) } })).status, 429, "the rate limit comes first");
  const ok = await tryLogin("correct horse battery");
  assert.equal(ok.status, 303);
  const cookie = ok.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  const withCookie = (path, value = cookie.split(";")[0]) => new Request("https://dash" + path, { headers: { cookie: value } });
  const page = await dashboard.fetch(withCookie("/"), e);
  assert.match(await page.text(), /Sign out/);
  assert.equal((await dashboard.fetch(withCookie("/api/summary?app=reader"), e)).status, 200);
  assert.equal((await dashboard.fetch(withCookie("/api/summary"), { ...e, DASHBOARD_PASSWORD: "another long password" })).status, 401,
               "a new password signs everyone out");
  const [expires] = cookie.split(";")[0].split("=")[1].split(".");
  assert.equal((await dashboard.fetch(withCookie("/api/summary", `skoro_stats=${Number(expires) + 1}.${cookie.split(".")[1].split(";")[0]}`), e)).status, 401,
               "a changed expiry breaks the signature");
  assert.equal((await dashboard.fetch(withCookie("/api/summary", "skoro_stats=1.abc"), e)).status, 401);
  assert.match((await dashboard.fetch(new Request("https://dash/logout", { method: "POST" }), e)).headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await dashboard.fetch(withCookie("/"), { ...e, ...accessEnv })).status, 403, "with Access set up, the password is ignored");
});

test("a picked day narrows every section but the daily list", async () => {
  const e = env();
  const other = "7f1c2b3a-1111-4222-8333-444455556666";
  await ingest(post({ ...base, events: [{ n: "first_run", p: { kind: "onboarding" } }, { n: "paywall_shown", p: { context: "onboarding" } }] }), e, Date.UTC(2026, 10, 1, 12));
  await ingest(post({ ...base, session: other, events: [{ n: "paywall_shown", p: { context: "settings" } }] }), e, Date.UTC(2026, 10, 2, 12));
  const now = Date.UTC(2026, 10, 2, 18);
  const all = await summary(e, "reader", 30, now);
  assert.equal(all.paywalls.length, 2);
  const s = await summary(e, "reader", 30, now, "2026-11-02");
  assert.equal(s.day, "2026-11-02");
  assert.deepEqual(s.daily.map((r) => r.day), ["2026-11-01", "2026-11-02"]);
  assert.deepEqual(s.paywalls.map((p) => p.context), ["settings"]);
  assert.deepEqual(s.breakdown.countries.map((r) => r.sessions), [1]);
});

test("filters stack with the day and spare their own breakdown", async () => {
  const e = env();
  const other = "7f1c2b3a-1111-4222-8333-444455556666";
  const third = "8f1c2b3a-1111-4222-8333-444455556666";
  await ingest(post({ ...base, events: [{ n: "paywall_shown", p: { context: "onboarding" } }] }, { country: "US" }), e, Date.UTC(2026, 10, 2, 12));
  await ingest(post({ ...base, session: other, events: [{ n: "paywall_shown", p: { context: "settings" } }] }, { country: "UA" }), e, Date.UTC(2026, 10, 2, 13));
  await ingest(post({ ...base, session: third, events: [{ n: "paywall_shown", p: { context: "settings" } }] }, { country: "US" }), e, Date.UTC(2026, 10, 1, 12));
  const now = Date.UTC(2026, 10, 2, 18);
  const s = await summary(e, "reader", 30, now, "2026-11-02", { country: "US", bogus: "x" });
  assert.deepEqual(s.filters, { country: "US" });
  assert.deepEqual(s.paywalls.map((p) => p.context), ["onboarding"]);
  assert.deepEqual(s.daily.map((r) => [r.day, r.sessions]), [["2026-11-01", 1], ["2026-11-02", 1]]);
  assert.deepEqual(s.breakdown.countries.map((r) => r.value).sort(), ["UA", "US"]);
  assert.deepEqual(s.breakdown.versions.map((r) => r.sessions), [1]);
});

test("a session that buys Pro and runs past midnight counts like it always did", async () => {
  const e = env();
  const other = "7f1c2b3a-1111-4222-8333-444455556666";
  await ingest(post({ ...base, events: [{ n: "first_run", p: { kind: "onboarding" } }] }), e, Date.UTC(2026, 10, 1, 23, 50));
  await ingest(post({ ...base, pro: "pro", events: [{ n: "locked_tap", p: { feature: "merge" } }] }), e, Date.UTC(2026, 10, 2, 0, 10));
  await ingest(post({ ...base, session: other, events: [{ n: "locked_tap", p: { feature: "merge" } }] }, { country: "US" }), e, Date.UTC(2026, 10, 2, 9));
  const now = Date.UTC(2026, 10, 2, 18);
  const s = await summary(e, "reader", 30, now);
  assert.deepEqual(s.daily, [{ day: "2026-11-01", sessions: 1, firstRuns: 1 }, { day: "2026-11-02", sessions: 2, firstRuns: 0 }],
                   "once on each day it was open in");
  assert.deepEqual(s.breakdown.countries, [{ value: "UA", sessions: 1 }, { value: "US", sessions: 1 }], "once over the period");
  assert.deepEqual(s.breakdown.pro, [{ value: "free", sessions: 2 }, { value: "pro", sessions: 1 }], "under both states");
  assert.deepEqual(s.adoption.days.map((d) => d.total), [1, 2]);
  const pro = await summary(e, "reader", 30, now, null, { pro: "pro" });
  assert.deepEqual(pro.daily, [{ day: "2026-11-02", sessions: 1, firstRuns: 0 }]);
  assert.deepEqual(pro.breakdown.pro.map((r) => r.value), ["free", "pro"], "the pro breakdown keeps the other value");
  assert.deepEqual(pro.breakdown.countries, [{ value: "UA", sessions: 1 }]);
});

test("the overview sets apps side by side and agrees with each app's own totals", async () => {
  apps.demo = { schema: { ...common }, panels: [] };
  schemas.demo = apps.demo.schema;
  try {
    const e = env({ APP_KEYS: JSON.stringify({ reader: KEY, demo: "demo-key" }) });
    const other = "7f1c2b3a-1111-4222-8333-444455556666";
    const third = "8f1c2b3a-1111-4222-8333-444455556666";
    const demo = { ...base, app: "demo", pro: "none", session: third };
    await ingest(post({ ...base, events: [{ n: "first_run", p: { kind: "onboarding" } }, { n: "paywall_shown", p: { context: "onboarding" } },
      { n: "purchase", p: { product: "yearly", context: "onboarding", outcome: "purchased" } }] }, { country: "US" }), e, Date.UTC(2026, 10, 1, 12));
    await ingest(post({ ...base, session: other, events: [{ n: "onboarding_step", p: { step: "paywall" } }] }), e, Date.UTC(2026, 10, 2, 12));
    await ingest(post({ ...demo, events: [{ n: "first_run", p: { kind: "onboarding" } }, { n: "paywall_shown", p: { context: "shop" } }] }, { key: "demo-key", country: "US" }), e, Date.UTC(2026, 10, 2, 13));
    const now = Date.UTC(2026, 10, 2, 18);

    const o = await overview(e, 30, now);
    const cv = o.perApp.find((a) => a.app === "reader"), dm = o.perApp.find((a) => a.app === "demo");
    assert.deepEqual(cv, { app: "reader", sessions: 2, firstRuns: 1, shown: 2, purchased: 1 }, "the unlogged first-run paywall counts too");
    assert.deepEqual(dm, { app: "demo", sessions: 1, firstRuns: 1, shown: 1, purchased: 0 });
    assert.ok(o.perApp.some((a) => a.app === "quiet" && a.sessions === 0), "an app without events is listed");
    const s = await summary(e, "reader", 30, now);
    assert.equal(s.paywalls.reduce((n, p) => n + p.shown, 0), cv.shown);
    assert.deepEqual(o.daily, [
      { day: "2026-11-01", sessions: 1, firstRuns: 1, apps: { reader: 1 } },
      { day: "2026-11-02", sessions: 2, firstRuns: 1, apps: { reader: 1, demo: 1 } },
    ]);
    assert.deepEqual(o.breakdown.countries.map((r) => [r.value, r.sessions]), [["US", 2], ["UA", 1]]);

    const us = await overview(e, 30, now, "2026-11-02", { country: "US", version: "3.0" });
    assert.deepEqual(us.filters, { country: "US" }, "a version means nothing across apps");
    assert.deepEqual(us.perApp.filter((a) => a.sessions).map((a) => a.app), ["demo"]);
    assert.deepEqual(us.breakdown.countries.map((r) => r.value).sort(), ["UA", "US"], "the country breakdown keeps the other countries");
  } finally {
    delete apps.demo;
    delete schemas.demo;
  }
});

test("the dashboard page offers all apps first", async () => {
  const { page } = await import("../src/page.js");
  assert.match(page("me"), /<select id="app" aria-label="App"><option value="\*">All apps<\/option><option>reader<\/option>/);
});

test("an empty dashboard shows where apps send, escaped", async () => {
  const { page } = await import("../src/page.js");
  const html = page("me", { ingest: "https://in.example</script>" });
  assert.match(html, /<section id="welcome">/);
  assert.ok(!html.includes("in.example</script>"), "the address can't close the script or the markup");
  const script = html.split("<script>")[1].split("</script>")[0];
  assert.doesNotThrow(() => new Function(script), "the page's script parses");
});

test("tiles compare with the period before, or with a picked day a week earlier", async () => {
  const e = env();
  const at = (day, session, events) => ingest(post({ ...base, session, events }), e, Date.parse(day + "T12:00:00Z"));
  const id = (n) => `${n}f1c2b3a-1111-4222-8333-444455556666`;
  await at("2026-10-18", id(1), [{ n: "first_run", p: { kind: "onboarding" } }, { n: "paywall_shown", p: { context: "settings" } }]);
  await at("2026-10-24", id(2), [{ n: "onboarding_step", p: { step: "paywall" } }]);
  await at("2026-10-25", id(3), [{ n: "paywall_shown", p: { context: "settings" } },
    { n: "purchase", p: { product: "yearly", context: "settings", outcome: "purchased" } }]);
  await at("2026-11-01", id(4), [{ n: "first_run", p: { kind: "onboarding" } }]);
  const now = Date.UTC(2026, 10, 1, 18);
  const s = await summary(e, "reader", 7, now);
  assert.equal(s.from, "2026-10-26");
  assert.deepEqual(s.previous, { sessions: 2, firstRuns: 0, shown: 2, purchased: 1, from: "2026-10-19" },
                   "Oct 19–25, without Oct 18; the unlogged first-run paywall counts as shown");
  const o = await overview(e, 7, now);
  assert.deepEqual(o.previous, s.previous, "the overview counts the same way");
  const week = await summary(e, "reader", 30, now, "2026-11-01");
  assert.deepEqual(week.previous, { sessions: 1, firstRuns: 0, shown: 1, purchased: 1, from: "2026-10-25" }, "Sunday vs the Sunday before");
});

test("version adoption keeps the four newest versions and folds the rest", () => {
  const rows = [["3.10", 5], ["3.9", 3], ["3.2", 1], ["3.1", 1], ["2.9.1", 2]].map(([version, sessions]) => ({ day: "2026-11-01", version, sessions }));
  const a = adoption(rows);
  assert.deepEqual(a.versions, ["3.10", "3.9", "3.2", "3.1", "older"], "3.10 is newer than 3.9");
  assert.deepEqual(a.days, [{ day: "2026-11-01", total: 12, versions: { "3.10": 5, "3.9": 3, "3.2": 1, "3.1": 1, older: 2 } }]);
  assert.deepEqual(adoption(rows.slice(0, 2)).versions, ["3.10", "3.9"]);
});

test("every view stays under D1's 50 queries per request on the free plan", async () => {
  const e = env();
  let queries = 0;
  const prepare = e.DB.prepare;
  e.DB.prepare = (sql) => { queries++; return prepare(sql); };
  for (const name of Object.keys(apps)) {
    queries = 0;
    await summary(e, name, 30, Date.UTC(2026, 10, 2), "2026-11-02", { country: "US", version: "3.0" });
    assert.ok(queries <= 45, `${name}: ${queries} queries, leave room under 50`);
  }
  queries = 0;
  await overview(e, 30, Date.UTC(2026, 10, 2));
  assert.ok(queries <= 45, `overview: ${queries} queries`);
});

test("no dashboard query reads a whole table, and events are read only by name", async () => {
  // D1's free tier counts rows read: a query may read a period of sessions, or of one
  // event's rows, never every event of the period.
  const e = env();
  const plans = [];
  const prepare = e.DB.prepare;
  e.DB.prepare = (sql) => {
    const statement = prepare(sql);
    return { ...statement, bind: (...args) => {
      const plan = e.DB.raw.prepare("EXPLAIN QUERY PLAN " + sql).all(...args).map((row) => row.detail);
      plans.push({ sql, plan });
      return statement.bind(...args);
    } };
  };
  for (const name of Object.keys(apps)) {
    await summary(e, name, 30, Date.UTC(2026, 10, 2));
    await summary(e, name, 30, Date.UTC(2026, 10, 2), "2026-11-02", { country: "US", version: "3.0", system: "iOS 18" });
  }
  await overview(e, 30, Date.UTC(2026, 10, 2));
  await overview(e, 7, Date.UTC(2026, 10, 2), "2026-11-02", { pro: "free" });
  assert.ok(plans.length >= 3 * (2 * Object.keys(apps).length + 2), "every view was checked");
  for (const { sql, plan } of plans) {
    for (const step of plan) {
      assert.doesNotMatch(step, /^SCAN (events|sessions)\b/, `${step}\n${sql}`);
      if (/\bevents\b/.test(step)) assert.match(step, /USING (COVERING )?INDEX events_app_name_day/, `${step}\n${sql}`);
    }
  }
});

test("the dashboard keeps an answer for a few minutes; Reload asks for fresh numbers", async () => {
  const good = accessToken();
  const kept = new Map();
  const realFetch = globalThis.fetch;
  globalThis.fetch = good.fetchImpl;
  globalThis.caches = { default: {
    match: async (key) => kept.get(key.url)?.clone(),
    put: async (key, response) => { kept.set(key.url, response); },
  } };
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  try {
    resetKeysForTests();
    const e = { ...env(), ...accessEnv };
    const get = async (query) => {
      const r = await dashboard.fetch(new Request("https://dash/api/summary?" + query, { headers: { "cf-access-jwt-assertion": good.token } }), e, ctx);
      await Promise.all(waits);
      assert.equal(r.headers.get("cache-control"), "no-store");
      return (await r.json()).daily.length;
    };
    assert.equal(await get("app=reader&days=30"), 0);
    await ingest(post({ ...base, events: [{ n: "first_run", p: { kind: "onboarding" } }] }), e, Date.now());
    assert.equal(await get("days=30&app=reader"), 0, "same view, parameters in any order: the kept answer");
    assert.equal(await get("app=reader&days=30&fresh=1"), 1, "Reload reads D1");
    assert.equal(await get("app=reader&days=30"), 1, "and refreshes the kept answer");
    assert.equal([...kept.keys()].every((url) => !url.includes("fresh")), true);
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.caches;
    resetKeysForTests();
  }
});
