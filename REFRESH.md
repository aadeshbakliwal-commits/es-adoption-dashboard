# ES Feature Adoption Dashboard — Refresh Guide

Generated: 2026-10-20 · Data as of: 2026-10-19 · Connection: `zdp-global` (Snowflake profile)
Warehouse: PUBLIC_ZENDESK_L (per connection config). All queries aggregate in SQL; no raw row pulls.

## Dashboard presentation note (2026-10-20)

Scope set by the dashboard owner:

- **SaaS Management** — no ZDP dataset; shown on the site as a "Not instrumented in ZDP yet" gap card.
- **Change Management** — only an Approvals-funnel proxy exists; shown as a "Not instrumented in ZDP yet" gap card.
  Its proxy data stays in `data/features_master.json` + `sql/es_funnel_monthly.sql` but is not displayed.
- **Advanced Action Flows** — no separate ZDP instrumentation exists (investigated 2026-10-20: no
  `INSTANCE_IS_ADVANCED_ACTION_FLOWS_*` flags, no `%ADVANCED%FLOW%` columns in PRODUCT_ANALYTICS, no
  plan/edition attribute in FACT_FLOWSTATE). ZDP only measures a **blended** Action Flows series
  (basic + advanced combined). Shown as a "Not separately instrumented in ZDP yet" gap card.
- **Action Flows (base), Tasks, MCP Actions, Action Flow Connectors** — measured in ZDP (funnel + ARR blocks).
  Tasks / MCP Actions / Connectors / base Action Flows are intentionally **out of scope**: excluded from
  every dashboard view. Data remains in the JSON blocks.

To re-include any of these, remove its key from `GAP_FEATURES` / `HIDDEN_FEATURES` in `assets/app.js`.

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
| `action_flows` | `FUNCTIONAL.PRODUCT_ANALYTICS.PLATFORM_ADOPTION_INSTANCE_DAILY_SNAPSHOT` (zdp-global) | ZDP-curated `INSTANCE_IS_ACTION_FLOW_*` funnel. **Whole Action Flows product** — ZDP has no advanced-vs-basic split (see the investigation section below). Previously derived from the propagated executions table; re-sourced on 2026-10-20, which shifted the numbers (definitions differ). |
| (segments) | `PRESENTATION.PRODUCT_ANALYTICS.PAID_CUSTOMER_UNIVERSE_DAILY_SNAPSHOT` (zdp-global) | `CRM_MARKET_SUPER_SEGMENT` for `product_breakdown`; join on `INSTANCE_ACCOUNT_ID`, `IS_LATEST_DATE = TRUE` |
| `saas_management` | **none — omitted from all JSON outputs** | No usable dataset: no ZDM dataset collection, no table in FUNCTIONAL/PRESENTATION/CLEANSED on zdp-global or zdp-amer matching SaaS Management/Torii; `ZSM_INTERNAL` DB on zdp-global contains only a TAGS schema, no queryable tables. |

## Per-source freshness cadence

