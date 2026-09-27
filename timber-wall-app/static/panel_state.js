/* panel_state.js
 * Persists the panel material selection (material, sub-type, target sheet
 * width) across Step B and Step C via localStorage - same pattern as
 * shared_state.js for the frame config. Without this, each page's
 * #panelMaterial dropdown just falls back to its HTML-declared default
 * (OSB) on every load, with no memory of what was last selected on
 * either page - reported directly: selecting Plywood on Step B, then
 * visiting Step C, then returning to Step B, showed OSB every time.
 *
 * Both pages call save() after every successful build and applyToForm()
 * on load, so whichever page was edited most recently "wins" when you
 * switch tabs - no separate copies to keep in sync.
 */
const PanelState = (function () {
  const KEY = "timberWallApp.panelConfig";

  function save(config) {
    try {
      localStorage.setItem(KEY, JSON.stringify(config));
    } catch (e) {
      // localStorage unavailable (private browsing, etc.) - fail silently,
      // the app still works without cross-page persistence.
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function applyToForm(config) {
    if (!config) return;
    const materialEl = document.getElementById("panelMaterial");
    if (materialEl && config.panel_material) {
      materialEl.value = config.panel_material;
      // Re-trigger the material dropdown's change handler (already wired
      // on each page) so the MDF/Gypsum sub-type group's visibility
      // updates before we try to set a value inside it below.
      materialEl.dispatchEvent(new Event("change"));
    }
    if (config.panel_subtype) {
      const mdfEl = document.getElementById("mdfSubtype");
      const gfbEl = document.getElementById("gfbSubtype");
      if (config.panel_material === "mdf_family" && mdfEl) mdfEl.value = config.panel_subtype;
      if (config.panel_material === "gfb_gpb" && gfbEl) gfbEl.value = config.panel_subtype;
    }
    const sheetWidthEl = document.getElementById("sheetWidth");
    if (sheetWidthEl && config.target_sheet_width_cm !== undefined && config.target_sheet_width_cm !== null) {
      sheetWidthEl.value = config.target_sheet_width_cm;
    }
  }

  return { save, load, applyToForm };
})();
