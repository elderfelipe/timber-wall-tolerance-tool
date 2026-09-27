/* main_b.js */

function fmt(v, d = 2) {
  return (typeof v === "number") ? v.toFixed(d) : (v === null || v === undefined ? "—" : v);
}

function collectFrameConfig() {
  return {
    wall_length_cm: parseFloat(document.getElementById("wallLength").value),
    wall_height_cm: parseFloat(document.getElementById("wallHeight").value),
    framing_material: document.getElementById("framingMaterial").value,
    kvh_class: document.getElementById("kvhClass").value,
    stud_count: parseInt(document.getElementById("studCount").value, 10),
    stud_width_mm: parseFloat(document.getElementById("studWidth").value),
    stud_depth_mm: parseFloat(document.getElementById("studDepth").value),
    beam_width_mm: parseFloat(document.getElementById("beamWidth").value),
    beam_depth_mm: parseFloat(document.getElementById("beamDepth").value),
  };
}

function getPanelSubtype() {
  const material = document.getElementById("panelMaterial").value;
  if (material === "mdf_family") return document.getElementById("mdfSubtype").value;
  if (material === "gfb_gpb") return document.getElementById("gfbSubtype").value;
  return null;
}

function syncPanelSubtypeVisibility() {
  const material = document.getElementById("panelMaterial").value;
  document.getElementById("mdfSubtypeGroup").style.display = material === "mdf_family" ? "block" : "none";
  document.getElementById("gfbSubtypeGroup").style.display = material === "gfb_gpb" ? "block" : "none";
}

function collectPanelConfig() {
  return {
    panel_material: document.getElementById("panelMaterial").value,
    panel_subtype: getPanelSubtype(),
    target_sheet_width_cm: parseFloat(document.getElementById("sheetWidth").value),
  };
}

function renderWarnings(frameWarnings, panelWarnings) {
  const all = [...(frameWarnings || []), ...(panelWarnings || [])];
  const box = document.getElementById("warningsBox");
  if (all.length === 0) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = `<strong>Data notes (${all.length})</strong><ul>${all.map(w => `<li>${w}</li>`).join("")}</ul>`;
}

function renderPanelLayout(panel) {
  const container = document.getElementById("panelLayoutResults");
  const rows = panel.panels.map((p, i) => `
    <tr>
      <td>Panel ${i + 1}</td>
      <td>${(p.x0_cm / 100).toFixed(2)} m – ${(p.x1_cm / 100).toFixed(2)} m</td>
      <td>${(p.actual_width_cm / 100).toFixed(3)} m (${p.end_stud_index - p.start_stud_index} bay${p.end_stud_index - p.start_stud_index > 1 ? "s" : ""})</td>
    </tr>`).join("");

  container.innerHTML = `
    <table class="result-table">
      <tr><th>Sheet</th><th>Spans</th><th>Actual width</th></tr>
      ${rows}
    </table>
    <p class="hint">Material: ${panel.material_source} · Bay spacing: ${fmt(panel.bay_spacing_cm)} cm · Bays per panel: ${panel.bays_per_panel}</p>
  `;
}

function renderJointResults(jc) {
  const container = document.getElementById("jointResults");
  if (jc.combined_rss_mm === null) {
    container.innerHTML = `<p class="hint">Joint tolerance unavailable — see data notes above.</p>`;
    return;
  }
  container.innerHTML = `
    <table class="result-table">
      <tr><th>Component</th><th>Value</th></tr>
      <tr><td>Panel width tolerance</td><td>±${fmt(jc.panel_width_tolerance_mm)} mm</td></tr>
      <tr><td>Stud positional tolerance (DIN 18202 alignment)</td><td>±${fmt(jc.stud_positional_tolerance_mm)} mm</td></tr>
      <tr><td>Combined worst-case</td><td>${fmt(jc.combined_worst_case_mm)} mm</td></tr>
      <tr><td>Combined RSS</td><td>${fmt(jc.combined_rss_mm)} mm</td></tr>
      <tr><td>Half stud width (margin available)</td><td>${fmt(jc.half_stud_width_mm)} mm</td></tr>
      <tr><td>Worst-case vs. margin</td><td><span class="badge ${jc.pass_worst_case ? 'pass' : 'fail'}">${jc.pass_worst_case ? 'WITHIN MARGIN' : 'EXCEEDS MARGIN'}</span></td></tr>
      <tr><td>RSS vs. margin</td><td><span class="badge ${jc.pass_rss ? 'pass' : 'fail'}">${jc.pass_rss ? 'WITHIN MARGIN' : 'EXCEEDS MARGIN'}</span></td></tr>
    </table>
  `;
}

