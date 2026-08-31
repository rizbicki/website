(function () {
  "use strict";

  var DATA_ROOT = "/dashboard/srag/data/";
  var summary = null;
  var geojson = null;
  var currentUf = "BR";
  var currentModel = "ensemble";
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
      seriesLabel: "Sazonal", cardLabel: "Sazonal (ano anterior suavizado)"
    },
    lasso: {
      value: "lasso", lower: "lasso_lower80", upper: "lasso_upper80",
      seriesLabel: "Trends", cardLabel: "Trends (Google Trends)"
    },
    combined: {
      value: "combined", lower: "combined_lower80", upper: "combined_upper80",
      seriesLabel: "Combinado 50/50", cardLabel: "Combinado experimental"
    },
    infogripe: {
      value: "infogripe_raw", lower: "infogripe_raw_lower80", upper: "infogripe_raw_upper80",
      seriesLabel: "InfoGripe", cardLabel: "InfoGripe (Fiocruz)",
      observed: "infogripe_reported_raw", intervalLabel: "Intervalo de credibilidade de 80%"
    }
  };

  var select = document.getElementById("state-select");
  var modelSelect = document.getElementById("model-select");
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
      ["Dados do SIVEP até", formatDate(summaryData.sources.srag.latest_source_snapshot_date)],
      ["Nowcast InfoGripe até", formatDate(summaryData.sources.infogripe.latest_week)]
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

  function per100k(value, population) {
    if (value === null || value === undefined) return null;
    if (!Number.isFinite(population) || population <= 0) return null;
    return 100000 * value / population;
  }

  function formatRate(value) {
    if (value === null || value === undefined) return "—";
    return new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2
    }).format(value);
  }

  function formatSignedCount(value) {
    if (value === null || value === undefined) return "—";
    return new Intl.NumberFormat("pt-BR", {
      maximumFractionDigits: 0,
      signDisplay: "exceptZero"
    }).format(value);
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

  function modelChangeMetrics(payload, modelKey) {
    var rows = payload.series;
    var field = MODELS[modelKey].value;
    var latest = latestForModel(payload, modelKey);
    var eligible = rows.filter(function (row) {
      return row.week <= latest.week;
    });
    var series;
    if (modelKey === "infogripe") {
      series = eligible.map(function (row) {
        return row[field];
      }).filter(function (value) {
        return value !== null && value !== undefined;
      });
    } else {
      series = eligible.map(function (row) {
        var v = row[field];
        return v === null || v === undefined ? row.observed : v;
      });
    }
    return {
      change2w: rollingChange(series, 2),
      change4w: rollingChange(series, 4)
    };
  }

  function latestForModel(payload, modelKey) {
    var field = MODELS[modelKey].value;
    for (var i = payload.series.length - 1; i >= 0; i -= 1) {
      if (payload.series[i][field] !== null && payload.series[i][field] !== undefined) {
        return payload.series[i];
      }
    }
    return payload.latest;
  }

  function summaryChangeField(modelKey, baseField) {
    if (modelKey === "infogripe") return "infogripe_raw_" + baseField;
    if (modelKey === "combined") return "combined_" + baseField;
    return baseField;
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
      "Estimativa da semana mais recente em casos por 100 mil habitantes.";
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
    var field = summaryChangeField(
      currentModel, UF_WINDOWS[currentUfWindow].field);
    var model = MODELS[currentModel];
    var tbody = document.getElementById("state-table");
    document.getElementById("table-nowcast-heading").textContent =
      model.seriesLabel;
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
          formatCount(entry.latest[model.value]) + "</td>" +
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
    var model = MODELS[currentModel];
    var latest = latestForModel(payload, currentModel);
    var estimate = latest[model.value];
    var lower = latest[model.lower];
    var upper = latest[model.upper];
    var isInfo = currentModel === "infogripe";
    var isCombined = currentModel === "combined";
    var observed = latest[model.observed || "observed"];
    var changes = modelChangeMetrics(payload, currentModel);
    document.getElementById("selected-kicker").textContent =
      payload.uf === "BR" ?
        (isInfo ? "Estimativa nacional do InfoGripe" :
          isCombined ? "Mistura de duas estimativas nacionais" :
          "Agregado das 27 UFs") : payload.uf;
    document.getElementById("selected-title").textContent = payload.name;
    document.getElementById("series-title").textContent =
      "Série semanal — " + payload.name;
    document.getElementById("series-chart").setAttribute(
      "aria-label", "Gráfico temporal de casos de SRAG filtrados em " + payload.name
    );
    var period = "Semana iniciada em " + formatDate(latest.week);
    if (isInfo) {
      period += " · série oficial coletada em " +
        formatDate(summary.sources.infogripe.retrieved_at_utc);
    } else {
      period += " · corte de treino em " + formatDate(payload.training.cutoff);
    }
    document.getElementById("selected-period").textContent = period;
    document.getElementById("nowcast-label").textContent = model.cardLabel;
    document.getElementById("nowcast-value").textContent = formatCount(estimate);
    document.getElementById("interval-value").textContent = isCombined ?
      "Faixa 80% da mistura: " + formatCount(lower) + "–" + formatCount(upper) :
      "80%: " + formatCount(lower) + "–" + formatCount(upper);
    document.getElementById("observed-label").textContent =
      isInfo ? "Notificado na base do InfoGripe" : "SRAG filtrado notificado";
    document.getElementById("observed-value").textContent = formatCount(observed);
    document.getElementById("observed-note").textContent =
      isInfo ? "valor informado na publicação oficial" : "valor ainda provisório";
    document.getElementById("change-2w-value").textContent =
      formatPercent(changes.change2w);
    document.getElementById("change-2w-value").className =
      changes.change2w >= 0 ? "positive" : "negative";
    document.getElementById("change-4w-value").textContent =
      formatPercent(changes.change4w);
    document.getElementById("change-4w-value").className =
      changes.change4w >= 0 ? "positive" : "negative";
    document.getElementById("model-note").hidden = !isCombined;
    document.getElementById("interval-description").textContent = isCombined ?
      "Laranja: faixa de 80% do InfoGripe. Roxo: quantis 10–90% da mistura. " +
      "Cinza: envelope conservador dos dois modelos." :
      "A faixa mostra o intervalo de 80% publicado por cada modelo.";
    document.getElementById("interpretation").textContent = isCombined ?
      "O modelo local estima " + formatCount(latest.nowcast) +
      " casos e o InfoGripe estima " +
      formatCount(latest.infogripe) +
      "; a combinação 50/50 resulta em " + formatCount(estimate) +
      ". O peso ainda é experimental." :
      "O valor observado até agora é " + formatCount(observed) + " casos" +
      "; o modelo " + model.cardLabel.toLowerCase() + " estima " +
      formatCount(estimate) + " casos após compensar o atraso de notificação.";
  }

  function renderQuality(payload) {
    var score = payload.backtest && payload.backtest[currentModel] || {};
    var model = MODELS[currentModel];
    document.getElementById("quality-wape").textContent =
      score.wape_percent === null || score.wape_percent === undefined ?
        "—" : formatPercent(score.wape_percent).replace("+", "");
    document.getElementById("quality-bias").textContent =
      formatSignedCount(score.bias);
    document.getElementById("quality-bias-unit").textContent =
      "casos por semana";
    document.getElementById("quality-coverage").textContent =
      score.coverage80_percent === null || score.coverage80_percent === undefined ?
        "—" : formatPercent(score.coverage80_percent).replace("+", "");
    document.getElementById("quality-coverage-note").textContent =
      score.note ? "requer vintages semanais arquivados" :
        score.coverage80_percent === null || score.coverage80_percent === undefined ?
        "disponível após a próxima atualização" : "ideal próximo de 80%";
    document.getElementById("quality-n").textContent = formatCount(score.n);
    document.getElementById("quality-description").textContent =
      score.note ||
        ("Resultados do modelo " + model.cardLabel.toLowerCase() +
        " em previsões históricas fora da amostra para " + payload.name +
        ". O viés indica se o modelo tende a superestimar (+) ou subestimar (−).");
  }

  function renderSeries(payload) {
    var rows = payload.series;
    var model = MODELS[currentModel];
    var x = rows.map(function (row) { return row.week; });
    var stableObserved = rows.map(function (row) {
      return row.provisional ? null : row.observed;
    });
    var provisionalObserved = rows.map(function (row) {
      return row.provisional ? row.observed : null;
    });
    var provisionalIndex = rows.findIndex(function (row) { return row.provisional; });
    var shapes = [];
    var annotations = [];
    if (provisionalIndex >= 0) {
      var lastDate = new Date(rows[rows.length - 1].week + "T12:00:00");
      lastDate.setDate(lastDate.getDate() + 7);
      shapes.push({
        type: "rect", xref: "x", yref: "paper",
        x0: rows[provisionalIndex].week,
        x1: lastDate.toISOString().slice(0, 10),
        y0: 0, y1: 1, fillcolor: "rgba(96,112,128,0.10)",
        line: { width: 0 }, layer: "below"
      });
      annotations.push({
        xref: "x", yref: "paper", x: rows[provisionalIndex].week, y: 0.98,
        xanchor: "left", yanchor: "top", text: "Período provisório",
        showarrow: false, font: { size: 11, color: "#607080" },
        bgcolor: "rgba(255,255,255,0.78)", borderpad: 3
      });
    }

    var traces = [];
    if (currentModel === "combined") {
      traces.push(
        {
          x: x, y: rows.map(function (row) { return row.combined_envelope_lower; }),
          type: "scatter", mode: "lines", line: { color: "rgba(80,80,80,0)" },
          hoverinfo: "skip", showlegend: false
        },
        {
          x: x, y: rows.map(function (row) { return row.combined_envelope_upper; }),
          type: "scatter", mode: "lines", line: { color: "rgba(80,80,80,0)" },
          fill: "tonexty", fillcolor: "rgba(80,80,80,0.12)",
          name: "Envelope dos modelos", hoverinfo: "skip"
        },
        {
          x: x, y: rows.map(function (row) { return row.infogripe_lower80; }),
          type: "scatter", mode: "lines", line: { color: "rgba(230,126,34,0)" },
          hoverinfo: "skip", showlegend: false
        },
        {
          x: x, y: rows.map(function (row) { return row.infogripe_upper80; }),
          type: "scatter", mode: "lines", line: { color: "rgba(230,126,34,0)" },
          fill: "tonexty", fillcolor: "rgba(230,126,34,0.18)",
          name: "InfoGripe: faixa de 80%", hoverinfo: "skip"
        },
        {
          x: x, y: rows.map(function (row) { return row.combined_lower80; }),
          type: "scatter", mode: "lines", line: { color: "rgba(123,44,191,0)" },
          hoverinfo: "skip", showlegend: false
        },
        {
          x: x, y: rows.map(function (row) { return row.combined_upper80; }),
          type: "scatter", mode: "lines", line: { color: "rgba(123,44,191,0)" },
          fill: "tonexty", fillcolor: "rgba(123,44,191,0.20)",
          name: "Mistura: faixa de 80%", hoverinfo: "skip"
        }
      );
    } else {
      traces.push(
        {
          x: x, y: rows.map(function (row) { return row[model.lower]; }),
          type: "scatter", mode: "lines", line: { color: "rgba(217,95,2,0)" },
          hoverinfo: "skip", showlegend: false
        },
        {
          x: x, y: rows.map(function (row) { return row[model.upper]; }),
          type: "scatter", mode: "lines", line: { color: "rgba(217,95,2,0)" },
          fill: "tonexty", fillcolor: "rgba(217,95,2,0.16)",
          name: model.intervalLabel || "Intervalo conformal de 80%",
          hoverinfo: "skip"
        }
      );
    }
    traces.push(
      {
        x: x, y: stableObserved, type: "scatter", mode: "lines",
        line: { color: "#17212b", width: 2.2 }, name: "SRAG consolidado"
      },
      {
        x: x, y: provisionalObserved, type: "scatter", mode: "lines+markers",
        line: { color: "#7b8791", width: 1.5, dash: "dot" },
        marker: { size: 4 }, name: "Notificado (provisório)"
      }
    );
    if (currentModel === "combined") {
      traces.push(
        {
          x: x, y: rows.map(function (row) { return row.nowcast; }),
          type: "scatter", mode: "lines+markers",
          line: { color: "#1769aa", width: 2, dash: "dash" },
          marker: { size: 4 }, name: "Trends + sazonal"
        },
        {
          x: x, y: rows.map(function (row) { return row.infogripe; }),
          type: "scatter", mode: "lines+markers",
          line: { color: "#e67e22", width: 2, dash: "dash" },
          marker: { size: 4 }, name: "InfoGripe"
        },
        {
          x: x, y: rows.map(function (row) { return row.combined; }),
          type: "scatter", mode: "lines+markers",
          line: { color: "#7b2cbf", width: 3 },
          marker: { size: 6 }, name: "Combinado 50/50"
        }
      );
    } else {
      traces.push({
        x: x, y: rows.map(function (row) { return row[model.value]; }),
        type: "scatter", mode: "lines+markers",
        line: { color: "#d95f02", width: 3 },
        marker: { size: 6 }, name: model.seriesLabel
      });
    }

    Plotly.react("series-chart", traces, {
      margin: { l: 60, r: 20, t: 20, b: 55 },
      paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff",
      hovermode: "x unified",
      legend: { orientation: "h", y: 1.08, x: 0 },
      shapes: shapes, annotations: annotations,
      xaxis: { gridcolor: "#eef1f3", title: "" },
      yaxis: {
        gridcolor: "#e2e7ea", rangemode: "tozero",
        title: "Casos semanais", separatethousands: true
      },
      font: { family: "Inter, sans-serif", color: "#17212b" }
    }, { responsive: true, displaylogo: false });
  }

  function renderMap() {
    var isChange = currentMapMetric === "change";
    var windowConfig = UF_WINDOWS[currentUfWindow];
    var field = summaryChangeField(currentModel, windowConfig.field);
    var model = MODELS[currentModel];
    var locations = summary.states.map(function (entry) { return entry.ibge_code; });
    var values = summary.states.map(function (entry) {
      return isChange ? entry.latest[field] :
        per100k(entry.latest[model.value], entry.population);
    });
    var custom = summary.states.map(function (entry) {
      var rate = per100k(entry.latest[model.value], entry.population);
      return [
        entry.uf,
        entry.name,
        formatCount(entry.latest[model.value]),
        formatRate(rate),
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
        model.seriesLabel + ": %{customdata[2]} casos<br>" +
        "Variação: %{customdata[4]}<extra></extra>";
    } else {
      trace.zmin = 0;
      trace.zmax = finite.length ? Math.max.apply(null, finite) : 1;
      trace.colorscale = [
        [0, "#fff7ec"],
        [0.5, "#fdbb84"],
        [1, "#b33a3a"]
      ];
      trace.colorbar = {
        title: "casos por 100 mil",
        thickness: 13
      };
      trace.hovertemplate =
        "<b>%{customdata[1]} (%{customdata[0]})</b><br>" +
        model.seriesLabel + ": %{customdata[3]} por 100 mil habitantes" +
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
        "Atualizado em " + generated + " · SIVEP até " + snapshot +
        " · InfoGripe até " + formatDate(summary.sources.infogripe.latest_week);
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
