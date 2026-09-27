/* charts.js */
const Charts = (function () {
  let budgetChart, sizeChart, studChart, studCountChart, panelCountChart, tornadoCharts = {};

  function destroyIfExists(c) { if (c) c.destroy(); }

  // Generic plugin: draws dashed vertical lines at arbitrary x-values on a
  // linear x-axis, with a small label. Used to mark "your current wall"
  // on charts where the underlying scale is continuous.
  const currentMarkerPlugin = {
    id: "currentMarker",
    afterDatasetsDraw(chart, args, opts) {
      const marks = (chart.options.plugins && chart.options.plugins.currentMarker && chart.options.plugins.currentMarker.marks) || [];
      if (!marks.length) return;
      const { ctx, chartArea, scales } = chart;
      const xScale = scales.x;
      ctx.save();
      marks.forEach((m, i) => {
        const xPix = xScale.getPixelForValue(m.value);
        if (xPix < chartArea.left || xPix > chartArea.right) return;
        ctx.beginPath();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = m.color || "#333";
        ctx.lineWidth = 1.5;
        ctx.moveTo(xPix, chartArea.top);
        ctx.lineTo(xPix, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = m.color || "#333";
        ctx.font = "11px Arial, sans-serif";
        ctx.fillText(m.label, xPix + 4, chartArea.top + 14 + i * 14);
      });
      ctx.restore();
    }
  };

  // --- Chart 1 palette: warm neutrals ---
  const P1 = { material: "#d9b98a", din: "#c98a2e", wc: "#7c3a2e", rss: "#3a6b4a" };
  // --- Chart 2 palette: cool blues/teals/purple (distinct from chart 1) ---
  const P2 = { plan: "#2e4a7c", elevation: "#1f8a70", material: "#6b4a8c" };
  // --- Chart 3 palette: magenta/mustard (distinct from charts 1 & 2) ---
  const P3 = { datum: "#8a7c2e", chained: "#a3327c" };
  // --- Chart 4 palette: rose/steel-blue + muted flat-line accents (distinct from 1-3) ---
  const P4 = { chained: "#c1447e", spacing: "#3f7f9e", bow: "#b8860b", crook: "#4f9e6b", twist: "#7a5aa8" };

  function renderBudget(canvasId, budget) {
    destroyIfExists(budgetChart);
    const ctx = document.getElementById(canvasId).getContext("2d");
    budgetChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: budget.labels,
        datasets: [
          { label: "Material tolerance (mm)", data: budget.material_mm, backgroundColor: P1.material },
          { label: "DIN 18202 assembly (mm)", data: budget.din_mm, backgroundColor: P1.din },
          { label: "Combined worst-case (mm)", data: budget.worst_case_mm, backgroundColor: P1.wc },
          { label: "Combined RSS (mm)", data: budget.rss_mm, backgroundColor: P1.rss },
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: "bottom", labels: { font: { family: "Arial" } } } },
        scales: { y: { title: { display: true, text: "mm" } } }
      }
    });
  }

  function renderSize(canvasId, s) {
    destroyIfExists(sizeChart);
    const ctx = document.getElementById(canvasId).getContext("2d");
    const toPoints = (arr) => s.sizes_m.map((x, i) => ({ x, y: arr[i] }));
    sizeChart = new Chart(ctx, {
      type: "line",
      data: {
        datasets: [
          { label: "DIN 18202 plan (length)", data: toPoints(s.din_plan_mm), borderColor: P2.plan, stepped: true, fill: false, tension: 0, pointRadius: 3 },
          { label: "DIN 18202 elevation (height)", data: toPoints(s.din_elevation_mm), borderColor: P2.elevation, stepped: true, fill: false, tension: 0, pointRadius: 3 },
          { label: "Material length tolerance", data: toPoints(s.material_length_mm), borderColor: P2.material, fill: false, tension: 0.15, spanGaps: true, pointRadius: 3 },
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom", labels: { font: { family: "Arial" } } },
          currentMarker: {
            marks: [
              { value: s.current_length_m, label: `Wall length (${s.current_length_m} m)`, color: P2.plan },
              { value: s.current_height_m, label: `Wall height (${s.current_height_m} m)`, color: P2.elevation },
            ]
          }
        },
        scales: {
          x: { type: "linear", title: { display: true, text: "Target size (m)" } },
          y: { title: { display: true, text: "Permitted deviation (mm)" } }
        }
      },
      plugins: [currentMarkerPlugin]
    });
  }

  function renderStuds(canvasId, acc) {
    destroyIfExists(studChart);
    const ctx = document.getElementById(canvasId).getContext("2d");
    studChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: acc.stud_index,
        datasets: [
          { label: "Datum-referenced (jig/laser)", data: acc.datum_referenced_mm, borderColor: P3.datum, fill: false },
          { label: "Chained (stud-to-stud)", data: acc.chained_mm, borderColor: P3.chained, fill: false },
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: "bottom", labels: { font: { family: "Arial" } } } },
        scales: {
          x: { title: { display: true, text: "Stud index" } },
          y: { title: { display: true, text: "Positional tolerance (mm)" } }
        }
      }
    });
  }

  function renderStudCountSensitivity(canvasId, d) {
    destroyIfExists(studCountChart);
    const ctx = document.getElementById(canvasId).getContext("2d");
    const counts = d.stud_counts;
    const datasets = [
      { label: "Chained tolerance at far stud (mm)", data: counts.map((c, i) => ({ x: c, y: d.chained_tolerance_at_last_stud_mm[i] })), borderColor: P4.chained, yAxisID: "y", fill: false },
      { label: "Bay spacing (cm)", data: counts.map((c, i) => ({ x: c, y: d.bay_spacing_cm[i] })), borderColor: P4.spacing, yAxisID: "y1", fill: false },
    ];
    studCountChart = new Chart(ctx, {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom", labels: { font: { family: "Arial" } } },
          currentMarker: { marks: [{ value: d.current_stud_count, label: `Current: ${d.current_stud_count} studs`, color: "#555" }] }
        },
        scales: {
          x: { type: "linear", title: { display: true, text: "Number of studs" }, ticks: { stepSize: 1 } },
          y:  { type: "linear", position: "left",  title: { display: true, text: "mm (chained tolerance / warping limits)" } },
          y1: { type: "linear", position: "right", title: { display: true, text: "Bay spacing (cm)" }, grid: { drawOnChartArea: false } }
        }
      },
      plugins: [currentMarkerPlugin]
    });
  }

  // --- Chart 5 (Step B) palette: teal/copper, distinct from charts 1-4 ---
  const P5 = { count: "#1f7a6c", current: "#b5651d" };

  function renderPanelCountSensitivity(canvasId, d) {
    destroyIfExists(panelCountChart);
    const ctx = document.getElementById(canvasId).getContext("2d");
    panelCountChart = new Chart(ctx, {
      type: "line",
      data: {
        datasets: [
          { label: "Number of panel sheets", data: d.widths_cm.map((w, i) => ({ x: w, y: d.panel_count[i] })), borderColor: P5.count, stepped: true, fill: false, pointRadius: 2 },
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom", labels: { font: { family: "Arial" } } },
          currentMarker: { marks: [{ value: d.current_width_cm, label: `Current target: ${d.current_width_cm}cm`, color: P5.current }] }
        },
        scales: {
          x: { type: "linear", title: { display: true, text: "Target sheet width (cm)" } },
          y: { title: { display: true, text: "Panel sheets needed" }, ticks: { stepSize: 1 } }
        }
      },
      plugins: [currentMarkerPlugin]
    });
  }

  // --- Sensitivity (Step C): horizontal "tornado" bar chart - one per
  // metric (squareness / joint / thickness step). Sorted so the largest
  // driver sits on top, matching the conventional tornado layout. ---
  function renderTornado(canvasId, sources, unitLabel) {
    if (tornadoCharts[canvasId]) tornadoCharts[canvasId].destroy();
    const ctx = document.getElementById(canvasId).getContext("2d");
    const sorted = [...sources].sort((a, b) => a.impact_mm - b.impact_mm); // ascending so largest ends up at the top visually (Chart.js draws bottom-up)
    tornadoCharts[canvasId] = new Chart(ctx, {
      type: "bar",
      data: {
        labels: sorted.map(s => s.label),
        datasets: [{
          label: `Impact on result if this source were zero (${unitLabel})`,
          data: sorted.map(s => s.impact_mm),
          backgroundColor: "#b5651d",
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: `Drop in result if zeroed (${unitLabel})` }, beginAtZero: true },
        }
      }
    });
  }

  return { renderBudget, renderSize, renderStuds, renderStudCountSensitivity, renderPanelCountSensitivity, renderTornado };
})();
