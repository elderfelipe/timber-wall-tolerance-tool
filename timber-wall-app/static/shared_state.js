/* shared_state.js
 * Persists the shared frame configuration (wall dims, material, stud/beam
 * cross-sections, etc.) across Step A and Step B pages via localStorage.
 * This is a standalone local Flask app running in the user's own browser
 * (not a claude.ai sandboxed artifact), so localStorage is appropriate
 * here - it's just page-to-page state for one user on one machine.
 *
 * Both pages call save() after every successful build and applyToForm()
 * on load, so whichever page was edited most recently "wins" when you
 * switch tabs - no separate copies to keep in sync.
 */
const SharedFrameState = (function () {
  const KEY = "timberWallApp.frameConfig";

  const FIELD_MAP = {
    wall_length_cm: "wallLength",
    wall_height_cm: "wallHeight",
    framing_material: "framingMaterial",
    kvh_class: "kvhClass",
    kvh_grade: "kvhGrade",
    stud_count: "studCount",
    stud_width_mm: "studWidth",
    stud_depth_mm: "studDepth",
    beam_width_mm: "beamWidth",
    beam_depth_mm: "beamDepth",
    flatness_context: "flatnessContext",
  };

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
    for (const [key, elementId] of Object.entries(FIELD_MAP)) {
      const el = document.getElementById(elementId);
      if (el && config[key] !== undefined && config[key] !== null) {
        el.value = config[key];
      }
    }
    // KVH-specific field groups only exist on some pages/only show
    // conditionally - re-trigger the material dropdown's change handler
    // (already wired on each page) so visibility updates correctly.
    const fm = document.getElementById("framingMaterial");
    if (fm) fm.dispatchEvent(new Event("change"));
  }

  return { save, load, applyToForm };
})();
