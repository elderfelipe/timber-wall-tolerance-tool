/* main_e.js */

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

function numOrNull(id) {
  const v = document.getElementById(id).value;
  return v === "" ? null : parseFloat(v);
}

function collectMeasuredConfig(savedOpenings) {
  const measured = {
    length_cm: numOrNull("measLength"),
    height_cm: numOrNull("measHeight"),
    diagonal_cm: numOrNull("measDiag1"),
    diagonal2_cm: numOrNull("measDiag2"),
    openings: [],
  };
  if (savedOpenings && savedOpenings.openings) {
    savedOpenings.openings.forEach((o, i) => {
      const w = numOrNull(`measOpeningWidth${i}`);
      const h = numOrNull(`measOpeningHeight${i}`);
      if (w !== null || h !== null) {
        measured.openings.push({ index: i, width_cm: w, height_cm: h });
      }
    });
  }
  return measured;
}

function buildOpeningMeasurementRows(savedOpenings) {
  const section = document.getElementById("openingsSection");
  const list = document.getElementById("openingMeasurementsList");
  if (!savedOpenings || !savedOpenings.openings || savedOpenings.openings.length === 0) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";
  list.innerHTML = savedOpenings.openings.map((o, i) => `
    <div class="opening-row">
      <strong>Opening ${i + 1} (${o.type}) — design ${(o.width_cm / 100).toFixed(2)}m × ${(o.height_cm / 100).toFixed(2)}m</strong>
      <div class="two-col" style="margin-top:0.5rem">
        <div>
          <label>Measured width (cm)</label>
          <input type="number" id="measOpeningWidth${i}" step="0.1" placeholder="not measured">
        </div>
        <div>
          <label>Measured height (cm)</label>
          <input type="number" id="measOpeningHeight${i}" step="0.1" placeholder="not measured">
        </div>
      </div>
    </div>
  `).join("");
}

function renderWarnings(frameWarnings, asBuiltWarnings) {
  const all = [...(frameWarnings || []), ...(asBuiltWarnings || [])];
  const box = document.getElementById("warningsBox");
  if (all.length === 0) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = `<strong>Data notes (${all.length})</strong><ul>${all.map(w => `<li>${w}</li>`).join("")}</ul>`;
}

function renderResults(asBuilt) {
  const container = document.getElementById("asBuiltResults");
  if (asBuilt.error) {
    container.innerHTML = `<p class="hint">${asBuilt.error}</p>`;
    return;
  }
  const badge = (status) => `<span class="badge ${status ? 'pass' : 'fail'}">${status ? 'PASS' : 'FAIL'}</span>`;
  const rows = asBuilt.checks.map(c => `
    <tr>
      <td>${c.label}</td>
      <td>${fmt(c.nominal_cm)} cm</td>
      <td>${fmt(c.measured_cm)} cm</td>
      <td>${fmt(c.deviation_mm)} mm</td>
      <td>${fmt(c.permitted_worst_case_mm, 1)} mm / ${fmt(c.permitted_rss_mm, 1)} mm</td>
      <td>${badge(c.pass_worst_case)} / ${badge(c.pass_rss)}</td>
    </tr>`).join("");

  const overallColor = asBuilt.overall_pass_rss ? "pass" : "fail";
  const overallText = asBuilt.overall_pass_rss ? "WITHIN PERMITTED DEVIATION (RSS)" : "EXCEEDS PERMITTED DEVIATION (RSS)";
  const overallWcColor = asBuilt.overall_pass_worst_case ? "pass" : "fail";
  const overallWcText = asBuilt.overall_pass_worst_case ? "WITHIN PERMITTED DEVIATION (WC)" : "EXCEEDS PERMITTED DEVIATION (WC)";

  container.innerHTML = `
    <div class="stack-summary">
      <p><strong>Overall verdict:</strong> <span class="badge ${overallColor}" style="font-size:0.9rem">${overallText}</span></p>
      <p><strong>Overall verdict, worst-case (reference only):</strong> <span class="badge ${overallWcColor}" style="font-size:0.9rem">${overallWcText}</span></p>
    </div>
    <table class="result-table">
      <tr><th>Measurement</th><th>Design (nominal)</th><th>Measured</th><th>Deviation</th><th>Permitted (WC / RSS)</th><th>WC / RSS</th></tr>
      ${rows}
    </table>
  `;
}

async function checkAsBuilt() {
  const savedOpenings = OpeningState.load();
  const body = {
    frame: collectFrameConfig(),
    measured: collectMeasuredConfig(savedOpenings),
  };
  if (savedOpenings && savedOpenings.openings && savedOpenings.openings.length) {
    body.opening = savedOpenings;
  }
  const res = await fetch("/api/as-built", {
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
  renderWarnings(data.frame.warnings, data.as_built.warnings);
  renderResults(data.as_built);
}

document.addEventListener("DOMContentLoaded", () => {
  SharedFrameState.applyToForm(SharedFrameState.load());

  document.getElementById("framingMaterial").addEventListener("change", (e) => {
    document.getElementById("kvhClassGroup").style.display = e.target.value === "kvh" ? "block" : "none";
  });

  const savedOpenings = OpeningState.load();
  buildOpeningMeasurementRows(savedOpenings);

  document.getElementById("checkBtn").addEventListener("click", checkAsBuilt);
});
