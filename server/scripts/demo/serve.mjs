// The dashboard on your machine with made-up numbers: no Cloudflare account, no config.
//   npm run demo        then open http://localhost:8787  (EMPTY=1 for a fresh install)
// D1 is an in-memory node:sqlite with the migrations applied; 90 days of fictional
// sessions for two apps go through the real ingest, so every section has something to show.
// The page is served by the hosted demo's own Worker (worker.js).
import { createServer } from "node:http";
import { database } from "../../test/db.js";
import { demoKeys, fill } from "./data.js";
import demo from "./worker.js";

const PORT = Number(process.env.PORT) || 8787;
const DAY = 86_400_000;
const env = { DB: database() };

const started = Date.now();
const today = Math.floor(started / DAY) * DAY;
if (!process.env.EMPTY) await fill({ ...env, APP_KEYS: demoKeys() }, started, today - 89 * DAY, today + DAY); // EMPTY=1: a fresh install
const sessions = env.DB.raw.prepare("SELECT COUNT(DISTINCT session) AS n FROM sessions").get().n;

createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = new Request("http://localhost:" + PORT + req.url, { method: req.method, headers: new Headers(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
                                                                      body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
  const response = await demo.fetch(request, env);
  const headers = Object.fromEntries(response.headers);
  // Local only: let the page sit in a frame (phone-width previews); the real Workers forbid it.
  if (headers["content-security-policy"]) headers["content-security-policy"] = headers["content-security-policy"].replace(/; frame-ancestors 'none'/, "");
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, () => console.log(`Demo dashboard: http://localhost:${PORT}  (${sessions} made-up sessions, seeded in ${Date.now() - started} ms)`));
