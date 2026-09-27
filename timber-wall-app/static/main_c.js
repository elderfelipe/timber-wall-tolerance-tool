/* main_c.js */

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

function collectAssemblyConfig() {
  return {
    panel_thickness_mm: parseFloat(document.getElementById("panelThickness").value),
    panel_thickness_variant: document.getElementById("panelThicknessVariant").value,
    finish_class: document.getElementById("finishClass").value,
  };
}

function renderWarnings(frameWarnings, panelWarnings, assemblyWarnings) {
  const all = [...(frameWarnings || []), ...(panelWarnings || []), ...(assemblyWarnings || [])];
  const box = document.getElementById("warningsBox");
  if (all.length === 0) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = `<strong>Data notes (${all.length})</strong><ul>${all.map(w => `<li>${w}</li>`).join("")}</ul>`;
}

function renderSummary(assembly) {
  const container = document.getElementById("summaryResults");
  const rows = assembly.summary.map(s => {
    const badge = (status) => status === null
      ? `<span class="hint">—</span>`
      : `<span class="badge ${status ? 'pass' : 'fail'}">${status ? 'PASS' : 'FAIL'}</span>`;
    return `<tr><td>${s.check}</td><td>${s.value}</td><td>${badge(s.status_wc)}</td><td>${badge(s.status_rss)}</td></tr>`;
  }).join("");

  const overallColor = assembly.overall_pass_rss ? "pass" : "fail";
  const overallText = assembly.overall_pass_rss === null
    ? "Incomplete - see data notes"
    : (assembly.overall_pass_rss ? "WITHIN DIN 18202 (RSS)" : "EXCEEDS DIN 18202 (RSS)");
  const overallWcColor = assembly.overall_pass_worst_case ? "pass" : "fail";
  const overallWcText = assembly.overall_pass_worst_case === null
    ? "n/a"
    : (assembly.overall_pass_worst_case ? "WITHIN DIN 18202 (WC)" : "EXCEEDS DIN 18202 (WC)");

  container.innerHTML = `
    <div class="stack-summary">
      <p><strong>Overall verdict (drives the 3D banner):</strong> <span class="badge ${overallColor}" style="font-size:0.9rem">${overallText}</span></p>
      <p><strong>Overall verdict, worst-case (reference only, not the banner):</strong> <span class="badge ${overallWcColor}" style="font-size:0.9rem">${overallWcText}</span></p>
    </div>
    <table class="result-table">
      <tr><th>Check</th><th>Value</th><th>Worst-case</th><th>RSS</th></tr>
      ${rows}
    </table>
  `;
}

function renderStepCheck(sc) {
  const container = document.getElementById("stepCheckResults");
  if (sc.worst_case_step_mm === null) {
    container.innerHTML = `<p class="hint">Step check unavailable — see data notes above.</p>`;
    return;
  }
  container.innerHTML = `
    <table class="result-table">
      <tr><th>Component</th><th>Value</th></tr>
      <tr><td>Panel thickness tolerance</td><td>+${fmt(sc.thickness_tolerance_plus_mm)} / -${fmt(sc.thickness_tolerance_minus_mm)} mm</td></tr>
      <tr><td>Worst-case step at joint</td><td>${fmt(sc.worst_case_step_mm)} mm</td></tr>
      <tr><td>RSS step at joint</td><td>${fmt(sc.rss_step_mm)} mm</td></tr>
      <tr><td>Flatness limit — ${sc.flatness_label} @ 0.1m</td><td>${fmt(sc.flatness_limit_mm, 0)} mm</td></tr>
      <tr><td>Worst-case vs. limit</td><td><span class="badge ${sc.pass_worst_case ? 'pass' : 'fail'}">${sc.pass_worst_case ? 'WITHIN LIMIT' : 'EXCEEDS LIMIT'}</span></td></tr>
      <tr><td>RSS vs. limit</td><td><span class="badge ${sc.pass_rss ? 'pass' : 'fail'}">${sc.pass_rss ? 'WITHIN LIMIT' : 'EXCEEDS LIMIT'}</span></td></tr>
    </table>
  `;
}

async function buildAndAnalyse() {
  const body = {
    frame: collectFrameConfig(),
    panel: collectPanelConfig(),
    assembly: collectAssemblyConfig(),
  };
  SharedFrameState.save(body.frame);
  PanelState.save(body.panel);
  const res = await fetch("/api/assembly", {
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
  if (data.panel.error || data.assembly.error) {
    alert("Error: " + (data.panel.error || data.assembly.error));
    return;
  }

  renderWarnings(data.frame.warnings, data.panel.warnings, data.assembly.warnings);
  renderSummary(data.assembly);
  renderStepCheck(data.assembly.step_check);
  AssemblyViewer3D.render(data);

  const sensRes = await fetch("/api/sensitivity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (sensRes.ok) {
    const sensData = await sensRes.json();
    if (!sensData.error) {
      const s = sensData.sensitivity;
      Charts.renderTornado("tornadoSquareness", s.squareness.sources, "mm");
      if (s.joint.sources.length) Charts.renderTornado("tornadoJoint", s.joint.sources, "mm");
      if (s.thickness_step.sources.length) Charts.renderTornado("tornadoThicknessStep", s.thickness_step.sources, "mm");
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  AssemblyViewer3D.init(document.getElementById("viewer3d"));

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
    const mode = AssemblyViewer3D.getMode();
    document.getElementById("btnPerspective").classList.toggle("active", mode === "perspective");
    document.getElementById("btnFrontView").classList.toggle("active", mode === "ortho");
  }

  document.getElementById("btnPerspective").addEventListener("click", () => {
    AssemblyViewer3D.setPerspectiveView();
    syncViewButtons();
  });
  document.getElementById("btnFrontView").addEventListener("click", () => {
    AssemblyViewer3D.setFrontView();
    syncViewButtons();
  });
  document.getElementById("btnZoomIn").addEventListener("click", () => AssemblyViewer3D.zoomBy(1.2));
  document.getElementById("btnZoomOut").addEventListener("click", () => AssemblyViewer3D.zoomBy(1 / 1.2));
  document.getElementById("btnDownloadSvg").addEventListener("click", () => {
    AssemblyViewer3D.exportSVG("timber-wall-assembly.svg");
  });
  document.getElementById("btnDownloadEmf").addEventListener("click", () => {
    AssemblyViewer3D.exportEMF("timber-wall-assembly.emf");
  });

  buildAndAnalyse().then(() => {
    AssemblyViewer3D.restoreView();
    syncViewButtons();
  });
});
