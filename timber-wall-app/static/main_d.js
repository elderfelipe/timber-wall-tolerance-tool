/* main_d.js */
let openingCounter = 0;

function fmt(v, d = 1) {
  return (typeof v === "number") ? v.toFixed(d) : (v === null || v === undefined ? "—" : v);
}

function addOpeningRow(defaults) {
  defaults = defaults || {};
  openingCounter++;
  const tpl = document.getElementById("openingRowTemplate");
  const node = tpl.content.cloneNode(true);
  const row = node.querySelector(".opening-row");
  row.dataset.index = openingCounter;
  row.querySelector(".opening-num").textContent = document.querySelectorAll(".opening-row").length + 1;

  const typeSel = row.querySelector(".opening-type");
  typeSel.value = defaults.type || "window";
  row.querySelector(".opening-x").value = defaults.x_position_cm ?? 50;
  row.querySelector(".opening-width").value = defaults.width_cm ?? 90;
  row.querySelector(".opening-height").value = defaults.height_cm ?? 120;
  const sillGroup = row.querySelector(".opening-sill-group");
  row.querySelector(".opening-sill").value = defaults.sill_height_cm ?? 90;
  sillGroup.style.display = typeSel.value === "door" ? "none" : "block";

  typeSel.addEventListener("change", () => {
    sillGroup.style.display = typeSel.value === "door" ? "none" : "block";
  });
  row.querySelector(".remove-opening-btn").addEventListener("click", () => {
    row.remove();
    renumberOpenings();
  });

  document.getElementById("openingsList").appendChild(node);
}

