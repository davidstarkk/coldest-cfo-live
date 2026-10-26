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

## Local Development

```bash
npm install
node server.js  # http://localhost:5000
```
