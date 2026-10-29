# coldest-cfo-live — agent notes

This is the page David actually views (GitHub Pages, public repo). The data path, backend and the full rule set live in `davidstarkk/coldest-cfo-dashboard` — read its `CLAUDE.md` and `LEARNINGS.md` before changing numbers here.

- **NEVER** put new UI logic inline in `index.html`. Add a module + one `<script>` tag (next to `report_quality_module.js`). The workspace mirror sync rewrites `index.html` daily; `scripts/lib/sync_guard.js` (run by `restore-protected-days.yml`) keeps this repo's UI and takes only data from the sync.
- **NEVER** hand-revert a `public mirror sync` commit. If the guard reports `merged_conflicts_kept_ours` / `kept_ours_merge_unparseable` / `took_theirs_page_unsafe`, check that file. Keep `scripts/lib/sync_guard.js` identical to the data repo's `lib/sync_guard.js`.
- **NEVER** invent numbers. `report_quality_module.js` baselines are comparisons only; its rule must match `cfo_backend/report_quality.py` in the data repo (4-week same-weekday median, drops ≥60%, mismatched headline).
- **NEVER** attach a MutationObserver that writes into the subtree it observes; wrap the template render functions instead.
- This repo is public: no credentials, and treat anything committed here as published.
- Run `npm test` (the throttles / protected-days suites had 7 pre-existing failures on 10/28 from Jarvis settings drift).
