// The apps the tests run against (package.json maps #apps here under --conditions=skoro-test):
// a reading app with panels of every kind, and a second app that sends nothing.

import { events } from "../src/schema.js";

const sources = ["files", "link", "github"];
const reasons = ["not_found", "timeout", "other"];

export const apps = {
  reader: {
    schema: events({
      first_run: { kind: ["onboarding", "whats_new"] },
      onboarding_step: { step: ["promise", "choice", "welcome", "persona", "value", "github", "paywall", "done"] },
      purchase: { product: ["monthly", "yearly", "lifetime"], context: "*", outcome: ["purchased", "pending", "cancelled", "failed"] },
      session_start: { days: ["0", "1", "2-7", "8-30", "31+"], library: ["0", "1", "2-5", "6+"],
                       github: ["0", "1"], gitlab: ["0", "1"], gitlab_server: ["0", "1"], bitbucket: ["0", "1"] },
      persona_selected: { read: ["0", "1"], review: ["0", "1"], learn: ["0", "1"] },
      free_review_used: {},
      file_read: { ext: "*", sample: ["0", "1"] },
      import: { source: sources, outcome: ["done", "failed", "cancelled"] },
      import_failed: { source: sources, reason: reasons },
      account_failed: { host: ["github", "gitlab", "gitlab_server", "bitbucket"], reason: reasons },
    }),
    onboarding: ["promise", "choice", "welcome", "persona", "value", "github", "paywall", "done"],
    panels: [
      { id: "personas", title: "Personas", type: "flags", event: "persona_selected", props: ["read", "review", "learn"] },
      { id: "free", title: "Free tries", type: "counts", events: ["free_review_used", "review_prompt"] },
      { id: "library", title: "Library", type: "values", event: "session_start", prop: "library", order: ["0", "1", "2-5", "6+"] },
      { id: "accounts", title: "Accounts", type: "flags", event: "session_start", props: ["github", "gitlab", "gitlab_server", "bitbucket"] },
      { id: "imports", title: "Imports", type: "values", event: "import", props: ["source", "outcome"], limit: 40 },
      { id: "importFailures", title: "Import failures", type: "values", event: "import_failed", props: ["source", "reason"] },
      { id: "accountFailures", title: "Sign-in failures", type: "values", event: "account_failed", props: ["host", "reason"] },
      { id: "sample", title: "Files read: sample or own", type: "values", event: "file_read", prop: "sample", labels: { 0: "own", 1: "sample" } },
      { id: "extensions", title: "File types", type: "values", event: "file_read", prop: "ext", limit: 30, except: { sample: "1" }, prefix: "." },
    ],
  },
  quiet: { schema: events(), panels: [] },
};