function renumberOpenings() {
  document.querySelectorAll(".opening-row").forEach((row, i) => {
    row.querySelector(".opening-num").textContent = i + 1;
  });
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

function collectOpeningConfig() {
  const openings = [];
  document.querySelectorAll(".opening-row").forEach(row => {
    const type = row.querySelector(".opening-type").value;
    const opening = {
      type,
      x_position_cm: parseFloat(row.querySelector(".opening-x").value),
      width_cm: parseFloat(row.querySelector(".opening-width").value),
      height_cm: parseFloat(row.querySelector(".opening-height").value),
    };
    if (type === "window") {
      opening.sill_height_cm = parseFloat(row.querySelector(".opening-sill").value);
    }
    openings.push(opening);
  });
  return {
    openings,
    finished_jambs: document.getElementById("finishedJambs").checked,
  };
}

function renderWarnings(frameWarnings, openingWarnings) {
  const all = [...(frameWarnings || []), ...(openingWarnings || [])];
  const box = document.getElementById("warningsBox");
  if (all.length === 0) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = `<strong>Data notes (${all.length})</strong><ul>${all.map(w => `<li>${w}</li>`).join("")}</ul>`;
}

function renderResults(openingData) {
  const container = document.getElementById("openingResults");
  if (openingData.error) {
    container.innerHTML = `<p class="hint" style="color:#a3312c">${openingData.error}</p>`;
    return;
  }
  const rows = openingData.openings.map(o => {
    const wt = o.width_tolerance, ht = o.height_tolerance;
    const badge = (status) => `<span class="badge ${status ? 'pass' : 'fail'}">${status ? 'PASS' : 'FAIL'}</span>`;
    return `
      <tr>
        <td>Opening ${o.index + 1} (${o.type})</td>
        <td>${fmt(o.width_cm / 100, 2)}m × ${fmt(o.height_cm / 100, 2)}m</td>
        <td>±${fmt(wt.rss_mm)}mm RSS / ±${fmt(wt.worst_case_mm)}mm WC vs. ${wt.din_limit_mm}mm limit</td>
        <td>${badge(wt.pass_worst_case)} / ${badge(wt.pass_rss)}</td>
        <td>±${fmt(ht.rss_mm)}mm RSS / ±${fmt(ht.worst_case_mm)}mm WC vs. ${ht.din_limit_mm}mm limit</td>
        <td>${badge(ht.pass_worst_case)} / ${badge(ht.pass_rss)}</td>
      </tr>`;
  }).join("");
  container.innerHTML = `
    <table class="result-table">
      <tr><th>Opening</th><th>Nominal size</th><th>Width check</th><th>WC / RSS</th><th>Height check</th><th>WC / RSS</th></tr>
      ${rows}
    </table>
    <p class="hint" style="margin-top:0.6rem">${openingData.scope_note}</p>
  `;
}

async function buildAndAnalyse() {
  const body = { frame: collectFrameConfig(), opening: collectOpeningConfig() };
  SharedFrameState.save(body.frame);
  OpeningState.save(body.opening);
  const res = await fetch("/api/openings", {
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
  if (data.opening.error) {
    renderResults(data.opening);
    renderWarnings(data.frame.warnings, []);
    return;
  }
  renderWarnings(data.frame.warnings, data.opening.warnings);
  renderResults(data.opening);
  OpeningViewer3D.render(data);
}

async function downloadDxf() {
  const body = { frame: collectFrameConfig(), opening: collectOpeningConfig() };
  const res = await fetch("/api/export-dxf/openings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
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
  a.download = "frame_with_openings.dxf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

document.addEventListener("DOMContentLoaded", () => {
  OpeningViewer3D.init(document.getElementById("viewer3d"));

  document.getElementById("labelFontSize").value = Label2D.getFontSize();
  document.getElementById("labelFontSizeValue").textContent = Label2D.getFontSize() + "px";
  document.getElementById("labelVisibleToggle").checked = Label2D.getVisible();

  SharedFrameState.applyToForm(SharedFrameState.load());

  document.getElementById("framingMaterial").addEventListener("change", (e) => {
    document.getElementById("kvhClassGroup").style.display = e.target.value === "kvh" ? "block" : "none";
  });

  const savedOpenings = OpeningState.load();
  if (savedOpenings && savedOpenings.openings && savedOpenings.openings.length) {
    savedOpenings.openings.forEach(o => addOpeningRow(o));
    document.getElementById("finishedJambs").checked = !!savedOpenings.finished_jambs;
  } else {
    addOpeningRow({ type: "door", x_position_cm: 50, width_cm: 90, height_cm: 210 });
  }

  document.getElementById("addOpeningBtn").addEventListener("click", () => {
    addOpeningRow({ type: "window", x_position_cm: 200, width_cm: 100, height_cm: 120, sill_height_cm: 90 });
  });

  document.getElementById("buildBtn").addEventListener("click", buildAndAnalyse);
  document.getElementById("downloadDxfBtn").addEventListener("click", downloadDxf);

  document.getElementById("labelFontSize").addEventListener("input", (e) => {
    const px = parseInt(e.target.value, 10);
    Label2D.setFontSize(px);
    document.getElementById("labelFontSizeValue").textContent = px + "px";
  });
  document.getElementById("labelVisibleToggle").addEventListener("change", (e) => {
    Label2D.setVisible(e.target.checked);
  });

  function syncViewButtons() {
    const mode = OpeningViewer3D.getMode();
    document.getElementById("btnPerspective").classList.toggle("active", mode === "perspective");
    document.getElementById("btnFrontView").classList.toggle("active", mode === "ortho");
  }
  document.getElementById("btnPerspective").addEventListener("click", () => {
    OpeningViewer3D.setPerspectiveView();
    syncViewButtons();
  });
  document.getElementById("btnFrontView").addEventListener("click", () => {
    OpeningViewer3D.setFrontView();
    syncViewButtons();
  });
  document.getElementById("btnZoomIn").addEventListener("click", () => OpeningViewer3D.zoomBy(1.2));
  document.getElementById("btnZoomOut").addEventListener("click", () => OpeningViewer3D.zoomBy(1 / 1.2));
  document.getElementById("btnDownloadSvg").addEventListener("click", () => {
    OpeningViewer3D.exportSVG("timber-wall-openings.svg");
  });
  document.getElementById("btnDownloadEmf").addEventListener("click", () => {
    OpeningViewer3D.exportEMF("timber-wall-openings.emf");
  });

  buildAndAnalyse().then(() => {
    OpeningViewer3D.restoreView();
    syncViewButtons();
  });
});
