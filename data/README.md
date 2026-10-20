# data/ — column dictionary and lineage

Generated 2026-10-20 by `build_json.mjs` from the CSV exports in `../sql/`.
Rebuild: see `../REFRESH.md`. Feature keys: `itam`, `service_catalog`, `es_ai_agents`,
`change_management`, `action_flows` (`saas_management` omitted — no dataset in ZDP).

## features_master.json

| Field | Meaning |
|---|---|
| `generated_at` | ISO timestamp when the JSON was built |
| `as_of` | max source freshness across used tables (max `SOURCE_SNAPSHOT_DATE`) |
| `definitions` | plain-language metric definitions as implemented |
| `sources[]` | one entry per source table: `feature`, `table` (db.schema.table), `grain`, `freshness` |
| `monthly[]` | per feature × month rows (2025-09 … 2026-10; last month is MTD) |
| `product_breakdown[]` | latest snapshot, per feature × market segment |

### monthly[] columns

| Column | Meaning | Lineage |
|---|---|---|
| `feature` | feature key | — |
| `month` | "YYYY-MM"; snapshot = last available `SOURCE_SNAPSHOT_DATE` in the month | `SOURCE_SNAPSHOT_DATE` |
| `accounts_using` | paid+eligible instances with meaningful use in last 28d (Action Flows: ≥1 completed execution in month) | ITAM/SC/CM: `FUNCTIONAL.PRODUCT_ANALYTICS.ES_ADOPTION_INSTANCE_DAILY_SNAPSHOT.INSTANCE_IS_*_ACTIVATED`; AI Agents: `...AI_AGENTS_INSTANCE_DAILY_SNAPSHOT.INSTANCE_IS_AI_AGENTS_PAID_ACTIVATED`; Action Flows: `SUM(COUNT_COMPLETED_ACTION_FLOW_STEP_EXECUTIONS) > 0` in month, paid-restricted |
| `accounts_total` | paid instances eligible for the feature (denominator) | `INSTANCE_IS_PAID_CUSTOMER` ∧ per-feature `*_ELIGIBLE` flag; Action Flows: paid only |
| `adoption_pct` | accounts_using ÷ accounts_total × 100 | computed |
| `active_users` | **null** — user-level usage not available in ZDP instance snapshots | — |
| `licensed_users` | **null** — user-level entitlements not available | — |
| `penetration_pct` | accounts_using ÷ activated_accounts × 100 (depth of usage; documented fallback) | computed |
| `activated_accounts` | feature enabled / first meaningful use in last 6mo (Action Flows: any completed execution ever up to month end) | `INSTANCE_IS_*_PENETRATED`; Action Flows: cumulative distinct paid instances with executions |
| `activation_pct` | activated_accounts ÷ accounts_total × 100 | computed |

### product_breakdown[] columns

| Column | Meaning | Lineage |
|---|---|---|
| `feature` | feature key | — |
| `product` | CRM market super segment: Digital / Corporate / Enterprise / Unknown | `PRESENTATION.PRODUCT_ANALYTICS.PAID_CUSTOMER_UNIVERSE_DAILY_SNAPSHOT.CRM_MARKET_SUPER_SEGMENT` (values "1.Digital"→"Digital" etc.), join on `INSTANCE_ACCOUNT_ID`, `IS_LATEST_DATE = TRUE` |
| `accounts_using` | paid instances actively using in the latest period, within segment | feature flags / execution counts as above, joined to PCU |
| `adoption_pct` | accounts_using ÷ accounts_total within segment × 100 | computed |

## summary.json

| Column | Meaning |
|---|---|
| `current_month` | month of the KPI snapshot (2026-10, MTD) |
| `features[]` | one KPI tile per feature: `feature`, `display_name`, `accounts_using`, `accounts_total`, `adoption_pct`, `penetration_pct`, `activation_pct`, `active_users` (null), `mom_delta_adoption_pp` (adoption change vs previous month, percentage points), `data_as_of` |
| `features_ranked` | feature keys sorted by `adoption_pct` desc |

## Table → metric lineage (summary)

- `FUNCTIONAL.PRODUCT_ANALYTICS.ES_ADOPTION_INSTANCE_DAILY_SNAPSHOT` → itam, service_catalog, change_management (all numerator/denominator flags)
- `FUNCTIONAL.PRODUCT_ANALYTICS.AI_AGENTS_INSTANCE_DAILY_SNAPSHOT` → es_ai_agents
- `PROPAGATED_FUNCTIONAL.PRODUCT_ANALYTICS.FACT_AGGREGATED_ACTION_FLOW_EXECUTIONS_DAILY_SNAPSHOT` → action_flows numerators
- `FUNCTIONAL.PRODUCT_ANALYTICS.ES_ADOPTION_INSTANCE_DAILY_SNAPSHOT` (paid flag) → action_flows denominator + monthly paid universe
- `PRESENTATION.PRODUCT_ANALYTICS.PAID_CUSTOMER_UNIVERSE_DAILY_SNAPSHOT` → segment dimension only

Query files: `../sql/es_funnel_monthly.sql`, `../sql/ai_agents_monthly.sql`,
`../sql/action_flows_monthly.sql`, `../sql/product_breakdown_latest.sql`,
`../sql/source_freshness.sql` (each + its `.csv` export). No PII is included: all rows are
aggregated counts keyed by feature/month/segment; subdomains, account names, and IDs never leave
the database.
