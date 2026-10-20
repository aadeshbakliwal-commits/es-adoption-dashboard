/* ES Feature Adoption dashboard — vanilla JS + ECharts, Zendesk brand. */
(function () {
  "use strict";

  const MASTER = window.ES_MASTER;
  const SUMMARY = window.ES_SUMMARY;

  const FEATURES = {
    itam: { name: "IT Asset Management", slot: 1 },
    service_catalog: { name: "Service Catalog", slot: 2 },
    es_ai_agents: { name: "ES AI Agents", slot: 3 },
    saas_management: { name: "SaaS Management", slot: 4 },
    change_management: { name: "Change Management", slot: 5 },
    action_flows: { name: "Advanced Action Flows", slot: 6 }
  };

  const state = {
    preset: "12m",           // 3m | 6m | 12m | all | custom
    from: null, to: null,    // "YYYY-MM" for custom
    active: new Set(Object.keys(FEATURES)),
    charts: []
  };

  /* ---------- tokens ---------- */
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function slots() {
    return [1, 2, 3, 4, 5, 6].map((i) => cssVar("--s" + i));
  }
  function color(feature) {
    return slots()[FEATURES[feature].slot - 1];
  }
  function lum(hex) {
    const h = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const RAMP = {
    light: ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"],
    dark: ["#0d366b", "#104281", "#184f95", "#1c5cab", "#256abf", "#2a78d6", "#3987e5", "#5598e7", "#6da7ec", "#86b6ef", "#9ec5f4", "#b7d3f6", "#cde2fb"]
  };
  function rampColor(v) {
    const r = RAMP[isDark() ? "dark" : "light"];
    const i = Math.min(r.length - 1, Math.max(0, Math.round((v / 100) * (r.length - 1))));
    return r[i];
  }
  function isDark() {
    return document.documentElement.getAttribute("data-theme") === "dark" ||
      (document.documentElement.getAttribute("data-theme") !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function esc(s) {
    const d = document.createElement("span"); d.textContent = String(s); return d.innerHTML;
  }
  function fmtMonth(m) {
    const [y, mm] = m.split("-");
    return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+mm - 1] + " " + y.slice(2);
  }
  function fmtPct(v) {
    if (v == null || isNaN(v)) return "—";
    if (+v === 0) return "0%";
    return Math.abs(+v) < 10 ? (+v).toFixed(2) + "%" : (+v).toFixed(1) + "%";
  }
  function fmtInt(v) { return (v == null || isNaN(v)) ? "—" : (+v).toLocaleString("en-US"); }

  /* ---------- data shaping ---------- */
  function allMonths() {
    const set = new Set((MASTER.monthly || []).map((r) => r.month));
    return Array.from(set).sort();
  }
  function rangeMonths() {
    const months = allMonths();
    if (state.preset === "custom" && state.from && state.to) {
      const lo = state.from <= state.to ? state.from : state.to;
      const hi = state.from <= state.to ? state.to : state.from;
      return months.filter((m) => m >= lo && m <= hi);
    }
    if (state.preset === "all") return months;
    const n = { "3m": 3, "6m": 6, "12m": 12 }[state.preset] || 12;
    return months.slice(-n);
  }
  function series(feature) {
    const months = new Set(rangeMonths());
    return (MASTER.monthly || []).filter((r) => r.feature === feature && months.has(r.month))
      .sort((a, b) => a.month.localeCompare(b.month));
  }
  function activeFeatures() {
    const ranked = SUMMARY.features_ranked || Object.keys(FEATURES);
    return ranked.filter((k) => state.active.has(k));
  }
  function latestRow(feature) {
    const s = series(feature);
    return s.length ? s[s.length - 1] : null;
  }
  function deltaPP(feature) {
    const s = series(feature);
    if (s.length < 2) return null;
    const a = s[s.length - 1].adoption_pct, b = s[s.length - 2].adoption_pct;
    return (a == null || b == null) ? null : a - b;
  }

  /* ---------- chart helpers ---------- */
  function makeChart(el, option) {
    const c = echarts.init(el, null, { renderer: "canvas" });
    c.setOption(option);
    state.charts.push(c);
    return c;
  }
  function disposeCharts() {
    state.charts.forEach((c) => c.dispose());
    state.charts = [];
  }
  function tooltipOpts(extra) {
    return Object.assign({
      backgroundColor: cssVar("--tooltip-bg"),
      borderColor: cssVar("--hairline-strong"),
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: cssVar("--text"), fontFamily: cssVar("--font"), fontSize: 12 },
      extraCssText: "box-shadow:0 6px 18px rgba(0,0,0,.12);border-radius:4px;"
    }, extra || {});
  }
  const baseGrid = { left: 8, right: 14, top: 10, bottom: 6, containLabel: true };
  function axisLabel() { return { color: cssVar("--muted"), fontSize: 10, fontFamily: cssVar("--font") }; }
  function splitLine() { return { lineStyle: { color: cssVar("--grid"), type: "solid", width: 1 } }; }

  /* ---------- renderers ---------- */
  function renderKPIs() {
    const wrap = document.getElementById("kpis");
    wrap.innerHTML = "";
    activeFeatures().forEach((f) => {
      const row = latestRow(f);
      const d = deltaPP(f);
      const el = document.createElement("div");
      el.className = "kpi";
      const delta = d == null ? '<span style="opacity:.6">— vs prior month</span>'
        : d >= 0 ? `<span class="up">▲</span> +${d.toFixed(2)} pp`
          : `<span class="down">▼</span> ${d.toFixed(2)} pp`;
      el.innerHTML = `
        <div class="k-label">${esc(FEATURES[f].name)}</div>
        <div class="k-value">${fmtPct(row ? row.adoption_pct : null)}</div>
        <div class="k-delta">${delta}</div>
        <div class="k-sub">${fmtInt(row && row.accounts_using)} of ${fmtInt(row && row.accounts_total)} eligible accounts</div>`;
      wrap.appendChild(el);
    });
    if (!activeFeatures().length) wrap.innerHTML = '<div class="card"><p style="margin:8px;color:var(--muted)">No features selected — pick products in the filter above.</p></div>';
  }

  function renderTrends() {
    const host = document.getElementById("trendGrid");
    host.innerHTML = "";
    const feats = activeFeatures();
    const months = rangeMonths();
    document.getElementById("trendEmpty").hidden = !!(feats.length && months.length);
    document.getElementById("trendEmpty").textContent =
      months.length ? "No data in this range." : "No data in this range.";
    document.getElementById("trendEmpty").hidden = !!(feats.length && months.length);
    let max = 0;
    feats.forEach((f) => series(f).forEach((r) => { max = Math.max(max, r.adoption_pct || 0); }));
    const yMax = Math.max(5, Math.ceil((max * 1.15) / 5) * 5);
    feats.forEach((f) => {
      const s = series(f);
      const tile = document.createElement("div");
      tile.className = "mini";
      const title = document.createElement("div");
      title.className = "mini-title";
      const dot = document.createElement("span"); dot.className = "dot"; dot.style.background = color(f);
      const nm = document.createElement("span"); nm.textContent = FEATURES[f].name;
      const latest = document.createElement("span"); latest.className = "latest";
      latest.textContent = s.length ? fmtPct(s[s.length - 1].adoption_pct) : "";
      title.append(dot, nm, latest);
      const chartEl = document.createElement("div");
      chartEl.className = "chart"; chartEl.style.height = "132px";
      tile.append(title, chartEl);
      host.appendChild(tile);
      const tickIdx = s.length > 2 ? [0, Math.floor((s.length - 1) / 2), s.length - 1] : s.map((_, i) => i);
      makeChart(chartEl, {
        animation: false,
        grid: { left: 6, right: 48, top: 12, bottom: 2, containLabel: true },
        xAxis: {
          type: "category", data: s.map((r) => r.month), boundaryGap: false,
          axisLine: { lineStyle: { color: cssVar("--axis") } }, axisTick: { show: false },
          axisLabel: Object.assign(axisLabel(), {
            interval: (i) => tickIdx.includes(i),
            formatter: (v) => fmtMonth(v)
          })
        },
        yAxis: {
          type: "value", min: 0, max: yMax,
          axisLabel: Object.assign(axisLabel(), { formatter: "{value}%" }),
          splitLine: splitLine()
        },
        tooltip: tooltipOpts({
          trigger: "axis",
          axisPointer: { type: "line", lineStyle: { color: cssVar("--axis"), width: 1 } },
          formatter: (ps) => ps.length ? `<b>${fmtPct(ps[0].value)}</b><br><span style="color:${cssVar("--muted")}">${esc(FEATURES[f].name)} · ${fmtMonth(ps[0].axisValue)}</span>` : ""
        }),
        series: [{
          type: "line", data: s.map((r) => r.adoption_pct),
          lineStyle: { width: 2, color: color(f) }, itemStyle: { color: color(f) },
          symbol: "circle", symbolSize: 5, showSymbol: false,
          emphasis: { scale: 1.6 },
          endLabel: s.length ? {
            show: true, formatter: () => fmtPct(s[s.length - 1].adoption_pct),
            color: cssVar("--text"), fontSize: 10, fontWeight: 600, fontFamily: cssVar("--font"),
            precision: 1, offset: [2, 0]
          } : { show: false }
        }]
      });
    });
  }

  function renderHeatmap() {
    const feats = activeFeatures();
    const el = document.getElementById("chartHeat");
    el.hidden = !feats.length;
    document.getElementById("heatEmpty").hidden = !!feats.length;
    if (!feats.length) return;
    const metrics = [
      { key: "adoption_pct", label: "Adoption" },
      { key: "penetration_pct", label: "Penetration" },
      { key: "activation_pct", label: "Activation" }
    ];
    const data = [];
    // Columns are different metrics, so each column scales on its own range (still one hue, ordered).
    const colMax = metrics.map((m) => Math.max(5, ...feats.map((f) => {
      const r = latestRow(f);
      return (r && r[m.key] != null) ? +r[m.key] : 0;
    })));
    feats.forEach((f, y) => metrics.forEach((m, x) => {
      const r = latestRow(f);
      const v = r && r[m.key] != null ? +r[m.key] : 0;
      const bg = rampColor(v / colMax[x] * 100);
      data.push({
        value: [x, y, v],
        itemStyle: { color: bg, borderColor: cssVar("--surface"), borderWidth: 2, borderRadius: 3 },
        label: { color: lum(bg) > 0.42 ? "#11110D" : "#F5F4EE" }
      });
    }));
    const cellH = 40;
    el.style.height = feats.length * cellH + 52 + "px";
    makeChart(el, {
      animation: false,
      grid: { left: 6, right: 30, top: 8, bottom: 2, containLabel: true },
      xAxis: { type: "category", data: metrics.map((m) => m.label), axisLine: { show: false }, axisTick: { show: false }, axisLabel: Object.assign(axisLabel(), { fontSize: 10.5, color: cssVar("--text-2") }), position: "top" },
      yAxis: { type: "category", data: feats, inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: cssVar("--text"), fontSize: 11, fontFamily: cssVar("--font"), formatter: (v) => FEATURES[v].name } },
      tooltip: tooltipOpts({
        formatter: (p) => {
          const f = feats[p.value[1]], m = metrics[p.value[0]].label.toLowerCase();
          return `<b>${fmtPct(p.value[2])}</b><br><span style="color:${cssVar("--muted")}">${esc(FEATURES[f].name)} · ${m}</span>`;
        }
      }),
      series: [{
        type: "heatmap", data,
        label: {
          show: true, fontFamily: cssVar("--font"), fontSize: 10.5, fontWeight: 600,
          formatter: (p) => fmtPct(p.value[2])
        },
        emphasis: { itemStyle: { borderColor: cssVar("--hairline-strong") } }
      }]
    });
  }

  function renderDonut() {
    const feats = activeFeatures();
    const el = document.getElementById("chartDonut");
    el.hidden = !feats.length;
    document.getElementById("donutEmpty").hidden = !!feats.length;
    if (!feats.length) return;
    const rows = feats.map((f) => ({ name: FEATURES[f].name, value: (latestRow(f) || {}).accounts_using || 0, f }));
    const total = rows.reduce((a, r) => a + r.value, 0);
    el.style.height = "300px";
    makeChart(el, {
      animation: false,
      tooltip: tooltipOpts({
        formatter: (p) => `<b>${fmtInt(p.value)}</b> accounts · ${fmtPct(total ? (p.value / total * 100) : 0)}<br><span style="color:${cssVar("--muted")}">${esc(p.name)}</span>`
      }),
      legend: {
        orient: "vertical", right: 0, top: "middle", itemWidth: 10, itemHeight: 10,
        textStyle: { color: cssVar("--text-2"), fontSize: 11, fontFamily: cssVar("--font") },
        formatter: (n) => {
          const r = rows.find((x) => x.name === n);
          return `${n}  ${total ? ((r.value / total) * 100).toFixed(0) : 0}%`;
        }
      },
      series: [{
        type: "pie", radius: ["52%", "74%"], center: ["36%", "50%"],
        data: rows.map((r) => ({ name: r.name, value: r.value, itemStyle: { color: color(r.f) } })),
        itemStyle: { borderColor: cssVar("--surface"), borderWidth: 2 },
        label: {
          show: false
        },
        emphasis: { scaleSize: 4 },
        markLine: undefined
      }],
      graphic: [{
        type: "text", left: "26%", top: "46%", style: {
          text: fmtInt(total), fill: cssVar("--text"), fontSize: 22, fontWeight: 500, fontFamily: cssVar("--font"), textAlign: "center"
        }
      }, {
        type: "text", left: "27%", top: "58%", style: {
          text: "ACCOUNT-USAGES", fill: cssVar("--muted"), fontSize: 8, fontWeight: 600, fontFamily: cssVar("--font"), textAlign: "center", letterSpacing: 1
        }
      }]
    });
  }

  function renderScatter() {
    const feats = activeFeatures();
    const el = document.getElementById("chartScatter");
    el.hidden = !feats.length;
    document.getElementById("scatterEmpty").hidden = !!feats.length;
    if (!feats.length) return;
    const pts = feats.map((f) => {
      const r = latestRow(f) || {};
      return { name: FEATURES[f].name, value: [r.adoption_pct || 0, r.activation_pct || 0], accounts: r.accounts_using, f };
    });
    const xMax = Math.max(1, Math.ceil(Math.max(...pts.map((p) => p.value[0])) * 1.25));
    const yMax = Math.max(1, Math.ceil(Math.max(...pts.map((p) => p.value[1])) * 1.25));
    el.style.height = "300px";
    makeChart(el, {
      animation: false,
      grid: Object.assign({}, baseGrid, { top: 18, bottom: 26 }),
      xAxis: {
        type: "value", min: 0, max: xMax, name: "Adoption %", nameLocation: "middle", nameGap: 24,
        nameTextStyle: Object.assign(axisLabel(), { fontSize: 10 }),
        axisLabel: Object.assign(axisLabel(), { formatter: "{value}%" }), splitLine: splitLine(),
        axisLine: { lineStyle: { color: cssVar("--axis") } }
      },
      yAxis: {
        type: "value", min: 0, max: yMax, name: "Activation %", nameLocation: "end",
        nameTextStyle: Object.assign(axisLabel(), { fontSize: 10, align: "left" }),
        axisLabel: Object.assign(axisLabel(), { formatter: "{value}%" }), splitLine: splitLine()
      },
      tooltip: tooltipOpts({
        formatter: (p) => `<b>${fmtPct(p.value[0])} adoption · ${fmtPct(p.value[1])} activation</b><br><span style="color:${cssVar("--muted")}">${esc(p.name)} · ${fmtInt(p.data.accounts)} accounts</span>`
      }),
      series: [{
        type: "scatter",
        data: pts.map((pt, i) => Object.assign({}, pt, { label: { position: ["top", "right", "bottom", "left"][i % 4] } })),
        symbolSize: 15,
        itemStyle: { color: cssVar("--s1"), opacity: 0.92 },
        label: {
          show: true, formatter: (p) => p.name, distance: 8,
          color: cssVar("--text"), fontSize: 10.5, fontFamily: cssVar("--font"), fontWeight: 600
        },
        labelLayout: { hideOverlap: true },
        emphasis: { scale: 1.25 }
      }]
    });
  }

  function renderPenetration() {
    const feats = activeFeatures();
    const el = document.getElementById("chartPen");
    el.hidden = !feats.length;
    document.getElementById("penEmpty").hidden = !!feats.length;
    if (!feats.length) return;
    const rows = feats.map((f) => ({ f, v: (latestRow(f) || {}).penetration_pct || 0 })).sort((a, b) => b.v - a.v);
    el.style.height = rows.length * 38 + 46 + "px";
    makeChart(el, {
      animation: false,
      grid: { left: 8, right: 46, top: 8, bottom: 2, containLabel: true },
      xAxis: { type: "value", min: 0, max: 100, axisLabel: Object.assign(axisLabel(), { formatter: "{value}%" }), splitLine: splitLine() },
      yAxis: {
        type: "category", data: rows.map((r) => FEATURES[r.f].name), inverse: true,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: cssVar("--text"), fontSize: 11, fontFamily: cssVar("--font") }
      },
      tooltip: tooltipOpts({
        formatter: (p) => `<b>${fmtPct(p.value)}</b><br><span style="color:${cssVar("--muted")}">${esc(p.name)} · penetration</span>`
      }),
      series: [{
        type: "bar", data: rows.map((r) => r.v),
        barWidth: 13,
        itemStyle: { color: cssVar("--s2"), borderRadius: [0, 4, 4, 0] },
        label: {
          show: true, position: "right", distance: 6,
          formatter: (p) => (+p.value).toFixed(1) + "%",
          color: cssVar("--text"), fontSize: 10.5, fontWeight: 600, fontFamily: cssVar("--font")
        }
      }]
    });
  }

  function renderSegments() {
    const panel = document.getElementById("segPanel");
    const bd = MASTER.product_breakdown || [];
    const feats = activeFeatures();
    const usable = feats.filter((f) => bd.some((r) => r.feature === f));
    if (!usable.length) { panel.hidden = true; return; }
    panel.hidden = false;
    const products = [];
    usable.forEach((f) => bd.filter((r) => r.feature === f && r.product).forEach((r) => { if (!products.includes(r.product)) products.push(r.product); }));
    if (!products.length) { panel.hidden = true; return; }
    const el = document.getElementById("chartSeg");
    const rows = usable.map((f) => {
      const row = { feature: f };
      products.forEach((p) => {
        const r = bd.find((x) => x.feature === f && x.product === p);
        row[p] = r ? r.accounts_using : 0;
      });
      return row;
    });
    el.style.height = rows.length * 38 + 60 + "px";
    makeChart(el, {
      animation: false,
      grid: { left: 8, right: 24, top: 8, bottom: 2, containLabel: true },
      xAxis: { type: "value", axisLabel: Object.assign(axisLabel(), { formatter: (v) => v >= 1000 ? (v / 1000) + "k" : v }), splitLine: splitLine() },
      yAxis: {
        type: "category", data: rows.map((r) => FEATURES[r.feature].name), inverse: true,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: cssVar("--text"), fontSize: 11, fontFamily: cssVar("--font") }
      },
      tooltip: tooltipOpts({
        formatter: (ps) => ps.filter((p) => p.value).map((p) => `<b>${fmtInt(p.value)}</b> <span style="color:${cssVar("--muted")}">${esc(p.seriesName)}</span>`).join("<br>")
      }),
      legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: cssVar("--text-2"), fontSize: 11, fontFamily: cssVar("--font") } },
      series: products.map((p, i) => ({
        name: p, type: "bar", stack: "usage", barWidth: 13,
        data: rows.map((r) => r[p]),
        itemStyle: { color: slots()[i % slots().length] },
        emphasis: { focus: "series" }
      }))
    });
  }

  function renderTable() {
    const tbody = document.getElementById("tblBody");
    tbody.innerHTML = "";
    activeFeatures().forEach((f) => {
      const r = latestRow(f) || {};
      const d = deltaPP(f);
      const tr = document.createElement("tr");
      const delta = d == null ? "—" : d >= 0 ? `<span class="delta up">▲ +${d.toFixed(2)}</span>` : `<span class="delta down">▼ ${d.toFixed(2)}</span>`;
      tr.innerHTML = `
        <td>${esc(FEATURES[f].name)}</td>
        <td>${fmtPct(r.adoption_pct)}</td>
        <td>${delta}</td>
        <td>${fmtPct(r.penetration_pct)}</td>
        <td>${fmtPct(r.activation_pct)}</td>
        <td>${fmtInt(r.accounts_using)}</td>
        <td>${fmtInt(r.accounts_total)}</td>
        <td>${fmtInt(r.activated_accounts)}</td>
        <td>${esc(r.month ? fmtMonth(r.month) : "—")}</td>`;
      tbody.appendChild(tr);
    });
  }

  function renderMeta() {
    document.getElementById("stamp").textContent =
      `DATA AS OF ${MASTER.as_of || "?"} · REFRESHED ${(MASTER.generated_at || "?").slice(0, 10)}`;
    const defs = MASTER.definitions || {};
    document.getElementById("defs").innerHTML =
      `<strong>Adoption</strong> — ${esc(defs.adoption || "—")} &nbsp; <strong>Penetration</strong> — ${esc(defs.penetration || "—")} &nbsp; <strong>Activation</strong> — ${esc(defs.activation || "—")}` +
      (defs.account_universe ? `<br><strong>Account universe</strong> — ${esc(defs.account_universe)}` : "");
    const src = document.getElementById("sources");
    src.innerHTML = "Sources: " + (MASTER.sources || []).map((s) => `${esc(FEATURES[s.feature] ? FEATURES[s.feature].name : s.feature)} <code>${esc(s.table)}</code> (fresh as of ${esc(s.freshness)})`).join(" · ") +
      " · Refresh: <code>bin/refresh.sh</code> in the repo.";
    const ranked = new Set(SUMMARY.features_ranked || []);
    const gaps = Object.keys(FEATURES).filter((k) => !ranked.has(k));
    const gapsEl = document.getElementById("gaps");
    if (gaps.length) {
      gapsEl.hidden = false;
      gapsEl.innerHTML = `<strong>Known gaps</strong> — ${gaps.map((g) => esc(FEATURES[g].name)).join(", ")}: no usable ZDP dataset, so it is not shown (do not treat absence as zero) · ` +
        `Change Management is proxied by the Approvals funnel · ES AI Agents covers the AI Agents product across CX and EX.`;
    } else {
      gapsEl.hidden = true;
    }
  }

  /* ---------- filters ---------- */
  function bindFilters() {
    const months = allMonths();
    const presets = [["3m", "Last 3 months"], ["6m", "Last 6 months"], ["12m", "Last 12 months"], ["all", "All available data"]];
    const rangeList = document.getElementById("rangeList");
    rangeList.innerHTML = "";
    presets.forEach(([key, label]) => {
      const row = document.createElement("div");
      row.className = "preset-row" + (state.preset === key ? " selected" : "");
      row.innerHTML = `<span>${label}</span><span class="check">✓</span>`;
      row.addEventListener("click", () => {
        state.preset = key; state.from = state.to = null;
        document.getElementById("rangeMenu").removeAttribute("open");
        syncFaces(); renderAll();
      });
      rangeList.appendChild(row);
    });
    const fm = document.getElementById("fromMonth"), to = document.getElementById("toMonth");
    [fm, to].forEach((inp) => {
      inp.min = months[0]; inp.max = months[months.length - 1];
      inp.value = state.preset === "custom" ? (inp === fm ? state.from : state.to) || "" : "";
    });
    document.getElementById("applyRange").onclick = () => {
      if (fm.value && to.value) {
        state.preset = "custom"; state.from = fm.value; state.to = to.value;
        document.getElementById("rangeMenu").removeAttribute("open");
        syncFaces(); renderAll();
      }
    };
    // feature checkboxes
    const list = document.getElementById("featureList");
    list.innerHTML = "";
    (SUMMARY.features_ranked || Object.keys(FEATURES)).forEach((f) => {
      const r = latestRow(f) || {};
      const row = document.createElement("div");
      row.className = "check-row" + (state.active.has(f) ? " selected" : "");
      row.innerHTML = `<span class="swatch" style="background:${color(f)}"></span><span>${esc(FEATURES[f].name)}</span><span class="check">✓</span><span class="count">${fmtInt(r.accounts_using)}</span>`;
      row.addEventListener("click", () => {
        if (state.active.has(f) && state.active.size === 1) return; // keep one
        state.active.has(f) ? state.active.delete(f) : state.active.add(f);
        renderAll();
      });
      list.appendChild(row);
    });
    const allRow = document.createElement("div");
    allRow.className = "preset-row";
    allRow.innerHTML = '<span style="font-weight:600">Reset — all products</span><span></span>';
    allRow.addEventListener("click", () => {
      state.active = new Set(Object.keys(FEATURES));
      renderAll();
    });
    list.appendChild(allRow);
    syncFaces();
    document.addEventListener("click", (e) => {
      document.querySelectorAll("details.filter[open]").forEach((d) => {
        if (!d.contains(e.target)) d.removeAttribute("open");
      });
    });
  }
  function syncFaces() {
    const n = state.active.size;
    document.getElementById("featureFaceLabel").textContent = n === Object.keys(FEATURES).length ? "All products" : `${n} selected`;
    document.getElementById("rangeFaceLabel").textContent =
      ({ "3m": "Last 3 months", "6m": "Last 6 months", "12m": "Last 12 months", "all": "All data" }[state.preset]) ||
      (state.from && state.to ? `${fmtMonth(state.from <= state.to ? state.from : state.to)} – ${fmtMonth(state.from <= state.to ? state.to : state.from)}` : "Custom range");
    // re-mark selections without rebuilding inputs
    document.querySelectorAll("#featureList .check-row").forEach((row, i) => {
      const f = (SUMMARY.features_ranked || Object.keys(FEATURES))[i];
      if (f) row.classList.toggle("selected", state.active.has(f));
    });
    document.querySelectorAll("#rangeList .preset-row").forEach((row, i) => {
      const key = [["3m"], ["6m"], ["12m"], ["all"]][i][0];
      row.classList.toggle("selected", state.preset === key);
    });
  }

  /* ---------- theme ---------- */
  function bindTheme() {
    const btn = document.getElementById("themeBtn");
    const stored = new URLSearchParams(location.search).get("theme") || localStorage.getItem("es-theme");
    if (stored) document.documentElement.setAttribute("data-theme", stored);
    const paint = () => { btn.textContent = isDark() ? "Light mode" : "Dark mode"; };
    paint();
    btn.addEventListener("click", () => {
      const next = isDark() ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("es-theme", next); } catch (e) { /* per-viewer convenience only */ }
      paint();
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paint);
  }

  /* ---------- boot ---------- */
  function renderAll() {
    disposeCharts();
    renderKPIs();
    renderTrends();
    renderHeatmap();
    renderDonut();
    renderScatter();
    renderPenetration();
    renderSegments();
    renderTable();
    syncFaces();
  }
  function boot() {
    if (!MASTER || !SUMMARY || typeof echarts === "undefined") {
      document.getElementById("app").hidden = true;
      document.getElementById("fatal").hidden = false;
      return;
    }
    document.getElementById("placeholderStrip").hidden = !MASTER.placeholder;
    bindTheme();
    bindFilters();
    renderMeta();
    renderAll();
    let t;
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(renderAll, 150); });
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
