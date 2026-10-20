#!/usr/bin/env node
// Assembles data/features_master.json and data/summary.json from the CSV exports
// produced by the queries in sql/. Run: node build_json.mjs (from es-adoption-dashboard/)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const SQL = path.join(ROOT, 'sql');
const DATA = path.join(ROOT, 'data');

// --- tiny CSV parser (handles quoted fields) ---------------------------------
function parseCsv(text) {
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''));
  // skip snow-cli SET-statement status noise: find the real header line
  const headerIdx = lines.findIndex(l => /^[A-Z][A-Z_]*(,[A-Z_0-9]+)+$/.test(l));
  if (headerIdx === -1) throw new Error('CSV header not found');
  const header = lines[headerIdx].split(',').map(h => h.trim().toLowerCase());
  const rows = [];
  for (const line of lines.slice(headerIdx + 1)) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { cells.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur);
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] === undefined ? null : cells[i].trim(); });
    rows.push(row);
  }
  return rows;
}
const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
const r2 = v => v === null ? null : Math.round(v * 100) / 100;
const pct = (a, b) => (b === null || b === undefined || b === 0 ? null : r2(a / b * 100));
const monthKey = d => d.slice(0, 7); // "2025-09-01" -> "2025-09"

// --- load CSVs ---------------------------------------------------------------
const esRows = parseCsv(fs.readFileSync(path.join(SQL, 'es_funnel_monthly.csv'), 'utf8'));
const aiRows = parseCsv(fs.readFileSync(path.join(SQL, 'ai_agents_monthly.csv'), 'utf8'));
const flRows = parseCsv(fs.readFileSync(path.join(SQL, 'action_flows_monthly.csv'), 'utf8'));
const brRows = parseCsv(fs.readFileSync(path.join(SQL, 'product_breakdown_latest.csv'), 'utf8'));

// --- build monthly rows ------------------------------------------------------
const monthly = [];
const anomalies = [];
let prevAdoption = {}; // feature -> last month's adoption_pct

function addMonthly(feature, month, accountsUsing, accountsTotal, activatedAccounts) {
  const adoptionPct = pct(accountsUsing, accountsTotal);
  const activationPct = pct(activatedAccounts, accountsTotal);
  const penetrationPct = activatedAccounts ? pct(accountsUsing, activatedAccounts) : null;
  const prev = prevAdoption[feature];
  if (prev !== undefined && prev === 0 && adoptionPct > 0) {
    anomalies.push(`${feature} ${month}: adoption rose from 0% (feature funnel first reported in data)`);
  } else if (prev !== undefined && prev !== null && adoptionPct !== null && prev > 0) {
    const rel = (adoptionPct - prev) / prev;
    if (Math.abs(rel) > 0.5) {
      anomalies.push(`${feature} ${month}: adoption_pct changed ${r2(rel * 100)}% MoM (${prev} -> ${adoptionPct})`);
    }
  }
  // sanity: hierarchy checks
  if (accountsUsing < 0 || accountsTotal < 0 || activatedAccounts < 0) {
    anomalies.push(`${feature} ${month}: NEGATIVE count (using=${accountsUsing}, total=${accountsTotal}, activated=${activatedAccounts})`);
  }
  if (accountsUsing > accountsTotal) {
    anomalies.push(`${feature} ${month}: accounts_using (${accountsUsing}) > accounts_total (${accountsTotal})`);
  }
  prevAdoption[feature] = adoptionPct;
  monthly.push({
    feature, month,
    accounts_using: accountsUsing,
    accounts_total: accountsTotal,
    adoption_pct: adoptionPct,
    active_users: null,          // user-level usage not available in ZDP instance-level snapshots
    licensed_users: null,        // user-level entitlements not available
    penetration_pct: penetrationPct,
    activated_accounts: activatedAccounts,
    activation_pct: activationPct,
  });
}

for (const r of esRows) {
  const m = monthKey(r.month);
  addMonthly('itam', m, num(r.itam_accounts_using), num(r.itam_accounts_total), num(r.itam_activated_accounts));
  addMonthly('service_catalog', m, num(r.service_catalog_accounts_using), num(r.service_catalog_accounts_total), num(r.service_catalog_activated_accounts));
  addMonthly('change_management', m, num(r.change_management_accounts_using), num(r.change_management_accounts_total), num(r.change_management_activated_accounts));
}
for (const r of aiRows) {
  addMonthly('es_ai_agents', monthKey(r.month), num(r.es_ai_agents_accounts_using), num(r.es_ai_agents_accounts_total), num(r.es_ai_agents_activated_accounts));
}
for (const r of flRows) {
  addMonthly('action_flows', monthKey(r.month), num(r.accounts_using), num(r.accounts_total), num(r.activated_accounts));
}

// --- product breakdown (latest snapshot) --------------------------------------
const SEG_NAME = { '1.Digital': 'Digital', '2.Corporate': 'Corporate', '3.Enterprise': 'Enterprise' };
const product_breakdown = brRows.map(r => ({
  feature: r.feature,
  product: SEG_NAME[r.segment] || 'Unknown',
  accounts_using: num(r.accounts_using),
  adoption_pct: pct(num(r.accounts_using), num(r.accounts_total)),
})).sort((a, b) => a.feature.localeCompare(b.feature) || (b.adoption_pct ?? 0) - (a.adoption_pct ?? 0));

