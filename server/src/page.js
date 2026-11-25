// The dashboard page: one HTML document, its data from /api/summary (one app) or
// /api/overview (all apps). Charts are inline SVG drawn here; no libraries.

import { apps } from "#apps";

const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function page(who, { signOut = false, ingest = "" } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>App Statistics</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%231691b3'/%3E%3Cpath d='M8 22l5-6 4 3 7-9' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<style>
:root { --bg: #f4f6f7; --card: #fff; --fg: #142027; --muted: #5d6d75; --line: #dde6e9; --accent: #1691b3; --good: #1f9d5c; --bar: #cfe9f1; --weekend: #fbf3e2; --weekend-fg: #a26a00; --picked: #dff1f7; --bad: #c4473a;
  /* chart series, in fixed order (checked for colour blindness against these cards) */
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --s5: #e87ba4; --s6: #6250d6; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1316; --card: #152025; --fg: #e3ecef; --muted: #8fa1a8; --line: #24343b; --accent: #55c6e5; --good: #47cf87; --bar: #1d3c48; --weekend: #231f17; --weekend-fg: #e0b25c; --picked: #183846; --bad: #ef7b6e;
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; --s6: #9085e9; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.45 -apple-system, system-ui, "Segoe UI", sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 20px max(16px, env(safe-area-inset-left)) 48px max(16px, env(safe-area-inset-right)); display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
main > * { min-width: 0; }
header { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; justify-content: space-between; }
h1 { margin: 0; font-size: 26px; }
h2 { margin: 0 0 10px; font-size: 16px; }
.muted { color: var(--muted); font-size: 13px; }
.controls { display: flex; gap: 8px; flex-wrap: wrap; }
select, button { font: inherit; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--fg); }
.grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
section { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; min-width: 0; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
.tile b { display: block; font-size: 26px; font-variant-numeric: tabular-nums; }
.scroll { overflow: auto; max-height: 384px; }
/* stacking: bar 0 < its number 1 < pinned day 2 < sticky header 3 < header's day 4 */
thead th { position: sticky; top: 0; background: var(--card); z-index: 3; }
/* separate, not collapse: with collapsed borders a sticky header lets scrolled rows show through */
table { width: 100%; border-collapse: separate; border-spacing: 0; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
th { color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
td.n { text-align: right; }
.bar { position: relative; }
.bar span { position: absolute; inset: 3px auto 3px 0; background: var(--bar); border-radius: 4px; z-index: 0; }
.bar em { position: relative; z-index: 1; font-style: normal; }
.good { color: var(--good); font-weight: 600; }
.empty { color: var(--muted); padding: 8px 0; }
tr.weekend td { background: var(--weekend); }
tr.weekend td:first-child small { color: var(--weekend-fg); font-weight: 600; }
td small { color: var(--muted); margin-left: 6px; }
#daily tbody tr, .pickable tbody tr, #apps tbody tr { cursor: pointer; }
#daily tbody tr:hover td, .pickable tbody tr:hover td, #apps tbody tr:hover td { filter: brightness(1.08); }
body.overall .one-app, body:not(.overall) .all-apps { display: none; }
tr.picked td { background: var(--picked); box-shadow: inset 0 1px 0 var(--accent), inset 0 -1px 0 var(--accent); }
tr.picked .bar span { background: var(--accent); opacity: .35; }
/* the day stays in view when the per-app columns scroll sideways */
#daily th:first-child, #daily td:first-child { position: sticky; left: 0; z-index: 2; background: var(--card); }
#daily th:first-child { z-index: 4; }
#daily tr.weekend td:first-child { background: var(--weekend); }
#daily tr.picked td:first-child { background: var(--picked); }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 6px 6px 12px; border-radius: 999px; border: 1px solid var(--accent); color: var(--accent); font-weight: 600; }
.chip button { border: 0; padding: 0 8px; border-radius: 999px; background: transparent; color: inherit; font-size: 18px; line-height: 1; cursor: pointer; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chips:empty { display: none; }
/* tap a heading to fold its section; remembered in this browser */
section > h2 { cursor: pointer; user-select: none; -webkit-user-select: none; }
section > h2::before { content: "▾"; display: inline-block; width: 1em; color: var(--muted); transition: transform .15s; }
section.folded > h2::before { transform: rotate(-90deg); }
section.folded { align-self: start; }
section.folded > h2 { margin-bottom: 0; }
section.folded > :not(h2) { display: none; }
.nodata { grid-column: 1 / -1; }
.nodata div { color: var(--muted); font-size: 13px; }
.delta { display: block; font-size: 12px; font-weight: 600; margin-top: 2px; }
.delta.up { color: var(--good); } .delta.down { color: var(--bad); } .delta.flat { color: var(--muted); font-weight: 400; }
.compare { margin-top: 10px; }
.chart .plot { position: relative; }
.chart svg { display: block; cursor: crosshair; touch-action: pan-y; }
.chart .grid-line { stroke: var(--line); stroke-width: 1; }
.chart .axis { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.chart .series { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.chart .total { stroke-width: 2.5; }
.chart .cross { stroke: var(--muted); stroke-width: 1; }
.chart .picked-day { stroke: var(--accent); stroke-width: 1; stroke-dasharray: 3 3; }
.chart .dot { stroke: var(--card); stroke-width: 2; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 8px; font-size: 13px; color: var(--muted); }
.legend i, .tip i { display: inline-block; width: 12px; height: 3px; border-radius: 2px; vertical-align: middle; margin-right: 6px; }
.tip { position: absolute; top: 4px; pointer-events: none; background: var(--card); border: 1px solid var(--line); border-radius: 8px;
  padding: 6px 10px; font-size: 12px; box-shadow: 0 4px 14px rgb(0 0 0 / .15); white-space: nowrap; font-variant-numeric: tabular-nums; z-index: 5; }
.tip b { display: block; margin-bottom: 2px; }
.signout { display: inline; } .signout button { border: 0; padding: 0; background: none; color: inherit; text-decoration: underline; cursor: pointer; }
.tip span { color: var(--muted); }
#welcome h2 { cursor: default; } #welcome h2::before { content: none; }
#welcome p { margin: 0 0 10px; color: var(--muted); }
#welcome pre { margin: 0; padding: 12px; border-radius: 8px; background: var(--bg); border: 1px solid var(--line); overflow: auto; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; }
#welcome code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
body:not(.nothing) #welcome, body.nothing main > :not(header):not(#welcome):not(footer) { display: none; }
footer { text-align: center; color: var(--muted); font-size: 12px; }
footer a { color: inherit; }
@media (max-width: 600px) { h1 { font-size: 22px; } .tile b { font-size: 22px; } section { padding: 12px; border-radius: 12px; } th, td { padding: 6px; } }
</style>
</head>
<body>
<main>
  <header>
    <div><h1>App Statistics</h1><div class="muted">${signOut ? `<form method="post" action="/logout" class="signout">Signed in with the password · <button>Sign out</button></form>` : `Signed in as ${escape(who)}`} · anonymous events, no identifiers</div></div>
    <div class="controls">
      <select id="app" aria-label="App"><option value="*">All apps</option>${Object.keys(apps).map((app) => `<option>${escape(app)}</option>`).join("")}</select>
      <select id="days" aria-label="Period"><option value="7">7 days</option><option value="30" selected>30 days</option><option value="90">90 days</option><option value="365">365 days</option></select>
      <button id="reload">Reload</button>
    </div>
  </header>
  <div class="chips" id="chips"></div>
  <section id="welcome"><h2>No events yet</h2>
    <p>Nothing has arrived in this period. Apps send to <code>${escape(ingest || "https://<your ingest Worker>")}/v1/events</code> (Release builds only, if you followed the README). To check the server, send one test event, which counts as one session:</p>
    <pre id="curl"></pre></section>
  <section><div class="tiles" id="tiles"></div><div class="muted compare" id="compare"></div></section>
  <section class="all-apps"><h2>Apps <span class="muted" style="font-weight:400">· tap to open</span></h2><div class="scroll" id="apps"></div></section>
  <section><h2>Sessions <span class="muted" style="font-weight:400">· tap a day to filter</span></h2><div class="chart" id="trend"></div></section>
  <div class="grid">
    <section><h2>Sessions by day <span class="muted" style="font-weight:400">· tap a day to filter</span></h2><div class="scroll" id="daily"></div></section>
    <section class="one-app"><h2>Onboarding</h2><div class="scroll" id="funnel"></div></section>
  </div>
  <section class="one-app"><h2>Paywall by context</h2><div class="scroll" id="paywalls"></div></section>
  <div class="grid one-app">
    <section><h2>Locked features tapped</h2><div class="scroll" id="locked"></div></section>
    <section><h2>Purchases</h2><div class="scroll" id="products"></div></section>
  </div>
  <div class="grid">
    <section><h2>Days since install</h2><div class="scroll" id="returning"></div></section>
    <section class="one-app"><h2>Versions <span class="muted" style="font-weight:400">· tap to filter</span></h2><div class="scroll pickable" id="versions" data-column="version"></div></section>
    <section><h2>OS <span class="muted" style="font-weight:400">· tap to filter</span></h2><div class="scroll pickable" id="systems" data-column="system"></div></section>
    <section><h2>Countries <span class="muted" style="font-weight:400">· tap to filter</span></h2><div class="scroll pickable" id="countries" data-column="country"></div></section>
    <section><h2>Pro state <span class="muted" style="font-weight:400">· tap to filter</span></h2><div class="scroll pickable" id="pro" data-column="pro"></div></section>
    <section><h2>Devices <span class="muted" style="font-weight:400">· tap to filter</span></h2><div class="scroll pickable" id="devices" data-column="device"></div></section>
  </div>
  <div class="grid one-app" id="panels"></div>
  <section class="one-app"><h2>Version adoption <span class="muted" style="font-weight:400">· share of each day’s sessions</span></h2><div class="chart" id="adoption"></div></section>
  <footer>Anonymous, allowlisted events · <a href="https://github.com/skoroapps-hq/skoro-stats" target="_blank" rel="noopener">skoro-stats</a></footer>
</main>
<script>
const INGEST = ${JSON.stringify(ingest || "https://<your ingest Worker>").replace(/</g, "\\u003c")};
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (v) => typeof v === "number" ? v.toLocaleString("en-US") : v;
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + "%" : "—";
function table(rows, columns, barKey, rowAttrs) {
  if (!rows.length) return '<div class="empty">Nothing yet.</div>';
  const max = barKey ? Math.max(...rows.map((r) => r[barKey] || 0), 1) : 1;
  return "<table><thead><tr>" + columns.map((c) => "<th>" + esc(c[0]) + "</th>").join("") + "</tr></thead><tbody>" +
    rows.map((r) => "<tr" + (rowAttrs ? rowAttrs(r) : "") + ">" + columns.map((c) => {
      const v = typeof c[1] === "function" ? c[1](r) : r[c[1]];
      if (barKey && c[1] === barKey) return '<td class="n bar"><span style="width:' + (100 * (v || 0) / max) + '%"></span><em>' + esc(num(v)) + "</em></td>";
      return '<td class="' + (typeof v === "number" ? "n" : "") + '">' + (c[2] ? v : esc(num(v))) + "</td>";
    }).join("") + "</tr>").join("") + "</tbody></table>";
}
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SERIES = 6; // --s1 … --s6; a series past these isn't drawn in its own colour
const seriesColor = (i) => "var(--s" + (i + 1) + ")";
/// Every day of the period, so days without events show as 0 rather than vanish.
function dayList(from, days) {
  const start = Date.parse(from + "T00:00:00Z");
  return Array.from({ length: days }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10));
}
const niceMax = (v) => { const p = 10 ** Math.floor(Math.log10(v)); return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v); };
/// A line chart over days: one axis, a legend, a crosshair with every series' value, and a tap
/// picks the day. spec: { days, series: [{ name, color, values, total }], percent, onPick }.
/// A null value breaks its line (a day with nothing to divide).
function lineChart(el, spec) {
  el._spec = spec;
  const W = Math.max(260, el.clientWidth), H = 190, L = 38, R = 10, T = 10, B = 22, n = spec.days.length;
  const all = spec.series.flatMap((s) => s.values).filter((v) => v != null);
  if (!all.some((v) => v > 0)) { el.innerHTML = '<div class="empty">Nothing yet.</div>'; return; }
  const max = spec.percent ? 100 : niceMax(Math.max(1, ...all));
  const step = n > 1 ? (W - L - R) / (n - 1) : 0;
  const x = (i) => L + (n > 1 ? i * step : (W - L - R) / 2), y = (v) => T + (H - T - B) * (1 - v / max);
  const fmt = (v) => v == null ? "—" : spec.percent ? v.toFixed(1) + "%" : String(v);
  const tick = (v) => spec.percent ? v + "%" : v >= 10000 ? Math.round(v / 1000) + "k" : String(+v.toFixed(1));
  let svg = '<svg width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(spec.series.map((s) => s.name).join(", ")) + ' by day">';
  for (const v of [0, max / 2, max]) svg += '<line class="grid-line" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
    '<text class="axis" x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + tick(v) + "</text>";
  const labelled = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1] : [0];
  for (const i of labelled) svg += '<text class="axis" x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? "start" : i === n - 1 ? "end" : "middle") + '">' + spec.days[i].slice(5) + "</text>";
  const pickedAt = spec.days.indexOf(picked);
  if (pickedAt >= 0) svg += '<line class="picked-day" x1="' + x(pickedAt) + '" x2="' + x(pickedAt) + '" y1="' + T + '" y2="' + (H - B) + '"/>';
  for (const s of spec.series) {
    let d = "", pen = false;
    s.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); pen = true; });
    svg += '<path class="series' + (s.total ? " total" : "") + '" stroke="' + s.color + '" d="' + d + '"/>';
  }
  svg += '<line class="cross" y1="' + T + '" y2="' + (H - B) + '" visibility="hidden"/><g class="dots"></g></svg>';
  el.innerHTML = '<div class="plot">' + svg + '<div class="tip" hidden></div></div><div class="legend">' +
    spec.series.map((s) => '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + "</span>").join("") + (spec.note ? "<span>" + esc(spec.note) + "</span>" : "") + "</div>";
  const root = el.querySelector("svg"), cross = root.querySelector(".cross"), dots = root.querySelector(".dots"), tip = el.querySelector(".tip");
  const at = (event) => { const r = root.getBoundingClientRect(); return Math.min(n - 1, Math.max(0, Math.round((event.clientX - r.left - L) / (step || 1)))); };
  root.onpointermove = (event) => {
    const i = at(event), cx = x(i);
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
    dots.innerHTML = spec.series.filter((s) => s.values[i] != null).map((s) => '<circle class="dot" r="4" cx="' + cx + '" cy="' + y(s.values[i]) + '" fill="' + s.color + '"/>').join("");
    tip.innerHTML = "<b>" + WEEKDAYS[weekday(spec.days[i])] + " " + spec.days[i] + "</b>" +
      spec.series.map((s) => '<div><i style="background:' + s.color + '"></i><span>' + esc(s.name) + ":</span> " + fmt(s.values[i]) + "</div>").join("");
    tip.hidden = false;
    tip.style.left = (cx + 12 + tip.offsetWidth > W ? cx - 12 - tip.offsetWidth : cx + 12) + "px";
  };
  root.onpointerleave = () => { cross.setAttribute("visibility", "hidden"); dots.innerHTML = ""; tip.hidden = true; };
  root.onclick = (event) => spec.onPick?.(spec.days[at(event)]);
}
let resizing;
addEventListener("resize", () => { cancelAnimationFrame(resizing); resizing = requestAnimationFrame(() => {
  for (const el of document.querySelectorAll(".chart")) if (el._spec && el.offsetParent) lineChart(el, el._spec);
}); });
/// The change against the period before: ▲/▼ and a percentage, or points for a rate.
function delta(now, before, rate) {
  if (before == null) return "";
  if (rate) {
    if (now == null || before == null) return "";
    const points = now - before;
    return '<span class="delta ' + (Math.abs(points) < 0.05 ? "flat" : points > 0 ? "up" : "down") + '">' + (Math.abs(points) < 0.05 ? "no change" : (points > 0 ? "▲ " : "▼ ") + Math.abs(points).toFixed(1) + " pt") + "</span>";
  }
  if (!before) return now ? '<span class="delta flat">new</span>' : "";
  const change = 100 * (now - before) / before, flat = Math.abs(change) < 0.5;
  return '<span class="delta ' + (flat ? "flat" : change > 0 ? "up" : "down") + '">' + (flat ? "no change" : (change > 0 ? "▲ " : "▼ ") + Math.abs(change).toFixed(0) + "%") + "</span>";
}
const SINCE_INSTALL = { "0": "install day", "1": "next day", "2-7": "2–7 days", "8-30": "8–30 days", "31+": "31+ days" };
const weekday = (day) => new Date(day + "T00:00:00Z").getUTCDay();
const query = new URLSearchParams(location.search);
let picked = query.get("day") || null;
const COLUMNS = { version: "Version", system: "OS", country: "Country", pro: "Pro", device: "Device" };
const filters = {}; // column → value, on top of the day
for (const column in COLUMNS) if (query.get(column)) filters[column] = query.get(column);
if (query.get("app")) { // keep the chosen app across reloads, even one only the API lists
  const sel = $("app"), want = query.get("app");
  if (![...sel.options].some((o) => o.value === want)) sel.add(new Option(want, want));
  sel.value = want;
}
if ([...$("days").options].some((o) => o.value === query.get("days"))) $("days").value = query.get("days");
function remember() {
  const url = new URL(location.href);
  url.searchParams.set("app", $("app").value);
  url.searchParams.set("days", $("days").value);
  if (picked) url.searchParams.set("day", picked); else url.searchParams.delete("day");
  for (const column in COLUMNS) if (filters[column] != null) url.searchParams.set(column, filters[column]); else url.searchParams.delete(column);
  history.replaceState(null, "", url);
}
function filterBy(column, value) {
  if (value == null || filters[column] === value) delete filters[column]; else filters[column] = value;
  load();
}
const chip = (label, clear) => '<span class="chip"><span>' + esc(label) + '</span><button data-clear="' + esc(clear) + '" aria-label="Remove filter" title="Remove filter">×</button></span>';
function pick(day) {
  picked = day;
  load();
}
const ALL = "*"; // the app picker's "All apps"
const appOptions = (apps, selected) => '<option value="*">All apps</option>' +
  apps.map((a) => "<option" + (a === selected ? " selected" : "") + ">" + esc(a) + "</option>").join("");
async function load(fresh) {
  const app = $("app").value, days = $("days").value, overall = app === ALL;
  if (overall) delete filters.version; // versions differ from app to app
  remember();
  document.body.classList.toggle("overall", overall);
  $("chips").innerHTML = (picked ? chip(WEEKDAYS[weekday(picked)] + " " + picked, "day") : "") +
    Object.entries(filters).map(([column, value]) => chip(COLUMNS[column] + ": " + value, column)).join("");
  const filterQuery = Object.entries(filters).map(([column, value]) => "&" + column + "=" + encodeURIComponent(value)).join("");
  const endpoint = overall ? "/api/overview?" : "/api/summary?app=" + encodeURIComponent(app) + "&";
  const response = await fetch(endpoint + "days=" + days + (picked ? "&day=" + picked : "") + filterQuery + (fresh === true ? "&fresh=1" : ""), { credentials: "same-origin" });
  if (!response.ok) { $("tiles").innerHTML = '<div class="empty">Couldn’t load: ' + response.status + "</div>"; return; }
  const d = await response.json();
  if (d.apps.length) $("app").innerHTML = appOptions(d.apps, app);
  if (picked && picked < d.from) { pick(null); return; } // the day left the period
  const counted = picked ? d.daily.filter((r) => r.day === picked) : d.daily;
  const sessions = counted.reduce((s, r) => s + r.sessions, 0), firstRuns = counted.reduce((s, r) => s + r.firstRuns, 0);
  const money = overall ? d.perApp : d.paywalls;
  const shown = money.reduce((s, r) => s + r.shown, 0), bought = money.reduce((s, r) => s + r.purchased, 0);
  // A fresh install: nothing at all in the period, nothing filtered. Show how to send a first event.
  const nothing = !picked && !Object.keys(filters).length && !d.daily.some((r) => r.sessions);
  document.body.classList.toggle("nothing", nothing);
  if (nothing) {
    const body = { app: overall ? d.apps[0] ?? "myapp" : app, v: "1.0", build: "1", os: "18", lang: "en", pro: "free", device: "iphone",
                   session: crypto.randomUUID(), events: [{ n: "session_start", p: { days: "0" } }] };
    $("curl").textContent = "curl -i " + INGEST + "/v1/events \\\\\\n  -H 'content-type: application/json' -H 'x-stats-key: <the app key>' \\\\\\n  -d '" + JSON.stringify(body) + "'";
    return;
  }
  const p = d.previous, rate = (a, b) => b ? 100 * a / b : null;
  $("tiles").innerHTML = [["Sessions", sessions, delta(sessions, p.sessions)], ["First launches", firstRuns, delta(firstRuns, p.firstRuns)],
    ["Paywalls shown", shown, delta(shown, p.shown)], ["Purchases", bought, delta(bought, p.purchased)],
    ["Paywall → purchase", pct(bought, shown), delta(rate(bought, shown), rate(p.purchased, p.shown), true)]]
    .map(([t, v, change]) => '<div class="tile"><span class="muted">' + t + "</span><b>" + num(v) + "</b>" + change + "</div>").join("");
  const lastBefore = new Date(Date.parse(d.from + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
  $("compare").textContent = picked ? "Compared with " + WEEKDAYS[weekday(p.from)] + " " + p.from + ", a week earlier"
                                    : "Compared with the " + d.days + " days before: " + p.from + " – " + lastBefore;
  const dates = dayList(d.from, d.days), byDay = Object.fromEntries(d.daily.map((r) => [r.day, r]));
  const onPick = (day) => pick(day === picked ? null : day);
  lineChart($("trend"), overall
    ? { days: dates, onPick, note: d.apps.length > SERIES ? "Apps past the " + SERIES + "th are in the total only" : "",
        series: [{ name: "All apps", color: "var(--fg)", total: true, values: dates.map((day) => byDay[day]?.sessions ?? 0) },
                 ...d.apps.slice(0, SERIES).map((name, i) => ({ name, color: seriesColor(i), values: dates.map((day) => byDay[day]?.apps[name] ?? 0) }))] }
    : { days: dates, onPick, series: [{ name: "Sessions", color: seriesColor(0), values: dates.map((day) => byDay[day]?.sessions ?? 0) },
                               { name: "First launches", color: seriesColor(1), values: dates.map((day) => byDay[day]?.firstRuns ?? 0) }] });
  const returningTotal = d.returning.reduce((s, r) => s + r.sessions, 0);
  $("returning").innerHTML = table(d.returning.map((r) => ({ ...r, label: SINCE_INSTALL[r.value] ?? r.value })),
    [["Since install", "label"], ["Sessions", "sessions"], ["Share", (r) => pct(r.sessions, returningTotal)]], "sessions");
  $("daily").innerHTML = table(d.daily.slice().reverse(),
    [["Day", (r) => esc(r.day) + "<small>" + WEEKDAYS[weekday(r.day)] + "</small>", true], ["Sessions", "sessions"], ["First launches", "firstRuns"],
     ...(overall ? d.perApp.map((a) => [a.app, (r) => r.apps[a.app] ?? 0]) : [])], "sessions",
    (r) => ' data-day="' + esc(r.day) + '" class="' + ([0, 6].includes(weekday(r.day)) ? "weekend" : "") + (r.day === picked ? " picked" : "") + '"');
  for (const key of overall ? ["systems", "countries", "pro", "devices"] : ["versions", "systems", "countries", "pro", "devices"]) {
    const column = $(key).dataset.column;
    $(key).innerHTML = table(d.breakdown[key], [["Value", "value"], ["Sessions", "sessions"]], "sessions",
      (r) => ' data-value="' + esc(r.value) + '"' + (filters[column] === String(r.value) ? ' class="picked"' : ""));
  }
  if (overall) {
    $("apps").innerHTML = table(d.perApp, [["App", "app"], ["Sessions", "sessions"], ["First launches", "firstRuns"], ["Paywalls shown", "shown"],
      ["Purchases", "purchased"], ["Conversion", (r) => '<span class="good">' + pct(r.purchased, r.shown) + "</span>", true]], "sessions",
      (r) => ' data-app="' + esc(r.app) + '"');
    applyFolds();
    return;
  }
  const versionDays = Object.fromEntries(d.adoption.days.map((r) => [r.day, r]));
  lineChart($("adoption"), { days: dates, onPick, percent: true,
    series: d.adoption.versions.map((version, i) => ({ name: version === "older" ? "older" : "v" + version,
      color: version === "older" ? "var(--muted)" : seriesColor(i),
      values: dates.map((day) => { const r = versionDays[day]; return r?.total ? 100 * (r.versions[version] ?? 0) / r.total : null; }) })) });
  const first = d.funnel.steps[0]?.sessions || 0;
  $("funnel").innerHTML = table(d.funnel.steps.concat([{ step: "purchased", sessions: d.funnel.purchased }]),
    [["Step", "step"], ["Sessions", "sessions"], ["Of first step", (r) => pct(r.sessions, first)]], "sessions");
  $("paywalls").innerHTML = table(d.paywalls, [["Context", "context"], ["Shown", "shown"], ["Closed", "closed"], ["Purchased", "purchased"],
    ["Conversion", (r) => '<span class="good">' + pct(r.purchased, r.shown) + "</span>", true],
    ["Closed within", (r) => Object.entries(r.seconds).sort(([a], [b]) => parseInt(a) - parseInt(b)).map(([k, v]) => k + "s: " + v).join(" · ")]], "shown");
  $("locked").innerHTML = table(d.locked, [["Feature", "feature"], ["Taps", "taps"], ["Sessions that bought", "boughtSessions"]], "taps");
  $("products").innerHTML = table(d.products, [["Plan", "product"], ["Outcome", "outcome"], ["Count", "count"]], "count");
  const panelColumns = {
    values: [["Value", "value"], ["Count", "count"], ["Sessions", "sessions"]],
    counts: [["Event", "value"], ["Count", "count"], ["Sessions that bought", "boughtSessions"]],
    flags: [["Option", "value"], ["Selected", "count"], ["Of answers", (r) => pct(r.count, r.answers)]],
  };
  const panelLabel = (p, v) => v == null ? "(not set)" : p.labels?.[v] ?? (p.prefix ?? "") + v;
  // Panels with nothing to show fold into one line at the end.
  const empty = d.panels.filter((p) => !p.rows.length);
  $("panels").innerHTML = d.panels.filter((p) => p.rows.length).map((p) => "<section><h2>" + esc(p.title) + '</h2><div class="scroll">' +
    table(p.rows.map((r) => ({ ...r, value: panelLabel(p, r.value) })), panelColumns[p.type], "count") + "</div></section>").join("") +
    (empty.length ? '<section class="nodata"><h2>Nothing in this period</h2><div>' + empty.map((p) => esc(p.title)).join(" · ") + "</div></section>" : "");
  applyFolds();
}
let folded = new Set(); // section headings folded in this browser
try { folded = new Set(JSON.parse(localStorage.getItem("folded") || "[]")); } catch {}
const foldKey = (h2) => h2.firstChild.textContent.trim();
function applyFolds() {
  for (const h2 of document.querySelectorAll("section > h2")) h2.parentElement.classList.toggle("folded", folded.has(foldKey(h2)));
}
document.querySelector("main").addEventListener("click", (event) => {
  const h2 = event.target.closest("section > h2");
  if (!h2) return;
  const key = foldKey(h2), section = h2.parentElement;
  if (folded.has(key)) folded.delete(key); else folded.add(key);
  section.classList.toggle("folded", folded.has(key));
  try { localStorage.setItem("folded", JSON.stringify([...folded])); } catch {}
  // a chart drawn while folded had no width: draw it again
  if (!folded.has(key)) for (const el of section.querySelectorAll(".chart")) if (el._spec) lineChart(el, el._spec);
});
$("daily").onclick = (event) => { const row = event.target.closest("tr[data-day]"); if (row) pick(row.dataset.day === picked ? null : row.dataset.day); };
for (const el of document.querySelectorAll(".pickable")) {
  el.onclick = (event) => { const row = event.target.closest("tr[data-value]"); if (row) filterBy(el.dataset.column, row.dataset.value); };
}
$("apps").onclick = (event) => { // open that app; the day and filters stay
  const row = event.target.closest("tr[data-app]");
  if (row) { $("app").value = row.dataset.app; load(); }
};
$("chips").onclick = (event) => {
  const clear = event.target.closest("button[data-clear]")?.dataset.clear;
  if (clear === "day") pick(null); else if (clear) filterBy(clear, null);
};
document.addEventListener("keydown", (event) => { // Escape drops filters one by one, the newest first
  if (event.key !== "Escape") return;
  const columns = Object.keys(filters);
  if (columns.length) filterBy(columns[columns.length - 1], null); else if (picked) pick(null);
});
$("reload").onclick = () => load(true); $("app").onchange = () => { for (const column in filters) delete filters[column]; picked = null; load(); }; $("days").onchange = load;
load();
</script>
</body>
</html>`;
}
