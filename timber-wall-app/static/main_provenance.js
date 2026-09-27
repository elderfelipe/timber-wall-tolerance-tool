/* main_provenance.js */

function renderStats(stats) {
  const pct = stats.verified_percent;
  const color = pct >= 90 ? "#2f6d3e" : pct >= 70 ? "#b8860b" : "#a3312c";
  document.getElementById("statsCard").innerHTML = `
    <div class="stack-summary" style="display:flex; align-items:center; gap:2rem;">
      <div>
        <div class="big" style="font-size:2.4rem; color:${color}">${pct}%</div>
        <div class="hint">of data fields verified against a primary source</div>
      </div>
      <div>
        <p><strong>${stats.verified_count}</strong> verified &nbsp;·&nbsp; <strong>${stats.unverified_count}</strong> unverified &nbsp;·&nbsp; ${stats.total_flagged_fields} total tracked fields</p>
        <p class="hint">Computed live from data/materials.json and data/din18202.json — reload after any data update to see it change.</p>
      </div>
    </div>
  `;
}

function renderStandards(standards) {
  const rows = standards.map(s => `
    <tr>
      <td><strong>${s.ref}</strong></td>
      <td>${s.title}</td>
      <td>${s.scope}</td>
      <td>${s.used_in}</td>
      <td><span class="badge ${s.source_confirmed ? 'pass' : 'fail'}">${s.source_confirmed ? 'Source read directly' : 'Inherited, unconfirmed'}</span></td>
    </tr>`).join("");
  document.getElementById("standardsTable").innerHTML = `
    <table class="result-table">
      <tr><th>Standard</th><th>Title</th><th>Scope</th><th>Used in</th><th>Status</th></tr>
      ${rows}
    </table>`;
}

function renderUnverified(items) {
  if (items.length === 0) {
    document.getElementById("unverifiedTable").innerHTML = `<p class="hint">None currently — everything tracked is verified.</p>`;
    return;
  }
  const rows = items.map(i => `
    <tr>
      <td style="font-family:monospace; font-size:0.82rem;">${i.path}</td>
      <td>${i.note || "<span class='hint'>no note recorded</span>"}</td>
    </tr>`).join("");
  document.getElementById("unverifiedTable").innerHTML = `
    <table class="result-table">
      <tr><th>Field</th><th>Why it's unverified</th></tr>
      ${rows}
    </table>`;
}

async function load() {
  const res = await fetch("/api/provenance");
  const data = await res.json();
  renderStats(data.stats);
  renderStandards(data.standards);
  renderUnverified(data.stats.unverified_items);
}

document.addEventListener("DOMContentLoaded", load);
