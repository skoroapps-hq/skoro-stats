// Your apps. Copy this folder to `config/` (git-ignored) and make it yours:
//   cp -r config.example config
// Adding an app: schemas/<app>.json (its own events, and any common event it narrows
// by name), an entry below, and its key in the APP_KEYS secret. See schemas/common.json
// for the events every app may send.

import { events } from "../src/schema.js";
import example from "./schemas/example.json" with { type: "json" };

// `schema`: every event and property the app may send, with the allowed values ("*" for
// any short token). Anything else is dropped at ingest.
// `onboarding`: the steps in funnel order; without it steps are ordered by sessions.
// `panels`: the app's own dashboard sections, all read from `props`:
//   values  how often each value of one property (`prop`) occurs in an event, or each
//           combination of several (`props`, shown "a · b"); `order` fixes the row order,
//           `limit` caps the rows, `labels` renames values, `except` leaves events out
//   counts  how often each of a list of events (`events`) occurs
//   flags   of an event's "0"/"1" properties (`props`), how many are "1"
export const apps = {
  example: {
    schema: events(example),
    onboarding: ["welcome", "notifications", "paywall", "done"],
    panels: [
      { id: "notes", title: "Notes at launch", type: "values", event: "session_start", prop: "notes", order: ["0", "1-5", "6-20", "21+"] },
      { id: "created", title: "Notes created: from where", type: "values", event: "note_created", prop: "from" },
      { id: "exports", title: "Exports: format · outcome", type: "values", event: "export", props: ["format", "outcome"], limit: 20 },
      { id: "prompts", title: "Rating requests and restores", type: "counts", events: ["review_prompt", "restore"] },
    ],
  },
};
