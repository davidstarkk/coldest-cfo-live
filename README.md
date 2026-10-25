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

## Paid channels (Meta · Google · Bing · Reddit · Snapchat · ChatGPT)

The Daily Reports strip **Paid channels · ad spend** lists all six. Missing data is **$0** or **no feed** — numbers are never invented.

| Channel | Typical source today | Tab |
|---|---|---|
| Meta | `advertising_sources.meta` (already in pipeline totals) | META ADS |
| Google Ads | `advertising_sources.google_ads` (already in pipeline totals) | GOOGLE ADS |
| Bing / Microsoft | `advertising_sources.bing` or `mer_for_manus.json` → `bing` | BING ADS |
| Reddit | `advertising_sources.reddit` or `mer_for_manus.json` → `reddit` | REDDIT ADS |
| Snapchat | `advertising_sources.snapchat` or `mer_for_manus.json` → `snapchat` | SNAPCHAT ADS |
| ChatGPT Ads | `advertising_sources.chatgpt` or `mer_for_manus.json` → `chatgpt` (manual publish; no API) | CHATGPT ADS |

When `mer_for_manus.json` publishes the daily_inputs contract (`source: daily_inputs`), the strip uses those keys **as written**:

| Key | Meaning |
|---|---|
| `d2c_ad_spend` | D2C ad spend (Shopify D2C paid media, including Bing D2C) |
| `blended_mer` | Shopify D2C revenue ÷ `d2c_ad_spend` |
| `total_ad_spend` | Company ad spend (D2C + `non_d2c`) |
| `bing.spend` / `bing.d2c` / `bing.amazon` | Bing total and the D2C / Amazon split |
| `reddit` / `snapchat` / `chatgpt` | Per-channel blocks; `tracking_verified: false` means unpublished / unverified |
| `non_d2c.whatnot` / `applovin` / `tiktok_shop` / `sellerboard_amazon` / `unallocated` | Non-D2C lines |

Without those keys the strip falls back to a six-channel sum. Meta and Google already inside `provisional_totals.ads` are displayed and **not added again**. Bing / Reddit / Snapchat / ChatGPT overlay into `provisional_totals` only when the pipeline has not published them and a feed has spend &gt; $0.

Feed order per channel (same as Bing):

1. `PARTIAL_REPORTS[].advertising_sources.<channel>` (aliases accepted)
2. `mer_for_manus.json` block (`meta`, `google`, `bing`, `reddit`, `snapchat`, `chatgpt`)
3. optional `<channel>_ads_data.json` (`bing_ads_data.json`, `reddit_ads_data.json`, …)
4. Channel tab → manual daily number (`localStorage` only)

ChatGPT ads has **no API**. Publish a `chatgpt` block from the data repo (or `chatgpt_ads_data.json`). Until then the row is $0 / no feed.

Reporting only. Do **not** put ad-platform credentials in this public repo.

## Throttles

The **THROTTLES** tab is a read-only visual dashboard of every channel plus the live ads-throttle rules.

- Cross-channel: `total_ad_spend`, Shopify D2C revenue, 28-day blended MER with a **3.0** reference line, and 28-day budget share.
- Per channel: 28-day spend + ROAS/MER chart (same 3.0 line), mode chip (`auto` / `hold` / `frozen` / `view`).
- Live controls from `ads_throttle/settings.json` (global threshold / step / min spend / cooldowns + per-channel mode and min/max daily budget). Shown disabled. **Live settings change only through Jarvis in chat.** [Request change](https://github.com/davidstarkk/coldest-cfo-dashboard/issues/new) opens a prefilled issue on `davidstarkk/coldest-cfo-dashboard`.
- What-if inputs are editable in the browser only and recompute recommended actions (scale / cut / hold). They do not write settings.
- Change log from `ads_throttle/changes.json`.
- 28-day series from `ads_throttle/series.json` (`source: daily_inputs`). Missing channel ROAS is not invented; the yellow line is company D2C blended MER when a channel has no attributed ROAS.

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
    "tracking_verified": true
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

2026-10-24 expected on the live page: D2C spend **$14,382.78**, blended MER **1.84**, total **$21,678.86**, Bing **$77.33** = D2C **$0.97** + Amazon **$76.36**.

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

## Local Development

```bash
npm install
npm test
node server.js  # http://localhost:5000
```
