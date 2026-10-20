# ES Feature Adoption Dashboard — Refresh Guide

Generated: 2026-10-20 · Data as of: 2026-10-19 · Connection: `zdp-global` (Snowflake profile)
Warehouse: PUBLIC_ZENDESK_L (per connection config). All queries aggregate in SQL; no raw row pulls.

## How to re-run

All queries are parameterized with `SET start_month` / `SET end_date` at the top of each file —
edit those two lines to change the window, then:

```bash
cd /Users/aadesh.bakliwal/es-adoption-dashboard

# 1. check source freshness (update "as_of" and sources[].freshness in the JSONs from MAX_SNAPSHOT_DATE)
snow sql -f sql/source_freshness.sql --connection zdp-global

# 2. monthly funnels (CSV exports land next to the .sql files)
snow sql -f sql/es_funnel_monthly.sql --connection zdp-global --format csv > sql/es_funnel_monthly.csv
snow sql -f sql/ai_agents_monthly.sql --connection zdp-global --format csv > sql/ai_agents_monthly.csv
snow sql -f sql/action_flows_monthly.sql --connection zdp-global --format csv > sql/action_flows_monthly.csv

# 3. segment breakdown at the latest snapshot
snow sql -f sql/product_breakdown_latest.sql --connection zdp-global --format csv > sql/product_breakdown_latest.csv

# 4. 4-stage funnel snapshot + ARR impact (latest snapshot)
snow sql -f sql/funnel_snapshot.sql --connection zdp-global --format csv > sql/funnel_snapshot.csv
snow sql -f sql/arr_impact.sql --connection zdp-global --format csv > sql/arr_impact.csv

# 5. rebuild the JSON deliverables (includes sanity checks and anomaly flags)
node build_json.mjs

# 5. wrap the JSONs as data/*.js so index.html (static site) picks them up
bin/wrap-data.sh
```

Note: `snow sql` prints "Statement executed successfully" status lines for the `SET` statements
into the CSVs; `build_json.mjs` skips them automatically. If a query errors, re-run without
`--format csv` to see the full error.

## Metric definitions (as implemented)

| Metric | Formula | Source fields |
|---|---|---|
| **Adoption** | accounts_using ÷ accounts_total | `*_ACTIVATED` flag (meaningful use in last 28d, month-end snapshot); Action Flows: ≥1 completed flow-step execution in month |
| **Activation** | activated_accounts ÷ accounts_total | `*_PENETRATED` flag (feature enabled / first meaningful use in last 6mo); Action Flows: ≥1 completed execution ever up to month end |
| **Penetration** | accounts_using ÷ activated_accounts | Depth of usage: share of feature-enabled/first-used accounts that are actively using it. User-level "active users ÷ licensed users" is **not available** in ZDP instance-level snapshots — this documented fallback is used instead. |
| **mom_delta_adoption_pp** | adoption_pct(current month) − adoption_pct(previous month), percentage points | |

### Account universe (denominator)

`accounts_total` = **paid customer instances eligible for the feature** at the month-end snapshot
(NOT "all Zendesk accounts"):

- Paid = `INSTANCE_IS_PAID_CUSTOMER = TRUE` in `ES_ADOPTION_INSTANCE_DAILY_SNAPSHOT` — verified to
  exactly match `PRESENTATION.PRODUCT_ANALYTICS.PAID_CUSTOMER_UNIVERSE_DAILY_SNAPSHOT` (87,555 instances on 2026-10-18).
- Feature eligibility = the per-feature `ELIGIBLE` flag:
  - ITAM / Service Catalog: "Has CX or ES Suite" — **includes CX Suite plans, not only ES Suite**
  - Approvals (Change Management proxy) / Tasks: "CX Suite Professional+ or ES Suite Growth+"
  - AI Agents: "has core_base_plan" (broadest — hence the larger AI Agents denominator of ~80k)
  - Action Flows: no eligibility flag exists → denominator = all paid customers
- Month definition: **last available `SOURCE_SNAPSHOT_DATE` within each calendar month** (month-end
  snapshot; flags are rolling 28d/6mo windows). Current month is MTD (latest available snapshot).
- `active_users` / `licensed_users` are `null` in the JSON: no user-level usage/entitlement data
  exists in these ZDP tables (only instance-level booleans). If user-level data is needed,
  `FUNCTIONAL.PRODUCT_ANALYTICS.FACT_INSTANCE_ACCOUNT_USER_ROLE_PRODUCT_ENTITLEMENTS_SCD2` (zdp-amer) is a possible future source, not verified in this pass.

## Feature → source mapping

