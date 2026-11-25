// Cloudflare Access in front of the dashboard: its JWT is checked here too, so switching
// Access off by mistake doesn't open the numbers to everyone.

const decode = (part) => JSON.parse(new TextDecoder().decode(base64url(part)));

function base64url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

let cached = { url: null, keys: null, at: 0 };

async function keys(teamDomain, fetchImpl) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  if (cached.url === url && Date.now() - cached.at < 3_600_000) return cached.keys;
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error("certs");
  const { keys: list } = await response.json();
  cached = { url, keys: list, at: Date.now() };
  return list;
}

/// The signed-in email, or null. `TEAM_DOMAIN` is `<team>.cloudflareaccess.com`, `ACCESS_AUD`
/// the application's audience tag (Zero Trust › Access › Applications › the app › Overview).
export async function verify(request, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token || !env.TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const [head, body, signature] = token.split(".");
  if (!head || !body || !signature) return null;
  let header, claims;
  try { header = decode(head); claims = decode(body); } catch { return null; }
  if (header.alg !== "RS256") return null;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(env.ACCESS_AUD)) return null;
  if (claims.iss !== `https://${env.TEAM_DOMAIN}`) return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 < now) return null;
  const jwk = (await keys(env.TEAM_DOMAIN, fetchImpl)).find((key) => key.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64url(signature), new TextEncoder().encode(`${head}.${body}`));
  return valid ? (claims.email ?? "signed in") : null;
}

export function resetKeysForTests() { cached = { url: null, keys: null, at: 0 }; }