function collectEstimateConfig() {
  return {
    raw_sheet_width_cm: parseFloat(document.getElementById("rawSheetWidth").value),
    raw_sheet_length_cm: parseFloat(document.getElementById("rawSheetLength").value),
    price_per_sheet: parseFloat(document.getElementById("pricePerSheet").value),
  };
}

function renderMaterialEstimate(estimate) {
  const container = document.getElementById("materialEstimateResults");
  if (estimate.error) {
    container.innerHTML = `<p class="hint" style="color:#a3312c">${estimate.error}</p>`;
    return;
  }
  container.innerHTML = `
    <table class="result-table">
      <tr><th>Sheets needed</th><th>Total cost</th><th>Raw area purchased</th><th>Area actually used</th><th>Waste</th></tr>
      <tr>
        <td>${estimate.sheets_needed}</td>
        <td>${estimate.total_cost.toFixed(2)}</td>
        <td>${estimate.raw_area_m2.toFixed(2)} m²</td>
        <td>${estimate.used_area_m2.toFixed(2)} m²</td>
        <td>${estimate.waste_area_m2.toFixed(2)} m² (${estimate.waste_percent}%)</td>
      </tr>
    </table>
    <p class="hint" style="margin-top:0.6rem">${estimate.scope_note}</p>
  `;
}

async function buildAndAnalyse() {
  const frameConfig = collectFrameConfig();
  SharedFrameState.save(frameConfig);
  const panelConfig = collectPanelConfig();
  PanelState.save(panelConfig);
  const body = { frame: frameConfig, panel: panelConfig, estimate: collectEstimateConfig() };
  const res = await fetch("/api/material-estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    alert("Error: " + err.error);
    return;
  }
  const data = await res.json();
  if (data.panel.error) {
    alert("Error: " + data.panel.error);
    return;
  }

  renderWarnings(data.frame.warnings, data.panel.warnings);
  renderPanelLayout(data.panel);
  renderJointResults(data.panel.joint_check);
  renderMaterialEstimate(data.estimate);
  PanelViewer3D.render(data);
  Charts.renderPanelCountSensitivity("chartPanelCount", data.panel.chart_sheet_width_sensitivity);
}

document.addEventListener("DOMContentLoaded", () => {
  PanelViewer3D.init(document.getElementById("viewer3d"));

  syncPanelSubtypeVisibility();
  document.getElementById("panelMaterial").addEventListener("change", syncPanelSubtypeVisibility);

  document.getElementById("labelFontSize").value = Label2D.getFontSize();
  document.getElementById("labelFontSizeValue").textContent = Label2D.getFontSize() + "px";
  document.getElementById("labelVisibleToggle").checked = Label2D.getVisible();

  SharedFrameState.applyToForm(SharedFrameState.load());
  PanelState.applyToForm(PanelState.load());

  document.getElementById("framingMaterial").addEventListener("change", (e) => {
    document.getElementById("kvhClassGroup").style.display = e.target.value === "kvh" ? "block" : "none";
  });

  document.getElementById("buildBtn").addEventListener("click", buildAndAnalyse);

  document.getElementById("labelFontSize").addEventListener("input", (e) => {
    const px = parseInt(e.target.value, 10);
    Label2D.setFontSize(px);
    document.getElementById("labelFontSizeValue").textContent = px + "px";
  });
  document.getElementById("labelVisibleToggle").addEventListener("change", (e) => {
    Label2D.setVisible(e.target.checked);
  });

  function syncViewButtons() {
    const mode = PanelViewer3D.getMode();
    document.getElementById("btnPerspective").classList.toggle("active", mode === "perspective");
    document.getElementById("btnFrontView").classList.toggle("active", mode === "ortho");
  }

  document.getElementById("btnPerspective").addEventListener("click", () => {
    PanelViewer3D.setPerspectiveView();
    syncViewButtons();
  });
  document.getElementById("btnFrontView").addEventListener("click", () => {
    PanelViewer3D.setFrontView();
    syncViewButtons();
  });
  document.getElementById("btnZoomIn").addEventListener("click", () => PanelViewer3D.zoomBy(1.2));
  document.getElementById("btnZoomOut").addEventListener("click", () => PanelViewer3D.zoomBy(1 / 1.2));
  document.getElementById("btnDownloadSvg").addEventListener("click", () => {
    PanelViewer3D.exportSVG("timber-wall-panels.svg");
  });
  document.getElementById("btnDownloadEmf").addEventListener("click", () => {
    PanelViewer3D.exportEMF("timber-wall-panels.emf");
  });

  buildAndAnalyse().then(() => {
    PanelViewer3D.restoreView();
    syncViewButtons();
  });
});
