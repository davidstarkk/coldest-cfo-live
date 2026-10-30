# Coldest CFO Dashboard

Daily financial briefings for Coldest — Shopify (BeProfit) · Amazon (Sellerboard) · TikTok (ShipHero).

## Architecture

Single-page static site (`index.html`) with embedded data:
- `REPORTS` — rolling 33 days of CFO report data (revenue, costs, profit by channel)
- `SHOPIFY_HISTORY` — 2 years of daily Shopify order history (Apr 2024–Apr 2026)
- `TIKTOK_DATA` — daily TikTok aggregates from ShipHero (Apr 7, 2026+)
- `MERGED_DATA` — combined view for the Analytics tab

## Tabs

### Daily Reports
- KPI cards: MER, revenue, orders, AOV
- MER by Channel table (Shopify, Amazon, TikTok)
- Combined P&L with OPEX distribution
- Week-over-week comparison
- Ad spend efficiency (Shop ad/rev %, 7d trend)
- MTD pacing vs $600K target
- Rolling 7d/30d averages
- MER Scaling Tracker (optimal MER from elasticity model)
- CBO budget adjustments, ShipHero merge savings

### CMASM Table
- Daily P&L grid across all dates
- Fulfillment row
- Sunday Drop Anticipation Tracker

### Analytics
- Shopify-style dashboard with Chart.js
- Period selector (Today/7D/30D/90D/1Y)
- YoY comparison (vs previous period or same period last year)
- Channel filter (Shopify/TikTok/Amazon)
- Revenue area chart, channel donut, sales breakdown

## OPEX Distribution Logic

BeProfit charges all company OPEX ($5,546/day) against Shopify. This unfairly penalizes Shopify margins and inflates Amazon margins. The dashboard redistributes OPEX proportionally:

```
1. Shop contribution = BeProfit Shopify net profit + total OPEX
2. AMZ OPEX = min(OPEX × AMZ_rev / total_rev, Sellerboard_AMZ_profit)
   - If AMZ profit ≤ 0, AMZ OPEX = 0 (can't allocate more than they earn)
3. Shop OPEX = total OPEX − AMZ OPEX
4. Shop net = Shop contribution − Shop OPEX + ShipHero merge savings (if any)
5. AMZ net = Sellerboard profit − AMZ OPEX
6. Combined net = Shop net + AMZ net + TikTok net
```

Key rules:
- Amazon profit comes EXACTLY from Sellerboard (not BeProfit)
- OPEX allocation is capped at Amazon's Sellerboard profit
- TikTok has no OPEX allocation (not in BeProfit)
- ShipHero merge savings (75% of gross) credit to Shopify

## TikTok Channel Transition

Before 2026-04-07: TikTok orders flowed through Shopify (tagged `TikTok`).
- BeProfit "Shopify" included TikTok revenue
- Dashboard shows `Shopify/TikTok` label for pre-split dates
- `tiktok_revenue = 0` in MERGED_DATA (already in Shopify)

From 2026-04-07: TikTok orders go directly to ShipHero.
- BeProfit "Shopify" = pure Shopify only
- TikTok data pulled from ShipHero API (shop_name="Coldest")
- Dashboard shows separate Shopify and TikTok columns
- TikTok ad spend not yet integrated (shows "—")

## Hash-Based Deep Links

Each daily report is accessible via hash link:
```
https://perplexity.ai/computer/a/coldest-daily-cfo-reports-...#2026-04-09
```

The site reads `window.location.hash` on load and auto-expands the matching report card. Email briefings include the deep link for that day's report.

## MER Target & Breakeven

- MER Target: 2.5x (green = above, yellow = between target and breakeven, red = below breakeven)
- Breakeven MER = total_revenue / (total_revenue − net_profit)
  - Typically 1.0–1.5x. If above 2.0x, something is wrong.
- LTV-adjusted breakeven: 0.90x (Meta customer LTV = $140.03)

## Data Sources

| Channel | Revenue | Profit | Ad Spend | COGS | Fulfillment |
|---|---|---|---|---|---|
| Shopify | BeProfit | OPEX-blended | BeProfit (Meta) | BeProfit | BeProfit |
| Amazon | Sellerboard | Sellerboard (exact) | Sellerboard | BeProfit | BeProfit |
| TikTok | ShipHero | Rev − COGS − fulfill | Not available | Est. 10.5% | $9.08/order |

## Cron Jobs

- **CFO Briefing** (`d1c3dd8e`): 9:20 AM ET daily — pulls emails, builds report, sends email, deploys site
- **TikTok Refresh** (`c53bbb8e`): Every 6 hours — pulls ShipHero TikTok orders, updates dashboard

