# Contributing

Thanks for helping. Issues and pull requests are welcome. Before you start on a large change,
open an issue first so we can agree on the approach.

## Ground rules

- **Privacy first.** Nothing may identify a person or a device: no user or device IDs, no IP
  addresses, no free text. Every new event or property needs a fixed list of values or a
  token (`"*"`).
- **Stay on the free plan.** A dashboard view makes at most 45 queries, and no query may read a
  whole table (`server/test/config.test.js` and the plan tests check both). Avoid `GROUP BY`
  over events: D1 counts the sort as a second read of every row.
- **Never break shipped apps.** The request format and the common events only ever grow.
  Schema changes go in a new numbered file in `server/migrations/`, and they only add.
- **The clients match.** A change to the common events goes into `server/schemas/common.json`,
  the Swift package and the Kotlin client together. Their tests compare them.

## Running the tests

```sh
cd server && npm install && npm test   # Node 22.5+
swift test                             # from the repository root
cd android && gradle test              # Gradle 9
```

## Releases (maintainers)

A release is a tag such as `2.0.3` on `main`. The tag itself is the Swift package release, and
`.github/workflows/publish-android.yml` tests the Kotlin client and publishes it, signed, to
Maven Central as `com.skoroapps:skoro-stats`. A version on Maven Central can never be changed or
deleted, so a fix always gets a new tag; never move a tag.

## Pull requests

Keep each pull request to one change, with tests. Describe what changes for the people who run
an instance, especially whether they need to run `npm run deploy` or change their config.
