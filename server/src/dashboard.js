// skoro-stats-dashboard: the numbers, behind Cloudflare Access or a password.

import { verify } from "./access.js";
import { checkCookie, login, loginPage, logout, passwordSet } from "./password.js";
import { apps } from "#apps";
import { page } from "./page.js";
import { FILTERS, overview, summary } from "./queries.js";

const KEEP_SECONDS = 300;

const withHeaders = (response, headers) => {
  const copy = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) copy.headers.set(name, value);
  return copy;
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Cloudflare Access when it's set up (the password is then ignored), else the password.
    const access = Boolean(env.TEAM_DOMAIN && env.ACCESS_AUD);
    if (!access && !passwordSet(env)) {
      return new Response("Set up a login: Cloudflare Access (TEAM_DOMAIN and ACCESS_AUD), or a DASHBOARD_PASSWORD secret of 12 characters or more (see README).",
                          { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (!access && request.method === "POST" && url.pathname === "/login") return login(request, env);
    if (!access && request.method === "POST" && url.pathname === "/logout") return logout();
    const who = access ? await verify(request, env) : await checkCookie(request, env);
    if (!who) return access ? new Response("Forbidden", { status: 403 }) : url.pathname === "/" ? loginPage() : new Response("Unauthorized", { status: 401 });
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    // /api/summary: one app; /api/overview: all apps side by side.
    if (url.pathname === "/api/summary" || url.pathname === "/api/overview") {
      // Every click on the page reloads every panel, and each panel reads the whole period
      // from D1, so the same view is kept for a few minutes (D1's free tier counts rows read).
      // Reload asks for fresh numbers (fresh=1) and refreshes the kept copy. Only reached
      // after the login let the request in; the numbers are the same for everyone allowed.
      const cache = globalThis.caches?.default;
      const fresh = url.searchParams.get("fresh") === "1";
      url.searchParams.delete("fresh");
      url.searchParams.sort();
      const key = new Request(url.toString());
      if (cache && !fresh) {
        const kept = await cache.match(key);
        if (kept) return withHeaders(kept, { "cache-control": "no-store" });
      }
      const days = Math.min(400, Math.max(1, Number(url.searchParams.get("days")) || 30));
      const day = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("day") ?? "") ? url.searchParams.get("day") : null;
      const filters = Object.fromEntries(FILTERS.filter((column) => url.searchParams.has(column))
        .map((column) => [column, url.searchParams.get(column).slice(0, 64)]));
      const body = url.pathname === "/api/overview"
        ? await overview(env, days, Date.now(), day, filters)
        : await summary(env, url.searchParams.get("app") || Object.keys(apps)[0], days, Date.now(), day, filters);
      const text = JSON.stringify(body);
      if (cache) {
        ctx?.waitUntil(cache.put(key, new Response(text, {
          headers: { "content-type": "application/json", "cache-control": `max-age=${KEEP_SECONDS}` },
        })));
      }
      return new Response(text, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    if (url.pathname === "/") {
      return new Response(page(who, { signOut: !access, ingest: env.INGEST_URL }), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'",
        },
      });
    }
    return new Response("Not found", { status: 404 });
  },
};
