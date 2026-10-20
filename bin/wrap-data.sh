#!/bin/sh
# Wrap data/*.json as data/*.js so index.html can load it via <script src>
# (works from file://, localhost and GitHub Pages without fetch/CORS).
set -e
cd "$(dirname "$0")/.."
node -e '
const fs = require("fs");
for (const [json, varName] of [["data/features_master.json", "ES_MASTER"], ["data/summary.json", "ES_SUMMARY"]]) {
  const txt = fs.readFileSync(json, "utf8");
  fs.writeFileSync(json.replace(/\.json$/, ".js"), "window." + varName + " = " + txt + "\n");
  console.log("wrapped " + json + " -> " + json.replace(/\.json$/, ".js"));
}
'
