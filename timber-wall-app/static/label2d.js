/* label2d.js
 * Replaces the old canvas-texture Sprite labels (which were fundamentally
 * raster - a bitmap drawn once at a fixed pixel size, then stretched onto
 * a 3D plane, so it went soft/pixelated when zoomed or scaled) with
 * THREE.CSS2DObject labels: real HTML <div> text, positioned in 3D space
 * but rendered by the browser's own text engine - the same crispness as
 * any other text on the page, at any zoom level, plus trivial to resize
 * (just a CSS font-size) or hide (just a CSS display toggle).
 *
 * Trade-off, stated plainly: CSS2D labels don't participate in WebGL
 * depth-testing, so they always draw on top of the 3D geometry regardless
 * of what's "in front" of them in the scene - the same practical behavior
 * the old sprites already had (they used depthTest:false), so this is not
 * a regression, just worth knowing.
 */
const Label2D = (function () {
  let css2dRenderer = null;
  let allLabelObjects = []; // CSS2DObject instances, not the divs directly - see note below
  let currentFontSizePx = 15;
  let labelsVisible = true;

  const PREFS_KEY = "timberWallApp.labelPrefs";

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const prefs = JSON.parse(raw);
        if (typeof prefs.fontSize === "number") currentFontSizePx = prefs.fontSize;
        if (typeof prefs.visible === "boolean") labelsVisible = prefs.visible;
      }
    } catch (e) {
      // localStorage unavailable - fall back to the defaults above
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ fontSize: currentFontSizePx, visible: labelsVisible }));
    } catch (e) {
      // ignore - preference just won't persist this session
    }
  }

  function init(container) {
    loadPrefs(); // so the very first labels created (during the initial build) already use the saved size/visibility, not the hardcoded default
    css2dRenderer = new THREE.CSS2DRenderer();
    css2dRenderer.setSize(container.clientWidth, container.clientHeight);
    css2dRenderer.domElement.style.position = "absolute";
    css2dRenderer.domElement.style.top = "0";
    css2dRenderer.domElement.style.left = "0";
    css2dRenderer.domElement.style.pointerEvents = "none"; // don't block orbit-drag on the WebGL canvas underneath
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    container.appendChild(css2dRenderer.domElement);
  }

  function resize(w, h) {
    if (css2dRenderer) css2dRenderer.setSize(w, h);
  }

  function clearLabels() {
    allLabelObjects = [];
  }

  function createLabel(text, opts) {
    opts = opts || {};
    const div = document.createElement("div");
    div.className = "label2d-tag";
    div.textContent = text;
    div.style.color = opts.color || "#7c3a1f";
    div.style.background = "rgba(255,255,255,0.92)";
    div.style.padding = "2px 7px";
    div.style.borderRadius = "3px";
    div.style.fontFamily = "Arial, sans-serif";
    div.style.fontWeight = "700";
    div.style.whiteSpace = "nowrap";
    div.style.fontSize = currentFontSizePx + "px";
    const obj = new THREE.CSS2DObject(div);
    // IMPORTANT: CSS2DRenderer.render() overwrites element.style.display
    // on every animation frame based on object.visible (see its source,
    // renderObject()) - it does NOT read or preserve a manually-set
    // display style. So visibility must be controlled via the
    // CSS2DObject's own .visible flag, not by touching the div's CSS
    // directly (that was the earlier bug: any manual style.display was
    // silently reverted on the next frame).
    obj.visible = labelsVisible;
    allLabelObjects.push(obj);
    return obj;
  }

  function setFontSize(px) {
    currentFontSizePx = px;
    allLabelObjects.forEach(obj => { obj.element.style.fontSize = px + "px"; });
    savePrefs();
  }

  function setVisible(visible) {
    labelsVisible = visible;
    allLabelObjects.forEach(obj => { obj.visible = visible; });
    savePrefs();
  }

  function getFontSize() { return currentFontSizePx; }
  function getVisible() { return labelsVisible; }

  function getLabelsForExport() {
    // Only currently-visible labels, since an SVG export should match what's
    // actually on screen right now (respects both the global toggle and any
    // per-label visibility).
    return allLabelObjects
      .filter(obj => obj.visible)
      .map(obj => ({
        text: obj.element.textContent,
        color: obj.element.style.color,
        fontSizePx: currentFontSizePx,
        position: obj.position.clone(),
      }));
  }

  function render(scene, camera) {
    if (css2dRenderer) css2dRenderer.render(scene, camera);
  }

  return { init, resize, clearLabels, createLabel, setFontSize, setVisible, getFontSize, getVisible, getLabelsForExport, render };
})();
