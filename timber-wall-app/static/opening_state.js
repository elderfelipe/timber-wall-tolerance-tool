/* opening_state.js
 * Persists Step D's openings list (and the finished-jambs toggle) across
 * page navigation, same localStorage pattern as shared_state.js (frame
 * config) and camera_view_state.js (3D view) - Step D's own opening rows
 * were the one piece of per-step state that wasn't being saved yet.
 */
const OpeningState = (function () {
  const KEY = "timberWallApp.openingsConfig";

  function save(config) {
    try {
      localStorage.setItem(KEY, JSON.stringify(config));
    } catch (e) {
      // ignore - just won't persist this session
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

  return { save, load };
})();
