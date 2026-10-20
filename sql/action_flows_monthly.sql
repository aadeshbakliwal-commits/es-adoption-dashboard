-- Action Flows (whole product) monthly series from ZDP-curated flags in
-- FUNCTIONAL.PRODUCT_ANALYTICS.PLATFORM_ADOPTION_INSTANCE_DAILY_SNAPSHOT (zdp-global).
--
-- NOTE ON SCOPE (2026-10-20): this is the WHOLE Action Flows product. ZDP has NO
-- advanced-vs-basic Action Flows attribute (checked INFORMATION_SCHEMA.COLUMNS across layers,
-- the flowstate fact's workflow-level columns, and flow entity settings), so
-- "advanced_action_flows" cannot be reported separately. See REFRESH.md for the investigation.
-- This file previously derived stages from execution counts; it now uses the ZDP-curated
-- INSTANCE_IS_ACTION_FLOW_* funnel (definitions differ; see REFRESH.md).
--
-- PARAMETERS (edit before running):
SET start_month = '2025-09-01';
SET end_date    = '2026-10-19';
--
-- Stage mapping (consistent with the other features):
--   accounts_total     = paid customers with a core base plan (ACTION_FLOW_ELIGIBLE)
--   activated_accounts = INSTANCE_IS_ACTION_FLOW_PENETRATED (>=1 successful action in 6mo)
--   accounts_using     = INSTANCE_IS_ACTION_FLOW_ACTIVATED (active >=2 of last 4 weeks)
--   adopted_accounts   = INSTANCE_IS_ACTION_FLOW_ADOPTED (>=400 completed actions in 28d
--                        and active >=3 of last 4 weeks) -- reference only, not in the JSON
--
-- Run: snow sql -f sql/action_flows_monthly.sql --connection zdp-global

WITH snapshot_dates AS (
    SELECT DISTINCT SOURCE_SNAPSHOT_DATE
    FROM FUNCTIONAL.PRODUCT_ANALYTICS.PLATFORM_ADOPTION_INSTANCE_DAILY_SNAPSHOT
    WHERE SOURCE_SNAPSHOT_DATE >= $start_month
      AND SOURCE_SNAPSHOT_DATE <= $end_date
),
month_ends AS (
    SELECT DATE_TRUNC('month', SOURCE_SNAPSHOT_DATE) AS month,
           MAX(SOURCE_SNAPSHOT_DATE) AS snap_date
    FROM snapshot_dates
    GROUP BY 1
),
funnel AS (
    SELECT
        DATE_TRUNC('month', a.SOURCE_SNAPSHOT_DATE)                                        AS month,
        a.SOURCE_SNAPSHOT_DATE                                                             AS snapshot_date,
        COUNT(DISTINCT CASE WHEN a.INSTANCE_IS_PAID_CUSTOMER AND a.INSTANCE_IS_ACTION_FLOW_ELIGIBLE
                            THEN a.INSTANCE_ACCOUNT_ID END)                                AS accounts_total,
        COUNT(DISTINCT CASE WHEN a.INSTANCE_IS_PAID_CUSTOMER AND a.INSTANCE_IS_ACTION_FLOW_ELIGIBLE AND a.INSTANCE_IS_ACTION_FLOW_PENETRATED
                            THEN a.INSTANCE_ACCOUNT_ID END)                                AS activated_accounts,
        COUNT(DISTINCT CASE WHEN a.INSTANCE_IS_PAID_CUSTOMER AND a.INSTANCE_IS_ACTION_FLOW_ELIGIBLE AND a.INSTANCE_IS_ACTION_FLOW_ACTIVATED
                            THEN a.INSTANCE_ACCOUNT_ID END)                                AS accounts_using,
        COUNT(DISTINCT CASE WHEN a.INSTANCE_IS_PAID_CUSTOMER AND a.INSTANCE_IS_ACTION_FLOW_ELIGIBLE AND a.INSTANCE_IS_ACTION_FLOW_ADOPTED
                            THEN a.INSTANCE_ACCOUNT_ID END)                                AS adopted_accounts
    FROM FUNCTIONAL.PRODUCT_ANALYTICS.PLATFORM_ADOPTION_INSTANCE_DAILY_SNAPSHOT a
    INNER JOIN month_ends m
        ON a.SOURCE_SNAPSHOT_DATE = m.snap_date
    GROUP BY 1, 2
)
SELECT *
FROM funnel
ORDER BY month;
