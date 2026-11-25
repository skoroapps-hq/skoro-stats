// The public demo (demo.skorostats.com): the real dashboard over made-up numbers, open to
// everyone. Never deploy it for real apps: it signs every visitor in.
//
// Every visitor gets the same signed-in view, and the demo only reads: sign-in, sign-out and
// any other write go back to the page. An hourly job adds that hour's made-up sessions through
// the real ingest and keeps 90 days. `npm run demo` serves this same Worker on your machine.
import dashboard from "../../src/dashboard.js";
import { prune } from "../../src/ingest.js";
import { demoKeys, fill, reseed } from "./data.js";

const PASSWORD = "demo-password-not-secret";
export const KEEP_DAYS = 90;
const HOUR = 3_600_000;
// Answers are kept an hour (the numbers change hourly), under their own key so they don't mix
// with the dashboard's own 5-minute copies. Reload's fresh=1 is ignored: everyone shares them.
const KEEP_SECONDS = 3600;

/// The env the dashboard and the ingest see: the database, and the demo's own password and keys.
const demoEnv = (env) => ({ DB: env.DB, DASHBOARD_PASSWORD: PASSWORD, APP_KEYS: demoKeys() });

let cookie = null;
async function signedIn(env) {
  cookie ??= (await dashboard.fetch(new Request("https://demo/login", { method: "POST", body: new URLSearchParams({ password: PASSWORD }) }), env))
    .headers.get("set-cookie").split(";")[0];
  return cookie;
}

const NOTE = `Live demo with made-up numbers · <a href="https://skorostats.com">skorostats.com</a>`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 303, headers: { location: "/" } });
    const api = url.pathname.startsWith("/api/");
    if (api && env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: request.headers.get("cf-connecting-ip") ?? "" });
      if (!success) return new Response("Too many requests. Wait a minute.", { status: 429 });
    }
    url.searchParams.delete("fresh");
    url.searchParams.sort();
    const cache = api ? globalThis.caches?.default : null;
    const key = new Request(`https://demo-cache.invalid${url.pathname}${url.search}`);
    // Kept at Cloudflare only; browsers always ask, so they see each hour's new numbers.
    const fresh = (response) => { response = new Response(response.body, response); response.headers.set("cache-control", "no-store"); return response; };
    if (cache) {
      const kept = await cache.match(key);
      if (kept) return fresh(kept);
    }
    const demo = demoEnv(env);
    const headers = new Headers(request.headers);
    headers.set("cookie", await signedIn(demo));
    let response = await dashboard.fetch(new Request(url, { method: "GET", headers }), demo, ctx);
    if (cache && response.ok) {
      response = new Response(response.body, response);
      response.headers.set("cache-control", `public, max-age=${KEEP_SECONDS}`);
      ctx?.waitUntil(cache.put(key, response.clone()));
      response = fresh(response);
    }
    // The page says "Signed in with the password · Sign out"; here it says what it is.
    if (url.pathname === "/" && typeof HTMLRewriter === "function") {
      response = new HTMLRewriter().on("form.signout", { element: (form) => form.replace(NOTE, { html: true }) }).transform(response);
    }
    return response;
  },

  /// Hourly: this hour's made-up sessions, then everything older than 90 days goes.
  async scheduled(event, env) {
    const now = event?.scheduledTime ?? Date.now();
    const hour = Math.floor(now / HOUR) * HOUR;
    reseed(hour / HOUR);
    const demo = demoEnv(env);
    await fill(demo, now, hour, hour + HOUR);
    await prune(demo, now, KEEP_DAYS);
  },
};
