/* main.js */

function fmt(v, d = 2) {
  return (typeof v === "number") ? v.toFixed(d) : (v === null || v === undefined ? "—" : v);
}

function collectConfig() {
  return {
    wall_length_cm: parseFloat(document.getElementById("wallLength").value),
    wall_height_cm: parseFloat(document.getElementById("wallHeight").value),
    framing_material: document.getElementById("framingMaterial").value,
    kvh_class: document.getElementById("kvhClass").value,
    kvh_grade: document.getElementById("kvhGrade").value || null,
    stud_count: parseInt(document.getElementById("studCount").value, 10),
    flatness_context: document.getElementById("flatnessContext").value,
    stud_width_mm: parseFloat(document.getElementById("studWidth").value),
    stud_depth_mm: parseFloat(document.getElementById("studDepth").value),
    beam_width_mm: parseFloat(document.getElementById("beamWidth").value),
    beam_depth_mm: parseFloat(document.getElementById("beamDepth").value),
  };
}

function renderWarnings(warnings) {
  const box = document.getElementById("warningsBox");
  if (!warnings || warnings.length === 0) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = `<strong>Data notes (${warnings.length})</strong><ul>${warnings.map(w => `<li>${w}</li>`).join("")}</ul>`;
}

function crossSectionRow(label, cs) {
  if (!cs) return "";
  const wCell = cs.width_plus_mm == null ? "—" : `+${fmt(cs.width_plus_mm)} / -${fmt(cs.width_minus_mm)}`;
  const dCell = cs.depth_plus_mm == null ? "—" : `+${fmt(cs.depth_plus_mm)} / -${fmt(cs.depth_minus_mm)}`;
  return `<tr>
    <td>${label}</td>
    <td>${cs.width_mm} mm</td><td>${wCell}</td>
    <td>${cs.depth_mm} mm</td><td>${dCell}</td>
  </tr>`;
}

function renderTolerances(data) {
  const t = data.tolerances;
  const container = document.getElementById("toleranceTables");

  const overall = `
    <table class="result-table">
      <tr><th>Dimension</th><th>Target</th><th>Material tol. (mm)</th><th>DIN 18202 (mm)</th><th>Worst-case (mm)</th><th>RSS (mm)</th></tr>
      <tr>
        <td>Length</td><td>${(t.length.target_cm/100).toFixed(2)} m</td>
        <td>+${fmt(t.length.material_plus_mm)} / -${fmt(t.length.material_minus_mm)}</td>
        <td>±${t.length.din_mm}</td>
        <td>${fmt(t.length.worst_case_mm)}</td><td>${fmt(t.length.rss_mm)}</td>
      </tr>
      <tr>
        <td>Height</td><td>${(t.height.target_cm/100).toFixed(2)} m</td>
        <td>+${fmt(t.height.material_plus_mm)} / -${fmt(t.height.material_minus_mm)}</td>
        <td>±${t.height.din_mm}</td>
        <td>${fmt(t.height.worst_case_mm)}</td><td>${fmt(t.height.rss_mm)}</td>
      </tr>
      <tr>
        <td>Diagonal (derived)</td><td>${(t.diagonal.nominal_cm/100).toFixed(2)} m</td>
        <td colspan="2">via error propagation from length &amp; height</td>
        <td>${fmt(t.diagonal.worst_case_mm)}</td><td>${fmt(t.diagonal.rss_mm)}</td>
      </tr>
    </table>`;

  const squareness = `
    <table class="result-table">
      <tr><th>Squareness check</th><th>Value</th></tr>
      <tr><td>Diagonal difference limit (DIN 18202 angular, at ${t.squareness.evaluated_at_m} m)</td><td>${t.squareness.limit_mm} mm</td></tr>
      <tr><td>Worst-case vs. limit</td><td><span class="badge ${t.squareness.pass_worst_case ? 'pass' : 'fail'}">${t.squareness.pass_worst_case ? 'WITHIN LIMIT' : 'EXCEEDS LIMIT'}</span></td></tr>
      <tr><td>RSS vs. limit</td><td><span class="badge ${t.squareness.pass_rss ? 'pass' : 'fail'}">${t.squareness.pass_rss ? 'WITHIN LIMIT' : 'EXCEEDS LIMIT'}</span></td></tr>
    </table>`;

  const crossSection = `
    <table class="result-table">
      <tr><th>Member</th><th>Width</th><th>Width tol. (mm)</th><th>Depth</th><th>Depth tol. (mm)</th></tr>
      ${crossSectionRow("Stud", t.stud_cross_section)}
      ${crossSectionRow("Beam", t.beam_cross_section)}
    </table>`;

  container.innerHTML = overall + squareness + crossSection;
}

