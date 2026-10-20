#!/bin/sh
# Refresh the dashboard data from ZDP via the Snowflake CLI.
# Requires the zdp-explore setup connections (zdp-global) — see REFRESH.md for
# metric definitions and the parameter lines (SET start_month / SET end_date)
# at the top of each .sql file if you want to change the window.
set -e
cd "$(dirname "$0")/.."

echo "1/5 checking source freshness…"
snow sql -f sql/source_freshness.sql --connection zdp-global

echo "2/5 pulling monthly funnels…"
snow sql -f sql/es_funnel_monthly.sql --connection zdp-global --format csv > sql/es_funnel_monthly.csv
snow sql -f sql/ai_agents_monthly.sql --connection zdp-global --format csv > sql/ai_agents_monthly.csv
snow sql -f sql/action_flows_monthly.sql --connection zdp-global --format csv > sql/action_flows_monthly.csv

echo "3/5 pulling segment breakdown…"
snow sql -f sql/product_breakdown_latest.sql --connection zdp-global --format csv > sql/product_breakdown_latest.csv

echo "4/5 rebuilding JSON deliverables…"
node build_json.mjs

echo "5/5 wrapping JSON as data/*.js…"
bin/wrap-data.sh

echo "Done — data/*.js regenerated. Reload index.html."
