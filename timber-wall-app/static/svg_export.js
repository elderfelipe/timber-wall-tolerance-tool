/* svg_export.js
 * Exports whatever the 3D viewer currently shows (perspective OR the
 * orthographic front view - whichever is active) as a genuine vector
 * SVG file, using THREE.SVGRenderer to turn the studs/beams/panels/
 * overlay lines into real vector paths, rather than a screenshot.
 *
 * CSS2DObject labels (the tolerance text) are NOT part of the WebGL
 * scene graph SVGRenderer walks - they're real HTML elements positioned
 * alongside it (see label2d.js) - so they're re-added here as genuine
 * SVG <text> elements, manually reprojected through the same camera
 * using THREE's own Vector3.project(), matching their on-screen position.
 *
 * Background is intentionally left transparent: no fill rect is added
 * anywhere, so the exported file has no opaque background layer.
 */
const SVGExport = (function () {
  function estimateTextWidth(text, fontSizePx) {
    // Rough average character width for Arial-like sans-serif, used only
    // to size each label's background rect - doesn't need to be exact.
    return text.length * fontSizePx * 0.56;
  }

  function clampChannel(v) {
    return Math.max(0, Math.min(255, parseInt(v, 10)));
  }

  function convertStyleToAttributes(svgEl) {
    // SVGRenderer writes every path's appearance into a single CSS-style
    // "style" attribute (style="fill:rgb(r,g,b);fill-opacity:1;stroke:...").
    // That's valid SVG, but plenty of real-world SVG importers - PowerPoint's
    // being the most common - only reliably read the older, plainer
    // presentation attributes (fill="...", fill-opacity="...", stroke="...",
    // etc.) set directly on the element, not values packed inside "style".
    // Confirmed by direct report: opened in PowerPoint, every mesh lost its
    // fill and the labels' backgrounds rendered solid black instead of
    // transparent white. This rewrites every style="..." into the
    // equivalent plain attributes and removes "style" entirely, which is
    // both valid SVG and far more widely supported than the CSS form.
    // Also re-applies the rgb() channel clamp here, in one pass, since
    // SVGRenderer's unclamped lighting math (see below) can still emit
    // out-of-range values that need correcting regardless of which form
    // they end up in.
    const rgbPattern = /rgb\((-?\d+),\s*(-?\d+),\s*(-?\d+)\)/;
    svgEl.querySelectorAll("[style]").forEach(el => {
      const style = el.getAttribute("style") || "";
      const props = {};
      style.split(";").forEach(pair => {
        const idx = pair.indexOf(":");
        if (idx === -1) return;
        const key = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (key) props[key] = value;
      });

      ["fill", "stroke"].forEach(prop => {
        if (!props[prop]) return;
        const m = props[prop].match(rgbPattern);
        if (m) {
          props[prop] = `rgb(${clampChannel(m[1])},${clampChannel(m[2])},${clampChannel(m[3])})`;
        }
        el.setAttribute(prop, props[prop]);
      });
      ["fill-opacity", "stroke-opacity", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray"].forEach(prop => {
        if (props[prop] !== undefined) el.setAttribute(prop, props[prop]);
      });

      el.removeAttribute("style");
    });
  }

  function buildSvgString(scene, camera, width, height) {
    // SVGRenderer applies its own simple (non-PBR, unclamped) lighting math
    // to MeshStandardMaterial - the same ambient+directional light setup
    // that looks correct in WebGL (which tone-maps/clamps automatically)
    // overflows past 255 here, washing the wood color out and even
    // producing literally invalid rgb() values. MeshBasicMaterial is the
    // one type SVGRenderer copies verbatim with NO lighting applied (see
    // its source), so every wood mesh is temporarily swapped to a
    // MeshBasicMaterial of the same color for this render pass only, then
    // restored - this also gives a flatter, more "technical drawing"-like
    // look, consistent with the app's existing 2D SVG drawings.
    const swapped = [];
    scene.traverse(obj => {
      if (obj.isMesh && obj.material && !obj.material.isMeshBasicMaterial) {
        swapped.push({ obj, original: obj.material });
        obj.material = new THREE.MeshBasicMaterial({
          color: obj.material.color,
          transparent: obj.material.transparent,
          opacity: obj.material.opacity,
        });
      }
    });

    const renderer = new THREE.SVGRenderer();
    renderer.setSize(width, height);
    renderer.render(scene, camera);

    // restore the real materials immediately - the live WebGL view must
    // never show the flat export-only versions, even for one frame
    swapped.forEach(({ obj, original }) => { obj.material.dispose(); obj.material = original; });

    // IMPORTANT: SVGRenderer.setSize() already gives the SVG a CENTER-
    // ORIGIN viewBox ("-width/2 -height/2 width height"), and every path
    // it draws is in that same centered coordinate system. Do NOT
    // override the viewBox to a top-left-origin one here - that was the
    // bug: it clipped the drawing down to a single quadrant of what was
    // actually rendered. Labels below must use this same centered
    // convention (no "+0.5" top-left shift) to land in the right place.
    const svgEl = renderer.domElement;
    svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    // SVGRenderer unconditionally sets an inline background-color style
    // (defaulting to its clear color) - strip it so the file is genuinely
    // transparent, not opaque white.
    svgEl.style.removeProperty("background-color");
    svgEl.removeAttribute("style");

    convertStyleToAttributes(svgEl);

    // Re-add tolerance labels as real vector text, since SVGRenderer never
    // saw them (they're CSS2DObjects, not scene geometry).
    const labels = (typeof Label2D !== "undefined") ? Label2D.getLabelsForExport() : [];
    labels.forEach(lbl => {
      const ndc = lbl.position.clone().project(camera);
      if (ndc.z < -1 || ndc.z > 1) return; // outside the camera's near/far range
      const x = ndc.x * (width / 2);
      const y = -ndc.y * (height / 2);
      const fontSize = lbl.fontSizePx || 15;
      const textWidth = estimateTextWidth(lbl.text, fontSize);

      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");

      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", x - textWidth / 2 - 4);
      rect.setAttribute("y", y - fontSize / 2 - 3);
      rect.setAttribute("width", textWidth + 8);
      rect.setAttribute("height", fontSize + 6);
      // Plain fill + a SEPARATE fill-opacity attribute, not an rgba()
      // color value - rgba() is CSS Color 4 syntax that plenty of SVG
      // importers (again, PowerPoint) don't parse, silently defaulting
      // to black. fill-opacity as its own attribute is SVG 1.1 and
      // universally supported.
      rect.setAttribute("fill", "rgb(255,255,255)");
      rect.setAttribute("fill-opacity", "0.92");
      rect.setAttribute("rx", "3");
      group.appendChild(rect);

      const textEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
      textEl.setAttribute("x", x);
      textEl.setAttribute("y", y);
      textEl.setAttribute("font-family", "Arial, sans-serif");
      textEl.setAttribute("font-size", fontSize);
      textEl.setAttribute("font-weight", "700");
      textEl.setAttribute("fill", lbl.color || "#7c3a1f");
      textEl.setAttribute("text-anchor", "middle");
      textEl.setAttribute("dominant-baseline", "middle");
      textEl.textContent = lbl.text;
      group.appendChild(textEl);

      svgEl.appendChild(group);
    });

    const serializer = new XMLSerializer();
    let svgString = serializer.serializeToString(svgEl);
    if (!svgString.match(/^<\?xml/)) {
      svgString = '<?xml version="1.0" standalone="no"?>\r\n' + svgString;
    }
    return svgString;
  }

  function downloadBlob(content, mimeType, filename) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportScene(scene, camera, width, height, filename) {
    const svgString = buildSvgString(scene, camera, width, height);
    downloadBlob(svgString, "image/svg+xml;charset=utf-8", filename || "view.svg");
  }

  async function exportSceneAsEMF(scene, camera, width, height, filename) {
    // EMF (the binary vector format Word/PowerPoint/Excel use) is
    // generated server-side, from the SAME SVG string this module already
    // builds for the SVG download - see emf_export.py for the actual
    // binary writer. Keeping one shared SVG-building path means the two
    // export formats can never visually drift apart from each other.
    const svgString = buildSvgString(scene, camera, width, height);
    const res = await fetch("/api/export-emf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ svg: svgString, width, height }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Unknown error" }));
      alert("EMF export error: " + err.error);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "view.emf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return { exportScene, exportSceneAsEMF, buildSvgString };
})();
