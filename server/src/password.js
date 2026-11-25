// The password login, for dashboards without Cloudflare Access: one shared password
// (the DASHBOARD_PASSWORD secret), and a signed cookie that lasts 30 days. Changing the
// password signs everyone out, since the cookie is signed with it.

export const COOKIE = "skoro_stats";
const DAYS = 30;
const MIN_LENGTH = 12;

const encoder = new TextEncoder();
const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const passwordSet = (env) => typeof env.DASHBOARD_PASSWORD === "string" && env.DASHBOARD_PASSWORD.length >= MIN_LENGTH;

async function sign(env, text) {
  const key = await crypto.subtle.importKey("raw", encoder.encode("skoro-stats cookie\n" + env.DASHBOARD_PASSWORD),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
}

/// Equal strings, in a time that doesn't depend on where they first differ.
async function same(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", encoder.encode(s))));
  const left = new Uint8Array(x), right = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function cookieValue(request) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}

/// "password" when the request carries a valid, unexpired cookie, or null.
export async function checkCookie(request, env, now = Date.now()) {
  if (!passwordSet(env)) return null;
  const [expires, signature] = (cookieValue(request) ?? "").split(".");
  if (!/^\d+$/.test(expires ?? "") || Number(expires) < now || !signature) return null;
  return (await same(signature, await sign(env, expires))) ? "password" : null;
}

/// The response to POST /login: a cookie and a redirect home, or the form again.
export async function login(request, env, now = Date.now()) {
  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: "login:" + (request.headers.get("cf-connecting-ip") ?? "") });
    if (!success) return loginPage("Too many tries. Wait a minute.", 429);
  }
  const form = await request.formData().catch(() => null);
  const given = form?.get("password");
  if (typeof given !== "string" || !(await same(given, env.DASHBOARD_PASSWORD))) return loginPage("Wrong password.", 401);
  const expires = String(now + DAYS * 86_400_000);
  return new Response(null, { status: 303, headers: {
    location: "/",
    "set-cookie": `${COOKIE}=${expires}.${await sign(env, expires)}; Path=/; Max-Age=${DAYS * 86_400}; HttpOnly; Secure; SameSite=Strict`,
  } });
}

export const logout = () => new Response(null, { status: 303, headers: {
  location: "/", "set-cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
} });

export function loginPage(message = "", status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>App Statistics</title><style>
:root { color-scheme: light dark; --fg: #1d1d1f; --bg: #f5f5f7; --card: #fff; --line: #d2d2d7; --muted: #6e6e73; }
@media (prefers-color-scheme: dark) { :root { --fg: #f5f5f7; --bg: #000; --card: #1c1c1e; --line: #38383a; --muted: #98989d; } }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font: 15px/1.4 -apple-system, system-ui, sans-serif; }
form { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 24px; width: min(320px, calc(100vw - 32px)); box-sizing: border-box; }
h1 { font-size: 20px; margin: 0 0 16px; } input, button { font: inherit; width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--fg); }
button { margin-top: 12px; cursor: pointer; } p { color: var(--muted); margin: 10px 0 0; }
</style></head><body><form method="post" action="/login"><h1>App Statistics</h1>
<input type="password" name="password" aria-label="Password" placeholder="Password" autocomplete="current-password" required autofocus>
<button>Sign in</button>${message ? `<p role="alert">${message}</p>` : ""}</form></body></html>`;
  return new Response(html, { status, headers: {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  } });
}
