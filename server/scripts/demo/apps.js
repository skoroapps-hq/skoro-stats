// The demo's apps: the example app from config.example, and a second one, so "All apps"
// has something to compare. Fictional, like all of the demo's numbers.
import { events } from "../../src/schema.js";
import { apps as example } from "../../config.example/apps.js";

export const apps = {
  ...example,
  habits: {
    schema: events({
      onboarding_step: { step: ["welcome", "first_habit", "reminders", "paywall"] },
      session_start: { days: ["0", "1", "2-7", "8-30", "31+"], habits: ["0", "1-3", "4-10", "11+"] },
      habit_checked: { streak: ["1", "2-6", "7-29", "30+"] },
      widget_added: { size: ["small", "medium", "large"] },
    }),
    onboarding: ["welcome", "first_habit", "reminders", "paywall"],
    panels: [
      { id: "habits", title: "Habits at launch", type: "values", event: "session_start", prop: "habits", order: ["0", "1-3", "4-10", "11+"] },
      { id: "streaks", title: "Check-ins by streak length", type: "values", event: "habit_checked", prop: "streak", order: ["1", "2-6", "7-29", "30+"] },
      { id: "widgets", title: "Widgets added", type: "values", event: "widget_added", prop: "size" },
    ],
  },
};