| Source | Cadence | Max snapshot date at generation |
|---|---|---|
| ES_ADOPTION_INSTANCE_DAILY_SNAPSHOT | daily | 2026-10-18 |
| AI_AGENTS_INSTANCE_DAILY_SNAPSHOT | daily | 2026-10-18 |
| PLATFORM_ADOPTION_INSTANCE_DAILY_SNAPSHOT | daily | 2026-10-18 |
| FACT_FLOWSTATE_WORKFLOW_EXECUTIONS_DAILY_SNAPSHOT (propagated; step-level analysis only) | daily, telemetry starts 2026-05 | 2026-10-19 |
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
6. **Action Flows monthly series was re-sourced on 2026-10-20** from the derived execution-count
   funnel to the ZDP-curated `INSTANCE_IS_ACTION_FLOW_*` flags in
   `PLATFORM_ADOPTION_INSTANCE_DAILY_SNAPSHOT`; numbers shifted (activated is now "active >=2 of
   the last 4 weeks", adopted ">=400 completed actions in 28d"). Eligibility = "all accounts with
   a core base plan" (80,234 paid+eligible on 2026-10-18, narrower than all-paid 87,555).
7. **User-level metrics unavailable** → `active_users`/`licensed_users` are null and penetration
   uses the account-level fallback definition.

## Funnel snapshot (`funnel` block in features_master.json)

4-stage nested funnel per feature at the latest snapshot date (query: `sql/funnel_snapshot.sql`).
Every stage is counted within **paid AND feature-eligible** instances, so
eligible >= penetrated >= activated >= adopted. Reference check: ITAM 37,153 / 1,658 / 442 / 222.

| Stage | Definition (all features use ZDP-curated flags) |
|---|---|
| `eligible` | per-feature `ELIGIBLE` flag (`INSTANCE_IS_ACTION_FLOW_ELIGIBLE` = "all accounts with a core base plan") |
| `penetrated` | `PENETRATED` flag (enabled / first meaningful use, 6mo lookback) |
| `activated` | `ACTIVATED` flag (28d meaningful use; platform features: active >=2 of the last 4 weeks) |
| `adopted` | `ADOPTED` flag (ZDP-defined thresholds, e.g. Action Flows >=400 completed actions in 28d + active >=3 of 4 weeks; Connectors >=50/week avg; MCP >=25/week avg, provisional) |

Per-feature sources:

- `itam`, `service_catalog`, `tasks`: `INSTANCE_IS_*` flags in `ES_ADOPTION_INSTANCE_DAILY_SNAPSHOT` (2026-10-18)
- `change_management`: `INSTANCE_IS_APPROVALS_*` flags in the same table (documented proxy; 2026-10-18)
- `es_ai_agents`: `INSTANCE_IS_AI_AGENTS_PAID_*` flags in `AI_AGENTS_INSTANCE_DAILY_SNAPSHOT` (2026-10-18)
- `action_flows`, `action_flow_connectors`, `mcp_actions`: `INSTANCE_IS_{ACTION_FLOW,CONNECTOR,MCP}_*`
  flags in `FUNCTIONAL.PRODUCT_ANALYTICS.PLATFORM_ADOPTION_INSTANCE_DAILY_SNAPSHOT` (2026-10-18).
  These ZDP-curated funnels replaced earlier derivations from execution counts (2026-10-20);
  the flowstate step-type table remains available for step-level analysis but its telemetry
  only starts 2026-05 and it has no advanced-vs-basic attribute.
- `funnel.as_of` = 2026-10-18 (max snapshot date across sources).

## ARR impact (`arr` block in features_master.json)

Net ARR (USD) of the accounts at the `activated` / `adopted` funnel stages, per feature
(query: `sql/arr_impact.sql`).

- **ARR source:** `PRESENTATION.PRODUCT_ANALYTICS.PAID_CUSTOMER_UNIVERSE_DAILY_SNAPSHOT`,
  `IS_LATEST_DATE = TRUE`, field `INSTANCE_ACCOUNT_NET_ARR_USD` (instance-level net ARR, USD).
  Verified 1 row per instance (87,555 rows / 87,555 instances, 0 nulls) on 2026-10-18.
- Stage sets identical to the funnel block (same ZDP-curated flags), joined to PCU on
  `INSTANCE_ACCOUNT_ID`.
- All 8 features have measurable adopted values (ZDP ADOPTED flags), so no nulls were needed.
  Rounded to whole USD in the JSON.
- `mcp_actions` ARR (~$1.0M activated) is based on 16 accounts — treat as directional.

## Advanced vs basic Action Flows — investigation result (2026-10-20)

**No advanced-vs-basic split exists in ZDP; `advanced_action_flows` is therefore NOT reported.**
What was checked:

1. `FUNCTIONAL.INFORMATION_SCHEMA.COLUMNS` across all `PRODUCT_ANALYTICS` schemas for
   `%ADVANCED_ACTION%` / (`%ADVANCED%` AND `%FLOW%`) — **zero columns**.
2. `ES_ADOPTION_INSTANCE_DAILY_SNAPSHOT` — only ITAM / Service Catalog / Approvals / Tasks funnels;
   no Action Flows flags at all.
3. `PROPAGATED_FUNCTIONAL.PRODUCT_ANALYTICS.FACT_FLOWSTATE_WORKFLOW_EXECUTIONS_DAILY_SNAPSHOT` —
   workflow-level columns are `WORKFLOW_STEP_ID`, `WORKFLOW_STEP_TYPE_CATEGORY` (1P/2P/3P),
   `WORKFLOW_STEP_TYPE_SUB_CATEGORY` (step family), `WORKFLOW_STEP_TYPE` (operation name, e.g.
   `if`, `while`, `custom_code`, `tickets_updateTicket`) — **no plan/edition attribute** and no
   column comments distinguishing advanced. Also its telemetry only starts **2026-05**.
4. Flow entity settings (`INT__FLOW_ENTITY_SETTINGS_DAILY_SNAPSHOT`) — not accessible on any
   connection (only watermark references remain in other tables); the similarly-named bot-flow
   tables are messaging bots, not ES Action Flows.
5. `DIM_SUBSCRIPTION_FLAGS_INSTANCE_DAILY_SNAPSHOT` has `INSTANCE_IS_ADVANCED_PLATFORM_SUBSCRIBED`
   / `_PAID_SUBSCRIBED` / `INSTANCE_ADVANCED_PLATFORM_ARR_USD` — but "Advanced Platform" is the
   AI add-on bundle, not an Action Flows edition; no comments document a flows mapping.
6. What ZDP **can** distinguish: whole Action Flows (official funnel), Connectors (3P/2P steps),
   and MCP actions — each with its own curated funnel in `PLATFORM_ADOPTION_INSTANCE_DAILY_SNAPSHOT`.
7. A proxy (instances executing logic steps `if`/`while`/`for_each`/`multi_branch`/`custom_code`
   = "advanced capability usage") is computable from the flowstate step types, but its mapping
   to the product's "Advanced Action Flows" edition is undocumented in ZDP — not used here to
   avoid inventing a split.

## Flagged anomalies (MoM swings >50% in adoption_pct)

All are early-funnel small-base ramps; absolute pp changes are tiny (≤0.81pp) except May 2026 for Action Flows:

- `service_catalog 2025-10`: 0.02→0.08pp (+300% rel.) — single-digit counts in first months.
- `itam 2025-11`: 0%→first reported (funnel launch in data, see gap #3).
- `itam 2025-12 / 2026-01`: +55.6% / +78.6% rel. (0.09→0.14→0.25pp) — small-base ramp.
- `service_catalog 2026-01`: +62.5% rel. (0.08→0.13pp) — small-base ramp.
- `action_flows 2025-10 / 2026-02`: +100% / +66.7% rel. (tiny absolute pp, counts < 50).
- `action_flows 2026-05`: 0.06→0.87pp (+1,350% rel.; activated 108→948) — corroborated by the
  flowstate telemetry starting 2026-05 (new step-level instrumentation) and a likely product
  GA/rollout. Verified in raw data, not a query artifact. No negative counts or hierarchy
  violations found (eligible ≥ penetrated ≥ activated ≥ adopted holds for all features/months).

Paid universe shrank gradually 98,335 (2025-09) → 87,555 (2026-10); no MoM swing >50%.