## Paid channels (Meta · Google · Bing · Reddit · Snapchat · ChatGPT · Pinterest)

Every daily report lists **ad spend per channel** (Meta, Google, Bing, Reddit, Snapchat, ChatGPT, Pinterest). Unpublished channels render **`missing`**. Numbers are never invented.

| Channel | Typical source today | Tab |
|---|---|---|
| Meta | `advertising_sources.meta` (already in pipeline totals) | META ADS |
| Google Ads | `advertising_sources.google_ads` (already in pipeline totals) | GOOGLE ADS |
| Bing / Microsoft | `advertising_sources.bing` or `mer_for_manus.json` → `bing` | BING ADS |
| Reddit | `advertising_sources.reddit` or `mer_for_manus.json` → `reddit` | REDDIT ADS |
| Snapchat | `advertising_sources.snapchat` or `mer_for_manus.json` → `snapchat` | SNAPCHAT ADS |
| ChatGPT Ads | `advertising_sources.chatgpt` or `mer_for_manus.json` → `chatgpt` (manual publish; no API) | CHATGPT ADS |
| Pinterest Ads | `advertising_sources[date].pinterest_ads` or `mer_for_manus.json` → `pinterest` (launched 2026-10-25, account `549760871033`) | PINTEREST ADS |

When `mer_for_manus.json` publishes the daily_inputs contract (`source: daily_inputs`), the strip uses those keys **as written**:

| Key | Meaning |
|---|---|
| `d2c_ad_spend` | **D2C ad spend** — Shopify-bound paid media (Meta, Google, Bing D2C, Reddit, Snapchat, ChatGPT, Pinterest, TikTok `shopify_spend`) |
| `blended_mer` | Shopify D2C revenue ÷ `d2c_ad_spend` |
| `total_ad_spend` | **All ad spend** — company total (D2C + Amazon-bound + other non-D2C) |
| `bing.spend` / `bing.d2c` / `bing.amazon` | Bing total and the D2C / Amazon destination split. Main campaign `bing to amz tumbler listing 1` is Amazon-bound. |
| `reddit` / `snapchat` / `chatgpt` | Per-channel blocks; `tracking_verified: false` means unpublished / unverified |
| `pinterest` | `{spend, spend_d2c, clicks, conversions, revenue, roas, *_7d, attribution_window, live, status, source, as_of}` — missing = $0 / **—** |
| `non_d2c.whatnot` / `applovin` / `tiktok_shop` / `sellerboard_amazon` / `unallocated` | Amazon-bound and other non-D2C lines (in All ad spend, excluded from D2C / blended MER) |

Per-channel feeds may also publish `d2c` / `amazon` / `other` or `destination: "d2c" | "amazon" | "other"`. TikTok’s Shopify share (`advertising_sources.tiktok_ads.shopify_spend`) counts as D2C; TikTok Shop / unallocated do not.

Without those keys the card falls back to a destination-aware sum (seven paid channels as D2C unless split, plus TikTok Shopify / Amazon-bound / other when published). Meta and Google already inside `provisional_totals.ads` are displayed and **not added again**. Bing / Reddit / Snapchat / ChatGPT / Pinterest overlay into `provisional_totals` only when the pipeline has not published them and a feed has spend &gt; $0.

Feed order per channel (same as Bing):

1. `PARTIAL_REPORTS[].advertising_sources.<channel>` or `mer_for_manus.json` `advertising_sources[YYYY-MM-DD].<channel>` (aliases accepted; Pinterest key is `pinterest_ads`)
2. `mer_for_manus.json` block (`meta`, `google`, `bing`, `reddit`, `snapchat`, `chatgpt`, `pinterest`)
3. optional `<channel>_ads_data.json` (`bing_ads_data.json`, `pinterest_ads_data.json`, …)
4. Channel tab → manual daily number (`localStorage` only)

ChatGPT ads has **no API**. Publish a `chatgpt` block from the data repo (or `chatgpt_ads_data.json`). Until then the row is $0 / no feed.

ChatGPT conversion tracking is known-broken (0 conversions on past days). An optional `tracking_verified: false` on the `chatgpt` block shows conversions / revenue / ROAS as **tracking not verified** instead of `0` / `0.00x`. Spend still counts toward D2C ad spend / All ad spend. Omit the flag (or set `true`) to show published outcome numbers.

Reporting only. Do **not** put ad-platform credentials in this public repo.

## Ad Channel Throttles

The **AD CHANNEL THROTTLES** tab is read-only. **Live rules change only via Jarvis.**