function renderWarpingFlatness(check) {
  const container = document.getElementById("warpingFlatnessResults");
  const flatnessRow = `<tr><td>Flatness limit — ${check.flatness_label} @ ${check.reference_distance_m}m</td><td>${fmt(check.flatness_limit_mm, 0)} mm</td></tr>`;

  const warpRow = (label, value, pass) => {
    if (value === null || value === undefined) {
      return `<tr><td>${label} (at 2m gauge)</td><td colspan="1">not available for this material (see data notes)</td></tr>`;
    }
    return `<tr><td>${label} (at 2m gauge)</td><td>${fmt(value)} mm <span class="badge ${pass ? 'pass' : 'fail'}">${pass ? 'WITHIN LIMIT' : 'EXCEEDS LIMIT'}</span></td></tr>`;
  };

  container.innerHTML = `
    <table class="result-table">
      <tr><th>Check</th><th>Value / Result</th></tr>
      ${flatnessRow}
      ${warpRow("Bow", check.bow_mm, check.bow_pass)}
      ${warpRow("Crook", check.crook_mm, check.crook_pass)}
    </table>
    <div class="warnings-box">${check.scope_note}</div>`;
}

let currentFrameData = null;
let drawingMode = "bw";

async function buildAndAnalyse() {
  const config = collectConfig();
  SharedFrameState.save(config);
  const res = await fetch("/api/frame", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    alert("Error: " + err.error);
    return;
  }
  const data = await res.json();

  renderWarnings(data.warnings);
  renderTolerances(data);
  renderWarpingFlatness(data.warping_flatness_check);
  Viewer3D.render(data);
  currentFrameData = data;
  renderDrawings();
  Charts.renderBudget("chartBudget", data.charts.deviation_budget);
  Charts.renderSize("chartSize", data.charts.permitted_vs_size);
  Charts.renderStuds("chartStuds", data.charts.stud_accumulation);
  Charts.renderStudCountSensitivity("chartStudCount", data.charts.stud_count_sensitivity);
}

function renderDrawings() {
  if (!currentFrameData) return;
  Drawing2D.renderElevation("drawingElevation", currentFrameData, drawingMode);
  Drawing2D.renderCrossSection("drawingCrossSection", currentFrameData, drawingMode);
}

document.addEventListener("DOMContentLoaded", () => {
  Viewer3D.init(document.getElementById("viewer3d"));

  // Reflect whatever font-size/visibility Label2D loaded from localStorage
  // (Viewer3D.init -> Label2D.init already read it) into the actual UI
  // controls, which otherwise still show the template's hardcoded defaults.
  document.getElementById("labelFontSize").value = Label2D.getFontSize();
  document.getElementById("labelFontSizeValue").textContent = Label2D.getFontSize() + "px";
  document.getElementById("labelVisibleToggle").checked = Label2D.getVisible();

  SharedFrameState.applyToForm(SharedFrameState.load());

  document.getElementById("framingMaterial").addEventListener("change", (e) => {
    document.getElementById("kvhClassGroup").style.display = e.target.value === "kvh" ? "block" : "none";
  });

  async function downloadDxf() {
  const body = collectConfig();
  const res = await fetch("/api/export-dxf/frame", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ frame: body })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    alert("Error: " + err.error);
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "frame.dxf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

document.getElementById("buildBtn").addEventListener("click", buildAndAnalyse);
document.getElementById("downloadDxfBtn").addEventListener("click", downloadDxf);

  document.getElementById("modeBW").addEventListener("click", () => {
    drawingMode = "bw";
    document.getElementById("modeBW").classList.add("active");
    document.getElementById("modeColor").classList.remove("active");
    renderDrawings();
  });
  document.getElementById("modeColor").addEventListener("click", () => {
    drawingMode = "color";
    document.getElementById("modeColor").classList.add("active");
    document.getElementById("modeBW").classList.remove("active");
    renderDrawings();
  });

  document.getElementById("labelFontSize").addEventListener("input", (e) => {
    const px = parseInt(e.target.value, 10);
    Label2D.setFontSize(px);
    document.getElementById("labelFontSizeValue").textContent = px + "px";
  });
  document.getElementById("labelVisibleToggle").addEventListener("change", (e) => {
    Label2D.setVisible(e.target.checked);
  });

  function syncViewButtons() {
    const mode = Viewer3D.getMode();
    document.getElementById("btnPerspective").classList.toggle("active", mode === "perspective");
    document.getElementById("btnFrontView").classList.toggle("active", mode === "ortho");
  }

  document.getElementById("btnPerspective").addEventListener("click", () => {
    Viewer3D.setPerspectiveView();
    syncViewButtons();
  });
  document.getElementById("btnFrontView").addEventListener("click", () => {
    Viewer3D.setFrontView();
    syncViewButtons();
  });
  document.getElementById("btnZoomIn").addEventListener("click", () => Viewer3D.zoomBy(1.2));
  document.getElementById("btnZoomOut").addEventListener("click", () => Viewer3D.zoomBy(1 / 1.2));
  document.getElementById("btnDownloadSvg").addEventListener("click", () => {
    Viewer3D.exportSVG("timber-wall-frame.svg");
  });
  document.getElementById("btnDownloadEmf").addEventListener("click", () => {
    Viewer3D.exportEMF("timber-wall-frame.emf");
  });

  // build once on load with defaults, then restore the last-used camera
  // view (if any was saved - e.g. from switching over from Step B) on
  // top of the default fit the build just applied.
  buildAndAnalyse().then(() => {
    Viewer3D.restoreView();
    syncViewButtons();
  });
});
