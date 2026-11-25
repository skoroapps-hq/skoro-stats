// The demo's made-up numbers: fictional sessions for the demo apps, sent through the real
// ingest. `npm run demo` fills 90 days at once; the hosted demo (worker.js) adds an hour at a time.
import { ingest } from "../../src/ingest.js";
import { apps } from "#apps";

export const KEY = "demo";
/// The env the ingest needs to take the demo's sessions: every app with the demo key.
export const demoKeys = () => JSON.stringify(Object.fromEntries(Object.keys(apps).map((a) => [a, KEY])));

// A seeded random, so every run draws the same numbers.
let seed = 42;
export const reseed = (value) => { seed = value | 0; };
const random = () => { // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (weights) => { let r = random() * Object.values(weights).reduce((a, b) => a + b, 0); for (const [k, w] of Object.entries(weights)) if ((r -= w) <= 0) return k; return Object.keys(weights)[0]; };
const chance = (p) => random() < p;
const uuid = () => "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(random() * 16).toString(16));

const COUNTRIES = { US: 30, GB: 9, DE: 9, JP: 7, FR: 6, CA: 5, UA: 4, BR: 4, AU: 3, IN: 3, NL: 2, ES: 2 };
const DAY = 86_400_000;

/// The version a session runs, day `d` days ago: each release takes over in about a week.
function version(releases, d) {
  const live = releases.filter((r) => r.ago >= d);
  for (let i = live.length - 1; i >= 0; i--) { if (chance(Math.min(0.92, (live[i].ago - d + 1) / 7))) return live[i].v; }
  return live[0].v;
}

const plans = {
  example: { daily: 70, growth: 0.006, releases: [{ v: "1.3", ago: 120 }, { v: "1.4", ago: 50 }, { v: "1.5", ago: 12 }],
    steps: ["welcome", "notifications", "paywall", "done"], products: { monthly: 3, yearly: 5, lifetime: 1 },
    own: (send, days) => {
      send("session_start", { days, notes: pick({ "0": 2, "1-5": 4, "6-20": 3, "21+": 1 }) });
      for (let i = 0; i < pick({ 0: 4, 1: 3, 2: 2, 3: 1 }); i++) send("note_created", { from: pick({ home: 6, widget: 2, share: 1 }) });
      if (chance(0.15)) send("export", { format: pick({ pdf: 4, markdown: 3, text: 1 }), outcome: pick({ done: 12, failed: 1, cancelled: 2 }) });
      if (chance(0.03)) send("review_prompt", { trigger: "export" });
    }, locked: { export_pdf: 3, themes: 2, sync: 4 } },
  habits: { daily: 45, growth: 0.012, releases: [{ v: "2.0", ago: 150 }, { v: "2.1", ago: 30 }],
    steps: ["welcome", "first_habit", "reminders", "paywall"], products: { yearly: 4, lifetime: 2 },
    own: (send, days) => {
      send("session_start", { days, habits: pick({ "0": 1, "1-3": 5, "4-10": 3, "11+": 1 }) });
      for (let i = 0; i < pick({ 0: 2, 1: 4, 2: 3, 3: 2 }); i++) send("habit_checked", { streak: pick({ "1": 3, "2-6": 4, "7-29": 3, "30+": 1 }) });
      if (chance(0.02)) send("widget_added", { size: pick({ small: 4, medium: 3, large: 1 }) });
    }, locked: { stats: 3, unlimited: 5 } },
};

/// Sessions with times in [from, to), at each day's rate (a share of it for part of a day).
/// `now` sets which day is "today": the newest release and the growth are counted from it.
export async function fill(env, now, from, to) {
  const today = Math.floor(now / DAY) * DAY;
  for (const [app, plan] of Object.entries(plans)) {
    if (!apps[app]) continue;
    for (let at = Math.floor(from / DAY) * DAY; at < to; at += DAY) {
      const start = Math.max(from, at), end = Math.min(to, at + DAY);
      const d = Math.round((today - at) / DAY);
      const weekend = [0, 6].includes(new Date(at).getUTCDay());
      const expected = plan.daily * (1 + plan.growth * (89 - d)) * (weekend ? 1.25 : 1) * (0.85 + random() * 0.3) * (end - start) / DAY;
      const count = Math.floor(expected + random()); // an hour's share rounds up or down at random
      for (let s = 0; s < count; s++) {
        const events = [], send = (n, p, t = events.length * 4000) => events.push({ n, p, t });
        const first = chance(0.18);
        const android = chance(0.3);
        const tier = first ? "free" : pick({ free: 70, pro: 22, trial: 5, legacy: 3 });
        const days = first ? "0" : pick({ "1": 2, "2-7": 4, "8-30": 4, "31+": 3 });
        if (first) {
          send("first_run", { kind: "onboarding" });
          let i = 0;
          for (const step of plan.steps) { if (i++ && !chance(0.82)) break; send("onboarding_step", { step }); if (step === "paywall") { send("paywall_shown", { context: "onboarding" }); if (chance(0.9)) send("paywall_closed", { context: "onboarding", seconds: pick({ "0-3": 5, "3-10": 3, "10-30": 1, "30+": 1 }) }); } }
        }
        plan.own(send, days);
        if (tier === "free" && chance(0.12)) {
          const feature = pick(plan.locked);
          send("locked_tap", { feature });
          send("paywall_shown", { context: "feature." + feature });
          if (chance(0.09)) send("purchase", { product: pick(plan.products), context: "feature." + feature, outcome: pick({ purchased: 9, cancelled: 3, failed: 1 }) });
          else send("paywall_closed", { context: "feature." + feature, seconds: pick({ "0-3": 4, "3-10": 3, "10-30": 2, "30+": 1 }) });
        }
        if (first && events.some((e) => e.n === "paywall_shown") && chance(0.06)) send("purchase", { product: pick(plan.products), context: "onboarding", outcome: "purchased" });
        const body = { app, v: version(plan.releases, d), build: "1", os: android ? pick({ "14": 3, "15": 5, "16": 2 }) : pick({ "17": 2, "18": 5, "26": 4 }),
          lang: "en", pro: tier, device: android ? (chance(0.1) ? "android_tablet" : "android") : (chance(0.15) ? "ipad" : "iphone"), session: uuid(), events };
        const request = new Request("http://demo/v1/events", { method: "POST", body: JSON.stringify(body), headers: { "x-stats-key": KEY, "content-type": "application/json" } });
        Object.defineProperty(request, "cf", { value: { country: pick(COUNTRIES) } });
        await ingest(request, env, start + Math.floor(random() * (end - start)));
      }
    }
  }
}
