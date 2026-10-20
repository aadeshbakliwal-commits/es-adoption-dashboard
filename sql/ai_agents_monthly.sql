-- ES AI Agents funnel monthly series from ZDP AI_AGENTS_INSTANCE_DAILY_SNAPSHOT (zdp-global).
-- NOTE: this is the Zendesk AI Agents product funnel (all use cases, CX + EX combined);
-- ZDP does not split AI agent usage by ES vs CX, so this is the whole-product view.
--
-- PARAMETERS (edit before running):
SET start_month = '2025-09-01';
SET end_date    = '2026-10-19';
--
-- Metric mapping (see REFRESH.md):
--   es_ai_agents_accounts_total     = paid customers eligible for AI Agents
--   es_ai_agents_activated_accounts = INSTANCE_IS_AI_AGENTS_PAID_PENETRATED (enabled / first use)
--   es_ai_agents_accounts_using     = INSTANCE_IS_AI_AGENTS_PAID_ACTIVATED (meaningful use, 28d)
--   es_ai_agents_adopted_accounts   = INSTANCE_IS_AI_AGENTS_PAID_ADOPTED (sustained use, 28d)
--
-- Run: snow sql -f sql/ai_agents_monthly.sql --connection zdp-global

WITH snapshot_dates AS (
    SELECT DISTINCT SOURCE_SNAPSHOT_DATE
    FROM FUNCTIONAL.PRODUCT_ANALYTICS.AI_AGENTS_INSTANCE_DAILY_SNAPSHOT
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
        COUNT(DISTINCT CASE WHEN a.INSTANCE_IS_PAID_CUSTOMER AND a.INSTANCE_IS_AI_AGENTS_ELIGIBLE
                            THEN a.INSTANCE_ACCOUNT_ID END)                                AS es_ai_agents_accounts_total,
        COUNT(DISTINCT CASE WHEN a.INSTANCE_IS_PAID_CUSTOMER AND a.INSTANCE_IS_AI_AGENTS_ELIGIBLE AND a.INSTANCE_IS_AI_AGENTS_PAID_PENETRATED
                            THEN a.INSTANCE_ACCOUNT_ID END)                                AS es_ai_agents_activated_accounts,
        COUNT(DISTINCT CASE WHEN a.INSTANCE_IS_PAID_CUSTOMER AND a.INSTANCE_IS_AI_AGENTS_ELIGIBLE AND a.INSTANCE_IS_AI_AGENTS_PAID_ACTIVATED
                            THEN a.INSTANCE_ACCOUNT_ID END)                                AS es_ai_agents_accounts_using,
        COUNT(DISTINCT CASE WHEN a.INSTANCE_IS_PAID_CUSTOMER AND a.INSTANCE_IS_AI_AGENTS_ELIGIBLE AND a.INSTANCE_IS_AI_AGENTS_PAID_ADOPTED
                            THEN a.INSTANCE_ACCOUNT_ID END)                                AS es_ai_agents_adopted_accounts
    FROM FUNCTIONAL.PRODUCT_ANALYTICS.AI_AGENTS_INSTANCE_DAILY_SNAPSHOT a
    INNER JOIN month_ends m
        ON a.SOURCE_SNAPSHOT_DATE = m.snap_date
    GROUP BY 1, 2
)
SELECT *
FROM funnel
ORDER BY month;
