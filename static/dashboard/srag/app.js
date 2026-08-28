(function () {
  "use strict";

  var DATA_ROOT = "/dashboard/srag/data/";
  var summary = null;
  var geojson = null;
  var currentUf = "BR";
  var currentModel = "ensemble";
  var currentPayload = null;
  var stateCache = new Map();

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
  var dashboard = document.getElementById("dashboard");
  var errorPanel = document.getElementById("error-panel");
  var retryButton = document.getElementById("retry-button");
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
    var tbody = document.getElementById("state-table");
    tbody.textContent = "";
    summary.states
      .slice()
      .sort(function (a, b) {
        return (b.latest.change_vs_seasonal_percent || 0) -
          (a.latest.change_vs_seasonal_percent || 0);
      })
      .forEach(function (entry) {
        var row = document.createElement("tr");
        row.dataset.uf = entry.uf;
        if (entry.uf === currentUf) row.classList.add("selected");
        var changeClass = entry.latest.change_vs_seasonal_percent >= 0 ?
          "positive" : "negative";
        row.innerHTML =
          "<td><strong>" + entry.uf + "</strong> <span class=\"muted\">" +
          entry.name + "</span></td>" +
          "<td>" + formatCount(entry.latest.nowcast) + "</td>" +
          "<td class=\"" + changeClass + "\">" +
          formatPercent(entry.latest.change_vs_seasonal_percent) + "</td>";
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
    document.getElementById("nowcast-value").textContent = formatCount(estimate);
    document.getElementById("interval-value").textContent =
      "80%: " + formatCount(lower) + "–" + formatCount(upper);
    document.getElementById("observed-value").textContent = formatCount(latest.observed);
    document.getElementById("change-2w-value").textContent =
      formatPercent(changes.change2w);
    document.getElementById("change-2w-value").className =
      changes.change2w >= 0 ? "positive" : "negative";
    document.getElementById("change-4w-value").textContent =
      formatPercent(changes.change4w);
    document.getElementById("change-4w-value").className =
      changes.change4w >= 0 ? "positive" : "negative";
    document.getElementById("interpretation").textContent =
      "O valor observado até agora é " + formatCount(latest.observed) +
      "; o modelo " + model.cardLabel.toLowerCase() + " estima " +
      formatCount(estimate) + " casos após compensar o atraso de notificação.";
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
    var lower = rows.map(function (row) { return row[model.lower]; });
    var upper = rows.map(function (row) { return row[model.upper]; });
    var estimate = rows.map(function (row) { return row[model.value]; });

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
        name: "Intervalo empírico de 80%", hoverinfo: "skip"
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
      xaxis: { gridcolor: "#eef1f3", title: "" },
      yaxis: {
        gridcolor: "#e2e7ea",
        rangemode: "tozero",
        title: "Casos semanais",
        separatethousands: true
      },
      font: { family: "Inter, sans-serif", color: "#17212b" }
    }, { responsive: true, displaylogo: false });
  }

  function renderMap() {
    var locations = summary.states.map(function (entry) { return entry.ibge_code; });
    var values = summary.states.map(function (entry) {
      return entry.latest.change_vs_seasonal_percent;
    });
    var custom = summary.states.map(function (entry) {
      return [entry.uf, entry.name, entry.latest.nowcast];
    });
    var finite = values.filter(function (value) { return Number.isFinite(value); });
    var bound = Math.max(20, Math.min(100,
      Math.max.apply(null, finite.map(function (value) { return Math.abs(value); }))));
    var trace = {
      type: "choropleth",
      geojson: geojson,
      featureidkey: "properties.codarea",
      locations: locations,
      z: values,
      zmin: -bound,
      zmax: bound,
      colorscale: [
        [0, "#13795b"],
        [0.5, "#f5f5f0"],
        [1, "#b33a3a"]
      ],
      colorbar: { title: "% vs. ano anterior", thickness: 13 },
      marker: { line: { color: "#ffffff", width: 0.7 } },
      customdata: custom,
      hovertemplate:
        "<b>%{customdata[1]} (%{customdata[0]})</b><br>" +
        "Nowcast: %{customdata[2]:,.0f}<br>" +
        "Variação: %{z:.1f}%<extra></extra>"
    };
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
        fetch("/dashboard/srag/br_states.geojson", { cache: "force-cache" })
      ]);
      if (!responses[0].ok || !responses[1].ok) {
        throw new Error("Arquivos principais do dashboard indisponíveis.");
      }
      summary = await responses[0].json();
      geojson = await responses[1].json();
      populateSelect();
      var requested = window.location.hash.replace("#", "").toUpperCase();
      var available = ["BR"].concat(summary.states.map(function (entry) {
        return entry.uf;
      }));
      currentUf = available.indexOf(requested) >= 0 ?
        requested : summary.default_state;
      select.value = currentUf;
      dashboard.hidden = false;
      renderMap();
      renderTable();
      var generated = formatDate(summary.generated_at_utc);
      var snapshot = formatDate(
        summary.sources.srag.latest_source_snapshot_date
      );
      document.getElementById("update-status").textContent =
        "Atualizado em " + generated + " · SIVEP até " + snapshot;
      select.onchange = function () { render(select.value); };
      modelSelect.onchange = function () {
        currentModel = modelSelect.value;
        if (currentPayload) {
          renderCards(currentPayload);
          renderSeries(currentPayload);
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
