(function () {
  "use strict";

  var DATA_ROOT = "/dashboard/srag/data/";
  var summary = null;
  var geojson = null;
  var currentUf = "BR";
  var currentModel = "ensemble";
  var currentUnit = "count";
  var currentMapMetric = "change";
  var currentUfWindow = "4w";
  var currentPayload = null;
  var stateCache = new Map();

  var UF_WINDOWS = {
    "2w": {
      field: "change_2w_percent",
      description: "Últimas 2 semanas vs. as 2 semanas anteriores.",
      colorbarTitle: "% vs. 2 sem. antes"
    },
    "4w": {
      field: "change_4w_percent",
      description: "Últimas 4 semanas vs. as 4 semanas anteriores.",
      colorbarTitle: "% vs. 4 sem. antes"
    }
  };

  var MODELS = {
    ensemble: {
      value: "nowcast", lower: "lower80", upper: "upper80",
      seriesLabel: "Nowcast", cardLabel: "Nowcast"
    },
    seasonal: {
      value: "seasonal", lower: "seasonal_lower80", upper: "seasonal_upper80",
      seriesLabel: "Sazonal", cardLabel: "Sazonal (ano anterior)"
    },
    lasso: {
      value: "lasso", lower: "lasso_lower80", upper: "lasso_upper80",
      seriesLabel: "Trends", cardLabel: "Trends (Google Trends)"
    }
  };

  var select = document.getElementById("state-select");
  var modelSelect = document.getElementById("model-select");
  var unitSelect = document.getElementById("unit-select");
  var mapMetricSelect = document.getElementById("map-metric-select");
  var ufWindowSelect = document.getElementById("uf-window-select");
  var dashboard = document.getElementById("dashboard");
  var errorPanel = document.getElementById("error-panel");
  var retryButton = document.getElementById("retry-button");
  var tabs = {
    nowcast: {
      button: document.getElementById("tab-nowcast"),
      panel: document.getElementById("panel-nowcast")
    },
    methodology: {
      button: document.getElementById("tab-methodology"),
      panel: document.getElementById("panel-methodology")
    }
  };

  function switchTab(name) {
    Object.keys(tabs).forEach(function (key) {
      var active = key === name;
      tabs[key].button.classList.toggle("active", active);
      tabs[key].button.setAttribute("aria-selected", String(active));
      tabs[key].panel.hidden = !active;
    });
  }

  tabs.nowcast.button.addEventListener("click", function () { switchTab("nowcast"); });
  tabs.methodology.button.addEventListener("click", function () { switchTab("methodology"); });

  function renderMethodology(summaryData) {
    var list = document.getElementById("method-technical");
    var entries = [
      ["Semanas de treino", String(summaryData.model.training_weeks)],
      ["Atraso mínimo para consolidação", summaryData.model.consolidation_lag_days + " dias"],
      ["Atualização mais recente", formatDate(summaryData.generated_at_utc)],
      ["Dados do SIVEP até", formatDate(summaryData.sources.srag.latest_source_snapshot_date)]
    ];
    list.textContent = "";
    entries.forEach(function (entry) {
      var dt = document.createElement("dt");
      dt.textContent = entry[0];
      var dd = document.createElement("dd");
      dd.textContent = entry[1];
      list.appendChild(dt);
      list.appendChild(dd);
    });
  }
  function reportHeight() {
    window.parent.postMessage(
      {
        type: "srag-dashboard-height",
        height: Math.ceil(document.documentElement.scrollHeight)
      },
      "*"
    );
  }

  if ("ResizeObserver" in window) {
    new ResizeObserver(reportHeight).observe(document.body);
  }
  window.addEventListener("load", reportHeight);

  function formatCount(value) {
    if (value === null || value === undefined) return "—";
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
  }

  function scaledValue(value, population) {
    if (value === null || value === undefined) return null;
    if (currentUnit === "per100k") {
      if (!Number.isFinite(population) || population <= 0) return null;
      return 100000 * value / population;
    }
    return value;
  }

  function formatMeasure(value, population) {
    var scaled = scaledValue(value, population);
    if (scaled === null) return "—";
    if (currentUnit === "per100k") {
      return new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 2
      }).format(scaled);
    }
    return formatCount(scaled);
  }

  function formatSignedMeasure(value, population) {
    var scaled = scaledValue(value, population);
    if (scaled === null) return "—";
    return new Intl.NumberFormat("pt-BR", {
      maximumFractionDigits: currentUnit === "per100k" ? 2 : 0,
      minimumFractionDigits: currentUnit === "per100k" ? 1 : 0,
      signDisplay: "exceptZero"
    }).format(scaled);
  }

  function unitLabel() {
    return currentUnit === "per100k" ? "por 100 mil habitantes" : "casos";
  }

  function axisTitle() {
    return currentUnit === "per100k" ?
      "Casos por 100 mil habitantes" : "Casos semanais";
  }

  function rollingChange(values, window) {
    if (values.length < 2 * window) return null;
    var recent = values.slice(values.length - window);
    var prior = values.slice(values.length - 2 * window, values.length - window);
    if (recent.some(function (v) { return v === null || v === undefined; })) return null;
    if (prior.some(function (v) { return v === null || v === undefined; })) return null;
    var sum = function (list) { return list.reduce(function (a, b) { return a + b; }, 0); };
    var priorSum = sum(prior);
    if (priorSum <= 0) return null;
    return 100 * (sum(recent) / priorSum - 1);
  }

  function modelChangeMetrics(rows, modelKey) {
    var field = MODELS[modelKey].value;
    var series = rows.map(function (row) {
      var v = row[field];
      return v === null || v === undefined ? row.observed : v;
    });
    return {
      change2w: rollingChange(series, 2),
      change4w: rollingChange(series, 4)
    };
  }

  function formatPercent(value) {
    if (value === null || value === undefined) return "—";
    var sign = value > 0 ? "+" : "";
    return sign + new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(value) + "%";
  }

  function formatDate(value) {
    if (!value) return "—";
    var date = new Date(value.length === 10 ? value + "T12:00:00" : value);
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
  }

  function updateMapDescription() {
    var isChange = currentMapMetric === "change";
    document.getElementById("uf-window-control").hidden = !isChange;
    document.getElementById("map-title").textContent = isChange ?
      "Variação por UF" : "Nowcast por UF";
    document.getElementById("uf-window-description").textContent = isChange ?
      UF_WINDOWS[currentUfWindow].description :
      "Estimativa da semana mais recente em " + unitLabel() + ".";
  }

  function byUf(uf) {
    if (uf === "BR") return summary.brazil;
    return summary.states.find(function (entry) { return entry.uf === uf; });
  }

  async function loadState(uf) {
    if (!stateCache.has(uf)) {
      var response = await fetch(DATA_ROOT + "states/" + uf + ".json", {
        cache: "no-cache"
      });
      if (!response.ok) throw new Error("Não foi possível carregar os dados de " + uf + ".");
      stateCache.set(uf, await response.json());
    }
    return stateCache.get(uf);
  }

  function showError(error) {
    console.error(error);
    errorPanel.textContent = "O dashboard não pôde ser carregado. A última atualização pode estar temporariamente indisponível.";
    errorPanel.hidden = false;
    retryButton.hidden = false;
    dashboard.hidden = true;
  }

  function populateSelect() {
    select.textContent = "";
    var choices = [summary.brazil].concat(summary.states);
    choices.forEach(function (entry) {
      var option = document.createElement("option");
      option.value = entry.uf;
      option.textContent = entry.uf === "BR" ? "Brasil" : entry.name + " (" + entry.uf + ")";
      select.appendChild(option);
    });
  }

  function renderTable() {
    var field = UF_WINDOWS[currentUfWindow].field;
    var model = MODELS[currentModel];
    var tbody = document.getElementById("state-table");
    document.getElementById("table-nowcast-heading").textContent =
      model.seriesLabel + (currentUnit === "per100k" ? " / 100 mil" : "");
    tbody.textContent = "";
    summary.states
      .slice()
      .sort(function (a, b) {
        return (b.latest[field] || 0) - (a.latest[field] || 0);
      })
      .forEach(function (entry) {
        var row = document.createElement("tr");
        row.dataset.uf = entry.uf;
        if (entry.uf === currentUf) row.classList.add("selected");
        var changeClass = entry.latest[field] >= 0 ? "positive" : "negative";
        row.innerHTML =
          "<td><strong>" + entry.uf + "</strong> <span class=\"muted\">" +
          entry.name + "</span></td>" +
          "<td>" +
          formatMeasure(entry.latest[model.value], entry.population) + "</td>" +
          "<td class=\"" + changeClass + "\">" +
          formatPercent(entry.latest[field]) + "</td>";
        row.addEventListener("click", function () {
          select.value = entry.uf;
          render(entry.uf);
        });
        tbody.appendChild(row);
      });
  }

  function renderCards(payload) {
    var latest = payload.latest;
    var model = MODELS[currentModel];
    var estimate = latest[model.value];
    var lower = latest[model.lower];
    var upper = latest[model.upper];
    var changes = modelChangeMetrics(payload.series, currentModel);
    document.getElementById("selected-kicker").textContent =
      payload.uf === "BR" ? "Agregado das 27 UFs" : payload.uf;
    document.getElementById("selected-title").textContent = payload.name;
    document.getElementById("selected-period").textContent =
      "Semana iniciada em " + formatDate(latest.week) +
      " · corte de treino em " + formatDate(payload.training.cutoff);
    document.getElementById("nowcast-label").textContent = model.cardLabel;
    document.getElementById("nowcast-value").textContent =
      formatMeasure(estimate, payload.population);
    document.getElementById("interval-value").textContent =
      "80%: " + formatMeasure(lower, payload.population) + "–" +
      formatMeasure(upper, payload.population) +
      (currentUnit === "per100k" ? " por 100 mil" : "");
    document.getElementById("observed-value").textContent =
      formatMeasure(latest.observed, payload.population);
    document.getElementById("change-2w-value").textContent =
      formatPercent(changes.change2w);
    document.getElementById("change-2w-value").className =
      changes.change2w >= 0 ? "positive" : "negative";
    document.getElementById("change-4w-value").textContent =
      formatPercent(changes.change4w);
    document.getElementById("change-4w-value").className =
      changes.change4w >= 0 ? "positive" : "negative";
    document.getElementById("interpretation").textContent =
      "O valor observado até agora é " +
      formatMeasure(latest.observed, payload.population) +
      (currentUnit === "per100k" ? " por 100 mil habitantes" : " casos") +
      "; o modelo " + model.cardLabel.toLowerCase() + " estima " +
      formatMeasure(estimate, payload.population) +
      (currentUnit === "per100k" ? " por 100 mil habitantes" : " casos") +
      " após compensar o atraso de notificação.";
  }

  function renderQuality(payload) {
    var score = payload.backtest && payload.backtest[currentModel] || {};
    var model = MODELS[currentModel];
    document.getElementById("quality-wape").textContent =
      score.wape_percent === null || score.wape_percent === undefined ?
        "—" : formatPercent(score.wape_percent).replace("+", "");
    document.getElementById("quality-bias").textContent =
      formatSignedMeasure(score.bias, payload.population);
    document.getElementById("quality-bias-unit").textContent =
      currentUnit === "per100k" ?
        "casos por 100 mil por semana" : "casos por semana";
    document.getElementById("quality-coverage").textContent =
      score.coverage80_percent === null || score.coverage80_percent === undefined ?
        "—" : formatPercent(score.coverage80_percent).replace("+", "");
    document.getElementById("quality-coverage-note").textContent =
      score.coverage80_percent === null || score.coverage80_percent === undefined ?
        "disponível após a próxima atualização" : "ideal próximo de 80%";
    document.getElementById("quality-n").textContent = formatCount(score.n);
    document.getElementById("quality-description").textContent =
      "Resultados do modelo " + model.cardLabel.toLowerCase() +
      " em previsões históricas fora da amostra para " + payload.name +
      ". O viés indica se o modelo tende a superestimar (+) ou subestimar (−).";
  }

  function renderSeries(payload) {
    var rows = payload.series;
    var model = MODELS[currentModel];
    var population = payload.population;
    var x = rows.map(function (row) { return row.week; });
    var stableObserved = rows.map(function (row) {
      return row.provisional ? null : scaledValue(row.observed, population);
    });
    var provisionalObserved = rows.map(function (row) {
      return row.provisional ? scaledValue(row.observed, population) : null;
    });
    var lower = rows.map(function (row) {
      return scaledValue(row[model.lower], population);
    });
    var upper = rows.map(function (row) {
      return scaledValue(row[model.upper], population);
    });
    var estimate = rows.map(function (row) {
      return scaledValue(row[model.value], population);
    });
    var provisionalIndex = rows.findIndex(function (row) { return row.provisional; });
    var shapes = [];
    var annotations = [];
    if (provisionalIndex >= 0) {
      var lastDate = new Date(rows[rows.length - 1].week + "T12:00:00");
      lastDate.setDate(lastDate.getDate() + 7);
      shapes.push({
        type: "rect",
        xref: "x",
        yref: "paper",
        x0: rows[provisionalIndex].week,
        x1: lastDate.toISOString().slice(0, 10),
        y0: 0,
        y1: 1,
        fillcolor: "rgba(96,112,128,0.10)",
        line: { width: 0 },
        layer: "below"
      });
      annotations.push({
        xref: "x",
        yref: "paper",
        x: rows[provisionalIndex].week,
        y: 0.98,
        xanchor: "left",
        yanchor: "top",
        text: "Período provisório",
        showarrow: false,
        font: { size: 11, color: "#607080" },
        bgcolor: "rgba(255,255,255,0.78)",
        borderpad: 3
      });
    }

    var traces = [
      {
        x: x, y: lower, type: "scatter", mode: "lines",
        line: { color: "rgba(217,95,2,0)" },
        hoverinfo: "skip", showlegend: false
      },
      {
        x: x, y: upper, type: "scatter", mode: "lines",
        line: { color: "rgba(217,95,2,0)" },
        fill: "tonexty", fillcolor: "rgba(217,95,2,0.16)",
        name: "Intervalo conformal de 80%", hoverinfo: "skip"
      },
      {
        x: x, y: stableObserved, type: "scatter", mode: "lines",
        line: { color: "#17212b", width: 2.2 },
        name: "SRAG consolidado"
      },
      {
        x: x, y: provisionalObserved, type: "scatter", mode: "lines+markers",
        line: { color: "#7b8791", width: 1.5, dash: "dot" },
        marker: { size: 4 },
        name: "Notificado (provisório)"
      }
    ];

    traces.push({
      x: x, y: estimate, type: "scatter", mode: "lines+markers",
      line: { color: "#d95f02", width: 3 },
      marker: { size: 6 },
      name: model.seriesLabel
    });

    Plotly.react("series-chart", traces, {
      margin: { l: 60, r: 20, t: 20, b: 55 },
      paper_bgcolor: "#ffffff",
      plot_bgcolor: "#ffffff",
      hovermode: "x unified",
      legend: { orientation: "h", y: 1.08, x: 0 },
      shapes: shapes,
      annotations: annotations,
      xaxis: { gridcolor: "#eef1f3", title: "" },
      yaxis: {
        gridcolor: "#e2e7ea",
        rangemode: "tozero",
        title: axisTitle(),
        separatethousands: true
      },
      font: { family: "Inter, sans-serif", color: "#17212b" }
    }, { responsive: true, displaylogo: false });
  }

  function renderMap() {
    var isChange = currentMapMetric === "change";
    var windowConfig = UF_WINDOWS[currentUfWindow];
    var field = windowConfig.field;
    var model = MODELS[currentModel];
    var locations = summary.states.map(function (entry) { return entry.ibge_code; });
    var values = summary.states.map(function (entry) {
      return isChange ? entry.latest[field] :
        scaledValue(entry.latest[model.value], entry.population);
    });
    var custom = summary.states.map(function (entry) {
      return [
        entry.uf,
        entry.name,
        formatMeasure(entry.latest[model.value], entry.population),
        formatPercent(entry.latest[field])
      ];
    });
    var finite = values.filter(function (value) { return Number.isFinite(value); });
    var trace = {
      type: "choropleth",
      geojson: geojson,
      featureidkey: "properties.codarea",
      locations: locations,
      z: values,
      marker: { line: { color: "#ffffff", width: 0.7 } },
      customdata: custom
    };
    if (isChange) {
      var bound = Math.max(20, Math.min(100,
        Math.max.apply(null, finite.map(function (value) { return Math.abs(value); }))));
      trace.zmin = -bound;
      trace.zmax = bound;
      trace.colorscale = [
        [0, "#13795b"],
        [0.5, "#f5f5f0"],
        [1, "#b33a3a"]
      ];
      trace.colorbar = { title: windowConfig.colorbarTitle, thickness: 13 };
      trace.hovertemplate =
        "<b>%{customdata[1]} (%{customdata[0]})</b><br>" +
        model.seriesLabel + ": %{customdata[2]}" +
        (currentUnit === "per100k" ? " por 100 mil" : " casos") + "<br>" +
        "Variação: %{customdata[3]}<extra></extra>";
    } else {
      trace.zmin = 0;
      trace.zmax = finite.length ? Math.max.apply(null, finite) : 1;
      trace.colorscale = [
        [0, "#fff7ec"],
        [0.5, "#fdbb84"],
        [1, "#b33a3a"]
      ];
      trace.colorbar = {
        title: currentUnit === "per100k" ? "por 100 mil" : "casos",
        thickness: 13
      };
      trace.hovertemplate =
        "<b>%{customdata[1]} (%{customdata[0]})</b><br>" +
        model.seriesLabel + ": %{customdata[2]}" +
        (currentUnit === "per100k" ? " por 100 mil" : " casos") +
        "<extra></extra>";
    }
    Plotly.react("state-map", [trace], {
      margin: { l: 0, r: 0, t: 0, b: 0 },
      geo: { fitbounds: "locations", visible: false, bgcolor: "#ffffff" },
      paper_bgcolor: "#ffffff",
      font: { family: "Inter, sans-serif", color: "#17212b" }
    }, { responsive: true, displaylogo: false });

    document.getElementById("state-map").on("plotly_click", function (event) {
      var uf = event.points[0].customdata[0];
      select.value = uf;
      render(uf);
    });
  }

  async function render(uf) {
    try {
      currentUf = uf;
      var payload = await loadState(uf);
      currentPayload = payload;
      renderCards(payload);
      renderSeries(payload);
      renderQuality(payload);
      renderTable();
      dashboard.hidden = false;
      errorPanel.hidden = true;
      retryButton.hidden = true;
      window.location.hash = uf;
    } catch (error) {
      showError(error);
    }
  }

  async function initialize() {
    try {
      var responses = await Promise.all([
        fetch(DATA_ROOT + "summary.json", { cache: "no-cache" }),
        fetch("/dashboard/srag/br_states.geojson", { cache: "no-cache" })
      ]);
      if (!responses[0].ok || !responses[1].ok) {
        throw new Error("Arquivos principais do dashboard indisponíveis.");
      }
      summary = await responses[0].json();
      geojson = await responses[1].json();
      renderMethodology(summary);
      populateSelect();
      var requested = window.location.hash.replace("#", "").toUpperCase();
      var available = ["BR"].concat(summary.states.map(function (entry) {
        return entry.uf;
      }));
      currentUf = available.indexOf(requested) >= 0 ?
        requested : summary.default_state;
      select.value = currentUf;
      unitSelect.value = currentUnit;
      mapMetricSelect.value = currentMapMetric;
      ufWindowSelect.value = currentUfWindow;
      dashboard.hidden = false;
      updateMapDescription();
      renderMap();
      renderTable();
      var generated = formatDate(summary.generated_at_utc);
      var snapshot = formatDate(
        summary.sources.srag.latest_source_snapshot_date
      );
      document.getElementById("update-status").textContent =
        "Atualizado em " + generated + " · SIVEP até " + snapshot;
      select.onchange = function () { render(select.value); };
      ufWindowSelect.onchange = function () {
        currentUfWindow = ufWindowSelect.value;
        updateMapDescription();
        renderMap();
        renderTable();
      };
      mapMetricSelect.onchange = function () {
        currentMapMetric = mapMetricSelect.value;
        updateMapDescription();
        renderMap();
      };
      unitSelect.onchange = function () {
        currentUnit = unitSelect.value;
        updateMapDescription();
        renderMap();
        renderTable();
        if (currentPayload) {
          renderCards(currentPayload);
          renderSeries(currentPayload);
          renderQuality(currentPayload);
        }
      };
      modelSelect.onchange = function () {
        currentModel = modelSelect.value;
        renderMap();
        renderTable();
        if (currentPayload) {
          renderCards(currentPayload);
          renderSeries(currentPayload);
          renderQuality(currentPayload);
        }
      };
      retryButton.onclick = initialize;
      await render(currentUf);
    } catch (error) {
      showError(error);
    }
  }

  initialize();
}());
