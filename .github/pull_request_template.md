## What changes

<!-- One change per pull request. What does it do, and why? -->

## For people who run an instance

<!-- Delete the lines that don't apply. -->
- Nothing to do.
- Run `npm run deploy` (server code or a new migration).
- Change `server/config/` (say what).
- Update the app's client (the Swift package or the Kotlin client).

## Checklist

- [ ] Tests added or updated, and `npm test`, `swift test` and `gradle test` pass
- [ ] Nothing new can identify a person or a device (no IDs, no IP addresses, no free text)
- [ ] Shipped apps keep working: the request format and the common events only grow
- [ ] Common events changed in `server/schemas/common.json`, Swift and Kotlin together (or not touched)
