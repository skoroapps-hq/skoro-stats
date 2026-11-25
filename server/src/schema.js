// What every app may send, before its own schema adds events or narrows these by name.
import common from "../schemas/common.json" with { type: "json" };

/// An app's events: the common ones, with its own added or replacing them by name.
export const events = (own = {}) => ({ ...common, ...own });

export { common };
