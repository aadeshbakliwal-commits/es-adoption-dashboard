// PLACEHOLDER DATA — replaced by bin/refresh.sh after the first ZDP pull.
(function () {
  const keys = ["itam", "service_catalog", "es_ai_agents", "saas_management", "change_management", "action_flows"];
  const months = [];
  for (let y = 2025, m = 10; !(y === 2026 && m === 11); m === 12 ? ((y += 1), (m = 1)) : (m += 1)) months.push(`${y}-${String(m).padStart(2, "0")}`);
  const base = {
    itam: [13.1, 13.6, 14.0, 14.7, 15.2, 15.6, 16.1, 16.5, 16.8, 17.0, 17.1, 17.3, 17.4],
    service_catalog: [21.2, 21.9, 22.6, 23.4, 24.1, 24.8, 25.3, 25.9, 26.4, 26.8, 27.0, 27.2, 27.4],
    es_ai_agents: [14.8, 15.7, 16.6, 17.5, 18.5, 19.4, 20.3, 21.2, 22.1, 23.0, 23.7, 24.4, 25.1],
    saas_management: [10.2, 10.5, 10.8, 11.0, 11.2, 11.4, 11.6, 11.8, 12.0, 12.1, 12.2, 12.3, 12.4],
    change_management: [7.4, 7.7, 7.9, 8.2, 8.5, 8.7, 8.9, 9.1, 9.3, 9.5, 9.6, 9.8, 9.9],
    action_flows: [15.4, 15.9, 16.4, 16.9, 17.4, 17.8, 18.2, 18.5, 18.8, 19.1, 19.3, 19.5, 19.6]
  };
  const totals = { itam: 52, service_catalog: 61, es_ai_agents: 39, saas_management: 28, change_management: 31, action_flows: 43 };
  const monthly = [];
  months.forEach((mo, i) => {
    keys.forEach((k) => {
      const pct = base[k][i];
      monthly.push({
        feature: k, month: mo,
        accounts_using: Math.round(11400 * pct / 100),
        accounts_total: 11400,
        adoption_pct: pct,
        active_users: Math.round(11400 * pct / 100 * totals[k] / 100 * 5),
        licensed_users: Math.round(11400 * totals[k] / 100 * 5),
        penetration_pct: totals[k],
        activated_accounts: Math.round(11400 * pct / 100 * 1.24),
        activation_pct: Math.round(pct * 1.24 * 10) / 10
      });
    });
  });
  window.ES_MASTER = {
    placeholder: true,
    generated_at: "2026-10-20T00:00:00Z",
    as_of: "2026-10-19",
    definitions: {
      adoption: "PLACEHOLDER — share of accounts in the universe with any usage of the feature in the month.",
      penetration: "PLACEHOLDER — active users of the feature as a share of licensed/entitled users.",
      activation: "PLACEHOLDER — accounts with the feature enabled or first meaningful use, as a share of eligible accounts.",
      account_universe: "PLACEHOLDER — all accounts in the ZDP accounts-universe table."
    },
    sources: keys.map((k) => ({ feature: k, table: "PLACEHOLDER.DB.SCHEMA.TABLE", grain: "account × month", freshness: "2026-10-19" })),
    monthly,
    product_breakdown: []
  };
})();
