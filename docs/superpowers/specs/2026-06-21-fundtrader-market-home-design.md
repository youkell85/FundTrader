# FundTrader Market Home Redesign Design

Date: 2026-06-21
Status: approved direction, pending implementation plan

## Goal

Redesign the `/fund/` market home page from a generic cockpit into a practical fund market homepage for users who already have, or are building, a watchlist or allocation plan.

The first screen should answer:

1. What is the current market condition for filtering funds?
2. Which funds stand out by type using real available metrics?
3. What should the user do next: compare, inspect details, generate allocation, or review an existing plan?

The page must not present incomplete, seeded, missing, or stale data as an investment recommendation.

## Approved Direction

Use the approved mixed structure:

- Top decision strip with one clear market-home conclusion.
- Main left area as the fund market table and filters.
- Left lower area as the main feature: `分类型优选横榜`.
- Right rail as complementary workflow context:
  - `组合 / 自选摘要`
  - `市场压力` with a one-sentence conclusion
  - `下一步`

Do not keep a separate right-rail `近期优质产品` card, because it duplicates `分类型优选横榜`.

## First-Screen Layout

1. Top navigation and search
   - Keep current app navigation.
   - Search supports fund name, code, manager, and company.

2. Market-home conclusion strip
   - One headline, for example: `适合筛选近期强势产品，同时关注波动风险`.
   - Supporting sentence based on real status:
     - market data health
     - macro availability/confidence
     - volatility pressure
     - missing industry heat when unavailable
   - Metric chips:
     - `分类型优选`
     - market data health
     - macro confidence
     - volatility ratio

3. Fund market table
   - Primary left section.
   - Filters: all, equity, hybrid, bond, index, QDII, FOF.
   - Sorts: return, Sharpe, max drawdown, scale.
   - Columns:
     - fund name/code
     - type
     - recent return, initially 1-year when available
     - max drawdown
     - Sharpe
     - fee or explicit missing
     - NAV date
     - data status

4. `分类型优选横榜`
   - Main differentiating homepage module.
   - One card per useful fund type.
   - Each card shows:
     - type
     - selected fund code/name
     - selection reason, such as `收益 + 夏普` or `夏普优先`
     - 1-year return
     - Sharpe
   - Show missing categories honestly; do not force QDII or money funds when reliable samples are unavailable.

5. Right rail
   - `组合 / 自选摘要`
     - If a saved allocation exists: show portfolio health, risk, and deviation cues.
     - If only watchlist exists: show watchlist coverage and missing-weight state.
     - If no user data exists: state the current view is fund market screening, not a portfolio.
   - `市场压力`
     - Must start with one sentence, for example:
       `波动偏高：筛选时先看回撤和夏普，再看近一年收益；暂不做行业强弱判断。`
     - Then show compact indicators:
       - market health
       - macro confidence
       - vol ratio
       - industry heat availability
   - `下一步`
     - View type winners
     - Open professional comparison
     - Generate allocation
     - Review latest allocation plan

## Business Logic

### Market Pressure

Inputs:

- `getMarketOverview()` via `/recommend/market`
- `getMarketDataStatus()` via `/market-data/status`

Rules:

- If market health is `healthy` and macro is available, use a normal decision tone.
- If `vol_ratio` is above normal, show a risk-first screening conclusion.
- If industry heat is missing or empty, explicitly avoid industry-strength claims.
- If market overview fails, keep fund market usable and show a degraded market-pressure sentence.

### Fund Market Table

Inputs:

- Current `fund.list` tRPC query with `withMetrics=true`
- Existing fund fields and mapped performance fields

Rules:

- Show real metric values only.
- If fee, scale, max drawdown, Sharpe, or NAV date are missing, display `缺失` or equivalent explicit state.
- Do not infer purchase heat, popularity, or recommendation strength without a real source.

### `分类型优选横榜`

Inputs:

- The loaded fund list and available metrics.

Selection rules:

1. Group candidates by normalized fund type.
2. Exclude funds with invalid or missing NAV date or seeded/missing data quality.
3. For each type:
   - choose top Sharpe when Sharpe is available;
   - choose top 1-year return as secondary comparison;
   - if the same fund leads both, label it `收益 + 夏普`;
   - if different funds lead the two dimensions, show one primary and mention the other as the return champion or Sharpe champion.
4. If a type has no reliable samples, show a compact missing state rather than a fake winner.

This module may be called `分类型优选`, not `热门基金`, unless real popularity, search, click, or transaction data is later added.

## Data Truth Requirements

- Do not synthesize heat or popularity.
- Use visible status for stale, missing, seeded, partial, or unavailable fields.
- Existing `available` / `partial` / `missing` conventions from detail pages should remain the product standard.
- Homepage copy must clearly state that the page is analytical support, not investment advice.

## Frontend Scope

Expected implementation files:

- `frontend/src/pages/Home.tsx`
- `frontend/src/components/dashboard/CockpitDashboard.tsx`

Avoid backend or API contract changes unless implementation proves the current payload cannot support the approved behavior.

Keep existing exported types compatible:

- `FundLike`
- `DashboardMode`
- `MarketOverviewPayload`

## Visual Direction

- Serious investment tool, not marketing page.
- Dense enough for scanning, but not a crowded cockpit.
- Keep cards at 8px radius or less.
- Avoid duplicate modules.
- Keep left side as fund market work area and right rail as supporting context.
- Mobile order:
  1. conclusion
  2. fund filters/table
  3. type winners
  4. market pressure
  5. portfolio/watchlist summary
  6. next actions

## Validation Plan

Before implementation commit:

- Run GitNexus impact for changed symbols.
- Run `npm.cmd run check`.
- Run `npm.cmd run build`.
- Run visual smoke on desktop and mobile.
- Verify no text overlap and no large empty area under the fund market table.
- Verify search/filter still works.
- Verify missing data states are explicit.

After production deploy:

- Verify `/fund/api/health`.
- Verify `/fund/` returns 200.
- Browser-smoke `/fund/` on production if browser access is available.