| Feature key | ZDP table | Notes |
|---|---|---|
| `itam` | `FUNCTIONAL.PRODUCT_ANALYTICS.ES_ADOPTION_INSTANCE_DAILY_SNAPSHOT` (zdp-global, native GLOBAL) | Funnel flags + `COUNT_ACTIVE_ITAM_ASSETS` |
| `service_catalog` | same table | Funnel flags + ticket/catalog-item counts |
| `change_management` | same table | **Proxy: Approvals funnel** (`INSTANCE_IS_APPROVALS_*`). No dedicated Change Management dataset exists in ZDP. Approvals are the approval-workflow component of ES change management; task lists (`INSTANCE_IS_TASKS_*`) are also available in the same table if a Tasks-based view is preferred. |
| `es_ai_agents` | `FUNCTIONAL.PRODUCT_ANALYTICS.AI_AGENTS_INSTANCE_DAILY_SNAPSHOT` (zdp-global) | Whole AI Agents product (CX + EX combined) — ZDP does not split AI agent usage by ES vs CX. Paid funnel flags used (`..._PAID_*`). |
| `action_flows` | `PROPAGATED_FUNCTIONAL.PRODUCT_ANALYTICS.FACT_AGGREGATED_ACTION_FLOW_EXECUTIONS_DAILY_SNAPSHOT` (zdp-global; regional AMER/EMEA/AU data propagated, non-anonymized) | Daily execution counters only; funnel derived from usage. Regional native copy exists on `zdp-amer` (`FUNCTIONAL.PRODUCT_ANALYTICS.FACT_AGGREGATED_ACTION_FLOW_EXECUTIONS_DAILY_SNAPSHOT`, AMER instances only) — the propagated global table is used for all-region coverage. |
| (segments) | `PRESENTATION.PRODUCT_ANALYTICS.PAID_CUSTOMER_UNIVERSE_DAILY_SNAPSHOT` (zdp-global) | `CRM_MARKET_SUPER_SEGMENT` for `product_breakdown`; join on `INSTANCE_ACCOUNT_ID`, `IS_LATEST_DATE = TRUE` |
| `saas_management` | **none — omitted from all JSON outputs** | No usable dataset: no ZDM dataset collection, no table in FUNCTIONAL/PRESENTATION/CLEANSED on zdp-global or zdp-amer matching SaaS Management/Torii; `ZSM_INTERNAL` DB on zdp-global contains only a TAGS schema, no queryable tables. |

## Per-source freshness cadence

| Source | Cadence | Max snapshot date at generation |
|---|---|---|
| ES_ADOPTION_INSTANCE_DAILY_SNAPSHOT | daily | 2026-10-18 |
| AI_AGENTS_INSTANCE_DAILY_SNAPSHOT | daily | 2026-10-18 |
| FACT_AGGREGATED_ACTION_FLOW_EXECUTIONS_DAILY_SNAPSHOT (propagated) | daily | 2026-10-19 |
| PAID_CUSTOMER_UNIVERSE_DAILY_SNAPSHOT | daily | 2026-10-18 |
| ES_USAGE_INSTANCE_DAILY_SNAPSHOT (explored, not used) | daily | 2026-10-16 |

## Known gaps & caveats

1. **SaaS Management: no dataset.** Omitted from JSONs; do not invent numbers for it.
2. **Change Management is proxied** by the Approvals funnel (see table above). Treat its numbers
   as "Change Management (Approvals)" until ZDP ships a dedicated dataset.
3. **ITAM funnel flags are absent before 2025-11** — `INSTANCE_IS_ITAM_PENETRATED/ACTIVATED/ADOPTED`
   are 0 for Sep–Oct 2025 snapshots, then jump to 510 penetrated in Nov 2025. The funnel first
   reported in Nov 2025; early months are not a real "zero adoption".
4. **AI Agents is not ES-specific** — it covers the AI Agents product across CX and EX.
5. **Eligibility includes CX plans** for ITAM/Service Catalog/Approvals (feature entitlement is
   CX-or-ES Suite), so denominators are larger than "ES-suite-only accounts".
6. **Action Flows history starts 2025-08-20**; months from 2025-09 are complete. No per-feature
   eligibility flag → activation/adoption denominators = all paid customers.
7. **User-level metrics unavailable** → `active_users`/`licensed_users` are null and penetration
   uses the account-level fallback definition.

## Funnel snapshot (`funnel` block in features_master.json)

