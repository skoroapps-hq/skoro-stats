-- Anonymous usage events from the apps. No identifier of a person or a device:
-- `session` is random per app launch and never stored on the device; no IP is kept.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,          -- received, ms since 1970
  day TEXT NOT NULL,            -- YYYY-MM-DD (UTC) of ts
  app TEXT NOT NULL,
  version TEXT NOT NULL,
  build TEXT NOT NULL,
  os TEXT NOT NULL,             -- major OS version
  lang TEXT NOT NULL,
  country TEXT NOT NULL,        -- from Cloudflare, two letters or "XX"
  pro TEXT NOT NULL,            -- free | trial | pro | legacy | none
  device TEXT NOT NULL DEFAULT 'unknown', -- iphone | ipad | android | android_tablet | other | unknown
  session TEXT NOT NULL,
  name TEXT NOT NULL,
  props TEXT NOT NULL,          -- JSON object of allowed values
  at INTEGER NOT NULL           -- ms since the session began
);
-- The only index: every dashboard query on events asks for named events over a period, and
-- with `name` before the `day` range it reads only those events' rows. Sessions are counted
-- from the sessions table below. No (app, day, name) or (app, session) index: SQLite would
-- take them and read every event of the period, or of the app (a test checks every dashboard
-- query's plan).
CREATE INDEX IF NOT EXISTS events_app_name_day ON events (app, name, day);
-- One row per session and day (and per state it was in: `pro` changes after a purchase), kept
-- at ingest so the dashboard counts sessions without reading every event of the period
-- (D1's free tier counts rows read). The key leads with (app, day), so a period is one range
-- of it and no other index has to be written.
CREATE TABLE IF NOT EXISTS sessions (
  app TEXT NOT NULL,
  day TEXT NOT NULL,
  session TEXT NOT NULL,
  version TEXT NOT NULL,
  os TEXT NOT NULL,
  device TEXT NOT NULL,
  country TEXT NOT NULL,
  pro TEXT NOT NULL,
  first_run INTEGER NOT NULL DEFAULT 0,  -- 1 once the session sent first_run that day
  PRIMARY KEY (app, day, session, version, os, device, country, pro)
) WITHOUT ROWID;