Data (exact data-repo PR #14 keys; first file that exists wins):

1. `ad_channel_throttles.json` — `d2c_ad_spend`, `total_ad_spend`, `shopify_d2c_revenue`, `blended_mer`, `channels.*`, `series_28d.by_channel` / `series_28d.blended`, `platform_roas`, `roas_basis`, `recent_changes` (also nested on `mer_for_manus.json` → `ad_channel_throttles`)
2. `throttle_settings` / `ads_throttle/settings.json` (`global.roas_basis: platform`)
3. `ads_throttle/changes.json` or `recent_changes`
4. `ads_throttle/tracking_health.json` (`tracking_health`: `as_of`, `shopify_orders_yesterday`, `channels.{meta,google,bing,reddit,snapchat,chatgpt,pinterest,applovin,tiktok}` with `status` OK|WARN|DOWN|NO_SPEND, `last_checkout_event`, `last_purchase_event`, `purchases_24h`, `purchases_7d_avg`, `notes`). Missing channel keys (AppLovin, TikTok today) are **unknown** (not DOWN). Pinterest always shows the amber known-gap chip **No CAPI (Conversions API) — known gap, browser tag only**.
5. `ads_throttle/rankings.json` then `ad_channel_throttles.rankings` — latest week `{date, channels:[{channel, roas_7d, roas_28d, spend_7d, wow_change, spend_share, revenue_share, tier}]}`. Include `pinterest` when present in `channels` or `eligible_channels`.

**Production path (same as `mer_for_manus.json`):** this repo *is* the GitHub Pages site. The browser fetches sibling JSON next to `index.html` (`mer_for_manus.json`, `ad_channel_throttles.json`, `ads_throttle/*.json`). It does not read the private data repo. David's box / the daily public-mirror sync must copy these files from `davidstarkk/coldest-cfo-dashboard` into this repo at the **same relative paths**, then commit to `main`:

```
ads_throttle/tracking_health.json  →  ads_throttle/tracking_health.json   (daily)
ads_throttle/rankings.json         →  ads_throttle/rankings.json          (weekly, Mon)
mer_for_manus.json                 →  mer_for_manus.json                  (already synced)
ad_channel_throttles.json          →  ad_channel_throttles.json           (already synced)
ads_throttle/settings.json         →  ads_throttle/settings.json
ads_throttle/changes.json          →  ads_throttle/changes.json
ads_throttle/series.json           →  ads_throttle/series.json
```

Optional fallback already wired: nested `mer_for_manus.tracking_health` / `mer_for_manus.ad_channel_throttles.rankings` if the sibling file is missing.

**Overwrite protection:** `protected_days/snapshot.json` plus `protected_days/mer_for_manus.json` remember published `channel_revenue` / `channel_ad_spend` for 2026-09-28..2026-10-26 (including Shopify 10/9 $26,289.50 and 10/10 $16,958.06) and mer `as_of` 2026-10-26. `.github/workflows/restore-protected-days.yml` runs on push to `main` and ~10:30 / 11:30 AM ET. It merges wiped or zeroed protected days back; it never deletes a newer live day and `mer_for_manus.as_of` only moves forward. Layout is unchanged.
6. `ad_channel_throttles.channels[ch]` Shopify attribution — `shopify_orders_7d`, `shopify_revenue_7d`, `shopify_roas_7d` (null if spend &lt; $200 or no data), `platform_roas_7d`, `coverage_pct` (raw may exceed 100; display capped at 100%), `roas_source` (`shopify_attributed` only if coverage ≥ 80, else `platform_reported`)
7. `ad_channel_throttles.attribution` — `{as_of, total_orders_7d, attributed_paid_pct, owned_pct, unattributed_pct, by_channel}`

Top cards: **D2C ad spend** and **All ad spend** separately, Shopify D2C revenue, blended MER vs **3.0**.

One row per channel (Meta, Google, Bing, Reddit, Snapchat, ChatGPT, Pinterest, TikTok). Pinterest (launched 10/25, account `549760871033`) reads `channels.pinterest` (`spend_7d`, `spend_d2c_7d`, `platform_roas_7d` labeled **platform-reported, 7d click / 1d view**, `shopify_roas_7d`, `coverage_pct`, `roas_source`, `rule_roas_source`, `rule_status` e.g. Learning first read 11/01, `mode`, `launch_date`, `soft_read_date`, `first_binding_date`, `soft_read_cut_below_roas`, `known_gap`, `tracking_status`, `owner_bot`). Soft-read and first-binding dates show on the row. Missing fields stay **— / unknown**. `?pinterest_example=1` is test-only EXAMPLE DATA.

One row per channel also includes: daily budget, 7-day spend, Shopify-attributed revenue, **Shopify ROAS (7d)**, **Platform ROAS (7d)** labeled **platform-reported**, **Coverage %** chip (≥80 green / 50–79 amber / &lt;50 red / missing grey), **Rule uses** from `roas_source`, 3-day trend, destination (Shopify vs Amazon/other), published `rule_status`, last change + next eligible, owner bot, strategy notes. `*_status: unverified` fields are labeled **unverified**. Missing attribution fields stay **— / unknown** — never invented. The live throttle rule stays **platform-reported** per `settings.global.roas_basis` until David switches.

Also on the tab: 28-day per-channel spend + ROAS charts with a 3.0 line, budget-share chart, cross-channel blended MER 28d trend, a **Tracking health** panel (status chip OK green / WARN amber / DOWN red / unknown grey, last checkout + purchase in ET, `purchases_24h` vs Shopify orders yesterday and vs 7d avg, notes), a **Channel ranking** section (latest week, sorted by tier then `roas_7d`; Lead green / Steady blue-grey / Lagging amber / not enough data grey; 7d and 28d ROAS labeled **platform-reported**; spend 7d; WoW; paired spend-share vs revenue-share bars). Missing `rankings.json` shows **First ranking lands Mon 10/26 ~11:15 AM ET** — never invented. `scripts/fixtures/rankings_example.json` is test-only EXAMPLE DATA (`?ranking_example=1`), not a live feed. An **Attribution coverage** card stacks paid-attributed vs Owned vs Unattributed share of Shopify orders (`attribution.as_of`). `scripts/fixtures/attribution_example.json` is test-only EXAMPLE DATA (`?attribution_example=1`). Then a **read-only** live settings panel (per-channel mode + min/max) with **Live settings change only through Jarvis in chat** and a **Request change** link to `davidstarkk/coldest-cfo-dashboard` issues, plus editable what-if inputs.

Idle badges use the published `rule_status` from `ad_channel_throttles` (not recomputed). What-if recomputes in the browser; Bing’s what-if spend is **D2C-only** (`spend_d2c_7d` / `destination_split.shopify`).

| Condition | Badge |
|---|---|
| `tracking_health` channel `status` DOWN | Hold - tracking down |
| Meta `frozen` | Frozen - view only |
| Google / TikTok `view` | View only |
| 7d spend &lt; $200 | Not enough data |
| ROAS &lt; threshold and cut cooldown elapsed | Cut -20% + new strategy (never pause) |
| ROAS &lt; threshold and still in cut cooldown | Hold-cooldown |
| ROAS ≥ threshold and scale cooldown elapsed | Scale +20% |
| ROAS ≥ threshold and still in scale cooldown | Hold-cooldown |

What-if inputs (threshold 3.0, step 20%, min spend $200, scale cooldown 7d, cut cooldown 3d) recompute the badge in the browser only.

Change log columns: date, channel, ROAS, spend, action, old → new budget.

No credentials. This tab never calls an ads API.

## Bing / Microsoft Advertising

This public repo **is** the GitHub Pages site at https://davidstarkk.github.io/coldest-cfo-live/ (`main` → `/`).

Google Ads daily numbers are **not** fetched from an API in the browser. They arrive already embedded on the page as `PARTIAL_REPORTS[].advertising_sources.google_ads` (public-mirror sync from the private data/report repo `davidstarkk/coldest-cfo-dashboard`). That pipeline also rolls Google spend into `provisional_totals.ads`, blended MER, and net profit. Finalized `REPORTS` rows do not have a Google field.

Bing follows the **same path**:

| Priority | Source | What it is |
|---|---|---|
| 1 | `PARTIAL_REPORTS[].advertising_sources.bing` (aliases: `bing_ads`, `microsoft_ads`) | Mirror sync from the data repo — source of truth once the other agent publishes it. Already-included pipeline spend is **not** double-counted. |
| 2 | `mer_for_manus.json` → `bing` block | Same file Google/MER already ships next to `index.html`. Absent block → $0. |
| 3 | `bing_ads_data.json` | Manual file drop committed to this repo. |
| 4 | BING ADS tab → “Manual daily number” | Browser `localStorage` only (does not deploy). |

Pre-launch (campaigns not live): every KPI renders **$0 / 0 / —**. Company paid spend, blended MER, and profit **do not change** while Bing spend is $0. Meta (`shop_ad_spend`) and Google (`advertising_sources.google_ads`) are never rewritten.

Expected `bing` block (keys match the data-repo `mer_for_manus.json` contract):

```json
{
  "as_of": "2026-10-24",
  "source": "daily_inputs",
  "d2c_ad_spend": 14382.78,
  "blended_mer": 1.84,
  "total_ad_spend": 21678.86,
  "bing": {
    "as_of": "2026-10-24",
    "spend": 77.33,
    "d2c": 0.97,
    "amazon": 76.36,
    "tracking_verified": true,
    "campaign": "bing to amz tumbler listing 1"
  },
  "reddit": { "spend": 0, "tracking_verified": false },
  "snapchat": { "spend": 0, "tracking_verified": false },
  "chatgpt": { "spend": 0, "tracking_verified": false },
  "non_d2c": {
    "whatnot": 0,
    "applovin": 0,
    "tiktok_shop": 3409.28,
    "sellerboard_amazon": 3012.01,
    "unallocated": 798.43
  }
}
```

2026-10-24 expected on the live page: **D2C ad spend $14,382.78**, **All ad spend $21,678.86**, Shopify D2C **$26,420.44**, blended MER **1.84**. Bing daily **$77.33** = D2C **$0.97** + Amazon **$76.36**; Bing 7d **$521.09** = D2C **$8.73** / Amazon **$512.36**. Meta 7d **$83,995.42**. Bing published `rule_status` is **Not enough data** — the rule uses D2C-only 7d spend **$8.73** (Amazon **$512.36** excluded) which is under the $200 minimum. Idle badges are the published `rule_status`; what-if recomputes Bing with D2C-only spend. ROAS still shows **platform-reported** when `roas_basis` is platform.

### Direct Microsoft Advertising API (disabled)

This Pages site cannot hold API secrets. A puller exists but is **off** unless you opt in on a trusted machine or the private pipeline:

```bash
# default: writes a $0 pre-launch bing_ads_data.json and exits 0
npm run pull:bing

# only if you really want a direct pull later
BING_ADS_ENABLED=1
BING_ADS_CLIENT_ID=
BING_ADS_CLIENT_SECRET=
BING_ADS_DEVELOPER_TOKEN=
BING_ADS_REFRESH_TOKEN=
BING_ADS_CUSTOMER_ID=
BING_ADS_ACCOUNT_ID=
```

Until `BING_ADS_ENABLED=1` **and** those vars are set, nothing calls Microsoft. Preferred production path: publish `advertising_sources.bing` (and the matching `provisional_totals`) from `coldest-cfo-dashboard`, then let the existing mirror sync land it here.

### What David needs to set

- **Nothing** for a clean $0 pre-launch Bing section on Pages.
- When Bing goes live (~$1,000/day): have the data-repo agent publish a `bing` block / `advertising_sources.bing`. Optionally paste a day in the BING ADS tab or edit `bing_ads_data.json` if the pipeline is late.
- Do **not** put Microsoft credentials in this public repo.

## Sync guard (keeps this repo's UI over the mirror sync)

The workspace cron pushes `public mirror sync — YYYY-MM-DD` with its own `index.html`, `README.md`, `package.json` and `secondary_ads_module.js`. From the 10/27 13:30 sync that wiped the Ad Channel Throttles tab and the `paid_channels_module.js` / `throttles_module.js` / `rolling_mer_header.js` tags. `.github/workflows/restore-protected-days.yml` now runs `scripts/lib/sync_guard.js` first: a file the workspace did not change since its previous sync keeps this repo's version; data (`*.json`, `ads_throttle/`, `protected_days/`, `email_preview.html`) comes from the sync; `index.html` is a 3-way merge of the UI with every `const NAME = …;` data literal masked and refilled from the sync. Same file as `lib/sync_guard.js` in `coldest-cfo-dashboard` — keep them identical. New UI goes in a module plus one script tag, never inline in `index.html`.

## Report quality layer (`report_quality_module.js`)

Tells a real loss day from a data hole, with the same rule as the email (`cfo_backend/report_quality.py` in the data repo): each revenue channel vs its median on the same weekday over the previous 4 weeks. Missing on a usual revenue day → grey, INCOMPLETE, "Whatnot missing"; missing on a usual zero day (Whatnot weekends) → expected; ≥60% below usual → "Check"; a partial headline that ≠ its own channels → "Totals don't add up". Baselines are comparisons only. Also: `−$` money, ET times, weekday dates, an as-of bar, a 30-day at-a-glance table, cards older than 7 days folded (deep links unfold). Wraps `renderReports` / `renderYesterday` / `render30DayAverages`; no MutationObserver.

## Local Development

```bash
npm install
node server.js  # http://localhost:5000
```
