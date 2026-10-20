-- Advanced Action Flows monthly series from
-- PROPAGATED_FUNCTIONAL.PRODUCT_ANALYTICS.FACT_AGGREGATED_ACTION_FLOW_EXECUTIONS_DAILY_SNAPSHOT (zdp-global).
-- The table is regional data (AMER/EMEA/AU) propagated to zdp-global with real instance ids
-- (non-anonymized), so it covers all regions. It is a daily per-instance execution counter --
-- no eligibility / enabled flags exist, so the funnel is derived from usage:
--
--   accounts_using     = instances with >= 1 completed flow-step execution in the month
--   activated_accounts = instances with >= 1 completed flow-step execution ever, up to month end
--                        ("first meaningful use" cumulative curve)
--   accounts_total     = paid customers at month end (from ES_ADOPTION_INSTANCE_DAILY_SNAPSHOT,
--                        same universe table as the other features; joined on instance+month)
--
-- PARAMETERS (edit before running):
SET start_month = '2025-09-01';
SET end_date    = '2026-10-19';
--
-- Run: snow sql -f sql/action_flows_monthly.sql --connection zdp-global

WITH flow_daily AS (
    SELECT
        SOURCE_SNAPSHOT_DATE                                        AS snap_date,
        INSTANCE_ACCOUNT_ID,
        COUNT_COMPLETED_ACTION_FLOW_STEP_EXECUTIONS                  AS completed_execs
    FROM PROPAGATED_FUNCTIONAL.PRODUCT_ANALYTICS.FACT_AGGREGATED_ACTION_FLOW_EXECUTIONS_DAILY_SNAPSHOT
    WHERE SOURCE_SNAPSHOT_DATE >= $start_month
      AND SOURCE_SNAPSHOT_DATE <= $end_date
),
months AS (
    SELECT DISTINCT DATE_TRUNC('month', snap_date) AS month
    FROM flow_daily
),
flow_monthly AS (
    SELECT
        DATE_TRUNC('month', snap_date) AS month,
        INSTANCE_ACCOUNT_ID,
        SUM(completed_execs)           AS monthly_execs
    FROM flow_daily
    GROUP BY 1, 2
),
monthly AS (
    SELECT
        month,
        COUNT(DISTINCT CASE WHEN monthly_execs > 0 THEN INSTANCE_ACCOUNT_ID END) AS accounts_using
    FROM flow_monthly
    GROUP BY 1
),
cumulative AS (
    SELECT
        m.month,
        COUNT(DISTINCT CASE WHEN f.completed_execs > 0 THEN f.INSTANCE_ACCOUNT_ID END) AS activated_accounts
    FROM months m
    INNER JOIN flow_daily f
        ON f.snap_date < DATEADD('month', 1, m.month)   -- everything up to month end
    GROUP BY 1
),
-- paid customer universe per month, from the same ES_ADOPTION table used for the other features
snapshot_dates AS (
    SELECT DISTINCT SOURCE_SNAPSHOT_DATE
    FROM FUNCTIONAL.PRODUCT_ANALYTICS.ES_ADOPTION_INSTANCE_DAILY_SNAPSHOT
    WHERE SOURCE_SNAPSHOT_DATE >= $start_month
      AND SOURCE_SNAPSHOT_DATE <= $end_date
),
month_ends AS (
    SELECT DATE_TRUNC('month', SOURCE_SNAPSHOT_DATE) AS month,
           MAX(SOURCE_SNAPSHOT_DATE) AS snap_date
    FROM snapshot_dates
    GROUP BY 1
),
universe AS (
    SELECT
        DATE_TRUNC('month', e.SOURCE_SNAPSHOT_DATE) AS month,
        COUNT(DISTINCT e.INSTANCE_ACCOUNT_ID)       AS accounts_total
    FROM FUNCTIONAL.PRODUCT_ANALYTICS.ES_ADOPTION_INSTANCE_DAILY_SNAPSHOT e
    INNER JOIN month_ends m
        ON e.SOURCE_SNAPSHOT_DATE = m.snap_date
    WHERE e.INSTANCE_IS_PAID_CUSTOMER = TRUE
    GROUP BY 1
)
SELECT
    u.month,
    COALESCE(fl.accounts_using, 0)      AS accounts_using,
    COALESCE(cu.activated_accounts, 0)  AS activated_accounts,
    u.accounts_total
FROM universe u
LEFT JOIN monthly    fl ON fl.month = u.month
LEFT JOIN cumulative cu ON cu.month = u.month
ORDER BY u.month;
