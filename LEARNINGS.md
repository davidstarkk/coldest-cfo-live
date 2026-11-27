# LEARNINGS.md — Agent Post-Mortems

Append-only log of codebase quirks and solutions. Read this at the start of every session.

---

- **Date/Context:** 2026-11-17 — live throttle/pinterest/restore tests pinned October mer as_of and `roas_threshold` 3.0.
  - **The Quirk:** 16 pre-existing failures on `main` after #19. Tests still expected mer/`ad_channel_throttles` as_of 10/24–10/26, Google `view`, Reddit `auto`, Bing $521.09 / D2C $8.73, rankings `weeks[0]` = 10/26, tracking_health 10/26, no attribution block, Pinterest snapshot undefined/unknown, and live mer as_of 10/26. Live settings are raise 2.8 / cut 2.0 with no `roas_threshold`; Reddit/Pinterest are `hold`; snapshot as_of matches mer; rankings unwrap the latest dated week; `_setLive` falls back health to `snapshot.tracking_health`.
  - **The Solution:** Assert live settings bands and modes from the files. Snapshot tests join mer as_of / structure, not October dollars. Synthetic auto-Reddit + what-if Bing fixtures cover scale/cut. Rankings pin 10/26 facts only on that list element. Restore is a no-op when live mer as_of >= the protected 10/26 snapshot; do not pin live HTML Shopify dollars. Tests/fixtures only — no feed or settings edits.
