/* camera_view_state.js
 * Persists the 3D viewer's camera state (projection mode, position,
 * target, orthographic zoom) across Step A / Step B page navigations,
 * same localStorage pattern as shared_state.js and label2d.js's prefs.
 */
const CameraViewState = (function () {
  const KEY = "timberWallApp.cameraView";

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      // ignore - view just won't persist this session
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
