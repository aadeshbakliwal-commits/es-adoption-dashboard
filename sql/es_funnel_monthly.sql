-- ES feature funnel monthly series from ZDP ES_ADOPTION_INSTANCE_DAILY_SNAPSHOT (zdp-global).
-- Covers features: itam, service_catalog, change_management (proxied by the Approvals funnel).
--
-- PARAMETERS (edit before running):
SET start_month = '2025-09-01';   -- first month, as month-start date
SET end_date    = '2026-10-19';   -- last snapshot date to include (current month = MTD)

-- Month definition: the LAST SOURCE_SNAPSHOT_DATE available within each calendar month
-- ("month-end snapshot"). Flags are rolling windows (28d / 6mo) so month-end snapshots
-- give a consistent monthly series.
--
-- Metric mapping (see REFRESH.md):
--   *_total     = paid customers eligible for the feature  (adoption & activation denominator)
--   *_activated = INSTANCE_IS_*_PENETRATED  = feature enabled / first meaningful use (6mo)
--   *_using     = INSTANCE_IS_*_ACTIVATED   = meaningful use within last 28 days
--   *_adopted   = INSTANCE_IS_*_ADOPTED     = sustained usage within last 28 days
--
-- Run: snow sql -f sql/es_funnel_monthly.sql --connection zdp-global

WITH snapshot_dates AS (
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
funnel AS (
    SELECT
        DATE_TRUNC('month', e.SOURCE_SNAPSHOT_DATE)                                        AS month,
        e.SOURCE_SNAPSHOT_DATE                                                             AS snapshot_date,
        -- paid universe (denominator for action_flows, cross-check for others)
        COUNT(DISTINCT CASE WHEN e.INSTANCE_IS_PAID_CUSTOMER
                            THEN e.INSTANCE_ACCOUNT_ID END)                                AS paid_accounts_total,
        -- ITAM
        COUNT(DISTINCT CASE WHEN e.INSTANCE_IS_PAID_CUSTOMER AND e.INSTANCE_IS_ITAM_ELIGIBLE
                            THEN e.INSTANCE_ACCOUNT_ID END)                                AS itam_accounts_total,
        COUNT(DISTINCT CASE WHEN e.INSTANCE_IS_PAID_CUSTOMER AND e.INSTANCE_IS_ITAM_ELIGIBLE AND e.INSTANCE_IS_ITAM_PENETRATED
                            THEN e.INSTANCE_ACCOUNT_ID END)                                AS itam_activated_accounts,
        COUNT(DISTINCT CASE WHEN e.INSTANCE_IS_PAID_CUSTOMER AND e.INSTANCE_IS_ITAM_ELIGIBLE AND e.INSTANCE_IS_ITAM_ACTIVATED
                            THEN e.INSTANCE_ACCOUNT_ID END)                                AS itam_accounts_using,
        COUNT(DISTINCT CASE WHEN e.INSTANCE_IS_PAID_CUSTOMER AND e.INSTANCE_IS_ITAM_ELIGIBLE AND e.INSTANCE_IS_ITAM_ADOPTED
                            THEN e.INSTANCE_ACCOUNT_ID END)                                AS itam_adopted_accounts,
        -- Service Catalog
        COUNT(DISTINCT CASE WHEN e.INSTANCE_IS_PAID_CUSTOMER AND e.INSTANCE_IS_SERVICE_CATALOG_ELIGIBLE
                            THEN e.INSTANCE_ACCOUNT_ID END)                                AS service_catalog_accounts_total,
        COUNT(DISTINCT CASE WHEN e.INSTANCE_IS_PAID_CUSTOMER AND e.INSTANCE_IS_SERVICE_CATALOG_ELIGIBLE AND e.INSTANCE_IS_SERVICE_CATALOG_PENETRATED
                            THEN e.INSTANCE_ACCOUNT_ID END)                                AS service_catalog_activated_accounts,
        COUNT(DISTINCT CASE WHEN e.INSTANCE_IS_PAID_CUSTOMER AND e.INSTANCE_IS_SERVICE_CATALOG_ELIGIBLE AND e.INSTANCE_IS_SERVICE_CATALOG_ACTIVATED
                            THEN e.INSTANCE_ACCOUNT_ID END)                                AS service_catalog_accounts_using,
        COUNT(DISTINCT CASE WHEN e.INSTANCE_IS_PAID_CUSTOMER AND e.INSTANCE_IS_SERVICE_CATALOG_ELIGIBLE AND e.INSTANCE_IS_SERVICE_CATALOG_ADOPTED
                            THEN e.INSTANCE_ACCOUNT_ID END)                                AS service_catalog_adopted_accounts,
        -- Change Management (proxied by Approvals funnel -- no dedicated Change Management dataset in ZDP)
        COUNT(DISTINCT CASE WHEN e.INSTANCE_IS_PAID_CUSTOMER AND e.INSTANCE_IS_APPROVALS_ELIGIBLE
                            THEN e.INSTANCE_ACCOUNT_ID END)                                AS change_management_accounts_total,
        COUNT(DISTINCT CASE WHEN e.INSTANCE_IS_PAID_CUSTOMER AND e.INSTANCE_IS_APPROVALS_ELIGIBLE AND e.INSTANCE_IS_APPROVALS_PENETRATED
                            THEN e.INSTANCE_ACCOUNT_ID END)                                AS change_management_activated_accounts,
        COUNT(DISTINCT CASE WHEN e.INSTANCE_IS_PAID_CUSTOMER AND e.INSTANCE_IS_APPROVALS_ELIGIBLE AND e.INSTANCE_IS_APPROVALS_ACTIVATED
                            THEN e.INSTANCE_ACCOUNT_ID END)                                AS change_management_accounts_using,
        COUNT(DISTINCT CASE WHEN e.INSTANCE_IS_PAID_CUSTOMER AND e.INSTANCE_IS_APPROVALS_ELIGIBLE AND e.INSTANCE_IS_APPROVALS_ADOPTED
                            THEN e.INSTANCE_ACCOUNT_ID END)                                AS change_management_adopted_accounts
    FROM FUNCTIONAL.PRODUCT_ANALYTICS.ES_ADOPTION_INSTANCE_DAILY_SNAPSHOT e
    INNER JOIN month_ends m
        ON e.SOURCE_SNAPSHOT_DATE = m.snap_date
    GROUP BY 1, 2
)
SELECT *
FROM funnel
ORDER BY month;