4-stage nested funnel per feature at the latest snapshot date (query: `sql/funnel_snapshot.sql`).
Every stage is counted within **paid AND feature-eligible** instances, so
eligible >= penetrated >= activated >= adopted. Reference check: ITAM 37,153 / 1,658 / 442 / 222.

| Stage | Flag-based features | Flow-derived features |
|---|---|---|
| `eligible` | per-feature `ELIGIBLE` flag | all paid customers (no eligibility flag exists) |
| `penetrated` | `PENETRATED` flag (enabled / first meaningful use, 6mo) | >=1 completed step execution **ever** up to snapshot (bounded by flow-table history, starts 2025-08-20) |
| `activated` | `ACTIVATED` flag (meaningful use, 28d) | >=1 completed step execution in the **last 28 days** |
| `adopted` | `ADOPTED` flag (sustained use, 28d) | >=2 completed step executions in the last 28 days (derived, mirrors the Approvals/Tasks "at least 2 in 28d" rule) |

Per-feature sources:

- `itam`, `service_catalog`, `tasks`: `INSTANCE_IS_*` flags in `ES_ADOPTION_INSTANCE_DAILY_SNAPSHOT` (2026-10-18)
- `change_management`: `INSTANCE_IS_APPROVALS_*` flags in the same table (documented proxy; 2026-10-18)
- `es_ai_agents`: `INSTANCE_IS_AI_AGENTS_PAID_*` flags in `AI_AGENTS_INSTANCE_DAILY_SNAPSHOT` (2026-10-18)
- `action_flows`: `FACT_AGGREGATED_ACTION_FLOW_EXECUTIONS_DAILY_SNAPSHOT` (propagated; 2026-10-19)
- `action_flow_connectors`, `mcp_actions`: `FACT_FLOWSTATE_WORKFLOW_EXECUTIONS_DAILY_SNAPSHOT`
  (propagated; 2026-10-19), split by `WORKFLOW_STEP_TYPE_CATEGORY` / `_SUB_CATEGORY`:
  connectors = 2P `customapi` + all 3P sub-categories except `wait` (includes AI model steps
  claude/openai/gemini); `mcp_actions` = 3P `mcp` only and is a **subset of connectors**.
  1P `system` logic steps excluded everywhere, matching the aggregated table's definition.
- `funnel.as_of` = 2026-10-19 (max snapshot date across sources).

## ARR impact (`arr` block in features_master.json)

Net ARR (USD) of the accounts at the `activated` / `adopted` funnel stages, per feature
(query: `sql/arr_impact.sql`).

- **ARR source:** `PRESENTATION.PRODUCT_ANALYTICS.PAID_CUSTOMER_UNIVERSE_DAILY_SNAPSHOT`,
  `IS_LATEST_DATE = TRUE`, field `INSTANCE_ACCOUNT_NET_ARR_USD` (instance-level net ARR, USD).
  Verified 1 row per instance (87,555 rows / 87,555 instances, 0 nulls) on 2026-10-18.
- Stage sets identical to the funnel block (same flags; flow-derived stages use the same
  >=1 / >=2 completed-executions-in-28d definitions), joined to PCU on `INSTANCE_ACCOUNT_ID`.
- All 8 features have measurable adopted values (flows-derived via the documented >=2-in-28d
  rule), so no nulls were needed. Rounded to whole USD in the JSON.
- `mcp_actions` ARR (~$1.6M activated) is based on 21 accounts — treat as directional.
- Note the 28d activated stage for flows-derived features (trailing window ending 2026-10-19)
  differs slightly from the monthly "in-month usage" counts (2,306 vs 2,157 for action_flows).

## Flagged anomalies (MoM swings >50% in adoption_pct)

All are early-funnel small-base ramps; absolute pp changes are tiny (≤0.91pp) except May 2026 for Action Flows:

- `service_catalog 2025-10`: 0.02→0.08pp (+300% rel.) — single-digit counts in first months.
- `itam 2025-11`: 0%→first reported (funnel launch in data, see gap #3).
- `itam 2025-12 / 2026-01`: +55.6% / +78.6% rel. (0.09→0.14→0.25pp) — small-base ramp.
- `service_catalog 2026-01`: +62.5% rel. (0.08→0.13pp) — small-base ramp.
- `action_flows 2026-05`: 0.07→0.98pp (+1,300% rel.; accounts_using 65→914) — likely Advanced
  Action Flows GA/rollout or a tracking change; verified the jump is present in raw monthly
  execution counts, not a query artifact. No negative counts or hierarchy violations found
  (using ≤ activated ≤ total holds for all features/months).

Paid universe shrank gradually 98,335 (2025-09) → 87,555 (2026-10); no MoM swing >50%.
