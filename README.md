# ES Feature Adoption Dashboard

Adoption, penetration and activation for the Zendesk Employee Service (ES) suite —
IT Asset Management, Service Catalog, ES AI Agents, SaaS Management, Change Management,
Advanced Action Flows — sourced from ZDP (Zendesk Data Platform) via Snowflake.

Static site: plain HTML + ECharts, no build step. Hosted on GitHub Pages.

## Structure

```
index.html            the dashboard
assets/               style.css + app.js (vanilla JS, ECharts 5 from CDN)
data/                 features_master.json/.js, summary.json/.js  (.js are generated wrappers)
sql/                  the ZDP/Snowflake queries behind each metric
bin/refresh.sh        re-run the queries and regenerate the data files
REFRESH.md            how to refresh, metric definitions, caveats
```

## Refreshing the data

```sh
bin/refresh.sh         # runs sql/*.sql via Snowflake CLI, rewrites data/*.json + *.js
bin/refresh.sh --push  # same, then commits + pushes so GitHub Pages updates
```

Requires the Snowflake CLI connections from the zdp-explore setup (`zdp-amer` /
`zdp-global`; externalbrowser Okta SSO). See REFRESH.md for per-query detail,
metric denominators and known gaps.

## Local preview

Open `index.html` directly, or serve the folder:

```sh
python3 -m http.server 8137
```

## Notes

- The data files are generated; edit the `sql/` queries, not the JSON.
- `?theme=dark` (or the toggle in the header) switches dark mode.
- The repo is public by choice — flip it to private in repo settings if that changes.
