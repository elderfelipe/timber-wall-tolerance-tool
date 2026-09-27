/* drawing2d.js
 * 2D technical drawings (elevation + cross-section) generated as SVG,
 * built from the same /api/frame response the 3D view and charts use.
 * Two render modes:
 *   'bw'    - black-on-white drafting convention (thin extension/dimension
 *             lines, filled arrowheads, no fill on members except a light
 *             outline - matches a professional technical drawing)
 *   'color' - same line-work, but members filled with the same wood tones
 *             used in the 3D view, for visual consistency across views
 */
const Drawing2D = (function () {

  const PALETTE = {
    bw:    { stud: "#ffffff", beam: "#ffffff", outline: "#111111", dim: "#111111", text: "#111111" },
    color: { stud: "#d9b98a", beam: "#c9a367", outline: "#3a2c1a", dim: "#c1447e", text: "#3a2c1a" }
  };

  function esc(s) { return String(s); }

  function textEl(x, y, s, opts) {
    opts = opts || {};
    const anchor = opts.anchor || "middle";
    const size = opts.size || 14;
    const color = opts.color || "#111";
    const rotate = opts.rotate ? ` transform="rotate(${opts.rotate} ${x} ${y})"` : "";
    const weight = opts.weight || "400";
    return `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}"${rotate}>${esc(s)}</text>`;
  }

  function lineEl(x1, y1, x2, y2, color, width, dash) {
    const dashAttr = dash ? ` stroke-dasharray="${dash}"` : "";
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"${dashAttr} />`;
  }

  function rectEl(x, y, w, h, fill, stroke, strokeWidth) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
  }

  // Filled triangular arrowhead. dir: 'left'|'right'|'up'|'down' = direction the tip points.
  function arrow(tipX, tipY, dir, size, color) {
    let pts;
    if (dir === "left")  pts = `${tipX},${tipY} ${tipX+size},${tipY-size/2.2} ${tipX+size},${tipY+size/2.2}`;
    if (dir === "right") pts = `${tipX},${tipY} ${tipX-size},${tipY-size/2.2} ${tipX-size},${tipY+size/2.2}`;
    if (dir === "up")    pts = `${tipX},${tipY} ${tipX-size/2.2},${tipY+size} ${tipX+size/2.2},${tipY+size}`;
    if (dir === "down")  pts = `${tipX},${tipY} ${tipX-size/2.2},${tipY-size} ${tipX+size/2.2},${tipY-size}`;
    return `<polygon points="${pts}" fill="${color}" />`;
  }

  // Horizontal dimension: extension lines up from (x1,objY) and (x2,objY) to
  // dimY, then a dimension line between them with arrowheads, label centered above.
  function hDimension(x1, x2, objY, dimY, label, color, opts) {
    opts = opts || {};
    const gap = 6, overshoot = 6, arrowSize = opts.arrowSize || 8;
    const extTop = dimY - overshoot;
    let svg = "";
    svg += lineEl(x1, objY - gap, x1, extTop, color, 1);
    svg += lineEl(x2, objY - gap, x2, extTop, color, 1);
    svg += lineEl(x1, dimY, x2, dimY, color, 1.2);
    svg += arrow(x1, dimY, "left", arrowSize, color);
    svg += arrow(x2, dimY, "right", arrowSize, color);
    svg += textEl((x1 + x2) / 2, dimY - 8, label, { color, size: opts.fontSize || 15, weight: "600" });
    return svg;
  }

  // Vertical dimension: extension lines left from (objX,y1)/(objX,y2) to dimX,
  // then a dimension line between them with arrowheads, label rotated -90 at midpoint.
  function vDimension(y1, y2, objX, dimX, label, color, opts) {
    opts = opts || {};
    const gap = 6, overshoot = 6, arrowSize = opts.arrowSize || 8;
    const extLeft = dimX - overshoot;
    let svg = "";
    svg += lineEl(objX - gap, y1, extLeft, y1, color, 1);
    svg += lineEl(objX - gap, y2, extLeft, y2, color, 1);
    svg += lineEl(dimX, y1, dimX, y2, color, 1.2);
    svg += arrow(dimX, y1, "up", arrowSize, color);
    svg += arrow(dimX, y2, "down", arrowSize, color);
    svg += textEl(dimX - 12, (y1 + y2) / 2, label, { color, size: opts.fontSize || 15, weight: "600", rotate: -90 });
    return svg;
  }

  function buildElevationSVG(data, mode) {
    const pal = PALETTE[mode] || PALETTE.bw;
    const geo = data.geometry;
    const L = geo.wall_length_cm, H = geo.wall_height_cm;

    const VB_W = 900, VB_H = 640;
    const MARGIN_LEFT = 130, MARGIN_TOP = 90, MARGIN_RIGHT = 50, MARGIN_BOTTOM = 90;
    const drawW = VB_W - MARGIN_LEFT - MARGIN_RIGHT;
    const drawH = VB_H - MARGIN_TOP - MARGIN_BOTTOM;
    const scale = Math.min(drawW / L, drawH / H);
    const usedW = L * scale, usedH = H * scale;
    const offX = MARGIN_LEFT + (drawW - usedW) / 2;
    const offY = MARGIN_TOP + (drawH - usedH) / 2;

    const toX = (cmX) => offX + cmX * scale;
    const toY = (cmY) => offY + (H - cmY) * scale; // flip: cm grows up, svg y grows down

    let body = "";

    // beams (x_cm = left edge, y_cm = bottom edge)
    geo.beams.forEach(b => {
      const x = toX(b.x_cm);
      const y = toY(b.y_cm + b.height_cm);
      const w = b.width_cm * scale;
      const h = b.height_cm * scale;
      body += rectEl(x, y, w, h, pal.beam, pal.outline, 1.5);
    });

    // studs (x_cm = centerline, y_cm = bottom edge)
    geo.studs.forEach(s => {
      const x = toX(s.x_cm - s.width_cm / 2);
      const y = toY(s.y_cm + s.height_cm);
      const w = s.width_cm * scale;
      const h = s.height_cm * scale;
      body += rectEl(x, y, w, h, pal.stud, pal.outline, 1.5);
    });

    // overall length dimension (top)
    const dimTopY = offY - 45;
    body += hDimension(toX(0), toX(L), offY, dimTopY, `${(L / 100).toFixed(2)} m`, pal.dim);

    // overall height dimension (left)
    const dimLeftX = offX - 55;
    body += vDimension(toY(0), toY(H), offX, dimLeftX, `${(H / 100).toFixed(2)} m`, pal.dim);

    // bay spacing chain (bottom, small ticks between stud centerlines)
    const chainY = toY(0) + 35;
    const studXs = geo.studs.map(s => toX(s.x_cm));
    for (let i = 0; i < studXs.length - 1; i++) {
      const spacingCm = geo.studs[i + 1].x_cm - geo.studs[i].x_cm;
      body += hDimension(studXs[i], studXs[i + 1], toY(0) + 8, chainY, `${spacingCm.toFixed(1)}cm`, pal.dim, { arrowSize: 5, fontSize: 11 });
    }

    const title = mode === "bw" ? "" : "";
    return `<svg viewBox="0 0 ${VB_W} ${VB_H}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${VB_W}" height="${VB_H}" fill="#ffffff"/>
      ${body}
    </svg>`;
  }

  function buildCrossSectionSVG(data, mode) {
    const pal = PALETTE[mode] || PALETTE.bw;
    const cfg = data.config;
    const studW = cfg.stud_width_mm, studD = cfg.stud_depth_mm;
    const beamW = cfg.beam_width_mm, beamD = cfg.beam_depth_mm;

    const VB_W = 900, VB_H = 500;
    const PAD = 90;
    const gap = 120; // gap between the two cross-sections
    const maxDim = Math.max(studW, studD, beamW, beamD);
    const availW = (VB_W - 2 * PAD - gap) / 2;
    const availH = VB_H - 2 * PAD;
    const scale = Math.min(availW / maxDim, availH / maxDim);

    function section(cx, label, wMm, dMm, fillColor) {
      const w = wMm * scale, h = dMm * scale;
      const x = cx - w / 2, y = (VB_H - h) / 2;
      let svg = rectEl(x, y, w, h, fillColor, pal.outline, 2);
      // width dimension (bottom)
      svg += hDimension(x, x + w, y + h, y + h + 45, `${wMm} mm`, pal.dim, { fontSize: 14 });
      // depth dimension (right)
      svg += vDimension(y, y + h, x + w, x + w + 45, `${dMm} mm`, pal.dim, { fontSize: 14 });
      svg += textEl(cx, y - 20, label, { color: pal.text, size: 16, weight: "700" });
      return svg;
    }

    let body = "";
    body += section(PAD + availW / 2, "Stud", studW, studD, pal.stud);
    body += section(PAD + availW + gap + availW / 2, "Beam", beamW, beamD, pal.beam);

    return `<svg viewBox="0 0 ${VB_W} ${VB_H}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${VB_W}" height="${VB_H}" fill="#ffffff"/>
      ${body}
    </svg>`;
  }

  function renderElevation(containerId, data, mode) {
    document.getElementById(containerId).innerHTML = buildElevationSVG(data, mode);
  }

  function renderCrossSection(containerId, data, mode) {
    document.getElementById(containerId).innerHTML = buildCrossSectionSVG(data, mode);
  }

  return { renderElevation, renderCrossSection, buildElevationSVG, buildCrossSectionSVG };
})();
