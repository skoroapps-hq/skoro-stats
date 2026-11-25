// One-time setup on your Cloudflare account, from server/:  npm run setup
// Safe to run again: it skips what's already there. With --dry-run it only prints the
// wrangler commands that would change something.
//   1. config/ from config.example/ (your apps go in config/apps.js and config/schemas/)
//   2. the D1 database, its id written into both wrangler files
//   3. the migrations
//   4. an app key per app (the APP_KEYS secret), unless it's set already
//   5. the ingest Worker, then a dashboard password unless a login is set up, then the dashboard

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const dry = process.argv.includes("--dry-run");
const INGEST = "config/wrangler.toml";
const DASHBOARD = "config/wrangler.dashboard.toml";
const PLACEHOLDER = "REPLACE_WITH_DATABASE_ID";

const say = (text) => console.log(text);
const fail = (text) => { console.error("\n✗ " + text); process.exit(1); };

/// Runs wrangler and returns its output; `changes` commands only print under --dry-run.
function wrangler(args, { input, changes = true, quiet = false } = {}) {
  if (dry && changes) { say("  would run: wrangler " + args.join(" ")); return ""; }
  const run = spawnSync("npx", ["wrangler", ...args], { input, encoding: "utf8", stdio: [input ? "pipe" : "inherit", "pipe", "pipe"] });
  const out = (run.stdout ?? "") + (run.stderr ?? "");
  if (run.status !== 0) {
    if (/More than one account/.test(out)) {
      fail("Your login sees several Cloudflare accounts. Pick one and run again:\n  CLOUDFLARE_ACCOUNT_ID=<id> npm run setup\n" +
           out.split("\n").filter((line) => /`: `/.test(line)).join("\n"));
    }
    if (quiet) return null;
    fail(`wrangler ${args.join(" ")} failed:\n${out}`);
  }
  return out;
}

if (!existsSync("config.example")) fail("Run this from server/:  cd server && npm run setup");

// 1. config/
if (!existsSync("config")) {
  if (dry) fail("--dry-run needs a config/ folder: cp -r config.example config");
  cpSync("config.example", "config", { recursive: true });
  say("✓ config/ made from config.example/. Your apps go in config/apps.js; this run sets up the example app.");
} else say("✓ config/ is there");

// Signed in?
const who = wrangler(["whoami"], { changes: false });
if (/not authenticated/i.test(who)) fail("Sign in first:  npx wrangler login");

// 2. The database
const toml = () => readFileSync(INGEST, "utf8");
const name = toml().match(/database_name\s*=\s*"([^"]+)"/)?.[1] ?? "skoro-stats";
if (toml().includes(PLACEHOLDER)) {
  const listed = JSON.parse(wrangler(["d1", "list", "--json"], { changes: false }) || "[]");
  let id = listed.find((db) => db.name === name)?.uuid;
  if (!id) {
    const created = wrangler(["d1", "create", name]);
    id = created.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
    if (!id && !dry) fail("Couldn't read the new database's id from wrangler's output:\n" + created);
  }
  if (id) {
    if (!dry) for (const file of [INGEST, DASHBOARD]) writeFileSync(file, readFileSync(file, "utf8").replace(PLACEHOLDER, id));
    say(`✓ D1 database ${name} (${id}), written into both wrangler files`);
  }
} else say(`✓ D1 database ${name} is in the wrangler files`);

// 3. Migrations
wrangler(["d1", "migrations", "apply", "DB", "--remote", "-c", INGEST], { input: "y\n" });
say("✓ migrations applied");

// 4. App keys
const { apps } = await import(new URL("../config/apps.js", import.meta.url));
const secrets = (file) => {
  const out = wrangler(["secret", "list", "--format", "json", "-c", file], { changes: false, quiet: true });
  try { return JSON.parse(out ?? "[]").map((s) => s.name); } catch { return []; }
};
let keys = null;
if (!secrets(INGEST).includes("APP_KEYS")) {
  keys = Object.fromEntries(Object.keys(apps).map((app) => [app, randomBytes(16).toString("hex")]));
} else say("✓ APP_KEYS is set (to add an app or change a key, put the whole map again: README › Adding an app)");

// 5. Workers
const deployed = wrangler(["deploy", "-c", INGEST]);
if (keys) {
  wrangler(["secret", "put", "APP_KEYS", "-c", INGEST], { input: JSON.stringify(keys) });
  say("✓ APP_KEYS set");
}
const ingestURL = deployed.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0] ?? "https://<your ingest Worker>";

// The empty dashboard shows where apps send.
if (!dry && ingestURL.startsWith("https://") && !ingestURL.includes("<")) {
  writeFileSync(DASHBOARD, readFileSync(DASHBOARD, "utf8").replace(/^INGEST_URL = ""$/m, `INGEST_URL = "${ingestURL}"`));
}
let password = null;
const dashboardToml = readFileSync(DASHBOARD, "utf8");
const access = /^\s*TEAM_DOMAIN\s*=/m.test(dashboardToml) && /^\s*ACCESS_AUD\s*=/m.test(dashboardToml);
const dashboard = wrangler(["deploy", "-c", DASHBOARD]);
if (!access && !secrets(DASHBOARD).includes("DASHBOARD_PASSWORD")) {
  password = randomBytes(15).toString("base64url");
  wrangler(["secret", "put", "DASHBOARD_PASSWORD", "-c", DASHBOARD], { input: password });
}
const dashboardURL = dashboard.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0] ?? "https://<your dashboard Worker>";

say(`
Done.
  Endpoint:   ${ingestURL}/v1/events
  Dashboard:  ${dashboardURL}`);
if (dry) say("  (dry run: nothing was changed, no key or password was made)");
else if (password) say(`  Password:   ${password}   (shown once; change it with: npx wrangler secret put DASHBOARD_PASSWORD -c ${DASHBOARD})`);
if (keys && !dry) {
  say("  App keys (shown once; they go in your apps, not in git):");
  for (const [app, key] of Object.entries(keys)) say(`    ${app}: ${key}`);
}
say(`
In the app (Swift):
  HTTPStatsTransport(app: "<app>", key: "<key>", endpoint: URL(string: "${ingestURL}/v1/events")!)
Kotlin:
  HttpStatsTransport(app = "<app>", key = "<key>", endpoint = "${ingestURL}/v1/events", ...)`);