// --- current-period summary ---------------------------------------------------
const DISPLAY = {
  itam: 'ITAM (IT Asset Management)',
  service_catalog: 'Service Catalog',
  es_ai_agents: 'ES AI Agents',
  change_management: 'Change Management (Approvals funnel)',
  action_flows: 'Advanced Action Flows',
};
const byFeatMon = {};
for (const m of monthly) byFeatMon[m.feature] = byFeatMon[m.feature] || {};
for (const m of monthly) byFeatMon[m.feature][m.month] = m;
const months = [...new Set(monthly.map(m => m.month))].sort();
const curMonth = months[months.length - 1];
const prevMonth = months[months.length - 2];

const features = Object.keys(DISPLAY).map(f => {
  const cur = byFeatMon[f][curMonth];
  const prv = byFeatMon[f][prevMonth];
  return {
    feature: f,
    display_name: DISPLAY[f],
    accounts_using: cur.accounts_using,
    accounts_total: cur.accounts_total,
    adoption_pct: cur.adoption_pct,
    penetration_pct: cur.penetration_pct,
    activation_pct: cur.activation_pct,
    active_users: cur.active_users,
    mom_delta_adoption_pp: prv && cur.adoption_pct !== null && prv.adoption_pct !== null
      ? r2(cur.adoption_pct - prv.adoption_pct) : null,
    data_as_of: '2026-10-19',
  };
});
const features_ranked = features.slice().sort((a, b) => (b.adoption_pct ?? -1) - (a.adoption_pct ?? -1)).map(f => f.feature);

// --- sources ------------------------------------------------------------------
const sources = [
  { feature: 'itam', table: 'FUNCTIONAL.PRODUCT_ANALYTICS.ES_ADOPTION_INSTANCE_DAILY_SNAPSHOT', grain: 'instance account x daily snapshot; month-end snapshot used per month', freshness: '2026-10-18' },
  { feature: 'service_catalog', table: 'FUNCTIONAL.PRODUCT_ANALYTICS.ES_ADOPTION_INSTANCE_DAILY_SNAPSHOT', grain: 'instance account x daily snapshot; month-end snapshot used per month', freshness: '2026-10-18' },
  { feature: 'change_management', table: 'FUNCTIONAL.PRODUCT_ANALYTICS.ES_ADOPTION_INSTANCE_DAILY_SNAPSHOT', grain: 'instance account x daily snapshot (Approvals funnel, proxy for Change Management); month-end snapshot used per month', freshness: '2026-10-18' },
  { feature: 'es_ai_agents', table: 'FUNCTIONAL.PRODUCT_ANALYTICS.AI_AGENTS_INSTANCE_DAILY_SNAPSHOT', grain: 'instance account x daily snapshot; month-end snapshot used per month', freshness: '2026-10-18' },
  { feature: 'action_flows', table: 'PROPAGATED_FUNCTIONAL.PRODUCT_ANALYTICS.FACT_AGGREGATED_ACTION_FLOW_EXECUTIONS_DAILY_SNAPSHOT', grain: 'instance account x day (execution counts); aggregated to month + cumulative-ever; restricted to paid universe at month end', freshness: '2026-10-19' },
  { feature: 'account_universe', table: 'PRESENTATION.PRODUCT_ANALYTICS.PAID_CUSTOMER_UNIVERSE_DAILY_SNAPSHOT', grain: 'instance account x daily snapshot (paid customers); used for segment breakdown only', freshness: '2026-10-18' },
];

// --- write outputs ------------------------------------------------------------
fs.mkdirSync(DATA, { recursive: true });
const generatedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

const master = {
  generated_at: generatedAt,
  as_of: '2026-10-19',
  definitions: {
    adoption: 'Distinct paid accounts with meaningful feature usage in the period (ZDP ACTIVATED flag = usage within last 28 days at the month-end snapshot; Action Flows: >=1 completed flow-step execution in the month) divided by paid accounts eligible for the feature.',
    penetration: 'Depth of usage: accounts actively using the feature in the period divided by accounts that have the feature enabled / first-used it (ZDP PENETRATED flag; Action Flows: any completed execution ever up to month end). User-level "active users / licensed users" is not available in ZDP instance-level snapshots, so this documented fallback is used.',
    activation: 'Accounts with the feature enabled or first-meaningful-use in the last 6 months (ZDP PENETRATED flag; Action Flows: >=1 completed flow-step execution ever up to month end) divided by paid accounts eligible for the feature.',
    account_universe: 'Paid customer instances (INSTANCE_IS_PAID_CUSTOMER = TRUE in FUNCTIONAL.PRODUCT_ANALYTICS.ES_ADOPTION_INSTANCE_DAILY_SNAPSHOT, matching PRESENTATION.PRODUCT_ANALYTICS.PAID_CUSTOMER_UNIVERSE_DAILY_SNAPSHOT; ~87.5k instances) further restricted per feature to the feature entitlement flag (ELIGIBLE). This is "accounts entitled to the feature", not "all Zendesk accounts". Note: ITAM / Service Catalog / Approvals eligibility includes CX Suite plans, not only ES Suite plans. Action Flows has no eligibility flag, so its denominator is all paid customers.',
  },
  sources,
  monthly,
  product_breakdown,
};
fs.writeFileSync(path.join(DATA, 'features_master.json'), JSON.stringify(master, null, 2) + '\n');

const summary = {
  generated_at: generatedAt,
  as_of: '2026-10-19',
  current_month: curMonth,
  features,
  features_ranked,
};
fs.writeFileSync(path.join(DATA, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

console.log('months:', months[0], '->', months[months.length - 1], `(${monthly.length} rows)`);
console.log('features:', Object.keys(DISPLAY).join(', '));
console.log('anomalies flagged:');
anomalies.forEach(a => console.log('  -', a));
if (!anomalies.length) console.log('  (none)');
